# Termii Provider (Fallback)

Commercial SMS aggregator fallback, implemented in
[`../../functions/notify-out/termii.ts`](../../functions/notify-out/termii.ts)
(`FetchTermiiClient`, provider name `termii`). It was the original SMS provider before
the Android gateway; it is kept for backwards compatibility and as a backup when no
gateway phone is available.

## How it works

```
notify-out
  → POST {TERMII_ENDPOINT}/api/sms/send
     body: { "to": "<phone without +>", "from": "<sender id>", "sms": "<text>",
             "type": "plain", "channel": "generic", "api_key": "<key>" }
  → Termii returns a message id, recorded as provider_ref in the DB
```

Recipient numbers are normalized: a leading `+` is stripped (Termii requires
international format **without** the plus sign).

## Configuration (env vars)

| Variable | Required | Purpose |
|---|---|---|
| `TERMII_API_KEY` | yes | API key from the Termii dashboard |
| `TERMII_SENDER_ID` | no | Approved sender ID, default `GamCiv` |
| `TERMII_ENDPOINT` | no | API base, default `https://api.ng.termii.com` |

Set them in `/opt/supabase/docker/.env.functions` on the VPS (see
[`../../.env.functions.example`](../../.env.functions.example), where they are listed as
optional).

## Notes

- Termii bills per message and sender IDs need approval — that's why the Android
  gateway is primary and Termii is the fallback.
- Select it explicitly with `SMS_PROVIDER=termii` (see
  [`provider-selection.md`](provider-selection.md)); it is also the automatic choice
  when it is configured and the gateway is not.
- If only Termii is configured, the notification channel is exactly what ran before SMS
  selection was introduced.
