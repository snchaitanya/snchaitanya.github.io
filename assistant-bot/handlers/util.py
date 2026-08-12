"""Shared helpers for handlers: owner-only guard and natural-language time
parsing for reminders/schedule entries."""
import functools
import re
from datetime import datetime, timedelta

from dateutil import parser as dateutil_parser
from telegram import Update
from telegram.ext import ContextTypes

import config

_RELATIVE_RE = re.compile(r"^in\s+(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$", re.I)

_UNIT_MINUTES = {
    "m": 1, "min": 1, "mins": 1, "minute": 1, "minutes": 1,
    "h": 60, "hr": 60, "hrs": 60, "hour": 60, "hours": 60,
    "d": 1440, "day": 1440, "days": 1440,
}

# dateutil has no notion of "today"/"tomorrow" — it silently drops unknown
# words in fuzzy mode instead of erroring, so these have to be handled first.
_DAY_WORDS = {"today": 0, "tonight": 0, "tomorrow": 1}


def owner_only(handler):
    """Reject anyone but OWNER_CHAT_ID. If OWNER_CHAT_ID is unset, allow the
    first sender through and tell them their chat_id so they can lock it down.
    """
    @functools.wraps(handler)
    async def wrapped(update: Update, context: ContextTypes.DEFAULT_TYPE, *a, **kw):
        chat_id = str(update.effective_chat.id)
        if not config.OWNER_CHAT_ID:
            await update.effective_message.reply_text(
                f"OWNER_CHAT_ID is not set yet. Your chat ID is {chat_id} — "
                "set OWNER_CHAT_ID to this value and restart the bot so only "
                "you can use it."
            )
            return
        if chat_id != str(config.OWNER_CHAT_ID):
            return  # silently ignore anyone else
        return await handler(update, context, *a, **kw)
    return wrapped


def parse_when(text: str) -> datetime:
    """Parse "in 20m", "in 2 hours", "tomorrow 9am", or an absolute
    date/time string into a datetime. Raises ValueError if unparseable.
    """
    text = text.strip()
    m = _RELATIVE_RE.match(text)
    if m:
        amount, unit = int(m.group(1)), m.group(2).lower()
        return datetime.now() + timedelta(minutes=amount * _UNIT_MINUTES[unit])

    day_offset = 0
    lowered = text.lower()
    for word, offset in _DAY_WORDS.items():
        if lowered.startswith(word):
            day_offset = offset
            text = text[len(word):].strip()
            break

    # Default any field the input doesn't specify (e.g. minute/second when
    # only "9am" is given) to the start of the target day, not "now" —
    # dateutil otherwise fills those from `default` verbatim, which would
    # make "tomorrow 9am" land at tomorrow-09:<current minute>.
    base_default = datetime.now().replace(hour=9, minute=0, second=0, microsecond=0)
    base_default += timedelta(days=day_offset)
    if not text:
        return base_default
    return dateutil_parser.parse(text, fuzzy=True, default=base_default)
