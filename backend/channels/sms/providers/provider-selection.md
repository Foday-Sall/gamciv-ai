# SMS Provider Selection

How `notify-out` decides which SMS provider sends a message. All of this is implemented
in one small function — `selectSmsProvider` in
[`../../functions/notify-out/smsProvider.ts`](../../functions/notify-out/smsProvider.ts) —
so the chain below is the single source of truth.

## Decision chain

```
read SMS_PROVIDER (trimmed, lowercased)
│
├─ "http_gateway"  → use the Android gateway, but ONLY if HTTP_GATEWAY_URL
│                    and HTTP_GATEWAY_API_KEY are both set; otherwise → no provider (null)
├─ "termii"        → use Termii, but ONLY if TERMII_API_KEY is set; otherwise null
├─ anything else   → log "unknown SMS_PROVIDER …, falling back to auto-detection"
│                    and continue below
└─ unset           → auto-detect:
                     1. gateway configured (URL + key)? → http_gateway
                     2. else TERMII_API_KEY set?        → termii
                     3. else                            → null (SMS disabled; report noop)
```

Key points:

- **Explicit wins.** `SMS_PROVIDER=http_gateway` forces the gateway; `SMS_PROVIDER=termii`
  forces Termii. A forced provider with missing credentials is an error state (null),
  never a silent switch to the other provider.
- **Auto-detect prefers the gateway.** When `SMS_PROVIDER` is unset and both providers
  are configured, the Android gateway is chosen first; Termii is the fallback.
- **No provider configured** → `buildSmsClient` returns null and SMS notifications report
  `noop` — the WhatsApp channel remains the only delivery path (the pre-SMS behavior).
- Selection happens once per `notify-out` invocation; tests stub either client through
  the `SmsClient` interface.

## Provider capability summary

| | `http_gateway` | `termii` |
|---|---|---|
| Doc | [android-gateway.md](android-gateway.md) | [termii.md](termii.md) |
| Env to be "ready" | `HTTP_GATEWAY_URL` + `HTTP_GATEWAY_API_KEY` | `TERMII_API_KEY` |
| Extra env | `HTTP_GATEWAY_AUTH_HEADER`, `HTTP_GATEWAY_DEVICE_ID` | `TERMII_SENDER_ID`, `TERMII_ENDPOINT` |
| Cost model | SIM + data (own phone) | per-message billing |
| Role | primary | fallback / backwards compatibility |
