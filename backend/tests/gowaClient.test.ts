/** Unit tests for the GOWA webhook parsing and signature verification. */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  extractMessage,
  normalizePhone,
  parseGowaEnvelope,
  verifyGowaSignature,
} from "../functions/_shared/gowaClient.ts";

const SECRET = "test-secret";

async function sign(body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return "sha256=" +
    Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.test("verifyGowaSignature accepts a valid HMAC", async () => {
  const body = JSON.stringify({ event: "message", payload: { body: "hi" } });
  const sig = await sign(body);
  assertEquals(await verifyGowaSignature(new TextEncoder().encode(body), sig, SECRET), true);
});

Deno.test("verifyGowaSignature rejects a tampered body", async () => {
  const body = JSON.stringify({ event: "message", payload: { body: "hi" } });
  const sig = await sign(body);
  const tampered = body.replace("hi", "BYE");
  assertEquals(await verifyGowaSignature(new TextEncoder().encode(tampered), sig, SECRET), false);
});

Deno.test("verifyGowaSignature rejects missing/bad prefix", async () => {
  const body = '{"event":"message"}';
  assertEquals(await verifyGowaSignature(new TextEncoder().encode(body), null, SECRET), false);
  assertEquals(
    await verifyGowaSignature(new TextEncoder().encode(body), "sha256=deadbeef", SECRET),
    false,
  );
});

Deno.test("parseGowaEnvelope rejects invalid JSON and missing event", () => {
  assertEquals(parseGowaEnvelope("not json"), null);
  assertEquals(parseGowaEnvelope('{"payload":{}}'), null);
  const ok = parseGowaEnvelope('{"event":"message","payload":{"body":"x"}}');
  assertEquals(ok?.event, "message");
});

Deno.test("extractMessage handles a text report", () => {
  const env = parseGowaEnvelope(
    JSON.stringify({
      event: "message",
      device_id: "2205000000@s.whatsapp.net",
      payload: {
        id: "MSG1",
        chat_id: "2207123456@s.whatsapp.net",
        from: "2207123456@s.whatsapp.net",
        sender_display_name: "Lamin",
        is_from_me: false,
        body: "No water in Bakoteh since morning",
      },
    }),
  )!;
  const msg = extractMessage(env)!;
  assertEquals(msg.phone, "2207123456");
  assertEquals(msg.name, "Lamin");
  assertEquals(msg.body, "No water in Bakoteh since morning");
  assertEquals(msg.isGroup, false);
});

Deno.test("extractMessage ignores own outgoing messages", () => {
  const env = parseGowaEnvelope(
    JSON.stringify({
      event: "message",
      payload: { from: "2205000000@s.whatsapp.net", is_from_me: true, body: "out" },
    }),
  )!;
  assertEquals(extractMessage(env), null);
});

Deno.test("extractMessage ignores group chats", () => {
  const env = parseGowaEnvelope(
    JSON.stringify({
      event: "message",
      payload: {
        chat_id: "120363410888139023@g.us",
        from: "2207123456@s.whatsapp.net",
        body: "group msg",
      },
    }),
  )!;
  assertEquals(extractMessage(env), null);
});

Deno.test("extractMessage ignores non-message events", () => {
  const env = parseGowaEnvelope(JSON.stringify({ event: "message.ack", payload: {} }))!;
  assertEquals(extractMessage(env), null);
});

Deno.test("extractMessage reads location payloads", () => {
  const env = parseGowaEnvelope(
    JSON.stringify({
      event: "message",
      payload: {
        from: "2207123456@s.whatsapp.net",
        location: { degreesLatitude: 13.455, degreesLongitude: -16.689, name: "Bakoteh" },
      },
    }),
  )!;
  const msg = extractMessage(env)!;
  assertEquals(msg.lat, 13.455);
  assertEquals(msg.lng, -16.689);
});

Deno.test("extractMessage reads captioned image (object form)", () => {
  const env = parseGowaEnvelope(
    JSON.stringify({
      event: "message",
      payload: {
        from: "2207123456@s.whatsapp.net",
        body: "overflowing dump",
        image: { path: "statics/media/x.jpeg" },
      },
    }),
  )!;
  const msg = extractMessage(env)!;
  assertEquals(msg.body, "overflowing dump");
  assertEquals(msg.imageUrl, "statics/media/x.jpeg");
});

Deno.test("extractMessage reads image path string form", () => {
  const env = parseGowaEnvelope(
    JSON.stringify({
      event: "message",
      payload: { from: "2207123456@s.whatsapp.net", image: "statics/media/x.jpeg" },
    }),
  )!;
  const msg = extractMessage(env)!;
  assertEquals(msg.imageUrl, "statics/media/x.jpeg");
});

Deno.test("normalizePhone strips JID to digits", () => {
  assertEquals(normalizePhone("2207123456@s.whatsapp.net"), "2207123456");
  assertEquals(normalizePhone("2207123456"), "2207123456");
  assertEquals(normalizePhone("120363410888139023@g.us"), "120363410888139023");
});
