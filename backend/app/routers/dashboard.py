"""Dashboard: live numbers from the real tickets, JD2 claims and AI usage.

GET /api/dashboard?days=30            last N calendar days (Myanmar time), 1 = today
GET /api/dashboard?date_from=…&date_to=…   YYYY-MM-DD, inclusive

Everyone signed in sees the claim numbers (the Inbox is shared). The AI panel is for
admins (client tokens) and the super admin (also US dollars); provider/model names never
appear here."""
from __future__ import annotations
from datetime import datetime, timedelta, timezone
from statistics import median
from fastapi import APIRouter, Depends, HTTPException
from app.config import settings
from app.models import Claim, Status
from app.security import get_current_user
from app import jd2_store, usage, audit
from app.db import Collection

router = APIRouter(prefix="/api", tags=["dashboard"])

DECIDED = {Status.approved, Status.partially_approved, Status.rejected}
CLOSED = DECIDED | {Status.closed}
AGE_BUCKETS = [("Under 1 day", 1), ("1–3 days", 3), ("3–7 days", 7), ("Over 7 days", None)]


def _local(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt + timedelta(minutes=settings.app_tz_offset_min)


def _day(dt: datetime | None) -> str:
    d = _local(dt)
    return d.strftime("%Y-%m-%d") if d else ""


def _hours(a: datetime | None, b: datetime | None) -> float | None:
    if not a or not b:
        return None
    a = a if a.tzinfo else a.replace(tzinfo=timezone.utc)
    b = b if b.tzinfo else b.replace(tzinfo=timezone.utc)
    h = (b - a).total_seconds() / 3600
    return h if h >= 0 else None


def _stat(values: list[float]) -> dict:
    v = [x for x in values if x is not None]
    return {"count": len(v), "median_hours": round(median(v), 1) if v else None,
            "avg_hours": round(sum(v) / len(v), 1) if v else None}


def _next_step(c: Claim) -> str:
    if c.jd2_item_id:
        return "JD2 to decide"
    if c.status == Status.awaiting_docs:
        return "Waiting for documents from the member"
    if not c.documents:
        return "Scan the documents in JD1"
    if not c.jd1_saved_at:
        return "Finish the JD1 note"
    return "Send to JD2"


@router.get("/dashboard")
def dashboard(days: int = 30, date_from: str = "", date_to: str = "", user=Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    if not (date_from or date_to):
        days = max(1, min(int(days or 30), 366))
        date_to = _day(now)
        date_from = _day(now - timedelta(days=days - 1))
    elif not date_from or not date_to:
        raise HTTPException(status_code=422, detail="Give both date_from and date_to")
    try:   # normalise to YYYY-MM-DD (also catches typos)
        date_from = datetime.strptime(date_from, "%Y-%m-%d").strftime("%Y-%m-%d")
        date_to = datetime.strptime(date_to, "%Y-%m-%d").strftime("%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=422, detail="Dates must be YYYY-MM-DD")
    if date_from > date_to:
        date_from, date_to = date_to, date_from
    if (datetime.strptime(date_to, "%Y-%m-%d") - datetime.strptime(date_from, "%Y-%m-%d")).days > 365:
        date_from = (datetime.strptime(date_to, "%Y-%m-%d") - timedelta(days=365)).strftime("%Y-%m-%d")   # one year max
    in_range = lambda dt: dt is not None and date_from <= _day(dt) <= date_to

    claims: list[Claim] = []
    for d in Collection("claims").all():
        try:
            claims.append(Claim.model_validate(d))
        except Exception:
            continue
    items = {i.id: i for i in jd2_store.all_items()}

    received = [c for c in claims if in_range(c.receivedAt)]
    open_all = [c for c in claims if c.status not in CLOSED]          # open now, whenever received

    # ---- funnel (tickets received in the period: how far each one got)
    funnel = [
        {"key": "received", "label": "Received", "count": len(received)},
        {"key": "documents", "label": "Documents in", "count": sum(1 for c in received if c.documents or c.jd1_saved_at or c.jd2_item_id)},
        {"key": "scanned", "label": "Scanned in JD1", "count": sum(1 for c in received if c.jd1_saved_at or c.jd2_item_id)},
        {"key": "sent", "label": "Sent to JD2", "count": sum(1 for c in received if c.jd2_item_id)},
        {"key": "decided", "label": "Decided", "count": sum(1 for c in received if c.status in DECIDED)},
    ]

    # ---- per day (received / sent to JD2 / decided), every day of the period
    start = datetime.strptime(date_from, "%Y-%m-%d")
    end = datetime.strptime(date_to, "%Y-%m-%d")
    span = (end - start).days + 1
    day_keys = [(start + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(span)]
    by_day = {k: {"day": k, "received": 0, "sent": 0, "decided": 0} for k in day_keys}
    for c in received:
        if _day(c.receivedAt) in by_day:
            by_day[_day(c.receivedAt)]["received"] += 1
    sent_hours, decide_hours, total_hours = [], [], []
    decided_in_range = {"approved": 0, "partially_approved": 0, "rejected": 0}
    for it in items.values():
        if in_range(it.created_at) and _day(it.created_at) in by_day:
            by_day[_day(it.created_at)]["sent"] += 1
        if it.decided_at and in_range(it.decided_at):
            if _day(it.decided_at) in by_day:
                by_day[_day(it.decided_at)]["decided"] += 1
            if it.status.value in decided_in_range:
                decided_in_range[it.status.value] += 1
            decide_hours.append(_hours(it.created_at, it.decided_at))
            t = next((c for c in claims if c.id == it.ticket_id), None)
            if t:
                total_hours.append(_hours(t.receivedAt, it.decided_at))
        if in_range(it.created_at):
            t = next((c for c in claims if c.id == it.ticket_id), None)
            if t:
                sent_hours.append(_hours(t.receivedAt, it.created_at))

    # ---- by insurer (received in the period)
    ins: dict[str, dict] = {}
    for c in received:
        k = c.insurer if c.insurer and c.insurer != "—" else "Unknown"
        r = ins.setdefault(k, {"insurer": k, "received": 0, "open": 0, "in_jd2": 0, "decided": 0, "approved": 0,
                               "amount_claimed": 0.0, "missing_docs": 0})
        r["received"] += 1
        r["open"] += c.status not in CLOSED
        r["in_jd2"] += bool(c.jd2_item_id) and c.status not in CLOSED
        r["decided"] += c.status in DECIDED
        r["approved"] += c.status in (Status.approved, Status.partially_approved)
        r["amount_claimed"] += c.amount or 0
        r["missing_docs"] += bool(c.checklist_missing)
    by_insurer = sorted(ins.values(), key=lambda r: (-r["received"], r["insurer"]))

    count_by = lambda attr, rows: sorted(
        ({"key": k, "count": n} for k, n in _counts(rows, attr).items()), key=lambda r: -r["count"])

    # ---- open work right now: ageing, who has it, what needs attention
    ages = {label: 0 for label, _ in AGE_BUCKETS}
    for c in open_all:
        h = _hours(c.receivedAt, now) or 0
        for label, limit in AGE_BUCKETS:
            if limit is None or h < limit * 24:
                ages[label] += 1
                break
    workload: dict[str, dict] = {}
    for c in open_all:
        k = c.assignee_username or (f"name:{c.assignee}" if c.assignee else "")
        r = workload.setdefault(k, {"username": c.assignee_username or "", "name": c.assignee or ("Unassigned" if not k else k),
                                    "assigned": bool(k), "open": 0, "in_jd2": 0})
        r["open"] += 1
        r["in_jd2"] += bool(c.jd2_item_id)
    attention = sorted(
        (c for c in open_all if not (c.jd2_item_id and items.get(c.jd2_item_id) and
                                     items[c.jd2_item_id].status.value != "pending")),
        key=lambda c: c.receivedAt)[:10]
    workload_rows = sorted(workload.values(), key=lambda r: (not r["assigned"], -r["open"]))

    out = {
        "range": {"date_from": date_from, "date_to": date_to, "days": span},
        "kpis": {
            "received": len(received),
            "open_now": len(open_all),
            "waiting_jd1": sum(1 for c in open_all if not c.jd2_item_id),
            "waiting_jd2": sum(1 for c in open_all if c.jd2_item_id),
            "awaiting_docs": sum(1 for c in open_all if c.status == Status.awaiting_docs or c.checklist_missing),
            "decided": sum(decided_in_range.values()),
            "approved": decided_in_range["approved"],
            "partially_approved": decided_in_range["partially_approved"],
            "rejected": decided_in_range["rejected"],
            "amount_claimed": round(sum(c.amount or 0 for c in received), 2),
            "unassigned_open": sum(1 for c in open_all if not c.assignee_username and not c.assignee),
        },
        "turnaround": {"to_jd2": _stat(sent_hours), "jd2_decision": _stat(decide_hours), "end_to_end": _stat(total_hours)},
        "funnel": funnel,
        "by_day": list(by_day.values()),
        "by_insurer": by_insurer,
        "by_status": count_by("status", received),
        "by_category": count_by("category", received),
        "by_channel": count_by("channel", received),
        "ageing": [{"label": k, "count": v} for k, v in ages.items()],
        "workload": workload_rows,
        "attention": [{
            "id": c.id, "reference": c.reference, "member": c.memberName, "insurer": c.insurer,
            "status": c.status.value, "received_at": c.receivedAt.isoformat(), "age_hours": round(_hours(c.receivedAt, now) or 0, 1),
            "assignee": c.assignee, "next_step": _next_step(c), "jd2_item_id": c.jd2_item_id,
            "missing": list(c.checklist_missing or []),
        } for c in attention],
        "ai": None,
        "activity": None,
    }

    role = user.get("role")
    if role in ("super_admin", "admin"):
        entries = usage.query(date_from=date_from, date_to=date_to, tz_offset_min=settings.app_tz_offset_min)
        cost = sum(e.get("cost_usd") or 0.0 for e in entries)
        ai = {
            "requests": len(entries),
            "failed": sum(1 for e in entries if not e.get("ok", True)),
            "tokens": usage.to_tokens(cost) or 0,               # client tokens (the unit users see)
            "users": len({e.get("user") for e in entries if e.get("user")}),
            "per_claim_tokens": usage.to_tokens(cost / len(received)) if received else None,
        }
        if role == "super_admin":
            ai["cost_usd"] = round(cost, 4)
            ai["per_claim_usd"] = round(cost / len(received), 4) if received else None
        out["ai"] = ai
        claim_actions = {"jd2_handoff", "jd2_decision", "delete_claim", "assign_claim", "ticket_reused", "create_ticket"}
        events = [e for e in audit.all_events() if role == "super_admin" or e.get("action") in claim_actions]
        out["activity"] = [
            {"at": e.get("at"), "by": e.get("by"), "action": e.get("action"), "detail": e.get("detail")}
            for e in events[:12]
        ]
    return out


def _counts(rows: list[Claim], attr: str) -> dict[str, int]:
    m: dict[str, int] = {}
    for c in rows:
        v = getattr(c, attr)
        k = v.value if hasattr(v, "value") else str(v or "—")
        m[k] = m.get(k, 0) + 1
    return m
