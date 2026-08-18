"""In-memory user store for the POC. Swap for PostgreSQL later (same function signatures)."""
import uuid
from app.hashing import hash_password

def _mk(username, name, email, role, password):
    return {"id": str(uuid.uuid4()), "username": username, "name": name, "email": email,
            "role": role, "active": True, "password_hash": hash_password(password)}

USERS: dict[str, dict] = {}
for u in [
    _mk("superadmin", "Super Admin", "super@ulink.com", "super_admin", "super123"),
    _mk("admin", "Normal Admin", "admin@ulink.com", "admin", "admin123"),
    _mk("jd1", "Aung Ko (JD1)", "aung@ulink.com", "user", "user123"),
]:
    USERS[u["username"]] = u

def get_by_username(username: str):
    return USERS.get(username)

def get_by_id(uid: str):
    return next((u for u in USERS.values() if u["id"] == uid), None)

def list_users():
    return list(USERS.values())

def create_user(username, name, email, role, password):
    if username in USERS:
        return None
    USERS[username] = _mk(username, name, email, role, password)
    return USERS[username]

def update_user(uid: str, **fields):
    u = get_by_id(uid)
    if not u:
        return None
    if fields.get("password"):
        u["password_hash"] = hash_password(fields.pop("password"))
    for k, v in fields.items():
        if v is not None:
            u[k] = v
    return u

def delete_user(uid: str):
    u = get_by_id(uid)
    if u:
        del USERS[u["username"]]
    return bool(u)
