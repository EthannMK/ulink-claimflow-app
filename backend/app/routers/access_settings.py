"""Settings-driven access control — currently just the who-can-assign-whom map used by
the JD2 assign endpoint. Any signed-in user can READ it (the JD2 page needs it to know
which teammates the current officer may pick), but only a super admin can change it."""
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from app.models import Role
from app.security import get_current_user, require_role
from app import access_settings

router = APIRouter(prefix="/api/settings", tags=["settings"])


class AssignPermissions(BaseModel):
    permissions: dict[str, list[str]]


@router.get("/assign-permissions", response_model=AssignPermissions)
def get_assign_permissions(user=Depends(get_current_user)):
    return AssignPermissions(permissions=access_settings.get_assign_permissions())


@router.put("/assign-permissions", response_model=AssignPermissions)
def update_assign_permissions(body: AssignPermissions, user=Depends(require_role(Role.super_admin))):
    return AssignPermissions(permissions=access_settings.save_assign_permissions(body.permissions))


class Consistency(BaseModel):
    enabled: bool = True
    fields: list[str] = ["name"]


@router.get("/consistency", response_model=Consistency)
def get_consistency(user=Depends(get_current_user)):
    """Which fields the Document review screen checks across pages (handwriting variants)."""
    return Consistency(**access_settings.get_consistency())


@router.put("/consistency", response_model=Consistency)
def update_consistency(body: Consistency, user=Depends(require_role(Role.super_admin))):
    from app import audit
    saved = access_settings.save_consistency(body.enabled, body.fields)
    audit.record("consistency_settings", user.get("name") or user.get("username", ""),
                 detail=f"Cross-page check {'on' if saved['enabled'] else 'off'}: {', '.join(saved['fields']) or 'no fields'}")
    return Consistency(**saved)
