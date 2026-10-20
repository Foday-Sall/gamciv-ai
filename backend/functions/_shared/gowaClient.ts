/**
 * GOWA client: read the inbound webhook (with HMAC verification) and send
 * messages via the GOWA REST API (go-whatsapp-web-multidevice v9.6, plain fetch).
 */
import { timingSafeEqualStr } from "./http.ts";
import type { GowaEnvelope, GowaMessagePayload } from "./types.ts";

export interface GowaSendConfig {
  baseUrl: string; // e.g. http://gowa:3000 (container) or http://172.x.x.x:3000
  basicAuth: string; // "user:pass"
  deviceId?: string; // required when >1 device is linked
}

export interface GowaClient {
  sendMessage(phone: string, message: string): Promise<{ messageId?: string; status?: string }>;
}

export class GowaError extends Error {}

export class FetchGowaClient implements GowaClient {
  private readonly config: GowaSendConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(config: GowaSendConfig, fetchImpl: typeof fetch = fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  async sendMessage(
    phone: string,
    message: string,
  ): Promise<{ messageId?: string; status?: string }> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Basic ${btoa(this.config.basicAuth)}`,
    };
    if (this.config.deviceId) {
      headers["X-Device-Id"] = this.config.deviceId;
    }
    const res = await this.fetchImpl(
      `${this.config.baseUrl.replace(/\/+$/, "")}/send/message`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ phone, message }),
      },
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new GowaError(
        `gowa send HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      );
    }
    let body: {
      message_id?: string;
      messageId?: string;
      status?: string;
      results?: Array<{ message_id?: string }>;
    } | null = null;
    try {
      body = (await res.json()) as {
        message_id?: string;
        messageId?: string;
        status?: string;
        results?: Array<{ message_id?: string }>;
      };
    } catch {
      // non-JSON success body — treat as accepted
    }
    return {
      messageId: body?.message_id ?? body?.results?.[0]?.message_id,
      status: body?.status,
    };
  }
}

/**
 * Verify the GOWA webhook HMAC (X-Hub-Signature-256 / x-webhook-signature,
 * "sha256={hex}" over the exact raw request bytes) in constant time.
 */
export async function verifyGowaSignature(
  raw: Uint8Array,
  signatureHeader: string | null,
  secret: string,
): Promise<boolean> {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const received = signatureHeader.slice("sha256=".length).trim();
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, raw as unknown as ArrayBuffer);
  const expected = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return timingSafeEqualStr(expected, received);
}

/** Parse + minimally validate a GOWA webhook envelope. */
export function parseGowaEnvelope(raw: string): GowaEnvelope | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const env = data as GowaEnvelope;
  if (typeof env.event !== "string" || !env.event) return null;
  return env;
}

export interface ExtractedMessage {
  messageId: string | null;
  phone: string | null;
  name: string | null;
  body: string;
  imageUrl: string | null;
  /** Voice/audio note media reference (relative GOWA path or absolute URL). */
  audioUrl: string | null;
  lat: number | null;
  lng: number | null;
  isGroup: boolean;
  isFromMe: boolean;
}

/**
 * Pull the intake-relevant fields out of a v9.6 message payload.
 * Returns null when the event is not a usable citizen report (non-message
 * events, own outgoing messages, empty bodies, or messages with no text,
 * image, location AND audio).
 */
export function extractMessage(
  envelope: GowaEnvelope,
): ExtractedMessage | null {
  if (envelope.event !== "message") return null;
  const p = (envelope.payload ?? {}) as GowaMessagePayload;

  const isFromMe = p.is_from_me === true;
  if (isFromMe) return null;

  const chatId = typeof p.chat_id === "string" ? p.chat_id : null;
  const from = typeof p.from === "string" ? p.from : null;
  const isGroup = (chatId ?? from ?? "").includes("@g.us");
  if (isGroup) return null; // groups are not citizen intake

  const phone = from ? normalizePhone(from) : null;

  // Body: text body, or caption on an image message.
  let body = typeof p.body === "string" ? p.body.trim() : "";
  if (!body && p.image && typeof p.image === "object" && typeof p.image.caption === "string") {
    body = p.image.caption.trim();
  }

  // Media reference for an image message: v9.6 sends a relative path string
  // with auto-download, or an object with url/path.
  let imageUrl: string | null = null;
  if (p.image) {
    if (typeof p.image === "string") {
      imageUrl = p.image;
    } else if (typeof p.image === "object") {
      imageUrl = p.image.url ?? p.image.path ?? null;
    }
  }

  // Voice/audio note (voice = PTT; both land in the audio field). Same shape
  // as image: relative path string with auto-download, or object with url/path.
  let audioUrl: string | null = null;
  if (p.audio) {
    if (typeof p.audio === "string") {
      audioUrl = p.audio;
    } else if (typeof p.audio === "object") {
      audioUrl = p.audio.url ?? p.audio.path ?? null;
    }
  }

  const lat = p.location?.degreesLatitude ?? null;
  const lng = p.location?.degreesLongitude ?? null;

  if (!body && !imageUrl && !audioUrl && lat == null && lng == null) {
    return null; // nothing to intake
  }

  const name = (typeof p.sender_display_name === "string" && p.sender_display_name) ||
    (typeof p.from_name === "string" && p.from_name) ||
    null;

  return {
    messageId: typeof p.id === "string" ? p.id : null,
    phone,
    name,
    body,
    imageUrl,
    audioUrl,
    lat: typeof lat === "number" ? lat : null,
    lng: typeof lng === "number" ? lng : null,
    isGroup,
    isFromMe,
  };
}

/** Strip a WhatsApp JID down to bare digits (international format). */
export function normalizePhone(jid: string): string | null {
  const m = jid.match(/^(\d+)(?:@|$)/);
  return m ? m[1] : null;
}
