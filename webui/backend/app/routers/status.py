"""Statut des configs + déclenchement manuel d'un run."""
import asyncio
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import yaml
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..files import (
    CACHE_DIR,
    CONFIG_DIR,
    STATUS_DIR,
    atomic_write,
    dump_yaml,
    parse_yaml,
    safe_config_path,
)

router = APIRouter()

SCRAPER_DIR = Path(os.environ.get("SCRAPER_DIR", "/app/scraper"))
RUN_TIMEOUT = int(os.environ.get("RUN_TIMEOUT", "180"))
LOCK_STALE_S = 300  # même valeur que le scraper

_run_locks: dict[str, asyncio.Lock] = {}
_procs: dict[str, asyncio.subprocess.Process] = {}
_stopped: set[str] = set()


def _entry(path: Path) -> dict:
    stem = path.stem

    enabled = True
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        if isinstance(data, dict):
            enabled = bool(data.get("enabled", True))
    except yaml.YAMLError:
        pass

    cache_file = CACHE_DIR / f"{stem}_cache.json"
    cache_size = cache_mtime = cache_items = None
    if cache_file.is_file():
        st = cache_file.stat()
        cache_size = st.st_size
        cache_mtime = datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).isoformat()
        try:
            cache_items = len(json.loads(cache_file.read_text() or "[]"))
        except (json.JSONDecodeError, OSError):
            pass

    lock_file = CACHE_DIR / f"{stem}_cache.lock"
    running = False
    if lock_file.exists():
        try:
            running = (time.time() - lock_file.stat().st_mtime) < LOCK_STALE_S
        except OSError:
            pass

    last_run = None
    status_file = STATUS_DIR / f"{stem}.json"
    if status_file.is_file():
        try:
            last_run = json.loads(status_file.read_text())
        except (json.JSONDecodeError, OSError):
            pass

    return {
        "name": path.name,
        "enabled": enabled,
        "running": running,
        "cache_size": cache_size,
        "cache_mtime": cache_mtime,
        "cache_items": cache_items,
        "last_run": last_run,
    }


@router.get("/status")
def get_status() -> list[dict]:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    return [_entry(p) for p in sorted(CONFIG_DIR.glob("*.yml"))]


@router.post("/status/{name}/run")
async def run_now(name: str):
    path = safe_config_path(name)
    lock = _run_locks.setdefault(path.stem, asyncio.Lock())
    if lock.locked():
        raise HTTPException(status_code=409, detail="Un run est déjà en cours pour cette config")
    async with lock:
        scraper = SCRAPER_DIR / "scrapper.py"
        if not scraper.is_file():
            raise HTTPException(status_code=500, detail=f"scrapper.py introuvable dans {SCRAPER_DIR}")
        proc = await asyncio.create_subprocess_exec(
            sys.executable, str(scraper), str(path),
            cwd=str(SCRAPER_DIR),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        _stopped.discard(path.stem)
        _procs[path.stem] = proc
        try:
            out, _ = await asyncio.wait_for(proc.communicate(), timeout=RUN_TIMEOUT)
        except asyncio.TimeoutError:
            proc.kill()
            raise HTTPException(status_code=504, detail=f"Timeout ({RUN_TIMEOUT}s) — run interrompu")
        finally:
            _procs.pop(path.stem, None)
        stopped = path.stem in _stopped
        _stopped.discard(path.stem)
        if stopped:
            # Le process tué n'a pas pu relâcher son lock fichier : on nettoie
            # pour ne pas afficher « En cours » pendant 5 min.
            (CACHE_DIR / f"{path.stem}_cache.lock").unlink(missing_ok=True)
        return {
            "ok": proc.returncode == 0,
            "stopped": stopped,
            "returncode": proc.returncode,
            "output": out.decode(errors="replace")[-4000:],
        }


@router.post("/status/{name}/stop")
async def stop_run(name: str):
    """Interrompt un run manuel en cours (lancé via « Lancer maintenant »)."""
    path = safe_config_path(name)
    proc = _procs.get(path.stem)
    if proc is None or proc.returncode is not None:
        raise HTTPException(status_code=409, detail="Aucun run manuel en cours pour cette config")
    _stopped.add(path.stem)
    proc.terminate()
    return {"ok": True}


class EnabledBody(BaseModel):
    enabled: bool


@router.put("/status/{name}/enabled")
def set_enabled(name: str, body: EnabledBody):
    """Active/désactive une config (clé YAML `enabled`, lue par run.sh au prochain cycle)."""
    path = safe_config_path(name)
    data = parse_yaml(path.read_text(encoding="utf-8"))
    data["enabled"] = body.enabled
    atomic_write(path, dump_yaml(data))
    return {"name": path.name, "enabled": body.enabled}
