/**
 * GamCiv AI — whatsapp-intake edge function.
 *
 * Thin connector: GOWA webhook -> verify HMAC -> extract report -> classify via
 * OpenAI-compatible chat completion -> ONE rpc submit_complaint call (all
 * routing/deadline/grouping logic lives in the SQL function) -> GOWA confirmation.
 *
 * Guarantees:
 *  - No DB reads for business logic and no routing logic here.
 *  - A failed GOWA confirmation never fails the intake (report is already committed).
 *  - Hard failures return 500 so GOWA retries; re-submission is idempotent via
 *    external_id dedupe in the SQL function.
 */
import { FetchAiClient, loadAiConfig } from "../_shared/aiClient.ts";
import { loadAppConfig } from "../_shared/config.ts";
import {
  type ExtractedMessage,
  extractMessage,
  FetchGowaClient,
  type GowaClient,
  parseGowaEnvelope,
  verifyGowaSignature,
} from "../_shared/gowaClient.ts";
import { errorResponse, jsonResponse } from "../_shared/http.ts";
import { PostgrestRpcClient, type RpcClient } from "../_shared/rpcClient.ts";
import type {
  ComplaintUrgency,
  IntakeOutcome,
  SubmitComplaintArgs,
  SubmitComplaintResult,
} from "../_shared/types.ts";

/** Collaborators, injectable for tests. */
export interface IntakeDeps {
  ai: {
    classify(
      description: string,
    ): Promise<{ category: string; urgency: ComplaintUrgency; confidence: number }>;
  };
  rpc: RpcClient;
  gowa: GowaClient;
}

/** Wire up real clients from environment variables. */
export function buildDeps(): IntakeDeps {
  const gowaBaseUrl = Deno.env.get("GOWA_BASE_URL");
  const gowaAuth = Deno.env.get("GOWA_BASIC_AUTH");
  if (!gowaBaseUrl || !gowaAuth) {
    throw new Error("GOWA_BASE_URL and GOWA_BASIC_AUTH must be set");
  }
  return {
    ai: new FetchAiClient(loadAiConfig(Deno.env)),
    rpc: new PostgrestRpcClient(loadAppConfig(Deno.env)),
    gowa: new FetchGowaClient({
      baseUrl: gowaBaseUrl,
      basicAuth: gowaAuth,
      deviceId: Deno.env.get("GOWA_DEVICE_ID"),
    }),
  };
}

Deno.serve(async (req: Request): Promise<Response> => {
  try {
    return await handleRequest(req, buildDeps());
  } catch (e) {
    // Missing env vars or unexpected init failure: 500 so GOWA retries.
    console.error("whatsapp-intake init/processing failed:", e);
    return jsonResponse({ status: "rejected", reason: "internal error" }, 500);
  }
});

/** HTTP entry: verify signature, dispatch. Separated from buildDeps for tests. */
export async function handleRequest(
  req: Request,
  deps: IntakeDeps,
  webhookSecret = Deno.env.get("GOWA_WEBHOOK_SECRET") ?? "",
): Promise<Response> {
  const raw = new Uint8Array(await req.arrayBuffer());
  const signature = req.headers.get("X-Hub-Signature-256") ??
    req.headers.get("x-webhook-signature");

  if (!webhookSecret || !signature) {
    return errorResponse(401, "missing webhook signature");
  }
  if (!(await verifyGowaSignature(raw, signature, webhookSecret))) {
    return errorResponse(401, "invalid webhook signature");
  }

  const envelope = parseGowaEnvelope(new TextDecoder().decode(raw));
  if (!envelope) return errorResponse(400, "invalid JSON body");

  const msg = extractMessage(envelope);
  if (!msg) {
    // Own outgoing messages, group chats, non-message events, audio-only: not intake.
    return jsonResponse({ status: "ignored" });
  }

  // First-contact greeting with no report content: onboard instead of filing.
  if (looksLikeGreeting(msg.body)) {
    try {
      await deps.gowa.sendMessage(
        msg.phone ?? "",
        onboardingText(msg.name),
      );
      return jsonResponse({ status: "sent_onboarding" });
    } catch (e) {
      console.error("gowa onboarding send failed:", e);
      return jsonResponse({ status: "sent_onboarding", note: "send failed" });
    }
  }

  try {
    const outcome = await processReport(msg, deps);
    return jsonResponse(outcome);
  } catch (e) {
    // 500 -> GOWA retries (5 attempts, exponential backoff); external_id dedupe
    // makes retries idempotent.
    console.error("whatsapp-intake processing failed:", e);
    return jsonResponse(
      { status: "rejected", reason: "internal error" },
      500,
    );
  }
}

/**
 * Classify + submit + confirm. This is the whole intake pipeline.
 * Exported for tests: inject stub ai/rpc/gowa.
 */
export async function processReport(
  msg: ExtractedMessage,
  deps: IntakeDeps,
): Promise<IntakeOutcome> {
  if (!msg.body) {
    // Media with no caption: we accept it via SQL defaults rather than losing it.
    // (submit_complaint derives title/description from photo/location when empty.)
    return { status: "rejected", reason: "no report text — caption required" };
  }

  // 1) Classify (OpenAI-compatible chat completion). Failure is not fatal.
  let categoryHint: string | null = null;
  let urgencyHint: ComplaintUrgency | null = null;
  let confidence: number | null = null;
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

  // 2) ONE hop into the DB — routing, deadlines, grouping all live in SQL.
  const args: SubmitComplaintArgs = {
    p_title: makeTitle(msg.body),
    p_description: msg.body,
    p_category_hint: categoryHint,
    p_urgency_hint: urgencyHint,
    p_lat: msg.lat,
    p_lng: msg.lng,
    p_region: null,
    p_council_area: null,
    p_ward: null,
    p_photo_url: msg.imageUrl,
    p_channel: "whatsapp",
    p_citizen_name: msg.name,
    p_citizen_phone: msg.phone,
    p_is_anonymous: false,
    p_ai_category: categoryHint,
    p_ai_urgency: urgencyHint,
    p_confidence: confidence,
    p_external_id: msg.messageId,
  };
  const result = await deps.rpc.call<SubmitComplaintArgs, SubmitComplaintResult>(
    "submit_complaint",
    args,
  );

  // 3) Confirmation via GOWA — must not fail the intake.
  try {
    if (msg.phone) {
      await deps.gowa.sendMessage(msg.phone, confirmationText(result));
    }
  } catch (e) {
    console.error("gowa confirmation send failed:", e);
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

function onboardingText(name: string | null): string {
  const greeting = name ? `Hello ${name}` : "Hello";
  return (
    `${greeting}! I'm GamCiv, your civic assistant. ` +
    "To report a public problem (water, power, roads, waste, safety), just send the details here. " +
    "Include a photo or your location if you can — I'll route it to the right authority and reply with a tracking number."
  );
}

/**
 * A bare greeting / first-contact ping ("hi", "hello", "good morning...") with
 * no report content. Anything that carries more words is treated as a report,
 * so "no water in Bakoteh since morning" is never swallowed.
 */
export function looksLikeGreeting(body: string): boolean {
  const t = body.trim().toLowerCase().replace(/[!,.?:]+$/, "");
  return /^(hi+|hello+|hey+|good (morning|afternoon|evening)|start|help|menu|salut|asalam(ual)?ekum|assalam(ual)?ekum)$/
    .test(t);
}

function makeTitle(desc: string): string {
  const firstLine = desc.trim().split("\n")[0] ?? "";
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
}
