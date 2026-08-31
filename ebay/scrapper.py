# Modular eBay scraper (eBay Canada / EBAY_CA)
# Usage: python scrapper.py <path_to_config>
#   e.g. python scrapper.py configs/laptop
#        python scrapper.py configs/phones.yml
import asyncio
import aiohttp
import json
import os
import sys
import re
import requests
import logging
import time
import yaml
from dataclasses import dataclass, field
from typing import List, Optional
from pathlib import Path
import pytz
from datetime import datetime, timezone

from ebay_auth import get_access_token, DATA_DIR

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).resolve().parent
LOG_LEVEL = os.getenv("EBAY_APP_LOG_LEVEL", "INFO").upper()
logging.basicConfig(level=getattr(logging, LOG_LEVEL, logging.INFO), format="%(levelname)s: %(message)s")

local_tz = pytz.timezone("America/Toronto")
print(datetime.now(local_tz).strftime("%Y-%m-%d %H:%M:%S"))

SEARCH_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search"
ITEM_URL   = "https://api.ebay.com/buy/browse/v1/item/"

# ---------------------------------------------------------------------------
# Telegram bot mapping — tokens/chat id come from ebay/.env (loaded by ebay_auth)
# ---------------------------------------------------------------------------
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "")
BOT_MAPPING = {
    "Laptops":  {"token": os.environ.get("TELEGRAM_TOKEN_LAPTOPS", ""),  "chat_id": TELEGRAM_CHAT_ID},
    "Consoles": {"token": os.environ.get("TELEGRAM_TOKEN_CONSOLES", ""), "chat_id": TELEGRAM_CHAT_ID},
    "Phones":   {"token": os.environ.get("TELEGRAM_TOKEN_PHONES", ""),   "chat_id": TELEGRAM_CHAT_ID},
    "Tablets":  {"token": os.environ.get("TELEGRAM_TOKEN_TABLETS", ""),  "chat_id": TELEGRAM_CHAT_ID},
    "Gadgets":  {"token": os.environ.get("TELEGRAM_TOKEN_GADGETS", ""),  "chat_id": TELEGRAM_CHAT_ID},
    "Voitures": {"token": os.environ.get("TELEGRAM_TOKEN_VOITURES", ""), "chat_id": TELEGRAM_CHAT_ID},
}

# Default eBay search filters (can be overridden per-config via ebay_filters key)
# Note: sellerAccountTypes is not supported on EBAY_CA, so it is omitted.
DEFAULT_EBAY_FILTERS = (
    "buyingOptions:{FIXED_PRICE},"
    "itemLocationCountry:CA,"
    "deliveryCountry:CA"
)

# Canadian postal code first letter(s) per province — the Browse API only
# returns a masked postal code (e.g. "H2X***") in item summaries, so region
# filtering is done via the postal prefix.
PROVINCE_POSTAL_PREFIXES = {
    "NL": "A", "NS": "B", "PE": "C", "NB": "E",
    "QC": "GHJ", "ON": "KLMNP", "MB": "R", "SK": "S",
    "AB": "T", "BC": "V", "NT": "X", "NU": "X", "YT": "Y",
}
PROVINCE_ALIASES = {
    "quebec": "QC", "québec": "QC", "ontario": "ON", "alberta": "AB",
    "british columbia": "BC", "colombie-britannique": "BC", "manitoba": "MB",
    "saskatchewan": "SK", "nova scotia": "NS", "new brunswick": "NB",
    "newfoundland": "NL", "prince edward island": "PE",
}


def region_postal_prefixes(provinces: List[str]) -> str:
    """Resolve a list of province codes/names to accepted postal-code first letters."""
    prefixes = ""
    for p in provinces:
        code = PROVINCE_ALIASES.get(p.strip().lower(), p.strip().upper())
        prefixes += PROVINCE_POSTAL_PREFIXES.get(code, "")
    return prefixes

# ---------------------------------------------------------------------------
# Config dataclass
# ---------------------------------------------------------------------------
@dataclass
class ScrapperConfig:
    # Filtering (shared with kleinanzeigen)
    keywords: List[List[str]]
    price_ranges: List[List[int]]
    keywords_2: Optional[List[List[str]]] = None
    price_ranges_2: Optional[List[List[int]]] = None
    bot_blocklist: List[str] = field(default_factory=list)
    block_lower_range: bool = True

    # eBay-specific
    ebay_category: str = ""
    ebay_filters: str = DEFAULT_EBAY_FILTERS
    search_query: str = ""
    marketplace: str = "EBAY_CA"
    limit: int = 100
    # Optional post-filter on item location (e.g. ["QC", "Quebec", "Québec"]).
    # Empty list = whole country.
    item_location_provinces: List[str] = field(default_factory=list)

    # Telegram (resolved via BOT_MAPPING from the bot name)
    bot_name: str = ""
    telegram_token: str = ""
    telegram_chat_id: str = ""

    # Per-config cache file (set at build time)
    cache_file: Path = field(default_factory=lambda: SCRIPT_DIR / "cache.json")

    # Path of the YAML config this run was built from (for status reporting)
    config_path: Optional[Path] = None


