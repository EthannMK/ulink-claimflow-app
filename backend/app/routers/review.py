import hashlib
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from app.models import ReviewResult
from app.security import get_current_user
from app.adapters.docai import review as docai_review

router = APIRouter(prefix="/api", tags=["review"])

# Cache by content hash so identical documents never re-hit (re-bill) Document AI.
# In-memory (per instance); fine for the POC. Capped to avoid unbounded growth.
_CACHE: dict[str, ReviewResult] = {}
_MAX = 200

@router.post("/review", response_model=ReviewResult)
async def review(file: UploadFile = File(...), user=Depends(get_current_user)):
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    key = hashlib.sha256(data).hexdigest()
    cached = _CACHE.get(key)
    if cached is not None:
        return cached
    result = docai_review(data, file.content_type or "application/pdf")
    if not result.error:              # only cache successful results
        if len(_CACHE) >= _MAX:
            _CACHE.pop(next(iter(_CACHE)))
        _CACHE[key] = result
    return result
