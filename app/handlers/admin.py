from datetime import datetime, timedelta, timezone
from html import escape

from aiogram import Router
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.types import Message

from ..config import config
from ..db import connect, now
from ..keyboards import quiz_link_keyboard
from ..states import QuizCreation

router = Router()


def is_admin(uid: int) -> bool:
    return uid in config.admin_ids


# All handlers in this router are restricted to configured administrators.
router.message.filter(lambda message: is_admin(message.from_user.id))


@router.message(Command("cancel"))
async def cancel_creation(message: Message, state: FSMContext):
    await state.clear()
    await message.answer("Создание викторины отменено. Черновик не сохранён.")


@router.message(Command("newquiz"))
async def new_quiz(message: Message, state: FSMContext):
    await state.clear()
    await state.set_state(QuizCreation.title)
    await message.answer("Создание викторины. Отправь её название.")


@router.message(QuizCreation.title)
async def title(message: Message, state: FSMContext):
    value = (message.text or "").strip()
    if not value:
        return await message.answer("Название не должно быть пустым. Отправь название викторины.")
    await state.update_data(title=value, questions=[])
    await state.set_state(QuizCreation.question_prompt)
    await message.answer("Отправь текст первого вопроса.")


@router.message(QuizCreation.question_prompt)
async def prompt(message: Message, state: FSMContext):
    value = (message.text or "").strip()
    if not value:
        return await message.answer("Вопрос не должен быть пустым. Отправь текст вопроса.")
    await state.update_data(prompt=value)
    await state.set_state(QuizCreation.question_answer)
    await message.answer("Укажи правильный ответ — название фильма.")


@router.message(QuizCreation.question_answer)
async def answer(message: Message, state: FSMContext):
    value = (message.text or "").strip()
    if not value:
        return await message.answer("Ответ не должен быть пустым. Укажи название фильма.")
    await state.update_data(answer=value)
    await state.set_state(QuizCreation.question_aliases)
    await message.answer("Укажи альтернативные варианты ответа через ; или отправь —")


@router.message(QuizCreation.question_aliases)
async def aliases(message: Message, state: FSMContext):
    data = await state.get_data()
    questions = data["questions"]
    raw = (message.text or "").strip()
    questions.append({
        "prompt": data["prompt"],
        "answer": data["answer"],
        "aliases": [] if raw == "—" else [item.strip() for item in raw.split(";") if item.strip()],
    })
    await state.update_data(questions=questions)
    await state.set_state(QuizCreation.more_questions)
    await message.answer(
        f"Вопросов добавлено: {len(questions)}. "
        "Отправь «+» для следующего вопроса или «готово» для сохранения."
    )


@router.message(QuizCreation.more_questions)
async def more(message: Message, state: FSMContext):
    command = (message.text or "").strip().lower()
    if command == "+":
        await state.set_state(QuizCreation.question_prompt)
        return await message.answer("Текст следующего вопроса.")
    if command not in ("готово", "готово!", "done"):
        return await message.answer("Отправь «+» или «готово».")
    data = await state.get_data()
    if not data["questions"]:
        return await message.answer("Добавь хотя бы один вопрос.")
    async with await connect() as db:
        cur = await db.execute(
            "INSERT INTO quizzes(title,status,created_at) VALUES(?,?,?)",
            (data["title"], "draft", now()),
        )
        quiz_id = cur.lastrowid
        for position, question in enumerate(data["questions"], 1):
            cur = await db.execute(
                "INSERT INTO questions(quiz_id,position,prompt,answer) VALUES(?,?,?,?)",
                (quiz_id, position, question["prompt"], question["answer"]),
            )
            for alias in question["aliases"]:
                await db.execute(
                    "INSERT INTO aliases(question_id,alias) VALUES(?,?)",
                    (cur.lastrowid, alias),
                )
        await db.commit()
    await state.clear()
    await message.answer(
        f"Черновик #{quiz_id} «{escape(data['title'])}» сохранён. "
        f"Публикация: /publish {quiz_id}",
        parse_mode="HTML",
    )


@router.message(Command("publish"))
async def publish(message: Message):
    args = (message.text or "").split()
    if len(args) != 2 or not args[1].isdigit():
        return await message.answer("Формат: /publish ID")
    quiz_id = int(args[1])
    async with await connect() as db:
        cur = await db.execute(
            'SELECT * FROM quizzes WHERE id=? AND status="draft"', (quiz_id,)
        )
        quiz = await cur.fetchone()
        cur = await db.execute(
            "SELECT COUNT(*) n FROM questions WHERE quiz_id=?", (quiz_id,)
        )
        count = (await cur.fetchone())["n"]
    if not quiz or not count:
        return await message.answer("Черновик не найден или в нём нет вопросов.")
    if not config.channel_id or not config.channel_username:
        return await message.answer(
            "Сначала настрой CHANNEL_ID и CHANNEL_USERNAME в окружении."
        )
    ends = datetime.now(timezone.utc) + timedelta(hours=config.quiz_hours)
    post_text = (
        f'🎬 <b>{escape(quiz["title"])}</b>\n\n'
        "Новая кино-викторина канала @ilovemoovie!\n"
        f"Внутри {count} вопросов. На каждый — три попытки. "
        f"Викторина доступна {config.quiz_hours} часов."
    )
    bot_username = (await message.bot.get_me()).username
    sent = await message.bot.send_message(
        config.channel_id,
        post_text,
        parse_mode="HTML",
        reply_markup=quiz_link_keyboard(
            f"https://t.me/{bot_username}?start=quiz_{quiz_id}"
        ),
    )
    async with await connect() as db:
        await db.execute(
            "UPDATE quizzes SET status='published',published_at=?,ends_at=?,"
            "channel_message_id=? WHERE id=?",
            (now(), ends.isoformat(), sent.message_id, quiz_id),
        )
        await db.commit()
    await message.answer(f"Викторина #{quiz_id} опубликована в канале.")


@router.message(Command("quizlist"))
async def quizlist(message: Message):
    async with await connect() as db:
        cur = await db.execute(
            "SELECT id,title,status FROM quizzes ORDER BY id DESC LIMIT 20"
        )
        rows = await cur.fetchall()
    result = "\n".join(
        f'#{row["id"]} — {escape(row["title"])} [{row["status"]}]'
        for row in rows
    )
    await message.answer(result or "Викторин пока нет.", parse_mode="HTML")
