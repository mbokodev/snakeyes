# Facebook Marketplace scraper — companion to scrapper.py (same configs, same bots).
# Usage: python facebook_scrapper.py <path_to_config>
#
# Logged-out scraping of the public Marketplace search page (no Facebook account).
# A config opts in by defining `facebook_queries` (list of search terms) and
# `facebook_locations` (list of Marketplace city slugs or numeric ids, e.g.
# montreal, quebec, 302594032926496 = Saguenay). Each query x location is one
# request (~24 newest listings, radius ~65 km around the city).
# Optional keys: `facebook_price` ("min-max", in CAD), `facebook_interval`
# (minimum seconds between two Facebook runs of this config, default 900).
# Keywords / price_ranges / bot_blocklist / bot are shared with the eBay run.
# Facebook only exposes the title on the search page: the blocklist is applied
# to the title alone.
import json
import random
import re
import sys
import time
import logging
import requests
from pathlib import Path
from urllib.parse import quote

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
    source_enabled,
)
from kijiji_scrapper import PICKUP_TERMS

# Without the Sec-Fetch-* headers Facebook answers HTTP 400.
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "fr-CA,fr;q=0.9,en-CA;q=0.6,en;q=0.4",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
}

JSON_SCRIPT_RE = re.compile(r'<script type="application/json"[^>]*>(.*?)</script>', re.S)

DEFAULT_INTERVAL = 900  # 15 min — keeps the request rate low to avoid blocks


# ---------------------------------------------------------------------------
# Fetch & parse
# ---------------------------------------------------------------------------
def build_search_url(location: str, query: str, price: str) -> str:
    url = (
        f"https://www.facebook.com/marketplace/{quote(location)}/search/"
        f"?query={quote(query)}&sortBy=creation_time_descend&exact=false"
    )
    if price:
        lo, hi = price.split("-", 1)
        url += f"&minPrice={int(lo)}&maxPrice={int(hi)}"
    return url


def _collect_listings(node, out: list):
    """Walk the relay payload and collect Marketplace listing objects."""
    if isinstance(node, dict):
        if node.get("__typename") == "GroupCommerceProductItem" and "marketplace_listing_title" in node:
            out.append(node)
        for value in node.values():
            _collect_listings(value, out)
    elif isinstance(node, list):
        for value in node:
            _collect_listings(value, out)


def fetch_search(url: str) -> list:
    """Fetch one Marketplace search page and return its listings."""
    resp = requests.get(url, headers=HEADERS, timeout=25)
    resp.raise_for_status()
    found = []
    for m in JSON_SCRIPT_RE.finditer(resp.text):
        if "marketplace_listing_title" not in m.group(1):
            continue
        try:
            _collect_listings(json.loads(m.group(1)), found)
        except ValueError:
            continue
    if not found and "marketplace_search" not in resp.text:
        raise RuntimeError(f"No Marketplace data on {url} — possible login wall / bot challenge")
    return found


def fetch_listings(queries: list, locations: list, price: str) -> list:
    """Run every query x location search; return unique listings, newest first."""
    listings = {}
    first = True
    for location in locations:
        for query in queries:
            if not first:
                time.sleep(random.uniform(3, 6))
            first = False
            url = build_search_url(location, query, price)
            for listing in fetch_search(url):
                listing_id = str(listing.get("id", ""))
                if listing_id and listing_id not in listings:
                    listings[listing_id] = listing
    return sorted(listings.values(), key=lambda l: l.get("creation_time") or 0, reverse=True)


def listing_price_dollars(listing: dict):
    """Return the price in CAD dollars, or None when absent."""
    amount = (listing.get("listing_price") or {}).get("amount")
    try:
        return int(float(amount))
    except (TypeError, ValueError):
        return None


def listing_location(listing: dict) -> str:
    geo = ((listing.get("location") or {}).get("reverse_geocode") or {})
    city, state = geo.get("city"), geo.get("state")
    return ", ".join(p for p in (city, state) if p) or "?"


# ---------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------
def due(stamp_file: Path, interval: int) -> bool:
    try:
        return time.time() - float(stamp_file.read_text()) >= interval
    except (OSError, ValueError):
        return True


def mark_run(stamp_file: Path):
    try:
        stamp_file.parent.mkdir(parents=True, exist_ok=True)
        stamp_file.write_text(str(time.time()))
    except OSError:
        pass


