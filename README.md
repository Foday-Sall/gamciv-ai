# GamC AI (GamCiv)

Civic complaints platform for The Gambia: web app + WhatsApp/Telegram intake + admin console.

- `frontend/landing` — public marketing site
- `frontend/app` — citizen app and per-institution staff dashboards (served at /app)
- `frontend/dashboard/admin` — admin console (served at /dashboard)
- `backend/` — self-hosted Supabase: SQL migrations, Deno edge functions, tests
- `channels/` — optional Go service bridging Telegram/WhatsApp (picoclaw-derived)
- `deploy/` — VPS deploy scripts (parameterized, no secrets)

## Quick start

See **[DEPLOY.md](DEPLOY.md)** for the full clone-and-deploy walkthrough:
env files (.env.example in each frontend), database migrations, edge functions,
email (Resend via Supabase auth hook), WhatsApp (GOWA) and Telegram setup.

## Security model

No secrets are committed. Every environment file is an `*.example` template.
Staff accounts are issued by the admin console; staff see only their own institution.
