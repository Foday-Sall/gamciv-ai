/**
 * SMS provider abstraction for notify-out.
 *
 * Two providers:
 * - "termii" — the original Termii REST client (termii.ts).
 * - "http_gateway" — a TextBee-style Android phone gateway: POST JSON with a
 *   recipients array to `${HTTP_GATEWAY_URL}/gateway/send-sms` with an
 *   `x-api-key` header (Bearer accepted as a fallback auth header).
 *
 * Selection is env-driven (SMS_PROVIDER) so tests can stub either client.
 * No business logic here — just one send call and a normalized result.
 */
import { FetchTermiiClient } from "./termii.ts";

export interface SmsSendResult {
  status: "success" | "error";
  /** Provider's message/batch reference, used as provider_ref in the DB. */
  message_id: string | null;
  error: string | null;
}

/** Interface so tests can stub SMS delivery. */
export interface SmsClient {
  sendSms(to: string, message: string): Promise<SmsSendResult>;
}

export type SmsProviderName = "termii" | "http_gateway";

/**
 * Resolve which SMS provider to use. "termii" only when TERMII_API_KEY is
 * set; "http_gateway" only when HTTP_GATEWAY_URL and HTTP_GATEWAY_API_KEY
 * are set. Explicit SMS_PROVIDER wins; otherwise http_gateway is preferred
 * when configured, falling back to termii for backwards compatibility.
 */
export function selectSmsProvider(
  env: { get(key: string): string | undefined },
): SmsProviderName | null {
  const explicit = env.get("SMS_PROVIDER")?.trim().toLowerCase();
  const termiiReady = Boolean(env.get("TERMII_API_KEY"));
  const gatewayReady = Boolean(env.get("HTTP_GATEWAY_URL") && env.get("HTTP_GATEWAY_API_KEY"));

  if (explicit === "termii") return termiiReady ? "termii" : null;
  if (explicit === "http_gateway") return gatewayReady ? "http_gateway" : null;

  if (explicit) {
    console.error(`unknown SMS_PROVIDER "${explicit}", falling back to auto-detection`);
  }

  if (gatewayReady) return "http_gateway";
  if (termiiReady) return "termii";
  return null;
}

function loadTermiiConfig(env: { get(key: string): string | undefined }) {
  const apiKey = env.get("TERMII_API_KEY");
  if (!apiKey) return null;
  return {
    apiKey,
    senderId: env.get("TERMII_SENDER_ID") ?? "GamCiv",
    endpoint: env.get("TERMII_ENDPOINT") ?? "https://api.ng.termii.com",
  };
}

interface HttpGatewayConfig {
  baseUrl: string;
  apiKey: string;
  /** "x-api-key" (default, TextBee) or "bearer". */
  authHeader: "x-api-key" | "bearer";
  /** Optional deviceId to pin a specific phone; null to use the default. */
  deviceId: string | null;
}

function loadHttpGatewayConfig(
  env: { get(key: string): string | undefined },
): HttpGatewayConfig | null {
  const baseUrl = env.get("HTTP_GATEWAY_URL")?.trim();
  const apiKey = env.get("HTTP_GATEWAY_API_KEY")?.trim();
  if (!baseUrl || !apiKey) return null;
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey,
    authHeader: env.get("HTTP_GATEWAY_AUTH_HEADER")?.trim().toLowerCase() === "bearer"
      ? "bearer"
      : "x-api-key",
    deviceId: env.get("HTTP_GATEWAY_DEVICE_ID")?.trim() || null,
  };
}

/** Build the configured SMS client, or null when nothing is configured. */
export function buildSmsClient(
  env: { get(key: string): string | undefined },
  fetchImpl: typeof fetch = fetch,
): SmsClient | null {
  const provider = selectSmsProvider(env);
  if (provider === "termii") {
    const config = loadTermiiConfig(env);
    if (config) return new FetchTermiiClient(config, fetchImpl);
  }
  if (provider === "http_gateway") {
    const config = loadHttpGatewayConfig(env);
    if (config) return new FetchHttpGatewayClient(config, fetchImpl);
  }
  return null;
}

/** TextBee-style Android gateway client — plain fetch, no SDK. */
export class FetchHttpGatewayClient implements SmsClient {
  private readonly config: HttpGatewayConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(config: HttpGatewayConfig, fetchImpl: typeof fetch = fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  async sendSms(to: string, message: string): Promise<SmsSendResult> {
    const url = `${this.config.baseUrl}/gateway/send-sms`;
    const payload: Record<string, unknown> = { recipients: [to], message };
    if (this.config.deviceId) payload.deviceId = this.config.deviceId;

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.config.authHeader === "bearer") {
      headers["Authorization"] = `Bearer ${this.config.apiKey}`;
    } else {
      headers["x-api-key"] = this.config.apiKey;
    }

    try {
      const res = await this.fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      const detail = await res.text().catch(() => "");
      if (!res.ok) {
        return {
          status: "error",
          message_id: null,
          error: `HTTP ${res.status}${detail ? ": " + detail.slice(0, 200) : ""}`,
        };
      }
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(detail) as Record<string, unknown>;
      } catch {
        return { status: "error", message_id: null, error: "non-JSON response from gateway" };
      }
      // TextBee shape: { data: { success, message, smsBatchId, recipientCount } }
      const data = (parsed.data ?? parsed) as Record<string, unknown>;
      const success = data.success === true;
      const batchId = typeof data.smsBatchId === "string" ? data.smsBatchId : null;
      const msg = typeof data.message === "string" ? data.message : null;
      if (success || batchId) {
        return { status: "success", message_id: batchId, error: null };
      }
      return { status: "error", message_id: null, error: msg ?? "gateway reported no success" };
    } catch (e) {
      return {
        status: "error",
        message_id: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }
}
