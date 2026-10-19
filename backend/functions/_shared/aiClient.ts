/**
 * AI classifier client — OpenAI-compatible chat completions over plain fetch.
 *
 * Wire format only: POST {base_url}/chat/completions with a messages array and
 * JSON output requested via response_format. No provider SDK is imported, so any
 * OpenAI-compatible endpoint works by swapping env vars:
 *
 *   AI_BASE_URL  e.g. https://api.cloudflare.com/.../ai/v1
 *   AI_API_KEY   bearer token
 *   AI_MODEL     e.g. @cf/meta/llama-3.1-8b-instruct-fast
 *
 * The parser tolerates strict JSON, fenced ```json blocks, and JSON wrapped in prose.
 */
import type { ComplaintUrgency } from "./types.ts";

export interface Classification {
  category: string;
  urgency: ComplaintUrgency;
  confidence: number;
}

export interface AiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
}

export interface AiClient {
  classify(description: string): Promise<Classification>;
}

export class AiError extends Error {}

const VALID_URGENCIES: ComplaintUrgency[] = ["critical", "high", "normal", "low"];

/** Exact category slugs from db/0009_seed.sql — the canonical set. */
const VALID_CATEGORIES: Set<string> = new Set([
  "waste_collection",
  "illegal_dumping",
  "water_supply",
  "electricity",
  "sewerage",
  "local_roads",
  "streetlight",
  "markets",
  "national_roads",
  "traffic_signs",
  "pollution",
  "public_health",
  "education",
  "crime_report",
  "police_misconduct",
  "corruption_report",
  "abuse_of_power",
  "emergency_fire",
  "emergency_police",
  "other",
]);

/**
 * Legacy/colloquial category names the model may still emit (older prompt
 * versions, free-form guesses) mapped onto the canonical database slugs.
 * Anything not in VALID_CATEGORIES and not aliased falls through to "other".
 */
const CATEGORY_ALIASES: Record<string, string> = {
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

const SYSTEM_PROMPT =
  `You classify citizen reports about public problems in The Gambia (water, electricity, roads, waste, markets, safety, environment).
Answer ONLY with a JSON object, no other text, with exactly these keys:
{"category": "<slug from the list>", "urgency": "<critical|high|normal|low>", "confidence": <0.0-1.0>}
Categories: waste_collection, illegal_dumping, water_supply, electricity, sewerage, local_roads, streetlight, markets, national_roads, traffic_signs, pollution, public_health, education, crime_report, police_misconduct, corruption_report, abuse_of_power, emergency_fire, emergency_police, other.
Urgency: critical = immediate danger to life/property (fire, flooding, live wire, gunshots, injury), high = service fully down or unsafe, normal = degraded service, low = cosmetic.
confidence = how sure you are that the category is right (0.0-1.0).`;

export function loadAiConfig(env: {
  get(key: string): string | undefined;
}): AiConfig {
  const baseUrl = env.get("AI_BASE_URL");
  const apiKey = env.get("AI_API_KEY");
  const model = env.get("AI_MODEL");
  if (!baseUrl || !apiKey || !model) {
    throw new AiError("AI_BASE_URL, AI_API_KEY and AI_MODEL must be set");
  }
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey,
    model,
    timeoutMs: Number(env.get("AI_TIMEOUT_MS") ?? 15000),
  };
}

/**
 * Extract the first JSON object from a string.
 * Handles strict JSON, fenced ```json blocks, and prose-wrapped objects.
 */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    // fall through to extraction
  }
  // Prefer fenced ```json blocks
  const fenced = /```(?:json)?\s*([\s\S]*?)```/g;
  for (const match of text.matchAll(fenced)) {
    const candidate = match[1]?.trim();
    if (!candidate) continue;
    try {
      return JSON.parse(candidate) as Record<string, unknown>;
    } catch {
      // keep scanning
    }
  }
  // Brace-balance scan: for each '{' start, find its matching '}' and try to parse.
  let start = text.indexOf("{");
  while (start !== -1) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          const candidate = text.slice(start, i + 1);
          try {
            return JSON.parse(candidate) as Record<string, unknown>;
          } catch {
            break; // invalid at this start; try the next '{'
          }
        }
      }
    }
    start = text.indexOf("{", start + 1);
  }
  return null;
}

