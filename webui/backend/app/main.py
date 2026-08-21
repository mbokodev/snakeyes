"""eBay CA scraper — WebUI (API + SPA statique), protégée par HTTP Basic."""
import os
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles

from .routers import configs, status
from .security import check_basic, unauthorized

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware("http")
async def basic_auth_middleware(request: Request, call_next):
    if not check_basic(request.headers.get("authorization")):
        return unauthorized()
    return await call_next(request)


app.include_router(configs.router, prefix="/api")
app.include_router(status.router, prefix="/api")

# Montage du SPA en DERNIER pour ne pas masquer /api.
STATIC_DIR = Path(os.environ.get("STATIC_DIR", "static"))
if STATIC_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="spa")
