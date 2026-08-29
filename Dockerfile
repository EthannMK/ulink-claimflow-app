# Ulink ClaimFlow — single container: builds the React frontend and serves it from FastAPI.
# One Cloud Run URL = the web app + the API.

# ---- stage 1: build the frontend ----
FROM node:20-slim AS frontend
WORKDIR /fe
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
# same-origin backend: no API base URL, mocks off
ENV VITE_USE_MOCKS=false
RUN npm run build            # outputs /fe/dist

# ---- stage 2: python API that also serves the built frontend ----
FROM python:3.12-slim
WORKDIR /app
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app ./app
COPY --from=frontend /fe/dist ./static
ENV PORT=8080
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
