/**
 * GamCiv AI — notify-out edge function.
 *
 * Thin connector: DB (pg_net) -> single POST -> GOWA (WhatsApp) or Termii (SMS).
 * One notification id in, one message out, delivery result back to the DB via
 * rpc notify_out_result. It NEVER queries the DB for business logic — status
 * transitions live in SQL; this function only relays one row's delivery.
 *
 * Auth: shared secret via x-gamciv-key header (stored in the DB Vault, passed
 * by pg_net). Optional GOWA_DEVICE_ID when more than one device is linked.
 */
import { sendOrFallback } from "../_shared/channelBridge.ts";
import { FetchGowaClient, type GowaClient } from "../_shared/gowaClient.ts";
import { jsonResponse, readJson, timingSafeEqualStr } from "../_shared/http.ts";
import { PostgrestRpcClient, type RpcClient } from "../_shared/rpcClient.ts";
import { buildSmsClient, type SmsClient } from "./smsProvider.ts";

export interface NotifyOutRequest {
  /** UUID of the notifications row (string form). */
  notification_id: string;
}

export type NotifyOutOutcome =
  | { status: "sent"; channel: "whatsapp" | "sms"; provider_ref: string | null }
  | { status: "failed"; channel: "whatsapp" | "sms"; reason: string }
  | { status: "noop"; reason: string };

/** Test hook: replace providers/rpc in unit tests. */
export interface NotifyOutDeps {
  gowa: GowaClient;
  /** Configured SMS client (termii or http_gateway), null when unconfigured. */
  sms: SmsClient | null;
  rpc: RpcClient;
}

export function buildDeps(): NotifyOutDeps {
  const gowaBaseUrl = Deno.env.get("GOWA_BASE_URL");
  const gowaAuth = Deno.env.get("GOWA_BASIC_AUTH");
  if (!gowaBaseUrl || !gowaAuth) {
    throw new Error("GOWA_BASE_URL and GOWA_BASIC_AUTH must be set");
  }
  return {
    gowa: new FetchGowaClient({
      baseUrl: gowaBaseUrl,
      basicAuth: gowaAuth,
      deviceId: Deno.env.get("GOWA_DEVICE_ID"),
    }),
    sms: buildSmsClient(Deno.env),
    rpc: new PostgrestRpcClient({
      postgrestUrl: Deno.env.get("SUPABASE_URL") ?? "http://kong:8000",
      serviceRoleKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    }),
  };
}

Deno.serve(async (req: Request): Promise<Response> => {
  try {
    return await handleRequest(req, buildDeps());
  } catch (e) {
    console.error("notify-out failed:", e);
    return jsonResponse({ status: "failed", reason: "internal error" }, 500);
  }
});

export async function handleRequest(
  req: Request,
  deps: NotifyOutDeps,
  internalKey = Deno.env.get("INTERNAL_FUNCTION_KEY") ?? "",
): Promise<Response> {
  if (!internalKey || !timingSafeEqualStr(req.headers.get("x-gamciv-key") ?? "", internalKey)) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  const body = await readJson<NotifyOutRequest>(req);
  if (!body || typeof body.notification_id !== "string") {
    return jsonResponse({ error: "notification_id (string uuid) is required" }, 400);
  }

  // Claim the row so only one worker processes a notification
  // (atomic UPDATE ... WHERE status='pending' FOR UPDATE SKIP LOCKED in SQL).
  const claim = await deps.rpc.call<Record<string, unknown>, ClaimRow | null>(
    "notify_out_claim",
    { p_notification_id: body.notification_id },
  );
  if (!claim) {
    return jsonResponse({
      status: "noop",
      reason: "notification not claimable (already sent or unknown)",
    });
  }

  // Route on the claimed channel; email and anything unknown is explicitly
  // failed (never silently sent via WhatsApp).
  if (claim.channel === "sms") {
    return guardedSend(deps, claim, () => sendSms(deps, claim));
  }
  if (claim.channel === "whatsapp") {
    return guardedSend(deps, claim, () => sendWhatsapp(deps, claim));
  }
  return guardedSend(deps, claim, () =>
    recordAndRespond(
      deps.rpc,
      claim,
      `channel "${String(claim.channel)}" is not yet supported by notify-out`,
    ));
}

/** Wrap a provider call: unexpected errors are recorded as failed, not thrown. */
async function guardedSend(
  deps: NotifyOutDeps,
  claim: ClaimRow,
  send: () => Promise<Response>,
): Promise<Response> {
  try {
    return await send();
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return recordAndRespond(deps.rpc, claim, reason);
  }
}

