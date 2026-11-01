from aiogram import Router
from html import escape
from aiogram.filters import Command
from aiogram.types import Message
from ..db import connect

router = Router()

@router.message(Command('leaderboard'))
async def leaderboard(message: Message):
    async with await connect() as db:
        cur = await db.execute('''SELECT u.full_name, SUM(s.score) score FROM sessions s JOIN users u ON u.id=s.user_id
            WHERE s.completed=1 AND u.private=0 GROUP BY u.id ORDER BY score DESC, u.full_name LIMIT 20''')
        rows = await cur.fetchall()
    if not rows: return await message.answer('Рейтинг пока пуст. Стань первым участником!')
    text = ['🏆 <b>Рейтинг @ilovemoovie</b>']
    text += [f'{i}. {escape(r["full_name"])} — {r["score"]} баллов' for i, r in enumerate(rows, 1)]
    await message.answer('\n'.join(text), parse_mode='HTML')
