"""Entrypoint: wires Telegram commands + background scheduler together.

Run locally with:  python bot.py
(Uses long polling — no public URL/webhook needed.)
"""
import logging

from telegram.ext import Application, CommandHandler

import config
import db
from handlers import activities, core, digest, jobs, reminders
from scheduler import setup_scheduler

logging.basicConfig(
    format="%(asctime)s %(levelname)s %(name)s: %(message)s", level=logging.INFO
)
logger = logging.getLogger("assistant-bot")


def build_application() -> Application:
    config.require_core_config()
    db.init_db()

    application = Application.builder().token(config.TELEGRAM_BOT_TOKEN).build()

    application.add_handler(CommandHandler("start", core.start))
    application.add_handler(CommandHandler("help", core.help_cmd))

    application.add_handler(CommandHandler("digest", digest.digest_cmd))

    application.add_handler(CommandHandler("remind", reminders.remind_cmd))
    application.add_handler(CommandHandler("reminders", reminders.reminders_cmd))
    application.add_handler(CommandHandler("schedule", reminders.schedule_cmd))
    application.add_handler(CommandHandler("agenda", reminders.agenda_cmd))

    application.add_handler(CommandHandler("log", activities.log_cmd))
    application.add_handler(CommandHandler("activities", activities.activities_cmd))

    application.add_handler(CommandHandler("jobs", jobs.jobs_cmd))
    application.add_handler(CommandHandler("draft", jobs.draft_cmd))

    application.post_init = _on_startup
    return application


async def _on_startup(application: Application) -> None:
    setup_scheduler(application)
    logger.info("Scheduler started (daily digest %s %s).", config.DAILY_DIGEST_TIME, config.TIMEZONE)
    if not config.OWNER_CHAT_ID:
        logger.warning(
            "OWNER_CHAT_ID is not set — message the bot once to discover your "
            "chat ID, then set it and restart."
        )


def main() -> None:
    application = build_application()
    logger.info("Bot starting (long polling)...")
    application.run_polling(allowed_updates=["message"])


if __name__ == "__main__":
    main()
