/**
 * Admin secrets edge function.
 *
 * Lets the admin panel manage API keys / secret values that live ONLY in
 * /opt/supabase/docker/.env.functions on the VPS (never in the database).
 * The function never touches that file itself: it calls the secrets bridge
 * daemon, a small service running on the VPS host, which performs the file
 * edit and recreates the functions container.
 *
 * Single POST endpoint. Body: { "action": "...", "params": { ... } }
 *
 * Actions:
 *   list       -> bridge "list": key names, set flags, timestamps only
 *   get_status -> bridge "status": daemon reachability and last reload
 *   set        -> bridge "set" for params.key = params.value
 *   delete     -> bridge "delete" for params.key
 *   get_audit  -> admin_list_secret_audit RPC (recent entries)
 *
 * Security model:
 *   - Caller must present a valid Supabase JWT (hybrid HS256/RS256/ES256,
 *     same verification as admin-api) AND resolve to a profiles row with
 *     role = admin (via the fn_is_admin RPC).
 *   - Keys are whitelisted: the named keys below plus generic CUSTOM_ keys
 *     matching ^CUSTOM_[A-Z0-9_]{1,40}$. Everything else is rejected.
 *   - Values are only forwarded to the bridge over the Docker network;
 *     they are never logged, never returned, never stored in the database.
 *   - The bridge token travels via the SECRET_BRIDGE_TOKEN environment
 *     variable and is only ever sent to the bridge URL (host-local).
 *
 * Unknown / missing action -> 400. Invalid token -> 401. Non-admin -> 403.
 */
import * as jose from "jsr:@panva/jose@6";

// `EdgeDeno` typing: in tests the global Deno may be stubbed; runtime code
// uses Deno.env only through the helper below.
declare const EdgeRuntime: {
  userWorkers: {
    create(opts: {
      servicePath: string;
      memoryLimitMb: number;
      workerTimeoutMs: number;
      noModuleCache: boolean;
      importMapPath: string | null;
      envVars: [string, string][];
    }): Promise<{ fetch(req: Request): Promise<Response> }>;
  };
};

// ---------------------------------------------------------------------------
// Key policy
// ---------------------------------------------------------------------------

/** Explicitly allowed key names. */
export const NAMED_KEYS = [
  "RESEND_API_KEY",
  "RESEND_FROM",
  "AI_API_KEY",
  "AI_BASE_URL",
  "AI_MODEL",
  "GOWA_BASIC_AUTH",
  "GOWA_BASE_URL",
  "GOWA_WEBHOOK_SECRET",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
  "SECRET_BRIDGE_TOKEN",
] as const;

/** Generic keys: CUSTOM_ followed by uppercase letters, digits, underscores. */
export const CUSTOM_KEY_PATTERN = /^CUSTOM_[A-Z0-9_]{1,40}$/;

/** Returns true when the given key may be managed through this function. */
export function isAllowedKey(key: string): boolean {
  if (typeof key !== "string") return false;
  if ((NAMED_KEYS as readonly string[]).includes(key)) return true;
  return CUSTOM_KEY_PATTERN.test(key);
}

/** Keys the panel may rotate (set) but never remove (delete). */
const UNDELETABLE_KEYS = new Set(["SECRET_BRIDGE_TOKEN"]);

/** Human-readable labels for the well-known keys. */
export const KEY_LABELS: Record<string, string> = {
  RESEND_API_KEY: "Resend API key",
  RESEND_FROM: "Resend from address",
  AI_API_KEY: "AI provider API key",
  AI_BASE_URL: "AI provider base URL",
  AI_MODEL: "AI model name",
  GOWA_BASIC_AUTH: "GOWA basic auth",
  GOWA_BASE_URL: "GOWA base URL",
  GOWA_WEBHOOK_SECRET: "GOWA webhook secret",
  TELEGRAM_BOT_TOKEN: "Telegram bot token",
  TELEGRAM_WEBHOOK_SECRET: "Telegram webhook secret",
  SECRET_BRIDGE_TOKEN: "Secrets bridge token",
};

