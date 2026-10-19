/**
 * GamCiv AI — agent-api edge function.
 *
 * The glue between PicoClaw (chat agent) and GamCiv's database. PicoClaw is
 * the messaging hub (Telegram natively via its own channel, WhatsApp via a
 * small bridge) and it calls GamCiv through this function:
 *
 *   1. MCP interface (tools.mcp.servers.gamciv → mcp_gamciv_* tools):
 *      POST /mcp — JSON-RPC 2.0 over streamable HTTP (initialize/tools list/
 *      tools/call), Authorization: Bearer <AGENT_API_KEY>.
 *      Tools: gamciv_report, gamciv_status.
 *
 *   2. Plain REST fallback (used by the gowa-bridge service, which is not an
 *      MCP client): POST /report, GET /status?tracking=..., same Bearer key.
 *
 * POST /report validates the message and calls the same submit_complaint RPC
 * the intake functions use (all routing/deadline/grouping logic lives in
 * SQL), then:
 *   - returns { tracking_number, confirmation_text } so PicoClaw's agent
 *     replies in-channel itself (its reply is the primary confirmation), and
 *   - queues an SMS confirmation through the EXISTING notifications path
 *     (public.fn_notify → notifications row → notify-out), and
 *   - if RESEND_API_KEY is set, queues/sends an email confirmation via
 *     Resend's REST API (fire-and-forget, never fails the request).
 *
 * GET /status proxies the public track_complaint RPC.
 */
import { errorResponse, jsonResponse, timingSafeEqualStr } from "../_shared/http.ts";
import { bounded, bodyTooLarge, FIELD_LIMITS } from "../_shared/limits.ts";
import { PostgrestRpcClient, type RpcClient } from "../_shared/rpcClient.ts";
import type {
  ComplaintChannel,
  SubmitComplaintArgs,
  SubmitComplaintResult,
} from "../_shared/types.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Body of POST /report (REST form; the MCP tool takes the same fields). */
export interface ReportRequestBody {
  /** Origin channel: whatsapp | telegram (informational; stored on the row). */
  channel?: string;
  /** Sender identifier (phone digits or chat id) — used for the SMS queue. */
  peer?: string;
  /** The report text (required, 5..2000 chars after trim). */
  text: string;
  /** Optional media URLs (photo). First entry becomes p_photo_url. */
  media?: string[];
  /** Optional sender display name. */
  name?: string;
}

/** Body of the MCP tools/call request for gamciv_report. */
interface McpCallRequest {
  jsonrpc: "2.0";
  id: number | string | null;
  method: string;
  params?: {
    name?: string;
    arguments?: Record<string, unknown>;
  };
}

/** track_complaint RPC result (subset we expose). */
interface TrackResult {
  tracking_no: string;
  status: string;
  urgency: string | null;
  title: string | null;
  institution: string | null;
  department: string | null;
  expected_response_at: string | null;
  timeline?: Array<{ status: string; message: string | null; at: string | null }>;
}

// ---------------------------------------------------------------------------
// MCP protocol constants (streamable-http: JSON-RPC responses, SSE off)
// ---------------------------------------------------------------------------

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "gamciv-agent-api", version: "1.0.0" };

