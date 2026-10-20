/** Unit tests for the AI classification parser (tolerant JSON extraction). */
import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractJsonObject, FetchAiClient, parseClassification, extractAccountId } from "../functions/_shared/aiClient.ts";

Deno.test("parses strict JSON", () => {
  const r = parseClassification('{"category":"water_supply","urgency":"high","confidence":0.9}');
  assertEquals(r.category, "water_supply");
  assertEquals(r.urgency, "high");
  assertEquals(r.confidence, 0.9);
});

Deno.test("parses JSON fenced in a markdown block and normalizes legacy category", () => {
  const r = parseClassification(
    'Here you go:\n```json\n{"category":"waste","urgency":"low","confidence":0.7}\n```',
  );
  assertEquals(r.category, "waste_collection");
  assertEquals(r.urgency, "low");
});

Deno.test("parses JSON wrapped in prose", () => {
  const r = parseClassification(
    'Sure! The report is about water. {"category":"water_supply","urgency":"normal","confidence":0.55} hope that helps',
  );
  assertEquals(r.category, "water_supply");
  assertEquals(r.urgency, "normal");
  assertEquals(r.confidence, 0.55);
});

Deno.test("coerces invalid urgency to normal", () => {
  const r = parseClassification('{"category":"roads","urgency":"urgent!!","confidence":0.5}');
  assertEquals(r.urgency, "normal");
});

Deno.test("clamps confidence into [0,1] and defaults when missing", () => {
  const high = parseClassification('{"category":"other","urgency":"low","confidence":2}');
  assertEquals(high.confidence, 1);
  const none = parseClassification('{"category":"other","urgency":"low"}');
  assertEquals(none.confidence, 0.5);
});

Deno.test("accepts string confidence", () => {
  const r = parseClassification('{"category":"other","urgency":"low","confidence":"0.3"}');
  assertEquals(r.confidence, 0.3);
});

Deno.test("throws when no JSON at all", () => {
  assertThrows(() => parseClassification("no json here"), Error, "no JSON object");
});

Deno.test("throws when category missing", () => {
  assertThrows(() => parseClassification('{"urgency":"low","confidence":0.5}'), Error, "category");
});

// ---------------------------------------------------------------------------
// Category normalization regression tests (canonical slugs from db/0009_seed.sql)
// ---------------------------------------------------------------------------

Deno.test("maps every legacy alias to its canonical slug", () => {
  const aliases: Record<string, string> = {
    waste: "waste_collection",
    dumping: "illegal_dumping",
    local_road: "local_roads",
    national_road: "national_roads",
    health_facility: "public_health",
    crime_safety: "crime_report",
    fire_hazard: "emergency_fire",
    drainage: "local_roads",
    bridge: "national_roads",
    environment: "pollution",
    road_signs: "traffic_signs",
  };
  for (const [alias, expected] of Object.entries(aliases)) {
    const r = parseClassification(
      `{"category":"${alias}","urgency":"high","confidence":0.8}`,
    );
    assertEquals(r.category, expected, `alias ${alias} should map to ${expected}`);
    assertEquals(r.urgency, "high");
    assertEquals(r.confidence, 0.8);
  }
});

Deno.test("unknown category maps to other with confidence capped at 0.49", () => {
  const r = parseClassification('{"category":"land","urgency":"normal","confidence":0.95}');
  assertEquals(r.category, "other");
  assertEquals(r.confidence, 0.49);
});

Deno.test("unknown category with already-low confidence stays capped at 0.49", () => {
  const r = parseClassification('{"category":"business_permit","urgency":"low","confidence":0.2}');
  assertEquals(r.category, "other");
  assertEquals(r.confidence, 0.2);
});

Deno.test("valid canonical category is passed through unchanged", () => {
  const r = parseClassification(
    '{"category":"emergency_police","urgency":"critical","confidence":0.92}',
  );
  assertEquals(r.category, "emergency_police");
  assertEquals(r.urgency, "critical");
  assertEquals(r.confidence, 0.92);
});

Deno.test("invalid urgency still falls back to normal during normalization", () => {
  const r = parseClassification('{"category":"waste","urgency":"extreme","confidence":0.8}');
  assertEquals(r.category, "waste_collection");
  assertEquals(r.urgency, "normal");
});

