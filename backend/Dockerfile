# Ulink ClaimFlow API — container for Google Cloud Run
FROM python:3.12-slim

WORKDIR /app

# system deps kept minimal; pypdf/httpx are pure-python wheels
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# Cloud Run injects PORT (default 8080). Bind to 0.0.0.0.
ENV PORT=8080
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
