/**
 * GamCiv AI — welcome-email edge function.
 *
 * Sends the ONE welcome email for first-time Google (OAuth) signups.
 *
 * Why this exists: GoTrue's send-email hook (functions/email-hook) only
 * fires for email auth types (signup confirmation, magic link, recovery,
 * ...). A first-time Google signup never passes through it, so those users
 * got no welcome. The DB trigger fn_dispatch_welcome_email (0016_dispatch)
 * fires at COMMIT of the GoTrue signup transaction (deferred constraint
 * trigger) and calls this function via pg_net.
 *
 * Boss spec 2026-10-20:
 *   - Google users: welcome email only (no code — nothing to verify).
 *   - Email signups: welcome + OTP code — sent by the GoTrue email hook,
 *     which this function does NOT touch.
 *
 * Contract:
 *   POST { user_id: "<uuid>", email: "..." }   (from public.fn_dispatch_welcome_email)
 *   200 {} on accepted; 4xx/5xx on reject (a reject only means "no email
 *   this attempt": the guard row already exists, so the trigger will never
 *   re-send for the same user/email).
 *
 * The function is deliberately dumb: it re-checks the guard table
 * (welcome_email_log) and email_log for this email so a replayed HTTP call
 * can never double-send, renders the shared google_welcome template,
 * sends via Resend and logs to public.email_log (template "welcome").
 */
import { jsonResponse } from "../_shared/http.ts";
import { buildEmailContent } from "../_shared/otp.ts";
import {
  FetchResendClient,
  logSystemEmail,
  type LogEmailDeps,
  type ResendClient,
} from "../_shared/resend.ts";

export interface WelcomeEmailRequest {
  user_id?: string;
  email?: string;
}

export interface WelcomeEmailDeps {
  postgrestUrl: string;
  serviceRoleKey: string;
  resend: ResendClient | null;
  /** Sender for every email this function sends. */
  from: string;
  fetchImpl: typeof fetch;
  now: Date;
}

export function buildDeps(): WelcomeEmailDeps {
  const postgrestUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return {
    postgrestUrl,
    serviceRoleKey,
    resend: Deno.env.get("RESEND_API_KEY")
      ? new FetchResendClient({
        apiKey: Deno.env.get("RESEND_API_KEY")!,
        from: Deno.env.get("RESEND_FROM") ?? "GamCiv <onboarding@resend.dev>",
      })
      : null,
    from: Deno.env.get("RESEND_FROM") ?? "GamCiv <onboarding@resend.dev>",
    fetchImpl: fetch,
    now: new Date(),
  };
}

/** True when the address looks like an email (guard against garbage). */
export function looksLikeEmail(raw: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(raw);
}

/** How many trigger-guard rows already exist for this user/email. */
export async function guardRowCount(
  deps: WelcomeEmailDeps,
  userId: string,
  email: string,
): Promise<number> {
  const res = await deps.fetchImpl(
    `${deps.postgrestUrl.replace(/\/+$/, "")}/rest/v1/welcome_email_log` +
      `?or=(user_id.eq.${userId},email.eq.${encodeURIComponent(email)})` +
      `&select=user_id`,
    {
      headers: {
        Authorization: `Bearer ${deps.serviceRoleKey}`,
        apikey: deps.serviceRoleKey,
      },
    },
  );
  if (!res.ok) return 0; // fail open: log check must not block the send
  const rows = (await res.json()) as Array<{ user_id: string }>;
  return rows.length;
}

/** True when a welcome email already reached this address (email_log). */
export async function welcomeAlreadyLogged(
  deps: WelcomeEmailDeps,
  email: string,
): Promise<boolean> {
  const res = await deps.fetchImpl(
    `${deps.postgrestUrl.replace(/\/+$/, "")}/rest/v1/email_log` +
      `?to_email=eq.${encodeURIComponent(email)}` +
      `&template=eq.welcome&select=to_email`,
    {
      headers: {
        Authorization: `Bearer ${deps.serviceRoleKey}`,
        apikey: deps.serviceRoleKey,
      },
    },
  );
  if (!res.ok) return false; // fail open: log check must not block the send
  const rows = (await res.json()) as Array<{ to_email: string }>;
  return rows.length > 0;
}

export async function handleWelcomeEmail(
  body: WelcomeEmailRequest,
  deps: WelcomeEmailDeps,
): Promise<Response> {
  const userId = typeof body.user_id === "string" ? body.user_id : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!userId || !looksLikeEmail(email)) {
    return jsonResponse({}, 400);
  }

  // Double-send guard (defense in depth): the trigger already checked, but
  // a replayed/retried HTTP call must never send twice.
  const [guards, logged] = await Promise.all([
    guardRowCount(deps, userId, email),
    welcomeAlreadyLogged(deps, email),
  ]);
  if (guards > 0 || logged) {
    return jsonResponse({});
  }

  const content = buildEmailContent({ template: "google_welcome", to: email });
  const sent = deps.resend
    ? await deps.resend.send({
      to: email,
      subject: content.subject,
      html: content.html,
      text: content.text,
      from: deps.from,
    })
    : { ok: false as const, error: "RESEND_API_KEY not set" };
  const logDeps: LogEmailDeps = {
    postgrestUrl: deps.postgrestUrl,
    serviceRoleKey: deps.serviceRoleKey,
    fetchImpl: deps.fetchImpl,
  };
  await logSystemEmail(logDeps, {
    to: email,
    subject: content.subject,
    template: "welcome",
    status: sent.ok ? "sent" : "failed",
    error: sent.ok ? null : sent.error,
  });

  return jsonResponse({});
}

// `EdgeRuntime` is a global provided only inside the Supabase edge-runtime
// container; declare it so `deno check` passes outside that container.
declare const EdgeRuntime: {
  userWorkers: {
    create(opts: {
      servicePath: string;
      memoryLimitMb: number;
      workerTimeoutMs: number;
      noModuleCache: boolean;
      importMapPath: string | null;
      envVars: [string, string][];
    }): Promise<{ fetch(req: Request): Promise<Response> }>;
  };
};

// Entry point for the Supabase edge-runtime container: exercised by tests
// via handleWelcomeEmail; wires to the server the same way as other functions.
if (typeof EdgeRuntime !== "undefined") {
  Deno.serve((req: Request) =>
    (async () => {
      const body = await req.json().catch(() => ({}));
      return handleWelcomeEmail(body as WelcomeEmailRequest, buildDeps());
    })().catch((e) => {
      console.error("unhandled welcome-email error:", e);
      return jsonResponse({}, 500);
    })
  );
}