Deno.test("extractJsonObject finds object after fenced text", () => {
  const obj = extractJsonObject('text {"a":1} more');
  assertEquals(obj, { a: 1 });
});

Deno.test("extractJsonObject handles nested braces", () => {
  const obj = extractJsonObject('prefix {"outer":{"inner":"}tricky"},"n":2} suffix');
  assert(obj !== null);
  assertEquals((obj as Record<string, unknown>).outer, { inner: "}tricky" });
});

Deno.test("extractJsonObject returns null when nothing parses", () => {
  assertEquals(extractJsonObject("plain text {broken"), null);
});

// ---------------------------------------------------------------------------
// transcribe(): OpenAI-compat first, native Cloudflare Whisper fallback
// ---------------------------------------------------------------------------

const TRANSCRIBE_CONFIG = {
  baseUrl: "https://api.cloudflare.com/client/v4/accounts/abc123def45678901234567890123456/ai/v1",
  apiKey: "test-key",
  model: "@cf/meta/llama-3.1-8b-instruct-fp8",
  timeoutMs: 5000,
};

const AUDIO = new Uint8Array([1, 2, 3]);

function jsonResponseFactory(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

Deno.test("transcribe: uses OpenAI-compat endpoint when it works", async () => {
  const calls: Array<{ url: string; field: string | null }> = [];
  const client = new FetchAiClient(TRANSCRIBE_CONFIG, ((url: string | URL, init?: RequestInit) => {
    const field = init?.body instanceof FormData
      ? ((init.body as FormData).get("file") ?? (init.body as FormData).get("audio"))
        ? "present"
        : null
      : null;
    calls.push({ url: String(url), field });
    return Promise.resolve(jsonResponseFactory({ text: "no water in Bakoteh" }));
  }) as typeof fetch);
  const text = await client.transcribe(AUDIO, "voice.ogg");
  assertEquals(text, "no water in Bakoteh");
  assertEquals(calls.length, 1);
  assertEquals(calls[0].url.endsWith("/audio/transcriptions"), true);
});

Deno.test("transcribe: falls back to native CF whisper on 404 from compat endpoint", async () => {
  const calls: Array<{ url: string; formField: string }> = [];
  const client = new FetchAiClient(TRANSCRIBE_CONFIG, ((url: string | URL, init?: RequestInit) => {
    const form = init?.body instanceof FormData ? (init.body as FormData) : new FormData();
    calls.push({ url: String(url), formField: form.has("file") ? "file" : "audio" });
    if (String(url).endsWith("/audio/transcriptions")) {
      return Promise.resolve(jsonResponseFactory({ error: "no route" }, 404));
    }
    return Promise.resolve(
      jsonResponseFactory({ result: { text: "  big pothole  " }, success: true }),
    );
  }) as typeof fetch);
  const text = await client.transcribe(AUDIO, "voice.ogg");
  assertEquals(text, "big pothole");
  assertEquals(calls.length, 2);
  assertEquals(calls[0].url.endsWith("/audio/transcriptions"), true);
  assertEquals(calls[1].url.includes("/ai/run/@cf/openai/whisper"), true);
  assertEquals(calls[1].formField, "audio");
});

Deno.test("transcribe: no fallback on non-400/404 errors", async () => {
  const calls: string[] = [];
  const client = new FetchAiClient(TRANSCRIBE_CONFIG, ((url: string | URL) => {
    calls.push(String(url));
    return Promise.resolve(jsonResponseFactory({ error: "server boom" }, 500));
  }) as typeof fetch);
  const text = await client.transcribe(AUDIO, "voice.ogg");
  assertEquals(text, null);
  assertEquals(calls.length, 1);
});

Deno.test("transcribe: empty transcript counts as failure", async () => {
  const client = new FetchAiClient(TRANSCRIBE_CONFIG, ((_url: string | URL) => {
    return Promise.resolve(jsonResponseFactory({ text: "   " }));
  }) as typeof fetch);
  assertEquals(await client.transcribe(AUDIO, "voice.ogg"), null);
});

Deno.test("extractAccountId parses the CF account id from AI_BASE_URL", () => {
  assertEquals(
    extractAccountId(
      "https://api.cloudflare.com/client/v4/accounts/abc123def45678901234567890123456/ai/v1",
    ),
    "abc123def45678901234567890123456",
  );
  assertEquals(extractAccountId("https://api.openai.com/v1"), null);
});
