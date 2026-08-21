"""CRUD des configurations YAML — contrat attendu par le composant Bot."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..files import (
    CONFIG_DIR,
    atomic_write,
    dump_yaml,
    parse_yaml,
    safe_config_path,
)

router = APIRouter()


class RawBody(BaseModel):
    content: str


class CreateBody(BaseModel):
    name: str
    config: dict


class CreateRawBody(BaseModel):
    name: str
    content: str


@router.get("/configs")
def list_configs() -> list[str]:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    return sorted(p.name for p in CONFIG_DIR.glob("*.yml"))


@router.get("/configs/{name}")
def get_config(name: str) -> dict:
    path = safe_config_path(name)
    return parse_yaml(path.read_text(encoding="utf-8"))


@router.put("/configs/{name}")
def update_config(name: str, config: dict):
    path = safe_config_path(name)
    atomic_write(path, dump_yaml(config))
    return {"ok": True}


@router.get("/configs/{name}/raw")
def get_config_raw(name: str) -> dict:
    path = safe_config_path(name)
    return {"content": path.read_text(encoding="utf-8")}


@router.put("/configs/{name}/raw")
def update_config_raw(name: str, body: RawBody):
    path = safe_config_path(name)
    parse_yaml(body.content)  # validation → 422 si invalide
    atomic_write(path, body.content)
    return {"ok": True}


@router.post("/configs", status_code=201)
def create_config(body: CreateBody):
    path = safe_config_path(body.name, must_exist=False)
    if path.exists():
        raise HTTPException(status_code=409, detail="Le fichier existe déjà")
    atomic_write(path, dump_yaml(body.config))
    return {"ok": True}


@router.post("/configs/raw", status_code=201)
def create_config_raw(body: CreateRawBody):
    path = safe_config_path(body.name, must_exist=False)
    if path.exists():
        raise HTTPException(status_code=409, detail="Le fichier existe déjà")
    parse_yaml(body.content)
    atomic_write(path, body.content)
    return {"ok": True}


@router.delete("/configs/{name}")
def delete_config(name: str):
    path = safe_config_path(name)
    path.unlink()
    return {"ok": True}
