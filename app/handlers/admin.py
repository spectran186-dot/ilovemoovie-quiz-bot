from datetime import datetime, timedelta, timezone
from html import escape
from aiogram import Router
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.types import Message
from ..config import config
from ..db import connect, now
from ..states import QuizCreation
from ..keyboards import quiz_link_keyboard

router = Router()
def is_admin(uid): return uid in config.admin_ids

@router.message(Command('newquiz'))
async def new_quiz(message: Message, state: FSMContext):
    if not is_admin(message.from_user.id): return
    await state.clear(); await state.set_state(QuizCreation.title)
    await message.answer('Создание викторины. Отправь её название.')

@router.message(QuizCreation.title)
async def title(message: Message, state: FSMContext):
    await state.update_data(title=message.text.strip(), questions=[])
    await state.set_state(QuizCreation.question_prompt)
    await message.answer('Отправь текст первого вопроса.')

@router.message(QuizCreation.question_prompt)
async def prompt(message: Message, state: FSMContext):
    await state.update_data(prompt=message.text.strip()); await state.set_state(QuizCreation.question_answer)
    await message.answer('Укажи правильный ответ — название фильма.')

@router.message(QuizCreation.question_answer)
async def answer(message: Message, state: FSMContext):
    await state.update_data(answer=message.text.strip()); await state.set_state(QuizCreation.question_aliases)
    await message.answer('Укажи альтернативные варианты ответа через ; или отправь —')

@router.message(QuizCreation.question_aliases)
async def aliases(message: Message, state: FSMContext):
    data = await state.get_data(); qs = data['questions']
    qs.append({'prompt':data['prompt'],'answer':data['answer'],'aliases':[] if message.text.strip()=='—' else [x.strip() for x in message.text.split(';') if x.strip()]})
    await state.update_data(questions=qs); await state.set_state(QuizCreation.more_questions)
    await message.answer(f'Вопросов добавлено: {len(qs)}. Отправь «+» для следующего вопроса или «готово» для сохранения.')

@router.message(QuizCreation.more_questions)
async def more(message: Message, state: FSMContext):
    if message.text.strip().lower() == '+':
        await state.set_state(QuizCreation.question_prompt); return await message.answer('Текст следующего вопроса.')
    if message.text.strip().lower() not in ('готово','готово!','done'):
        return await message.answer('Отправь «+» или «готово».')
    data = await state.get_data()
    if not data['questions']: return await message.answer('Добавь хотя бы один вопрос.')
    async with await connect() as db:
        cur = await db.execute('INSERT INTO quizzes(title,status,created_at) VALUES(?,?,?)', (data['title'],'draft',now()))
        qid = cur.lastrowid
        for i,q in enumerate(data['questions'],1):
            cur = await db.execute('INSERT INTO questions(quiz_id,position,prompt,answer) VALUES(?,?,?,?)',(qid,i,q['prompt'],q['answer']))
            for a in q['aliases']: await db.execute('INSERT INTO aliases(question_id,alias) VALUES(?,?)',(cur.lastrowid,a))
        await db.commit()
    await state.clear(); await message.answer(f'Черновик #{qid} «{data["title"]}» сохранён. Публикация: /publish {qid}')

@router.message(Command('publish'))
async def publish(message: Message):
    if not is_admin(message.from_user.id): return
    args=(message.text or '').split()
    if len(args)!=2 or not args[1].isdigit(): return await message.answer('Формат: /publish ID')
    qid=int(args[1])
    async with await connect() as db:
        cur=await db.execute('SELECT * FROM quizzes WHERE id=? AND status="draft"',(qid,)); quiz=await cur.fetchone()
        cur=await db.execute('SELECT COUNT(*) n FROM questions WHERE quiz_id=?',(qid,)); count=(await cur.fetchone())['n']
    if not quiz or not count: return await message.answer('Черновик не найден или в нём нет вопросов.')
    if not config.channel_id or not config.channel_username: return await message.answer('Сначала настрой CHANNEL_ID и CHANNEL_USERNAME в окружении.')
    ends=datetime.now(timezone.utc)+timedelta(hours=config.quiz_hours)
    text=f'🎬 <b>{escape(quiz["title"])}</b>\n\nНовая кино-викторина канала @ilovemoovie!\nВнутри {count} вопросов. На каждый — три попытки. Викторина доступна 48 часов.'
    sent=await message.bot.send_message(config.channel_id,text,parse_mode='HTML',reply_markup=quiz_link_keyboard(f'https://t.me/{(await message.bot.get_me()).username}?start=quiz_{qid}'))
    async with await connect() as db:
        await db.execute('UPDATE quizzes SET status="published",published_at=?,ends_at=?,channel_message_id=? WHERE id=?',(now(),ends.isoformat(),sent.message_id,qid)); await db.commit()
    await message.answer(f'Викторина #{qid} опубликована в канале.')

@router.message(Command('quizlist'))
async def quizlist(message: Message):
    if not is_admin(message.from_user.id): return
    async with await connect() as db:
        cur=await db.execute('SELECT id,title,status FROM quizzes ORDER BY id DESC LIMIT 20'); rows=await cur.fetchall()
    await message.answer('\n'.join(f'#{r["id"]} — {r["title"]} [{r["status"]}]' for r in rows) or 'Викторин пока нет.')
