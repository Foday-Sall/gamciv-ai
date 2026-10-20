/**
 * GamCiv AI - auth-verify edge function.
 *
 * Email and phone verification for the civic web app. Endpoints (all POST,
 * user JWT required via Supabase auth):
 *
 *   /send-email-otp    create + hash an email code, send via Resend
 *                      (Google-signed users get the welcome email instead)
 *   /verify-email-otp  consume the code, mark profiles.email_verified
 *   /send-phone-otp    create + hash a phone code, send via the GOWA REST
 *                      send/message endpoint from the admin-configured
 *                      sender number (the message text mentions it)
 *   /verify-phone-otp  consume the code, save phone + profiles.phone_verified
 *
 * All business rules live here or in SQL; this file only orchestrates:
 * rate limits (3 sends/recipient/hour, 5 verify attempts), code hashing,
 * single-use consumption. Never modifies existing functions.
 */
import { FetchGowaClient, type GowaClient } from "../_shared/gowaClient.ts";
import { jsonResponse, errorResponse, readJson, timingSafeEqualStr, fetchWithRetry } from "../_shared/http.ts";
import {
  generateOtp,
  hashOtp,
  isValidEmail,
  loadAppSettings,
  normalizePhoneOtp,
  OTP_MAX_ATTEMPTS,
  OTP_MAX_SENDS_PER_HOUR,
  OTP_TTL_SECONDS,
  buildEmailContent,
  whatsappOtpMessage,
  type AppSettings,
  type OtpRecord,
} from "../_shared/otp.ts";
import { FetchResendClient, sendAndLogSystemEmail, type ResendClient } from "../_shared/resend.ts";
import { getSenderNumber } from "../_shared/whatsappNumbers.ts";

export interface AuthVerifyDeps {
  postgrestUrl: string;
  serviceRoleKey: string;
  /** Supabase auth base (same host as postgrest for self-hosted). */
  authUrl: string;
  settings: AppSettings | null;
  resend: ResendClient | null;
  gowa: GowaClient | null;
  fetchImpl: typeof fetch;
  now: Date;
}