# ---------------------------------------------------------------------------
# Config loading
# ---------------------------------------------------------------------------
def load_config(file_path: str) -> dict:
    with open(file_path, 'r') as f:
        return yaml.safe_load(f)


def build_config(config_dict: dict, config_path: Path) -> ScrapperConfig:
    """Build a ScrapperConfig from the shared kleinanzeigen config format."""

    def sort_exclusions_first(lists):
        for row in lists:
            row.sort(key=lambda item: not (isinstance(item, str) and item.startswith("!")))
        return lists

    # ── Keywords & price ranges ───────────────────────────────────────────
    price_ranges = [[int(p) for p in pr.split('-')] for pr in config_dict['price_ranges']]
    keywords = sort_exclusions_first([i.split(";") for i in config_dict['keywords']])

    # Optional secondary keywords
    try:
        price_ranges_2 = [[int(p) for p in pr.split('-')] for pr in config_dict['price_ranges_2']]
        keywords_2 = sort_exclusions_first([i.split(";") for i in config_dict['keywords_2']])
    except (KeyError, TypeError):
        price_ranges_2 = None
        keywords_2 = None

    # ── Misc filtering ────────────────────────────────────────────────────
    bot_blocklist = config_dict.get('bot_blocklist') or []

    # block_lower_range can be a bool or a list (YAML quirk in the shared config)
    raw_blr = config_dict.get('block_lower_range', True)
    if isinstance(raw_blr, list):
        block_lower_range = bool(raw_blr[0]) if raw_blr else True
    else:
        block_lower_range = bool(raw_blr)

    # ── eBay-specific fields ──────────────────────────────────────────────
    # ebay_category can be a list (YAML) or a plain value
    raw_cat = config_dict.get('ebay_category', '')
    if isinstance(raw_cat, list):
        ebay_category = str(raw_cat[0]).strip() if raw_cat else ''
    else:
        ebay_category = str(raw_cat).strip()

    ebay_filters  = config_dict.get('ebay_filters', DEFAULT_EBAY_FILTERS)
    search_query  = config_dict.get('search_query', '')
    marketplace   = config_dict.get('marketplace', 'EBAY_CA')
    limit         = int(config_dict.get('limit_ebay', 50))

    # Optional province post-filter (list of accepted stateOrProvince values)
    raw_provinces = config_dict.get('item_location_provinces') or []
    if isinstance(raw_provinces, str):
        raw_provinces = [raw_provinces]
    item_location_provinces = [str(p).strip() for p in raw_provinces if str(p).strip()]

    # ── Telegram ──────────────────────────────────────────────────────────
    bot_name = (config_dict.get('bot') or [''])[0]
    bot_info = BOT_MAPPING.get(bot_name, {})
    telegram_token   = bot_info.get('token', '')
    telegram_chat_id = str(bot_info.get('chat_id', ''))

    if not telegram_token:
        logging.warning(f"Bot '{bot_name}' not found in BOT_MAPPING — Telegram notifications disabled.")

    # ── Cache file — stored in <EBAY_DATA_DIR>/cache/<config_name>_cache.json
    cache_dir = DATA_DIR / "cache"
    cache_file = cache_dir / f"{config_path.stem}_cache.json"

    return ScrapperConfig(
        keywords=keywords,
        price_ranges=price_ranges,
        keywords_2=keywords_2,
        price_ranges_2=price_ranges_2,
        bot_blocklist=bot_blocklist,
        block_lower_range=block_lower_range,
        ebay_category=ebay_category,
        ebay_filters=ebay_filters,
        search_query=search_query,
        marketplace=marketplace,
        limit=limit,
        item_location_provinces=item_location_provinces,
        bot_name=bot_name,
        telegram_token=telegram_token,
        telegram_chat_id=telegram_chat_id,
        cache_file=cache_file,
        config_path=config_path,
    )


