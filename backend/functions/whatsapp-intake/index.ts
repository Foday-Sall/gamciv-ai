/**
 * GamCiv AI — whatsapp-intake edge function.
 *
 * Thin connector: GOWA webhook -> verify HMAC -> extract report -> verify the
 * sender is a registered citizen (phone gate) -> classify via OpenAI-compatible
 * chat completion -> ONE rpc submit_complaint call (all routing/deadline/
 * grouping logic lives in the SQL function) -> GOWA confirmation.
 *
 * Guarantees:
 *  - Unregistered phones get onboarding instructions and NO report is filed.
 *  - Voice notes are transcribed via the AI client; a failed transcription is
 *    never fatal (the user is asked to type).
 *  - A failed GOWA confirmation never fails the intake (report is already committed).
 *  - Hard failures return 500 so GOWA retries; re-submission is idempotent via
 *    external_id dedupe in the SQL function.
 */
import { sendOrFallback } from "../_shared/channelBridge.ts";
import { FetchAiClient, loadAiConfig } from "../_shared/aiClient.ts";
import { loadAppConfig } from "../_shared/config.ts";
import {
  classificationConfirmedText,
  classificationFailedText,
  lowConfidenceText,
  looksLikeGreeting,
  notRegisteredText,
  registeredGreetingText,
  transcriptionFailedText,
} from "../_shared/intakeTexts.ts";
import type { ProfileInfo } from "../_shared/intakeTexts.ts";
import {
  type ExtractedMessage,
  extractMessage,
  FetchGowaClient,
  type GowaClient,
  normalizePhone,
  parseGowaEnvelope,
  verifyGowaSignature,
} from "../_shared/gowaClient.ts";
import { errorResponse, jsonResponse } from "../_shared/http.ts";
import { bounded, bodyTooLarge, FIELD_LIMITS } from "../_shared/limits.ts";
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
    transcribe(audio: Uint8Array, filename: string): Promise<string | null>;
  };
  rpc: RpcClient;
  /** REST lookup of a verified profile by phone; null when none matches. */
  findProfileByPhone(phone: string): Promise<ProfileInfo | null>;
  gowa: GowaClient;
  /** Resolve a GOWA media reference (relative path or URL) to a fetchable URL. */
  mediaUrl(path: string): string | null;
  /** HTTP client for media downloads (injectable for tests). */
  fetchImpl?: typeof fetch;
}

