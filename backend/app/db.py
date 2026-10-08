"""Optional Firestore persistence with a safe in-memory fallback.

If a Firestore database is reachable, collections are stored there and survive
redeploys. If it is not (API not enabled, no credentials, network error), every
operation degrades to an in-memory dict so the app still starts and works — it
just won't persist across restarts. Set USE_FIRESTORE=0 to force in-memory.

Which database:
  GOOGLE_CLOUD_PROJECT (or VERTEX_PROJECT)  the GCP project — needed on a laptop,
                                            auto-detected on Cloud Run
  FIRESTORE_DATABASE                        default "(default)" (production); use a
                                            separate one (e.g. "claimflow-dev") for
                                            local testing so test data never mixes
                                            with the live site
If Firestore can't be reached the reason is written to the server log.
"""
from __future__ import annotations
import logging
import os

_MODE: str | None = None      # "firestore" | "memory"
_DB = None
_log = logging.getLogger("claimflow.db")


def project_id() -> str | None:
    return (os.getenv("GOOGLE_CLOUD_PROJECT") or os.getenv("VERTEX_PROJECT") or "").strip() or None


def database_id() -> str:
    return (os.getenv("FIRESTORE_DATABASE") or "(default)").strip()


def _probe() -> None:
    global _MODE, _DB
    if _MODE is not None:
        return
    if os.getenv("USE_FIRESTORE", "1").lower() not in ("1", "true", "yes"):
        _MODE = "memory"
        return
    try:
        from google.cloud import firestore
        db = firestore.Client(project=project_id(), database=database_id())
        # Force a real round-trip so a misconfig fails here (and we fall back) rather than later.
        list(db.collection("_healthcheck").limit(1).stream())
        _DB = db
        _MODE = "firestore"
        _log.info("Firestore connected: project=%s database=%s", db.project, database_id())
    except Exception as e:
        _MODE = "memory"
        _log.warning("Firestore NOT available (project=%s database=%s) — using memory, data will NOT be saved: %s",
                     project_id(), database_id(), str(e)[:300])


def mode() -> str:
    _probe()
    return _MODE or "memory"


def is_firestore() -> bool:
    return mode() == "firestore"


# In-memory fallback storage, shared by collection NAME rather than by Collection
# instance. Different routers each create their own Collection("claims") — without
# this, every instance got its own empty dict and writes from one router were
# invisible to another (the cause of tickets never syncing status/assignee across
# routers when running without Firestore).
_MEM_STORES: dict[str, dict[str, dict]] = {}


import threading
_COUNTER_LOCK = threading.Lock()


def next_counter(key: str) -> int:
    """A number that only goes up (1, 2, 3 …) for `key`, safe across requests and — on
    Firestore — across Cloud Run instances (transaction). Used for ticket numbers so a
    deleted ticket's number is never given out again and two scans never get the same one."""
    with _COUNTER_LOCK:
        mem = _MEM_STORES.setdefault("_counters", {})
        if is_firestore():
            try:
                from google.cloud import firestore
                ref = _DB.collection("_counters").document(key)

                @firestore.transactional
                def _inc(tx):
                    snap = ref.get(transaction=tx)
                    n = int((snap.to_dict() or {}).get("n", 0)) + 1 if snap.exists else 1
                    tx.set(ref, {"n": n})
                    return n
                n = _inc(_DB.transaction())
                mem[key] = {"n": n}
                return n
            except Exception as e:
                _log.warning("counter %s: Firestore transaction failed, using memory: %s", key, str(e)[:200])
        n = int(mem.get(key, {}).get("n", 0)) + 1
        mem[key] = {"n": n}
        return n


class Collection:
    """A dict-of-dicts keyed by document id, backed by Firestore or memory.
    Every Firestore call is guarded — on any error it uses the in-memory shadow,
    so a store operation never raises up into a request handler."""

    def __init__(self, name: str):
        self.name = name
        self.mem = _MEM_STORES.setdefault(name, {})

    def get(self, doc_id: str) -> dict | None:
        if is_firestore():
            try:
                d = _DB.collection(self.name).document(doc_id).get()
                return d.to_dict() if d.exists else None
            except Exception:
                return self.mem.get(doc_id)
        return self.mem.get(doc_id)

    def put(self, doc_id: str, data: dict) -> dict:
        self.mem[doc_id] = data
        if is_firestore():
            try:
                _DB.collection(self.name).document(doc_id).set(data)
            except Exception:
                pass
        return data

    def all(self) -> list[dict]:
        if is_firestore():
            try:
                return [d.to_dict() for d in _DB.collection(self.name).stream()]
            except Exception:
                return list(self.mem.values())
        return list(self.mem.values())

    def delete(self, doc_id: str) -> None:
        self.mem.pop(doc_id, None)
        if is_firestore():
            try:
                _DB.collection(self.name).document(doc_id).delete()
            except Exception:
                pass

    def empty(self) -> bool:
        return len(self.all()) == 0