// ---------------------------------------------------------------------------
// Bridge types
// ---------------------------------------------------------------------------

export interface BridgeEntry {
  key: string;
  set: boolean;
  updated_at: string | null;
}

export interface BridgeListResult {
  ok: boolean;
  entries: BridgeEntry[];
  last_reload: string | null;
  reload_ok: boolean | null;
}

export interface BridgeDeps {
  /** POST JSON to the secrets bridge; returns parsed JSON. */
  call: (
    path: string,
    body: Record<string, unknown>,
  ) => Promise<{ status: number; json: Record<string, unknown> }>;
}

export interface SecretsDeps {
  /** Verify a JWT; resolve to the token when valid, null when invalid. */
  verify: (jwt: string) => Promise<string | null>;
  /** Resolve the admin user id for a verified token, null when not admin. */
  adminUserId: (jwt: string) => Promise<string | null>;
  /** POST JSON to PostgREST as the given user; returns parsed JSON. */
  postgrest: (
    fn: string,
    args: Record<string, unknown>,
    headers: Record<string, string>,
  ) => Promise<unknown>;
  /** POST JSON to PostgREST with the service role; returns parsed JSON. */
  servicePostgrest: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<unknown>;
  /** The secrets bridge client. */
  bridge: BridgeDeps;
}

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

