import os
from datetime import datetime, timezone
import aiosqlite
from .config import config

SCHEMA = '''
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY, username TEXT, full_name TEXT NOT NULL, private INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS quizzes (
 id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
 created_at TEXT NOT NULL, published_at TEXT, ends_at TEXT, channel_message_id INTEGER
);
CREATE TABLE IF NOT EXISTS questions (
 id INTEGER PRIMARY KEY AUTOINCREMENT, quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
 position INTEGER NOT NULL, prompt TEXT NOT NULL, answer TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS aliases (
 id INTEGER PRIMARY KEY AUTOINCREMENT, question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
 alias TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id), quiz_id INTEGER NOT NULL REFERENCES quizzes(id),
 question_pos INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0, score INTEGER NOT NULL DEFAULT 0,
 started_at TEXT NOT NULL, expires_at TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0,
 UNIQUE(user_id, quiz_id)
);
CREATE TABLE IF NOT EXISTS answers (
 id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER NOT NULL REFERENCES sessions(id), question_id INTEGER NOT NULL REFERENCES questions(id),
 attempt INTEGER NOT NULL, answer TEXT NOT NULL, correct INTEGER NOT NULL, created_at TEXT NOT NULL
);
'''

async def connect():
    os.makedirs(os.path.dirname(config.database_path) or '.', exist_ok=True)
    db = await aiosqlite.connect(config.database_path)
    db.row_factory = aiosqlite.Row
    await db.execute('PRAGMA foreign_keys=ON')
    return db

async def init_db():
    async with await connect() as db:
        await db.executescript(SCHEMA)
        await db.commit()

def now():
    return datetime.now(timezone.utc).isoformat()
