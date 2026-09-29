from fastapi import APIRouter, Depends, HTTPException
from app import store, usage, audit
from app.models import User, UserCreate, UserUpdate, Role, PasswordChange
from app.security import get_current_user, require_role
from app.hashing import verify_password

router = APIRouter(prefix="/api", tags=["users"])

# Seeded demo passwords — a user still on one of these is warned to change it.
_DEFAULT_PASSWORDS = {"superadmin": "super123", "admin": "admin123", "jd1": "user123"}


def _pub(u: dict, show_usd: bool = True) -> User:
    """show_usd=False for anyone but the Super Admin — they never receive dollar amounts."""
    if not show_usd:
        return User(id=u["id"], username=u["username"], name=u["name"], email=u["email"], role=Role(u["role"]),
                    active=u["active"], usage_cap_usd=None, usage_spent_usd=0.0, daily_cap_usd=None, usage_today_usd=0.0)
    return User(id=u["id"], username=u["username"], name=u["name"], email=u["email"], role=Role(u["role"]),
                active=u["active"], usage_cap_usd=u.get("usage_cap_usd"),
                usage_spent_usd=float(u.get("usage_spent_usd") or 0.0),
                daily_cap_usd=u.get("daily_cap_usd"), usage_today_usd=usage.today_spent(u))


def _by(user: dict) -> str:
    return user.get("name") or user.get("username", "")


def _active_super_admins(exclude_id: str = "") -> int:
    return sum(1 for u in store.list_users() if u["role"] == "super_admin" and u["active"] and u["id"] != exclude_id)


@router.get("/me", response_model=User)
def me(user=Depends(get_current_user)):
    return _pub(user, user.get("role") == "super_admin")


@router.get("/me/security")
def my_security(user=Depends(get_current_user)):
    """Tells the app whether this account still uses its well-known seeded password."""
    default = _DEFAULT_PASSWORDS.get(user["username"])
    return {"default_password": bool(default and verify_password(default, user["password_hash"]))}


@router.post("/me/password")
def change_my_password(body: PasswordChange, user=Depends(get_current_user)):
    if not verify_password(body.current_password, user["password_hash"]):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if len(body.new_password) < 8:
        raise HTTPException(status_code=400, detail="New password must be at least 8 characters")
    store.update_user(user["id"], password=body.new_password)
    audit.record("password_change", _by(user), detail="Changed own password", ref=user["id"])
    return {"ok": True}


# admin and super_admin can view users
@router.get("/users", response_model=list[User])
def list_users(me_=Depends(require_role(Role.admin, Role.super_admin))):
    sa = me_.get("role") == "super_admin"
    return sorted((_pub(u, sa) for u in store.list_users()), key=lambda x: x.name.lower())


# only super_admin can manage users
@router.post("/users", response_model=User)
def create_user(body: UserCreate, me_=Depends(require_role(Role.super_admin))):
    if not body.username.strip() or not body.name.strip():
        raise HTTPException(status_code=400, detail="Username and name are required")
    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    for v in (body.usage_cap_usd, body.daily_cap_usd):
        if v is not None and v < 0:
            raise HTTPException(status_code=400, detail="AI limits must be 0 or more")
    u = store.create_user(body.username.strip(), body.name.strip(), body.email.strip(), body.role.value, body.password,
                          body.usage_cap_usd, body.daily_cap_usd)
    if not u:
        raise HTTPException(status_code=409, detail="Username already exists")
    audit.record("user_create", _by(me_), detail=f"Created {u['username']} ({u['role']})", ref=u["id"])
    return _pub(u)


@router.put("/users/{uid}", response_model=User)
def update_user(uid: str, body: UserUpdate, me_=Depends(require_role(Role.super_admin))):
    target = store.get_by_id(uid)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    fields = body.model_dump(exclude_unset=True)
    for k in ("usage_cap_usd", "daily_cap_usd"):
        if fields.get(k) is not None and fields[k] < 0:
            raise HTTPException(status_code=400, detail="AI limits must be 0 or more")
    if fields.get("password") is not None and len(fields["password"]) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    if "role" in fields and fields["role"] is not None:
        fields["role"] = fields["role"].value if hasattr(fields["role"], "value") else fields["role"]
    # never lock the system out of super-admin access
    demoting = fields.get("role") not in (None, "super_admin") and target["role"] == "super_admin"
    disabling = fields.get("active") is False and target["active"]
    if uid == me_["id"] and (demoting or disabling):
        raise HTTPException(status_code=400, detail="You can't remove your own Super Admin access or disable yourself")
    if target["role"] == "super_admin" and (demoting or disabling) and _active_super_admins(exclude_id=uid) == 0:
        raise HTTPException(status_code=400, detail="There must always be at least one active Super Admin")
    u = store.update_user(uid, **fields)
    what = ", ".join(("password reset" if k == "password" else k) for k in fields)
    audit.record("user_update", _by(me_), detail=f"Updated {u['username']}: {what or 'no change'}", ref=uid)
    return _pub(u)


@router.delete("/users/{uid}")
def delete_user(uid: str, me_=Depends(require_role(Role.super_admin))):
    target = store.get_by_id(uid)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if uid == me_["id"]:
        raise HTTPException(status_code=400, detail="You can't delete your own account")
    if target["role"] == "super_admin" and _active_super_admins(exclude_id=uid) == 0:
        raise HTTPException(status_code=400, detail="There must always be at least one active Super Admin")
    store.delete_user(uid)
    from app.routers.teams import remove_member_everywhere
    remove_member_everywhere(target["username"])
    audit.record("user_delete", _by(me_), detail=f"Deleted {target['username']} ({target['role']})", ref=uid)
    return {"deleted": True}
