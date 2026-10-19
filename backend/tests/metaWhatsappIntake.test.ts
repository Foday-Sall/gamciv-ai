/** Unit tests for the meta-whatsapp-intake pipeline (stubbed deps, no network). */
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildDeps,
  confirmationText,
  extractMessages,
  FetchMetaClient,
  handleRequest,
  parseMetaEnvelope,
  processReport,
  verifyMetaSignature,
} from "../functions/meta-whatsapp-intake/index.ts";
import { GRAPH_API_BASE, GRAPH_API_VERSION } from "../functions/meta-whatsapp-intake/meta.ts";
import type { SubmitComplaintArgs, SubmitComplaintResult } from "../functions/_shared/types.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseResult: SubmitComplaintResult = {
  status: "received",
  tracking_no: "GC-2026-00021",
  institution: "nawec",
  institution_name: "NAWEC",
  department: "Water Distribution",
  expected_response_at: "2026-10-20T09:00:00+00:00",
  confidence: 0.9,
  sensitive: false,
  group_id: null,
};

/** Incoming text message webhook, exactly per the Meta messages reference. */
function textWebhook(
  body: string,
  wamid = "wamid.TEXT1",
  name = "Awa Ceesay",
  waId = "2207123456",
): Record<string, unknown> {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "102290129340398",
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "15550783881", phone_number_id: "106540352242922" },
              contacts: [{ profile: { name }, wa_id: waId }],
              messages: [
                { from: waId, id: wamid, timestamp: "1749416383", type: "text", text: { body } },
              ],
            },
            field: "messages",
          },
        ],
      },
    ],
  };
}

/** Incoming image message webhook (with optional caption). */
function imageWebhook(
  caption: string | null,
  mediaId = "IMG_MEDIA_1",
  wamid = "wamid.IMG1",
  waId = "2207123456",
  name = "Awa Ceesay",
): Record<string, unknown> {
  const image: Record<string, unknown> = {
    mime_type: "image/jpeg",
    sha256: "abc123",
    id: mediaId,
    url: "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=IMG_MEDIA_1",
  };
  if (caption !== null) image.caption = caption;
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "102290129340398",
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "15550783881", phone_number_id: "106540352242922" },
              contacts: [{ profile: { name }, wa_id: waId }],
              messages: [
                { from: waId, id: wamid, timestamp: "1749416383", type: "image", image },
              ],
            },
            field: "messages",
          },
        ],
      },
    ],
  };
}

/** Outgoing-message status webhook (our own echo) — no messages array. */
function statusWebhook(): Record<string, unknown> {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "102290129340398",
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "15550783881", phone_number_id: "106540352242922" },
              statuses: [
                {
                  id: "wamid.STATUS1",
                  status: "delivered",
                  timestamp: "1750263773",
                  recipient_id: "2207123456",
                },
              ],
            },
            field: "messages",
          },
        ],
      },
    ],
  };
}

interface Recorded {
  aiCalls: string[];
  rpcCalls: Array<{ fn: string; args: unknown }>;
  metaSends: Array<{ to: string; text: string }>;
}

function makeDeps(
  opts: {
    ai?: { category: string; urgency: "critical" | "high" | "normal" | "low"; confidence: number } | Error;
    rpcResult?: SubmitComplaintResult | Error;
    sendError?: Error;
  } = {},
): { deps: Parameters<typeof handleRequest>[1]; recorded: Recorded } {
  const recorded: Recorded = { aiCalls: [], rpcCalls: [], metaSends: [] };
  const deps = {
    ai: {
      classify: (
        description: string,
      ): ReturnType<Parameters<typeof handleRequest>[1]["ai"]["classify"]> => {
        recorded.aiCalls.push(description);
        if (opts.ai instanceof Error) return Promise.reject(opts.ai);
        return Promise.resolve(
          opts.ai ?? { category: "water_supply", urgency: "high" as const, confidence: 0.9 },
        );
      },
    },
    rpc: {
      call: (fn: string, args: unknown) => {
        recorded.rpcCalls.push({ fn, args });
        if (opts.rpcResult instanceof Error) return Promise.reject(opts.rpcResult);
        return Promise.resolve((opts.rpcResult ?? baseResult) as never);
      },
    },
    meta: {
      sendMessage: (to: string, text: string) => {
        recorded.metaSends.push({ to, text });
        if (opts.sendError) return Promise.reject(opts.sendError);
        return Promise.resolve({ messageId: "wamid.OUT1" });
      },
    },
  };
  return { deps, recorded };
}

