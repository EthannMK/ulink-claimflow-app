"""User store — Firestore-backed with in-memory fallback (see app/db.py).
Users (and password changes) persist across redeploys when Firestore is available."""
import uuid
from app.hashing import hash_password
from app.db import Collection

_users = Collection("users")


def _mk(username, name, email, role, password):
    return {"id": str(uuid.uuid4()), "username": username, "name": name, "email": email,
            "role": role, "active": True, "password_hash": hash_password(password)}


def _seed():
    """Create the default accounts only if the store is empty (first run)."""
    if not _users.empty():
        return
    for u in [
        _mk("superadmin", "Super Admin", "super@ulink.com", "super_admin", "super123"),
        _mk("admin", "Normal Admin", "admin@ulink.com", "admin", "admin123"),
        _mk("jd1", "Aung Ko (JD1)", "aung@ulink.com", "user", "user123"),
    ]:
        _users.put(u["username"], u)


_seed()


def get_by_username(username: str):
    return _users.get(username)


def get_by_id(uid: str):
    return next((u for u in _users.all() if u["id"] == uid), None)


def list_users():
    return _users.all()


def create_user(username, name, email, role, password):
    if _users.get(username):
        return None
    u = _mk(username, name, email, role, password)
    _users.put(username, u)
    return u


def update_user(uid: str, **fields):
    u = get_by_id(uid)
    if not u:
        return None
    if fields.get("password"):
        u["password_hash"] = hash_password(fields.pop("password"))
    for k, v in fields.items():
        if v is not None:
            u[k] = v
    _users.put(u["username"], u)
    return u


def delete_user(uid: str):
    u = get_by_id(uid)
    if u:
        _users.delete(u["username"])
    return bool(u)
