import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type CitizenPhotoUploadDeps,
  handleCitizenPhotoUpload,
} from "../functions/citizen-photo-upload/index.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";
const COMPLAINT_ID = "33333333-3333-4333-8333-333333333333";
const SERVICE_KEY = "test-service-role-key";
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface TestOptions {
  ownerId?: string;
  role?: string;
  isAnonymous?: boolean;
  existingPhoto?: string | null;
  storageStatus?: number;
  updatedRows?: Array<{ id: string }>;
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeDeps(options: TestOptions = {}) {
  const calls = {
    storage: 0,
    patch: 0,
    cleanup: 0,
    storageAuthorization: "",
    patchUrl: "",
    patchBody: "",
  };

  const deps: CitizenPhotoUploadDeps = {
    supabaseUrl: "http://kong:8000",
    serviceRoleKey: SERVICE_KEY,
    fetchImpl: (input, init) =>
      Promise.resolve().then(() => {
        const url = String(input);
        const method = init?.method ?? "GET";

        if (url.endsWith("/auth/v1/user")) {
          return jsonResponse({ id: USER_ID, email: "citizen@example.com" });
        }
        if (url.includes("/rest/v1/profiles?")) {
          return jsonResponse([{
            user_id: USER_ID,
            email: " Citizen@Example.com ",
            role: options.role ?? "citizen",
          }]);
        }
        if (url.includes("/rest/v1/complaints?") && method === "GET") {
          return jsonResponse([{
            id: COMPLAINT_ID,
            citizen_id: options.ownerId ?? USER_ID,
            channel: "web",
            is_anonymous: options.isAnonymous ?? false,
            photo_url: options.existingPhoto ?? null,
          }]);
        }
        if (url.includes("/storage/v1/object/complaint-photos/") && method === "POST") {
          calls.storage += 1;
          calls.storageAuthorization = new Headers(init?.headers).get("Authorization") ?? "";
          return new Response(null, { status: options.storageStatus ?? 200 });
        }
        if (url.includes("/rest/v1/complaints?") && method === "PATCH") {
          calls.patch += 1;
          calls.patchUrl = url;
          calls.patchBody = String(init?.body ?? "");
          return jsonResponse(options.updatedRows ?? [{ id: COMPLAINT_ID }]);
        }
        if (url.endsWith("/storage/v1/object/complaint-photos") && method === "DELETE") {
          calls.cleanup += 1;
          return new Response(null, { status: 200 });
        }
        return new Response("Unexpected request", { status: 404 });
      }),
  };

  return { deps, calls };
}

function uploadRequest(
  options: { token?: string; bytes?: Uint8Array; mime?: string } = {},
): Request {
  const form = new FormData();
  form.set("complaint_id", COMPLAINT_ID);
  const fileBytes = options.bytes ?? PNG_BYTES;
  const fileBuffer = new ArrayBuffer(fileBytes.byteLength);
  new Uint8Array(fileBuffer).set(fileBytes);
  form.set(
    "photo",
    new File([fileBuffer], "evidence.png", {
      type: options.mime ?? "image/png",
    }),
  );
  const headers = new Headers();
  if (options.token !== "") {
    headers.set("Authorization", `Bearer ${options.token ?? "valid-user-token"}`);
  }
  return new Request("http://edge.test/citizen-photo-upload", {
    method: "POST",
    headers,
    body: form,
  });
}

Deno.test("citizen photo upload verifies ownership, stores privately, and attaches the path", async () => {
  const { deps, calls } = makeDeps();
  const response = await handleCitizenPhotoUpload(uploadRequest(), deps);
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body, { ok: true });
  assertEquals(calls.storage, 1);
  assertEquals(calls.patch, 1);
  assertEquals(calls.storageAuthorization, `Bearer ${SERVICE_KEY}`);
  assert(calls.patchUrl.includes(`citizen_id=eq.${USER_ID}`));
  assert(calls.patchUrl.includes("channel=eq.web"));
  const patch = JSON.parse(calls.patchBody) as { photo_url?: string };
  assertEquals(typeof patch.photo_url, "string");
  assert(new RegExp(`^${COMPLAINT_ID}/[0-9a-f-]+\\.png$`, "i").test(patch.photo_url ?? ""));
});

Deno.test("citizen photo upload rejects a report owned by another account before Storage", async () => {
  const { deps, calls } = makeDeps({ ownerId: OTHER_USER_ID });
  const response = await handleCitizenPhotoUpload(uploadRequest(), deps);

  assertEquals(response.status, 403);
  assertEquals(await response.json(), { error: "report_not_owned" });
  assertEquals(calls.storage, 0);
  assertEquals(calls.patch, 0);
});

Deno.test("citizen photo upload rejects non-citizen accounts", async () => {
  const { deps, calls } = makeDeps({ role: "officer" });
  const response = await handleCitizenPhotoUpload(uploadRequest(), deps);

  assertEquals(response.status, 403);
  assertEquals(await response.json(), { error: "citizen_account_required" });
  assertEquals(calls.storage, 0);
  assertEquals(calls.patch, 0);
});

Deno.test("citizen photo upload rejects anonymous reports", async () => {
  const { deps, calls } = makeDeps({ isAnonymous: true });
  const response = await handleCitizenPhotoUpload(uploadRequest(), deps);

  assertEquals(response.status, 403);
  assertEquals(await response.json(), { error: "report_not_owned" });
  assertEquals(calls.storage, 0);
  assertEquals(calls.patch, 0);
});

Deno.test("citizen photo upload rejects MIME-spoofed image bytes", async () => {
  const { deps, calls } = makeDeps();
  const response = await handleCitizenPhotoUpload(
    uploadRequest({ bytes: new Uint8Array([0, 1, 2, 3]), mime: "image/png" }),
    deps,
  );

  assertEquals(response.status, 415);
  assertEquals(await response.json(), { error: "unsupported_or_invalid_image" });
  assertEquals(calls.storage, 0);
  assertEquals(calls.patch, 0);
});

Deno.test("citizen photo upload reports Storage failures without attaching a dead path", async () => {
  const { deps, calls } = makeDeps({ storageStatus: 500 });
  const response = await handleCitizenPhotoUpload(uploadRequest(), deps);

  assertEquals(response.status, 502);
  assertEquals(await response.json(), { error: "storage_upload_failed" });
  assertEquals(calls.storage, 1);
  assertEquals(calls.patch, 0);
});

Deno.test("citizen photo upload requires a user bearer token", async () => {
  const { deps, calls } = makeDeps();
  const response = await handleCitizenPhotoUpload(uploadRequest({ token: "" }), deps);

  assertEquals(response.status, 401);
  assertEquals(await response.json(), { error: "not_authenticated" });
  assertEquals(calls.storage, 0);
  assertEquals(calls.patch, 0);
});
