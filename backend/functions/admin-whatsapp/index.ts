/**
 * Admin WhatsApp numbers edge function.
 *
 * Lets the admin panel manage the WhatsApp numbers the deployment sends
 * from, via the GOWA gateway (go-whatsapp-web-multidevice v9.6). One number
 * sends OTP verification codes, another handles user chat.
 *
 * Single POST endpoint. Body: { "action": "...", "params": { ... } }
 *
 * Actions:
 *   list_numbers  -> GOWA device slots + whatsapp_numbers registry joined
 *   start_link    -> create GOWA device slot, mint a pairing CODE (not QR),
 *                    store the registry row as pending; returns the code
 *   confirm_link  -> poll GOWA status for a number, mark linked when it is
 *   set_role      -> assign 'otp' or 'chat' to a number
 *   revoke        -> GOWA logout (slot can no longer send) + status=revoked
 *   delete_number -> registry delete + GOWA slot removal
 *   get_sender    -> effective OTP sender number (registry else env fallback)
 *
 * Security model:
 *   - Caller must present a valid Supabase JWT (hybrid HS256/RS256/ES256,
 *     same verification as admin-secrets) AND resolve to a profiles row with
 *     role = admin (via the fn_is_admin RPC).
 *   - NEVER sends any WhatsApp message: the send endpoints are not touched.
 *     Only device lifecycle: create slot, mint pairing code, read status,
 *     logout, delete slot.
 *   - Pairing codes are short-lived (~1 min) and returned only to admins.
 *
 * Unknown / missing action -> 400. Invalid token -> 401. Non-admin -> 403.
 */
import * as jose from "jsr:@panva/jose@6";
import { jsonResponse, errorResponse, readJson } from "../_shared/http.ts";

