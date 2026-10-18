/**
 * Meta WhatsApp Business Cloud API helpers: webhook signature verification,
 * payload normalization, and the Graph API send client.
 *
 * Spec (developers.facebook.com, WhatsApp > webhooks > create-webhook-endpoint):
 *  - GET  ?hub.mode=subscribe&hub.challenge=<CHALLENGE>&hub.verify_token=<TOKEN>
 *         -> if hub.verify_token matches, respond 200 with the hub.challenge
 *            value as the response body (plain text). Anything else is invalid.
 *  - POST carries `X-Hub-Signature-256: sha256=<HMAC_SHA256(raw_body, app_secret)>`.
 *         Verify by recomputing the HMAC over the exact raw bytes and comparing
 *         everything after the `sha256=` prefix, in constant time.
 *  - Incoming user messages arrive as entry[].changes[].value.messages[] with
 *    sender in value.contacts[] ({ profile: { name }, wa_id }); outgoing
 *    business messages arrive as value.statuses[] only (no content).
 */
import { timingSafeEqualStr } from "../_shared/http.ts";

/** Graph API base + version used for the send-confirmation path. */
export const GRAPH_API_BASE = "https://graph.facebook.com";
export const GRAPH_API_VERSION = "v21.0";

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

/**
 * Verify a Meta webhook signature: `X-Hub-Signature-256: sha256=<hex>` where
 * hex = HMAC-SHA256(raw body, app secret). Constant-time compare.
 */
export async function verifyMetaSignature(
  raw: Uint8Array,
  signatureHeader: string | null,
  appSecret: string,
): Promise<boolean> {
  if (!appSecret || !signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const received = signatureHeader.slice("sha256=".length).trim();
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
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

// ---------------------------------------------------------------------------
// Payload parsing / normalization
// ---------------------------------------------------------------------------

/** Parse a webhook body as JSON; returns null on invalid/empty input. */
export function parseMetaEnvelope(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    return data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function asStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function asNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** One normalized inbound message (the fields intake needs). */
export interface MetaMessage {
  /** Meta message id ("wamid...") — used directly as submit_complaint external_id. */
  messageId: string | null;
  /** Sender WhatsApp id (digits, international format). */
  waId: string | null;
  /** Sender WhatsApp profile name, if shared. */
  name: string | null;
  /** Text body, or the image caption for image messages. */
  body: string;
  /** Image media asset id (Cloud API media id). */
  mediaId: string | null;
  /** Temporary media URL included in the image webhook (requires the token to fetch). */
  mediaUrl: string | null;
  /** Location coordinates, when the message is a location pin. */
  lat: number | null;
  lng: number | null;
}

const CONTENT_TYPES = new Set(["text", "image", "location"]);

/**
 * Extract the intake-relevant messages from a Meta webhook envelope.
 * - Only `entry[].changes[].field === "messages"` changes are considered.
 * - `statuses`-only payloads (outgoing message delivery reports / echoes),
 *   error payloads, and content-less messages (stickers, reactions, system,
 *   unsupported) yield no messages -> caller responds "ignored".
 */
export function extractMessages(envelope: unknown): MetaMessage[] {
  const root = asObj(envelope);
  if (!root) return [];
  const entries = root.entry;
  if (!Array.isArray(entries)) return [];

  const out: MetaMessage[] = [];
  for (const entryRaw of entries) {
    const entry = asObj(entryRaw);
    if (!entry) continue;
    const changes = entry.changes;
    if (!Array.isArray(changes)) continue;
    for (const changeRaw of changes) {
      const change = asObj(changeRaw);
      if (!change || change.field !== "messages") continue;
      const value = asObj(change.value);
      if (!value) continue;
      const contacts = Array.isArray(value.contacts)
        ? value.contacts.map((c) => asObj(c)).filter(
            (c): c is Record<string, unknown> => c !== null,
          )
        : [];
      const messages = Array.isArray(value.messages) ? value.messages : [];
      for (const msgRaw of messages) {
        const msg = normalizeMessage(asObj(msgRaw), contacts);
        if (msg) out.push(msg);
      }
    }
  }
  return out;
}

function normalizeMessage(
  m: Record<string, unknown> | null,
  contacts: Array<Record<string, unknown>>,
): MetaMessage | null {
  if (!m) return null;
  const type = asStr(m.type);
  if (!CONTENT_TYPES.has(type)) return null; // system/reaction/sticker/unsupported/etc.

  const waId = asStr(m.from) || null;
  const contact = contacts.find((c) => asStr(c.wa_id) === waId) ?? contacts[0];
  const profile = contact ? asObj(contact.profile) : null;
  const name = profile ? asStr(profile.name) || null : null;

  let body = "";
  let mediaId: string | null = null;
  let mediaUrl: string | null = null;
  let lat: number | null = null;
  let lng: number | null = null;

  if (type === "text") {
    const text = asObj(m.text);
    body = text ? asStr(text.body).trim() : "";
  } else if (type === "image") {
    const image = asObj(m.image);
    if (!image) return null;
    mediaId = asStr(image.id) || null;
    mediaUrl = asStr(image.url) || null;
    body = asStr(image.caption).trim();
  } else {
    // location
    const loc = asObj(m.location);
    if (!loc) return null;
    lat = asNum(loc.latitude);
    lng = asNum(loc.longitude);
  }

  if (!body && !mediaId && lat === null) return null; // nothing intake-able

  return { messageId: asStr(m.id) || null, waId, name, body, mediaId, mediaUrl, lat, lng };
}

// ---------------------------------------------------------------------------
// Graph API send client (confirmation path)
// ---------------------------------------------------------------------------

export interface MetaSendConfig {
  /** Cloud API phone number id (META_PHONE_NUMBER_ID). */
  phoneNumberId: string;
  /** Bearer token (META_WHATSAPP_TOKEN). */
  token: string;
}

export interface MetaClient {
  sendMessage(to: string, text: string): Promise<{ messageId?: string }>;
}

export class MetaError extends Error {}

/** WhatsApp text message body limit. */
const MAX_TEXT = 4096;

export class FetchMetaClient implements MetaClient {
  private readonly config: MetaSendConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(config: MetaSendConfig, fetchImpl: typeof fetch = fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  /** Send a plain text message via POST /v21.0/{phone_number_id}/messages. */
  async sendMessage(to: string, text: string): Promise<{ messageId?: string }> {
    const url =
      `${GRAPH_API_BASE}/${GRAPH_API_VERSION}/${this.config.phoneNumberId}/messages`;
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.token}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { body: text.slice(0, MAX_TEXT) },
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new MetaError(
        `meta send HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      );
    }
    let body: { messages?: Array<{ id?: string }> } | null = null;
    try {
      body = (await res.json()) as { messages?: Array<{ id?: string }> };
    } catch {
      // non-JSON success body — treat as accepted
    }
    return { messageId: body?.messages?.[0]?.id };
  }
}