# ---------------------------------------------------------------------------
# Telegram
# ---------------------------------------------------------------------------
def send_telegram_facebook(config: ScrapperConfig, new_items: list):
    if not new_items:
        return
    if not config.telegram_token or not config.telegram_chat_id:
        logging.warning("Telegram not configured — skipping notification.")
        return

    bot_name_esc = escape_markdown_v2(config.bot_name)
    message = f"📘 *New Facebook Listings in {bot_name_esc} \\!*\n\n"
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
def run(config: ScrapperConfig, queries: list, locations: list, price: str):
    config.bot_blocklist = [
        b for b in (config.bot_blocklist or []) if b.lower() not in PICKUP_TERMS
    ]
    cache_file = DATA_DIR / "cache" / f"facebook_{config.config_path.stem}_cache.json"
    lock_file = acquire_lock(cache_file)
    if lock_file is None:
        logging.error("Exiting — could not acquire facebook cache lock.")
        return

    try:
        previous_ids_list = load_cache(cache_file)
        previous_ids = set(previous_ids_list)
        is_seed_run = len(previous_ids) == 0

        listings = fetch_listings(queries, locations, price)

        # Rolling history (max 1000 ids — several searches per run), newest last.
        seen = {}
        for listing_id in previous_ids_list:
            seen[listing_id] = None
        for listing in reversed(listings):
            listing_id = str(listing["id"])
            seen.pop(listing_id, None)
            seen[listing_id] = None
        current_ids = list(seen.keys())[-1000:]

        new_listings = [l for l in listings if str(l["id"]) not in previous_ids]
        print(f"[facebook] {len(new_listings)} new items (out of {len(listings)} total)")

        if is_seed_run and new_listings:
            print(f"🌱 [facebook] First run — seeding cache with {len(listings)} items. Skipped Telegram.")
            save_cache(cache_file, current_ids)
            return

        out = []
        for listing in new_listings:
            if listing.get("is_sold") or listing.get("is_pending"):
                continue
            price_value = listing_price_dollars(listing)
            if not price_value:  # free / no price — cannot be graded
                continue
            title = listing.get("marketplace_listing_title") or listing.get("custom_title") or ""
            keyword, grade = check_description(config, title, str(price_value), title)
            if keyword:
                out.append({
                    "title":    title,
                    "price":    price_value,
                    "location": listing_location(listing),
                    "url":      f"https://www.facebook.com/marketplace/item/{listing['id']}/",
                    "keyword":  keyword,
                    "grade":    grade,
                })

        # Save cache before sending (same crash-safety rationale as the eBay run).
        save_cache(cache_file, current_ids)

        if out and not source_enabled("facebook"):
            print(f"⏭️  [facebook] Facebook disabled during run — {len(out)} matches not sent")
        elif out:
            print(f"[facebook] Found {len(out)} matching items.")
            send_telegram_facebook(config, out)
        else:
            print("[facebook] No matching items found.")
    finally:
        release_lock(lock_file)


def _as_list(value) -> list:
    if value is None:
        return []
    if not isinstance(value, list):
        value = [value]
    return [str(v).strip() for v in value if str(v).strip()]


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python facebook_scrapper.py <path_to_config>")
        sys.exit(1)

    config_path = Path(sys.argv[1])
    if not config_path.suffix:
        config_path = config_path.with_suffix(".yml")
    if not config_path.exists():
        print(f"❌ Config file not found: {config_path}")
        sys.exit(1)

    config_dict = load_config(str(config_path))
    queries = _as_list(config_dict.get("facebook_queries"))
    locations = _as_list(config_dict.get("facebook_locations"))
    if not queries or not locations:
        # run.sh never overwrites an existing /data/configs file, so Facebook keys
        # added to a bundled config do not reach a config already on the volume.
        bundled = Path(__file__).resolve().parent / "configs" / config_path.name
        if bundled.exists() and bundled.resolve() != config_path.resolve():
            if load_config(str(bundled)).get("facebook_queries"):
                print(f"⚠️  [facebook] {config_path.name}: facebook_queries/facebook_locations "
                      f"missing here but present in bundled {bundled} — copy them into this config")
        sys.exit(0)  # config not opted in to Facebook — nothing to do
    if not source_enabled("facebook"):
        print("⏭️  Facebook source disabled (web UI)")
        sys.exit(0)

    interval = int(config_dict.get("facebook_interval") or DEFAULT_INTERVAL)
    stamp_file = DATA_DIR / "cache" / f"facebook_{config_path.stem}_lastrun"
    if not due(stamp_file, interval):
        sys.exit(0)  # ran less than `interval` seconds ago
    mark_run(stamp_file)

    price = str(config_dict.get("facebook_price") or "").strip()

    config = build_config(config_dict, config_path)
    run(config, queries, locations, price)
