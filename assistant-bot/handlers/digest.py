from telegram import Update
from telegram.ext import ContextTypes

from handlers.util import owner_only
from services import llm, market, news


def build_digest_text() -> str:
    headlines_by_topic = news.fetch_digest_material()
    movers = market.watchlist_snapshot()

    if not any(headlines_by_topic.values()) and not movers:
        return (
            "Digest sources aren't configured yet (NEWS_API_KEY missing, and "
            "no market data came back). Set NEWS_API_KEY in .env to enable "
            "the news/sports/business summary."
        )

    material_lines = []
    for topic, articles in headlines_by_topic.items():
        if not articles:
            continue
        material_lines.append(f"## {topic}")
        for a in articles:
            material_lines.append(f"- {a['title']} ({a['source']}) {a['url']}")

    if movers:
        material_lines.append("## Market watchlist")
        for m in movers:
            material_lines.append(f"- {m['symbol']}: {m['price']} ({m['pct_change']:+.2f}%)")

    material = "\n".join(material_lines) or "No fresh material today."

    return llm.generate(
        system_suffix=(
            "Write today's personal briefing from the raw material below. "
            "Sections: News & Business, Sports (if present), Market Watch. "
            "For Market Watch, describe moves factually — never recommend "
            "buying/selling or imply you placed or will place any trade. "
            "3-6 tight bullet points total across sections, plain text with "
            "simple '- ' bullets (Telegram, no markdown headers), no fluff, "
            "no sign-off."
        ),
        user_prompt=material,
        max_tokens=600,
    )


@owner_only
async def digest_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.effective_message.reply_text("Pulling today's digest…")
    text = build_digest_text()
    await update.effective_message.reply_text(text)
