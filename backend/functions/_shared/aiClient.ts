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

const SYSTEM_PROMPT =
  `You classify citizen reports about public problems in The Gambia (water, electricity, roads, waste, markets, safety, environment).
Answer ONLY with a JSON object, no other text, with exactly these keys:
{"category": "<slug from the list>", "urgency": "<critical|high|normal|low>", "confidence": <0.0-1.0>}
Categories: water_supply, electricity, sewerage, waste, dumping, markets, local_road, streetlight, drainage, national_road, bridge, pollution, environment, health_facility, education, housing, land, business_permit, transport, crime_safety, fire_hazard, other.
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
  return { category, urgency, confidence };
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
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: description.slice(0, 2000) },
          ],
          temperature: 0.2,
          max_tokens: 200,
          response_format: { type: "json_object" },
        }),
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
    return parseClassification(content);
  }
}
