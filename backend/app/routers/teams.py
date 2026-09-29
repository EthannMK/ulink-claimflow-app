"""Teams — stored on the server (shared by everyone, survives refresh/devices).
Anyone signed in can view; only Super Admin can create/change/delete. Members and
the lead are usernames."""
import uuid
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from app.db import Collection
from app.models import Role
from app.security import get_current_user, require_role
from app import store, audit

router = APIRouter(prefix="/api/teams", tags=["teams"])
_teams = Collection("teams")


class TeamIn(BaseModel):
    name: str
    lead: str = ""
    members: list[str] = []


def _clean(t: TeamIn) -> dict:
    name = t.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Team name is required")
    known = {u["username"] for u in store.list_users()}
    members = sorted({m for m in t.members if m in known})
    lead = t.lead if t.lead in members else ""
    return {"name": name[:80], "lead": lead, "members": members}


def _name_taken(name: str, except_id: str = "") -> bool:
    return any(x.get("name", "").strip().lower() == name.lower() and x.get("id") != except_id for x in _teams.all())


@router.get("")
def list_teams(user=Depends(get_current_user)):
    return sorted(_teams.all(), key=lambda t: t.get("name", "").lower())


@router.post("")
def create_team(body: TeamIn, user=Depends(require_role(Role.super_admin))):
    data = _clean(body)
    if _name_taken(data["name"]):
        raise HTTPException(status_code=409, detail="A team with this name already exists")
    t = {"id": uuid.uuid4().hex[:12], **data}
    _teams.put(t["id"], t)
    audit.record("team_create", user.get("name") or user["username"], detail=f"Created team {t['name']}", ref=t["id"])
    return t


@router.put("/{team_id}")
def update_team(team_id: str, body: TeamIn, user=Depends(require_role(Role.super_admin))):
    if not _teams.get(team_id):
        raise HTTPException(status_code=404, detail="Team not found")
    data = _clean(body)
    if _name_taken(data["name"], team_id):
        raise HTTPException(status_code=409, detail="A team with this name already exists")
    t = {"id": team_id, **data}
    _teams.put(team_id, t)
    audit.record("team_update", user.get("name") or user["username"],
                 detail=f"Updated team {t['name']} ({len(t['members'])} members)", ref=team_id)
    return t


@router.delete("/{team_id}")
def delete_team(team_id: str, user=Depends(require_role(Role.super_admin))):
    t = _teams.get(team_id)
    if not t:
        raise HTTPException(status_code=404, detail="Team not found")
    _teams.delete(team_id)
    audit.record("team_delete", user.get("name") or user["username"], detail=f"Deleted team {t.get('name', '')}", ref=team_id)
    return {"deleted": True}


def remove_member_everywhere(username: str) -> None:
    """Called when a user is deleted."""
    for t in _teams.all():
        if username in t.get("members", []) or t.get("lead") == username:
            t["members"] = [m for m in t.get("members", []) if m != username]
            if t.get("lead") == username:
                t["lead"] = ""
            _teams.put(t["id"], t)
