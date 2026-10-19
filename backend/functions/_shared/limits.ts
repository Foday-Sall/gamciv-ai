/**
 * Input size limits shared by the webhook intake functions.
 *
 * Two layers of defence (defense-in-depth):
 *  1. Per-request body cap — a malicious/oversized webhook POST is rejected
 *     with 413 before any JSON parsing or DB work happens.
 *  2. Per-field truncation — individual fields are capped before the RPC call
 *     so no unbounded text can reach the database (the SQL side re-validates;
 *     see 0010b_wrapper.sql).
 */

/** Max webhook body size accepted from a provider (512 KB). */
export const MAX_BODY_BYTES = 512 * 1024;

/** Per-field limits enforced before the submit RPC call. */
export const FIELD_LIMITS = {
  title: 200,
  description: 2000,
  citizenName: 100,
  citizenPhone: 20,
  externalId: 100,
  photoUrl: 500,
  categoryHint: 100,
} as const;

/** True when the request body is larger than MAX_BODY_BYTES. */
export function bodyTooLarge(bytes: number): boolean {
  return bytes > MAX_BODY_BYTES;
}

/** Truncate a string to len code points at the value level (no error). */
export function truncate(value: string, len: number): string {
  return value.length > len ? value.slice(0, len) : value;
}

/**
 * Clean + cap a field: string inputs are trimmed and truncated to limit;
 * non-string inputs (nulls, numbers) pass through unchanged.
 */
export function bounded(
  value: string | null,
  len: number,
  opts: { trim?: boolean } = {},
): string | null {
  if (typeof value !== "string") return null;
  let v = value;
  if (opts.trim !== false) v = v.trim();
  return truncate(v, len);
}
