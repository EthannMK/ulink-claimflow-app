from fastapi import APIRouter
from app import db, storage
router = APIRouter()

@router.get("/health")
def health():
    return {"status": "ok"}

@router.get("/health/storage")
def health_storage():
    """Diagnostic: are Firestore + Cloud Storage active, or in-memory fallback?
    If db=memory, users/tickets reset on redeploy (grant roles/datastore.user).
    If files=memory, uploaded documents reset (set GCS_BUCKET + grant storage.objectAdmin)."""
    return {"db": db.mode(), "files": storage.mode()}