// `EdgeRuntime` typing: in tests the global may be undefined; runtime code
// only uses it to decide whether to start the HTTP server (same as
// admin-secrets, which declares it the same way).
declare const EdgeRuntime: {
  userWorkers: unknown;
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GowaDevice {
  id: string;
  display_name?: string;
  state?: string;
  jid?: string;
  created_at?: string;
}

export interface GowaStatus {
  device_id?: string;
  is_connected?: boolean;
  is_logged_in?: boolean;
  jid?: string;
}

export interface RegistryRow {
  id: string;
  number: string;
  role: string;
  status: string;
  gowa_instance: string | null;
  linked_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface NumberView {
  id: string | null;
  number: string;
  role: string;
  status: string;
  gowaInstance: string | null;
  gowaState: string | null;
  gowaJid: string | null;
  linkedAt: string | null;
  revokedAt: string | null;
  createdAt: string | null;
}

export interface WhatsappDeps {
  /** Verify a JWT; resolve to the token when valid, null when invalid. */
  verify: (jwt: string) => Promise<string | null>;
  /** Resolve the admin user id for a verified token, null when not admin. */
  adminUserId: (jwt: string) => Promise<string | null>;
  /** PostgREST as service role: read whatsapp_numbers rows. */
  listRegistry: () => Promise<RegistryRow[]>;
  /** PostgREST as service role: upsert a registry row by number. */
  upsertRegistry: (row: {
    number: string;
    gowa_instance: string;
    status: string;
    role?: string;
  }) => Promise<RegistryRow | null>;
  /** PostgREST as service role: patch a registry row by number. */
  updateRegistry: (
    number: string,
    patch: Partial<Pick<RegistryRow, "status" | "role" | "gowa_instance" | "linked_at" | "revoked_at">>,
  ) => Promise<RegistryRow | null>;
  /** PostgREST as service role: delete a registry row by number. */
  deleteRegistry: (number: string) => Promise<boolean>;
  /** Read the effective OTP sender fallback from app_settings. */
  getSetting: (key: string) => Promise<string | null>;
  /** GOWA device slot list. */
  gowaListDevices: () => Promise<GowaDevice[]>;
  /** GOWA create device slot. */
  gowaCreateDevice: (deviceId: string) => Promise<GowaDevice>;
  /** GOWA delete device slot. */
  gowaDeleteDevice: (deviceId: string) => Promise<boolean>;
  /** GOWA pairing code (login-with-code). */
  gowaPairingCode: (deviceId: string, phone: string) => Promise<string>;
  /** GOWA status for one slot. */
  gowaStatus: (deviceId: string) => Promise<GowaStatus>;
  /** GOWA logout one slot (revoke: can no longer send). */
  gowaLogout: (deviceId: string) => Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/** Normalise a phone number to bare digits (strip +, spaces, dashes). */
export function normalizePhone(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/[^0-9]/g, "");
  // E.164-ish: 8 to 15 digits (Gambia numbers are 9-13 with country code).
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

/** Registry role values. */
const ROLES = ["otp", "chat"] as const;
export type Role = (typeof ROLES)[number];

function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// GOWA <-> registry correlation
// ---------------------------------------------------------------------------

/**
 * Build the admin-facing view: every registry row joined to its live GOWA
 * state, plus GOWA slots that have no registry row yet (e.g. the pre-existing
 * default slot) shown as role-less entries.
 */
export function joinViews(
  registry: RegistryRow[],
  devices: GowaDevice[],
): NumberView[] {
  const byInstance = new Map<string, RegistryRow>();
  for (const row of registry) {
    if (row.gowa_instance) byInstance.set(row.gowa_instance, row);
  }
  const views: NumberView[] = [];
  const usedDevices = new Set<string>();

  for (const row of registry) {
    const device = row.gowa_instance
      ? devices.find((d) => d.id === row.gowa_instance)
      : undefined;
    if (device) usedDevices.add(device.id);
    // GOWA state is authoritative for 'linked': a slot that was logged out on
    // the phone side reports state != logged_in even though our registry still
    // says linked.
    let status = row.status;
    if (device && device.state && device.state !== "logged_in" && row.status === "linked") {
      status = "revoked";
    }
    // Derive the number from the GOWA jid when the registry has none.
    const jidNumber = device?.jid?.split("@")[0]?.split(":")[0] ?? null;
    views.push({
      id: row.id,
      number: row.number || jidNumber || "",
      role: row.role,
      status,
      gowaInstance: row.gowa_instance,
      gowaState: device?.state ?? null,
      gowaJid: device?.jid ?? null,
      linkedAt: row.linked_at,
      revokedAt: row.revoked_at,
      createdAt: row.created_at,
    });
  }

  for (const device of devices) {
    if (usedDevices.has(device.id)) continue;
    const jidNumber = device.jid?.split("@")[0]?.split(":")[0] ?? null;
    views.push({
      id: null,
      number: jidNumber ?? "",
      role: "chat",
      status: device.state === "logged_in" ? "linked" : "pending",
      gowaInstance: device.id,
      gowaState: device.state ?? null,
      gowaJid: device.jid ?? null,
      linkedAt: null,
      revokedAt: null,
      createdAt: device.created_at ?? null,
    });
  }
  return views;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function json(data: unknown, status = 200): Response {
  return jsonResponse(data, status);
}

async function listNumbers(deps: WhatsappDeps): Promise<Response> {
  const [registry, devices] = await Promise.all([
    deps.listRegistry(),
    deps.gowaListDevices(),
  ]);
  return json({ ok: true, data: { numbers: joinViews(registry, devices) } });
}

async function startLink(
  deps: WhatsappDeps,
  params: Record<string, unknown>,
): Promise<Response> {
  const phone = normalizePhone(typeof params.phone === "string" ? params.phone : "");
  if (!phone) {
    return errorResponse(400, "invalid_phone");
  }
  const role = isRole(params.role) ? params.role : "chat";

  // One GOWA slot per number; reuse the slot id if the number returns.
  const deviceId = `wa-${phone}`;
  const devices = await deps.gowaListDevices();
  if (!devices.some((d) => d.id === deviceId)) {
    await deps.gowaCreateDevice(deviceId);
  }

  // Mint the pairing code. Short-lived (~1 min) — the UI shows it right away.
  let code: string;
  try {
    code = await deps.gowaPairingCode(deviceId, phone);
  } catch (e) {
    console.error("pairing code failed:", e instanceof Error ? e.message : e);
    return errorResponse(502, "pairing_code_failed");
  }

  const row = await deps.upsertRegistry({
    number: phone,
    gowa_instance: deviceId,
    status: "pending",
    role,
  });
  if (!row) {
    return errorResponse(500, "registry_write_failed");
  }
  return json({
    ok: true,
    data: {
      number: phone,
      role,
      status: "pending",
      gowaInstance: deviceId,
      pairingCode: code,
    },
  });
}

async function confirmLink(
  deps: WhatsappDeps,
  params: Record<string, unknown>,
): Promise<Response> {
  const phone = normalizePhone(typeof params.phone === "string" ? params.phone : "");
  if (!phone) return errorResponse(400, "invalid_phone");

  const registry = await deps.listRegistry();
  const row = registry.find((r) => r.number === phone);
  if (!row) return errorResponse(404, "not_found");
  if (!row.gowa_instance) return errorResponse(400, "no_instance");

  const status = await deps.gowaStatus(row.gowa_instance);
  if (status.is_logged_in === true) {
    const updated = await deps.updateRegistry(phone, {
      status: "linked",
      linked_at: new Date().toISOString(),
      gowa_instance: row.gowa_instance,
    });
    return json({
      ok: true,
      data: { number: phone, status: "linked", jid: status.jid ?? null, row: updated },
    });
  }
  return json({
    ok: true,
    data: {
      number: phone,
      status: row.status === "pending" ? "pending" : row.status,
      loggedIn: false,
      gowaState: status.is_connected === true ? "connected" : "disconnected",
    },
  });
}

async function setRole(
  deps: WhatsappDeps,
  params: Record<string, unknown>,
): Promise<Response> {
  const phone = normalizePhone(typeof params.phone === "string" ? params.phone : "");
  if (!phone) return errorResponse(400, "invalid_phone");
  const role = params.role;
  if (!isRole(role)) return errorResponse(400, "invalid_role");

  const updated = await deps.updateRegistry(phone, { role });
  if (!updated) return errorResponse(404, "not_found");
  return json({ ok: true, data: { number: phone, role: updated.role, status: updated.status } });
}

async function revoke(
  deps: WhatsappDeps,
  params: Record<string, unknown>,
): Promise<Response> {
  const phone = normalizePhone(typeof params.phone === "string" ? params.phone : "");
  if (!phone) return errorResponse(400, "invalid_phone");

  const registry = await deps.listRegistry();
  const row = registry.find((r) => r.number === phone);
  if (!row) return errorResponse(404, "not_found");

  // GOWA logout makes the slot unable to send (session destroyed server-side).
  let gowaOk = true;
  if (row.gowa_instance) {
    try {
      gowaOk = await deps.gowaLogout(row.gowa_instance);
    } catch (e) {
      console.error("gowa logout failed:", e instanceof Error ? e.message : e);
      gowaOk = false;
    }
  }
  const updated = await deps.updateRegistry(phone, {
    status: "revoked",
    revoked_at: new Date().toISOString(),
  });
  return json({
    ok: true,
    data: {
      number: phone,
      status: "revoked",
      gowaLogoutOk: gowaOk,
      row: updated,
    },
  });
}

async function deleteNumber(
  deps: WhatsappDeps,
  params: Record<string, unknown>,
): Promise<Response> {
  const phone = normalizePhone(typeof params.phone === "string" ? params.phone : "");
  if (!phone) return errorResponse(400, "invalid_phone");

  const registry = await deps.listRegistry();
  const row = registry.find((r) => r.number === phone);
  let gowaOk = true;
  if (row?.gowa_instance) {
    try {
      gowaOk = await deps.gowaDeleteDevice(row.gowa_instance);
    } catch (e) {
      console.error("gowa delete failed:", e instanceof Error ? e.message : e);
      gowaOk = false;
    }
  }
  const ok = await deps.deleteRegistry(phone);
  if (!ok) return errorResponse(500, "registry_delete_failed");
  return json({ ok: true, data: { number: phone, deleted: true, gowaDeviceDeleted: gowaOk } });
}

async function getSender(deps: WhatsappDeps): Promise<Response> {
  const registry = await deps.listRegistry();
  const otpRow = registry.find((r) => r.role === "otp" && r.status === "linked");
  const fallback = await deps.getSetting("whatsapp_sender_number");
  return json({
    ok: true,
    data: {
      sender: otpRow?.number ?? fallback ?? null,
      source: otpRow ? "registry" : fallback ? "app_settings" : "none",
    },
  });
}

// ---------------------------------------------------------------------------
// Request handler (pure, injectable deps — unit-testable)
// ---------------------------------------------------------------------------

export async function handleWhatsappRequest(
  req: Request,
  deps: WhatsappDeps,
): Promise<Response> {
  if (req.method !== "POST") {
    return errorResponse(405, "method_not_allowed");
  }

  // ---- JWT verification (user token, not service role) ----
  const authHeader = req.headers.get("authorization") ?? "";
  const [scheme, token] = authHeader.split(" ");
  if (scheme !== "Bearer" || !token) {
    return errorResponse(401, "invalid_token");
  }
  const verified = await deps.verify(token);
  if (!verified) {
    return errorResponse(401, "invalid_token");
  }

  // ---- Admin check: must resolve to a profiles row with role = admin ----
  const adminUserId = await deps.adminUserId(verified);
  if (!adminUserId) {
    return errorResponse(403, "forbidden");
  }

  // ---- Body parsing ----
  const body = await readJson<{ action?: unknown; params?: Record<string, unknown> }>(req);
  if (!body) return errorResponse(400, "invalid_json");

  const action = typeof body.action === "string" ? body.action : undefined;
  const params = (body.params ?? {}) as Record<string, unknown>;
  if (!action) return errorResponse(400, "missing_action");

  switch (action) {
    case "list_numbers":
      return await listNumbers(deps);
    case "start_link":
      return await startLink(deps, params);
    case "confirm_link":
      return await confirmLink(deps, params);
    case "set_role":
      return await setRole(deps, params);
    case "revoke":
      return await revoke(deps, params);
    case "delete_number":
      return await deleteNumber(deps, params);
    case "get_sender":
      return await getSender(deps);
    default:
      return errorResponse(400, "unknown_action");
  }
}

// ---------------------------------------------------------------------------
// Default deps: real JWT verification, real PostgREST, real GOWA client
// ---------------------------------------------------------------------------

const JWT_SECRET = Deno.env.get("JWT_SECRET");
const SUPABASE_JWKS = parseJwks(Deno.env.get("SUPABASE_JWKS"));
const POSTGREST_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const GOWA_BASE_URL = (Deno.env.get("GOWA_BASE_URL") ?? "http://gowa:3000").replace(/\/+$/, "");
const GOWA_BASIC_AUTH = Deno.env.get("GOWA_BASIC_AUTH") ?? "";

// NOTE: bare array parsing only; jose handles key validity.
export function parseJwks(raw: string | undefined): jose.JSONWebKeySet | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.keys && Array.isArray(parsed.keys)) {
      return parsed as jose.JSONWebKeySet;
    }
    return null;
  } catch {
    return null;
  }
}

async function verifyLegacyJwt(jwt: string): Promise<boolean> {
  if (!JWT_SECRET) {
    console.error("JWT_SECRET not available for HS256 token verification");
    return false;
  }
  const secretKey = new TextEncoder().encode(JWT_SECRET);
  try {
    await jose.jwtVerify(jwt, secretKey);
    return true;
  } catch (e) {
    console.error("Symmetric Legacy JWT verification error", e);
    return false;
  }
}

async function verifyAsymmetricJwt(jwt: string): Promise<boolean> {
  if (!SUPABASE_JWKS) {
    console.error("JWKS not available for ES256/RS256 token verification");
    return false;
  }
  try {
    const localJwks = jose.createLocalJWKSet(SUPABASE_JWKS);
    await jose.jwtVerify(jwt, localJwks);
    return true;
  } catch (e) {
    console.error("Asymmetric JWT verification error", e);
    return false;
  }
}

/**
 * Verify JWT, auto-detecting algorithm:
 *   HS256        -> JWT_SECRET (symmetric)
 *   ES256/RS256  -> SUPABASE_JWKS (asymmetric)
 * Returns the token string when valid, null otherwise.
 */
export async function verifyHybridJwt(jwt: string): Promise<string | null> {
  let alg = "";
  try {
    alg = jose.decodeProtectedHeader(jwt).alg ?? "";
  } catch {
    return null;
  }

  let ok = false;
  if (alg === "HS256") {
    ok = await verifyLegacyJwt(jwt);
  } else if (alg === "ES256" || alg === "RS256") {
    ok = await verifyAsymmetricJwt(jwt);
  }
  return ok ? jwt : null;
}

// ---------------------------------------------------------------------------
// PostgREST helpers (service role; Kong requires the apikey header)
// ---------------------------------------------------------------------------

async function restRequest(
  path: string,
  init: RequestInit,
): Promise<Response> {
  if (!POSTGREST_URL || !SERVICE_ROLE_KEY) {
    throw new Error("PostgREST not configured");
  }
  const url = `${POSTGREST_URL.replace(/\/+$/, "")}${path}`;
  return await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      apikey: SERVICE_ROLE_KEY || ANON_KEY,
      ...(init.headers ?? {}),
    },
  });
}

