"""Central config: loads secrets/settings from environment (.env in dev)."""
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent

# --- Required ---
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

# Telegram user ID(s) allowed to talk to the bot. Leave empty during first
# run to discover your ID (the bot will log/echo it), then lock it down.
OWNER_CHAT_ID = os.environ.get("OWNER_CHAT_ID", "")

# --- Optional data sources (features degrade gracefully if unset) ---
NEWS_API_KEY = os.environ.get("NEWS_API_KEY", "")  # https://newsapi.org
ADZUNA_APP_ID = os.environ.get("ADZUNA_APP_ID", "")  # https://developer.adzuna.com
ADZUNA_APP_KEY = os.environ.get("ADZUNA_APP_KEY", "")

# --- Behavior ---
CLAUDE_MODEL = os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-5-20250929")
TIMEZONE = os.environ.get("TIMEZONE", "America/New_York")
DAILY_DIGEST_TIME = os.environ.get("DAILY_DIGEST_TIME", "07:30")  # HH:MM, local TIMEZONE

# Topics used for the daily news/sports/business digest. Edit freely.
DIGEST_TOPICS = [t.strip() for t in os.environ.get(
    "DIGEST_TOPICS",
    "AI and data engineering, data privacy regulation, cricket, "
    "stock market and interest rates"
).split(",") if t.strip()]

# Tickers/sectors to watch for the market alert section (comma-separated).
WATCHLIST = [t.strip() for t in os.environ.get("WATCHLIST", "^GSPC,^IXIC,AAPL,MSFT").split(",") if t.strip()]

# Default job-search terms/location, used when /jobs is called with no args.
DEFAULT_JOB_QUERY = os.environ.get("DEFAULT_JOB_QUERY", "data quality engineer")
DEFAULT_JOB_LOCATION = os.environ.get("DEFAULT_JOB_LOCATION", "remote")

DB_PATH = os.environ.get("DB_PATH", str(BASE_DIR / "assistant.db"))
PERSONA_PATH = BASE_DIR / "persona.md"


def require_core_config() -> None:
    missing = [name for name, val in (
        ("TELEGRAM_BOT_TOKEN", TELEGRAM_BOT_TOKEN),
        ("ANTHROPIC_API_KEY", ANTHROPIC_API_KEY),
    ) if not val]
    if missing:
        raise RuntimeError(
            f"Missing required environment variables: {', '.join(missing)}. "
            "Copy .env.example to .env and fill them in."
        )
