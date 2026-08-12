"""Job search via Adzuna (https://developer.adzuna.com) — free tier, no
scraping. Degrades to an empty list if ADZUNA_APP_ID/APP_KEY aren't set.
"""
import requests

import config

ADZUNA_URL = "https://api.adzuna.com/v1/api/jobs/us/search/1"


def search_jobs(query: str | None = None, location: str | None = None, results: int = 5) -> list[dict]:
    if not (config.ADZUNA_APP_ID and config.ADZUNA_APP_KEY):
        return []
    query = query or config.DEFAULT_JOB_QUERY
    location = location or config.DEFAULT_JOB_LOCATION
    try:
        resp = requests.get(
            ADZUNA_URL,
            params={
                "app_id": config.ADZUNA_APP_ID,
                "app_key": config.ADZUNA_APP_KEY,
                "what": query,
                "where": location,
                "results_per_page": results,
                "sort_by": "date",
            },
            timeout=10,
        )
        resp.raise_for_status()
        jobs = resp.json().get("results", [])
        return [
            {
                "title": j.get("title", "").strip(),
                "company": (j.get("company") or {}).get("display_name", "Unknown"),
                "location": (j.get("location") or {}).get("display_name", ""),
                "url": j.get("redirect_url", ""),
                "description": (j.get("description") or "")[:400],
            }
            for j in jobs
        ]
    except requests.RequestException:
        return []
