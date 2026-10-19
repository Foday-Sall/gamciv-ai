# SMS Channel

Outbound-only SMS for notifications (there is no SMS intake — citizens file reports on
WhatsApp/Telegram). SMS is the fallback transport when a citizen has no WhatsApp or
WhatsApp delivery fails.

## How it works

```
database notification row
  → pg_net POST /functions/v1/notify-out  (auth: x-gamciv-key = INTERNAL_FUNCTION_KEY)
    → notify-out sends over GOWA (WhatsApp) or SMS, per the notification's channel
      → SMS goes through the provider selected by smsProvider.ts (see providers/)
    → delivery result reported back via rpc notify_out_result
```

One notification id in, one message out; no business logic — status transitions live in SQL.

## Function source (do not move)

- Outbound dispatcher: [`../../functions/notify-out/`](../../functions/notify-out/) — `index.ts` (webhook entry), `smsProvider.ts` (provider selection + clients), `termii.ts`
- Unit tests: [`../../tests/notifyOut.test.ts`](../../tests/notifyOut.test.ts)

## Providers

Two interchangeable providers behind one `SmsClient` interface, selected by the
`SMS_PROVIDER` environment variable — see [`providers/provider-selection.md`](providers/provider-selection.md):

| Provider | Doc | Config |
|---|---|---|
| Android gateway (TextBee-style) — primary | [`providers/android-gateway.md`](providers/android-gateway.md) | `HTTP_GATEWAY_URL`, `HTTP_GATEWAY_API_KEY`, optional `HTTP_GATEWAY_AUTH_HEADER`, `HTTP_GATEWAY_DEVICE_ID` |
| Termii — fallback | [`providers/termii.md`](providers/termii.md) | `TERMII_API_KEY`, `TERMII_SENDER_ID` (default `GamCiv`), `TERMII_ENDPOINT` (default `https://api.ng.termii.com`) |

With no provider configured, `buildSmsClient` returns null and notifications that ask
for SMS report `noop` — WhatsApp remains the only delivery channel, which is exactly how
the system ran before SMS was added.
