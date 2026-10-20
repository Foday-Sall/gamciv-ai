/**
 * Resend email client (plain fetch, like gowaClient) with system-only email
 * logging. Every send writes a row to public.email_log via PostgREST.
 *
 * Boss decision 2026-10-19: email_log holds SYSTEM emails only (OTP,
 * welcome, citizen lifecycle). Institute correspondence never passes
 * through this server and is never stored here.
 */
import { fetchWithRetry } from "./http.ts";

export interface ResendSendConfig {
  apiKey: string;
  /** From address, e.g. "GamCiv <onboarding@resend.dev>" (from app_settings). */
  from: string;
}

export interface ResendClient {
  send(opts: { to: string; subject: string; html: string; text: string; from?: string }): Promise<
    { ok: true; id: string | null } | { ok: false; error: string }
  >;
}

export class ResendError extends Error {}

export class FetchResendClient implements ResendClient {
  private readonly config: ResendSendConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(config: ResendSendConfig, fetchImpl: typeof fetch = fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  async send(
    opts: { to: string; subject: string; html: string; text: string; from?: string },
  ): Promise<{ ok: true; id: string | null } | { ok: false; error: string }> {
    try {
      const res = await fetchWithRetry(this.fetchImpl, "https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          from: opts.from ?? this.config.from,
          to: [opts.to],
          subject: opts.subject,
          html: opts.html,
          text: opts.text,
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        return { ok: false, error: `resend HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}` };
      }
      let body: { id?: string } | null = null;
      try {
        body = (await res.json()) as { id?: string };
      } catch {
        // non-JSON success body: treat as accepted, no id
      }
      return { ok: true, id: body?.id ?? null };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}

export interface EmailLogRow {
  to: string;
  subject: string;
  template: string;
  status: "sent" | "failed";
  error?: string | null;
}

export interface LogEmailDeps {
  postgrestUrl: string;
  serviceRoleKey: string;
  fetchImpl?: typeof fetch;
}

/** Insert a row into public.email_log (never throws: logging must not break the response). */
export async function logSystemEmail(
  deps: LogEmailDeps,
  row: EmailLogRow,
): Promise<boolean> {
  try {
    const res = await fetchWithRetry(
      deps.fetchImpl ?? fetch,
      `${deps.postgrestUrl.replace(/\/+$/, "")}/rest/v1/email_log`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${deps.serviceRoleKey}`,
          apikey: deps.serviceRoleKey,
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          to_email: row.to,
          subject: row.subject,
          template: row.template,
          status: row.status,
          error: row.error ?? null,
        }),
      },
    );
    return res.ok;
  } catch {
    // Fire-and-forget logging: a failed log insert must never break the send path.
    return false;
  }
}

/**
 * Fire-and-forget send + log. Resolves {ok, id?} of the send; logging runs
 * after the response is computed and never affects the caller.
 */
export async function sendAndLogSystemEmail(
  client: ResendClient,
  deps: LogEmailDeps,
  opts: { to: string; subject: string; html: string; text: string; template: string; from?: string },
): Promise<{ ok: boolean; id?: string | null; error?: string }> {
  const result = await client.send({
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
    from: opts.from,
  });
  await logSystemEmail(deps, {
    to: opts.to,
    subject: opts.subject,
    template: opts.template,
    status: result.ok ? "sent" : "failed",
    error: result.ok ? null : result.error,
  });
  return result.ok ? { ok: true, id: result.id } : { ok: false, error: result.error };
}

/** Shared HTML wrapper for system emails (English only, no # in subject). */
export function emailHtml(title: string, bodyLines: string[]): string {
  const body = bodyLines
    .map((l) =>
      `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#1f2a24;">${l}</p>`,
    )
    .join("");
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f5ef;font-family:Arial,Helvetica,sans-serif;">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e4e0d2;border-radius:10px;padding:28px;">
<h1 style="margin:0 0 16px;font-size:20px;color:#146c43;">${title}</h1>
${body}
<p style="margin:0;font-size:12px;color:#8a8570;">GamCiv: report it, route it, resolved.</p>
</div></body></html>`;
}
