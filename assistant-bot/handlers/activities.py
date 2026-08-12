from datetime import datetime

from telegram import Update
from telegram.ext import ContextTypes

import db
from handlers.util import owner_only


@owner_only
async def log_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not context.args:
        await update.effective_message.reply_text("Usage: /log <what you did>")
        return
    text = " ".join(context.args)
    db.log_activity(text)
    await update.effective_message.reply_text("Logged.")


@owner_only
async def activities_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    rows = db.recent_activities()
    if not rows:
        await update.effective_message.reply_text("Nothing logged yet. Use /log <text>.")
        return
    lines = [
        f"- {datetime.fromisoformat(r['logged_at']).strftime('%a %b %d %H:%M')}: {r['text']}"
        for r in rows
    ]
    await update.effective_message.reply_text("\n".join(lines))
