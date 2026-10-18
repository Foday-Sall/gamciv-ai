# GamCiv AI — Backend

Backend for **GamCiv**, a public complaints service for The Gambia. Citizens report problems over WhatsApp, Telegram, web or SMS; the system classifies each report, routes it to the responsible institution, issues a tracking number, and follows the case until the citizen confirms resolution.

Built for the UT-ITCA Hackathon (October 2026).

## What's in here

```
backend/
├── db/                    SQL migrations, applied in order
│   ├── 0001_schema.sql    Tables, enums, constraints
│   ├── 0002_routing.sql   Classification + routing engine
│   ├── 0003_flows.sql     Submission, tracking, confirmation flows
│   ├── 0004_officer.sql   Officer authorization + case actions
│   ├── 0005_escalation.sql  Deadline and escalation logic
│   ├── 0006_admin.sql     Admin functions
│   ├── 0007_rls.sql       Row Level Security policies
│   ├── 0008_ops.sql       Public tracking, storage, realtime, scheduling
│   ├── 0009_seed.sql      Institutions, categories, officers, demo data
│   └── 0010*.sql          Integration layer (edge function contracts)
├── functions/             Supabase Edge Functions (Deno)
│   ├── whatsapp-intake/   GOWA webhook → classify → submit
│   ├── telegram-intake/   Telegram bot webhook
│   ├── meta-whatsapp-intake/  Official Meta Cloud API webhook
│   ├── notify-out/        Outbound WhatsApp/SMS delivery
│   ├── main/              Function router
│   └── _shared/           Clients: AI, GOWA, Telegram, RPC
├── docs/                  API contract documentation
├── tests/                 Deno test suite
└── scripts/               Deployment scripts
```

## Architecture

- **PostgreSQL does the heavy lifting**: routing, escalation, grouping, tracking numbers — all as SQL functions (`rpc/`). No business logic in application code.
- **PostgREST serves data**: the frontend queries it directly; Row Level Security enforces who sees what.
- **Edge Functions are thin connectors**: they only talk to external services (WhatsApp gateways, AI classification, SMS gateways) and make one RPC call into the database.
- **Self-hosted Supabase** at `api.pocketsoftware.dev`.

## Running tests

```bash
deno test --allow-all
```

## Security

Security-reviewed: webhook signature verification, constant-time secret comparison, parameterized SQL throughout, RLS on every table, minimized privilege-escalation attack surface. See `docs/` for the contract between edge functions and the database.
