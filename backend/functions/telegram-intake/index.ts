/**
 * GamCiv AI — telegram-intake edge function.
 *
 * Thin connector, same shape as whatsapp-intake: Telegram webhook → verify
 * X-Telegram-Bot-Api-Secret-Token → extract report → classify via an
 * OpenAI-compatible chat completion → ONE rpc submit_complaint call (all
 * routing/deadline/grouping logic lives in the SQL function) → Telegram
 * sendMessage confirmation.
 *
 * Guarantees:
 *  - No DB reads for business logic and no routing logic here.
 *  - Idempotency: external_id = "tg:<chat_id>:<message_id>", deduped by the
 *    SQL function; duplicate webhook deliveries never create a second row.
 *  - A failed Telegram confirmation never fails the intake (report is
 *    already committed).
 *  - p_channel falls back to "web" until the DB enum report_channel gains a
 *    "telegram" value (see README and docs/sql-contract.md note).
 */
import { sendOrFallback } from "../_shared/channelBridge.ts";
import { FetchAiClient, loadAiConfig } from "../_shared/aiClient.ts";
import { loadAppConfig } from "../_shared/config.ts";
import { errorResponse, jsonResponse, timingSafeEqualStr } from "../_shared/http.ts";
import { bounded, bodyTooLarge, FIELD_LIMITS } from "../_shared/limits.ts";
import { PostgrestRpcClient, type RpcClient } from "../_shared/rpcClient.ts";
import type {
  ComplaintUrgency,
  SubmitComplaintArgs,
  SubmitComplaintResult,
} from "../_shared/types.ts";
import { storePhotoFromUrl } from "./photoStorage.ts";
import {
  extractReport,
  FetchTelegramClient,
  PHOTO_PREFIX,
  parseUpdate,
  type TelegramClient,
  type TelegramReport,
} from "./telegram.ts";

// Re-exported so unit tests can exercise normalization without importing the
// client module directly.
export { extractReport, parseUpdate };
export type { TelegramReport };

/**
 * Channel written to submit_complaint. The live DB enum report_channel is
 * web/whatsapp/sms/email — no "telegram" yet — so the code maps telegram →
 * web (same public intake surface) until the DB adds the value.
 */
const FALLBACK_CHANNEL = "web" as const;

/** Collaborators, injectable for tests. */
export interface TelegramIntakeDeps {
  ai: {
    classify(
      description: string,
    ): Promise<{ category: string; urgency: ComplaintUrgency; confidence: number }>;
  };
  rpc: RpcClient;
  telegram: TelegramClient;
}

/** Wire up real clients from environment variables. */
export function buildDeps(): TelegramIntakeDeps {
  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!botToken) {
    throw new Error("TELEGRAM_BOT_TOKEN must be set");
  }
  return {
    ai: new FetchAiClient(loadAiConfig(Deno.env)),
    rpc: new PostgrestRpcClient(loadAppConfig(Deno.env)),
    telegram: new FetchTelegramClient({ botToken }),
  };
}

Deno.serve(async (req: Request): Promise<Response> => {
  try {
    return await handleRequest(req, buildDeps());
  } catch (e) {
    // Missing env vars or unexpected init failure: 500 so Telegram retries.
    console.error("telegram-intake init/processing failed:", e);
    return jsonResponse({ status: "rejected", reason: "internal error" }, 500);
  }
});

/** HTTP entry: verify secret token, dispatch. Separated from buildDeps for tests. */
export async function handleRequest(
  req: Request,
  deps: TelegramIntakeDeps,
  webhookSecret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "",
): Promise<Response> {
  const secretToken = req.headers.get("X-Telegram-Bot-Api-Secret-Token");

  // Telegram sends the secret on every webhook delivery; a misconfigured
  // webhook (or a scanner hitting the URL) fails here with 401.
  if (!webhookSecret || !secretToken || !timingSafeEqualStr(secretToken, webhookSecret)) {
    return errorResponse(401, "invalid webhook secret token");
  }

  const raw = new Uint8Array(await req.arrayBuffer());
  // Reject oversized bodies before any parsing (provider posts stay well under
  // this; anything bigger is abuse, not a Telegram update).
  if (bodyTooLarge(raw.byteLength)) {
    return errorResponse(413, "request body too large");
  }

  const update = parseUpdate(new TextDecoder().decode(raw));
  if (!update) return errorResponse(400, "invalid JSON body");

  const report = extractReport(update);
  if (!report) {
    // Non-message updates, group/channel messages, stickers, edits: not intake.
    return jsonResponse({ status: "ignored" });
  }

  try {
    const outcome = await processReport(report, deps);
    return jsonResponse(outcome);
  } catch (e) {
    // 500 → Telegram retries (up to ~24h); external_id dedupe makes retries
    // idempotent.
    console.error("telegram-intake processing failed:", e);
    return jsonResponse(
      { status: "rejected", reason: "internal error" },
      500,
    );
  }
}

/**
 * Classify + submit + confirm. This is the whole intake pipeline.
 * Exported for tests: inject stub ai/rpc/telegram.
 */
