/**
 * GamCiv AI — gowa-bridge: GOWA webhook ⇄ PicoClaw WhatsApp bridge.
 *
 * PicoClaw's `whatsapp` channel (pkg/channels/whatsapp/whatsapp.go) is a
 * WebSocket CLIENT that dials WhatsAppSettings.bridge_url (default
 * ws://localhost:3001) at gateway boot:
 *
 *   inbound  (bridge → PicoClaw):
 *     {"type":"message","from":"<jid>","chat":"<jid>","content":"<text>",
 *      "media":["/path",...],"id":"<msg id>","from_name":"<display>"}
 *     Only type "message" is handled; no ping/pong/ack exists.
 *   outbound (PicoClaw → bridge):
 *     {"type":"message","to":"<chat jid>","content":"<text>"}
 *     Text only; forwarded to GOWA POST /send/message (basic auth).
 *
 * PicoClaw never re-dials after a disconnect, so this bridge must be running
 * BEFORE the gateway starts and stay up (deploy-messaging.sh installs it as
 * a systemd service with automatic restart; a gateway restart or
 * POST /reload re-establishes the socket).
 *
 * GOWA side: the gowa container POSTs its webhook (HMAC-signed) to this
 * service's /gowa endpoint. The webhook is configured PER-DEVICE
 * (PATCH /devices/main/webhook) so the existing signed webhook to
 * whatsapp-intake (global WHATSAPP_WEBHOOK env) keeps firing unchanged —
 * intake and bridge run in parallel.
 *
 * Message flow (in):   GOWA webhook → verify HMAC → parse JIDs →
 *                      picoclaw frame → send on the live socket.
 * Message flow (out):  picoclaw frame → POST http://gowa:3000/send/message.
 *
 * Chat ids pass through verbatim in both directions (JIDs like
 * 1234567890@s.whatsapp.net or ...@g.us).
 */

// ---------------------------------------------------------------------------
// Configuration (env)
// ---------------------------------------------------------------------------

interface Config {
  port: number;
  /** Shared HMAC secret, same value as the gowa webhook secret. */
  webhookSecret: string;
  /** GOWA base URL reachable from this host (container: http://gowa:3000). */
  gowaBaseUrl: string;
  /** GOWA basic auth "user:pass". */
  gowaAuth: string;
  /** Optional device id when more than one device is linked. */
  gowaDeviceId: string | null;
}

function loadConfig(): Config {
  const port = Number(Deno.env.get("GOWA_BRIDGE_PORT") ?? "3001");
  const webhookSecret = Deno.env.get("GOWA_WEBHOOK_SECRET") ?? "";
  const gowaBaseUrl = Deno.env.get("GOWA_BASE_URL") ?? "http://gowa:3000";
  const gowaAuth = Deno.env.get("GOWA_BASIC_AUTH") ?? "";
  if (!webhookSecret) throw new Error("GOWA_WEBHOOK_SECRET must be set");
  if (!gowaAuth) throw new Error("GOWA_BASIC_AUTH must be set");
  return {
    port,
    webhookSecret,
    gowaBaseUrl: gowaBaseUrl.replace(/\/+$/, ""),
    gowaAuth,
    gowaDeviceId: Deno.env.get("GOWA_DEVICE_ID") || null,
  };
}

// ---------------------------------------------------------------------------
// Types (GOWA v9.6 webhook + picoclaw frames)
// ---------------------------------------------------------------------------

export interface GowaEnvelope {
  event: string;
  device_id?: string;
  payload?: {
    id?: string;
    chat_id?: string;
    from?: string;
    sender_display_name?: string;
    from_name?: string;
    is_from_me?: boolean;
    body?: string;
    image?: string | { url?: string; path?: string; caption?: string };
  };
}

/** Frame picoclaw's whatsapp channel understands (whatsapp.go:22-31). */
interface PicoclawInboundFrame {
  type: "message";
  from: string;
  chat: string;
  content: string;
  media: string[];
  id: string;
  from_name: string;
}

