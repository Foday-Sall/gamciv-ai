# GamCiv AI — Messaging Channels

All customer-facing messaging is organized here. Each subfolder is a **self-contained
channel doc**: what the channel does, how it maps onto the actual edge functions in
[`../functions/`](../functions/), and what env/configuration it needs.

The deployable source lives in [`../functions/`](../functions/) — the folders below are
documentation + pointers, not code, so the deploy layout (`backend/functions/<name>/`)
stays untouched.

| Channel | Folder | Function source | Status |
|---|---|---|---|
| WhatsApp (personal, GOWA) | [`whatsapp/`](whatsapp/) | [`../functions/whatsapp-intake/`](../functions/whatsapp-intake/) | Live — intake + notifications |
| WhatsApp Business (Meta Cloud API) | [`whatsapp-business/`](whatsapp-business/) | [`../functions/meta-whatsapp-intake/`](../functions/meta-whatsapp-intake/) | Plug-in ready — awaiting API key + phone number ID |
| Telegram bot | [`telegram/`](telegram/) | [`../functions/telegram-intake/`](../functions/telegram-intake/) | Ready — needs bot token + webhook secret |
| SMS | [`sms/`](sms/) | [`../functions/notify-out/`](../functions/notify-out/) (`smsProvider.ts`) | Outbound only — Android gateway primary, Termii fallback |

Shared plumbing used by every channel lives in [`../functions/_shared/`](../functions/_shared/)
(AI classifier client, GOWA client, HTTP helpers, RPC client, types) and the outbound
dispatcher is [`../functions/main/`](../functions/main/).

Environment variables for all channels are defined in [`../.env.functions.example`](../.env.functions.example)
and deployed to `/opt/supabase/docker/.env.functions` on the VPS.
