/**
 * GamCiv AI — meta-whatsapp-intake edge function.
 *
 * Thin connector, same shape as the other intakes: Meta WhatsApp Business
 * Cloud API webhook → verify X-Hub-Signature-256 (HMAC-SHA256, sha256= prefix,
 * constant-time) → extract report (text / image media_id / location) →
 * classify via an OpenAI-compatible chat completion → ONE rpc submit_complaint
 * call (all routing/deadline/grouping logic lives in the SQL function) →
 * Cloud API text confirmation sent to graph.facebook.com/{version}/
 * {META_PHONE_NUMBER_ID}/messages with Bearer META_WHATSAPP_TOKEN.
 *
 * Guarantees:
 *  - The webhook verification GET handshake returns the hub.challenge value as
 *    the raw response body (plain text) with HTTP 200, as the Cloud API
 *    requires; POST payloads are verified against the app secret.
 *  - Status / echo webhooks (outgoing business messages) and non-message
 *    fields are answered 200 "ignored" so Meta does not retry them.
 *  - No DB reads for business logic and no routing logic here.
 *  - Idempotency: p_external_id = the wamid message id from Meta, deduped by
 *    the SQL function; Meta retries duplicate deliveries safely.
 *  - A failed Meta confirmation never fails the intake (report is committed).
 */
import { FetchAiClient, loadAiConfig } from "../_shared/aiClient.ts";
import { loadAppConfig } from "../_shared/config.ts";
import { errorResponse, jsonResponse } from "../_shared/http.ts";
import { bounded, bodyTooLarge, FIELD_LIMITS } from "../_shared/limits.ts";
import { PostgrestRpcClient, type RpcClient } from "../_shared/rpcClient.ts";
import type {
  ComplaintUrgency,
  SubmitComplaintArgs,
  SubmitComplaintResult,
} from "../_shared/types.ts";
import {
  type MetaClient,
  type MetaMessage,
  extractMessages,
  FetchMetaClient,
  parseMetaEnvelope,
  verifyMetaSignature,
} from "./meta.ts";

// Re-exported so unit tests can exercise normalization and signature
// verification without importing the client module directly.
export {
  extractMessages,
  FetchMetaClient,
  parseMetaEnvelope,
  verifyMetaSignature,
};

/** Collaborators, injectable for tests. */
export interface MetaIntakeDeps {
  ai: {
    classify(
      description: string,
    ): Promise<{ category: string; urgency: ComplaintUrgency; confidence: number }>;
  };
  rpc: RpcClient;
  meta: MetaClient;
}

/** Wire up real clients from environment variables. */
export function buildDeps(): MetaIntakeDeps {
  const phoneNumberId = Deno.env.get("META_PHONE_NUMBER_ID");
  const token = Deno.env.get("META_WHATSAPP_TOKEN");
  if (!phoneNumberId || !token) {
    throw new Error("META_PHONE_NUMBER_ID and META_WHATSAPP_TOKEN must be set");
  }
  return {
    ai: new FetchAiClient(loadAiConfig(Deno.env)),
    rpc: new PostgrestRpcClient(loadAppConfig(Deno.env)),
    meta: new FetchMetaClient({ phoneNumberId, token }),
  };
}

Deno.serve(async (req: Request): Promise<Response> => {
  try {
    return await handleRequest(req, buildDeps());
  } catch (e) {
    // Missing env vars or unexpected init failure: 500 so Meta retries.
    console.error("meta-whatsapp-intake init/processing failed:", e);
    return jsonResponse({ status: "rejected", reason: "internal error" }, 500);
  }
});

/**
 * HTTP entry: verification handshake (GET) and signed deliveries (POST).
 * Separated from buildDeps for tests; verifyToken and appSecret are parameters
 * so tests can pass values directly.
 */
export async function handleRequest(
  req: Request,
  deps: MetaIntakeDeps,
  verifyToken = Deno.env.get("META_VERIFY_TOKEN") ?? "",
  appSecret = Deno.env.get("META_APP_SECRET") ?? "",
): Promise<Response> {
  if (req.method === "GET") return handleVerification(req, verifyToken);
  if (req.method !== "POST") return errorResponse(405, "method not allowed");

  const raw = new Uint8Array(await req.arrayBuffer());
  const signature = req.headers.get("X-Hub-Signature-256");

  // Meta signs every delivery; a scanner hitting the URL fails here with 401.
  if (!appSecret || !signature || !(await verifyMetaSignature(raw, signature, appSecret))) {
    return errorResponse(401, "invalid webhook signature");
  }

  // Reject oversized bodies before parsing (verified above, so it's a real
  // Meta delivery with an anomalous size — still refuse, don't process).
  if (bodyTooLarge(raw.byteLength)) {
    return errorResponse(413, "request body too large");
  }

  const envelope = parseMetaEnvelope(new TextDecoder().decode(raw));
  if (!envelope) return errorResponse(400, "invalid JSON body");

  const messages = extractMessages(envelope);
  if (messages.length === 0) {
    // statuses/echoes of our own outgoing messages, system/reaction/
    // unsupported payloads, error payloads, and non-"messages" fields:
    // not intake. Answer 200 so Meta does not retry.
    return jsonResponse({ status: "ignored" });
  }

  try {
    // Meta may batch several updates per delivery; process each message.
    const outcomes = [];
    for (const msg of messages) {
      outcomes.push(await processReport(msg, deps));
    }
    return jsonResponse({ status: "accepted", results: outcomes });
  } catch (e) {
    // 500 -> Meta retries (immediately, then with decreasing frequency over
    // 7 days); the wamid external_id dedupe keeps retries idempotent.
    console.error("meta-whatsapp-intake processing failed:", e);
    return jsonResponse({ status: "rejected", reason: "internal error" }, 500);
  }
}