# ---------------------------------------------------------------------------
# Cache helpers
# ---------------------------------------------------------------------------
def load_cache(cache_file: Path) -> list:
    try:
        if cache_file.exists():
            content = cache_file.read_text().strip()
            return json.loads(content) if content else []
    except json.JSONDecodeError:
        logging.warning(f"Cache '{cache_file}' is invalid JSON — starting fresh.")
    return []


def save_cache(cache_file: Path, fetched_ids: list):
    import stat
    import os

    cache_file.parent.mkdir(parents=True, exist_ok=True)
    temp_file = cache_file.with_suffix('.tmp')

    try:
        # 1. Write to a temporary file first
        with open(temp_file, "w") as f:
            json.dump(fetched_ids, f)
            f.flush()
            os.fsync(f.fileno())  # Force write to NAS disk

        # 2. Grant full access on the tmp file
        temp_file.chmod(stat.S_IRWXU | stat.S_IRWXG | stat.S_IRWXO)  # 0o777

        # 3. Atomic replace over the target file
        os.replace(temp_file, cache_file)

    except Exception as e:
        logging.error(f"❌ Cannot write cache file '{cache_file}': {e}")
        if temp_file.exists():
            try:
                temp_file.unlink()
            except OSError:
                pass


def write_status(config: ScrapperConfig, payload: dict):
    """Write per-config run status for the web UI (atomic, best effort)."""
    if not config.config_path:
        return
    try:
        status_dir = DATA_DIR / "status"
        status_dir.mkdir(parents=True, exist_ok=True)
        tmp = status_dir / f"{config.config_path.stem}.tmp"
        tmp.write_text(json.dumps(payload))
        os.replace(tmp, status_dir / f"{config.config_path.stem}.json")
    except OSError as e:
        logging.warning(f"Could not write status file: {e}")


def acquire_lock(cache_file: Path, timeout: int = 30) -> Optional[Path]:
    """Create a lock file to prevent concurrent runs from processing the same listings.
    Returns the lock path on success, None if another instance holds the lock."""
    import time
    lock_file = cache_file.with_suffix('.lock')
    cache_file.parent.mkdir(parents=True, exist_ok=True)
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            # Exclusive creation — fails if file already exists
            fd = os.open(str(lock_file), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, str(os.getpid()).encode())
            os.close(fd)
            return lock_file
        except FileExistsError:
            # Check if the lock is stale (older than 5 minutes)
            try:
                age = time.time() - lock_file.stat().st_mtime
                if age > 300:
                    logging.warning(f"Stale lock detected ({age:.0f}s old) — removing.")
                    lock_file.unlink(missing_ok=True)
                    continue
            except OSError:
                pass
            time.sleep(1)
    logging.error(f"❌ Could not acquire lock '{lock_file}' after {timeout}s — another instance may be running.")
    return None


def release_lock(lock_file: Optional[Path]):
    """Remove the lock file."""
    if lock_file and lock_file.exists():
        try:
            lock_file.unlink()
        except OSError as e:
            logging.warning(f"Could not remove lock file '{lock_file}': {e}")


# ---------------------------------------------------------------------------
# Filtering logic  (identical to kleinanzeigen/scrapper.py)
# ---------------------------------------------------------------------------
def get_grade(a, b, price):
    step = (b - a) / 4
    if price < a:
        return 5
    grades = [(a + i * step, a + (i + 1) * step) for i in range(4)]
    for i, (lo, hi) in enumerate(grades):
        if lo <= price <= hi:
            return 4 - i
    return 0


def _match_keyword(keyword: str, search_text: str):
    """Returns (is_exclusion, matched) for a single keyword."""
    is_exclusion = keyword.startswith('!')
    pattern = keyword[1:] if is_exclusion else keyword
    is_regex = pattern.startswith('regex:')

    if is_regex:
        pattern = pattern[6:]
        try:
            regex = re.compile(pattern, re.IGNORECASE | re.MULTILINE)
            matched = bool(regex.search(search_text))
        except re.error as e:
            logging.warning(f"Invalid regex '{pattern}': {e}")
            return is_exclusion, False
    else:
        matched = pattern.lower() in search_text

    return is_exclusion, matched


def _check_secondary_keywords(keywords_2, price_ranges_2, price_value, search_text):
    for i, (price_min, price_max) in enumerate(price_ranges_2):
        if i >= len(keywords_2) or price_value > price_max:
            continue
        for keyword in keywords_2[i]:
            if not keyword:
                continue
            grade = get_grade(price_min, price_max, price_value)
            is_exclusion, matched = _match_keyword(keyword, search_text)
            if is_exclusion and matched:
                return False, 0
            if not is_exclusion and matched:
                return keyword, grade
    return 'continue', 0


