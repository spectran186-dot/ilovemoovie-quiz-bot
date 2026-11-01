from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton

def quiz_link_keyboard(url: str):
    return InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text='🎬 Участвовать в викторине', url=url)]])
