from aiogram.fsm.state import State, StatesGroup

class QuizCreation(StatesGroup):
    title = State()
    question_prompt = State()
    question_answer = State()
    question_aliases = State()
    more_questions = State()
