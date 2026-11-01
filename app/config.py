import os
from dataclasses import dataclass
from dotenv import load_dotenv

load_dotenv()

@dataclass(frozen=True)
class Config:
    bot_token: str = os.getenv('BOT_TOKEN', '')
    admin_ids: tuple[int, ...] = tuple(int(x.strip()) for x in os.getenv('ADMIN_IDS', '').split(',') if x.strip())
    channel_id: str = os.getenv('CHANNEL_ID', '')
    channel_username: str = os.getenv('CHANNEL_USERNAME', '').lstrip('@')
    quiz_hours: int = int(os.getenv('QUIZ_HOURS', '48'))
    session_minutes: int = int(os.getenv('SESSION_MINUTES', '20'))
    database_path: str = os.getenv('DATABASE_PATH', 'data/quiz.sqlite3')

config = Config()
