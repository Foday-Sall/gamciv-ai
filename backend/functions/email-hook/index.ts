/**
 * GamCiv AI — GoTrue Send Email hook.
 *
 * GoTrue calls this hook INSTEAD of its built-in SMTP sender for every auth
 * email (signup confirmation, magic link, recovery, email change). Boss
 * decision 2026-10-19: email sending is native GoTrue via this hook; the
 * custom OTP email logic in auth-verify stays out of the signup flow.
 *
 * Request (POST, standardwebhooks-signed):
 *   {
 *     "user":     { "email": "...", ... },
 *     "email_data": {
 *       "token": "<6-digit code>",
 *       "token_hash": "...",
 *       "email_action_type": "signup" | "recovery" | "invite" | "magiclink" | "email_change",
 *       "redirect_to": "...",
 *       "site_url": "..."
 *     }
 *   }
 *
 * We verify the standardwebhooks signature (env SEND_EMAIL_HOOK_SECRET,
 * "v1,whsec_..." format), render the 6-digit code with the shared email
 * templates, send via Resend REST, and log to public.email_log. A signup
 * also gets the welcome email. Always answers 200 {} on accepted requests
 * (non-2xx makes GoTrue fail the whole signup).
 */
import { Webhook } from "npm:standardwebhooks@1.0.0";
import { jsonResponse } from "../_shared/http.ts";
import { buildEmailContent } from "../_shared/otp.ts";
import {
  FetchResendClient,
  emailHtml,
  logSystemEmail,
  type ResendClient,
} from "../_shared/resend.ts";

interface HookPayload {
  user?: { email?: string | null };
  email_data?: {
    token?: string;
    token_hash?: string;
    email_action_type?: string;
    redirect_to?: string;
    site_url?: string;
  };
}

export interface EmailHookDeps {
  secret: string;
  resend: ResendClient | null;
  logDeps: { postgrestUrl: string; serviceRoleKey: string };
  fetchImpl: typeof fetch;
  /** Default From header for every email this hook sends. */
  from: string;
}

export function buildDeps(): EmailHookDeps {
  const postgrestUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return {
    secret: Deno.env.get("SEND_EMAIL_HOOK_SECRET") ?? "",
    resend: Deno.env.get("RESEND_API_KEY")
      ? new FetchResendClient({
        apiKey: Deno.env.get("RESEND_API_KEY")!,
        from: Deno.env.get("RESEND_FROM") ?? "GamCiv <onboarding@resend.dev>",
      })
      : null,
    logDeps: { postgrestUrl, serviceRoleKey },
    fetchImpl: fetch,
    from: Deno.env.get("RESEND_FROM") ?? "GamCiv <onboarding@resend.dev>",
  };
}

/** Map a GoTrue email_action_type to our template name and subject lines. */
export function templateFor(actionType: string | undefined): {
  template: string;
  title: string;
  lead: string;
  subject: string;
} {
  if (actionType === "recovery") {
    return {
      template: "email_recovery",
      title: "Reset your password",
      lead: "Use this code to reset your password.",
      subject: "Your GamCiv password reset code",
    };
  }
  if (actionType === "invite") {
    return {
      template: "email_invite",
      title: "You are invited to GamCiv",
      lead: "Use this code to accept your invitation.",
      subject: "Your GamCiv invitation code",
    };
  }
  if (actionType === "email_change") {
    return {
      template: "email_change",
      title: "Confirm your new email",
      lead: "Use this code to confirm your new email address.",
      subject: "Your GamCiv email change code",
    };
  }
  if (actionType === "magiclink") {
    return {
      template: "email_magiclink",
      title: "Your sign-in code",
      lead: "Use this code to sign in.",
      subject: "Your GamCiv sign-in code",
    };
  }
  return {
    template: "email_verify",
    title: "Verify your email",
    lead: "Use this code to confirm your email address.",
    subject: "Your GamCiv verification code is",
  };
}

