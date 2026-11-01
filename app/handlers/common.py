from aiogram import Router
from aiogram.filters import CommandStart, Command
from aiogram.types import Message
from ..db import connect, now

router = Router()

@router.message(CommandStart())
async def start(message: Message):
    parts = (message.text or '').split(maxsplit=1)
    if len(parts) == 2 and parts[1].startswith('quiz_'):
        try: quiz_id = int(parts[1][5:])
        except ValueError: return await message.answer('Некорректная ссылка на викторину.')
        from .game import begin_quiz
        return await begin_quiz(message, quiz_id)
    async with await connect() as db:
        await db.execute('INSERT INTO users(id,username,full_name,created_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET username=excluded.username, full_name=excluded.full_name',
                          (message.from_user.id, message.from_user.username, message.from_user.full_name, now()))
        await db.commit()
    await message.answer('Привет! Я бот закрытых кино-викторин канала @ilovemoovie. Открой ссылку под постом с викториной, чтобы начать игру.\n\nКоманды: /leaderboard — рейтинг, /privacy — скрыть имя в рейтинге.')

@router.message(Command('privacy'))
async def privacy(message: Message):
    async with await connect() as db:
        await db.execute('UPDATE users SET private=CASE private WHEN 0 THEN 1 ELSE 0 END WHERE id=?', (message.from_user.id,))
        await db.commit()
        cur = await db.execute('SELECT private FROM users WHERE id=?', (message.from_user.id,))
        row = await cur.fetchone()
    if not row:
        await message.answer('Сначала отправь /start.')
    else:
        await message.answer('Твоё имя скрыто в рейтинге.' if row['private'] else 'Твоё имя снова отображается в рейтинге.')