/** Frame picoclaw sends back (whatsapp.go:130-134). */
interface PicoclawOutboundFrame {
  type: "message";
  to: string;
  content: string;
}

// ---------------------------------------------------------------------------
// GOWA → picoclaw frame conversion (pure, unit-tested)
// ---------------------------------------------------------------------------

/**
 * Convert a GOWA webhook envelope into a picoclaw inbound frame.
 * Returns null when the event is not a usable chat message (non-message
 * events, own outgoing messages, empty text without image caption).
 */
export function gowaToPicoclaw(env: GowaEnvelope): PicoclawInboundFrame | null {
  if (env.event !== "message") return null;
  const p = env.payload ?? {};
  if (p.is_from_me === true) return null;

  const from = typeof p.from === "string" ? p.from : null;
  if (!from) return null;

  // chat_id: JID of the chat (same as from for direct messages; group JIDs
  // for groups). GOWA always provides it for message events.
  const chat = typeof p.chat_id === "string" && p.chat_id ? p.chat_id : from;

  // Text body, or the caption of an image message.
  let content = typeof p.body === "string" ? p.body.trim() : "";
  if (!content && p.image && typeof p.image === "object" && typeof p.image.caption === "string") {
    content = p.image.caption.trim();
  }

  const name = (typeof p.sender_display_name === "string" && p.sender_display_name) ||
    (typeof p.from_name === "string" && p.from_name) ||
    "";

  return {
    type: "message",
    from,
    chat,
    content,
    // GOWA stores downloaded media under /app/storages inside the gowa
    // container — a path picoclaw's container cannot read, so we never
    // forward file paths. Media pathing is handled by whatsapp-intake.
    media: [],
    id: typeof p.id === "string" ? p.id : "",
    from_name: name,
  };
}

/** Convert a picoclaw outbound frame into (phone, message) for GOWA. */
export function picoclawToGowa(frame: PicoclawOutboundFrame): { phone: string; message: string } | null {
  if (!frame || typeof frame !== "object" || frame.type !== "message") return null;
  const to = typeof frame.to === "string" ? frame.to.trim() : "";
  const content = typeof frame.content === "string" ? frame.content : "";
  if (!to || !content) return null;
  // Pass JIDs through verbatim (GOWA accepts user and group JIDs).
  return { phone: to, message: content };
}

// ---------------------------------------------------------------------------
// HMAC verification (same scheme as whatsapp-intake: sha256=<hex> over raw bytes)
// ---------------------------------------------------------------------------

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
  if (expected.length !== received.length) return false;
  // Constant-time compare.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ received.charCodeAt(i);
  }
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Bridge server state
// ---------------------------------------------------------------------------

/** Currently connected picoclaw socket (null until the gateway dials in). */
let picoclawSocket: WebSocket | null = null;
let picoclawConnectedAt: number | null = null;

function sendToPicoclaw(frame: PicoclawInboundFrame): boolean {
  if (picoclawSocket && picoclawSocket.readyState === WebSocket.OPEN) {
    try {
      picoclawSocket.send(JSON.stringify(frame));
      return true;
    } catch (e) {
      console.error("send to picoclaw failed:", e);
    }
  }
  console.error("picoclaw not connected — dropping message", frame.id);
  return false;
}

