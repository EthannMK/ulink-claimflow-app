"""Who can a claim be assigned to, and keeping the JD2 item and its Inbox ticket in sync.

Every role can open the assignee list (it only holds names, usernames and roles), filtered by
the Settings → Assignment permissions map (acting role -> roles it may assign to). Assignments
are stored by USERNAME (unique) with the display name alongside for showing on screen."""
from __future__ import annotations
from fastapi import HTTPException
from app import store, access_settings
from app.db import Collection


def _allowed_roles(user: dict) -> list[str]:
    return access_settings.get_assign_permissions().get(user.get("role", ""), [])


def assignable_users(user: dict) -> list[dict]:
    allowed = _allowed_roles(user)
    out = [{"username": u["username"], "name": u.get("name") or u["username"], "role": u.get("role", "")}
           for u in store.list_users() if u.get("active", True) and u.get("role") in allowed]
    return sorted(out, key=lambda x: x["name"].lower())


def resolve(user: dict, target: str) -> tuple[str | None, str | None]:
    """target = username (or, for old data, a display name); empty clears the assignment.
    Returns (username, display name). Raises 404 / 403 like the old endpoint."""
    t = (target or "").strip()
    if not t:
        return None, None
    u = store.get_by_username(t) or store.get_by_name(t)
    if not u or not u.get("active", True):
        raise HTTPException(status_code=404, detail="No such active user")
    if u.get("role") not in _allowed_roles(user):
        raise HTTPException(status_code=403, detail="Your role is not permitted to assign claims to that team member")
    return u["username"], (u.get("name") or u["username"])


def sync_ticket(jd2_item_id: str, ticket_id: str | None, **fields) -> None:
    """Copy fields onto the Inbox ticket(s) linked to this JD2 item."""
    claims = Collection("claims")
    for c in claims.all():
        if c.get("jd2_item_id") == jd2_item_id or (ticket_id and c.get("id") == ticket_id):
            c.update(fields)
            claims.put(c["id"], c)


def sync_jd2(jd2_item_id: str | None, **fields) -> None:
    """Copy fields onto the JD2 item linked to a ticket."""
    if not jd2_item_id:
        return
    items = Collection("jd2_items")
    d = items.get(jd2_item_id)
    if d:
        d.update(fields)
        items.put(jd2_item_id, d)
