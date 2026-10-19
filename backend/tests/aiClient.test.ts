/** Unit tests for the AI classification parser (tolerant JSON extraction). */
import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractJsonObject, parseClassification } from "../functions/_shared/aiClient.ts";

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