const TOOLS_LIST = {
  tools: [
    {
      name: "gamciv_report",
      description:
        "File a citizen report with GamCiv. Call this whenever the user describes a public problem " +
        "(water, power, roads, waste, safety...). Returns a tracking number and a confirmation text " +
        "to relay to the user. The confirmation is also queued as SMS automatically.",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "The full report text from the user" },
          peer: { type: "string", description: "Sender identifier (phone digits or chat id)" },
          channel: { type: "string", description: "Origin channel: whatsapp or telegram" },
          name: { type: "string", description: "Sender display name if known" },
          photo_url: { type: "string", description: "Optional photo URL for the report" },
        },
        required: ["text"],
      },
    },
    {
      name: "gamciv_status",
      description:
        "Look up the status of a GamCiv report by its tracking number (e.g. GMC-2026-00123). " +
        "Returns status, institution and timeline.",
      inputSchema: {
        type: "object",
        properties: {
          tracking: { type: "string", description: "Tracking number, e.g. GMC-2026-00123" },
        },
        required: ["tracking"],
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const ALLOWED_CHANNELS = new Set(["whatsapp", "telegram"]);

/** Validate /report body. Returns { ok, ... } or { ok:false, error }. */
export function validateReport(
  body: ReportRequestBody,
): { ok: true; text: string; channel: ComplaintChannel; peer: string | null; name: string | null; photoUrl: string | null } | { ok: false; error: string } {
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (text.length < 5) return { ok: false, error: "text is required (min 5 chars)" };
  if (text.length > FIELD_LIMITS.description) {
    return { ok: false, error: `text exceeds ${FIELD_LIMITS.description} chars` };
  }
  const channelRaw = typeof body?.channel === "string" ? body.channel.toLowerCase() : "whatsapp";
  if (!ALLOWED_CHANNELS.has(channelRaw)) {
    return { ok: false, error: "channel must be 'whatsapp' or 'telegram'" };
  }
  const peer = typeof body?.peer === "string" && body.peer.trim()
    ? bounded(body.peer, 32, { trim: false })
    : null;
  const name = typeof body?.name === "string" && body.name.trim()
    ? bounded(body.name, FIELD_LIMITS.citizenName)
    : null;
  let photoUrl: string | null = null;
  if (Array.isArray(body?.media) && body.media.length > 0) {
    const m = body.media.find((x) => typeof x === "string" && x.startsWith("http"));
    photoUrl = m ? bounded(m, FIELD_LIMITS.photoUrl, { trim: false }) : null;
  }
  return { ok: true, text, channel: channelRaw as ComplaintChannel, peer, name, photoUrl };
}

// ---------------------------------------------------------------------------
// Confirmation text (same copy contract as the intake functions)
// ---------------------------------------------------------------------------

/** Confirmation message per API-BLUEPRINT.md §Notification templates. */
export function confirmationText(r: SubmitComplaintResult): string {
  if (r.confidence !== null && r.confidence < 0.7) {
    return (
      `Received. Reference ${r.tracking_no}. Your report is in triage by the Central Desk. ` +
      "We will update you here."
    );
  }
  const dept = r.department ? ` ${r.department}` : "";
  return (
    `Received. Reference ${r.tracking_no}. ` +
    `${r.institution_name ?? r.institution}${dept} is responsible. We will update you here.`
  );
}

// ---------------------------------------------------------------------------
// Side-effects: SMS queue (existing notifications path) + optional Resend email
// ---------------------------------------------------------------------------

export interface AgentApiDeps {
  rpc: RpcClient;
  /** Fetch implementation (injectable for tests). */
  fetchImpl: typeof fetch;
  /** When set, an email confirmation is also sent via Resend. */
  resendApiKey: string | null;
  /** From address for Resend (only used when resendApiKey is set). */
  resendFrom: string;
}

export function buildDeps(): AgentApiDeps {
  return {
    rpc: new PostgrestRpcClient({
      postgrestUrl: Deno.env.get("SUPABASE_URL") ?? "http://kong:8000",
      serviceRoleKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    }),
    fetchImpl: fetch,
    resendApiKey: Deno.env.get("RESEND_API_KEY") || null,
    resendFrom: Deno.env.get("RESEND_FROM") || "GamCiv <onboarding@resend.dev>",
  };
}

/**
 * Queue the SMS confirmation through the EXISTING notifications path:
 * public.fn_notify inserts a notifications row (channel sms) which notify-out
 * delivers. We never send SMS directly and never duplicate the WhatsApp
 * confirmation that fn_notify_citizen already queued inside
 * submit_complaint_core (PicoClaw's in-channel reply is the WhatsApp
 * confirmation).
 */
async function queueSmsConfirmation(
  deps: AgentApiDeps,
  complaintId: string,
  phone: string,
  message: string,
): Promise<boolean> {
  try {
    const id = await deps.rpc.call<Record<string, unknown>, string | null>("fn_notify", {
      p_complaint_id: complaintId,
      p_channel: "sms",
      p_recipient: phone,
      p_message: message,
    });
    return id !== null;
  } catch (e) {
    // Queue failure must not fail the report (row is committed).
    console.error("sms queue (fn_notify) failed:", e);
    return false;
  }
}

/** Fire-and-forget email confirmation via Resend (never fails the request). */
async function sendEmailConfirmation(
  deps: AgentApiDeps,
  to: string,
  subject: string,
  text: string,
): Promise<boolean> {
  if (!deps.resendApiKey) return false;
  try {
    const res = await deps.fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${deps.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: deps.resendFrom,
        to: [to],
        subject,
        text,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("resend email failed:", res.status, detail.slice(0, 200));
      return false;
    }
    return true;
  } catch (e) {
    console.error("resend email error:", e);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Core handlers
// ---------------------------------------------------------------------------

/** Handle POST /report (REST). Returns { tracking_number, confirmation_text, ... }. */
export async function handleReport(
  body: ReportRequestBody,
  deps: AgentApiDeps,
): Promise<Response> {
  const v = validateReport(body);
  if (!v.ok) return errorResponse(400, v.error);

  const args: SubmitComplaintArgs = {
    p_title: bounded(v.text.split("\n")[0], FIELD_LIMITS.title),
    p_description: v.text,
    p_category_hint: null,
    p_urgency_hint: null,
    p_lat: null,
    p_lng: null,
    p_region: null,
    p_council_area: null,
    p_ward: null,
    p_photo_url: v.photoUrl,
    p_channel: "web", // DB enum has no 'telegram' yet; agent reports ride 'web'
    p_citizen_name: v.name,
    p_citizen_phone: v.peer && /^\+?\d{7,15}$/.test(v.peer) ? v.peer : null,
    p_is_anonymous: v.name === null,
    p_ai_category: null,
    p_ai_urgency: null,
    p_confidence: null,
    p_external_id: null, // dedupe key is not available here (agent-mediated)
  };
  const result = await deps.rpc.call<
    SubmitComplaintArgs,
    SubmitComplaintResult & { complaint_id: string; duplicate: boolean }
  >("submit_complaint", args);
  const confirmation = confirmationText(result);

  // SMS confirmation via the existing notifications path (only when we have
  // a phone-like peer; fn_notify skips empty recipients anyway).
  let smsQueued = false;
  if (v.peer && /^\+?\d{7,15}$/.test(v.peer)) {
    smsQueued = await queueSmsConfirmation(
      deps,
      result.complaint_id,
      v.peer,
      confirmation,
    );
  }

  // Optional email confirmation (Resend) — only when RESEND_API_KEY is set
  // and the peer looks like an email (not used today; kept per spec).
  if (v.peer && v.peer.includes("@") && deps.resendApiKey) {
    await sendEmailConfirmation(
      deps,
      v.peer,
      `GamCiv report ${result.tracking_no}`,
      confirmation,
    );
  }

  return jsonResponse({
    tracking_number: result.tracking_no,
    confirmation_text: confirmation,
    institution: result.institution,
    department: result.department,
    expected_response_at: result.expected_response_at,
    duplicate: result.duplicate === true,
    sms_queued: smsQueued,
  });
}

/** Handle GET /status?tracking=... — proxies public.track_complaint. */
export async function handleStatus(
  tracking: string | null,
  deps: AgentApiDeps,
): Promise<Response> {
  if (!tracking) return errorResponse(400, "tracking query parameter is required");
  try {
    const result = await deps.rpc.call<{ p_tracking_no: string }, TrackResult | null>(
      "track_complaint",
      { p_tracking_no: tracking },
    );
    if (!result) {
      return jsonResponse({
        tracking_number: tracking,
        status: "not_found",
        timeline: [],
      });
    }
    return jsonResponse({
      tracking_number: result.tracking_no,
      status: result.status,
      urgency: result.urgency,
      title: result.title,
      institution: result.institution,
      department: result.department,
      expected_response_at: result.expected_response_at,
      timeline: result.timeline ?? [],
    });
  } catch (e) {
    console.error("track_complaint failed:", e);
    return errorResponse(500, "status lookup failed");
  }
}

// ---------------------------------------------------------------------------
// HTTP entrypoint
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  try {
    return await route(req, buildDeps());
  } catch (e) {
    console.error("agent-api failed:", e);
    return jsonResponse({ error: "internal error" }, 500);
  }
});

/** Route + auth. Separated from buildDeps for tests. */
export async function route(
  req: Request,
  deps: AgentApiDeps,
  apiKey = Deno.env.get("AGENT_API_KEY") ?? "",
): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "");
  const isMcp = path.endsWith("/mcp");

  // Auth: every endpoint requires Bearer <AGENT_API_KEY> (PicoClaw config
  // carries it; the bridge reads it from the environment).
  const header = req.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!apiKey || !token || !timingSafeEqualStr(token, apiKey)) {
    return errorResponse(401, "invalid or missing API key");
  }

  if (req.method === "POST" && isMcp) {
    // Body-size guard shared with the other intakes.
    const raw = new Uint8Array(await req.arrayBuffer());
    if (bodyTooLarge(raw.byteLength)) return errorResponse(413, "request body too large");
    return handleMcpBody(raw, deps);
  }
  if (req.method === "POST" && path.endsWith("/report")) {
    const raw = new Uint8Array(await req.arrayBuffer());
    if (bodyTooLarge(raw.byteLength)) return errorResponse(413, "request body too large");
    let body: ReportRequestBody | null = null;
    try {
      body = JSON.parse(new TextDecoder().decode(raw)) as ReportRequestBody;
    } catch {
      return errorResponse(400, "invalid JSON body");
    }
    if (!body) return errorResponse(400, "invalid JSON body");
    return handleReport(body, deps);
  }
  if (req.method === "GET" && path.endsWith("/status")) {
    return handleStatus(url.searchParams.get("tracking"), deps);
  }
  return errorResponse(404, "not found");
}

