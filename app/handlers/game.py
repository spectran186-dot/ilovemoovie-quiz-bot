from datetime import datetime, timedelta, timezone
from html import escape
from aiogram import Router
from aiogram.types import Message
from aiogram.filters import Command
from ..db import connect, now
from ..config import config
from ..utils import is_correct

router = Router()
POINTS = {1: 10, 2: 7, 3: 4}

def parse_dt(value):
    return datetime.fromisoformat(value)

async def begin_quiz(message: Message, quiz_id: int):
    uid = message.from_user.id
    async with await connect() as db:
        await db.execute('INSERT INTO users(id,username,full_name,created_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET username=excluded.username,full_name=excluded.full_name',
                         (uid, message.from_user.username, message.from_user.full_name, now()))
        cur = await db.execute('SELECT * FROM quizzes WHERE id=? AND status="published"', (quiz_id,))
        quiz = await cur.fetchone()
        if not quiz: return await message.answer('Эта викторина не найдена или ещё не опубликована.')
        if parse_dt(quiz['ends_at']) <= datetime.now(timezone.utc): return await message.answer('Время этой викторины уже закончилось.')
        cur = await db.execute('SELECT * FROM sessions WHERE user_id=? AND quiz_id=?', (uid, quiz_id))
        session = await cur.fetchone()
        if session and session['completed']: return await message.answer(f'Ты уже завершил эту викторину. Результат: {session["score"]} баллов.')
        if not session:
            expiry = datetime.now(timezone.utc) + timedelta(minutes=config.session_minutes)
            await db.execute('INSERT INTO sessions(user_id,quiz_id,started_at,expires_at) VALUES(?,?,?,?)', (uid, quiz_id, now(), expiry.isoformat()))
            await db.commit()
        else:
            await db.execute('UPDATE sessions SET expires_at=? WHERE id=?', ((datetime.now(timezone.utc)+timedelta(minutes=config.session_minutes)).isoformat(), session['id']))
            await db.commit()
    await send_question(message, quiz_id)

async def send_question(message: Message, quiz_id: int):
    async with await connect() as db:
        cur = await db.execute('SELECT * FROM sessions WHERE user_id=? AND quiz_id=?', (message.from_user.id, quiz_id)); s = await cur.fetchone()
        cur = await db.execute('SELECT * FROM questions WHERE quiz_id=? ORDER BY position', (quiz_id,)); qs = await cur.fetchall()
    if not s or s['completed']: return
    if s['question_pos'] >= len(qs):
        async with await connect() as db:
            await db.execute('UPDATE sessions SET completed=1 WHERE id=?', (s['id'],)); await db.commit()
        return await message.answer(f'🎉 Викторина завершена! Твой результат: {s["score"]} баллов.\n/leaderboard — общий рейтинг.')
    q = qs[s['question_pos']]
    await message.answer(f'🎬 <b>Вопрос {s["question_pos"]+1} из {len(qs)}</b>\n{escape(q["prompt"])}\n\nУ тебя 3 попытки. Напиши название фильма.', parse_mode='HTML')

@router.message(Command('cancel'))
async def cancel_game(message: Message):
    await message.answer('Текущая игра сохранена. Чтобы продолжить, открой ссылку викторины ещё раз.')

@router.message()
async def answer(message: Message):
    if not message.text or message.text.startswith('/'): return
    uid = message.from_user.id
    async with await connect() as db:
        cur = await db.execute('''SELECT s.*,q.id qid,q.answer,q.prompt FROM sessions s JOIN questions q ON q.quiz_id=s.quiz_id AND q.position=s.question_pos
            WHERE s.user_id=? AND s.completed=0 ORDER BY s.started_at DESC LIMIT 1''', (uid,)); row = await cur.fetchone()
        if not row: return
        if parse_dt(row['expires_at']) <= datetime.now(timezone.utc):
            await db.execute('UPDATE sessions SET completed=1 WHERE id=?', (row['id'],)); await db.commit()
            return await message.answer('Время игровой сессии истекло. Повторно открой ссылку викторины, чтобы проверить статус.')
        cur = await db.execute('SELECT alias FROM aliases WHERE question_id=?', (row['qid'],)); aliases = [x['alias'] for x in await cur.fetchall()]
        accepted = [row['answer'], *aliases]
        attempt = row['attempts'] + 1
        correct = is_correct(message.text, accepted)
        await db.execute('INSERT INTO answers(session_id,question_id,attempt,answer,correct,created_at) VALUES(?,?,?,?,?,?)', (row['id'],row['qid'],attempt,message.text,int(correct),now()))
        if correct:
            score = row['score'] + POINTS[attempt]
            await db.execute('UPDATE sessions SET score=?,question_pos=question_pos+1,attempts=0 WHERE id=?', (score,row['id']))
            await db.commit()
            await message.answer(f'✅ Верно! +{POINTS[attempt]} баллов. Всего: {score}.')
            return await send_question(message, row['quiz_id'])
        if attempt >= 3:
            await db.execute('UPDATE sessions SET question_pos=question_pos+1,attempts=0 WHERE id=?', (row['id'],))
            await db.commit()
            await message.answer(f'❌ Попытки закончились. Правильный ответ: <b>{escape(row["answer"])}</b>.', parse_mode='HTML')
            return await send_question(message, row['quiz_id'])
        await db.execute('UPDATE sessions SET attempts=? WHERE id=?', (attempt,row['id']))
        await db.commit()
    await message.answer(f'❌ Не угадал. Осталось попыток: {3-attempt}. Попробуй ещё раз.')
