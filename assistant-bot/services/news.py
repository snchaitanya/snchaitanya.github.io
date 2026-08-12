"""Fetch headlines for the daily digest via NewsAPI (https://newsapi.org).

Degrades to an empty list (not an error) if NEWS_API_KEY isn't set, so the
rest of the digest still sends.
"""
import requests

import config

NEWS_API_URL = "https://newsapi.org/v2/everything"


def fetch_headlines(topic: str, page_size: int = 5) -> list[dict]:
    if not config.NEWS_API_KEY:
        return []
    try:
        resp = requests.get(
            NEWS_API_URL,
            params={
                "q": topic,
                "sortBy": "publishedAt",
                "language": "en",
                "pageSize": page_size,
                "apiKey": config.NEWS_API_KEY,
            },
            timeout=10,
        )
        resp.raise_for_status()
        articles = resp.json().get("articles", [])
        return [
            {"title": a["title"], "source": a["source"]["name"], "url": a["url"]}
            for a in articles
        ]
    except requests.RequestException:
        return []


def fetch_digest_material() -> dict[str, list[dict]]:
    """One headline batch per configured topic."""
    return {topic: fetch_headlines(topic) for topic in config.DIGEST_TOPICS}
