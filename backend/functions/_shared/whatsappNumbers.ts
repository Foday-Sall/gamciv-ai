/**
 * WhatsApp sender number resolution.
 *
 * The admin panel (admin-whatsapp edge function) manages a registry of
 * WhatsApp numbers with roles: one number sends OTP verification codes, one
 * handles user chat. This helper resolves the number that should send OTPs:
 *
 *   1. public.whatsapp_numbers WHERE role='otp' AND status='linked'
 *      (admin-managed, current)
 *   2. app_settings 'whatsapp_sender_number' (legacy fallback)
 *   3. null (caller decides: skip the sender mention / refuse)
 *
 * Service role required: the table has RLS (admins only) so anonymous reads
 * return zero rows; edge functions use the service key.
 */
import { loadAppSettings } from "./otp.ts";

export interface SenderNumberResult {
  /** The resolved sender number (bare digits) or null. */
  sender: string | null;
  /** Where it came from: the admin registry or the legacy app setting. */
  source: "registry" | "app_settings" | "none";
}

export async function getSenderNumber(
  postgrestUrl: string,
  serviceRoleKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SenderNumberResult> {
  try {
    const res = await fetchImpl(
      `${postgrestUrl.replace(/\/+$/, "")}/rest/v1/whatsapp_numbers` +
        `?role=eq.otp&status=eq.linked&select=number&order=created_at.desc&limit=1`,
      {
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          apikey: serviceRoleKey,
        },
      },
    );
    if (res.ok) {
      const rows = (await res.json()) as Array<{ number: string }>;
      const number = rows[0]?.number;
      if (number && number.trim().length > 0) {
        return { sender: number.trim(), source: "registry" };
      }
    }
    // Non-OK (table missing yet / HTTP error) falls through to the legacy
    // setting so OTP delivery keeps working during migrations.
  } catch {
    // Network error: fall through to the legacy setting.
  }

  try {
    const settings = await loadAppSettings(postgrestUrl, serviceRoleKey, fetchImpl);
    if (settings.whatsapp_sender_number) {
      return { sender: settings.whatsapp_sender_number, source: "app_settings" };
    }
  } catch {
    // No fallback available either.
  }
  return { sender: null, source: "none" };
}
