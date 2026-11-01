# ilovemoovie quiz bot

Telegram bot for private movie quizzes for the @ilovemoovie channel.

## MVP features

- Admin-created quizzes with free-text film answers
- 48-hour quiz window
- Three attempts per question
- Score: 10 / 7 / 4 points by attempt
- Public leaderboard with privacy opt-out
- Telegram deep-link entry from channel posts

## Setup

1. Copy `.env.example` to `.env`.
2. Set `BOT_TOKEN`, `ADMIN_IDS`, `CHANNEL_ID`, and `CHANNEL_USERNAME`.
3. Install dependencies with `pip install -r requirements.txt`.
4. Run `python -m app`.

Never commit `.env` or bot tokens.
