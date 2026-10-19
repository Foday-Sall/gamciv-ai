# GamCiv AI: server deployment guide

Step-by-step deployment of the full stack to a VPS. Requirements: Node 20+, Docker
(Compose plugin), a `psql` client, and SSH access to the server.

Repo layout (see [README.md](README.md) for the full tree):

- `frontend/landing` - public landing page (Vite, React)
- `frontend/app` - citizen app + institution dashboards (Vite, React)
- `frontend/dashboard/admin` - admin console (Vite, React)
- `backend/functions` - Deno edge functions (self-hosted Supabase)
- `backend/db` - SQL migrations, applied in order
- `backend/scripts/deploy.sh` - edge function deployment
- `channels/` - optional Go service (Telegram/WhatsApp bridge)

## 1) Frontends: one .env each (copy the example, fill in, build)

```bash
cd frontend/landing   && cp .env.example .env && npm ci && npm run build
cd frontend/app       && cp .env.example .env && npm ci && npm run build
cd frontend/dashboard/admin && cp .env.example .env && npm ci && npm run build
```

All three need:

```bash
VITE_SUPABASE_URL=https://<your-supabase-host>
VITE_SUPABASE_ANON_KEY=<anon/publishable key>
```

The apps are served from subpaths: `/`, `/app/`, `/dashboard/` (see each `vite.config.ts`).

## 2) Database migrations (in numeric order)

```bash
for f in backend/db/0*.sql; do psql -U supabase_admin -d postgres -f "$f"; done
```

Files run from `0001_schema.sql` through `0012_auth_verification.sql`. The loop above
applies them in order.

## 3) Edge functions

```bash
cd backend
cp .env.functions.example /opt/supabase/docker/.env.functions   # then fill values
VPS_HOST=root@<host> SSH_KEY=~/.ssh/id_ed25519 ./scripts/deploy.sh
```

The script packages `functions/` (main dispatcher, `_shared`, the four intake/notify
functions, admin-api, auth-verify, email-hook), copies the tree to
`/opt/supabase/docker/volumes/functions/` on the server, fixes ownership, and recreates
the edge functions container. Changes to `.env.functions` are picked up by the same
recreate.

## 4) GoTrue (email): native Supabase send-email hook

Set these in the Supabase compose environment (then `docker compose up -d gotrue`):

```bash
ENABLE_EMAIL_AUTOCONFIRM=false
GOTRUE_HOOK_SEND_EMAIL_ENABLED=true
GOTRUE_HOOK_SEND_EMAIL_URI=http://host.docker.internal:9000/email-hook
GOTRUE_HOOK_SEND_EMAIL_SECRETS=v1,whsec_<base64 secret>
```

And in `.env.functions` (paired with the secret above):

```bash
SEND_EMAIL_HOOK_SECRET=v1,whsec_<same base64 secret>
RESEND_API_KEY=<resend key>
RESEND_FROM=GamCiv <noreply@your-domain>
```

Verify the sending domain at resend.com/domains first. Details in the header comment of
[`backend/functions/email-hook/index.ts`](backend/functions/email-hook/index.ts): the hook
verifies the standardwebhooks signature, renders the 6-digit code, sends via Resend REST,
logs to `public.email_log`, and adds a welcome email on signup.

## 5) Messengers

- **WhatsApp (GOWA):** set `GOWA_BASE_URL`, `GOWA_BASIC_AUTH`, `GOWA_WEBHOOK_SECRET` in
  `.env.functions`, then point the GOWA per-device webhook at
  `https://api.pocketsoftware.dev/functions/v1/whatsapp-intake`. Channel docs:
  [`backend/channels/whatsapp/`](backend/channels/whatsapp)
- **Telegram:** set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET`, then set the
  webhook. Full go-live runbook: [`backend/docs/telegram-golive.md`](backend/docs/telegram-golive.md).
  Do not set the webhook before the token is in place (requests fail 500 without it).
- **AI routing:** `AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY` (any OpenAI-compatible endpoint).
- **Optional Go channels service:** run `channels/cmd/gamciv-channels` (env vars in the
  header comment of `main.go`: `TELEGRAM_BOT_TOKEN`, `WHATSAPP_BRIDGE_URL`,
  `WHATSAPP_ALLOW_FROM`, `CHANNELS_HTTP_ADDR`), then set `CHANNELS_URL` in `.env.functions`
  so outbound sends route through the bus. Unset = direct sends.
- **notify-out auth:** the database calls it via `pg_net` with the `x-gamciv-key` header
  carrying `INTERNAL_FUNCTION_KEY` (generate with `openssl rand -hex 24`).

## 6) Verify the deployment

- `curl https://api.pocketsoftware.dev/functions/v1/main` returns the dispatcher response.
- Posting to `whatsapp-intake` or `telegram-intake` without a valid signature returns 401.
- From a real account, message the bot or the WhatsApp number, expect a confirmation with
  a `GC-` tracking code.
- Frontends load at `/`, `/app/`, `/dashboard/` with assets resolving under the subpaths.