export function buildDeps(overrides: Partial<AuthVerifyDeps> = {}): AuthVerifyDeps {
  const postgrestUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return {
    postgrestUrl,
    serviceRoleKey,
    authUrl: `${postgrestUrl.replace(/\/+$/, "")}/auth/v1`,
    settings: null,
    resend: Deno.env.get("RESEND_API_KEY")
      ? new FetchResendClient({
        apiKey: Deno.env.get("RESEND_API_KEY")!,
        from: Deno.env.get("RESEND_FROM") ?? "GamCiv <onboarding@resend.dev>",
      })
      : null,
    gowa: Deno.env.get("GOWA_BASE_URL") && Deno.env.get("GOWA_BASIC_AUTH")
      ? new FetchGowaClient({
        baseUrl: Deno.env.get("GOWA_BASE_URL")!,
        basicAuth: Deno.env.get("GOWA_BASIC_AUTH")!,
        deviceId: Deno.env.get("GOWA_DEVICE_ID"),
      })
      : null,
    fetchImpl: (url, init) => fetchWithRetry(fetch, url as string, init ?? {}),
    now: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Low-level PostgREST helpers (service role, plain fetch)
// ---------------------------------------------------------------------------

function authHeaders(deps: AuthVerifyDeps): Record<string, string> {
  return { Authorization: `Bearer ${deps.serviceRoleKey}`, apikey: deps.serviceRoleKey };
}

export async function restSelect(
  deps: AuthVerifyDeps,
  path: string,
): Promise<unknown> {
  const res = await deps.fetchImpl(`${deps.postgrestUrl.replace(/\/+$/, "")}${path}`, {
    headers: authHeaders(deps),
  });
  if (!res.ok) throw new Error(`PostgREST GET ${path} failed: HTTP ${restStatus(res.status)}`);
  return res.json();
}

/**
 * Mark unconsumed codes for this recipient as consumed, so the unique
 * active-code index allows a fresh one. A newly requested code supersedes
 * the previous one (also fixes resend-within-TTL, which 409'd forever).
 */
async function retireActiveOtps(
  deps: AuthVerifyDeps,
  recipient: string,
  purpose: "email_verify" | "phone_verify",
): Promise<void> {
  await restUpdate(
    deps,
    "otp_codes",
    `recipient=eq.${encodeURIComponent(recipient)}&purpose=eq.${purpose}` +
      `&consumed_at=is.null`,
    { consumed_at: deps.now.toISOString() },
  );
}

export async function restInsert(
  deps: AuthVerifyDeps,
  table: string,
  row: Record<string, unknown>,
): Promise<void> {
  const res = await deps.fetchImpl(
    `${deps.postgrestUrl.replace(/\/+$/, "")}/rest/v1/${table}`,
    {
      method: "POST",
      headers: {
        ...authHeaders(deps),
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(row),
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`PostgREST INSERT ${table} failed: HTTP ${res.status} ${detail.slice(0, 150)}`);
  }
}

export async function restUpdate(
  deps: AuthVerifyDeps,
  table: string,
  filter: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const res = await deps.fetchImpl(
    `${deps.postgrestUrl.replace(/\/+$/, "")}/rest/v1/${table}?${filter}`,
    {
      method: "PATCH",
      headers: {
        ...authHeaders(deps),
        "Prefer": "return=minimal",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(patch),
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`PostgREST PATCH ${table} failed: HTTP ${res.status} ${detail.slice(0, 150)}`);
  }
}

function restStatus(status: number): string {
  return String(status);
}

// ---------------------------------------------------------------------------
// User + profile context
// ---------------------------------------------------------------------------

export interface AuthUser {
  id: string;
  email: string | null;
  app_metadata: Record<string, unknown>;
}

/** Validate the user JWT with Supabase auth and return the user id/email. */
export async function requireUser(
  req: Request,
  deps: AuthVerifyDeps,
): Promise<AuthUser | null> {
  const header = req.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;
  try {
    const res = await deps.fetchImpl(`${deps.authUrl}/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: deps.serviceRoleKey },
    });
    if (!res.ok) return null;
    const body = await res.json() as { id?: string; email?: string; app_metadata?: Record<string, unknown> };
    if (!body.id) return null;
    return {
      id: body.id,
      email: typeof body.email === "string" ? body.email : null,
      app_metadata: body.app_metadata ?? {},
    };
  } catch {
    return null;
  }
}

interface ProfileRow {
  email: string | null;
  email_verified: boolean | null;
  phone_verified: boolean | null;
}

export async function loadProfile(
  deps: AuthVerifyDeps,
  userId: string,
): Promise<ProfileRow | null> {
  const rows = await restSelect(
    deps,
    `/rest/v1/profiles?user_id=eq.${userId}&select=email,email_verified,phone_verified`,
  ) as Array<ProfileRow>;
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// OTP storage + rate limits (public.otp_codes)
// ---------------------------------------------------------------------------

interface RateRow {
  attempts: number;
}

export async function countSendsLastHour(
  deps: AuthVerifyDeps,
  recipient: string,
): Promise<number> {
  const rows = await restSelect(
    deps,
    `/rest/v1/otp_codes?recipient=eq.${encodeURIComponent(recipient)}&created_at=gte.${
      new Date(deps.now.getTime() - 3600_000).toISOString()
    }&select=attempts`,
  ) as RateRow[];
  return rows.length;
}

export async function findActiveOtp(
  deps: AuthVerifyDeps,
  recipient: string,
  purpose: string,
): Promise<OtpRecord | null> {
  const rows = await restSelect(
    deps,
    `/rest/v1/otp_codes?recipient=eq.${encodeURIComponent(recipient)}&purpose=eq.${purpose}&order=created_at.desc&limit=1&select=id,code_hash,expires_at,attempts,consumed_at`,
  ) as OtpRecord[];
  return rows[0] ?? null;
}

/** Which profile already owns a verified phone (user_id), if any. */
export async function phoneOwner(
  deps: AuthVerifyDeps,
  phone: string,
): Promise<string | null> {
  try {
    const rows = await restSelect(
      deps,
      `/rest/v1/profiles?phone=eq.${encodeURIComponent(phone)}&phone_verified=eq.true&select=user_id`,
    ) as Array<{ user_id: string }>;
    return rows[0]?.user_id ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Endpoint implementations (exported for tests)
// ---------------------------------------------------------------------------

/** POST /send-email-otp */
export async function handleSendEmailOtp(
  user: AuthUser,
  deps: AuthVerifyDeps,
): Promise<Response> {
  const email = (user.email ?? "").toLowerCase();
  if (!isValidEmail(email)) {
    return errorResponse(400, "This account has no email address to verify.");
  }
  const sends = await countSendsLastHour(deps, email);
  if (sends >= OTP_MAX_SENDS_PER_HOUR) {
    return errorResponse(429, "Too many codes requested. Try again later this hour.");
  }
  const provider = user.app_metadata?.provider;
  if (provider && provider !== "email") {
    // Google-signed users cannot verify email again; send the welcome email.
    const settings = await getSettings(deps);
    const from = settings.resend_from_email ?? depsDefaultFrom();
    const content = buildEmailContent({ template: "google_welcome", to: email });
    const sent = deps.resend
      ? await sendAndLogSystemEmail(deps.resend, {
        postgrestUrl: deps.postgrestUrl,
        serviceRoleKey: deps.serviceRoleKey,
        fetchImpl: deps.fetchImpl,
      }, { ...content, to: email, template: "google_welcome", from })
      : { ok: false, error: "RESEND_API_KEY not set" };
    return jsonResponse({
      sent: sent.ok,
      mode: "welcome",
      message: sent.ok
        ? "Welcome email sent. There is no email verification for Google accounts."
        : "Email delivery is not configured. You can continue without it.",
    });
  }
  const code = generateOtp();
  const settings = await getSettings(deps);
  const from = settings.resend_from_email ?? depsDefaultFrom();
  const content = buildEmailContent({ template: "email_verify", to: email, code });
  await retireActiveOtps(deps, email, "email_verify");
  await restInsert(deps, "otp_codes", {
    recipient: email,
    purpose: "email_verify",
    code_hash: await hashOtp(code),
    expires_at: new Date(deps.now.getTime() + OTP_TTL_SECONDS * 1000).toISOString(),
    attempts: 0,
  });
  const sent = deps.resend
    ? await sendAndLogSystemEmail(deps.resend, {
      postgrestUrl: deps.postgrestUrl,
      serviceRoleKey: deps.serviceRoleKey,
      fetchImpl: deps.fetchImpl,
    }, { ...content, to: email, template: "email_verify", from })
    : { ok: false, error: "RESEND_API_KEY not set" };
  return jsonResponse({
    sent: sent.ok,
    mode: "otp",
    message: sent.ok
      ? `We sent a verification code to ${email}. It expires in 10 minutes.`
      : "Email delivery is not configured. The code could not be sent.",
  });
}

/** POST /verify-email-otp */
export async function handleVerifyEmailOtp(
  user: AuthUser,
  body: { code?: unknown },
  deps: AuthVerifyDeps,
): Promise<Response> {
  const email = (user.email ?? "").toLowerCase();
  if (typeof body.code !== "string" || !/^\d{6}$/.test(body.code)) {
    return errorResponse(400, "Enter the 6 digit code from your email.");
  }
  const record = await findActiveOtp(deps, email, "email_verify");
  if (!record || record.consumed_at) {
    return errorResponse(400, "No active code. Request a new one.");
  }
  if (new Date(record.expires_at).getTime() < deps.now.getTime()) {
    return errorResponse(400, "That code expired. Request a new one.");
  }
  if (record.attempts >= OTP_MAX_ATTEMPTS) {
    return errorResponse(429, "Too many wrong attempts. Request a new code.");
  }
  if (!timingSafeEqualStr(await hashOtp(body.code), record.code_hash)) {
    await restUpdate(deps, "otp_codes", `id=eq.${record.id}`, { attempts: record.attempts + 1 });
    return errorResponse(400, "That code is not correct. Check and try again.");
  }
  await restUpdate(deps, "otp_codes", `id=eq.${record.id}`, { consumed_at: deps.now.toISOString() });
  await restUpdate(deps, "profiles", `user_id=eq.${user.id}`, { email_verified: true });
  return jsonResponse({ verified: true, message: "Email verified. Next: confirm your phone." });
}

/** POST /send-phone-otp */
export async function handleSendPhoneOtp(
  user: AuthUser,
  body: { phone?: unknown },
  deps: AuthVerifyDeps,
): Promise<Response> {
  const phone = normalizePhoneOtp(typeof body.phone === "string" ? body.phone : "");
  if (!phone) {
    return errorResponse(400, "Enter a valid phone number, for example +220 7 123 456.");
  }
  // A phone number can only ever belong to the signed-in account: block the
  // case where it is already verified on another profile.
  const owner = await phoneOwner(deps, phone);
  if (owner && owner !== user.id) {
    return errorResponse(409, "That phone number is already verified on another account.");
  }
  const sends = await countSendsLastHour(deps, phone);
  if (sends >= OTP_MAX_SENDS_PER_HOUR) {
    return errorResponse(429, "Too many codes requested. Try again later this hour.");
  }
  if (!deps.gowa) {
    return errorResponse(503, "WhatsApp delivery is not configured. Try again later.");
  }
  // Sender number: the admin-managed registry (role=otp, linked) first, then
  // the legacy app_settings entry. Both are read via the service role.
  const sender = await getSenderNumber(deps.postgrestUrl, deps.serviceRoleKey, deps.fetchImpl);
  const code = generateOtp();
  await retireActiveOtps(deps, phone, "phone_verify");
  await restInsert(deps, "otp_codes", {
    recipient: phone,
    purpose: "phone_verify",
    code_hash: await hashOtp(code),
    expires_at: new Date(deps.now.getTime() + OTP_TTL_SECONDS * 1000).toISOString(),
    attempts: 0,
  });
  try {
    await deps.gowa.sendMessage(phone, whatsappOtpMessage(code, sender.sender));
  } catch (e) {
    // Distinguish an unroutable/invalid number from a generic delivery
    // failure, so the UI can tell the person what to fix (e.g. GOWA's
    // "no LID found for 3552116@..." means the number is incomplete).
    const msg = e instanceof Error ? e.message : String(e);
    if (/no lid|not valid|invalid|gowa send http 400/i.test(msg)) {
      return errorResponse(
        400,
        "Please enter your full phone number with country code, e.g. 220XXXXXXX",
      );
    }
    return errorResponse(502, "WhatsApp delivery failed. Try again in a few minutes.");
  }
  const hint = sender.sender
    ? `We sent a verification code from WhatsApp via +${sender.sender}`
    : "We sent a verification code from WhatsApp";
  return jsonResponse({ sent: true, message: hint });
}

/** POST /verify-phone-otp */
export async function handleVerifyPhoneOtp(
  user: AuthUser,
  body: { code?: unknown; phone?: unknown },
  deps: AuthVerifyDeps,
  ) : Promise<Response> {
  const phone = normalizePhoneOtp(typeof body.phone === "string" ? body.phone : "");
  if (typeof body.code !== "string" || !/^\d{6}$/.test(body.code) || !phone) {
    return errorResponse(400, "Enter the 6 digit code and your phone number.");
  }
  const record = await findActiveOtp(deps, phone, "phone_verify");
  if (!record || record.consumed_at) {
    return errorResponse(400, "No active code. Request a new one.");
  }
  if (new Date(record.expires_at).getTime() < deps.now.getTime()) {
    return errorResponse(400, "That code expired. Request a new one.");
  }
  if (record.attempts >= OTP_MAX_ATTEMPTS) {
    return errorResponse(429, "Too many wrong attempts. Request a new code.");
  }
  if (!timingSafeEqualStr(await hashOtp(body.code), record.code_hash)) {
    await restUpdate(deps, "otp_codes", `id=eq.${record.id}`, { attempts: record.attempts + 1 });
    return errorResponse(400, "That code is not correct. Check and try again.");
  }
  await restUpdate(deps, "otp_codes", `id=eq.${record.id}`, { consumed_at: deps.now.toISOString() });
  await restUpdate(deps, "profiles", `user_id=eq.${user.id}`, {
    phone,
    phone_verified: true,
  });
  return jsonResponse({ verified: true, message: "Phone verified. You are all set." });
}

// ---------------------------------------------------------------------------
// Settings cache + router
// ---------------------------------------------------------------------------

let cachedSettings: { at: number; value: AppSettings | null } | null = null;

async function getSettings(deps: AuthVerifyDeps): Promise<AppSettings> {
  if (deps.settings) return deps.settings;
  if (cachedSettings && deps.now.getTime() - cachedSettings.at < 60_000) {
    return cachedSettings.value ?? { whatsapp_sender_number: null, resend_from_email: null };
  }
  try {
    const value = await loadAppSettings(deps.postgrestUrl, deps.serviceRoleKey, deps.fetchImpl);
    cachedSettings = { at: deps.now.getTime(), value };
    return value;
  } catch {
    return { whatsapp_sender_number: null, resend_from_email: null };
  }
}

function depsDefaultFrom(): string {
  return Deno.env.get("RESEND_FROM") ?? "GamCiv <onboarding@resend.dev>";
}

const ALLOWED_PATHS = new Set([
  "/send-email-otp",
  "/verify-email-otp",
  "/send-phone-otp",
  "/verify-phone-otp",
]);

export async function handleRequest(
  req: Request,
  deps: AuthVerifyDeps,
): Promise<Response> {
  if (req.method !== "POST") {
    return errorResponse(405, "Use POST with a JSON body.");
  }
  const path = new URL(req.url).pathname.replace(/\/+$/, "").replace(/^.*auth-verify/, "");
  if (!ALLOWED_PATHS.has(path)) {
    return errorResponse(404, "Unknown auth-verify endpoint.");
  }
  const user = await requireUser(req, deps);
  if (!user) {
    return errorResponse(401, "Sign in first.");
  }
  const body = await readJson<Record<string, unknown>>(req) ?? {};
  try {
    if (path === "/send-email-otp") return await handleSendEmailOtp(user, deps);
    if (path === "/verify-email-otp") return await handleVerifyEmailOtp(user, body, deps);
    if (path === "/send-phone-otp") return await handleSendPhoneOtp(user, body, deps);
    return await handleVerifyPhoneOtp(user, body, deps);
  } catch (e) {
    console.error("auth-verify error:", e);
    return errorResponse(500, "Something went wrong. Try again.");
  }
}

// Entry point for the Supabase edge-runtime container: the function body above
// is exercised by tests via handleRequest(req, deps); this wires it to the
// server the same way the other functions do.
Deno.serve((req: Request) =>
  handleRequest(req, buildDeps()).catch((e) => {
    console.error("unhandled auth-verify error:", e);
    return errorResponse(500, "Something went wrong. Try again.");
  })
);

