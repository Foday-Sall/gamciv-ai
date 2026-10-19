# Android Gateway Provider (TextBee-style)

Primary SMS provider: a cheap Android phone running a TextBee-style gateway app acts as
the SMS modem. `notify-out` POSTs to its HTTP API; the phone sends the actual SMS over
the cellular network. No SMS aggregator account or per-message cost beyond data.

Implemented in [`../../functions/notify-out/smsProvider.ts`](../../functions/notify-out/smsProvider.ts)
as `FetchHttpGatewayClient` (provider name `http_gateway`).

## How it works

```
notify-out
  → POST {HTTP_GATEWAY_URL}/gateway/send-sms
     headers: x-api-key: {HTTP_GATEWAY_API_KEY}   (or Authorization: Bearer …)
     body:    {"recipients": ["<phone>"], "message": "<text>", "deviceId": "<optional>"}
  → gateway queues the message on the paired Android phone, which sends the SMS
  → response's message id is recorded as provider_ref in the DB
```

## Configuration (env vars)

| Variable | Required | Purpose |
|---|---|---|
| `HTTP_GATEWAY_URL` | yes | Base URL of the gateway, no trailing slash needed (trailing slashes are stripped) |
| `HTTP_GATEWAY_API_KEY` | yes | API key the gateway expects |
| `HTTP_GATEWAY_AUTH_HEADER` | no | `x-api-key` (default, TextBee) or `bearer` to send the key as `Authorization: Bearer` instead |
| `HTTP_GATEWAY_DEVICE_ID` | no | Pin a specific registered phone; omit to use the gateway default |

These are read by `loadHttpGatewayConfig` in
[`../../functions/notify-out/smsProvider.ts`](../../functions/notify-out/smsProvider.ts);
set them in `/opt/supabase/docker/.env.functions` on the VPS (see
[`../../.env.functions.example`](../../.env.functions.example)).

## Setup notes

1. Install the gateway app on a spare Android phone with SIM and register it — you get
   the base URL and API key from the gateway web console.
2. Add `HTTP_GATEWAY_URL` + `HTTP_GATEWAY_API_KEY` to the functions env file.
3. Select the provider with `SMS_PROVIDER=http_gateway` (see
   [`provider-selection.md`](provider-selection.md) — it is also the automatic first
   choice when both providers are configured).
4. Restart/recreate the functions container so `env_file` changes are picked up.

Non-2xx responses surface as `HTTP <status>: <body…>` in the delivery error recorded via
`rpc notify_out_result`, so a dead phone or expired key shows up in the notifications
table, not just in logs.
