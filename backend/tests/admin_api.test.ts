/**
 * Contract tests for the admin-api edge function.
 *
 * The router (`handleAdminRequest`) is exercised with injected deps:
 *   - `verify` is stubbed (valid token -> echoes the token, else null)
 *   - `postgrest` captures the RPC name / args / headers it was called with
 * so no network or real JWT verification is involved.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  handleAdminRequest,
  type AdminDeps,
  ROUTES,
} from "../functions/admin-api/index.ts";

const USER_JWT = "user.jwt.token";

interface Captured {
  rpc: string;
  args: Record<string, unknown>;
  headers: Record<string, string>;
}

function makeDeps(opts: { valid?: boolean } = {}): {
  deps: AdminDeps;
  captured: Captured[];
} {
  const captured: Captured[] = [];
  const deps: AdminDeps = {
    verify: (jwt) => Promise.resolve(opts.valid === false ? null : jwt),
    postgrest: (fn, args, headers) => {
      captured.push({ rpc: fn, args, headers });
      return Promise.resolve({ ok: true });
    },
  };
  return { deps, captured };
}

function req(
  body: unknown,
  headers: Record<string, string> = { authorization: `Bearer ${USER_JWT}` },
): Request {
  return new Request("http://localhost/functions/v1/admin-api", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Routing table: every panel action maps to the right RPC
// ---------------------------------------------------------------------------

const ACTION_TO_RPC: Record<string, string> = {
  getOverviewStats: "admin_get_overview_stats",
  getInstitutions: "admin_list_institutions",
  createInstitution: "admin_create_institution",
  getOfficers: "admin_list_officers",
  createOfficer: "admin_invite_officer",
  toggleOfficerActive: "admin_toggle_officer_active",
  getAccessLimits: "admin_get_access_limits",
  setAccessLevel: "admin_set_access_level",
  setAllowedCategories: "admin_set_allowed_categories",
  setSlaHours: "admin_set_sla_hours",
  setRateLimit: "admin_set_rate_limit",
  getAuditLog: "admin_get_audit_log",
  getSettings: "admin_get_settings",
  saveSettings: "admin_save_settings",
};

Deno.test("admin-api: ROUTES covers exactly the 14 panel actions", () => {
  assertEquals(Object.keys(ROUTES).sort(), Object.keys(ACTION_TO_RPC).sort());
});

Deno.test("admin-api: each action routes to the correct RPC name", async () => {
  for (const [action, rpc] of Object.entries(ACTION_TO_RPC)) {
    const { deps, captured } = makeDeps();
    const res = await handleAdminRequest(req({ action, params: {} }), deps);
    assertEquals(res.status, 200, `action ${action}`);
    assertEquals(captured.length, 1, `action ${action}`);
    assertEquals(captured[0].rpc, rpc, `action ${action}`);
    const json = await res.json();
    assertEquals(json.ok, true, `action ${action}`);
  }
});

Deno.test("admin-api: forwards user JWT as Authorization and apikey headers", async () => {
  const { deps, captured } = makeDeps();
  await handleAdminRequest(req({ action: "getOverviewStats" }), deps);
  assertEquals(captured[0].headers["Authorization"], `Bearer ${USER_JWT}`);
  assertEquals(captured[0].headers.apikey, USER_JWT);
});

// ---------------------------------------------------------------------------
// Parameter mapping
// ---------------------------------------------------------------------------

Deno.test("admin-api: createInstitution maps panel fields to RPC args", async () => {
  const { deps, captured } = makeDeps();
  await handleAdminRequest(
    req({
      action: "createInstitution",
      params: {
        name: "NAWEC",
        shortcode: "NAWEC",
        contact_email: "info@nawec.gm",
        phone: "+220 437 0000",
        category_scope: ["water", "electricity"],
      },
    }),
    deps,
  );
  assertEquals(captured[0].rpc, "admin_create_institution");
  assertEquals(captured[0].args, {
    p_name: "NAWEC",
    p_shortcode: "NAWEC",
    p_contact_email: "info@nawec.gm",
    p_phone: "+220 437 0000",
    p_category_scope: ["water", "electricity"],
  });
});

Deno.test("admin-api: createOfficer maps panel fields to RPC args", async () => {
  const { deps, captured } = makeDeps();
  await handleAdminRequest(
    req({
      action: "createOfficer",
      params: {
        name: "Fatou Sarr",
        email: "fatou@gov.gm",
        institution_id: "00000000-0000-0000-0000-000000000001",
        role: "officer",
        department: "Water",
      },
    }),
    deps,
  );
  assertEquals(captured[0].rpc, "admin_invite_officer");
  assertEquals(captured[0].args, {
    p_name: "Fatou Sarr",
    p_email: "fatou@gov.gm",
    p_institution_id: "00000000-0000-0000-0000-000000000001",
    p_role: "officer",
    p_department: "Water",
  });
});

Deno.test("admin-api: toggleOfficerActive maps officer_id and active", async () => {
  const { deps, captured } = makeDeps();
  await handleAdminRequest(
    req({
      action: "toggleOfficerActive",
      params: {
        officer_id: "00000000-0000-0000-0000-000000000002",
        active: false,
      },
    }),
    deps,
  );
  assertEquals(captured[0].rpc, "admin_toggle_officer_active");
  assertEquals(captured[0].args, {
    p_officer_id: "00000000-0000-0000-0000-000000000002",
    p_active: false,
  });
});

Deno.test("admin-api: getAuditLog omits p_limit when not provided", async () => {
  const { deps, captured } = makeDeps();
  await handleAdminRequest(req({ action: "getAuditLog" }), deps);
  assertEquals(captured[0].args, {});

  await handleAdminRequest(req({ action: "getAuditLog", params: { limit: 25 } }), deps);
  assertEquals(captured[1].args, { p_limit: 25 });
});

// ---------------------------------------------------------------------------
// Error contract
// ---------------------------------------------------------------------------

Deno.test("admin-api: unknown action -> 400 unknown_action", async () => {
  const { deps } = makeDeps();
  const res = await handleAdminRequest(req({ action: "dropTables" }), deps);
  assertEquals(res.status, 400);
  const json = await res.json();
  assertEquals(json.error, "unknown_action");
});

Deno.test("admin-api: missing action -> 400", async () => {
  const { deps } = makeDeps();
  const res = await handleAdminRequest(req({ params: {} }), deps);
  assertEquals(res.status, 400);
});

Deno.test("admin-api: missing Authorization header -> 401 invalid_token", async () => {
  const { deps, captured } = makeDeps();
  const res = await handleAdminRequest(req({ action: "getOverviewStats" }, {}), deps);
  assertEquals(res.status, 401);
  const json = await res.json();
  assertEquals(json.error, "invalid_token");
  assertEquals(captured.length, 0);
});

Deno.test("admin-api: malformed Authorization header -> 401", async () => {
  const { deps } = makeDeps();
  const res = await handleAdminRequest(
    req({ action: "getOverviewStats" }, { authorization: "Token abc" }),
    deps,
  );
  assertEquals(res.status, 401);
});

Deno.test("admin-api: invalid token (verification fails) -> 401", async () => {
  const { deps, captured } = makeDeps({ valid: false });
  const res = await handleAdminRequest(req({ action: "getOverviewStats" }), deps);
  assertEquals(res.status, 401);
  const json = await res.json();
  assertEquals(json.error, "invalid_token");
  assertEquals(captured.length, 0);
});

Deno.test("admin-api: invalid JSON body -> 400", async () => {
  const { deps } = makeDeps();
  const res = await handleAdminRequest(req("{not json"), deps);
  assertEquals(res.status, 400);
});

Deno.test("admin-api: non-POST -> 405", async () => {
  const { deps } = makeDeps();
  const res = await handleAdminRequest(
    new Request("http://localhost/functions/v1/admin-api", { method: "GET" }),
    deps,
  );
  assertEquals(res.status, 405);
});

Deno.test("admin-api: postgrest failure -> 500 rpc_failed", async () => {
  const deps: AdminDeps = {
    verify: (jwt) => Promise.resolve(jwt),
    postgrest: () => Promise.reject(new Error("boom")),
  };
  const res = await handleAdminRequest(req({ action: "getSettings" }), deps);
  assertEquals(res.status, 500);
  const json = await res.json();
  assertEquals(json.error, "rpc_failed");
});