def check_description(config: ScrapperConfig, description: str, price: str, title: str):
    """Returns (keyword, grade) if item passes filter, else (False, 0)."""
    if not all([config.keywords, config.price_ranges, description, price, title]):
        logging.warning("check_description: missing required parameters")
        return False, 0

    search_text = f"{title} {description}".lower()

    for blocked in (config.bot_blocklist or []):
        if blocked and blocked.lower() in search_text:
            return False, 0

    try:
        price_value = int(float(re.sub(r'[^\d.]', '', price)))
    except (ValueError, TypeError):
        logging.warning(f"Invalid price format: {price}")
        return False, 0

    for i, (price_min, price_max) in enumerate(config.price_ranges):
        if price_value > price_max:
            if config.block_lower_range and price_value < price_min:
                return False, 0
            continue

        if i == len(config.keywords) - 1 and price_value < price_min:
            return False, 0

        for keyword in config.keywords[i]:
            if not keyword:
                continue
            grade = get_grade(price_min, price_max, price_value)
            is_exclusion, matched = _match_keyword(keyword, search_text)

            if is_exclusion and matched:
                return False, 0

            if not is_exclusion and matched:
                if config.keywords_2 and config.price_ranges_2:
                    kw, gr = _check_secondary_keywords(
                        config.keywords_2, config.price_ranges_2, price_value, search_text
                    )
                    if kw == 'continue':
                        continue
                    elif not kw:
                        return False, 0
                    else:
                        return kw, gr
                return keyword, grade

    return False, 0


# ---------------------------------------------------------------------------
# Telegram
# ---------------------------------------------------------------------------
def escape_markdown_v2(text: str) -> str:
    reserved = r'_*[]()~`>#+-=|{}.!'
    return re.sub(f'([{re.escape(reserved)}])', r'\\\1', text)


def send_telegram(config: ScrapperConfig, new_items: list):
    if not new_items:
        return
    if not config.telegram_token or not config.telegram_chat_id:
        logging.warning("Telegram not configured — skipping notification.")
        return

    bot_name_esc = escape_markdown_v2(config.bot_name)
    message = f"📢 *New eBay Listings in {bot_name_esc} \\!*\n\n"

    for item in new_items:
        title    = escape_markdown_v2(item['title'])
        price    = escape_markdown_v2(str(item['price']))
        currency = escape_markdown_v2(item['currency'])
        url      = escape_markdown_v2(item['url'])
        keyword  = escape_markdown_v2(str(item.get('keyword', '')))
        grading  = "🌟" * int(item.get('grade', 0))
        message += (
            f"*{title}*\n"
            f"💰 *Price:* {price} {currency} {grading}\n"
            f"🔑 *Keyword:* {keyword}\n"
            f"🔍 *Url:* {url}\n\n"
        )

    telegram_url = f"https://api.telegram.org/bot{config.telegram_token}/sendMessage"
    data = {
        "chat_id": config.telegram_chat_id,
        "text": message,
        "parse_mode": "MarkdownV2",
    }
    response = requests.post(telegram_url, data=data)
    if response.status_code == 200:
        print("✅ Telegram message sent!")
    else:
        print(f"❌ Error sending Telegram message: {response.text}")


# ---------------------------------------------------------------------------
# eBay API
# ---------------------------------------------------------------------------
async def fetch_search(session: aiohttp.ClientSession, token: str, config: ScrapperConfig):
    params = {
        "limit": config.limit,
        "sort": "newlyListed",
        "filter": config.ebay_filters,
    }
    # Only include q and category_ids when they have a value — the eBay API
    # rejects the call if an empty string is sent for these parameters.
    if config.search_query:
        params["q"] = config.search_query
    if config.ebay_category:
        params["category_ids"] = config.ebay_category
    headers = {
        "Authorization": f"Bearer {token}",
        "X-EBAY-C-MARKETPLACE-ID": config.marketplace,
    }
    async with session.get(SEARCH_URL, headers=headers, params=params) as resp:
        return await resp.json()


async def fetch_item_detail(session: aiohttp.ClientSession, token: str, item_id: str, marketplace: str):
    headers = {
        "Authorization": f"Bearer {token}",
        "X-EBAY-C-MARKETPLACE-ID": marketplace,
    }
    async with session.get(ITEM_URL + item_id, headers=headers) as resp:
        return await resp.json()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
