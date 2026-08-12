from telegram import Update
from telegram.ext import ContextTypes

from handlers.util import owner_only

HELP_TEXT = """\
*Personal assistant — commands*

*Digest*
/digest — send the news/sports/business + market digest right now

*Reminders*
/remind <when> <text> — e.g. `/remind in 20m call the recruiter`, \
`/remind tomorrow 9am submit report`
/reminders — list upcoming reminders

*Schedule*
/schedule <when> <title> — add an agenda item
/agenda — show today + tomorrow's schedule

*Activities*
/log <text> — log something you did
/activities — recent activity log

*Job search & outreach (draft-only, never auto-sent)*
/jobs <query> | <location> — search open roles matching your profile
/draft <context> — write an outreach message in your voice for you to review
"""


@owner_only
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.effective_message.reply_text(
        "Online. /help for what I can do.", parse_mode="Markdown"
    )


@owner_only
async def help_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.effective_message.reply_text(HELP_TEXT, parse_mode="Markdown")