/** Parse + validate the model output; throws AiError on unusable output. */
export function parseClassification(raw: string): Classification {
  const obj = extractJsonObject(raw);
  if (!obj) {
    throw new AiError("classifier returned no JSON object");
  }
  const category = typeof obj.category === "string" ? obj.category.trim().toLowerCase() : "";
  if (!category) {
    throw new AiError('classifier output missing "category"');
  }
  const urgencyRaw = typeof obj.urgency === "string" ? obj.urgency.trim().toLowerCase() : "";
  const urgency = (VALID_URGENCIES as string[]).includes(urgencyRaw)
    ? (urgencyRaw as ComplaintUrgency)
    : "normal";
  const confidenceRaw = obj.confidence;
  let confidence: number;
  if (typeof confidenceRaw === "number" && Number.isFinite(confidenceRaw)) {
    confidence = confidenceRaw;
  } else if (typeof confidenceRaw === "string" && confidenceRaw.trim() !== "") {
    confidence = Number(confidenceRaw);
  } else {
    confidence = 0.5;
  }
  if (!Number.isFinite(confidence)) confidence = 0.5;
  confidence = Math.min(1, Math.max(0, confidence));

  // Normalize legacy/colloquial category names to canonical database slugs.
  const normalized = CATEGORY_ALIASES[category] ?? category;
  if (VALID_CATEGORIES.has(normalized)) {
    return { category: normalized, urgency, confidence };
  }
  // Unknown category: map to "other" and cap confidence below the 0.70 routing
  // gate so SQL routing sends it to Central Desk instead of erroring on a slug
  // that does not exist in the database.
  return { category: "other", urgency, confidence: Math.min(confidence, 0.49) };
}

const CHAT_URL_SUFFIX = "/chat/completions";

export class FetchAiClient implements AiClient {
  private readonly config: AiConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(config: AiConfig, fetchImpl: typeof fetch = fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  /** Classify a report description via an OpenAI-compatible chat completion. */
  async classify(description: string): Promise<Classification> {
    const url = this.config.baseUrl + CHAT_URL_SUFFIX;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 15000);
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.config.apiKey}`,
    };
    const body = JSON.stringify({
      model: this.config.model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: description.slice(0, 2000) },
      ],
      temperature: 0.2,
      max_tokens: 200,
      response_format: { type: "json_object" },
    });
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });
    } catch (e) {
      throw new AiError(`classifier request failed: ${(e as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new AiError(
        `classifier HTTP ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`,
      );
    }
    let payload: { choices?: Array<{ message?: { content?: string } }> };
    try {
      payload = (await res.json()) as typeof payload;
    } catch (e) {
      throw new AiError(`classifier returned invalid JSON: ${(e as Error).message}`);
    }
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content === "") {
      throw new AiError("classifier response has no message content");
    }
    // Retry once with a strict JSON-only reminder when the model wanders into prose.
    try {
      return parseClassification(content);
    } catch (firstError) {
      const retryMessages = [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: description.slice(0, 2000) },
        { role: "assistant", content },
        {
          role: "user",
          content: "Your previous answer was not valid JSON. Reply with ONLY the JSON object, nothing else.",
        },
      ];
      const retryRes = await this.fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: this.config.model,
          messages: retryMessages,
          temperature: 0,
          max_tokens: 200,
          response_format: { type: "json_object" },
        }),
      });
      if (!retryRes.ok) throw firstError;
      const retryPayload = (await retryRes.json()) as typeof payload;
      const retryContent = retryPayload?.choices?.[0]?.message?.content;
      if (typeof retryContent !== "string" || retryContent === "") throw firstError;
      return parseClassification(retryContent);
    }
  }
}
