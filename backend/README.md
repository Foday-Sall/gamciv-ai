# GamCiv AI — Edge Functions API layer

Deno edge functions for the GamCiv AI public complaints system (UTG-ITCA hackathon). Per the
architecture lock, edge functions are **thin connectors only**:

- **whatsapp-intake** — GOWA webhook → verify HMAC → extract report → classify via an
  OpenAI-compatible chat completion → ONE `rpc submit_complaint` call → GOWA confirmation message.
  All routing/deadline/grouping logic lives in the SQL function.
- **notify-out** — DB (pg_net) → single POST → GOWA (WhatsApp) or the configured SMS provider
  (Termii, or a TextBee-style Android HTTP gateway), with the delivery result reported back via
  `rpc notify_out_result`.

Everything else (citizen tracking, officer queue, admin, public map) is plain PostgREST from the
frontend — no functions involved.

```
functions/
  main/           # dispatcher (upstream Supabase self-hosted template; routes
                  # /functions/v1/<name> to a user worker per function dir)
  _shared/        # aiClient, gowaClient, termii, rpcClient, config, http, types
  whatsapp-intake/
  telegram-intake/
  notify-out/     # smsProvider.ts: termii or http_gateway (TextBee-style) via SMS_PROVIDER
tests/            # deno test (unit, stubbed network)
docs/sql-contract.md  # RPC contract the SQL side must implement
```

## Local development

```bash
deno check --all functions/whatsapp-intake/index.ts functions/notify-out/index.ts
deno test --allow-all tests/
```

## Deploy (self-hosted Supabase)

The stack runs at `/opt/supabase/docker` with the edge-runtime mounting `./volumes/functions`.
Deploy = copy the tree + restart the service:

```bash
VPS_HOST=user@your-server SSH_KEY=/path/to/key bash scripts/deploy.sh
```

Secrets live in `/opt/supabase/docker/.env.functions` (see `.env.functions.example`), wired into the
container via `env_file` in `docker-compose.yml`.

Public endpoints (via Cloudflare tunnel):

- `https://api.pocketsoftware.dev/functions/v1/whatsapp-intake` — GOWA webhook target
- `https://api.pocketsoftware.dev/functions/v1/notify-out` — called by pg_net only

## Verification status

- `deno check` clean, 41 unit tests passing (classifier parser, webhook HMAC, envelope extraction,
  intake pipeline, notify-out pipeline — all with stubbed deps).
- Deployed and verified live: signature verification (401 on bad/missing HMAC), greeting onboarding,
  classification → RPC call shape (PostgREST confirms the exact parameter list), notify-out auth +
  dispatch.
- Blocked on the parallel DB agent creating `public.submit_complaint`, `public.notify_out_claim`,
  `public.notify_out_result` + tables (see `docs/sql-contract.md`). The functions will succeed once
  those exist.