async def run(config: ScrapperConfig):
    lock_file = acquire_lock(config.cache_file)
    if lock_file is None:
        logging.error("Exiting — could not acquire cache lock. Another instance is running.")
        return

    t0 = time.monotonic()
    stats = {"total": 0, "new": 0, "matched": 0, "seed": False}
    error = None
    try:
        previous_ids_list = load_cache(config.cache_file)
        previous_ids = set(previous_ids_list)
        is_seed_run = len(previous_ids) == 0

        token = get_access_token()

        async with aiohttp.ClientSession() as session:
            search_data = await fetch_search(session, token, config)
            items = search_data.get("itemSummaries", [])

            # Build rolling history (max 500 items).
            # Use an ordered dict-style dedup so the newest item always wins its position.
            seen = {}
            for item_id in previous_ids_list:
                seen[item_id] = None  # preserve insertion order
            for i in reversed(items):  # oldest → newest so newest ends up last
                item_id = i["itemId"]
                seen.pop(item_id, None)  # remove old position
                seen[item_id] = None     # re-insert at end
            current_ids = list(seen.keys())[-500:]

            new_items = [i for i in items if i["itemId"] not in previous_ids]
            print(f"{len(new_items)} new items (out of {len(items)} total)")
            stats["total"] = len(items)
            stats["new"] = len(new_items)

            # Optional province filter (e.g. Quebec only) — applied before the
            # detail requests to avoid wasting API calls on out-of-region items.
            # Items without any postal code are excluded when the filter is active.
            if config.item_location_provinces:
                prefixes = set(region_postal_prefixes(config.item_location_provinces))
                before = len(new_items)
                new_items = [
                    i for i in new_items
                    if ((i.get("itemLocation") or {}).get("postalCode") or "").strip().upper()[:1] in prefixes
                ]
                print(f"{len(new_items)} items after province filter ({before - len(new_items)} outside {config.item_location_provinces})")

            if is_seed_run and new_items:
                print(f"🌱 First run detected (cache is empty). Seeding cache with {len(items)} items. Skipped Telegram/Details.")
                stats["seed"] = True
                save_cache(config.cache_file, current_ids)
                return

            tasks = [
                fetch_item_detail(session, token, i["itemId"], config.marketplace)
                for i in new_items
            ]
            details = await asyncio.gather(*tasks)

            out = []
            for item, detail in zip(new_items, details):
                title       = item["title"]
                price       = item.get("price", {}).get("value")
                currency    = item.get("price", {}).get("currency")
                url         = item["itemWebUrl"]
                spec        = str(detail.get("localizedAspects", []) or "")
                short_desc  = detail.get("shortDescription") or ""
                long_desc   = detail.get("description") or ""
                description = f"{short_desc}\n{long_desc}\n{spec}".strip()

                keyword, grade = check_description(
                    config,
                    description,
                    str(price) if price else "0",
                    title,
                )

                if keyword:
                    out.append({
                        "itemId":   item["itemId"],
                        "title":    title,
                        "price":    price,
                        "currency": currency,
                        "url":      url,
                        "keyword":  keyword,
                        "grade":    grade,
                    })

            # ✅ Save cache BEFORE sending Telegram.
            # This ensures IDs are persisted even if the Telegram call fails or the
            # process is killed mid-send — preventing duplicate notifications on retry.
            save_cache(config.cache_file, current_ids)

            stats["matched"] = len(out)
            if out:
                print(f"Found {len(out)} matching items.")
                send_telegram(config, out)
            else:
                print("No matching items found.")

    except Exception as e:
        error = str(e)
        raise
    finally:
        write_status(config, {
            "ts": datetime.now(timezone.utc).isoformat(),
            "duration_s": round(time.monotonic() - t0, 2),
            **stats,
            "ok": error is None,
            "error": error,
        })
        release_lock(lock_file)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python scrapper.py <path_to_config>")
        sys.exit(1)

    config_path = Path(sys.argv[1])
    if not config_path.suffix:
        config_path = config_path.with_suffix(".yml")

    if not config_path.exists():
        print(f"❌ Config file not found: {config_path}")
        sys.exit(1)

    print(f"📂 Loading config: {config_path}")
    config_dict = load_config(str(config_path))

    # Opt-out of the eBay run (e.g. Kijiji-only configs like voitures)
    if str(config_dict.get("ebay_enabled", True)).lower() in ("false", "no", "0"):
        print("⏭️  eBay disabled for this config (ebay_enabled: false)")
        sys.exit(0)

    config = build_config(config_dict, config_path)

    asyncio.run(run(config))
