# Clone-and-deploy guide for GamCiv AI
#
# Repo layout:
#   frontend/landing           — public landing page (vite, react)
#   frontend/app               — citizen app + institute dashboards (vite, react)
#   frontend/dashboard/admin   — admin console (vite, react)
#   backend/functions          — Deno edge functions (self-hosted Supabase)
#   backend/db                 — SQL migrations, applied in order
#   backend/scripts/deploy.sh  — edge function deployment
#   channels/                  — optional Go service (Telegram/WhatsApp bridge)
#
# Requirements: Node 20+, Docker, a self-hosted Supabase stack.

## 1) Frontends — one .env each (copy the example, fill in, build, deploy)

cd frontend/landing   && cp .env.example .env && npm ci && npm run build
cd frontend/app       && cp .env.example .env && npm ci && npm run build
cd frontend/dashboard/admin && cp .env.example .env && npm ci && npm run build

# All three need:
#   VITE_SUPABASE_URL=https://<your-supabase-host>
#   VITE_SUPABASE_ANON_KEY=<anon/publishable key>
# The app is served from subpaths: /, /app/, /dashboard/ (see each vite.config.ts).

## 2) Database migrations (in numeric order)

psql -U supabase_admin -d postgres -f backend/db/0001_schema.sql
# ... every file in backend/db/ up to 0012_auth_verification.sql

## 3) Edge functions

cd backend
cp .env.functions.example /opt/supabase/docker/.env.functions   # then fill values
VPS_HOST=root@<host> SSH_KEY=~/.ssh/id_ed25519 ./scripts/deploy.sh

## 4) GoTrue (email) — native Supabase send-email hook
#   ENABLE_EMAIL_AUTOCONFIRM=false
#   GOTRUE_HOOK_SEND_EMAIL_ENABLED=true
#   GOTRUE_HOOK_SEND_EMAIL_URI=http://host.docker.internal:9000/email-hook
#   GOTRUE_HOOK_SEND_EMAIL_SECRETS=v1,whsec_<base64 secret>
#   SEND_EMAIL_HOOK_SECRET + RESEND_API_KEY + RESEND_FROM in .env.functions
#   (see backend/functions/email-hook/index.ts header for details)

## 5) Messengers
#   WhatsApp: GOWA_* vars (GOWA_BASE_URL, GOWA_BASIC_AUTH, GOWA_WEBHOOK_SECRET)
#   Telegram: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, then set the webhook
#   AI routing: AI_BASE_URL, AI_MODEL, AI_API_KEY (any OpenAI-compatible endpoint)
