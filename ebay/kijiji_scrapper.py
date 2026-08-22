# Kijiji.ca scraper — companion to scrapper.py (same configs, same bots).
# Usage: python kijiji_scrapper.py <path_to_config>
#
# A config opts in by defining `kijiji_url` (a Kijiji category/search URL).
# Optional keys: `kijiji_price` ("min-max", in CAD), `kijiji_pages` (default 1).
# Keywords / price_ranges / bot_blocklist / bot are shared with the eBay run.
import json
import re
import sys
import time
import logging
import requests
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode

from ebay_auth import DATA_DIR
from scrapper import (
    ScrapperConfig,
    load_config,
    build_config,
    check_description,
    load_cache,
    save_cache,
    acquire_lock,
    release_lock,
    escape_markdown_v2,
)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "fr-CA,fr;q=0.8,en-CA;q=0.5,en;q=0.3",
}

NEXT_DATA_RE = re.compile(
    r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', re.S
)

# Blocklist entries that make sense on eBay (shipping expected) but not on
# Kijiji, where almost every ad is local pickup.
PICKUP_TERMS = {"local pickup only", "ramassage seulement"}


# ---------------------------------------------------------------------------
# Fetch & parse
# ---------------------------------------------------------------------------
def build_page_url(base_url: str, page: int, price: str) -> str:
    """Build a Kijiji search URL: inject /page-N/ and force sort/ad/price params."""
    parts = urlsplit(base_url)
    path = parts.path
    if page > 1:
        # /b-laptops/canada/c773l0 -> /b-laptops/canada/page-2/c773l0
        segments = path.rstrip("/").split("/")
        segments.insert(-1, f"page-{page}")
        path = "/".join(segments)

    query = dict(parse_qsl(parts.query))
    query["sort"] = "dateDesc"
    query["ad"] = "offering"
    if price:
        lo, hi = price.split("-", 1)
        query["price"] = f"{int(lo)}__{int(hi)}"
    return urlunsplit((parts.scheme, parts.netloc, path, urlencode(query), ""))


def fetch_listings(base_url: str, pages: int, price: str) -> list:
    """Fetch search pages and return organic listings (newest first)."""
    listings = []
    seen_ids = set()
    for page in range(1, pages + 1):
        url = build_page_url(base_url, page, price)
        resp = requests.get(url, headers=HEADERS, timeout=25)
        resp.raise_for_status()
        m = NEXT_DATA_RE.search(resp.text)
        if not m:
            raise RuntimeError(
                f"__NEXT_DATA__ not found on {url} (HTTP {resp.status_code}) — possible bot challenge"
            )
        apollo = (
            json.loads(m.group(1))
            .get("props", {})
            .get("pageProps", {})
            .get("__APOLLO_STATE__", {})
        )
        for key, value in apollo.items():
            if not key.startswith("StandardListing:"):
                continue
            if value.get("adSource") == "TOP_AD":  # sponsored, repeated on every page
                continue
            listing_id = str(value.get("id", ""))
            if not listing_id or listing_id in seen_ids:
                continue
            seen_ids.add(listing_id)
            listings.append(value)
        if page < pages:
            time.sleep(1.5)
    return listings


def listing_price_dollars(listing: dict):
    """Return the price in CAD dollars, or None for CONTACT/SWAP/no-price ads."""
    price = listing.get("price") or {}
    amount = price.get("amount")
    if amount is None:
        return None
    return int(amount) // 100


# ---------------------------------------------------------------------------
# Telegram
# ---------------------------------------------------------------------------
def send_telegram_kijiji(config: ScrapperConfig, new_items: list):
    if not new_items:
        return
    if not config.telegram_token or not config.telegram_chat_id:
        logging.warning("Telegram not configured — skipping notification.")
        return

    bot_name_esc = escape_markdown_v2(config.bot_name)
    message = f"🍁 *New Kijiji Listings in {bot_name_esc} \\!*\n\n"
    for item in new_items:
        title    = escape_markdown_v2(item["title"])
        price    = escape_markdown_v2(str(item["price"]))
        location = escape_markdown_v2(item.get("location", ""))
        url      = escape_markdown_v2(item["url"])
        keyword  = escape_markdown_v2(str(item.get("keyword", "")))
        grading  = "🌟" * int(item.get("grade", 0))
        message += (
            f"*{title}*\n"
            f"💰 *Price:* {price} CAD {grading}\n"
            f"📍 *Location:* {location}\n"
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
# Main
# ---------------------------------------------------------------------------
def run(config: ScrapperConfig, kijiji_url: str, kijiji_price: str, kijiji_pages: int):
    config.bot_blocklist = [
        b for b in (config.bot_blocklist or []) if b.lower() not in PICKUP_TERMS
    ]
    cache_file = DATA_DIR / "cache" / f"kijiji_{config.config_path.stem}_cache.json"
    lock_file = acquire_lock(cache_file)
    if lock_file is None:
        logging.error("Exiting — could not acquire kijiji cache lock.")
        return

    try:
        previous_ids_list = load_cache(cache_file)
        previous_ids = set(previous_ids_list)
        is_seed_run = len(previous_ids) == 0

        listings = fetch_listings(kijiji_url, kijiji_pages, kijiji_price)

        # Rolling history (max 500 ids), newest last — same scheme as the eBay run.
        seen = {}
        for listing_id in previous_ids_list:
            seen[listing_id] = None
        for listing in reversed(listings):
            listing_id = str(listing["id"])
            seen.pop(listing_id, None)
            seen[listing_id] = None
        current_ids = list(seen.keys())[-500:]

        new_listings = [l for l in listings if str(l["id"]) not in previous_ids]
        print(f"[kijiji] {len(new_listings)} new items (out of {len(listings)} total)")

        if is_seed_run and new_listings:
            print(f"🌱 [kijiji] First run — seeding cache with {len(listings)} items. Skipped Telegram.")
            save_cache(cache_file, current_ids)
            return

        out = []
        for listing in new_listings:
            price = listing_price_dollars(listing)
            if price is None:  # CONTACT / SWAP / no price — cannot be graded
                continue
            title = listing.get("title") or ""
            description = listing.get("description") or ""
            keyword, grade = check_description(config, description or title, str(price), title)
            if keyword:
                out.append({
                    "title":    title,
                    "price":    price,
                    "location": ((listing.get("location") or {}).get("name")) or "?",
                    "url":      listing.get("url") or "",
                    "keyword":  keyword,
                    "grade":    grade,
                })

        # Save cache before sending (same crash-safety rationale as the eBay run).
        save_cache(cache_file, current_ids)

        if out:
            print(f"[kijiji] Found {len(out)} matching items.")
            send_telegram_kijiji(config, out)
        else:
            print("[kijiji] No matching items found.")
    finally:
        release_lock(lock_file)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python kijiji_scrapper.py <path_to_config>")
        sys.exit(1)

    config_path = Path(sys.argv[1])
    if not config_path.suffix:
        config_path = config_path.with_suffix(".yml")
    if not config_path.exists():
        print(f"❌ Config file not found: {config_path}")
        sys.exit(1)

    config_dict = load_config(str(config_path))
    kijiji_url = str(config_dict.get("kijiji_url") or "").strip()
    if not kijiji_url:
        sys.exit(0)  # config not opted in to Kijiji — nothing to do

    kijiji_price = str(config_dict.get("kijiji_price") or "").strip()
    kijiji_pages = int(config_dict.get("kijiji_pages") or 1)

    config = build_config(config_dict, config_path)
    run(config, kijiji_url, kijiji_price, kijiji_pages)
