/** Unit tests for the AI classification parser (tolerant JSON extraction). */
import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractJsonObject, parseClassification } from "../functions/_shared/aiClient.ts";

Deno.test("parses strict JSON", () => {
  const r = parseClassification('{"category":"water_supply","urgency":"high","confidence":0.9}');
  assertEquals(r.category, "water_supply");
  assertEquals(r.urgency, "high");
  assertEquals(r.confidence, 0.9);
});

Deno.test("parses JSON fenced in a markdown block", () => {
  const r = parseClassification(
    'Here you go:\n```json\n{"category":"waste","urgency":"low","confidence":0.7}\n```',
  );
  assertEquals(r.category, "waste");
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
