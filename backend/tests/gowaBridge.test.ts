/** Unit tests for the gowa-bridge: GOWA ⇄ picoclaw frame conversion + HMAC. */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  gowaToPicoclaw,
  picoclawToGowa,
  verifyGowaSignature,
  type GowaEnvelope,
} from "../channels/gowa-bridge/index.ts";

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

function envelope(overrides: Partial<GowaEnvelope["payload"]> = {}): GowaEnvelope {
  return {
    event: "message",
    device_id: "2205111924@s.whatsapp.net",
    payload: {
      id: "MSG1",
      chat_id: "2201234567@s.whatsapp.net",
      from: "2201234567@s.whatsapp.net",
      sender_display_name: "Lamin",
      is_from_me: false,
      body: "No water in Bakoteh",
      ...overrides,
    },
  };
}

// ---------------------------------------------------------------------------
// GOWA → picoclaw
// ---------------------------------------------------------------------------

Deno.test("gowaToPicoclaw converts a direct message", () => {
  const f = gowaToPicoclaw(envelope());
  assertEquals(f, {
    type: "message",
    from: "2201234567@s.whatsapp.net",
    chat: "2201234567@s.whatsapp.net",
    content: "No water in Bakoteh",
    media: [],
    id: "MSG1",
    from_name: "Lamin",
  });
});

Deno.test("gowaToPicoclaw passes group JIDs through in chat", () => {
  const f = gowaToPicoclaw(envelope({
    chat_id: "1203630218888@g.us",
    from: "2201234567@s.whatsapp.net",
    body: "hello group",
  }));
  assertEquals(f?.chat, "1203630218888@g.us");
  assertEquals(f?.from, "2201234567@s.whatsapp.net");
});

Deno.test("gowaToPicoclaw ignores non-message events and own messages", () => {
  assertEquals(gowaToPicoclaw({ event: "group.participants" }), null);
  assertEquals(gowaToPicoclaw(envelope({ is_from_me: true })), null);
  assertEquals(gowaToPicoclaw({ event: "message", payload: {} }), null);
});

Deno.test("gowaToPicoclaw uses image caption as content", () => {
  const f = gowaToPicoclaw(envelope({
    body: "",
    image: { caption: "Broken pipe flooding the street" },
  }));
  assertEquals(f?.content, "Broken pipe flooding the street");
});

Deno.test("gowaToPicoclaw falls back to from_name when display name is absent", () => {
  const f = gowaToPicoclaw(envelope({ sender_display_name: undefined, from_name: "Fatou" }));
  assertEquals(f?.from_name, "Fatou");
});

Deno.test("gowaToPicoclaw never forwards media paths", () => {
  const f = gowaToPicoclaw(envelope({ image: "/app/storages/media/photo.jpg" }));
  assertEquals(f?.media, []);
});

// ---------------------------------------------------------------------------
// picoclaw → GOWA
// ---------------------------------------------------------------------------

Deno.test("picoclawToGowa converts the outbound frame", () => {
  const g = picoclawToGowa({ type: "message", to: "2201234567@s.whatsapp.net", content: "Received." });
  assertEquals(g, { phone: "2201234567@s.whatsapp.net", message: "Received." });
});

Deno.test("picoclawToGowa rejects malformed frames", () => {
  assertEquals(picoclawToGowa({ type: "ping" as "message", to: "x", content: "y" } as never), null);
  assertEquals(picoclawToGowa({ type: "message", to: "", content: "y" }), null);
  assertEquals(picoclawToGowa({ type: "message", to: "x", content: "" }), null);
});

Deno.test("picoclawToGowa passes JIDs through verbatim", () => {
  const g = picoclawToGowa({ type: "message", to: "1203630218888@g.us", content: "Group reply" });
  assertEquals(g?.phone, "1203630218888@g.us");
});

// ---------------------------------------------------------------------------
// HMAC
// ---------------------------------------------------------------------------

Deno.test("verifyGowaSignature accepts valid and rejects tampered", async () => {
  const body = JSON.stringify(envelope());
  assertEquals(await verifyGowaSignature(new TextEncoder().encode(body), await sign(body), SECRET), true);
  const tampered = body.replace("No water", "NO WATER");
  assertEquals(await verifyGowaSignature(new TextEncoder().encode(tampered), await sign(body), SECRET), false);
});

Deno.test("verifyGowaSignature rejects missing/bad prefix and wrong secret", async () => {
  const body = JSON.stringify(envelope());
  const raw = new TextEncoder().encode(body);
  assertEquals(await verifyGowaSignature(raw, null, SECRET), false);
  assertEquals(await verifyGowaSignature(raw, "deadbeef", SECRET), false);
  assertEquals(await verifyGowaSignature(raw, await sign(body), "other-secret"), false);
});
