/**
 * OTP helper library for the auth-verify edge function. Pure functions +
 * injectable fetch so unit tests run with zero network.
 *
 * Security model:
 *  - 6-digit codes, hashed with SHA-256 before storage (no salt: a 6-digit
 *    space is small regardless, the rolling rate limit is the real defense).
 *  - Single-use, 10 minute expiry, max 5 verify attempts, 3 sends per
 *    recipient per rolling hour — enforced in the auth-verify endpoints.
 */
import { emailHtml } from "./resend.ts";

export interface OtpRecord {
  id: string;
  code_hash: string;
  expires_at: string;
  attempts: number;
  consumed_at: string | null;
}

/** Number of seconds an OTP is valid for. */
export const OTP_TTL_SECONDS = 900;  // 15 minutes
/** Verify attempts allowed per code. */
export const OTP_MAX_ATTEMPTS = 5;
/** Sends allowed per recipient per rolling hour. */
export const OTP_MAX_SENDS_PER_HOUR = 3;

/** Generate a cryptographically random 6-digit code (100000-999999). */
export function generateOtp(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(100000 + (buf[0] % 900000));
}

/** SHA-256 hex digest of the code (the only form ever stored). */
export async function hashOtp(code: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Basic email shape check used before anything is stored or sent. */
export function isValidEmail(email: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

/**
 * Normalize a phone to bare international digits (like gowaClient).
 * Accepts +220..., 00220..., spaces/dashes. Completes bare 7-digit local
 * numbers with Gambia's country code (220) and strips the local "0" trunk
 * prefix, so a user typing "3552116" or "03552116" gets "2203552116".
 */
export function normalizePhoneOtp(raw: string): string | null {
  let digits = raw.replace(/[^\d]/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (/^0\d+$/.test(digits)) digits = digits.replace(/^0+/, "");
  if (digits.length === 7) digits = `220${digits}`;
  if (!/^220\d{7}$/.test(digits) && !/^\d{7,15}$/.test(digits)) return null;
  return digits;
}

/** The reminder to show a user while they wait for the WhatsApp code. */
export function whatsappSenderHint(senderNumber: string | null): string {
  const digits = (senderNumber ?? "").replace(/[^\d]/g, "");
  if (!digits) return "WhatsApp";
  const plus = `+${digits}`;
  if (digits.length > 6) return `WhatsApp via ${plus.slice(0, digits.length - 4)}XXXX`;
  return `WhatsApp via ${plus}`;
}

/** The text of the WhatsApp verification message (mentions the sender number). */
export function whatsappOtpMessage(code: string, senderNumber: string | null): string {
  return `Your GamCiv verification code is ${code}. It expires in 10 minutes. Message sent from ${
    whatsappSenderHint(senderNumber)
  }.`;
}

export interface AppSettings {
  whatsapp_sender_number: string | null;
  resend_from_email: string | null;
}

/**
 * Read the admin-configured senders from public.app_settings. The table is
 * key/value (key text primary key, value jsonb, updated_at) so the admin
 * panel can edit entries without a migration.
 */
export async function loadAppSettings(
  postgrestUrl: string,
  serviceRoleKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AppSettings> {
  const res = await fetchImpl(
    `${postgrestUrl.replace(/\/+$/, "")}/rest/v1/app_settings?select=key,value`,
    {
      headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey },
    },
  );
  if (!res.ok) throw new Error(`app_settings read failed: HTTP ${res.status}`);
  const rows = await res.json() as Array<{ key: string; value: unknown }>;
  const pick = (name: string): string | null => {
    const row = rows.find((r) => r.key === name);
    const v = row?.value;
    // app_settings.value is JSONB: the WhatsApp sender was saved as a bare
    // number (2205111924), not a string, and a strict typeof-string check
    // silently returned null — so the OTP send lost its sender hint. Accept
    // scalar JSON values and coerce to the trimmed string form.
    if (typeof v === "string") {
      return v.trim().length > 0 ? v.trim() : null;
    }
    if (typeof v === "number") {
      return String(v);
    }
    if (typeof v === "boolean") {
      return String(v);
    }
    return null;
  };
  return {
    whatsapp_sender_number: pick("whatsapp_sender_number"),
    resend_from_email: pick("resend_from_email"),
  };
}

/** What the email looks like for a given system template. */
export type SystemEmailTemplate =
  | "email_verify"
  | "google_welcome"
  | "complaint_submitted"
  | "complaint_in_progress"
  | "complaint_resolved";

export interface BuildEmailArgs {
  template: SystemEmailTemplate;
  to: string;
  code?: string;
  trackingNo?: string;
  institutionName?: string;
}

/** Build subject/html/text for every system email the platform sends. */
export function buildEmailContent(args: BuildEmailArgs): {
  subject: string;
  html: string;
  text: string;
} {
  if (args.template === "email_verify") {
    return {
      subject: `Your GamCiv verification code is ${args.code ?? ""}`,
      html: emailHtml(
        "Verify your email",
        [
          `Your verification code is <strong>${args.code ?? ""}</strong>.`,
          "It expires in 10 minutes and can be used once.",
          `If you did not request this code, ignore this message. Sent to ${args.to}.`,
        ],
      ),
      text: `Your GamCiv verification code is ${args.code ?? ""}. It expires in 10 minutes and can be used once.`,
    };
  }
  if (args.template === "google_welcome") {
    return {
      subject: "Welcome to GamCiv",
      html: emailHtml(
        "Welcome to GamCiv",
        [
          "Your account was created with Google, so there is nothing to verify by email.",
          "Next step: add your phone number and confirm it with the WhatsApp code we send you.",
          "You can then report issues and follow each one until it is resolved.",
        ],
      ),
      text:
        "Welcome to GamCiv. Your account was created with Google. Next step: add your phone number and confirm it with the WhatsApp code we send you.",
    };
  }
  if (args.template === "complaint_submitted") {
    return {
      subject: `Your report ${args.trackingNo ?? ""} has been sent to ${args.institutionName ?? "the responsible institution"}`,
      html: emailHtml(
        "Report received",
        [
          `Your report <strong>${args.trackingNo ?? ""}</strong> has been sent to ${args.institutionName ?? "the responsible institution"}.`,
          "We will email you when its status changes.",
        ],
      ),
      text: `Your report ${args.trackingNo ?? ""} has been sent to ${args.institutionName ?? "the responsible institution"}.`,
    };
  }
  if (args.template === "complaint_in_progress") {
    return {
      subject: `Your report ${args.trackingNo ?? ""} is being resolved`,
      html: emailHtml(
        "Report update",
        [
          `Your report <strong>${args.trackingNo ?? ""}</strong> is now being worked on.`,
          "We will email you again once it is resolved.",
        ],
      ),
      text: `Your report ${args.trackingNo ?? ""} is being resolved.`,
    };
  }
  return {
    subject: `Your report ${args.trackingNo ?? ""} has been resolved`,
    html: emailHtml(
      "Report resolved",
      [
        `Your report <strong>${args.trackingNo ?? ""}</strong> has been resolved. Thank you for helping improve public services.`,
        "You can confirm the resolution in the app or request a reopening if the problem persists.",
      ],
    ),
    text: `Your report ${args.trackingNo ?? ""} has been resolved. Thank you for helping improve public services.`,
  };
}
