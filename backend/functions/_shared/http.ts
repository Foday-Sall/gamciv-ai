/**
 * Small HTTP helpers: JSON responses with security headers and a
 * constant-time string comparison for webhook/auth secrets.
 */

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

export function jsonResponse(
  data: unknown,
  status = 200,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...SECURITY_HEADERS,
      ...extraHeaders,
    },
  });
}

export function errorResponse(status: number, message: string): Response {
  // Both keys carry the same text: `error` for programmatic callers,
  // `message` for browser clients that read one field (the auth screens).
  return jsonResponse({ error: message, message }, status);
}

/** Parse a request body as JSON; returns null on invalid/empty JSON. */
export async function readJson<T = Record<string, unknown>>(
  req: Request,
): Promise<T | null> {
  try {
    const text = await req.text();
    if (!text) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/**
 * Constant-time string equality (length-safe). Both inputs are padded to the
 * same length before comparing so short messages don't leak length info.
 */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  const max = Math.max(ea.length, eb.length);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < max; i++) {
    diff |= (ea[i % ea.length] ?? 0) ^ (eb[i % eb.length] ?? 0);
  }
  return diff === 0;
}

/**
 * True when a fetch failed at the network level (connection error, timeout
 * abort). These are transient and warrant one retry; HTTP error statuses are
 * real responses and must not trigger a retry.
 */
export function isNetworkError(e: unknown): boolean {
  if (e instanceof TypeError) return true;
  const name = e instanceof DOMException || e instanceof Error ? e.name : "";
  return name === "AbortError" || name === "TimeoutError";
}

/**
 * Fetch with a hard 15s timeout and one retry on network-level failures with
 * a fresh timeout. Guards the edge functions against the intermittently
 * hanging outbound fetch (the runtime only wall-clock-kills at ~25s).
 */
export async function fetchWithRetry(
  f: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await f(url, { ...init, signal: AbortSignal.timeout(15_000) });
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    return await f(url, { ...init, signal: AbortSignal.timeout(15_000) });
  }
}