/** Build a signed POST request the way Meta sends webhook deliveries. */
async function signedRequestAsync(
  body: string,
  secret = "metasecret",
): Promise<Request> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const hex = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return new Request("https://api.pocketsoftware.dev/functions/v1/meta-whatsapp-intake", {
    method: "POST",
    headers: { "X-Hub-Signature-256": `sha256=${hex}`, "Content-Type": "application/json" },
    body,
  });
}

// ---------------------------------------------------------------------------
// GET verification handshake
// ---------------------------------------------------------------------------

Deno.test("handshake: GET with correct verify token returns hub.challenge as plain text", async () => {
  const { deps } = makeDeps();
  const req = new Request(
    "https://api.pocketsoftware.dev/functions/v1/meta-whatsapp-intake" +
      "?hub.mode=subscribe&hub.challenge=1158201444&hub.verify_token=mytoken",
  );
  const res = await handleRequest(req, deps, "mytoken");
  assertEquals(res.status, 200);
  assertEquals((await res.text()).trim(), "1158201444");
  assertEquals((res.headers.get("content-type") ?? "").startsWith("text/plain"), true);
});

Deno.test("handshake: wrong verify token is rejected (not 200)", async () => {
  const { deps } = makeDeps();
  const req = new Request(
    "https://example.com/?hub.mode=subscribe&hub.challenge=123&hub.verify_token=WRONG",
  );
  const res = await handleRequest(req, deps, "mytoken");
  assertEquals(res.status !== 200, true);
  assertEquals((await res.text()).includes("1158201444"), false);
});

Deno.test("handshake: missing challenge / wrong mode / unset server token rejected", async () => {
  const { deps } = makeDeps();
  const cases = [
    "https://example.com/?hub.mode=subscribe&hub.verify_token=t", // no challenge
    "https://example.com/?hub.challenge=1&hub.verify_token=t", // no mode
    "https://example.com/?hub.mode=unsubscribe&hub.challenge=1&hub.verify_token=t",
  ];
  for (const url of cases) {
    const res = await handleRequest(new Request(url), deps, "t");
    assertEquals(res.status !== 200, true, url);
  }
  // Unconfigured server-side token rejects everything.
  const res = await handleRequest(
    new Request("https://example.com/?hub.mode=subscribe&hub.challenge=1&hub.verify_token=t"),
    deps,
    "",
  );
  assertEquals(res.status !== 200, true);
});

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

Deno.test("signature: valid X-Hub-Signature-256 accepted end to end", async () => {
  const { deps, recorded } = makeDeps();
  const body = JSON.stringify(textWebhook("No water in Bakoteh"));
  const res = await handleRequest(await signedRequestAsync(body), deps, "mytoken", "metasecret");
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(json.status, "accepted");
  assertEquals(recorded.rpcCalls.length, 1);
});

Deno.test("signature: invalid signature rejected 401, no side effects", async () => {
  const { deps, recorded } = makeDeps();
  const body = JSON.stringify(textWebhook("No water in Bakoteh"));
  const req = new Request("https://example.com/", {
    method: "POST",
    headers: { "X-Hub-Signature-256": "sha256=deadbeef" },
    body,
  });
  const res = await handleRequest(req, deps, "mytoken", "metasecret");
  assertEquals(res.status, 401);
  assertEquals(recorded.rpcCalls.length, 0);
});

