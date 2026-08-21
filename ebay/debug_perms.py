"""Debug NAS file write strategies for tokens.json"""
import os
import json
import tempfile
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
TOKEN_FILE = SCRIPT_DIR / "tokens.json"

# Read current content
content = TOKEN_FILE.read_text(encoding="utf-8", errors="replace")
tokens = json.loads(content)
print(f"Current token keys: {list(tokens.keys())}")

# Strategy 1: os.replace from temp file
print("\n--- Strategy 1: os.replace ---")
try:
    fd, tmp_path = tempfile.mkstemp(dir=str(SCRIPT_DIR), suffix=".tmp", prefix="tokens_")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(tokens, f, indent=2)
    os.replace(tmp_path, str(TOKEN_FILE))
    print("os.replace: OK")
except Exception as e:
    print(f"os.replace: FAILED - {e}")
    try:
        os.unlink(tmp_path)
    except:
        pass

# Strategy 2: delete + rename
print("\n--- Strategy 2: delete + rename ---")
try:
    fd, tmp_path = tempfile.mkstemp(dir=str(SCRIPT_DIR), suffix=".tmp", prefix="tokens_")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(tokens, f, indent=2)
    if TOKEN_FILE.exists():
        TOKEN_FILE.unlink()
    os.rename(tmp_path, str(TOKEN_FILE))
    print("delete + rename: OK")
except Exception as e:
    print(f"delete + rename: FAILED - {e}")
    try:
        os.unlink(tmp_path)
    except:
        pass

# Strategy 3: write via open("w")
print("\n--- Strategy 3: open('w') ---")
try:
    with open(TOKEN_FILE, "w", encoding="utf-8") as f:
        json.dump(tokens, f, indent=2)
    print("open('w'): OK")
except Exception as e:
    print(f"open('w'): FAILED - {e}")

# Strategy 4: write via open("r+") (overwrite in place)
print("\n--- Strategy 4: open('r+') ---")
try:
    new_content = json.dumps(tokens, indent=2)
    with open(TOKEN_FILE, "r+", encoding="utf-8") as f:
        f.seek(0)
        f.write(new_content)
        f.truncate()
    print("open('r+'): OK")
except Exception as e:
    print(f"open('r+'): FAILED - {e}")

# Verify final state
final = TOKEN_FILE.read_text(encoding="utf-8")
print(f"\nFinal file size: {len(final)} bytes")
print(f"Valid JSON: {bool(json.loads(final))}")