/** Wire up real clients from environment variables. */
export function buildDeps(): IntakeDeps {
  const gowaBaseUrl = Deno.env.get("GOWA_BASE_URL");
  const gowaAuth = Deno.env.get("GOWA_BASIC_AUTH");
  if (!gowaBaseUrl || !gowaAuth) {
    throw new Error("GOWA_BASE_URL and GOWA_BASIC_AUTH must be set");
  }
  const appConfig = loadAppConfig(Deno.env);
  return {
    ai: new FetchAiClient(loadAiConfig(Deno.env)),
    rpc: new PostgrestRpcClient(appConfig),
    findProfileByPhone: (phone: string) => findVerifiedProfile(appConfig, phone),
    gowa: new FetchGowaClient({
      baseUrl: gowaBaseUrl,
      basicAuth: gowaAuth,
      deviceId: Deno.env.get("GOWA_DEVICE_ID"),
    }),
    mediaUrl: (path: string) => resolveMediaUrl(path, gowaBaseUrl, gowaAuth),
    fetchImpl: fetch,
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

  // Reject oversized bodies before parsing (signature verified above, so
  // this is an authenticated delivery with anomalous size — refuse it).
  if (bodyTooLarge(raw.byteLength)) {
    return errorResponse(413, "request body too large");
  }

  const envelope = parseGowaEnvelope(new TextDecoder().decode(raw));
  if (!envelope) return errorResponse(400, "invalid JSON body");

  const msg = extractMessage(envelope);
  if (!msg) {
    // Own outgoing messages, group chats, non-message events: not intake.
    return jsonResponse({ status: "ignored" });
  }

  // PHONE GATE: only registered, phone-verified citizens can file reports.
  // Fail closed — if the lookup itself errors, treat as unregistered.
  const profile = msg.phone ? await safeFindProfile(deps, msg.phone) : null;
  if (!profile) {
    const text = notRegisteredText(msg.name);
    try {
      await sendOrFallback(
        Deno.env,
        "whatsapp",
        msg.phone ?? "",
        text,
        () => deps.gowa.sendMessage(msg.phone ?? "", text).then(() => undefined),
      );
      return jsonResponse({ status: "not_registered" });
    } catch (e) {
      console.error("not-registered send failed:", e);
      return jsonResponse({ status: "not_registered", note: "send failed" });
    }
  }

  // First-contact greeting with no report content: intro, no filing.
  if (looksLikeGreeting(msg.body)) {
    const text = registeredGreetingText(profile.fullName);
    try {
      await sendOrFallback(
        Deno.env,
        "whatsapp",
        msg.phone ?? "",
        text,
        () => deps.gowa.sendMessage(msg.phone ?? "", text).then(() => undefined),
      );
      return jsonResponse({ status: "sent_onboarding" });
    } catch (e) {
      console.error("onboarding send failed:", e);
      return jsonResponse({ status: "sent_onboarding", note: "send failed" });
    }
  }

  try {
    const outcome = await processReport(msg, profile, deps);
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
 * Look up the sender's verified profile. Lookup failures fail closed
 * (null = unregistered) so a database problem can never bypass the gate.
 */
async function safeFindProfile(
  deps: IntakeDeps,
  phone: string,
): Promise<ProfileInfo | null> {
  try {
    return await deps.findProfileByPhone(phone);
  } catch (e) {
    console.error("profile lookup failed:", e);
    return null;
  }
}

/**
 * Classify + submit + confirm. This is the whole intake pipeline.
 * Exported for tests: inject stub ai/rpc/gowa.
 */
export async function processReport(
  msg: ExtractedMessage,
  profile: ProfileInfo,
  deps: IntakeDeps,
): Promise<IntakeOutcome> {
  // 1) Voice-note pipeline: transcribe when there is audio and no typed text.
  //    Failure -> ask the user to type; never fatal.
  let body = msg.body;
  if (!body && msg.audioUrl) {
    const transcript = await transcribeAudio(deps, msg.audioUrl, deps.fetchImpl ?? fetch);
    if (!transcript) {
      const text = transcriptionFailedText();
      try {
        await sendOrFallback(
          Deno.env,
          "whatsapp",
          msg.phone ?? "",
          text,
          () => deps.gowa.sendMessage(msg.phone ?? "", text).then(() => undefined),
        );
      } catch (e) {
        console.error("transcription-failure send failed:", e);
      }
      return { status: "rejected", reason: "transcription failed" };
    }
    body = transcript;
  }

  // 2) Classify (OpenAI-compatible chat completion).
  //    - Transport/parse failure: null hints; the SQL function's emergency
  //      keyword check + default routing still files the report.
  //    - Usable "other"/low-confidence classification: the report IS filed
  //      (Central Desk via SQL routing) and the citizen is told the team is
  //      reviewing it — see the low-confidence branch below.
  let categoryHint: string | null = null;
  let urgencyHint: ComplaintUrgency | null = null;
  let confidence: number | null = null;
  let classifyFailed = false;
  try {
    const cls = await deps.ai.classify(body);
    categoryHint = cls.category;
    urgencyHint = cls.urgency;
    confidence = cls.confidence;
  } catch (e) {
    classifyFailed = true;
    console.error("classification failed:", e);
  }

  // 3) ONE hop into the DB — routing, deadlines, grouping all live in SQL.
  //    Field sizes are capped here AND re-checked in the SQL wrapper.
  const args: SubmitComplaintArgs = {
    p_title: bounded(makeTitle(body), FIELD_LIMITS.title) ?? null,
    p_description: bounded(body, FIELD_LIMITS.description) ?? "",
    p_category_hint: bounded(categoryHint, FIELD_LIMITS.categoryHint),
    p_urgency_hint: urgencyHint,
    p_lat: msg.lat,
    p_lng: msg.lng,
    p_region: null,
    p_council_area: null,
    p_ward: null,
    p_photo_url: msg.imageUrl
      ? bounded(msg.imageUrl, FIELD_LIMITS.photoUrl, { trim: false })
      : null,
    p_channel: "whatsapp",
    p_citizen_name: bounded(profile.fullName, FIELD_LIMITS.citizenName),
    p_citizen_phone: bounded(msg.phone, FIELD_LIMITS.citizenPhone, { trim: false }),
    p_is_anonymous: false,
    p_ai_category: bounded(categoryHint, FIELD_LIMITS.categoryHint),
    p_ai_urgency: urgencyHint,
    p_confidence: confidence,
    p_external_id: bounded(msg.messageId, FIELD_LIMITS.externalId, { trim: false }),
  };
  const result = await deps.rpc.call<SubmitComplaintArgs, SubmitComplaintResult>(
    "submit_complaint",
    args,
  );

  // 4) Personalized confirmation — CHANNELS_URL set routes it through the Go
  //    channels service; unset sends directly via GOWA. Must not fail the
  //    intake either way.
  const confirmed = confidence !== null && confidence >= 0.7;
  const confirmationMessage = confirmed
    ? classificationConfirmedText(
      profile,
      categoryHint,
      result.institution_name ?? result.institution,
      result.tracking_no,
    )
    : lowConfidenceText(profile, categoryHint, result.tracking_no);
  try {
    if (msg.phone) {
      await sendOrFallback(
        Deno.env,
        "whatsapp",
        msg.phone,
        confirmationMessage,
        () => deps.gowa.sendMessage(msg.phone!, confirmationMessage).then(() => undefined),
      );
    }
  } catch (e) {
    console.error("confirmation send failed:", e);
  }

  // 5) When the classifier was completely unusable, the citizen still gets an
  //    actionable reply so the intake is never silent (the low-confidence
  //    branch above already covers a classified-but-unsure report).
  if (classifyFailed) {
    try {
      if (msg.phone) {
        const sorry = classificationFailedText();
        await sendOrFallback(
          Deno.env,
          "whatsapp",
          msg.phone,
          sorry,
          () => deps.gowa.sendMessage(msg.phone!, sorry).then(() => undefined),
        );
      }
    } catch (e) {
      console.error("classification-failure send failed:", e);
    }
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

/** Download + transcribe an audio media reference. Returns null on failure. */
async function transcribeAudio(
  deps: IntakeDeps,
  audioUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const url = deps.mediaUrl(audioUrl);
  if (!url) {
    console.error("cannot resolve audio media reference:", audioUrl);
    return null;
  }
  try {
    const res = await fetchImpl(url);
    if (!res.ok) {
      console.error(`audio download failed: HTTP ${res.status}`);
      return null;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length === 0) return null;
    const filename = url.split("/").pop() ?? "voice.ogg";
    return await deps.ai.transcribe(bytes, filename);
  } catch (e) {
    console.error("audio download failed:", e);
    return null;
  }
}

/**
 * Turn a GOWA media reference into a fetchable URL (pure, testable).
 * Relative paths ("statics/media/x.ogg") resolve against the GOWA base URL;
 * absolute URLs pass through unchanged. GOWA's /statics route sits behind
 * Basic auth, so credentials are embedded in the URL for that path.
 */
export function resolveMediaUrl(
  audioUrl: string,
  gowaBaseUrl: string,
  basicAuth: string,
): string | null {
  if (/^https?:\/\//i.test(audioUrl)) return audioUrl;
  if (!gowaBaseUrl) return null;
  const base = gowaBaseUrl.replace(/\/+$/, "");
  const path = audioUrl.replace(/^\/+/, "");
  if (path.startsWith("statics/")) {
    const sep = basicAuth.indexOf(":");
    if (sep > 0) {
      const u = new URL(base);
      return `${u.protocol}//${encodeURIComponent(basicAuth.slice(0, sep))}:${
        encodeURIComponent(basicAuth.slice(sep + 1))
      }@${u.host}/${path}`;
    }
  }
  return `${base}/${path}`;
}

/**
 * Profile lookup via PostgREST (service role): profiles where phone matches
 * and phone_verified is true. Returns the first row or null.
 */
async function findVerifiedProfile(
  config: { postgrestUrl: string; serviceRoleKey: string },
  phone: string,
): Promise<ProfileInfo | null> {
  const normalized = normalizePhone(`${phone}@s.whatsapp.net`) ?? phone.trim();
  const url =
    `${config.postgrestUrl.replace(/\/+$/, "")}/rest/v1/profiles?phone=eq.${
      encodeURIComponent(normalized)
    }&phone_verified=eq.true&select=full_name,email&limit=1`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${config.serviceRoleKey}`,
      apikey: config.serviceRoleKey,
    },
  });
  if (!res.ok) {
    throw new Error(`profiles lookup failed: HTTP ${res.status}`);
  }
  const rows = await res.json() as Array<{ full_name: string | null; email: string | null }>;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return { fullName: rows[0].full_name ?? null, email: rows[0].email ?? null };
}

function makeTitle(desc: string): string {
  const firstLine = desc.trim().split("\n")[0] ?? "";
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
}
