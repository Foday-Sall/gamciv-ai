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

  /**
   * Transcribe a voice note. Primary path: OpenAI-compatible
   * POST {base_url}/audio/transcriptions (multipart field "file"). Some
   * OpenAI-compatible gateways (Cloudflare Workers AI's /ai/v1) do not
   * implement audio transcriptions — on 400/404 only, fall back to the
   * provider's native endpoint: Cloudflare
   * POST /client/v4/accounts/{account_id}/ai/run/@cf/openai/whisper with
   * multipart field "audio" (derived from AI_BASE_URL's /accounts/{id}/ai/v1).
   * Returns null on any failure; a failed transcription must never crash
   * the intake. Empty/whitespace transcripts count as failure.
   */
  async transcribe(audio: Uint8Array, filename: string): Promise<string | null> {
    try {
      return await this.transcribeOpenAiCompat(audio, filename);
    } catch (e) {
      if (!(e instanceof TranscribeHttpError) || ![400, 404].includes(e.status)) {
        console.error("transcription failed:", e);
        return null;
      }
      console.error(`transcription HTTP ${e.status}, falling back to native endpoint`);
    }
    try {
      return await this.transcribeNative(audio, filename);
    } catch (e) {
      console.error("native transcription failed:", e);
      return null;
    }
  }

  /** OpenAI-compatible path: POST {base}/audio/transcriptions, field "file". */
  private async transcribeOpenAiCompat(
    audio: Uint8Array,
    filename: string,
  ): Promise<string | null> {
    const url = `${this.config.baseUrl}/audio/transcriptions`;
    const model = Deno.env.get("AI_TRANSCRIBE_MODEL") ?? "whisper-1";
    const form = new FormData();
    form.append("file", new Blob([audio as BlobPart], { type: "audio/ogg" }), filename);
    form.append("model", model);
    form.append("response_format", "json");
    const payload = await this.postForm(url, form);
    return extractTranscriptText(payload);
  }

  /**
   * Native Cloudflare path: POST /client/v4/accounts/{id}/ai/run/@cf/openai/whisper,
   * multipart field "audio" (NOT "file"). Account id comes from AI_BASE_URL.
   * Response shape: { result: { text: string }, success: boolean }.
   */
  private async transcribeNative(audio: Uint8Array, filename: string): Promise<string | null> {
    const accountId = extractAccountId(this.config.baseUrl);
    if (!accountId) {
      throw new AiError("cannot derive Cloudflare account id from AI_BASE_URL for native whisper");
    }
    const url =
      `${this.config.baseUrl.replace(/\/accounts\/[^/]+\/ai\/v1$/, "")}/accounts/${accountId}/ai/run/@cf/openai/whisper`;
    const form = new FormData();
    form.append("audio", new Blob([audio as BlobPart], { type: "audio/ogg" }), filename);
    const payload = await this.postForm(url, form);
    if (payload && typeof payload === "object" && "result" in payload) {
      const result = payload.result as Record<string, unknown> | null;
      const text = typeof result?.text === "string" ? result.text : "";
      return text.trim() ? text.trim() : null;
    }
    // Some shapes may return top-level text
    return extractTranscriptText(payload);
  }

  /** Shared POST of a multipart form with bearer auth + timeout. */
  private async postForm(url: string, form: FormData): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 30000);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
        body: form,
        signal: controller.signal,
      });
    } catch (e) {
      throw new AiError(`transcription request failed: ${(e as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new TranscribeHttpError(
        res.status,
        `transcription HTTP ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`,
      );
    }
    try {
      return await res.json();
    } catch {
      throw new AiError("transcription returned invalid JSON");
    }
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

/** HTTP-level error carrying the status so the fallback gate can decide. */
class TranscribeHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Pull the transcript text out of top-level .text then .result.text. */
function extractTranscriptText(payload: unknown): string | null {
  let text = "";
  if (payload && typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    if (typeof p.text === "string") text = p.text;
    else if (
      p.result && typeof p.result === "object" &&
      typeof (p.result as Record<string, unknown>).text === "string"
    ) {
      text = (p.result as Record<string, unknown>).text as string;
    }
  }
  const trimmed = text.trim();
  return trimmed ? trimmed : null;
}

/** Cloudflare AI_BASE_URL looks like https://.../client/v4/accounts/<id>/ai/v1. */
export function extractAccountId(baseUrl: string): string | null {
  const m = baseUrl.match(/\/accounts\/([0-9a-fA-F]{32})\/ai\/v1\/?$/);
  return m ? m[1] : null;
}
