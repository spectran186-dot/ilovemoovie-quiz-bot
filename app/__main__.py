import asyncio
from aiogram import Bot, Dispatcher
from aiogram.fsm.storage.memory import MemoryStorage
from .config import config
from .db import init_db
from .handlers import admin, common, game, ranking

async def main():
    if not config.bot_token:
        raise RuntimeError('Set BOT_TOKEN in .env')
    await init_db()
    bot=Bot(config.bot_token)
    dp=Dispatcher(storage=MemoryStorage())
    dp.include_router(admin.router)
    dp.include_router(common.router)
    dp.include_router(ranking.router)
    dp.include_router(game.router)
    await dp.start_polling(bot)

if __name__=='__main__':
    asyncio.run(main())