/** Forward picoclaw's outbound frame to GOWA. */
async function forwardToGowa(
  cfg: Config,
  frame: PicoclawOutboundFrame,
): Promise<void> {
  const gowa = picoclawToGowa(frame);
  if (!gowa) {
    console.error("ignoring malformed outbound frame");
    return;
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Authorization": `Basic ${btoa(cfg.gowaAuth)}`,
  };
  if (cfg.gowaDeviceId) headers["X-Device-Id"] = cfg.gowaDeviceId;
  try {
    const res = await fetch(`${cfg.gowaBaseUrl}/send/message`, {
      method: "POST",
      headers,
      body: JSON.stringify({ phone: gowa.phone, message: gowa.message }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`gowa send HTTP ${res.status}: ${detail.slice(0, 200)}`);
    }
  } catch (e) {
    console.error("gowa send failed:", e);
  }
}

// ---------------------------------------------------------------------------
// HTTP + WebSocket server (started only when run directly, not when imported
// by tests for the pure conversion/HMAC functions)
// ---------------------------------------------------------------------------

let cfg: Config;
try {
  cfg = loadConfig();
} catch (e) {
  if (import.meta.main) throw e;
  cfg = {
    port: 3001,
    webhookSecret: "",
    gowaBaseUrl: "http://gowa:3000",
    gowaAuth: "",
    gowaDeviceId: null,
  };
  void e;
}

/**
 * Upgrade handler: picoclaw dials ws://<host>:<port>/ (any path). The
 * handshake has no auth (matching picoclaw's client, which sends none), so
 * the listener MUST stay on localhost/private network only — the deploy
 * script binds it to 127.0.0.1.
 */
function handleWebsocket(req: Request): Response {
  const { socket, response } = Deno.upgradeWebSocket(req);
  socket.onopen = () => {
    console.log("picoclaw connected");
    picoclawSocket = socket;
    picoclawConnectedAt = Date.now();
  };
  socket.onmessage = (ev) => {
    if (typeof ev.data !== "string") return;
    let frame: PicoclawOutboundFrame | null = null;
    try {
      frame = JSON.parse(ev.data) as PicoclawOutboundFrame;
    } catch {
      console.error("invalid JSON from picoclaw");
      return;
    }
    forwardToGowa(cfg, frame);
  };
  socket.onclose = () => {
    console.log("picoclaw disconnected");
    if (picoclawSocket === socket) {
      picoclawSocket = null;
      picoclawConnectedAt = null;
    }
  };
  socket.onerror = () => console.error("picoclaw socket error");
  return response;
}

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);

  // WebSocket upgrade (picoclaw dials any path; accept the root).
  if (req.headers.get("upgrade") === "websocket") {
    try {
      return handleWebsocket(req);
    } catch (e) {
      console.error("websocket upgrade failed:", e);
      return new Response("upgrade failed", { status: 500 });
    }
  }

  // GOWA webhook endpoint (HMAC-verified).
  if (req.method === "POST" && url.pathname === "/gowa") {
    const raw = new Uint8Array(await req.arrayBuffer());
    const signature = req.headers.get("X-Hub-Signature-256") ??
      req.headers.get("x-webhook-signature");
    if (!signature || !(await verifyGowaSignature(raw, signature, cfg.webhookSecret))) {
      return new Response("invalid signature", { status: 401 });
    }
    let env: GowaEnvelope | null = null;
    try {
      env = JSON.parse(new TextDecoder().decode(raw)) as GowaEnvelope;
    } catch {
      return new Response("invalid JSON", { status: 400 });
    }
    const frame = env ? gowaToPicoclaw(env) : null;
    if (!frame) return new Response("ignored", { status: 200 });
    const delivered = sendToPicoclaw(frame);
    // 200 even when picoclaw is offline (no retry protocol exists; GOWA
    // retries only on 5xx and we do not want duplicate deliveries).
    return new Response(JSON.stringify({ delivered }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Health endpoint for systemd.
  if (req.method === "GET" && url.pathname === "/health") {
    return new Response(JSON.stringify({
      ok: true,
      picoclaw_connected: picoclawSocket !== null,
      connected_since: picoclawConnectedAt,
    }), { headers: { "Content-Type": "application/json" } });
  }

  return new Response("not found", { status: 404 });
}

if (import.meta.main) {
  console.log(`gowa-bridge listening on 127.0.0.1:${cfg.port} (ws + /gowa + /health)`);
  Deno.serve({ port: cfg.port, hostname: "127.0.0.1" }, handler);
}
