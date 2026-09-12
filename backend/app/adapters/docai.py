"""Google Document AI (Form Parser) adapter — returns extracted form fields with
normalized bounding boxes + confidence, for the field-highlight review view.
Auth uses the Cloud Run runtime service account (ADC) — no key in code."""
from __future__ import annotations
import uuid
from app.config import settings
from app.models import ReviewResult, ReviewField, ReviewBox


def _text(doc_text: str, layout) -> str:
    ta = getattr(layout, "text_anchor", None)
    if not ta or not ta.text_segments:
        return ""
    out = []
    for seg in ta.text_segments:
        s = int(seg.start_index or 0); e = int(seg.end_index or 0)
        out.append(doc_text[s:e])
    return " ".join(out).strip().replace("\n", " ")


def _box(layout) -> ReviewBox:
    bp = getattr(layout, "bounding_poly", None) if layout else None
    verts = getattr(bp, "normalized_vertices", None) if bp else None
    if not verts:
        return ReviewBox()
    xs = [v.x for v in verts]; ys = [v.y for v in verts]
    x0, y0 = min(xs), min(ys)
    return ReviewBox(x=x0, y=y0, w=max(xs) - x0, h=max(ys) - y0)


def review(data: bytes, mime: str) -> ReviewResult:
    if not (settings.docai_processor_id and settings.docai_project):
        return ReviewResult(error="Document AI not configured (set DOCAI_PROJECT / DOCAI_PROCESSOR_ID).")
    try:
        from google.cloud import documentai_v1 as documentai
        from google.api_core.client_options import ClientOptions
    except Exception as e:
        return ReviewResult(error=f"documentai library not installed: {e}")
    try:
        opts = ClientOptions(api_endpoint=f"{settings.docai_location}-documentai.googleapis.com")
        client = documentai.DocumentProcessorServiceClient(client_options=opts)
        name = client.processor_path(settings.docai_project, settings.docai_location, settings.docai_processor_id)
        raw = documentai.RawDocument(content=data, mime_type=mime or "application/pdf")
        result = client.process_document(request=documentai.ProcessRequest(name=name, raw_document=raw))
        doc = result.document
    except Exception as e:
        return ReviewResult(error=f"Document AI error: {e}")

    fields: list[ReviewField] = []
    for pi, page in enumerate(doc.pages):
        for ff in page.form_fields:
            val_layout = getattr(ff.field_value, "layout", None) if ff.field_value else None
            name_layout = getattr(ff.field_name, "layout", None) if ff.field_name else None
            conf = float((val_layout.confidence if val_layout else 0.0) or (name_layout.confidence if name_layout else 0.0))
            fields.append(ReviewField(
                id=uuid.uuid4().hex[:8],
                name=_text(doc.text, name_layout) or "(field)",
                value=_text(doc.text, val_layout),
                confidence=conf,
                page=pi,
                box=_box(val_layout) if val_layout else _box(name_layout),
            ))
    return ReviewResult(pages=len(doc.pages), fields=fields, provider="docai")
