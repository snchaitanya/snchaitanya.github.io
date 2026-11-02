#!/usr/bin/env python3
"""Build the Daily Brief data file (daily/data/latest.json + a dated archive copy).

Pulls the top headlines for each section from public RSS feeds. Google News is
tried first because its ordering reflects what is "top" right now; well-known
publisher feeds are used as fallbacks when Google rate-limits the runner.

Standard library only, so the GitHub Action needs no pip install.
"""

from __future__ import annotations

import email.utils
import html
import json
import re
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "daily" / "data"
TZ = ZoneInfo("America/Los_Angeles")  # the "7 AM" the report is built for
PER_SECTION = 3
ARCHIVE_DAYS = 30

GN_US = "hl=en-US&gl=US&ceid=US:en"
GN_IN = "hl=en-IN&gl=IN&ceid=IN:en"


def gn_topic(topic: str, locale: str = GN_US) -> str:
    return f"https://news.google.com/rss/headlines/section/topic/{topic}?{locale}"


def gn_search(query: str, locale: str = GN_US) -> str:
    q = urllib.request.quote(f"{query} when:1d")
    return f"https://news.google.com/rss/search?q={q}&{locale}"


# Order on the page == order here.
SECTIONS = [
    {
        "id": "world",
        "title": "World",
        "feeds": [
            gn_topic("WORLD"),
            "https://feeds.bbci.co.uk/news/world/rss.xml",
            "https://www.aljazeera.com/xml/rss/all.xml",
        ],
    },
    {
        "id": "usa",
        "title": "USA",
        "feeds": [
            gn_topic("NATION"),
            f"https://news.google.com/rss?{GN_US}",
            "https://feeds.npr.org/1003/rss.xml",
            "https://rss.nytimes.com/services/xml/rss/nyt/US.xml",
        ],
    },
    {
        "id": "india",
        "title": "India",
        "feeds": [
            gn_topic("NATION", GN_IN),
            f"https://news.google.com/rss?{GN_IN}",
            "https://www.thehindu.com/news/national/feeder/default.rss",
            "https://indianexpress.com/section/india/feed/",
        ],
    },
    {
        "id": "andhra",
        "title": "Andhra Pradesh",
        "feeds": [
            gn_search("Andhra Pradesh", GN_IN),
            "https://www.thehindu.com/news/national/andhra-pradesh/feeder/default.rss",
            "https://indianexpress.com/section/cities/andhra-pradesh/feed/",
        ],
    },
    {
        "id": "business",
        "title": "Business",
        "feeds": [
            gn_topic("BUSINESS"),
            "https://feeds.bbci.co.uk/news/business/rss.xml",
            "https://www.cnbc.com/id/100003114/device/rss/rss.html",
        ],
    },
    {
        "id": "sports",
        "title": "Sports",
        "feeds": [
            gn_topic("SPORTS"),
            "https://www.espn.com/espn/rss/news",
            "https://feeds.bbci.co.uk/sport/rss.xml",
        ],
    },
    {
        "id": "entertainment",
        "title": "Pop Culture & Entertainment",
        "feeds": [
            gn_topic("ENTERTAINMENT"),
            "https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml",
            "https://variety.com/feed/",
        ],
    },
]

UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36 DailyBrief/1.0"
)
TAG_RE = re.compile(r"<[^>]+>")


def fetch(url: str, attempts: int = 2) -> bytes | None:
    for i in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=20) as resp:
                body = resp.read()
            if b"<rss" in body[:2000] or b"<feed" in body[:2000]:
                return body
        except Exception as exc:  # noqa: BLE001 - any failure -> try next feed
            print(f"  ! {url[:80]} -> {exc}", file=sys.stderr)
        time.sleep(1.5 * (i + 1))
    return None


def clean(text: str | None) -> str:
    if not text:
        return ""
    return re.sub(r"\s+", " ", html.unescape(TAG_RE.sub(" ", text))).strip()


def parse(body: bytes, feed_url: str) -> list[dict]:
    try:
        root = ET.fromstring(body)
    except ET.ParseError:
        return []
    is_google = "news.google.com" in feed_url
    channel_title = clean(root.findtext("channel/title"))
    items = []
    for it in root.iter("item"):
        title = clean(it.findtext("title"))
        link = (it.findtext("link") or "").strip()
        if not title or not link:
            continue
        source = clean(it.findtext("source")) or channel_title
        summary = "" if is_google else clean(it.findtext("description"))
        # Google News titles look like "Headline - Publisher".
        if is_google and " - " in title:
            head, _, pub = title.rpartition(" - ")
            title, source = head.strip(), (source or pub.strip())
        published = None
        if it.findtext("pubDate"):
            try:
                published = email.utils.parsedate_to_datetime(
                    it.findtext("pubDate")
                ).astimezone(timezone.utc).isoformat()
            except (TypeError, ValueError):
                pass
        items.append(
            {
                "title": title,
                "link": link,
                "source": source,
                "summary": summary[:240],
                "published": published,
            }
        )
    return items


def norm(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", title.lower()).strip()[:80]


def build_section(section: dict, seen: set[str]) -> dict:
    picked: list[dict] = []
    for url in section["feeds"]:
        if len(picked) >= PER_SECTION:
            break
        body = fetch(url)
        if not body:
            continue
        for item in parse(body, url):
            key = norm(item["title"])
            if key in seen:
                continue
            seen.add(key)
            picked.append(item)
            if len(picked) >= PER_SECTION:
                break
    print(f"{section['title']}: {len(picked)} headlines", file=sys.stderr)
    return {"id": section["id"], "title": section["title"], "items": picked}


def main() -> int:
    now = datetime.now(TZ)
    seen: set[str] = set()  # avoid the same story appearing in two sections
    sections = [build_section(s, seen) for s in SECTIONS]
    if sum(len(s["items"]) for s in sections) == 0:
        print("No headlines fetched; keeping previous report.", file=sys.stderr)
        return 1

    report = {
        "date": now.date().isoformat(),
        "generated_at": now.isoformat(timespec="minutes"),
        "timezone": str(TZ),
        "sections": sections,
    }
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(report, ensure_ascii=False, indent=1)
    (DATA_DIR / "latest.json").write_text(payload + "\n", encoding="utf-8")
    (DATA_DIR / f"{report['date']}.json").write_text(payload + "\n", encoding="utf-8")

    # Keep a rolling archive and an index the page uses for its date picker.
    dated = sorted(DATA_DIR.glob("????-??-??.json"), reverse=True)
    for old in dated[ARCHIVE_DAYS:]:
        old.unlink()
    days = [p.stem for p in dated[:ARCHIVE_DAYS]]
    (DATA_DIR / "index.json").write_text(json.dumps({"days": days}) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
