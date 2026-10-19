# WhatsApp Channel (GOWA / personal number)

Personal-WhatsApp channel built on [GOWA](https://github.com/aldinokemal/go-whatsapp-web-multidevice)
(go-whatsapp-web-multidevice). One linked phone acts as the GamCiv hotline: citizens send
reports in, the system classifies and files them, and confirmations plus later status
notifications go back out over the same number. This is the channel that is **live**.

## How it works

```
citizen WhatsApp message
  → GOWA webhook POST  https://api.pocketsoftware.dev/functions/v1/whatsapp-intake
    → verify HMAC (X-Signature vs GOWA_WEBHOOK_SECRET, constant-time)
    → extract report → AI classify (OpenAI-compatible endpoint)
    → one rpc submit_complaint call (all routing/deadline/grouping logic lives in SQL)
    → GOWA confirmation message back to the citizen
```

Outbound notifications (new-message / status-change alerts) are dispatched by the
`notify-out` function: the database calls it via `pg_net`, it sends through GOWA and
reports delivery back with `rpc notify_out_result`.

## Function source (do not move)

- Intake: [`../../functions/whatsapp-intake/`](../../functions/whatsapp-intake/) — `index.ts`
- Outbound: [`../../functions/notify-out/`](../../functions/notify-out/) — GOWA is its primary transport
- GOWA REST client + webhook HMAC: [`../../functions/_shared/gowaClient.ts`](../../functions/_shared/gowaClient.ts)
- Unit tests: [`../../tests/intake.test.ts`](../../tests/intake.test.ts), [`../../tests/gowaClient.test.ts`](../../tests/gowaClient.test.ts), [`../../tests/notifyOut.test.ts`](../../tests/notifyOut.test.ts)

## Configuration

| Variable | Used by | Purpose |
|---|---|---|
| `GOWA_BASE_URL` | intake + notify-out | Public HTTPS base for the GOWA REST API (e.g. `https://gowa.quiz.gm`) |
| `GOWA_BASIC_AUTH` | intake + notify-out | GOWA Basic auth, `user:pass` |
| `GOWA_DEVICE_ID` | intake + notify-out | Optional; only when more than one device is linked |
| `GOWA_WEBHOOK_SECRET` | intake | Must match the per-device webhook secret configured in GOWA |

See [`../.env.functions.example`](../.env.functions.example) for the full set; secrets live in
`/opt/supabase/docker/.env.functions` on the VPS (chmod 600, wired in via `env_file`).

## Setup notes

1. Deploy GOWA and link the hotline phone (scan QR once).
2. Point GOWA's webhook at the `whatsapp-intake` endpoint above and set the same
   secret in `GOWA_WEBHOOK_SECRET`.
3. Deploy the functions: `VPS_HOST=... SSH_KEY=... bash scripts/deploy.sh` (see
   [`../../README.md`](../../README.md)).

Guarantees baked into the intake: a failed confirmation never fails the intake (the
report is already committed), hard failures return 500 so GOWA retries, and re-submission
is idempotent via `external_id` dedupe in the SQL function.
