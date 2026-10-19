# Telegram Channel

Telegram bot reporting channel. Citizens message the bot, the report is classified and
filed exactly like the WhatsApp pipeline, and the bot replies with a confirmation.
The Bot API is plain HTTPS — no gateway dependency.

## How it works

```
citizen Telegram message
  → Telegram webhook POST https://api.pocketsoftware.dev/functions/v1/telegram-intake
    → verify X-Telegram-Bot-Api-Secret-Token header (TELEGRAM_WEBHOOK_SECRET)
    → extract report (text; photos resolved via getFile → download URL)
    → AI classify → one rpc submit_complaint call (routing/deadline/grouping in SQL)
    → sendMessage confirmation back to the chat
```

## Function source (do not move)

The full, detailed setup guide (BotFather walkthrough, webhook registration, go-live
checklist) lives with the code: [`../../functions/telegram-intake/README.md`](../../functions/telegram-intake/README.md).

- Intake: [`../../functions/telegram-intake/`](../../functions/telegram-intake/) — `index.ts` (webhook entry), `telegram.ts` (Bot API client + update parser), `setWebhook.ts` (one-shot registration helper)
- Unit tests: [`../../tests/telegramIntake.test.ts`](../../tests/telegramIntake.test.ts)
- Go-live plan: [`../../docs/telegram-golive.md`](../../docs/telegram-golive.md)

## Configuration

| Variable | Required | Purpose |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | yes | From @BotFather; used for `sendMessage`, `getFile`, downloads and `setWebhook` |
| `TELEGRAM_WEBHOOK_SECRET` | yes | Secret echoed in `X-Telegram-Bot-Api-Secret-Token` on every delivery; generate with `openssl rand -hex 24` |
| `TELEGRAM_API_BASE` | no | Override the Bot API base (default `https://api.telegram.org`), useful for proxies |

Plus the shared ones: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` (see
[`../.env.functions.example`](../.env.functions.example)).

## Setup notes

1. Create the bot with @BotFather (`/newbot`) — username must end in `bot`.
2. Put `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` in
   `/opt/supabase/docker/.env.functions` on the VPS.
3. Register the webhook with `setWebhook.ts` or the equivalent curl in the code-level
   README (url + `secret_token`).

Note: until the real token is set, webhook requests fail with 500 — Telegram must not be
wired up before the token exists.
