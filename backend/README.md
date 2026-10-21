# Backend

This folder contains the database and server-side code for GamCiv AI.

- `db/` — PostgreSQL schema, migrations, permissions, and report-routing rules.
- `functions/` — Supabase Edge Functions for WhatsApp and Telegram webhooks, AI classification, photo uploads, authentication, and notifications.
- `channels/` — setup notes for WhatsApp, Telegram, and SMS.
- `tests/` — backend tests that use mocked network calls.

Report routing and access checks are enforced by PostgreSQL functions and row-level security. Do not put private provider keys in frontend code.

## Run backend checks

Install Deno 2, then run:

```bash
cd backend
deno lint
deno test --allow-all
```

The same checks run in GitHub Actions.

## Deploy

Routine production deploys are automatic:

1. Configure the VPS and self-hosted Supabase stack using the [deployment guide](../DEPLOY.md).
2. Add `DEPLOY_SSH_KEY`, `VPS_HOST`, and `VPS_HOST_ADDR` under the repository’s **Settings → Secrets and variables → Actions**.
3. Push to `main`. CI must pass; then the **Deploy** workflow copies the edge functions to the VPS and restarts the functions service.

The function environment template is [`.env.functions.example`](.env.functions.example). Keep real values on the server or in the approved secret-management flow; never commit them.

## Channel setup

- [WhatsApp via GOWA](channels/whatsapp/)
- [Telegram](docs/telegram-golive.md)
- [SMS](channels/sms/)
- [SQL and RPC contract](docs/sql-contract.md)
