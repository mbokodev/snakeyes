# ── Stage 1 : build du frontend ─────────────────────────────────────────────
FROM node:22-alpine AS frontend
WORKDIR /build
COPY webui/frontend/package*.json ./
RUN npm ci
COPY webui/frontend/ ./
RUN npm run build

# ── Stage 2 : runtime Python (API + statique + scraper pour Run now) ────────
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    TZ=America/Toronto \
    EBAY_DATA_DIR=/data \
    SCRAPER_DIR=/app/scraper \
    STATIC_DIR=/app/static

WORKDIR /app

COPY webui/backend/requirements.txt ./req-webui.txt
COPY ebay/requirements.txt ./req-scraper.txt
RUN pip install --no-cache-dir -r req-webui.txt -r req-scraper.txt

COPY webui/backend/app/ ./app/
COPY ebay/scrapper.py ebay/ebay_auth.py ./scraper/
COPY --from=frontend /build/dist ./static/

RUN mkdir -p /data

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
