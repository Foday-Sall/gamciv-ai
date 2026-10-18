/**
 * setWebhook helper — one Bot API call to activate the telegram-intake
 * webhook. Run with deno after TELEGRAM_BOT_TOKEN / TELEGRAM_WEBHOOK_SECRET
 * (and optionally the public webhook URL) are set:
 *
 *   deno run --allow-env --allow-net functions/telegram-intake/setWebhook.ts \
 *     https://api.pocketsoftware.dev/functions/v1/telegram-intake
 *
 * Or call the Bot API directly with curl (no code needed) — see README.md.
 */

const url = Deno.args[0];
if (!url) {
  console.error(
    "usage: deno run --allow-env --allow-net functions/telegram-intake/setWebhook.ts <public-webhook-url>",
  );
  Deno.exit(1);
}
const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
const secret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");
if (!token || !secret) {
  console.error("TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET must be set");
  Deno.exit(1);
}

// The secret token is echoed by Telegram in the X-Telegram-Bot-Api-Secret-Token
// header of every webhook delivery; the intake handler verifies it.
const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    url,
    secret_token: secret,
    allowed_updates: ["message"],
    drop_pending_updates: true,
  }),
});
const body = await res.json().catch(() => null);
if (!res.ok || !body?.ok) {
  console.error(`setWebhook failed: HTTP ${res.status}`, body?.description ?? "");
  Deno.exit(1);
}
console.log("webhook set:", url);
console.log("secret token registered (Telegram will send it in every delivery)");
