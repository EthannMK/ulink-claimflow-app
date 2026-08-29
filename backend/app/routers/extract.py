"""AI extraction preview: upload a policy / rules / Table-of-Benefits document and get
back structured rows the admin can review before adding them to Settings."""
import base64, json, re
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from app.config import settings
from app.security import get_current_user
from app.adapters.jd1 import pdf_text_and_pages, is_pdf

router = APIRouter(prefix="/api", tags=["extract"])

PROMPTS = {
    "rules": (
        "You are reading an insurance policy / rules document. Extract the concrete ADJUDICATION RULES a claims "
        "officer or AI would apply. Return STRICT JSON: {\"items\":[{\"name\":\"short title\","
        "\"category\":\"Eligibility|Documentation|Coverage|Payment|Fraud|Waiting period\","
        "\"condition\":\"the WHEN part\",\"action\":\"the THEN part / how to apply\"}]}. "
        "Only include real rules present in the document. If none, return {\"items\":[]}."
    ),
    "benefits": (
        "You are reading a Table of Benefits. Extract each benefit line. Return STRICT JSON: "
        "{\"items\":[{\"name\":\"benefit\",\"category\":\"Inpatient|Outpatient|Day Care|Maternity|Dental|Optical|Chronic|Other\","
        "\"limit\":\"amount/limit\",\"subLimit\":\"sub-limit if any\",\"waiting\":\"waiting period if any\","
        "\"copay\":\"co-pay if any\"}]}. Only real rows from the document. If none, return {\"items\":[]}."
    ),
}

@router.post("/extract")
async def extract(kind: str = Form(...), file: UploadFile = File(...), user=Depends(get_current_user)):
    if kind not in PROMPTS:
        raise HTTPException(status_code=400, detail="kind must be 'rules' or 'benefits'")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    if not (settings.ocr_provider == "gemini" and settings.gemini_api_key):
        raise HTTPException(status_code=503, detail="AI extraction needs a Gemini API key (OCR_PROVIDER=gemini).")

    name = file.filename or "file"
    mime = file.content_type or ""
    parts = [{"text": PROMPTS[kind]}]
    text = ""
    if is_pdf(name, mime):
        text, _ = pdf_text_and_pages(data)
    if len(text.strip()) > 200:
        parts.append({"text": f"[DOCUMENT TEXT]\n{text[:15000]}"})
    elif len(data) <= 18_000_000:
        parts.append({"inline_data": {"mime_type": mime or "application/pdf", "data": base64.b64encode(data).decode()}})
    else:
        raise HTTPException(status_code=413, detail="File too large to process in the POC.")

    import httpx
    url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
           f"{settings.gemini_model}:generateContent?key={settings.gemini_api_key}")
    try:
        r = httpx.post(url, json={"contents": [{"parts": parts}]}, timeout=120)
        r.raise_for_status()
        txt = r.json()["candidates"][0]["content"]["parts"][0]["text"]
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"Gemini HTTP {e.response.status_code}: {e.response.text[:300]}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Gemini error: {e}")

    m = re.search(r"\{.*\}", txt, re.S)
    try:
        d = json.loads(m.group(0) if m else txt)
        items = d.get("items", [])
        if not isinstance(items, list):
            items = []
    except Exception:
        items = []
    return {"items": items, "count": len(items)}
