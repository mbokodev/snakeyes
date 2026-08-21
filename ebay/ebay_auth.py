"""
eBay OAuth2 Authentication Module
Handles the complete OAuth flow: authorization, token exchange, and refresh.

Designed for concurrent use from multiple scraper instances on a NAS share:
- File locking prevents race conditions on tokens.json
- "Check-after-lock" pattern avoids redundant refreshes
- Atomic writes prevent NAS file corruption
"""

import requests
import base64
import json
import os
import stat
import tempfile
import time
import urllib.parse
import webbrowser
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
from pathlib import Path

# File paths
SCRIPT_DIR = Path(__file__).resolve().parent


# ---------------------------------------------------------------------------
# Environment loading — credentials live in <script_dir>/.env (git-ignored)
# ---------------------------------------------------------------------------
def _load_dotenv(path: Path):
    """Minimal .env loader (no external dependency). Does not override
    variables already set in the real environment."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


_load_dotenv(SCRIPT_DIR / ".env")

# eBay API Credentials — set them in ebay/.env (see .env.example)
CLIENT_ID = os.environ.get("EBAY_CLIENT_ID", "")
CLIENT_SECRET = os.environ.get("EBAY_CLIENT_SECRET", "")
REDIRECT_URI = os.environ.get("EBAY_REDIRECT_URI", "")

if not (CLIENT_ID and CLIENT_SECRET and REDIRECT_URI):
    raise RuntimeError(
        "Missing eBay credentials. Fill EBAY_CLIENT_ID, EBAY_CLIENT_SECRET and "
        f"EBAY_REDIRECT_URI in {SCRIPT_DIR / '.env'} (see .env.example)."
    )

# OAuth scopes — the Browse API only needs the base scope
SCOPES = [
    "https://api.ebay.com/oauth/api_scope",
]

# Writable data directory (tokens + cache). Defaults to the script dir;
# in Docker, set EBAY_DATA_DIR=/data and mount a volume there.
DATA_DIR = Path(os.environ.get("EBAY_DATA_DIR", str(SCRIPT_DIR)))
DATA_DIR.mkdir(parents=True, exist_ok=True)
TOKEN_FILE = DATA_DIR / "tokens.json"
LOCK_FILE = DATA_DIR / "tokens.json.lock"

# How long (seconds) a token must have left before we consider it "still fresh"
# This buffer avoids using a token that expires mid-request
TOKEN_FRESHNESS_BUFFER = 300  # 5 minutes


# ---------------------------------------------------------------------------
# File locking — prevents race conditions across multiple scraper instances
# ---------------------------------------------------------------------------
@contextmanager
def _file_lock(timeout=30, poll_interval=0.5):
    """
    Cross-platform advisory file lock using msvcrt (Windows) or fcntl (Unix).
    
    On a NAS share, this ensures only one process at a time can
    read-modify-write the token file.
    """
    lock_fd = None
    try:
        # Wait until we can acquire the lock
        deadline = time.monotonic() + timeout
        while True:
            try:
                # Open (or create) lock file — O_CREAT | O_RDWR
                lock_fd = os.open(
                    str(LOCK_FILE),
                    os.O_CREAT | os.O_RDWR,
                    0o666,
                )
                # Try to acquire an exclusive lock
                if os.name == "nt":
                    import msvcrt
                    msvcrt.locking(lock_fd, msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break  # lock acquired
            except (OSError, IOError):
                # Could not acquire — another instance holds it
                if lock_fd is not None:
                    os.close(lock_fd)
                    lock_fd = None
                if time.monotonic() >= deadline:
                    raise TimeoutError(
                        f"Could not acquire token lock within {timeout}s. "
                        f"Another instance may be stuck. Delete {LOCK_FILE} manually if needed."
                    )
                time.sleep(poll_interval)

        yield  # ← caller does its work while we hold the lock

    finally:
        if lock_fd is not None:
            try:
                if os.name == "nt":
                    import msvcrt
                    try:
                        msvcrt.locking(lock_fd, msvcrt.LK_UNLCK, 1)
                    except OSError:
                        pass
                else:
                    import fcntl
                    fcntl.flock(lock_fd, fcntl.LOCK_UN)
            finally:
                os.close(lock_fd)


# ---------------------------------------------------------------------------
# NAS permission helper
# ---------------------------------------------------------------------------
def _make_writable(path: Path):
    """Remove the read-only flag on a NAS file so we can overwrite it."""
    if path.exists():
        try:
            path.chmod(path.stat().st_mode | stat.S_IWRITE)
        except OSError:
            pass  # best effort


# ---------------------------------------------------------------------------
# Token persistence
# ---------------------------------------------------------------------------
def _save_tokens(tokens: dict):
    """
    Atomically save tokens to disk.
    Writes to a temp file first, then replaces the original — avoids
    NAS corruption from partial writes or flush/truncate timing issues.

    ★ Must be called while holding _file_lock(). ★
    """
    # Add metadata so other instances can tell when the token was last refreshed
    tokens["refreshed_at"] = datetime.now(timezone.utc).isoformat()
    if "expires_in" in tokens:
        tokens["expires_at"] = (
            datetime.now(timezone.utc) + timedelta(seconds=tokens["expires_in"])
        ).isoformat()

    # Serialize and validate before touching the file
    content = json.dumps(tokens, indent=2)
    json.loads(content)  # sanity check

    # Make sure target is writable (NAS shares can flip the read-only bit)
    _make_writable(TOKEN_FILE)

    # Write to a temp file in the same directory, then replace
    fd, tmp_path = tempfile.mkstemp(
        dir=str(DATA_DIR), suffix=".tmp", prefix="tokens_"
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as tmp_f:
            tmp_f.write(content)
        # os.replace is atomic on the same filesystem (works on Windows too)
        os.replace(tmp_path, str(TOKEN_FILE))
        # Grant full access to everyone so any user/service on the NAS can
        # read and update the token file without permission errors.
        try:
            TOKEN_FILE.chmod(stat.S_IRWXU | stat.S_IRWXG | stat.S_IRWXO)  # 0o777
        except OSError:
            pass  # best effort
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def _load_tokens() -> dict:
    """
    Robustly load tokens from disk, handling common NAS corruption patterns
    (null bytes, truncated JSON, trailing garbage).
    """
    content = TOKEN_FILE.read_text(encoding="utf-8", errors="replace")

    # Strip null bytes (NAS corruption artifact)
    content = content.replace("\x00", "").replace("\ufffd", "")

    # Find the outermost JSON object
    start = content.find("{")
    end = content.rfind("}")
    if start == -1 or end == -1:
        raise ValueError(f"Token file has no valid JSON object: {TOKEN_FILE}")

    content = content[start:end + 1]

    # Try parsing as-is first
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        pass

    # Attempt to fix missing closing quotes on string values
    import re
    content = re.sub(
        r'"([^"]+)":\s*"([^"]*?)\s*$',
        r'"\1": "\2"',
        content,
        flags=re.MULTILINE,
    )

    return json.loads(content)


def _token_is_fresh(tokens: dict) -> bool:
    """
    Check whether the access token is still usable (not expired or about to expire).
    Returns True if the token has enough life left.
    """
    expires_at = tokens.get("expires_at")
    if not expires_at:
        return False  # no expiry info → must refresh

    try:
        exp = datetime.fromisoformat(expires_at)
        remaining = (exp - datetime.now(timezone.utc)).total_seconds()
        return remaining > TOKEN_FRESHNESS_BUFFER
    except (ValueError, TypeError):
        return False


# ---------------------------------------------------------------------------
# OAuth flow
# ---------------------------------------------------------------------------
def get_authorization_url():
    """Generate the eBay OAuth2 authorization URL."""
    params = {
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "scope": " ".join(SCOPES),
    }
    url = "https://auth.ebay.com/oauth2/authorize?" + urllib.parse.urlencode(params)
    return url


def open_authorization_page():
    """Open the eBay authorization page in the browser."""
    url = get_authorization_url()
    print("\n🔗 eBay Authorization Required")
    print("=" * 60)
    print("Opening authorization page in your browser...\n")
    print(f"If the browser doesn't open, visit this URL:\n{url}\n")

    try:
        webbrowser.open(url)
    except Exception:
        pass


def exchange_code_for_tokens(redirect_url):
    """
    Exchange the authorization code for access and refresh tokens.

    Args:
        redirect_url (str): The full redirect URL from eBay after authorization

    Returns:
        dict: The token response containing access_token, refresh_token, etc.
    """
    # Extract authorization code from redirect URL
    try:
        parsed = urllib.parse.urlparse(redirect_url)
        code = urllib.parse.parse_qs(parsed.query)["code"][0]
    except (KeyError, IndexError):
        raise ValueError("Could not extract authorization code from redirect URL")

    # Prepare Basic auth header
    auth = base64.b64encode(f"{CLIENT_ID}:{CLIENT_SECRET}".encode()).decode()

    headers = {
        "Authorization": f"Basic {auth}",
        "Content-Type": "application/x-www-form-urlencoded"
    }

    data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": REDIRECT_URI
    }

    # Request tokens from eBay
    response = requests.post(
        "https://api.ebay.com/identity/v1/oauth2/token",
        headers=headers,
        data=data
    )

    tokens = response.json()

    if "error" in tokens:
        raise Exception(f"Token exchange failed: {tokens.get('error_description', tokens.get('error'))}")

    # Save tokens to file (with lock)
    with _file_lock():
        _save_tokens(tokens)

    print("✅ Tokens successfully obtained and saved!")
    return tokens


def refresh_access_token():
    """
    Refresh the access token using the refresh token.
    
    Uses file locking + check-after-lock to handle concurrent instances:
      1. Acquire exclusive lock on the token file
      2. Re-read the token file (another instance may have just refreshed it)
      3. If the token is still fresh → return it immediately (skip API call)
      4. Otherwise → call eBay API to refresh, save new tokens, release lock

    Returns:
        str: The new access token
    """
    with _file_lock():
        # ── Re-read tokens inside the lock ────────────────────────────────
        # Another instance may have refreshed while we were waiting for the lock
        tokens = _load_tokens()

        # If the current access token is still fresh, no need to hit the API
        if _token_is_fresh(tokens):
            print("✅ Token still fresh (refreshed by another instance), reusing.")
            return tokens["access_token"]

        # ── Token is stale — refresh it ───────────────────────────────────
        refresh_token_value = tokens.get("refresh_token")

        if not refresh_token_value:
            raise Exception("No refresh token found. Run the authorization flow first.")

        auth = base64.b64encode(f"{CLIENT_ID}:{CLIENT_SECRET}".encode()).decode()

        headers = {
            "Authorization": f"Basic {auth}",
            "Content-Type": "application/x-www-form-urlencoded"
        }

        data = {
            "grant_type": "refresh_token",
            "refresh_token": refresh_token_value,
            "scope": " ".join(SCOPES)
        }

        response = requests.post(
            "https://api.ebay.com/identity/v1/oauth2/token",
            headers=headers,
            data=data
        )

        new_tokens = response.json()

        if "error" in new_tokens:
            raise Exception(
                f"Token refresh failed: {new_tokens.get('error_description', new_tokens.get('error'))}"
            )

        # Merge and save
        tokens.update(new_tokens)
        _save_tokens(tokens)

        print(f"✅ Token refreshed and saved ({len(json.dumps(tokens))} bytes)")

        return new_tokens["access_token"]


def get_access_token():
    """
    Get a valid access token, refreshing if necessary.

    Returns:
        str: A valid access token
    """
    try:
        return refresh_access_token()
    except FileNotFoundError:
        raise Exception("Token file not found. Run authorization first: python ebay_auth.py --auth")


if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1 and sys.argv[1] == "--auth":
        # Step 1: Open authorization page
        open_authorization_page()

        # Step 2: Get authorization code from user
        redirect_url = input("\n📋 Paste the FULL redirect URL from the browser: ").strip()

        # Step 3: Exchange code for tokens
        try:
            exchange_code_for_tokens(redirect_url)
            print("\n✨ Authorization complete! You can now use the scraper.")
        except Exception as e:
            print(f"\n❌ Error: {e}")
    else:
        # Just refresh the token (for testing)
        try:
            token = get_access_token()
            print(f"✅ Access token obtained: {token[:20]}...")
        except Exception as e:
            print(f"\n❌ Error: {e}")
            print("\nTo authorize, run: python ebay_auth.py --auth")
