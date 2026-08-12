# Personal assistant bot (Telegram)

A Telegram bot that acts as your personal assistant:

- **Daily digest** — news/business/sports headlines + a market watchlist snapshot, summarized once a day (and on demand with `/digest`).
- **Reminders** — `/remind in 20m call the recruiter`.
- **Schedule/agenda** — `/schedule tomorrow 2pm 1:1 with manager`, `/agenda`.
- **Activity log** — `/log shipped the data quality report`, `/activities`.
- **Job search** — `/jobs data quality engineer | remote`.
- **Outreach drafts** — `/draft recruiter at Acme for a Senior DQ Engineer role` writes a message in your voice from `persona.md`. **It only ever returns a draft in chat — it never sends anything to anyone on its own.**
- **Market data is informational only** — it never places trades or touches a brokerage account.

Everything is gated to a single Telegram chat ID (you). Anyone else messaging the bot is silently ignored.

## 1. Get your credentials (~10 minutes)

You said you don't have any of these yet — here's the fastest path to each:

1. **Telegram bot token** — open Telegram, message [@BotFather](https://t.me/BotFather), send `/newbot`, follow the prompts. It gives you a token like `123456:ABC-...`. That's `TELEGRAM_BOT_TOKEN`.
2. **Anthropic API key** — sign up at [console.anthropic.com](https://console.anthropic.com), create an API key under *API Keys*. That's `ANTHROPIC_API_KEY`. (Pay-as-you-go; a personal bot like this costs well under $5/month at normal usage.)
3. **Your Telegram chat ID** (`OWNER_CHAT_ID`) — leave it blank for now. Once the bot is running, send it any message and it will reply with your chat ID. Put that in `.env` (or your host's env vars) and restart — after that, only you can use the bot.
4. *(Optional)* **NewsAPI key** — free tier at [newsapi.org](https://newsapi.org/register), enables the news/business part of the digest. Without it, the digest just skips that section.
5. *(Optional)* **Adzuna job search keys** — free at [developer.adzuna.com](https://developer.adzuna.com), enables `/jobs`. Without it, `/jobs` tells you it's not configured.

Copy `.env.example` to `.env` and fill in what you have:

```bash
cp .env.example .env
```

## 2. Make it sound like you

Open `persona.md` and:

- Fill in the "Sample writing" section with 2-3 real emails/messages you've sent. This is what actually makes drafts sound like you, not just a bio.
- Adjust the bio/writing-style notes if anything's off (it's pre-filled from your site).

## 3. Run it

### Locally (simplest — good for trying it out)

```bash
pip install -r requirements.txt
python bot.py
```

It uses long polling, so no public URL or webhook setup is needed. Message your bot on Telegram to start.

### Always-on hosting (so it survives your laptop being off)

The easiest free/cheap option is **Railway**:

1. Push this repo to GitHub (it already is, if you're reading this from the repo).
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub repo → pick this repo, set the **root directory to `assistant-bot`**.
3. Railway auto-detects the `Procfile`/`Dockerfile`. Add your `.env` values under Project → Variables.
4. Deploy. Check logs for "Bot starting (long polling)...".

**Render** works the same way (New → Background Worker, root dir `assistant-bot`, uses the `Dockerfile`).

Either way, on a free/starter tier this runs comfortably 24/7.

### Docker (any VPS)

```bash
docker build -t assistant-bot .
docker run -d --env-file .env -v $(pwd)/data:/app/data -e DB_PATH=/app/data/assistant.db assistant-bot
```

## Notes on scope (by design, not a limitation to work around)

- **Outreach is draft-only.** `/draft` never sends a message to anyone — it returns text for you to copy, edit, and send yourself.
- **Market data is alerts/summary only.** It reads public price data (`yfinance`, no account needed) and never executes trades.
- **Single-user, chat-ID-locked.** There's no multi-user auth system because this is meant to be yours only.

If you later want it to actually send outreach messages, sync a real calendar (Google Calendar), or place trades, those are meaningfully bigger (and riskier) changes — worth a separate conversation before building, not a silent scope expansion.
