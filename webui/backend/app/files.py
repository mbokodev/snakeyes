"""Config file helpers: path validation (anti path-traversal) and atomic YAML writes."""
import os
import re
import tempfile
from pathlib import Path

import yaml
from fastapi import HTTPException

DATA_DIR = Path(os.environ.get("EBAY_DATA_DIR", "/data"))
CONFIG_DIR = Path(os.environ.get("CONFIG_DIR", str(DATA_DIR / "configs")))
STATUS_DIR = Path(os.environ.get("STATUS_DIR", str(DATA_DIR / "status")))
CACHE_DIR = DATA_DIR / "cache"
LOG_DIR = Path(os.environ.get("LOG_DIR", str(DATA_DIR / "logs")))

_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


def normalize_name(name: str) -> str:
    return name if name.endswith(".yml") else f"{name}.yml"


def safe_config_path(name: str, must_exist: bool = True) -> Path:
    name = normalize_name(name)
    stem = name[:-4]
    if not _NAME_RE.match(stem) or ".." in name or "/" in name or "\\" in name:
        raise HTTPException(status_code=400, detail="Nom de fichier invalide")
    path = (CONFIG_DIR / name).resolve()
    if not path.is_relative_to(CONFIG_DIR.resolve()):
        raise HTTPException(status_code=400, detail="Nom de fichier invalide")
    if must_exist and not path.is_file():
        raise HTTPException(status_code=404, detail=f"Configuration '{name}' introuvable")
    return path


def atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(content)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except Exception:
        Path(tmp).unlink(missing_ok=True)
        raise


def parse_yaml(content: str) -> dict:
    try:
        data = yaml.safe_load(content)
    except yaml.YAMLError as e:
        raise HTTPException(status_code=422, detail=f"YAML invalide : {e}")
    if not isinstance(data, dict):
        raise HTTPException(status_code=422, detail="YAML invalide : le document doit être un objet")
    return data


def dump_yaml(data: dict) -> str:
    return yaml.safe_dump(
        data,
        sort_keys=False,
        allow_unicode=True,
        default_flow_style=False,
        width=10000,
    )