function json(res: unknown, status = 200): Response {
  return new Response(JSON.stringify(res), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Pure request handler - injectable deps make it unit-testable without
 * network access, real JWT verification, or a running bridge.
 */
export async function handleSecretsRequest(
  req: Request,
  deps: SecretsDeps,
): Promise<Response> {
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  // ---- JWT verification (user token, not service role) ----
  const authHeader = req.headers.get("authorization") ?? "";
  const [scheme, token] = authHeader.split(" ");
  if (scheme !== "Bearer" || !token) {
    return json({ error: "invalid_token" }, 401);
  }

  const verified = await deps.verify(token);
  if (!verified) {
    return json({ error: "invalid_token" }, 401);
  }

  // ---- Admin check: must resolve to a profiles row with role = admin ----
  const adminUserId = await deps.adminUserId(verified);
  if (!adminUserId) {
    return json({ error: "forbidden" }, 403);
  }

  // ---- Body parsing ----
  let body: { action?: unknown; params?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const action = typeof body.action === "string" ? body.action : undefined;
  const params = (body.params ?? {}) as Record<string, unknown>;

  if (!action) {
    return json({ error: "missing_action" }, 400);
  }

  if (action === "list") {
    return await runBridgeAction(deps, "list", {}, adminUserId);
  }

  if (action === "get_status") {
    return await runBridgeAction(deps, "status", {}, adminUserId);
  }

  if (action === "get_audit") {
    const limit = typeof params.limit === "number" ? params.limit : 50;
    try {
      const result = await deps.postgrest(
        "admin_list_secret_audit",
        { p_limit: limit },
        { Authorization: `Bearer ${verified}` },
      );
      return json({ ok: true, data: result });
    } catch (e) {
      console.error("secrets audit rpc failed:", e);
      return json({ error: "rpc_failed" }, 500);
    }
  }

  if (action === "set" || action === "delete") {
    const key = typeof params.key === "string" ? params.key : "";
    if (!isAllowedKey(key)) {
      return json({ error: "key_not_allowed" }, 400);
    }
    if (action === "delete" && UNDELETABLE_KEYS.has(key)) {
      return json({ error: "key_not_allowed" }, 400);
    }
    if (action === "set") {
      const value = params.value;
      if (typeof value !== "string" || value.length === 0 || value.length > 4096) {
        return json({ error: "invalid_value" }, 400);
      }
    }
    const bridgeBody =
      action === "set" ? { key, value: params.value } : { key };
    return await runBridgeAction(deps, action, bridgeBody, adminUserId);
  }

  return json({ error: "unknown_action" }, 400);
}

/**
 * Forward an action to the bridge and write the audit entry on success.
 * Never includes values in logs or error messages.
 */
async function runBridgeAction(
  deps: SecretsDeps,
  action: "list" | "set" | "delete" | "status",
  body: Record<string, unknown>,
  adminUserId: string,
): Promise<Response> {
  let result: { status: number; json: Record<string, unknown> };
  try {
    result = await deps.bridge.call(`/${action}`, body);
  } catch (e) {
    console.error("bridge call failed:", e instanceof Error ? e.message : e);
    return json({ error: "bridge_unreachable" }, 502);
  }
  if (result.status !== 200) {
    console.error(`bridge ${action} returned HTTP ${result.status}`);
    return json({ error: "bridge_error" }, result.status >= 500 ? 502 : 400);
  }

  // Audit: log key-level actions for the acting admin. List and status are
  // not logged (they reveal nothing beyond what the panel already shows).
  if (action === "set" || action === "delete") {
    const key = typeof body.key === "string" ? body.key : "";
    try {
      await deps.servicePostgrest("admin_log_secret_action", {
        p_action: action,
        p_key: key,
        p_admin_user_id: adminUserId,
      });
    } catch (e) {
      // Audit failure must not mask the successful bridge call.
      console.error("secrets audit log failed:", e instanceof Error ? e.message : e);
    }
  }

  return json({ ok: true, data: result.json });
}

// ---------------------------------------------------------------------------
// Default deps: real JWT verification, real PostgREST clients, real bridge
// ---------------------------------------------------------------------------

const JWT_SECRET = Deno.env.get("JWT_SECRET");
const SUPABASE_JWKS = parseJwks(Deno.env.get("SUPABASE_JWKS"));
const POSTGREST_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const BRIDGE_URL = (Deno.env.get("SECRET_BRIDGE_URL") ?? "http://host.docker.internal:8790")
  .replace(/\/+$/, "");
const BRIDGE_TOKEN = Deno.env.get("SECRET_BRIDGE_TOKEN") ?? "";

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

async function postgrestCall(
  fn: string,
  args: Record<string, unknown>,
  headers: Record<string, string>,
): Promise<unknown> {
  if (!POSTGREST_URL) {
    throw new Error("SUPABASE_URL not configured");
  }
  // Kong requires a real API key in the apikey header; the user JWT rides in
  // Authorization so PostgREST resolves auth.uid() inside the RPC.
  const baseHeaders = {
    "Content-Type": "application/json",
    apikey: ANON_KEY || headers.apikey || "",
  };
  const url = `${POSTGREST_URL.replace(/\/+$/, "")}/rest/v1/rpc/${fn}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...baseHeaders,
      ...headers,
    },
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

/**
 * Resolve the admin user id: run fn_is_admin as the user, and when true
 * return the token's sub claim.
 */
async function resolveAdminUserId(jwt: string): Promise<string | null> {
  try {
    const isAdmin = await postgrestCall(
      "fn_is_admin",
      {},
      { Authorization: `Bearer ${jwt}` },
    );
    if (isAdmin !== true) return null;
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
}

async function bridgeCall(
  path: string,
  body: Record<string, unknown>,
): Promise<{ status: number; json: Record<string, unknown> }> {
  if (!BRIDGE_TOKEN) {
    throw new Error("SECRET_BRIDGE_TOKEN not configured");
  }
  const res = await fetch(`${BRIDGE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Bridge-Token": BRIDGE_TOKEN,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, json };
}

const defaultDeps: SecretsDeps = {
  verify: verifyHybridJwt,
  adminUserId: resolveAdminUserId,
  postgrest: postgrestCall,
  servicePostgrest: (fn, args) =>
    postgrestCall(fn, args, {
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      apikey: SERVICE_ROLE_KEY,
    }),
  bridge: { call: bridgeCall },
};

if (typeof EdgeRuntime !== "undefined") {
  Deno.serve((req: Request) =>
    handleSecretsRequest(req, defaultDeps).catch((e) => {
      console.error("unhandled admin-secrets error:", e);
      return json({ error: "internal_error" }, 500);
    })
  );
}