Deno.test("signature: tampered body with valid-format sig rejected 401", async () => {
  const req = await signedRequestAsync(
    JSON.stringify(textWebhook("No water in Bakoteh")),
  );
  // Swap the body after signing.
  await req.text();
  const sig = req.headers.get("X-Hub-Signature-256") ?? "";
  const tampered = new Request("https://example.com/", {
    method: "POST",
    headers: { "X-Hub-Signature-256": sig },
    body: JSON.stringify(textWebhook("FAKE tampered content")),
  });
  const { deps: deps2 } = makeDeps();
  const res = await handleRequest(tampered, deps2, "mytoken", "metasecret");
  assertEquals(res.status, 401);
});

Deno.test("signature: missing header and missing secret rejected 401", async () => {
  const { deps } = makeDeps();
  const body = JSON.stringify(textWebhook("hello"));
  const noHeader = new Request("https://example.com/", { method: "POST", body });
  assertEquals((await handleRequest(noHeader, deps, "mytoken", "metasecret")).status, 401);

  const signed = await signedRequestAsync(body);
  const { deps: deps2 } = makeDeps();
  assertEquals((await handleRequest(signed, deps2, "mytoken", "")).status, 401);
});

Deno.test("verifyMetaSignature: sha256= prefix required, constant-time result", async () => {
  const raw = new TextEncoder().encode("payload");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode("metasecret"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, raw);
  const hex = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
  assertEquals(await verifyMetaSignature(raw, `sha256=${hex}`, "metasecret"), true);
  assertEquals(await verifyMetaSignature(raw, hex, "metasecret"), false); // no prefix
  assertEquals(await verifyMetaSignature(raw, `sha256=${hex}`, "wrongsecret"), false);
  assertEquals(await verifyMetaSignature(raw, null, "metasecret"), false);
  assertEquals(await verifyMetaSignature(raw, "sha256=", "metasecret"), false);
});

// ---------------------------------------------------------------------------
// Message normalization
// ---------------------------------------------------------------------------

Deno.test("extractMessages: text message maps sender, name, id, body", () => {
  const msgs = extractMessages(textWebhook("No water in Bakoteh"));
  assertEquals(msgs.length, 1);
  const m = msgs[0];
  assertEquals(m.waId, "2207123456");
  assertEquals(m.name, "Awa Ceesay");
  assertEquals(m.messageId, "wamid.TEXT1");
  assertEquals(m.body, "No water in Bakoteh");
  assertEquals(m.mediaId, null);
  assertEquals(m.lat, null);
  assertEquals(m.lng, null);
});

Deno.test("extractMessages: image message captures media_id and caption", () => {
  const msgs = extractMessages(imageWebhook("Broken pipe flooding the street", "IMG_MEDIA_9"));
  assertEquals(msgs.length, 1);
  const m = msgs[0];
  assertEquals(m.mediaId, "IMG_MEDIA_9");
  assertEquals(m.body, "Broken pipe flooding the street");
  assertEquals(m.messageId, "wamid.IMG1");
  assertEquals(m.waId, "2207123456");
});

Deno.test("extractMessages: image without caption still has empty body + media id", () => {
  const msgs = extractMessages(imageWebhook(null, "IMG_MEDIA_2"));
  assertEquals(msgs.length, 1);
  assertEquals(msgs[0].body, "");
  assertEquals(msgs[0].mediaId, "IMG_MEDIA_2");
});

Deno.test("extractMessages: location message maps lat/lng", () => {
  const webhook = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "1",
        changes: [
          {
            value: {
              contacts: [{ profile: { name: "Fatou" }, wa_id: "2207000111" }],
              messages: [
                {
                  from: "2207000111",
                  id: "wamid.LOC1",
                  timestamp: "1",
                  type: "location",
                  location: { latitude: 13.4549, longitude: -16.579 },
                },
              ],
            },
            field: "messages",
          },
        ],
      },
    ],
  };
  const msgs = extractMessages(webhook);
  assertEquals(msgs.length, 1);
  assertEquals(msgs[0].lat, 13.4549);
  assertEquals(msgs[0].lng, -16.579);
  assertEquals(msgs[0].messageId, "wamid.LOC1");
});

