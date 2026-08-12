"""SQLite storage for reminders, schedule entries, and activity log.

Single-user bot: no user_id columns needed, everything belongs to OWNER_CHAT_ID.
"""
import sqlite3
from contextlib import contextmanager
from datetime import datetime

import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    due_at TEXT NOT NULL,      -- ISO 8601, local naive time
    sent INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schedule (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    starts_at TEXT NOT NULL,   -- ISO 8601, local naive time
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    logged_at TEXT NOT NULL
);
"""


@contextmanager
def get_conn():
    conn = sqlite3.connect(config.DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with get_conn() as conn:
        conn.executescript(SCHEMA)


# --- Reminders ---

def add_reminder(text: str, due_at: datetime) -> int:
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO reminders (text, due_at, created_at) VALUES (?, ?, ?)",
            (text, due_at.isoformat(), datetime.now().isoformat()),
        )
        return cur.lastrowid


def list_upcoming_reminders():
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM reminders WHERE sent = 0 ORDER BY due_at ASC"
        ).fetchall()


def due_reminders(now: datetime):
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM reminders WHERE sent = 0 AND due_at <= ? ORDER BY due_at ASC",
            (now.isoformat(),),
        ).fetchall()


def mark_reminder_sent(reminder_id: int) -> None:
    with get_conn() as conn:
        conn.execute("UPDATE reminders SET sent = 1 WHERE id = ?", (reminder_id,))


# --- Schedule / agenda ---

def add_schedule_entry(title: str, starts_at: datetime, notes: str = "") -> int:
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO schedule (title, starts_at, notes, created_at) VALUES (?, ?, ?, ?)",
            (title, starts_at.isoformat(), notes, datetime.now().isoformat()),
        )
        return cur.lastrowid


def list_schedule(from_dt: datetime, to_dt: datetime):
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM schedule WHERE starts_at BETWEEN ? AND ? ORDER BY starts_at ASC",
            (from_dt.isoformat(), to_dt.isoformat()),
        ).fetchall()


# --- Activities ---

def log_activity(text: str) -> int:
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO activities (text, logged_at) VALUES (?, ?)",
            (text, datetime.now().isoformat()),
        )
        return cur.lastrowid


def recent_activities(limit: int = 20):
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM activities ORDER BY logged_at DESC LIMIT ?", (limit,)
        ).fetchall()
