/**
 * Admin API edge function.
 *
 * Single POST endpoint. Every request must carry a valid Supabase JWT
 * (Authorization: Bearer <jwt>); it is verified with the same hybrid
 * HS256 / RS256 / ES256 pattern used by the main dispatcher, then forwarded
 * to PostgREST as the *user's* token so auth.uid() resolves inside the
 * SECURITY DEFINER admin RPCs.
 *
 * Body: { "action": "<panel action>", "params": { ... } }
 *
 * Routing table (panel action -> public.admin_* RPC):
 *   getOverviewStats       -> admin_get_overview_stats
 *   getInstitutions        -> admin_list_institutions
 *   createInstitution      -> admin_create_institution
 *   getOfficers            -> admin_list_officers
 *   createOfficer          -> admin_invite_officer
 *   toggleOfficerActive    -> admin_toggle_officer_active
 *   getAccessLimits        -> admin_get_access_limits
 *   setAccessLevel         -> admin_set_access_level
 *   setAllowedCategories   -> admin_set_allowed_categories
 *   setSlaHours            -> admin_set_sla_hours
 *   setRateLimit           -> admin_set_rate_limit
 *   getAuditLog            -> admin_get_audit_log
 *   getSettings            -> admin_get_settings
 *   saveSettings           -> admin_save_settings
 *
 * Unknown / missing action -> 400. Invalid token -> 401.
 */
import * as jose from "jsr:@panva/jose@6";

// `EdgeRuntime` is a global provided only inside the Supabase edge-runtime
// container; declare it so `deno check` passes outside that container.
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
// Panel action -> RPC argument mapper
// ---------------------------------------------------------------------------

export interface AdminDeps {
  /** Verify a JWT; resolve to the token when valid, null when invalid. */
  verify: (jwt: string) => Promise<string | null>;
  /** POST JSON to PostgREST with the given headers; returns parsed JSON. */
  postgrest: (
    fn: string,
    args: Record<string, unknown>,
    headers: Record<string, string>,
  ) => Promise<unknown>;
}

interface RouteDef {
  rpc: string;
  map?: (params: Record<string, unknown>) => Record<string, unknown>;
}

export const ROUTES: Record<string, RouteDef> = {
  getOverviewStats: { rpc: "admin_get_overview_stats" },
  getInstitutions: { rpc: "admin_list_institutions" },
  createInstitution: {
    rpc: "admin_create_institution",
    map: (p) => ({
      p_name: p.name,
      p_shortcode: p.shortcode,
      p_contact_email: p.contact_email,
      p_phone: p.phone,
      p_category_scope: p.category_scope,
    }),
  },
  getOfficers: { rpc: "admin_list_officers" },
  createOfficer: {
    rpc: "admin_invite_officer",
    map: (p) => ({
      p_name: p.name,
      p_email: p.email,
      p_institution_id: p.institution_id,
      p_role: p.role,
      p_department: p.department,
    }),
  },
  toggleOfficerActive: {
    rpc: "admin_toggle_officer_active",
    map: (p) => ({ p_officer_id: p.officer_id, p_active: p.active }),
  },
  getAccessLimits: {
    rpc: "admin_get_access_limits",
    map: (p) => ({ p_institution_id: p.institution_id }),
  },
  setAccessLevel: {
    rpc: "admin_set_access_level",
    map: (p) => ({ p_institution_id: p.institution_id, p_level: p.level }),
  },
  setAllowedCategories: {
    rpc: "admin_set_allowed_categories",
    map: (p) => ({ p_institution_id: p.institution_id, p_categories: p.categories }),
  },
  setSlaHours: {
    rpc: "admin_set_sla_hours",
    map: (p) => ({ p_institution_id: p.institution_id, p_hours: p.hours }),
  },
  setRateLimit: {
    rpc: "admin_set_rate_limit",
    map: (p) => ({ p_institution_id: p.institution_id, p_max: p.max }),
  },
  getAuditLog: {
    rpc: "admin_get_audit_log",
    map: (p) => (p.limit === undefined ? {} : { p_limit: p.limit }),
  },
  getSettings: { rpc: "admin_get_settings" },
  saveSettings: {
    rpc: "admin_save_settings",
    map: (p) => ({ p_settings: p.settings }),
  },
};

function json(res: unknown, status = 200): Response {
  return new Response(JSON.stringify(res), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Pure request handler — injectable deps make it unit-testable without
 * network access or real JWT verification.
 */
export async function handleAdminRequest(
  req: Request,
  deps: AdminDeps,
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

  const route = ROUTES[action];
  if (!route) {
    return json({ error: "unknown_action" }, 400);
  }

  // ---- Forward to PostgREST as the user ----
  const args = route.map ? route.map(params) : {};
  try {
    const result = await deps.postgrest(route.rpc, args, {
      Authorization: `Bearer ${verified}`,
      apikey: verified,
    });
    return json({ ok: true, data: result });
  } catch (e) {
    console.error("admin rpc failed:", route.rpc, e);
    return json({ error: "rpc_failed" }, 500);
  }
}

// ---------------------------------------------------------------------------
// Default deps: real JWT verification + real PostgREST client
// ---------------------------------------------------------------------------

const JWT_SECRET = Deno.env.get("JWT_SECRET");
const SUPABASE_JWKS = parseJwks(Deno.env.get("SUPABASE_JWKS"));
const POSTGREST_URL = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("NEXT_PUBLIC_SUPABASE_URL") ?? "";
const POSTGREST_KEY = Deno.env.get("SUPABASE_ANON_KEY") ??
  Deno.env.get("NEXT_PUBLIC_SUPABASE_ANON_KEY") ?? "";

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
  const url = `${POSTGREST_URL.replace(/\/+$/, "")}/rest/v1/rpc/${fn}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
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

const defaultDeps: AdminDeps = {
  verify: verifyHybridJwt,
  postgrest: postgrestCall,
};

if (typeof EdgeRuntime !== "undefined") {
  Deno.serve((req: Request) =>
    handleAdminRequest(req, defaultDeps).catch((e) => {
      console.error("unhandled admin-api error:", e);
      return json({ error: "internal_error" }, 500);
    })
  );
}