export async function processReport(
  report: TelegramReport,
  deps: TelegramIntakeDeps,
): Promise<Outcome> {
  // 1) Photo pipeline: the Telegram download URL embeds the bot token and
  //    expires in ~1h, so it must never be persisted. Resolve file_id → URL,
  //    immediately pull the bytes and store them in the private
  //    complaint-photos bucket, then persist only the token-free object
  //    reference. Every failure degrades to a token-free fallback reference
  //    (or null) — a photo problem never fails the intake.
  let photoUrl: string | null = null;
  if (report.photoFileId) {
    photoUrl = await resolvePhotoReference(report, deps);
  }

  // 2) Classify (OpenAI-compatible chat completion). Failure is not fatal.
  let categoryHint: string | null = null;
  let urgencyHint: ComplaintUrgency | null = null;
  let confidence: number | null = null;
  try {
    const cls = await deps.ai.classify(report.body);
    categoryHint = cls.category;
    urgencyHint = cls.urgency;
    confidence = cls.confidence;
  } catch (e) {
    // Classifier down: submit with null hints; the SQL function's emergency
    // keyword check + default routing still files the report.
    console.error("classification failed:", e);
  }

  // 3) ONE hop into the DB — routing, deadlines, grouping all live in SQL.
  //    Field sizes are capped here AND re-checked in the SQL wrapper.
  const args: SubmitComplaintArgs = {
    p_title: bounded(makeTitle(report.body), FIELD_LIMITS.title) ?? null,
    p_description: bounded(report.body, FIELD_LIMITS.description) ?? "",
    p_category_hint: bounded(categoryHint, FIELD_LIMITS.categoryHint),
    p_urgency_hint: urgencyHint,
    p_lat: report.lat,
    p_lng: report.lng,
    p_region: null,
    p_council_area: null,
    p_ward: null,
    p_photo_url: photoUrl ? bounded(photoUrl, FIELD_LIMITS.photoUrl, { trim: false }) : null,
    p_channel: FALLBACK_CHANNEL,
    p_citizen_name: bounded(report.name, FIELD_LIMITS.citizenName),
    // Telegram never exposes the user's phone number — null by design.
    p_citizen_phone: null,
    p_is_anonymous: report.name === null,
    p_ai_category: bounded(categoryHint, FIELD_LIMITS.categoryHint),
    p_ai_urgency: urgencyHint,
    p_confidence: confidence,
    p_external_id: bounded(report.externalId, FIELD_LIMITS.externalId, { trim: false }),
  };
  const result = await deps.rpc.call<SubmitComplaintArgs, SubmitComplaintResult>(
    "submit_complaint",
    args,
  );

  // 4) Confirmation — CHANNELS_URL set routes it through the Go channels
  //    service (picoclaw bus); unset sends directly via the Telegram Bot API.
  //    Must not fail the intake either way.
  try {
    await sendOrFallback(
      Deno.env,
      "telegram",
      report.chatId,
      confirmationText(result),
      () => deps.telegram.sendMessage(report.chatId, confirmationText(result)).then(() => undefined),
    );
  } catch (e) {
    console.error("telegram confirmation send failed:", e);
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

/** Confirmation message, same copy contract as whatsapp-intake. */
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

/**
 * file_id → token-free stored reference.
 *
 * getPhotoUrl returns a short-lived URL that embeds the bot token; we consume
 * it in-process (download + bucket upload) and persist only the token-free
 * object reference. If storage is not configured the fallback reference
 * ("telegram/<fileId>") is stored instead — still token-free, re-resolvable
 * at fetch time by a component that holds the bot token. The short-lived
 * token-bearing URL itself is never written anywhere.
 */
async function resolvePhotoReference(
  report: TelegramReport,
  deps: TelegramIntakeDeps,
): Promise<string | null> {
  const providerUrl = await deps.telegram.getPhotoUrl(report.photoFileId!);
  if (!providerUrl) return null;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const objectPath = `${PHOTO_PREFIX}/${report.photoFileId}`;
  if (!supabaseUrl || !serviceRoleKey) {
    // Storage not reachable from this function: keep a token-free reference
    // instead of the token-bearing URL. Comment stands until storage env is
    // wired: the token must be added at fetch time to re-download.
    console.error("storage env missing; storing token-free fallback reference");
    return `${PHOTO_PREFIX}/${report.photoFileId}`;
  }
  const stored = await storePhotoFromUrl({ supabaseUrl, serviceRoleKey }, providerUrl, objectPath);
  return stored.ref || null;
}

function makeTitle(desc: string): string {
  const firstLine = desc.trim().split("\n")[0] ?? "";
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
}

/** Mirrors the shared IntakeOutcome shape (kept local to avoid editing _shared). */
interface Outcome {
  status: "accepted" | "rejected";
  tracking_no?: string;
  institution?: string;
  department?: string | null;
  expected_response_at?: string;
  confidence?: number | null;
  sensitive?: boolean;
  reason?: string;
}