async function servicePostgrest(
  fn: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const res = await restRequest(`/rest/v1/rpc/${fn}`, {
    method: "POST",
    body: JSON.stringify(args ?? {}),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`rpc ${fn} HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  if (!text || text === "null") return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ---------------------------------------------------------------------------
// Registry access (service_role; RLS bypassed, admin enforced above)
// ---------------------------------------------------------------------------

async function listRegistry(): Promise<RegistryRow[]> {
  const res = await restRequest(
    "/rest/v1/whatsapp_numbers?select=*&order=created_at.desc",
    { method: "GET" },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`registry list HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as RegistryRow[];
}

async function upsertRegistry(row: {
  number: string;
  gowa_instance: string;
  status: string;
  role?: string;
}): Promise<RegistryRow | null> {
  const res = await restRequest(
    "/rest/v1/whatsapp_numbers?on_conflict=number",
    {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({
        number: row.number,
        gowa_instance: row.gowa_instance,
        status: row.status,
        role: row.role ?? "chat",
      }),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`registry upsert HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const rows = (await res.json()) as RegistryRow[];
  return rows[0] ?? null;
}

async function updateRegistry(
  number: string,
  patch: Partial<Pick<RegistryRow, "status" | "role" | "gowa_instance" | "linked_at" | "revoked_at">>,
): Promise<RegistryRow | null> {
  const res = await restRequest(
    `/rest/v1/whatsapp_numbers?number=eq.${encodeURIComponent(number)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(patch),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`registry update HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const rows = (await res.json()) as RegistryRow[];
  return rows[0] ?? null;
}

async function deleteRegistry(number: string): Promise<boolean> {
  const res = await restRequest(
    `/rest/v1/whatsapp_numbers?number=eq.${encodeURIComponent(number)}`,
    { method: "DELETE" },
  );
  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new Error(`registry delete HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.ok;
}

async function getSetting(key: string): Promise<string | null> {
  try {
    const value = await servicePostgrest("get_setting", { key }) as string | null;
    if (typeof value === "string") return value;
    // JSONB scalar arrives as the raw string (e.g. "\"2200000000\"").
    if (value == null) return null;
    try {
      return JSON.parse(value) as string;
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// GOWA client (device lifecycle ONLY — never touches send endpoints)
// ---------------------------------------------------------------------------

function gowaHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (GOWA_BASIC_AUTH) {
    headers["Authorization"] = `Basic ${btoa(GOWA_BASIC_AUTH)}`;
  }
  return headers;
}

async function gowaCall(
  path: string,
  init: { method?: string; body?: string; deviceId?: string } = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  const headers = new Headers(gowaHeaders());
  if (init.deviceId) headers.set("X-Device-Id", init.deviceId);
  const res = await fetch(`${GOWA_BASE_URL}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = { raw: text.slice(0, 300) };
  }
  return { status: res.status, json };
}

/** Extract the "results" payload from a GOWA response or throw. */
function gowaResults(json: Record<string, unknown>): Record<string, unknown> {
  const code = typeof json.code === "string" ? json.code : "";
  if (code && code !== "SUCCESS") {
    throw new Error(`gowa error ${code}: ${String(json.message ?? "").slice(0, 200)}`);
  }
  return (json.results ?? {}) as Record<string, unknown>;
}

const defaultDeps: WhatsappDeps = {
  verify: verifyHybridJwt,
  adminUserId: async (jwt: string): Promise<string | null> => {
    // fn_is_admin resolves auth.uid() from the CALLER's JWT — same pattern as
    // admin-secrets: run the RPC as the requesting user, not the service role.
    try {
      const isAdmin = await restRequest(`/rest/v1/rpc/fn_is_admin`, {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({}),
      });
      const text = await isAdmin.text();
      if (!isAdmin.ok) {
        console.error(`fn_is_admin HTTP ${isAdmin.status}: ${text.slice(0, 200)}`);
        return null;
      }
      if (JSON.parse(text) !== true) return null;
    } catch (e) {
      console.error("fn_is_admin rpc failed:", e instanceof Error ? e.message : e);
      return null;
    }
    try {
      const payload = jose.decodeJwt(jwt);
      return typeof payload.sub === "string" ? payload.sub : null;
    } catch {
      return null;
    }
  },
  listRegistry,
  upsertRegistry,
  updateRegistry,
  deleteRegistry,
  getSetting,
  gowaListDevices: async () => {
    const { status, json } = await gowaCall("/devices");
    if (status !== 200) throw new Error(`gowa devices HTTP ${status}`);
    const results = gowaResults(json);
    return Array.isArray(results) ? (results as unknown as GowaDevice[]) : [];
  },
  gowaCreateDevice: async (deviceId: string) => {
    const { status, json } = await gowaCall("/devices", {
      method: "POST",
      body: JSON.stringify({ device_id: deviceId }),
    });
    if (status !== 200) {
      throw new Error(`gowa create HTTP ${status}: ${String(json.message ?? "")}`);
    }
    return gowaResults(json) as unknown as GowaDevice;
  },
  gowaDeleteDevice: async (deviceId: string) => {
    const { status } = await gowaCall(`/devices/${encodeURIComponent(deviceId)}`, {
      method: "DELETE",
      deviceId,
    });
    return status === 200;
  },
  gowaPairingCode: async (deviceId: string, phone: string) => {
    // First mint after idle can take 30-90s (WhatsApp handshake); allow it.
    const { status, json } = await gowaCall(
      `/app/login-with-code?phone=${encodeURIComponent(phone)}`,
      { deviceId },
    );
    if (status !== 200) {
      throw new Error(`gowa pairing HTTP ${status}: ${String(json.message ?? "")}`);
    }
    const results = gowaResults(json) as { pair_code?: string };
    if (!results.pair_code) throw new Error("gowa pairing returned no code");
    return results.pair_code;
  },
  gowaStatus: async (deviceId: string) => {
    const { status, json } = await gowaCall("/app/status", { deviceId });
    if (status !== 200) throw new Error(`gowa status HTTP ${status}`);
    return gowaResults(json) as unknown as GowaStatus;
  },
  gowaLogout: async (deviceId: string) => {
    const { status } = await gowaCall("/app/logout", { deviceId });
    return status === 200;
  },
};

if (typeof EdgeRuntime !== "undefined") {
  Deno.serve((req: Request) =>
    handleWhatsappRequest(req, defaultDeps).catch((e) => {
      console.error("unhandled admin-whatsapp error:", e);
      return errorResponse(500, "internal_error");
    })
  );
}
