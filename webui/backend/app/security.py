"""HTTP Basic Auth middleware helpers.

Credentials come from UI_USERNAME / UI_PASSWORD env vars.
Set UI_AUTH_DISABLED=1 to bypass (local dev only).
"""
import base64
import os
import secrets

from starlette.responses import Response

USER = os.environ.get("UI_USERNAME", "")
PWD = os.environ.get("UI_PASSWORD", "")
DISABLED = os.environ.get("UI_AUTH_DISABLED") == "1"


def check_basic(auth_header: str | None) -> bool:
    if DISABLED:
        return True
    if not USER or not PWD:
        return False  # auth required but not configured → deny everything
    if not auth_header or not auth_header.startswith("Basic "):
        return False
    try:
        user, _, pwd = base64.b64decode(auth_header[6:]).decode().partition(":")
    except Exception:
        return False
    return secrets.compare_digest(user, USER) and secrets.compare_digest(pwd, PWD)


def unauthorized() -> Response:
    return Response(
        status_code=401,
        headers={"WWW-Authenticate": 'Basic realm="ebay-webui"'},
    )
