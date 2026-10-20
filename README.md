# GamCiv AI

[![CI](https://github.com/Foday-Sall/gamciv-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/Foday-Sall/gamciv-ai/actions/workflows/ci.yml)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Supabase](https://img.shields.io/badge/Supabase-self_hosted-3FCF8E?logo=supabase&logoColor=black)](https://supabase.com)
[![Deno](https://img.shields.io/badge/Deno-2-70AD47?logo=deno&logoColor=white)](https://deno.com)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-RLS_and_RPCs-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![Docker](https://img.shields.io/badge/Docker-compose-2496ED?logo=docker&logoColor=white)](https://docs.docker.com)
[![Kong](https://img.shields.io/badge/Kong-gateway-000000)](https://konghq.com)
[![Resend](https://img.shields.io/badge/Resend-email-000000)](https://resend.com)
[![Workers AI](https://img.shields.io/badge/Workers_AI-classifier-F38020?logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/workers-ai/)

GamCiv AI is a civic-complaints platform for The Gambia. Citizens report potholes, water outages, broken streetlights and similar issues from a web app, WhatsApp or Telegram; an AI classifier reads each report, assigns a category and routes it to the responsible institution; institution staff get dashboards scoped to their own queue; citizens follow progress with a tracking code. Built by Team Vertex for the UTG-ITCA hackathon, running live on a self-hosted Supabase stack.

## Features

- **Multi-channel reporting.** One pipeline for web, WhatsApp (personal number via GOWA) and Telegram (bot). Meta WhatsApp Business is plug-in ready.
- **AI classification and routing.** An OpenAI-compatible chat completion assigns category and institution; deadlines, escalation and grouping are enforced by Postgres RPCs, not application code.
- **Institution-scoped staff dashboards.** Row Level Security and officer RPCs mean staff see only their own institution's queue, detail pages and actions.
- **Citizen tracking.** Every filed report gets a `GC-` code citizens use to follow status changes.
- **Status notifications.** The database queues notifications and `pg_net` calls the `notify-out` function, which sends over WhatsApp first and falls back to SMS (Termii or a TextBee-style Android gateway).
- **Auth that reaches people.** Email signup with 6-digit codes, welcome email and magic links via Resend behind a GoTrue send-email hook; phone verification via WhatsApp OTP.
- **Super-admin console.** Institutions, staff accounts, access-control levels and per-category limits, plus an audit log.
- **Optional message bridge hook.** Edge functions can route outbound sends through an external message-bridge service via `CHANNELS_URL`; unset, they call GOWA and Telegram directly. No bridge service is included — one can be added later.

## Architecture

```
+------------------------------------------------------------------------------+
|                                   clients                                    |
|  citizens: web app (/app), WhatsApp (GOWA hotline), Telegram bot             |
|  staff:    institution dashboards (/app), super-admin console (/dashboard)   |
+--------------------------------------+---------------------------------------+
                                       |  HTTPS via Cloudflare tunnel
                                       v
+------------------------------------------------------------------------------+
|                 one nginx container (Docker, bound to 127.0.0.1:8095)        |
|        gamciv.pocketsoftware.dev:  /  +  /app/  +  /dashboard/               |
|         landing marketing site   citizen app   super-admin console           |
+--------------------------------------+---------------------------------------+
                                       |  HTTPS via Cloudflare tunnel
                                       v
+------------------------------------------------------------------------------+
|              self-hosted Supabase (Docker compose on the VPS)                |
|            api.pocketsoftware.dev  (Kong gateway + JWT verify)               |
|                                                                              |
|   PostgREST: tables, RLS, officer and admin RPCs (all business logic)        |
|   GoTrue:    auth, 6-digit email OTP via the send-email hook                 |
|   pg_net:    outbound notification dispatch to edge functions                |
+--------------------------+--------------------------+------------------------+
                           |                          |
                           v                          v
     +-----------------------------------+   +------------------------------------+
     |  edge functions (Deno runtime)    |   |  outbound transports               |
     |                                   |   |  GOWA (WhatsApp, webhook + sends)  |
     |  whatsapp-intake      notify-out  |   |  Telegram Bot API (webhook + sends)|
     |  meta-whatsapp-intake admin-api   |   |  SMS: Termii or Android gateway    |
     |  telegram-intake      auth-verify |   |  Resend (auth email via email-hook)|
     |  email-hook (GoTrue send-email)   |   +------------------------------------+
     +-----------------+-----------------+
                       |
                       v
     +-----------------------------------+
     |  AI classification                |
     |  OpenAI-compatible endpoint       |
     |  (Cloudflare Workers AI)          |
     +-----------------------------------+

     Postgres (backend/db 0001..0012): schema, RLS, officer/admin RPCs,
     escalation, notification queue, OTP tables. Applied in numeric order.
```

Every channel lands in the same place: the intake function verifies its webhook signature, extracts the report, calls the AI classifier, and makes a single `submit_complaint` RPC call. All routing, deadline and grouping logic lives in that SQL function, so behavior is identical regardless of how the citizen wrote in. Everything the web apps need (tracking, queues, admin data) is plain PostgREST. See [backend/README.md](backend/README.md) for the API layer details.

## Screenshots

| Landing site | Citizen app | Super-admin console |
|---|---|---|
| <!-- TODO: screenshot of frontend/landing --> | <!-- TODO: screenshot of frontend/app report + tracking --> | <!-- TODO: screenshot of frontend/dashboard/admin overview + institutions --> |

## Repository structure

```
gamciv-ai/
├── frontend/
│   ├── landing/              marketing site (React, served at /)
│   ├── app/                  citizen app + institution dashboards (served at /app/)
│   └── dashboard/admin/      super-admin console (served at /dashboard/)
├── backend/
│   ├── db/                   SQL migrations 0001..0012 (schema, RLS, RPCs, OTP tables)
│   ├── functions/            Deno edge functions (main dispatcher + one folder per function)
│   ├── channels/             per-channel docs: whatsapp, whatsapp-business, telegram, sms
│   ├── docs/                 sql-contract.md, telegram-golive.md
│   ├── tests/                Deno unit tests (stubbed network)
│   ├── scripts/deploy.sh     edge function deploy to the VPS
│   └── README.md             API layer details and local development
├── deploy/                   frontend deploy scripts (landing, app, dashboard)
├── .github/workflows/        CI: deno lint + tests, vite builds
├── DEPLOY.md                 step-by-step server deployment guide
└── README.md
```

## Quick start

Prerequisites: Node 22+, Deno 2, a Docker host with the self-hosted Supabase stack, and a `psql` client for migrations.

1. **Clone the repo.**

   ```bash
   git clone https://github.com/Foday-Sall/gamciv-ai.git
   cd gamciv-ai
   ```

2. **Set up the frontend env files.** All three frontends read the same two variables. Copy each `.env.example` to `.env` in place:

   ```bash
   cd frontend/landing            && cp .env.example .env
   cd ../app                      && cp .env.example .env
   cd ../dashboard/admin          && cp .env.example .env
   ```

   Then fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in all three.

3. **Install and build each app.**

   ```bash
   cd frontend/landing           && npm ci && npm run build
   cd ../app                     && npm ci && npm run build
   cd ../dashboard/admin         && npm ci && npm run build
   ```

   Builds land in `dist/` per app. The citizen app and admin console are built with `base: /app/` and `base: /dashboard/` respectively so assets resolve under subpaths.

4. **Apply the database migrations**, in numeric order (the glob sorts them correctly):

   ```bash
   for f in backend/db/0*.sql; do psql -U supabase_admin -d postgres -f "$f"; done
   ```

5. **Run the backend tests.**

   ```bash
   cd backend && deno lint && deno test --allow-all
   ```

6. **Deploy edge functions to the VPS** (see the deployment section below, or [DEPLOY.md](DEPLOY.md) for the full walkthrough).

## Deployment on a VPS

The full, step-by-step server deployment guide lives in [DEPLOY.md](DEPLOY.md). The short version:

1. Provision the VPS with Docker and clone the official self-hosted Supabase stack into `/opt/supabase/docker`, then start it with `docker compose up -d`.
2. Apply the migrations from [backend/db/](backend/db) with `psql`, in numeric order.
3. Create `/opt/supabase/docker/.env.functions` on the VPS from [backend/.env.functions.example](backend/.env.functions.example) and fill in real values (chmod 600, root-owned).
4. Deploy the edge functions:

   ```bash
   cd backend
   VPS_HOST=root@<your-server> SSH_KEY=/path/to/key ./scripts/deploy.sh
   ```

   The script ships the function tree into `volumes/functions/`, fixes ownership, and recreates the edge container.
5. Configure GoTrue for the send-email hook (compose env): `ENABLE_EMAIL_AUTOCONFIRM=false`, `GOTRUE_HOOK_SEND_EMAIL_ENABLED=true`, `GOTRUE_HOOK_SEND_EMAIL_URI=http://host.docker.internal:9000/email-hook`, `GOTRUE_HOOK_SEND_EMAIL_SECRETS=v1,whsec_...` pairing with `SEND_EMAIL_HOOK_SECRET` in `.env.functions`.
6. Build the three frontends and ship them with the parameterized scripts in [deploy/](deploy), which read `VPS_HOST` and `SSH_KEY` and never touch secrets:

   ```bash
   VPS_HOST=root@<your-server> SSH_KEY=/path/to/key bash deploy/redeploy.sh
   VPS_HOST=root@<your-server> SSH_KEY=/path/to/key bash deploy/deploy_app.sh
   VPS_HOST=root@<your-server> SSH_KEY=/path/to/key bash deploy/deploy_dashboard.sh
   ```

   All three land in one nginx container under `/`, `/app/` and `/dashboard/`.
7. Wire up messaging:
   - **WhatsApp:** point the GOWA per-device webhook at `https://api.pocketsoftware.dev/functions/v1/whatsapp-intake` and set `GOWA_WEBHOOK_SECRET` to match. See [backend/channels/whatsapp/](backend/channels/whatsapp).
   - **Telegram:** follow the go-live runbook at [backend/docs/telegram-golive.md](backend/docs/telegram-golive.md) (BotFather token, webhook registration, smoke test).
   - **SMS fallback:** provider selection and config at [backend/channels/sms/](backend/channels/sms).
8. Optional: an external message-bridge service can be added later; when `CHANNELS_URL` is set in `.env.functions`, outbound sends route through its `POST /send` endpoint. No bridge is included — unset, sends go directly to GOWA and Telegram.

## Environment variables

Names only, no values. Nothing is committed: every env file in the repo is an `*.example` template.

**Frontends (all three, from each `.env.example`):**

| Variable | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | Self-hosted Supabase API base |
| `VITE_SUPABASE_ANON_KEY` | Anon/publishable key |

**Edge functions (from [backend/.env.functions.example](backend/.env.functions.example), deployed to `/opt/supabase/docker/.env.functions`):**

| Variable | Purpose |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Provided by the stack; used for RPC and PostgREST calls |
| `GOWA_BASE_URL`, `GOWA_BASIC_AUTH`, `GOWA_DEVICE_ID` | GOWA REST client (WhatsApp sends) |
| `GOWA_WEBHOOK_SECRET` | HMAC verification of GOWA webhook deliveries |
| `INTERNAL_FUNCTION_KEY` | Shared secret the database sends via `pg_net` (`x-gamciv-key`) |
| `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, `AI_TIMEOUT_MS` | OpenAI-compatible classifier |
| `SMS_PROVIDER`, `HTTP_GATEWAY_URL`, `HTTP_GATEWAY_API_KEY`, `HTTP_GATEWAY_AUTH_HEADER`, `HTTP_GATEWAY_DEVICE_ID` | Android SMS gateway (primary provider) |
| `TERMII_API_KEY`, `TERMII_SENDER_ID`, `TERMII_ENDPOINT` | Termii SMS (fallback provider) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_API_BASE` | Telegram bot channel |
| `RESEND_API_KEY`, `RESEND_FROM`, `SEND_EMAIL_HOOK_SECRET` | Auth email via the GoTrue send-email hook |
| `CHANNELS_URL` | Optional: route sends through an external message-bridge service (not included; unset = direct sends) |

**GoTrue (Docker compose env for the send-email hook):**

| Variable | Purpose |
|---|---|
| `ENABLE_EMAIL_AUTOCONFIRM` | Must be `false` so 6-digit codes are issued |
| `GOTRUE_HOOK_SEND_EMAIL_ENABLED` | Turns the hook on |
| `GOTRUE_HOOK_SEND_EMAIL_URI` | Edge function URL GoTrue calls instead of SMTP |
| `GOTRUE_HOOK_SEND_EMAIL_SECRETS` | `v1,whsec_...` standardwebhooks secret, pairing with `SEND_EMAIL_HOOK_SECRET` |

**Deploy scripts ([backend/scripts/](backend/scripts), [deploy/](deploy))**

| Variable | Purpose |
|---|---|
| `VPS_HOST`, `SSH_KEY` | Parameterized, read from the environment, never committed |

## Secrets manager (admin panel)

API keys and secret values are managed from the admin panel's Settings page
instead of editing `.env.functions` by hand:

- **Storage:** values live only in `/opt/supabase/docker/.env.functions` on the
  VPS (chmod 600). They never touch the database or the browser.
- **Flow:** the panel calls the `admin-secrets` edge function with an admin
  session; the function forwards whitelisted actions to the secrets bridge
  daemon (`secrets_bridge.py`, a systemd service on the VPS host), which
  rewrites the env file atomically and recreates the functions container in
  the background so new values apply immediately.
- **Audit:** every set/delete is recorded in `public.admin_secret_audit`
  (key name, action, acting admin) via migration
  [0013_admin_secrets_audit.sql](backend/db/0013_admin_secrets_audit.sql).
  Values are never logged.
- **Key policy:** named keys (Resend, AI, GOWA, Telegram, bridge token) plus
  generic `CUSTOM_*` keys. `SECRET_BRIDGE_TOKEN` can be rotated but never
  deleted.
- **Setup on the VPS:** `backend/scripts/setup_secrets_bridge.sh` (idempotent)
  generates the bridge token, wires `SECRET_BRIDGE_TOKEN` /
  `SECRET_BRIDGE_URL` into `.env.functions`, opens tcp/8790 from the docker
  bridge only, and installs the `secrets-bridge` systemd service.

## Testing

- **Backend:** `deno lint` and `deno test --allow-all` in `backend/`. The suite covers the classifier parser, webhook HMAC verification, envelope extraction, the intake and notify-out pipelines and the GoTrue email hook, all with stubbed network dependencies. `deno check --all` validates function entry points.
- **Frontends:** `npm run build` per app (type checking plus Vite build).
- **CI:** GitHub Actions runs the backend lint and tests and builds the landing and admin dashboard on every push and pull request (see [.github/workflows/ci.yml](.github/workflows/ci.yml)).

## Documentation

- [backend/README.md](backend/README.md) - edge functions API layer: function-by-function details, deploy layout, verification status
- [backend/channels/README.md](backend/channels/README.md) - messaging channels overview (WhatsApp, WhatsApp Business, Telegram, SMS)
- [backend/docs/telegram-golive.md](backend/docs/telegram-golive.md) - Telegram go-live runbook
- [backend/docs/sql-contract.md](backend/docs/sql-contract.md) - RPC contract the SQL side implements
- [DEPLOY.md](DEPLOY.md) - step-by-step server deployment guide

## License and credits

- The hackathon code itself has no license file yet; the team retains all rights for the competition.
- Built by Team Vertex for the UTG-ITCA hackathon (Challenge 01: Citizen Services and Public Complaints).
