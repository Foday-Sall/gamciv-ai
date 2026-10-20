/**
 * WhatsApp intake reply texts. Pure functions of their inputs only — no
 * environment reads, no I/O — so tests and callers can compose freely.
 * Exported shapes stay stable: these strings go to real citizens.
 */

export interface ProfileInfo {
  fullName: string | null;
  email: string | null;
}

/** Category slug → human-readable name (mirrors db/0009_seed.sql). */
const CATEGORY_NAMES: Record<string, string> = {
  waste_collection: "waste collection",
  illegal_dumping: "illegal dumping",
  water_supply: "water supply",
  electricity: "electricity",
  sewerage: "sewerage",
  local_roads: "local roads",
  streetlight: "street lighting",
  markets: "markets",
  national_roads: "national roads",
  traffic_signs: "traffic signs",
  pollution: "pollution",
  public_health: "public health",
  education: "education",
  crime_report: "crime report",
  police_misconduct: "police misconduct",
  corruption_report: "corruption report",
  abuse_of_power: "abuse of power",
  emergency_fire: "fire emergency",
  emergency_police: "police emergency",
  other: "report",
};

/** Human name for a category slug; unknown slugs fall back to "report". */
export function categoryHumanName(category: string | null): string {
  if (!category) return "report";
  return CATEGORY_NAMES[category] ?? "report";
}

/** Title-case a human name for the sentence ("water supply" → "Water Supply"). */
function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Noun phrase for a category in a sentence: known categories read as
 * "Water Supply complaint"; "other" or a missing classification reads as
 * just "report" ("your report has been sent to...").
 */
function nounPhrase(category: string | null): string {
  if (!category || category === "other") return "report";
  return `${titleCase(categoryHumanName(category))} complaint`;
}

/**
 * Confirmation for a successfully classified report.
 * "Hello <full_name>, your <category> complaint has been sent to
 * <institution> and will be checked. We will email you at <email> with your
 * tracking number <tracking_no>."
 */
export function classificationConfirmedText(
  profile: ProfileInfo,
  category: string | null,
  institution: string,
  trackingNo: string,
): string {
  const name = profile.fullName?.trim() || "there";
  const email = profile.email?.trim() || "your registered email address";
  return (
    `Hello ${name}, your ${nounPhrase(category)} has been sent to ${institution} and will be checked. ` +
    `We will email you at ${email} with your tracking number ${trackingNo}.`
  );
}

/**
 * Confirmation when the classifier was not confident: the report is being
 * reviewed by the team rather than routed to an institution.
 * "... is being reviewed by our team. We will email you at <email>."
 */
export function lowConfidenceText(
  profile: ProfileInfo,
  category: string | null,
  trackingNo: string,
): string {
  const name = profile.fullName?.trim() || "there";
  const email = profile.email?.trim() || "your registered email address";
  return (
    `Hello ${name}, your ${nounPhrase(category)} (${trackingNo}) is being reviewed by our team. ` +
    `We will email you at ${email}.`
  );
}

/** Reply when no verified account matches the sender's phone number. */
export function notRegisteredText(name: string | null): string {
  const greeting = name?.trim() ? `Hello ${name.trim()}, ` : "Hello, ";
  return (
    `${greeting}I'm GamCiv, your civic assistant. To report a problem here, you first need ` +
    "a GamCiv account. " +
    "Please sign up at https://gamciv.pocketsoftware.dev/app with your email or Google account. " +
    "Then, in the app, verify your phone number using the WhatsApp code we send you. " +
    "Once your phone is verified you can report water, power, roads, waste and safety issues " +
    "right here and get a tracking number."
  );
}

/** Reply when a voice note could not be transcribed. */
export function transcriptionFailedText(): string {
  return (
    "Sorry, I couldn't hear that voice note clearly. " +
    "Please type your report as a message instead — for example: no water in Bakoteh."
  );
}

/** Reply when the message could not be classified at all — never stay silent. */
export function classificationFailedText(): string {
  return (
    "Sorry, I didn't understand that. Send a short description of the problem, " +
    "for example: no water in Bakoteh."
  );
}

/**
 * A bare greeting / first-contact ping ("hi", "hello", "good morning...") with
 * no report content. Anything that carries more words is treated as a report,
 * so "no water in Bakoteh since morning" is never swallowed.
 */
export function looksLikeGreeting(body: string): boolean {
  const t = body.trim().toLowerCase().replace(/[!,.?:]+$/, "");
  return /^(hi+|hello+|hey+|good (morning|afternoon|evening)|start|help|menu|salut|asalam(ual)?ekum|assalam(ual)?ekum)$/
    .test(t);
}

/** Intro text for a registered user who just says hi. */
export function registeredGreetingText(name: string | null): string {
  const greeting = name?.trim() ? `Hello ${name.trim()}` : "Hello";
  return (
    `${greeting}! I'm GamCiv, your civic assistant. ` +
    "To report a public problem (water, power, roads, waste, safety), just send the details here. " +
    "Include a photo, a voice note or your location if you can — I'll route it to the right " +
    "authority and reply with a tracking number."
  );
}
