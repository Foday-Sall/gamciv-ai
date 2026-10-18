# GamCiv AI — telegram-intake

Telegram reporting channel: Telegram webhook → verify the `X-Telegram-Bot-Api-Secret-Token` header →
extract the report → AI classify → ONE `rpc submit_complaint` call → Telegram `sendMessage`
confirmation. Same pipeline and guarantees as `whatsapp-intake`, but no GOWA dependency — the Bot
API is plain HTTPS.

## Files

- `index.ts` — webhook entry: secret-token check, update parsing, pipeline (photo resolution →
  classify → one RPC → confirmation). Exports `handleRequest` / `processReport` / `buildDeps` for
  tests, `Deno.serve` as entry.
- `telegram.ts` — Bot API client (plain fetch, no SDK): `sendMessage`, `getFile` → file download
  URL, plus the update parser/normalizer (`parseUpdate`, `extractReport`).
- `setWebhook.ts` — optional one-shot helper that calls Bot API `setWebhook` with `url` +
  `secret_token`; the curl command below is equivalent.
- `../../tests/telegramIntake.test.ts` — unit tests, all network stubbed.

## Environment variables

| Variable                                  | Required | Purpose                                                                                                                                         |
| ----------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`                      | yes      | From @BotFather. Used for `sendMessage`, `getFile`, file downloads, `setWebhook`.                                                               |
| `TELEGRAM_WEBHOOK_SECRET`                 | yes      | Secret token Telegram echoes in `X-Telegram-Bot-Api-Secret-Token` on every delivery. Any string, 1–256 chars. Generate: `openssl rand -hex 24`. |
| `SUPABASE_URL`                            | yes      | PostgREST base — provided by stock edge-runtime.                                                                                                |
| `SUPABASE_SERVICE_ROLE_KEY`               | yes      | Provided by stock edge-runtime.                                                                                                                 |
| `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` | yes      | OpenAI-compatible classifier (shared with the other channels).                                                                                  |
| `AI_TIMEOUT_MS`                           | no       | Per-classify timeout, default 15000.                                                                                                            |
| `TELEGRAM_API_BASE`                       | no       | Override the Bot API base (default `https://api.telegram.org`); useful for proxies.                                                             |

Secrets live in `/opt/supabase/docker/.env.functions` on the VPS (chmod 600), wired into the
functions container via `env_file` — add the two `TELEGRAM_*` entries there next to the existing
ones.

## BotFather setup (~2 minutes)

1. Open Telegram, search **@BotFather** (blue verified check).
2. Send `/newbot`.
3. BotFather asks for a **name** → e.g. `GamCiv AI` (display name, anything).
4. It asks for a **username** → must end in `bot`, e.g. `gamciv_bot`.
5. BotFather replies with the **HTTP API token**, something like `123456789:AAF...xYz`. Copy it —
   that is `TELEGRAM_BOT_TOKEN`.

That is all BotFather needs. The webhook and secret token are set via API (step below), not via
BotFather.

## Activate the webhook (after deploy)

`secret_token` is what the intake handler verifies against `TELEGRAM_WEBHOOK_SECRET`. Telegram then
sends it in the `X-Telegram-Bot-Api-Secret-Token` header of every update.

```bash
curl -s -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://api.pocketsoftware.dev/functions/v1/telegram-intake",
    "secret_token": "<TELEGRAM_WEBHOOK_SECRET>",
    "allowed_updates": ["message"],
    "drop_pending_updates": true
  }'
```

Expected response: `{"ok":true,"result":true,"description":"Webhook was set"}`.

Verify / troubleshoot:

```bash
curl -s "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo"
# should show the url, last_error_message empty, pending_update_count 0
```

## DB note — p_channel fallback

The live DB enum `report_channel` is `web / whatsapp / sms / email` — there is **no `telegram` value
yet**, so this function writes `p_channel = "web"`. Once the DB adds the value:

```sql
ALTER TYPE report_channel ADD VALUE 'telegram';
```

and change `FALLBACK_CHANNEL` in `index.ts` from `"web"` to `"telegram"` (one-line change; the code
otherwise treats the channel generically). The DB team should also make `submit_complaint`'s
idempotency unique index on `p_external_id` channel-aware if they want per-channel dedupe scopes.

## Photo URL caveat

Bot API `getFile` returns a `file_path`; the download URL is
`https://api.telegram.org/file/bot<TOKEN>/<file_path>`. Notes:

- The URL **embeds the bot token** (Telegram has no tokenless file links) and **expires after ~1
  hour**.
- It is stored in `p_photo_url` for officer review. If long-lived images are ever needed, add a
  mirror-to-object-storage step as a separate enhancement.
- If `getFile` fails, the report is still filed — text-only, `p_photo_url` null — so a broken image
  never loses a complaint.

## Testing locally

```bash
deno test --allow-all tests/    # unit tests; AI/RPC/Bot API all stubbed
```

Live smoke test after deployment: message the bot `/start` from a real Telegram account → expect a
greeting; then send e.g. "No water in Bakoteh" → expect a confirmation with a `GC-` tracking number,
and a new row in `complaints` with `channel = 'web'` (fallback) and
`external_id = tg:<chat_id>:<message_id>`.