Deno.test("extractMessages: status/echo webhook yields no messages", () => {
  assertEquals(extractMessages(statusWebhook()).length, 0);
  // Plain echo of our own outgoing message (no statuses, no messages).
  assertEquals(extractMessages({ object: "whatsapp_business_account", entry: [] }).length, 0);
  assertEquals(extractMessages({}).length, 0);
  assertEquals(extractMessages(null).length, 0);
});

Deno.test("extractMessages: non-message fields and unsupported types are ignored", () => {
  const webhook = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "1",
        changes: [
          { value: { messaging_product: "whatsapp" }, field: "message_template_status_update" },
          { value: { contacts: [], messages: [{ from: "1", id: "x", type: "sticker" }] }, field: "messages" },
          { value: { contacts: [], messages: [{ from: "1", id: "y", type: "reaction" }] }, field: "messages" },
        ],
      },
    ],
  };
  assertEquals(extractMessages(webhook).length, 0);
});

Deno.test("extractMessages: handles multiple entries/changes (batching)", () => {
  const webhook = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "1",
        changes: [
          {
            value: {
              contacts: [{ profile: { name: "A" }, wa_id: "1" }],
              messages: [
                { from: "1", id: "wamid.A1", type: "text", text: { body: "one" } },
                { from: "1", id: "wamid.A2", type: "text", text: { body: "two" } },
              ],
            },
            field: "messages",
          },
        ],
      },
    ],
  };
  assertEquals(extractMessages(webhook).length, 2);
});

// ---------------------------------------------------------------------------
// Text message pipeline
// ---------------------------------------------------------------------------

Deno.test("handleRequest: text message files report with correct submit_complaint args", async () => {
  const { deps, recorded } = makeDeps();
  const body = JSON.stringify(textWebhook("No water in Bakoteh since morning"));
  const res = await handleRequest(await signedRequestAsync(body), deps, "mytoken", "metasecret");
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(json.status, "accepted");

  assertEquals(recorded.rpcCalls.length, 1);
  assertEquals(recorded.rpcCalls[0].fn, "submit_complaint");
  const args = recorded.rpcCalls[0].args as SubmitComplaintArgs;
  assertEquals(args.p_channel, "whatsapp");
  assertEquals(args.p_title, "No water in Bakoteh since morning");
  assertEquals(args.p_description, "No water in Bakoteh since morning");
  assertEquals(args.p_category_hint, "water_supply");
  assertEquals(args.p_urgency_hint, "high");
  assertEquals(args.p_confidence, 0.9);
  assertEquals(args.p_ai_category, "water_supply");
  assertEquals(args.p_ai_urgency, "high");
  assertEquals(args.p_lat, null);
  assertEquals(args.p_lng, null);
  assertEquals(args.p_photo_url, null);
  assertEquals(args.p_citizen_name, "Awa Ceesay");
  assertEquals(args.p_citizen_phone, "2207123456");
  assertEquals(args.p_is_anonymous, false);
  assertEquals(args.p_external_id, "wamid.TEXT1");

  // Confirmation sent back to the same WhatsApp user
  assertEquals(recorded.metaSends.length, 1);
  assertEquals(recorded.metaSends[0].to, "2207123456");
  assertStringIncludes(recorded.metaSends[0].text, "GC-2026-00021");
  assertStringIncludes(recorded.metaSends[0].text, "NAWEC");
});

// ---------------------------------------------------------------------------
// Image message pipeline
// ---------------------------------------------------------------------------

