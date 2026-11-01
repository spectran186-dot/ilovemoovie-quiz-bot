# ilovemoovie quiz bot

Cloudflare Workers + D1 implementation of the Telegram movie-quiz bot for [@ilovemoovie](https://t.me/ilovemoovie).

The production entry point is `src/index.ts`. The previous Python/aiogram prototype in `app/` is retained temporarily for reference and is **not** used by Cloudflare.

## Features

- Admin creates and publishes quizzes using Telegram commands
- Free-text movie-title answers and optional aliases
- Quiz deep-link button in the channel post
- Quiz is open for 48 hours after publication
- Three attempts per question; 10 / 7 / 4 points for attempt 1 / 2 / 3
- One scored session per user per quiz
- Incomplete session can be resumed from the quiz link
- 20-minute session window, refreshed when the participant reopens the link
- Public leaderboard; `/privacy` hides or restores a participant's name
- Persistent state in Cloudflare D1; no always-on server or paid hosting required within free limits

## Cloudflare setup

1. Create a free Cloudflare account and open **Workers & Pages**.
2. Create a D1 database named `ilovemoovie-quiz-db`.
3. Copy its database ID into `wrangler.jsonc`, replacing `REPLACE_WITH_D1_DATABASE_ID`.
4. In `wrangler.jsonc`, replace:
   - `REPLACE_WITH_TELEGRAM_USER_ID` with your numeric Telegram user ID (admin)
   - `REPLACE_WITH_BOT_USERNAME` with the bot username, without `@`
   - Check `CHANNEL_ID`. For a public channel, `@ilovemoovie` is accepted; the bot must be a channel administrator with permission to post.
5. Apply the D1 migration:
   ```bash
   npx wrangler d1 migrations apply ilovemoovie-quiz-db --remote
   ```
6. Install dependencies and deploy:
   ```bash
   npm install
   npx wrangler deploy
   ```
7. Add Worker secrets (never commit or paste them into source code):
   ```bash
   npx wrangler secret put BOT_TOKEN
   npx wrangler secret put WEBHOOK_SECRET
   ```
   Use the BotFather token for `BOT_TOKEN`. For `WEBHOOK_SECRET`, use a long random string containing only letters, digits, underscores, or hyphens; keep it private.
8. Set the Telegram webhook. Replace the two placeholders with the deployed Worker URL and the exact `WEBHOOK_SECRET` value:
   ```bash
   curl -X POST "https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook" \
     --data-urlencode "url=https://YOUR_WORKER.workers.dev/telegram/webhook" \
     --data-urlencode "secret_token=YOUR_WEBHOOK_SECRET" \
     --data-urlencode 'allowed_updates=["message"]'
   ```
   Replace the three uppercase placeholders with your actual values. Telegram should return `{"ok":true,"result":true,...}`.
9. Check `https://<WORKER_SUBDOMAIN>.workers.dev/`. It should say `ilovemoovie quiz bot is running`.

## Worker environment variables

These are configured in `wrangler.jsonc` and deployed with the Worker:

- `ADMIN_IDS` — numeric Telegram user IDs, comma-separated
- `CHANNEL_ID` — channel ID or public channel username (e.g. `@ilovemoovie`)
- `CHANNEL_USERNAME` — public channel username without `@`
- `BOT_USERNAME` — bot username without `@`
- `QUIZ_HOURS` — defaults to `48`
- `SESSION_MINUTES` — defaults to `20`

Secrets `BOT_TOKEN` and `WEBHOOK_SECRET` are stored separately with `wrangler secret put`.

## Telegram commands

Admin:
- `/newquiz` — create a quiz
- `/cancel` — cancel the current draft
- `/quizlist` — list recent quizzes
- `/publish ID` — publish a saved quiz

During quiz creation: title → question → correct film title → aliases separated by semicolons (or `—`) → `+` for another question or `готово` to save.

Participants:
- Open the button below a quiz post to start or resume
- `/leaderboard` — top 20 participants
- `/privacy` — toggle leaderboard visibility

## Local development and tests

```bash
npm install
npm run typecheck
npx wrangler dev
```

The Worker uses the local D1 database when running `wrangler dev`. Apply migrations locally with:

```bash
npx wrangler d1 migrations apply ilovemoovie-quiz-db --local
```

Never commit bot tokens, webhook secrets, or private credentials.
