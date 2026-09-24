"""Who-can-assign-whom permission map: the acting officer's role -> the set of roles
they're allowed to assign a claim to. Firestore-backed with in-memory fallback (see
app/db.py), so it's shared across every officer rather than living per-browser.

Default is fully open (every role can assign to every role) so nothing changes for
existing users until a super admin actually visits Settings and tightens it."""
from app.db import Collection

_store = Collection("app_settings")
_DOC_ID = "assign_permissions"

_ALL_ROLES = ["super_admin", "admin", "user"]
_DEFAULT: dict[str, list[str]] = {r: list(_ALL_ROLES) for r in _ALL_ROLES}


def get_assign_permissions() -> dict[str, list[str]]:
    d = _store.get(_DOC_ID)
    if d and isinstance(d.get("permissions"), dict):
        # backfill any role missing from a saved-but-partial map, rather than erroring
        perms = dict(_DEFAULT)
        perms.update(d["permissions"])
        return perms
    return dict(_DEFAULT)


def save_assign_permissions(permissions: dict[str, list[str]]) -> dict[str, list[str]]:
    _store.put(_DOC_ID, {"permissions": permissions})
    return permissions