Deno.test("handleRequest: image with caption is filed with media id", async () => {
  const { deps, recorded } = makeDeps();
  const body = JSON.stringify(imageWebhook("Broken pipe flooding the street", "IMG_MEDIA_9"));
  const res = await handleRequest(await signedRequestAsync(body), deps, "mytoken", "metasecret");
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(json.status, "accepted");

  assertEquals(recorded.rpcCalls.length, 1);
  const args = recorded.rpcCalls[0].args as SubmitComplaintArgs;
  assertEquals(args.p_photo_url, "IMG_MEDIA_9");
  assertEquals(args.p_description, "Broken pipe flooding the street");
  assertEquals(args.p_title, "Broken pipe flooding the street");
  assertEquals(args.p_external_id, "wamid.IMG1");
  assertEquals(args.p_channel, "whatsapp");
  assertEquals(recorded.aiCalls, ["Broken pipe flooding the street"]);
});

Deno.test("handleRequest: image without caption still files a report (no loss)", async () => {
  const { deps, recorded } = makeDeps();
  const body = JSON.stringify(imageWebhook(null, "IMG_MEDIA_3"));
  const res = await handleRequest(await signedRequestAsync(body), deps, "mytoken", "metasecret");
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(json.status, "accepted");
  assertEquals(recorded.rpcCalls.length, 1);
  const args = recorded.rpcCalls[0].args as SubmitComplaintArgs;
  assertEquals(args.p_photo_url, "IMG_MEDIA_3");
  assertEquals(args.p_description, "Photo report sent via Meta WhatsApp (no caption)");
  assertEquals(recorded.aiCalls.length, 0); // nothing to classify
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

Deno.test("processReport: duplicate wamid reuses the same external_id (SQL side dedupes)", async () => {
  const { deps, recorded } = makeDeps();
  const m1 = extractMessages(textWebhook("No water in Bakoteh", "wamid.SAME"))![0];
  await processReport(m1, deps);
  // Same Meta message delivered again (webhook retry):
  const m2 = extractMessages(textWebhook("No water in Bakoteh", "wamid.SAME"))![0];
  await processReport(m2, deps);

  assertEquals(recorded.rpcCalls.length, 2);
  const a1 = recorded.rpcCalls[0].args as SubmitComplaintArgs;
  const a2 = recorded.rpcCalls[1].args as SubmitComplaintArgs;
  assertEquals(a1.p_external_id, "wamid.SAME");
  assertEquals(a1.p_external_id, a2.p_external_id);
});

// ---------------------------------------------------------------------------
// Status / echo webhooks
// ---------------------------------------------------------------------------

Deno.test("handleRequest: status webhook ignored gracefully with 200", async () => {
  const { deps, recorded } = makeDeps();
  const body = JSON.stringify(statusWebhook());
  const res = await handleRequest(await signedRequestAsync(body), deps, "mytoken", "metasecret");
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(json.status, "ignored");
  assertEquals(recorded.rpcCalls.length, 0);
  assertEquals(recorded.metaSends.length, 0);
});

Deno.test("handleRequest: other non-intake payloads ignored gracefully", async () => {
  const { deps } = makeDeps();
  const webhook = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "1",
        changes: [
          { value: { errors: [{ code: 131047 }] }, field: "messages" },
        ],
      },
    ],
  };
  const res = await handleRequest(
    await signedRequestAsync(JSON.stringify(webhook)),
    deps,
    "mytoken",
    "metasecret",
  );
  assertEquals(res.status, 200);
  assertEquals(((await res.json()) as { status: string }).status, "ignored");
});

// ---------------------------------------------------------------------------
// Robustness
// ---------------------------------------------------------------------------

Deno.test("handleRequest: invalid JSON body rejected 400", async () => {
  const { deps } = makeDeps();
  const res = await handleRequest(
    await signedRequestAsync("not json"),
    deps,
    "mytoken",
    "metasecret",
  );
  assertEquals(res.status, 400);
});

