/**
 * Telegram intake reply texts. Delegates to the shared intake texts so the
 * wording matches the WhatsApp channel exactly; the linking-specific replies
 * (Telegram asks for the registered phone number) live here.
 * Pure functions of their inputs only — no environment reads, no I/O.
 */
import {
  categoryHumanName,
  classificationConfirmedText,
  lowConfidenceText,
} from "./intakeTexts.ts";

/** Web app signup URL shown to new users during Telegram linking. */
export const APP_URL = "https://gamciv.pocketsoftware.dev/app";

/** Inputs for the personalized confirmation (profile row + submit result). */
export interface TelegramConfirmationInput {
  fullName: string | null;
  email: string | null;
  categoryHint: string | null;
  institutionLabel: string;
  trackingNo: string;
  confidence: number | null;
}

/**
 * Personalized confirmation, same sentences as the WhatsApp channel:
 * "Hello <name>, your <category> complaint has been sent to <Institution> and
 * will be checked. We will email you at <email> with your tracking number
 * <tracking_no>." Below the 0.7 confidence gate the sentence becomes
 * "... is being reviewed by our team".
 */
export function personalizedConfirmationText(
  input: TelegramConfirmationInput,
): string {
  const profile = { fullName: input.fullName, email: input.email };
  const lowConfidence = input.confidence !== null && input.confidence < 0.7;
  if (lowConfidence) {
    return lowConfidenceText(profile, input.categoryHint, input.trackingNo);
  }
  return classificationConfirmedText(
    profile,
    input.categoryHint,
    input.institutionLabel,
    input.trackingNo,
  );
}

/** Human label for a category slug (shared map; falls back to "report"). */
export function categoryLabel(slug: string | null): string {
  return categoryHumanName(slug);
}

/** Instructions an unlinked chat receives instead of filing a complaint. */
export function telegramLinkInstructions(): string {
  return (
    "Welcome to GamCiv! To report problems here, first link your account: " +
    "send me the phone number you registered with (for example +220 7 123 456). " +
    `Don't have an account yet? Sign up at ${APP_URL} first, then send your number here.`
  );
}

/** Reply when the phone number was found in the database. */
export function telegramLinkedText(): string {
  return "Linked! You can now report here anytime.";
}

/** Reply when the phone number is not registered/verified. */
export function telegramNotRegisteredText(): string {
  return (
    "That number isn't registered yet. Sign up at " + APP_URL +
    " first (and verify your phone), then send the number here again."
  );
}

/** Reply when the message cannot be parsed as a phone number. */
export function telegramUnrecognizedText(): string {
  return (
    "I didn't recognize that. To link your account, send the phone number you registered with " +
    `(for example +220 7 123 456). Sign up at ${APP_URL} if you don't have an account yet.`
  );
}
