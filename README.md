# GamCiv AI

[![CI](https://github.com/Foday-Sall/gamfix/actions/workflows/ci.yml/badge.svg)](https://github.com/Foday-Sall/gamfix/actions/workflows/ci.yml)

GamCiv AI helps people in The Gambia report local problems—such as water outages, potholes, and broken streetlights—and follow their progress. Reports can come from the web app, WhatsApp, or Telegram. AI helps classify and route them to the right public institution.

## Live site

- Citizen app: <https://gamciv.pocketsoftware.dev/app/>
- Staff and admin dashboard: <https://gamciv.pocketsoftware.dev/dash/>
- API: <https://api.pocketsoftware.dev>

## Run locally

You need Node.js 22 or newer. Copy the example environment file for each frontend:

```bash
for app in frontend/landing frontend/app frontend/dashboard/admin; do
  if [ ! -f "$app/.env" ]; then
    cp "$app/.env.example" "$app/.env"
  fi
done
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in each `.env` file. Then start the app you want to work on:

```bash
cd frontend/app
npm ci
npm run dev
```

Use the same commands from `frontend/landing` or `frontend/dashboard/admin` to run those sites. Never put a service-role key or other private secret in a frontend `.env` file.

To check the backend, install Deno 2 and run:

```bash
cd backend
deno lint
deno test --allow-all
```

## Deploy

For routine releases, GitHub Actions deploys to the configured VPS after CI passes on `main`.

1. Set up the VPS and self-hosted Supabase stack. For the initial server setup, see [DEPLOY.md](DEPLOY.md).
2. In GitHub, open **Settings → Secrets and variables → Actions** and add these repository secrets:
   - `DEPLOY_SSH_KEY` — private SSH key used by the deployment workflow.
   - `VPS_HOST` — SSH destination, such as `root@your-server`.
   - `VPS_HOST_ADDR` — server IP or hostname used to verify its SSH host key.
3. Push a change to `main`. The **CI** workflow runs tests and builds; when it succeeds, **Deploy** publishes the frontends and edge functions.

You can also start **Deploy** manually from GitHub Actions with **Run workflow**. Do not commit real keys, `.env` files, or passwords.

## Project layout

- `frontend/landing/` — public landing page.
- `frontend/app/` — citizen reporting and tracking app.
- `frontend/dashboard/admin/` — institution and admin dashboard.
- `backend/db/` — database schema, migrations, routing, and access rules.
- `backend/functions/` — server-side functions for webhooks, uploads, authentication, and notifications.
- `backend/channels/` — WhatsApp, Telegram, and SMS setup notes.

More detail: [backend/README.md](backend/README.md), [deployment guide](DEPLOY.md), and [channel setup](backend/channels/README.md).
