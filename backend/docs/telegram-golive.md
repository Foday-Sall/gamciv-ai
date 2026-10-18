# Telegram intake — go-live runbook (~10 min)

Status before this runbook: the code is deployed and live; `TELEGRAM_WEBHOOK_SECRET` is
already set on the VPS. Only the bot token is missing, so every request currently fails
500 (missing token) — **do not set the webhook until step 4 is complete.**

## 1. Create the bot (~2 min)

1. Open Telegram, search **@BotFather** (blue verified check).
2. Send `/newbot`.
3. Name: `GamCiv AI` (display name, anything).
4. Username: must end in `bot`, e.g. `gamciv_bot`.
5. Copy the **HTTP API token** it replies with (`123456789:AAF...xYz`).

That is all BotFather needs. Webhook and secret are set via API (step 4), not in BotFather.

## 2. Put the token on the server (1 min)

```bash
# SSH to your server (use your own host/key)
cd /opt/supabase/docker
nano .env.functions            # root-owned, chmod 600
```

Replace the `PENDING_BOTFATHER_TOKEN` placeholder in the existing `TELEGRAM_BOT_TOKEN=`
line with the real token. Never paste the token into chat or tickets.

## 3. Recreate the functions container (one container action)

```bash
cd /opt/supabase/docker
docker compose up -d --force-recreate functions
docker ps --format '{{.Names}} {{.Status}}' | grep edge
# expect: supabase-edge-functions Up X seconds (healthy)
```

## 4. Set the webhook (placeholders only — fill TOKEN and SECRET from step 1/2)

`SECRET` is the value of `TELEGRAM_WEBHOOK_SECRET` in `.env.functions` (get it with
`grep TELEGRAM_WEBHOOK_SECRET .env.functions` — do not print it anywhere else).

```bash
curl -s -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://api.pocketsoftware.dev/functions/v1/telegram-intake",
    "secret_token": "<SECRET>",
    "allowed_updates": ["message"],
    "drop_pending_updates": true
  }'
# expect: {"ok":true,"result":true,"description":"Webhook was set"}
```

Verify:

```bash
curl -s "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
# url set, last_error_message empty, pending_update_count 0
```

## 5. Smoke test

1. From a real Telegram account, message the bot `/start` → expect the greeting reply.
2. Send e.g. `No water in Bakoteh` → expect a confirmation with a `GC-` tracking number.
3. `POST https://api.pocketsoftware.dev/functions/v1/telegram-intake` **without** the
   `X-Telegram-Bot-Api-Secret-Token` header must return `401 {"error":"invalid webhook
   secret token"}` (verified working; scanners hitting the URL fail here, Telegram's own
   deliveries carry the header).

## Env var names (edge container, via `.env.functions` → `env_file`)

| Variable | Purpose |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | BotFather token; sendMessage/getFile/setWebhook |
| `TELEGRAM_WEBHOOK_SECRET` | Secret echoed by Telegram in `X-Telegram-Bot-Api-Secret-Token` |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `AI_*` | already set |

## Rollback

Unset the webhook (`curl "https://api.telegram.org/bot<TOKEN>/deleteWebhook"`) — the
endpoint stays up but ignores traffic (no valid secret header ⇒ 401).