async function sendWhatsapp(deps: NotifyOutDeps, claim: ClaimRow): Promise<Response> {
  if (!claim.recipient || !claim.message) {
    return recordAndRespond(deps.rpc, claim, "missing recipient or message");
  }
  // CHANNELS_URL set: route through the Go channels service (picoclaw bus,
  // which applies splitting/retries and hands off to its whatsapp channel);
  // unset: direct GOWA send (backward compatible default).
  // Boxed so TypeScript doesn't narrow the outer variable to `never` after
  // assignment inside the async closure (TS2339 on directResult?.status).
  const direct = { result: null as { messageId?: string; status?: string } | null };
  const outcome = await sendOrFallback(
    Deno.env,
    "whatsapp",
    claim.recipient,
    claim.message,
    async () => {
      const sent = await deps.gowa.sendMessage(claim.recipient!, claim.message!);
      direct.result = sent;
    },
  );
  if (outcome.status === "queued") {
    // Accepted for delivery; splitting/retries are the Go manager's job.
    await deps.rpc.call<Record<string, unknown>, boolean>("notify_out_result", {
      p_notification_id: claim.notification_id,
      p_status: "sent",
      p_provider_ref: null,
      p_error: null,
    });
    return jsonResponse({ status: "sent", channel: "whatsapp", provider_ref: null });
  }
  const ok = direct.result?.status === "sent";
  await deps.rpc.call<Record<string, unknown>, boolean>("notify_out_result", {
    p_notification_id: claim.notification_id,
    p_status: ok ? "sent" : "failed",
    p_provider_ref: ok ? (direct.result?.messageId ?? null) : null,
    p_error: ok ? null : `gowa status ${direct.result?.status ?? "unknown"}`,
  });
  return ok
    ? jsonResponse({
      status: "sent",
      channel: "whatsapp",
      provider_ref: direct.result?.messageId ?? null,
    })
    : jsonResponse({
      status: "failed",
      channel: "whatsapp",
      reason: `gowa status ${direct.result?.status ?? "unknown"}`,
    });
}

async function sendSms(deps: NotifyOutDeps, claim: ClaimRow): Promise<Response> {
  if (!claim.recipient || !claim.message) {
    return recordAndRespond(deps.rpc, claim, "missing recipient or message");
  }
  if (!deps.sms) {
    return recordAndRespond(
      deps.rpc,
      claim,
      "no SMS provider configured (set SMS_PROVIDER with its credentials)",
    );
  }
  const result = await deps.sms.sendSms(claim.recipient, claim.message);
  const ok = result.status === "success" && !result.error;
  await deps.rpc.call<Record<string, unknown>, boolean>("notify_out_result", {
    p_notification_id: claim.notification_id,
    p_status: ok ? "sent" : "failed",
    p_provider_ref: ok ? result.message_id : null,
    p_error: ok ? null : (result.error ?? "SMS provider error"),
  });
  return ok
    ? jsonResponse({ status: "sent", channel: "sms", provider_ref: result.message_id })
    : jsonResponse({
      status: "failed",
      channel: "sms",
      reason: result.error ?? "SMS provider error",
    });
}

/** Write the failure to the DB and respond 200 (row is marked failed; no retry loop). */
async function recordAndRespond(
  rpc: RpcClient,
  claim: ClaimRow,
  reason: string,
): Promise<Response> {
  await recordFailure(rpc, claim.notification_id, reason);
  return jsonResponse({
    status: "failed",
    channel: claim.channel,
    reason,
  });
}

async function recordFailure(
  rpc: RpcClient,
  notificationId: string,
  reason: string,
): Promise<void> {
  try {
    await rpc.call<Record<string, unknown>, boolean>("notify_out_result", {
      p_notification_id: notificationId,
      p_status: "failed",
      p_provider_ref: null,
      p_error: reason,
    });
  } catch (e) {
    console.error("notify_out_result failed:", e);
  }
}

/** Row shape returned by the SQL function notify_out_claim. */
export interface ClaimRow {
  /** UUID of the notifications row (string form). */
  notification_id: string;
  /** DB enum notif_channel; notify-out sends whatsapp/sms, fails others. */
  channel: "whatsapp" | "sms" | "email" | string;
  recipient: string | null;
  message: string | null;
}
