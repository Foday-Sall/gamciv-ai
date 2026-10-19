/**
 * channelBridge: thin Deno client for the Go channel service (channels/cmd/
 * gamciv-channels). POSTs outbound messages to the Go service's /send
 * endpoint; the Go service feeds them through the picoclaw MessageBus into
 * the real channel implementations (telegram, whatsapp).
 *
 * Contract (POST /send):
 *   request  {channel: string, to: string, content: string}
 *   202      {status: "queued"}                       accepted for delivery
 *   400/405  {status: "error", error: string}         client error
 *   502      {status: "error", error: string}         bus publish failure
 *
 * The bridge is optional: when CHANNELS_URL is unset, callers fall back to
 * the direct provider clients (GOWA / Telegram Bot API), so existing deploys
 * keep working unchanged.
 */

export interface ChannelSendResult {
  /** "queued" = accepted by the Go service; "fallback" = CHANNELS_URL unset. */
  status: "queued" | "fallback";
  /** Populated only on error responses. */
  error?: string;
}

/** Channel name accepted by the Go service ("telegram" | "whatsapp" | ...). */
export type ChannelName = "telegram" | "whatsapp";

/** Read the configured Go service base URL, or null when disabled. */
export function channelsUrl(env: { get(name: string): string | undefined }): string | null {
  const raw = (env.get("CHANNELS_URL") ?? "").trim().replace(/\/+$/, "");
  return raw || null;
}

export class ChannelsBridgeError extends Error {}

export class ChannelsBridge {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(
    baseUrl: string,
    fetchImpl: typeof fetch = fetch,
    timeoutMs = 10_000,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Send a text message through the Go service. Returns "queued" when the
   * service accepted the message for asynchronous delivery (rate limiting,
   * splitting and retries happen inside the Go manager). Throws
   * ChannelsBridgeError when the service is unreachable so callers can
   * decide whether to fall back to direct sends.
   */
  async send(channel: ChannelName, to: string, content: string): Promise<ChannelSendResult> {
    if (!channel || !to || !content) {
      throw new ChannelsBridgeError("channel, to and content are required");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, to, content }),
        signal: controller.signal,
      });
    } catch (e) {
      throw new ChannelsBridgeError(
        `channels service unreachable: ${(e as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }

    let body: { status?: string; error?: string } | null = null;
    try {
      body = (await res.json()) as { status?: string; error?: string };
    } catch {
      // non-JSON body handled below
    }
    if (!res.ok) {
      throw new ChannelsBridgeError(
        `channels /send HTTP ${res.status}${body?.error ? `: ${body.error}` : ""}`,
      );
    }
    if (body?.status !== "queued") {
      throw new ChannelsBridgeError(
        `channels /send unexpected status ${body?.status ?? "unknown"}`,
      );
    }
    return { status: "queued" };
  }
}

/**
 * Send via the Go channel service when configured; otherwise run the caller
 * supplied direct-send function. The direct path receives the same arguments
 * so both branches are interchangeable at the call site. Errors thrown by
 * the direct path propagate unchanged; Go service errors also propagate
 * (call sites already treat outbound send failures as non-fatal).
 */
export async function sendOrFallback(
  env: { get(name: string): string | undefined },
  channel: ChannelName,
  to: string,
  content: string,
  directSend: () => Promise<void>,
  fetchImpl: typeof fetch = fetch,
): Promise<ChannelSendResult> {
  const url = channelsUrl(env);
  if (!url) {
    await directSend();
    return { status: "fallback" };
  }
  await new ChannelsBridge(url, fetchImpl).send(channel, to, content);
  return { status: "queued" };
}
