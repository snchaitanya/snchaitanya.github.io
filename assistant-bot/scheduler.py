"""Background jobs: the daily digest push and per-minute reminder polling."""
from datetime import datetime

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from telegram.ext import Application

import config
import db
from handlers.digest import build_digest_text


def setup_scheduler(application: Application) -> AsyncIOScheduler:
    scheduler = AsyncIOScheduler(timezone=config.TIMEZONE)

    hour, minute = (int(p) for p in config.DAILY_DIGEST_TIME.split(":"))
    scheduler.add_job(
        _send_daily_digest, CronTrigger(hour=hour, minute=minute), args=[application],
        id="daily_digest", replace_existing=True,
    )
    scheduler.add_job(
        _check_reminders, "interval", minutes=1, args=[application],
        id="reminder_poll", replace_existing=True,
    )
    scheduler.start()
    return scheduler


async def _send_daily_digest(application: Application) -> None:
    if not config.OWNER_CHAT_ID:
        return
    text = build_digest_text()
    await application.bot.send_message(chat_id=config.OWNER_CHAT_ID, text=text)


async def _check_reminders(application: Application) -> None:
    if not config.OWNER_CHAT_ID:
        return
    for r in db.due_reminders(datetime.now()):
        await application.bot.send_message(chat_id=config.OWNER_CHAT_ID, text=f"⏰ {r['text']}")
        db.mark_reminder_sent(r["id"])