/** Render subject/body for a hook email. Exported for tests. */
export function renderHookEmail(
  actionType: string | undefined,
  token: string,
  to: string,
): { template: string; subject: string; html: string; text: string } {
  const t = templateFor(actionType);
  const code = token;
  const html = emailHtml(t.title, [
    `${t.lead} Your code is <strong>${code}</strong>.`,
    "It expires soon and can be used once.",
    `If you did not request this code, ignore this message. Sent to ${to}.`,
  ]);
  const text = `${t.title}. ${t.lead.replace("Use this code", "Code")}: ${code}. It expires soon and can be used once.`;
  return { template: t.template, subject: `${t.subject} ${code}`, html, text };
}

export async function handleHookRequest(
  req: Request,
  deps: EmailHookDeps,
): Promise<Response> {
  if (req.method !== "POST") {
    return jsonResponse({}, 405);
  }
  const webhookId = req.headers.get("webhook-id") ?? "";
  const timestamp = req.headers.get("webhook-timestamp") ?? "";
  const signature = req.headers.get("webhook-signature") ?? "";
  const payload = await req.text();

  if (deps.secret) {
    // The env format is "v1,whsec_..." (GoTrue's Go lib parses the version
    // prefix); the JS lib doesn't, so strip it before constructing.
    const wh = new Webhook(deps.secret.replace(/^v1,/, ""));
    try {
      // Default tolerance (5 min) is fine: GoTrue signs with the send time.
      // The JS lib expects the full standard header names here.
      wh.verify(payload, {
        "webhook-id": webhookId,
        "webhook-timestamp": timestamp,
        "webhook-signature": signature,
      });
    } catch (e) {
      console.error("email-hook: invalid webhook signature:", e);
      return jsonResponse({}, 401);
    }
  }

  let body: HookPayload;
  try {
    body = JSON.parse(payload) as HookPayload;
  } catch {
    return jsonResponse({}, 400);
  }
  const to = (body.user?.email ?? "").toLowerCase();
  const token = body.email_data?.token ?? "";
  const actionType = body.email_data?.email_action_type;
  if (!to || !token) {
    return jsonResponse({}, 400);
  }

  const rendered = renderHookEmail(actionType, token, to);
  const from = deps.from;

  // Fire the auth email and await it: GoTrue retries on non-2xx, and a
  // dropped send would leave the person without their code.
  const sent = deps.resend
    ? await deps.resend.send({
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      from,
    })
    : { ok: false as const, error: "RESEND_API_KEY not set" };
  await logSystemEmail(deps.logDeps, {
    to,
    subject: rendered.subject,
    template: rendered.template,
    status: sent.ok ? "sent" : "failed",
    error: sent.ok ? null : sent.error,
  });

  // Boss decision: a signup also gets the welcome email.
  if (actionType === "signup" && sent.ok) {
    const content = buildEmailContent({ template: "google_welcome", to });
    const welcome = deps.resend
      ? await deps.resend.send({
        to,
        subject: content.subject,
        html: content.html,
        text: content.text,
        from,
      })
      : { ok: false as const, error: "RESEND_API_KEY not set" };
    await logSystemEmail(deps.logDeps, {
      to,
      subject: content.subject,
      template: "welcome",
      status: welcome.ok ? "sent" : "failed",
      error: welcome.ok ? null : welcome.error,
    });
  }

  // 2xx tells GoTrue the hook handled the send. Errors are already logged.
  return jsonResponse({});
}

// `EdgeRuntime` is a global provided only inside the Supabase edge-runtime
// container (the dispatcher spawns user workers); declare it so `deno check`
// passes outside that container.
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

if (typeof EdgeRuntime !== "undefined") {
  Deno.serve((req: Request) =>
    handleHookRequest(req, buildDeps()).catch((e) => {
      console.error("unhandled email-hook error:", e);
      return jsonResponse({}, 500);
    })
  );
}
