from fastapi import APIRouter, Depends, HTTPException
from app import store
from app.models import User, UserCreate, UserUpdate, Role, PasswordChange
from app.security import get_current_user, require_role
from app.hashing import verify_password

router = APIRouter(prefix="/api", tags=["users"])

def _pub(u: dict) -> User:
    return User(id=u["id"], username=u["username"], name=u["name"], email=u["email"], role=Role(u["role"]), active=u["active"])

@router.get("/me", response_model=User)
def me(user=Depends(get_current_user)):
    return _pub(user)

@router.post("/me/password")
def change_my_password(body: PasswordChange, user=Depends(get_current_user)):
    if not verify_password(body.current_password, user["password_hash"]):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if len(body.new_password) < 6:
        raise HTTPException(status_code=400, detail="New password must be at least 6 characters")
    store.update_user(user["id"], password=body.new_password)
    return {"ok": True}

# admin and super_admin can view users
@router.get("/users", response_model=list[User])
def list_users(_=Depends(require_role(Role.admin, Role.super_admin))):
    return [_pub(u) for u in store.list_users()]

# only super_admin can manage users
@router.post("/users", response_model=User)
def create_user(body: UserCreate, _=Depends(require_role(Role.super_admin))):
    u = store.create_user(body.username, body.name, body.email, body.role.value, body.password)
    if not u:
        raise HTTPException(status_code=409, detail="Username already exists")
    return _pub(u)

@router.put("/users/{uid}", response_model=User)
def update_user(uid: str, body: UserUpdate, _=Depends(require_role(Role.super_admin))):
    fields = body.model_dump(exclude_unset=True)
    if "role" in fields and fields["role"] is not None:
        fields["role"] = fields["role"].value if hasattr(fields["role"], "value") else fields["role"]
    u = store.update_user(uid, **fields)
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    return _pub(u)

@router.delete("/users/{uid}")
def delete_user(uid: str, _=Depends(require_role(Role.super_admin))):
    if not store.delete_user(uid):
        raise HTTPException(status_code=404, detail="User not found")
    return {"deleted": True}
