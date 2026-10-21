const BUCKET = "complaint-photos";
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const MAX_MULTIPART_OVERHEAD = 64 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

export interface CitizenPhotoUploadDeps {
  supabaseUrl: string;
  serviceRoleKey: string;
  fetchImpl: typeof fetch;
}

interface AuthUser {
  id: string;
  email: string;
}

interface ProfileRow {
  user_id: string;
  email: string | null;
  role: string;
}

interface ComplaintRow {
  id: string;
  citizen_id: string | null;
  channel: string;
  is_anonymous: boolean;
  photo_url: string | null;
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function adminHeaders(deps: CitizenPhotoUploadDeps): Record<string, string> {
  return {
    Authorization: `Bearer ${deps.serviceRoleKey}`,
    apikey: deps.serviceRoleKey,
  };
}

function isSupportedImage(file: File, bytes: Uint8Array): boolean {
  const mime = file.type.toLowerCase();
  if (mime === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mime === "image/png") {
    return bytes.length >= 8 &&
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
      bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  }
  if (mime === "image/webp") {
    return bytes.length >= 12 &&
      bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  }
  return false;
}

function extensionFor(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

async function removeUploadedObject(
  deps: CitizenPhotoUploadDeps,
  objectPath: string,
): Promise<void> {
  try {
    const baseUrl = deps.supabaseUrl.replace(/\/+$/, "");
    const response = await deps.fetchImpl(`${baseUrl}/storage/v1/object/${BUCKET}`, {
      method: "DELETE",
      headers: {
        ...adminHeaders(deps),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prefixes: [objectPath] }),
    });
    if (!response.ok) console.error("citizen photo cleanup failed:", response.status);
  } catch {
    console.error("citizen photo cleanup failed");
  }
}

export async function handleCitizenPhotoUpload(
  request: Request,
  deps: CitizenPhotoUploadDeps,
): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (request.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const baseUrl = deps.supabaseUrl.replace(/\/+$/, "");
  if (!baseUrl || !deps.serviceRoleKey) {
    console.error("citizen photo upload is missing Supabase server configuration");
    return jsonResponse({ error: "service_unavailable" }, 503);
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_PHOTO_BYTES + MAX_MULTIPART_OVERHEAD) {
    return jsonResponse({ error: "photo_too_large" }, 413);
  }

  const authorization = request.headers.get("Authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) return jsonResponse({ error: "not_authenticated" }, 401);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonResponse({ error: "invalid_multipart_form" }, 400);
  }

  const complaintIdValue = form.get("complaint_id");
  const photo = form.get("photo");
  if (typeof complaintIdValue !== "string" || !UUID_PATTERN.test(complaintIdValue)) {
    return jsonResponse({ error: "invalid_report_id" }, 400);
  }
  if (!(photo instanceof File) || photo.size === 0) {
    return jsonResponse({ error: "photo_required" }, 400);
  }
  if (photo.size > MAX_PHOTO_BYTES) return jsonResponse({ error: "photo_too_large" }, 413);

  let user: AuthUser;
  try {
    const authResponse = await deps.fetchImpl(`${baseUrl}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: deps.serviceRoleKey,
      },
    });
    if (!authResponse.ok) return jsonResponse({ error: "not_authenticated" }, 401);
    const authBody = await authResponse.json() as { id?: unknown; email?: unknown };
    if (typeof authBody.id !== "string" || typeof authBody.email !== "string") {
      return jsonResponse({ error: "not_authenticated" }, 401);
    }
    user = { id: authBody.id, email: authBody.email };
  } catch {
    return jsonResponse({ error: "auth_verification_unavailable" }, 503);
  }

  let profile: ProfileRow | undefined;
  try {
    const profileUrl = new URL(`${baseUrl}/rest/v1/profiles`);
    profileUrl.searchParams.set("user_id", `eq.${user.id}`);
    profileUrl.searchParams.set("select", "user_id,email,role");
    const profileResponse = await deps.fetchImpl(profileUrl, { headers: adminHeaders(deps) });
    if (!profileResponse.ok) throw new Error(`profile HTTP ${profileResponse.status}`);
    const profiles = await profileResponse.json() as ProfileRow[];
    profile = profiles[0];
  } catch (error) {
    console.error(
      "citizen photo profile verification failed:",
      error instanceof Error ? error.message : "unknown",
    );
    return jsonResponse({ error: "citizen_verification_unavailable" }, 503);
  }

  if (
    !profile || profile.role !== "citizen" || !profile.email ||
    profile.email.trim().toLowerCase() !== user.email.trim().toLowerCase()
  ) {
    return jsonResponse({ error: "citizen_account_required" }, 403);
  }

  let complaint: ComplaintRow | undefined;
  try {
    const complaintUrl = new URL(`${baseUrl}/rest/v1/complaints`);
    complaintUrl.searchParams.set("id", `eq.${complaintIdValue}`);
    complaintUrl.searchParams.set("select", "id,citizen_id,channel,is_anonymous,photo_url");
    const complaintResponse = await deps.fetchImpl(complaintUrl, { headers: adminHeaders(deps) });
    if (!complaintResponse.ok) throw new Error(`complaint HTTP ${complaintResponse.status}`);
    const complaints = await complaintResponse.json() as ComplaintRow[];
    complaint = complaints[0];
  } catch (error) {
    console.error(
      "citizen photo report verification failed:",
      error instanceof Error ? error.message : "unknown",
    );
    return jsonResponse({ error: "report_verification_unavailable" }, 503);
  }

  if (
    !complaint || complaint.citizen_id !== user.id || complaint.channel !== "web" ||
    complaint.is_anonymous
  ) {
    return jsonResponse({ error: "report_not_owned" }, 403);
  }
  if (complaint.photo_url) return jsonResponse({ ok: true, already_attached: true });

  const mime = photo.type.toLowerCase();
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await photo.arrayBuffer());
  } catch {
    return jsonResponse({ error: "invalid_photo" }, 400);
  }
  if (!isSupportedImage(photo, bytes)) {
    return jsonResponse({ error: "unsupported_or_invalid_image" }, 415);
  }

  const objectPath = `${complaintIdValue}/${crypto.randomUUID()}.${extensionFor(mime)}`;
  const uploadBody = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(uploadBody).set(bytes);
  try {
    const storageUrl = `${baseUrl}/storage/v1/object/${BUCKET}/${objectPath}`;
    const uploadResponse = await deps.fetchImpl(storageUrl, {
      method: "POST",
      headers: {
        ...adminHeaders(deps),
        "Content-Type": mime,
        "Cache-Control": "3600",
        "x-upsert": "false",
      },
      body: uploadBody,
    });
    if (!uploadResponse.ok) {
      console.error("citizen photo Storage upload failed:", uploadResponse.status);
      return jsonResponse({ error: "storage_upload_failed" }, 502);
    }
  } catch {
    console.error("citizen photo Storage request failed");
    return jsonResponse({ error: "storage_upload_failed" }, 502);
  }

  try {
    const updateUrl = new URL(`${baseUrl}/rest/v1/complaints`);
    updateUrl.searchParams.set("id", `eq.${complaintIdValue}`);
    updateUrl.searchParams.set("citizen_id", `eq.${user.id}`);
    updateUrl.searchParams.set("channel", "eq.web");
    updateUrl.searchParams.set("is_anonymous", "eq.false");
    const updateResponse = await deps.fetchImpl(updateUrl, {
      method: "PATCH",
      headers: {
        ...adminHeaders(deps),
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({ photo_url: objectPath }),
    });
    if (!updateResponse.ok) {
      console.error("citizen photo report update failed:", updateResponse.status);
      await removeUploadedObject(deps, objectPath);
      return jsonResponse({ error: "photo_attach_failed" }, 502);
    }
    const updated = await updateResponse.json() as Array<{ id?: string }>;
    if (!Array.isArray(updated) || updated.length === 0) {
      await removeUploadedObject(deps, objectPath);
      return jsonResponse({ error: "report_not_owned" }, 403);
    }
  } catch {
    console.error("citizen photo report update failed");
    await removeUploadedObject(deps, objectPath);
    return jsonResponse({ error: "photo_attach_failed" }, 502);
  }

  return jsonResponse({ ok: true });
}

if (import.meta.main) {
  const deps: CitizenPhotoUploadDeps = {
    supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
    serviceRoleKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    fetchImpl: fetch,
  };
  Deno.serve((request) => handleCitizenPhotoUpload(request, deps));
}
