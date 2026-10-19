/**
 * Telegram Bot API client + webhook update parser for the telegram-intake
 * edge function. Plain fetch, no SDK — same style as gowaClient.ts.
 *
 * Bot API surface used (all POSTs unless noted):
 *   sendMessage:    /bot<token>/sendMessage           {chat_id, text}
 *   getFile:        /bot<token>/getFile               {file_id}
 *   file download:  /file/bot<token>/<file_path>      (GET; URL valid ~1h)
 */

export class TelegramError extends Error {}

/** Bucket that stores intake photos (created by the DB/storage track). */
export const PHOTO_BUCKET = "complaint-photos";
/** Object prefix for Telegram-origin photos inside PHOTO_BUCKET. */
export const PHOTO_PREFIX = "telegram";

/** Minimal surface the intake pipeline needs; stubbed in tests. */
export interface TelegramClient {
  sendMessage(chatId: string, text: string): Promise<{ messageId?: number }>;
  /**
   * Resolve a photo file_id to a downloadable URL (null if unresolvable).
   * The URL embeds the bot token and is valid ~1h — it must never be stored;
   * consume it immediately (see storePhotoFromUrl in photoStorage.ts).
   */
  getPhotoUrl(fileId: string): Promise<string | null>;
}

export interface TelegramClientConfig {
  botToken: string;
  apiBase?: string;
  timeoutMs?: number;
}

interface TelegramApiResponse {
  ok: boolean;
  description?: string;
  result?: {
    message_id?: number;
    file_path?: string;
  };
}

