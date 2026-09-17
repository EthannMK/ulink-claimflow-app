from fastapi import APIRouter, Depends, HTTPException
from app.security import get_current_user
from app import audit

router = APIRouter(prefix="/api", tags=["audit"])


@router.get("/audit")
def list_audit(user=Depends(get_current_user)):
    if user.get("role") not in ("super_admin", "admin"):
        raise HTTPException(status_code=403, detail="Not enough permissions")
    return {"items": audit.all_events()}
