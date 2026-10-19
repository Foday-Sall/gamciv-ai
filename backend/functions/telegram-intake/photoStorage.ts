/**
 * Photo storage for telegram-intake: pull a provider photo into the private
 * `complaint-photos` bucket and return a *token-free* reference that is safe
 * to store in complaints.photo_url.
 *
 * Why: Telegram file URLs embed the bot token
 * (`{apiBase}/file/bot<TOKEN>/<path>`) and expire after ~1h — storing them
 * would leak a live credential into the database. The storage reference we
 * store instead is just `bucket/object-path` (or the bare Telegram file path
 * with no token when the upload fails) — nothing secret, nothing expiring.
 */
import { PHOTO_BUCKET, PHOTO_PREFIX } from "./telegram.ts";

/** Size guard for a downloaded photo (10 MB, generous vs Telegram's 20MB API limit). */
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

export interface PhotoStorageConfig {
  /** Supabase base URL, e.g. http://kong:8000 (no trailing slash). */
  supabaseUrl: string;
  /** service_role key (server-side only; never logged, never stored). */
  serviceRoleKey: string;
}

export interface PhotoReference {
  /**
   * Value for complaints.photo_url — token-free by construction.
   * Empty string means "could not produce a safe reference" (caller stores null).
   */
  ref: string;
  /** true when the bytes were actually uploaded to the bucket. */
  uploaded: boolean;
}

/**
 * Determine whether a stored photo_url looks like a legacy token-bearing URL.
 * Used by tests and by future migration/scrub jobs.
 */
export function looksLikeTokenUrl(url: string | null): boolean {
  return typeof url === "string" && /\/file\/bot[^/]+@?[A-Za-z0-9_-]{20,}/.test(url);
}

/**
 * Download the bytes from the (token-bearing, short-lived) provider URL and
 * upload them to the private bucket. The URL itself is consumed in-process
 * and never persisted.
 */
export async function storePhotoFromUrl(
  config: PhotoStorageConfig,
  providerUrl: string,
  objectPath: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PhotoReference> {
  try {
    const res = await fetchImpl(providerUrl, {
      method: "GET",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.error("photo download failed:", res.status);
      return fallbackRef(objectPath, `download HTTP ${res.status}`);
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength === 0) {
      return fallbackRef(objectPath, "download returned empty body");
    }
    if (bytes.byteLength > MAX_PHOTO_BYTES) {
      return fallbackRef(objectPath, "photo exceeds size limit");
    }

    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    const up = await fetchImpl(
      `${config.supabaseUrl}/storage/v1/object/${PHOTO_BUCKET}/${objectPath}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.serviceRoleKey}`,
          apikey: config.serviceRoleKey,
          "Content-Type": contentType,
        },
        body: bytes,
      },
    );
    if (!up.ok) {
      const detail = await up.text().catch(() => "");
      console.error("photo upload failed:", up.status, detail.slice(0, 200));
      return fallbackRef(objectPath, `upload HTTP ${up.status}`);
    }
    return { ref: bucketRef(objectPath), uploaded: true };
  } catch (e) {
    console.error("photo storage failed:", e);
    return fallbackRef(objectPath, e instanceof Error ? e.message : String(e));
  }
}

/** `bucket/objectPath` — the stored form for a successfully uploaded photo. */
export function bucketRef(objectPath: string): string {
  return `${PHOTO_BUCKET}/${objectPath}`;
}

/** Fallback when the upload fails: a bare reference to the provider object,
 * with NO token embedded — re-resolution (bot token + getFile) must happen at
 * fetch time by whoever holds the credential. Never store the token here.
 * objectPath already carries the source prefix (e.g. "telegram/<fileId>").
 */
function fallbackRef(objectPath: string, reason: string): PhotoReference {
  console.error(`photo stored as token-free fallback ref (${reason})`);
  return { ref: objectPath, uploaded: false };
}