/** Re-parse the raw MCP body (route consumed the stream). */
async function handleMcpBody(raw: Uint8Array, deps: AgentApiDeps): Promise<Response> {
  let body: McpCallRequest | null = null;
  try {
    body = JSON.parse(new TextDecoder().decode(raw)) as McpCallRequest;
  } catch {
    return errorResponse(400, "invalid JSON-RPC body");
  }
  const id = body?.id ?? null;
  const method = body?.method ?? "";
  if (method === "initialize") {
    return jsonResponse({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      },
    });
  }
  if (method.startsWith("notifications/")) {
    return jsonResponse({}, 202);
  }
  if (method === "ping") {
    return jsonResponse({ jsonrpc: "2.0", id, result: {} });
  }
  if (method === "tools/list") {
    return jsonResponse({ jsonrpc: "2.0", id, result: TOOLS_LIST });
  }
  if (method === "tools/call") {
    const name = body?.params?.name ?? "";
    const args = body?.params?.arguments ?? {};
    try {
      if (name === "gamciv_report") {
        const reqBody: ReportRequestBody = {
          text: String(args.text ?? ""),
          peer: typeof args.peer === "string" ? args.peer : undefined,
          channel: typeof args.channel === "string" ? args.channel : "whatsapp",
          name: typeof args.name === "string" ? args.name : undefined,
          media: typeof args.photo_url === "string" ? [args.photo_url] : undefined,
        };
        const res = await handleReport(reqBody, deps);
        const data = await res.json();
        if (!res.ok) {
          return jsonResponse({ jsonrpc: "2.0", id, error: { code: -32602, message: String(data.error ?? "invalid arguments") } });
        }
        return jsonResponse({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(data) }] } });
      }
      if (name === "gamciv_status") {
        const res = await handleStatus(String(args.tracking ?? ""), deps);
        const data = await res.json();
        if (!res.ok) {
          return jsonResponse({ jsonrpc: "2.0", id, error: { code: -32602, message: String(data.error ?? "invalid arguments") } });
        }
        return jsonResponse({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(data) }] } });
      }
      return jsonResponse({ jsonrpc: "2.0", id, error: { code: -32602, message: `unknown tool: ${name}` } });
    } catch (e) {
      console.error("mcp tools/call failed:", e);
      return jsonResponse({ jsonrpc: "2.0", id, error: { code: -32603, message: "internal error" } });
    }
  }
  return jsonResponse({ jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${method}` } });
}
