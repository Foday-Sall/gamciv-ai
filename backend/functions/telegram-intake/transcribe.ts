/**
 * Telegram voice-note transcription for the telegram-intake edge function. OpenAI-compatible POST {base_url}/audio/transcriptions with
 * a multipart form (file + model). Plain fetch, no SDK — same style as
 * aiClient.ts.
 *
 *   AI_BASE_URL            e.g. https://api.cloudflare.com/.../ai/v1
 *   AI_API_KEY             bearer token
 *   AI_TRANSCRIBE_MODEL    e.g. @cf/openai/whisper
 *
 * Note: _shared/aiClient.ts had no transcribe helper when this was written
 * (the WhatsApp agent may add one there later); the wire format is identical,
 * so consolidation is a straight copy if it lands.
 */
export interface TranscribeConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

export function loadTranscribeConfig(env: {
  get(key: string): string | undefined;
}): TranscribeConfig | null {
  const baseUrl = env.get("AI_BASE_URL");
  const apiKey = env.get("AI_API_KEY");
  const model = env.get("AI_TRANSCRIBE_MODEL");
  if (!baseUrl || !apiKey || !model) return null;
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey,
    model,
    timeoutMs: Number(env.get("AI_TIMEOUT_MS") ?? 30000),
  };
}

export class TranscribeError extends Error {}

export interface Transcriber {
  transcribe(audio: Uint8Array, filename: string): Promise<string | null>;
}

export class FetchTranscriber implements Transcriber {
  private readonly config: TranscribeConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(config: TranscribeConfig, fetchImpl: typeof fetch = fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  /**
   * Send OGG/Opus audio to the transcription endpoint; returns the transcript
   * text or null on any failure (a voice note that cannot be transcribed must
   * not crash the intake).
   */
  async transcribe(audio: Uint8Array, filename: string): Promise<string | null> {
    const url = `${this.config.baseUrl}/audio/transcriptions`;
    const form = new FormData();
    form.append("file", new Blob([audio as BlobPart], { type: "audio/ogg" }), filename);
    form.append("model", this.config.model);
    form.append("response_format", "json");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
        body: form,
        signal: controller.signal,
      });
    } catch (e) {
      throw new TranscribeError(`transcription request failed: ${(e as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new TranscribeError(
        `transcription HTTP ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`,
      );
    }
    let payload: { text?: unknown } | null = null;
    try {
      payload = (await res.json()) as { text?: unknown };
    } catch {
      // fall through to the error below
    }
    const text = typeof payload?.text === "string" ? payload.text.trim() : "";
    return text ? text : null;
  }
}
