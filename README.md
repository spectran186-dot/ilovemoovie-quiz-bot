# ilovemoovie quiz bot

Telegram bot for personal movie-quiz sessions launched from posts in the [@ilovemoovie](https://t.me/ilovemoovie) channel.

## MVP features

- Admin creates quizzes with any number of free-text film questions
- Optional accepted aliases for film titles
- Quiz link published to the channel with a deep link to the bot
- Quiz remains available for 48 hours after publication
- Three attempts per question
- Score: 10 / 7 / 4 points for the first / second / third attempt
- One scored session per user per quiz; unfinished sessions can be resumed
- Public leaderboard and `/privacy` opt-out
- SQLite storage

## Requirements

- Python 3.11+
- Telegram bot token from [@BotFather](https://t.me/BotFather)
- A Telegram channel where the bot is an administrator with permission to publish messages

## Local setup

1. Clone this repository.
2. Create and activate a virtual environment.
3. Install packages: `pip install -r requirements.txt`.
4. Copy `.env.example` to `.env`.
5. Fill in the environment variables:
   - `BOT_TOKEN` — token from BotFather
   - `ADMIN_IDS` — Telegram numeric user IDs of admins, comma-separated
   - `CHANNEL_ID` — channel ID, usually in the form `-100...`
   - `CHANNEL_USERNAME` — public channel username without `@`
6. Start the bot: `python -m app`.

The database is created automatically at `DATABASE_PATH` (default: `data/quiz.sqlite3`).

## Admin commands

- `/newquiz` — start quiz creation
- `/cancel` — cancel the current quiz draft
- `/quizlist` — list recent quizzes
- `/publish ID` — publish a saved draft to the channel

Quiz creation flow: title → question text → correct film title → aliases separated by semicolons (or send `—`) → `+` for another question or `готово` to save.

## Participant commands

- Open the button under a quiz post to start or resume the quiz
- `/leaderboard` — show the top 20 participants
- `/privacy` — toggle visibility in the leaderboard

## Tests

```bash
python -m compileall -q app
python -m pytest -q
```

Never commit `.env`, bot tokens, or the SQLite database.