/** GET verification handshake per the Cloud API docs. */
function handleVerification(req: Request, verifyToken: string): Response {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const challenge = url.searchParams.get("hub.challenge");
  const token = url.searchParams.get("hub.verify_token");

  if (!verifyToken || mode !== "subscribe" || token !== verifyToken || !challenge) {
    // Docs: "respond with a 400-level HTTP status code, or anything other
    // than status 200" when the request is invalid.
    return errorResponse(403, "verification failed");
  }
  // MUST be the hub.challenge value as the raw body — plain text, not JSON.
  return new Response(challenge, {
    status: 200,
    headers: { "Content-Type": "text/plain", "X-Content-Type-Options": "nosniff" },
  });
}

/**
 * Classify + submit + confirm. This is the whole intake pipeline.
 * Exported for tests: inject stub ai/rpc/meta.
 */
export async function processReport(
  msg: MetaMessage,
  deps: MetaIntakeDeps,
): Promise<IntakeOutcome> {
  // 1) Classify (OpenAI-compatible chat completion). Failure is not fatal.
  let categoryHint: string | null = null;
  let urgencyHint: ComplaintUrgency | null = null;
  let confidence: number | null = null;
  if (msg.body) {
    try {
      const cls = await deps.ai.classify(msg.body);
      categoryHint = cls.category;
      urgencyHint = cls.urgency;
      confidence = cls.confidence;
    } catch (e) {
      // Classifier down: submit with null hints; the SQL function's emergency
      // keyword check + default routing still files the report.
      console.error("classification failed:", e);
    }
  }

  // 2) ONE hop into the DB — routing, deadlines, grouping all live in SQL.
  //    Field sizes are capped here AND re-checked in the SQL wrapper.
  const args: SubmitComplaintArgs = {
    p_title: makeTitle(msg) ? bounded(makeTitle(msg), FIELD_LIMITS.title) : null,
    p_description: bounded(
      msg.body || "Photo report sent via Meta WhatsApp (no caption)",
      FIELD_LIMITS.description,
    ) ?? "",
    p_category_hint: bounded(categoryHint, FIELD_LIMITS.categoryHint),
    p_urgency_hint: urgencyHint,
    p_lat: msg.lat,
    p_lng: msg.lng,
    p_region: null,
    p_council_area: null,
    p_ward: null,
    p_photo_url: mediaReference(msg),
    p_channel: "whatsapp",
    p_citizen_name: bounded(msg.name, FIELD_LIMITS.citizenName),
    p_citizen_phone: bounded(msg.waId, FIELD_LIMITS.citizenPhone, { trim: false }),
    p_is_anonymous: !msg.name,
    p_ai_category: bounded(categoryHint, FIELD_LIMITS.categoryHint),
    p_ai_urgency: urgencyHint,
    p_confidence: msg.body ? confidence : null,
    p_external_id: bounded(msg.messageId, FIELD_LIMITS.externalId, { trim: false }),
  };

  const result = await deps.rpc.call<SubmitComplaintArgs, SubmitComplaintResult>(
    "submit_complaint",
    args,
  );

  // 3) Confirmation via the Cloud API — must not fail the intake.
  try {
    if (msg.waId) {
      await deps.meta.sendMessage(msg.waId, confirmationText(result));
    }
  } catch (e) {
    console.error("meta confirmation send failed:", e);
  }

  return {
    status: "accepted",
    tracking_no: result.tracking_no,
    institution: result.institution,
    department: result.department,
    expected_response_at: result.expected_response_at,
    confidence: result.confidence,
    sensitive: result.sensitive,
  };
}

/** Confirmation message, same copy contract as the other intakes. */
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

/** Title: first line of the body, truncated at 80 chars (same as sibling intakes). */
function makeTitle(msg: MetaMessage): string | null {
  const firstLine = msg.body.trim().split("\n")[0] ?? "";
  return firstLine ? (firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine) : null;
}

/**
 * Image handling: store a token-free, non-expiring reference only.
 *
 * Prefer the Cloud API media id (re-downloadable via
 * GET /{phone-number-id}/{media-id} with the stored credential) — the
 * short-lived webhook URL requires the access token to fetch, so storing it
 * would (a) leak a credential-gated URL into the DB and (b) break within 24h.
 * The bare media id contains no secret and never expires.
 */
function mediaReference(msg: MetaMessage): string | null {
  if (msg.mediaId) return msg.mediaId;
  // Legacy fallback: only when no media id exists. Strip any credential
  // fragment/query before persisting, and cap the length.
  if (msg.mediaUrl) {
    const stripped = msg.mediaUrl.split("?")[0].split("#")[0];
    return bounded(stripped, FIELD_LIMITS.photoUrl, { trim: false });
  }
  return null;
}

/** Mirrors the shared IntakeOutcome shape (kept local to avoid editing _shared). */
interface IntakeOutcome {
  status: "accepted" | "rejected";
  tracking_no?: string;
  institution?: string;
  department?: string | null;
  expected_response_at?: string;
  confidence?: number | null;
  sensitive?: boolean;
  reason?: string;
}