Deno.test("handleRequest: oversized body rejected 413 before parsing", async () => {
  const { deps, recorded } = makeDeps();
  const res = await handleRequest(
    await signedRequestAsync("x".repeat(513 * 1024)),
    deps,
    "mytoken",
    "metasecret",
  );
  assertEquals(res.status, 413);
  assertEquals(recorded.rpcCalls.length, 0);
});

Deno.test("processReport: oversized fields are truncated to the shared limits", async () => {
  const { deps, recorded } = makeDeps();
  const longBody = "water ".repeat(500); // 3000 chars > 2000 limit
  const webhook = {
    object: "whatsapp_business_account",
    entry: [{
      id: "1",
      changes: [{
        value: {
          contacts: [{ profile: { name: "N".repeat(150) }, wa_id: "2207123456" }],
          messages: [{ from: "2207123456", id: "wamid.LONG1", type: "text", text: { body: longBody } }],
        },
        field: "messages",
      }],
    }],
  };
  const m = extractMessages(webhook)![0];
  await processReport(m, deps);
  const args = recorded.rpcCalls[0].args as SubmitComplaintArgs;
  assertEquals(args.p_description.length, 2000);
  assertEquals(args.p_citizen_name!.length, 100);
  // makeTitle caps the first line at 80 (inner function), outer bounded() keeps it ≤ 200
  assertEquals(args.p_title!.length, 80);
});

Deno.test("handleRequest: AI failure still files the report (hints null)", async () => {
  const { deps, recorded } = makeDeps({ ai: new Error("ai down") });
  const body = JSON.stringify(textWebhook("No water in Bakoteh"));
  const res = await handleRequest(await signedRequestAsync(body), deps, "mytoken", "metasecret");
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(json.status, "accepted");
  const args = recorded.rpcCalls[0].args as SubmitComplaintArgs;
  assertEquals(args.p_ai_category, null);
  assertEquals(args.p_urgency_hint, null);
  assertEquals(args.p_confidence, null);
});

Deno.test("processReport: RPC failure propagates (caller returns 500 so Meta retries)", async () => {
  const { deps } = makeDeps({ rpcResult: new Error("db down") });
  const m = extractMessages(textWebhook("No water"))![0];
  let threw = false;
  try {
    await processReport(m, deps);
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

Deno.test("processReport: Meta send failure does not fail the intake", async () => {
  const { deps, recorded } = makeDeps({ sendError: new Error("meta down") });
  const m = extractMessages(textWebhook("No water"))![0];
  const outcome = await processReport(m, deps);
  assertEquals(outcome.status, "accepted");
  assertEquals(recorded.metaSends.length, 1);
});

Deno.test("handleRequest: processes all messages in a batched delivery", async () => {
  const { deps, recorded } = makeDeps();
  const webhook = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "1",
        changes: [
          {
            value: {
              contacts: [{ profile: { name: "A" }, wa_id: "1" }],
              messages: [
                { from: "1", id: "wamid.B1", type: "text", text: { body: "first" } },
                { from: "1", id: "wamid.B2", type: "text", text: { body: "second" } },
              ],
            },
            field: "messages",
          },
        ],
      },
    ],
  };
  const res = await handleRequest(
    await signedRequestAsync(JSON.stringify(webhook)),
    deps,
    "mytoken",
    "metasecret",
  );
  assertEquals(res.status, 200);
  assertEquals(recorded.rpcCalls.length, 2);
});

// ---------------------------------------------------------------------------
// Confirmation copy & misc
// ---------------------------------------------------------------------------

Deno.test("confirmationText: low confidence routes copy to Central Desk", () => {
  const t = confirmationText({
    ...baseResult,
    confidence: 0.5,
    institution: "central",
    institution_name: "Central Desk",
    department: null,
  });
  assertStringIncludes(t, "Central Desk");
  assertStringIncludes(t, "GC-2026-00021");
});

Deno.test("confirmationText: names institution and department", () => {
  const t = confirmationText(baseResult);
  assertStringIncludes(t, "NAWEC");
  assertStringIncludes(t, "Water Distribution");
});