export class FetchTelegramClient implements TelegramClient {
  private readonly botToken: string;
  private readonly apiBase: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: TelegramClientConfig, fetchImpl: typeof fetch = fetch) {
    this.botToken = config.botToken;
    this.apiBase = (config.apiBase ?? "https://api.telegram.org").replace(/\/+$/, "");
    this.timeoutMs = config.timeoutMs ?? 15000;
    this.fetchImpl = fetchImpl;
  }

  async sendMessage(chatId: string, text: string): Promise<{ messageId?: number }> {
    // Trim below the 4096-char Bot API limit instead of failing the send.
    const body = await this.callApi("sendMessage", { chat_id: chatId, text: text.slice(0, 4000) });
    const messageId = typeof body.result?.message_id === "number"
      ? body.result.message_id
      : undefined;
    return { messageId };
  }

  async getPhotoUrl(fileId: string): Promise<string | null> {
    try {
      const body = await this.callApi("getFile", { file_id: fileId });
      const filePath = body.result?.file_path;
      if (typeof filePath !== "string" || !filePath) return null;
      // This URL embeds the bot token (Telegram has no tokenless file links)
      // and expires after ~1h; see README "Photo URL caveat".
      return `${this.apiBase}/file/bot${this.botToken}/${filePath}`;
    } catch (e) {
      // getFile failures resolve to null so the report is still filed,
      // text-only, rather than dropped.
      console.error("telegram getFile failed:", e);
      return null;
    }
  }

  private endpoint(method: string): string {
    return `${this.apiBase}/bot${this.botToken}/${method}`;
  }

  private async callApi(
    method: string,
    payload: Record<string, unknown>,
  ): Promise<TelegramApiResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(this.endpoint(method), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (e) {
      throw new TelegramError(`telegram ${method} request failed: ${(e as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
    let body: TelegramApiResponse | null = null;
    try {
      body = (await res.json()) as TelegramApiResponse;
    } catch {
      // fall through to the error below
    }
    if (!res.ok || !body?.ok) {
      const desc = body?.description ?? "";
      throw new TelegramError(`telegram ${method} HTTP ${res.status}${desc ? `: ${desc}` : ""}`);
    }
    return body;
  }
}

// ---------------------------------------------------------------------------
// Webhook update parsing / normalization
// ---------------------------------------------------------------------------

/** Telegram photo size entry (subset). */
export interface TelegramPhotoSize {
  file_id: string;
  width?: number;
  height?: number;
}

/** Inbound Telegram message (subset of fields we consume). */
export interface TelegramMessage {
  message_id: number;
  from?: {
    id: number;
    first_name?: string;
    last_name?: string;
    username?: string;
  };
  chat: { id: number; type?: string };
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  location?: { latitude: number; longitude: number };
}

/** Telegram webhook update (subset). */
export interface TelegramUpdate {
  update_id?: number;
  message?: TelegramMessage;
}

/** Normalized report extracted from an update — input to the intake pipeline. */
export interface TelegramReport {
  /** "tg:<chat_id>:<message_id>" — the submit_complaint idempotency key. */
  externalId: string;
  /** Chat id as string (reply target for sendMessage). */
  chatId: string;
  messageId: number;
  /** "First Last (@username)" or null when Telegram shares no identity. */
  name: string | null;
  /** Text body, photo caption, or a synthetic description for media-only. */
  body: string;
  /** Largest photo size's file_id (resolve via getPhotoUrl). */
  photoFileId: string | null;
  lat: number | null;
  lng: number | null;
}

const PHOTO_ONLY_BODY = "Photo report sent via Telegram (no caption)";
const LOCATION_ONLY_BODY = "Location pin sent via Telegram (no text)";

/** Parse a webhook body as a Telegram update; null on invalid JSON. */
export function parseUpdate(raw: string): TelegramUpdate | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  return data as TelegramUpdate;
}

/**
 * Pull the intake-relevant fields out of a Telegram update. Returns null when
 * the update is not a usable citizen report: edited_message/channel_post
 * events, group or channel chats, and content types we cannot file
 * (stickers, voice, ...). Location messages are supported natively —
 * Telegram shares latitude/longitude directly.
 */
export function extractReport(update: TelegramUpdate): TelegramReport | null {
  // Only fresh `message` events are intake; edited_message would double-file.
  const msg = update.message;
  if (!msg || typeof msg.message_id !== "number") return null;

  // Groups/channels are not citizen intake (same policy as whatsapp-intake).
  const chatType = typeof msg.chat?.type === "string" ? msg.chat.type : "private";
  if (chatType !== "private") return null;

  const chatId = msg.chat?.id === undefined ? null : String(msg.chat.id);
  if (!chatId) return null;

  // Body: text, or the caption on a photo message.
  let body = typeof msg.text === "string" ? msg.text.trim() : "";
  if (!body && typeof msg.caption === "string") body = msg.caption.trim();

  const photo = largestPhoto(msg.photo);
  const hasCoords = typeof msg.location?.latitude === "number" &&
    typeof msg.location?.longitude === "number";

  // Nothing to intake: no text, no photo, no location.
  if (!body && !photo && !hasCoords) return null;

  // Media-only reports are accepted with a generated description; the SQL
  // side derives title/description defaults (see docs/sql-contract.md).
  if (!body) body = photo ? PHOTO_ONLY_BODY : LOCATION_ONLY_BODY;

  const from = (msg.from ?? {}) as TelegramMessage["from"] & Record<string, unknown>;
  const nameParts = [from.first_name, from.last_name].filter((p) =>
    typeof p === "string" && p.length > 0
  );
  let name: string | null = nameParts.length ? nameParts.join(" ") : null;
  if (typeof from.username === "string" && from.username) {
    name = name ? `${name} (@${from.username})` : `@${from.username}`;
  }

  return {
    externalId: `tg:${chatId}:${msg.message_id}`,
    chatId,
    messageId: msg.message_id,
    name,
    body,
    photoFileId: photo?.file_id ?? null,
    lat: hasCoords ? msg.location!.latitude : null,
    lng: hasCoords ? msg.location!.longitude : null,
  };
}

/** Telegram sorts photo sizes by area ascending; pick the largest defensively. */
function largestPhoto(photo: TelegramPhotoSize[] | undefined): TelegramPhotoSize | null {
  if (!photo?.length) return null;
  return photo.reduce((best, cur) => {
    const bestArea = (best.width ?? 0) * (best.height ?? 0);
    const curArea = (cur.width ?? 0) * (cur.height ?? 0);
    return curArea > bestArea ? cur : best;
  });
}
