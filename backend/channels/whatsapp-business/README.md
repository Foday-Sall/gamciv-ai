# WhatsApp Business Channel (Meta Cloud API) — PLUG-IN READY

Official WhatsApp Business channel via the Meta WhatsApp Cloud API. The entire intake
function already exists, is tested, and follows the exact same pipeline as the GOWA
channel — the only thing missing is **credentials: an API key (access token) + phone
number ID**. No code work is required to turn this on.

> **Status: plug-in ready.** When Meta approval and a WhatsApp Business account are in
> place, set the four variables below and deploy — nothing else changes.

## What already works

```
Meta webhook POST  /functions/v1/meta-whatsapp-intake
  → verify X-Hub-Signature-256 (HMAC-SHA256 with the app secret, constant-time)
  → webhook verification GET handshake returns hub.challenge as plain text (Cloud API requirement)
  → extract report (text / image media_id / location)
  → AI classify → one rpc submit_complaint call (routing/deadline/grouping logic in SQL)
  → confirmation via graph.facebook.com/{version}/{phone_number_id}/messages
```

Idempotency uses the Meta `wamid` message id, so Meta's duplicate deliveries are safe.
Status/echo webhooks are answered `200 "ignored"` so Meta does not retry them.

## Function source (do not move)

- [`../../functions/meta-whatsapp-intake/`](../../functions/meta-whatsapp-intake/) — `index.ts` (webhook entry) + `meta.ts` (envelope parsing, signature verification, Graph API client)
- Unit tests: [`../../tests/metaWhatsappIntake.test.ts`](../../tests/metaWhatsappIntake.test.ts)

## Configuration to activate (the only remaining step)

| Variable | Purpose |
|---|---|
| `META_PHONE_NUMBER_ID` | Cloud API phone number ID — the sender identity for outbound messages |
| `META_WHATSAPP_TOKEN` | System-user access token used as Bearer for the Graph API |
| `META_APP_SECRET` | App secret, used to verify `X-Hub-Signature-256` on every webhook delivery |
| `META_VERIFY_TOKEN` | Arbitrary string you also enter in the Meta App dashboard webhook config |

Set them in `/opt/supabase/docker/.env.functions` on the VPS (see
[`../.env.functions.example`](../.env.functions.example) for the pattern), register the
webhook URL in the Meta App dashboard with the verify token, then deploy.
