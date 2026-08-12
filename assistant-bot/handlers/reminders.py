from datetime import datetime, timedelta

from telegram import Update
from telegram.ext import ContextTypes

import db
from handlers.util import owner_only, parse_when


@owner_only
async def remind_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not context.args:
        await update.effective_message.reply_text(
            "Usage: /remind <when> <text>  e.g. /remind in 20m call the recruiter"
        )
        return
    raw = " ".join(context.args)
    when_str, _, text = _split_when_and_text(raw)
    if not text:
        await update.effective_message.reply_text(
            "Couldn't find the reminder text. Usage: /remind <when> <text>"
        )
        return
    try:
        due_at = parse_when(when_str)
    except ValueError:
        await update.effective_message.reply_text(
            f"Couldn't parse the time '{when_str}'. Try 'in 20m' or 'tomorrow 9am'."
        )
        return
    db.add_reminder(text, due_at)
    await update.effective_message.reply_text(
        f"Reminder set for {due_at.strftime('%a %b %d, %H:%M')}: {text}"
    )


def _split_when_and_text(raw: str) -> tuple[str, str, str]:
    """Best-effort split of '<when> <text>' into (when, sep, text).

    Handles the 'in <n> <unit>' pattern explicitly, otherwise takes the
    first two whitespace-separated tokens as the "when" (e.g. 'tomorrow 9am').
    """
    parts = raw.split()
    if parts and parts[0].lower() == "in" and len(parts) >= 3:
        return " ".join(parts[:3]), " ", " ".join(parts[3:])
    if len(parts) >= 2:
        return " ".join(parts[:2]), " ", " ".join(parts[2:])
    return raw, "", ""


@owner_only
async def reminders_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    rows = db.list_upcoming_reminders()
    if not rows:
        await update.effective_message.reply_text("No upcoming reminders.")
        return
    lines = [
        f"- {datetime.fromisoformat(r['due_at']).strftime('%a %b %d, %H:%M')}: {r['text']}"
        for r in rows
    ]
    await update.effective_message.reply_text("\n".join(lines))


@owner_only
async def schedule_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not context.args:
        await update.effective_message.reply_text(
            "Usage: /schedule <when> <title>  e.g. /schedule tomorrow 2pm 1:1 with manager"
        )
        return
    raw = " ".join(context.args)
    when_str, _, title = _split_when_and_text(raw)
    if not title:
        await update.effective_message.reply_text(
            "Couldn't find a title. Usage: /schedule <when> <title>"
        )
        return
    try:
        starts_at = parse_when(when_str)
    except ValueError:
        await update.effective_message.reply_text(
            f"Couldn't parse the time '{when_str}'. Try 'tomorrow 2pm'."
        )
        return
    db.add_schedule_entry(title, starts_at)
    await update.effective_message.reply_text(
        f"Added to schedule: {starts_at.strftime('%a %b %d, %H:%M')} — {title}"
    )


@owner_only
async def agenda_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    now = datetime.now()
    rows = db.list_schedule(now - timedelta(hours=1), now + timedelta(days=2))
    if not rows:
        await update.effective_message.reply_text("Nothing on the schedule for today/tomorrow.")
        return
    lines = [
        f"- {datetime.fromisoformat(r['starts_at']).strftime('%a %b %d, %H:%M')}: {r['title']}"
        for r in rows
    ]
    await update.effective_message.reply_text("\n".join(lines))