Deno.test("buildDeps: throws without META_PHONE_NUMBER_ID / META_WHATSAPP_TOKEN", () => {
  const savedId = Deno.env.get("META_PHONE_NUMBER_ID");
  const savedTok = Deno.env.get("META_WHATSAPP_TOKEN");
  try {
    Deno.env.delete("META_PHONE_NUMBER_ID");
    Deno.env.delete("META_WHATSAPP_TOKEN");
    let threw = false;
    try {
      buildDeps();
    } catch {
      threw = true;
    }
    assertEquals(threw, true);
  } finally {
    if (savedId !== undefined) Deno.env.set("META_PHONE_NUMBER_ID", savedId);
    if (savedTok !== undefined) Deno.env.set("META_WHATSAPP_TOKEN", savedTok);
  }
});

Deno.test("parseMetaEnvelope: rejects invalid JSON and non-objects", () => {
  assertEquals(parseMetaEnvelope(""), null);
  assertEquals(parseMetaEnvelope("not json"), null);
  assertEquals(parseMetaEnvelope("[1,2]"), null); // array is not an envelope
  assertEquals(parseMetaEnvelope('{"object":"whatsapp_business_account"}') !== null, true);
});

Deno.test("FetchMetaClient: POSTs to graph.facebook.com/v21.0/{phone_number_id}/messages with Bearer token", async () => {
  const calls: Array<{ url: string; headers: Record<string, string>; body: unknown }> = [];
  const fakeFetch = ((url: string | URL, init?: {
    headers?: Record<string, string>;
    body?: string;
  }) => {
    calls.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(init.body) : undefined,
    });
    return Promise.resolve(
      new Response(JSON.stringify({ messaging_product: "whatsapp", messages: [{ id: "wamid.X" }] }), {
        status: 200,
      }),
    );
  }) as unknown as typeof fetch;
  const client = new FetchMetaClient(
    { phoneNumberId: "PNID123", token: "EAAG..." },
    fakeFetch,
  );
  const out = await client.sendMessage("2207123456", "Received. Reference GC-2026-00021.");
  assertEquals(out.messageId, "wamid.X");

  const expectedUrl = `${GRAPH_API_BASE}/${GRAPH_API_VERSION}/PNID123/messages`;
  assertEquals(calls[0].url, expectedUrl);
  assertEquals(expectedUrl, "https://graph.facebook.com/v21.0/PNID123/messages");
  assertEquals(calls[0].headers.Authorization, "Bearer EAAG...");
  assertEquals(calls[0].body, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: "2207123456",
    type: "text",
    text: { body: "Received. Reference GC-2026-00021." },
  });
});

Deno.test("FetchMetaClient: truncates text to the 4096 character WhatsApp limit", async () => {
  const bodies: unknown[] = [];
  const fakeFetch = ((_url: string | URL, init?: { body?: string }) => {
    bodies.push(JSON.parse(init!.body as string));
    return Promise.resolve(
      new Response(JSON.stringify({ messages: [{ id: "w" }] }), { status: 200 }),
    );
  }) as unknown as typeof fetch;
  const client = new FetchMetaClient({ phoneNumberId: "PNID", token: "T" }, fakeFetch);
  await client.sendMessage("123", "x".repeat(5000));
  const body = bodies[0] as { text: { body: string } };
  assertEquals(body.text.body.length, 4096);
});

Deno.test("FetchMetaClient: HTTP error throws MetaError with status detail", async () => {
  const fakeFetch = (() =>
    Promise.resolve(new Response('{"error":{"message":"bad token"}}', { status: 401 }))) as unknown as typeof fetch;
  const client = new FetchMetaClient({ phoneNumberId: "PNID", token: "T" }, fakeFetch);
  let message = "";
  try {
    await client.sendMessage("123", "hi");
  } catch (e) {
    message = (e as Error).message;
  }
  assertEquals(message.includes("401"), true);
});
