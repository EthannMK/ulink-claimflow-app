"""User store — Firestore-backed with in-memory fallback (see app/db.py).
Users (and password changes) persist across redeploys when Firestore is available."""
import uuid
from app.hashing import hash_password
from app.db import Collection

_users = Collection("users")


def _mk(username, name, email, role, password, usage_cap_usd=None, daily_cap_usd=None):
    return {"id": str(uuid.uuid4()), "username": username, "name": name, "email": email,
            "role": role, "active": True, "password_hash": hash_password(password),
            "usage_cap_usd": usage_cap_usd, "usage_spent_usd": 0.0,
            "daily_cap_usd": daily_cap_usd, "usage_day": "", "usage_day_spent_usd": 0.0}


def _seed():
    """Create the default accounts only if the store is empty (first run)."""
    if not _users.empty():
        return
    import os
    seed = [_mk("superadmin", "Super Admin", "super@ulink.com", "super_admin", "super123")]
    if not os.getenv("K_SERVICE"):          # local development only — never on Cloud Run
        seed += [_mk("admin", "Normal Admin", "admin@ulink.com", "admin", "admin123"),
                 _mk("jd1", "Aung Ko (JD1)", "aung@ulink.com", "user", "user123")]
    for u in seed:
        _users.put(u["username"], u)


_seed()


def get_by_username(username: str):
    return _users.get(username)


def get_by_id(uid: str):
    return next((u for u in _users.all() if u["id"] == uid), None)


def get_by_name(name: str):
    """Look up a user by their display name — the assign picker stores the NAME, not the id."""
    return next((u for u in _users.all() if u["name"] == name), None)


def list_users():
    return _users.all()


def create_user(username, name, email, role, password, usage_cap_usd=None, daily_cap_usd=None):
    if _users.get(username):
        return None
    u = _mk(username, name, email, role, password, usage_cap_usd, daily_cap_usd)
    _users.put(username, u)
    return u


def update_user(uid: str, **fields):
    u = get_by_id(uid)
    if not u:
        return None
    if fields.get("password"):
        u["password_hash"] = hash_password(fields.pop("password"))
    else:
        fields.pop("password", None)
    if fields.pop("clear_usage_cap", False):
        u["usage_cap_usd"] = None
    if fields.pop("clear_daily_cap", False):
        u["daily_cap_usd"] = None
    if fields.pop("reset_usage", False):
        u["usage_spent_usd"] = 0.0
        u["usage_day_spent_usd"] = 0.0
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
