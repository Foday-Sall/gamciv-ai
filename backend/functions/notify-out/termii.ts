/** Termii SMS client — plain fetch, no SDK. */
export interface TermiiConfig {
  apiKey: string;
  senderId: string;
  endpoint: string;
}

/** Recipient must be international format WITHOUT '+' (Termii requirement). */
export interface TermiiSendResult {
  status: "success" | "error";
  message_id: string | null;
  error: string | null;
}

/** Interface so tests can stub SMS delivery. */
export interface TermiiClient {
  sendSms(to: string, message: string): Promise<TermiiSendResult>;
}

export function loadTermiiConfig(
  env: { get(key: string): string | undefined },
): TermiiConfig | null {
  const apiKey = env.get("TERMII_API_KEY");
  if (!apiKey) return null;
  return {
    apiKey,
    senderId: env.get("TERMII_SENDER_ID") ?? "GamCiv",
    endpoint: env.get("TERMII_ENDPOINT") ?? "https://api.ng.termii.com",
  };
}

export class FetchTermiiClient implements TermiiClient {
  private readonly config: TermiiConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(config: TermiiConfig, fetchImpl: typeof fetch = fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  async sendSms(to: string, message: string): Promise<TermiiSendResult> {
    const url = `${this.config.endpoint.replace(/\/+$/, "")}/api/sms/send`;
    const payload = {
      to: to.startsWith("+") ? to.slice(1) : to,
      from: this.config.senderId,
      sms: message,
      type: "plain",
      channel: "generic",
      api_key: this.config.apiKey,
    };
    try {
      const res = await this.fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
        return { status: "error", message_id: null, error: "non-JSON response from Termii" };
      }
      const status = typeof parsed.status === "string" ? parsed.status : "";
      const messageId = typeof parsed.message_id === "string" ? parsed.message_id : null;
      const msg = typeof parsed.message === "string" ? parsed.message : null;
      if (status === "success") {
        return { status: "success", message_id: messageId, error: null };
      }
      return { status: "error", message_id: null, error: msg ?? `termii status ${status}` };
    } catch (e) {
      return {
        status: "error",
        message_id: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }
}
