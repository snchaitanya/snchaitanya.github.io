from telegram import Update
from telegram.ext import ContextTypes

from handlers.util import owner_only
from services import jobsearch, llm


@owner_only
async def jobs_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    raw = " ".join(context.args) if context.args else ""
    query, _, location = raw.partition("|")
    query, location = query.strip() or None, location.strip() or None

    results = jobsearch.search_jobs(query, location)
    if not results:
        await update.effective_message.reply_text(
            "No results — either ADZUNA_APP_ID/APP_KEY aren't set in .env, "
            "or nothing matched. Usage: /jobs data quality engineer | remote"
        )
        return

    lines = []
    for j in results:
        lines.append(f"*{j['title']}* — {j['company']} ({j['location']})\n{j['url']}")
    await update.effective_message.reply_text("\n\n".join(lines), parse_mode="Markdown")


@owner_only
async def draft_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Draft an outreach message in the user's voice. Never sends anything —
    only returns text in chat for manual review/copy/send.
    """
    if not context.args:
        await update.effective_message.reply_text(
            "Usage: /draft <who + context>  e.g. /draft recruiter at Acme Corp "
            "for a Senior Data Quality Engineer role, mention my CCAR/IFRS-9 background"
        )
        return
    context_text = " ".join(context.args)
    draft = llm.generate(
        system_suffix=(
            "Write a short outreach message (LinkedIn/email length, under 150 "
            "words) in my voice for the context given. This is a DRAFT ONLY — "
            "I will review and send it myself, so don't say it was AI-written "
            "and don't include placeholder brackets I'd forget to fill in; ask "
            "yourself what's missing and note it separately if something is."
        ),
        user_prompt=context_text,
        max_tokens=400,
    )
    await update.effective_message.reply_text(
        f"Draft (review before sending):\n\n{draft}"
    )
