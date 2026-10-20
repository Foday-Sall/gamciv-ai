/**
 * Contract tests for the admin-secrets edge function.
 *
 * The router (`handleSecretsRequest`) is exercised with injected deps:
 *   - `verify` is stubbed (valid token -> echoes the token, else null)
 *   - `adminUserId` is stubbed (returns an admin id unless disabled)
 *   - `postgrest` / `servicePostgrest` capture the RPC name and args
 *   - `bridge` captures the path and body it was called with
 * so no network, real JWT verification, or running bridge is involved.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  handleSecretsRequest,
  isAllowedKey,
  type BridgeDeps,
  type SecretsDeps,
} from "../functions/admin-secrets/index.ts";

const USER_JWT = "user.jwt.token";

interface BridgeCall {
  path: string;
  body: Record<string, unknown>;
}

interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
  asService: boolean;
}

interface Fixture {
  deps: SecretsDeps;
  bridgeCalls: BridgeCall[];
  rpcCalls: RpcCall[];
}

function makeDeps(opts: { admin?: boolean; bridgeStatus?: number } = {}): Fixture {
  const bridgeCalls: BridgeCall[] = [];
  const rpcCalls: RpcCall[] = [];

  const bridge: BridgeDeps = {
    call: (path, body) => {
      bridgeCalls.push({ path, body });
      return Promise.resolve({
        status: opts.bridgeStatus ?? 200,
        json: {
          ok: true,
          entries: [],
          last_reload: null,
          reload_ok: null,
        },
      });
    },
  };

  const deps: SecretsDeps = {
    verify: (jwt) => Promise.resolve(jwt),
    adminUserId: () => Promise.resolve(opts.admin === false ? null : "admin-uuid-1"),
    postgrest: (fn, args) => {
      rpcCalls.push({ fn, args, asService: false });
      return Promise.resolve({ ok: true });
    },
    servicePostgrest: (fn, args) => {
      rpcCalls.push({ fn, args, asService: true });
      return Promise.resolve({ ok: true });
    },
    bridge,
  };
  return { deps, bridgeCalls, rpcCalls };
}

function req(body: unknown): Request {
  return new Request("http://localhost/functions/v1/admin-secrets", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${USER_JWT}`,
    },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Key policy
// ---------------------------------------------------------------------------

Deno.test("isAllowedKey accepts every named key", () => {
  for (const key of ["RESEND_API_KEY", "GOWA_BASIC_AUTH", "TELEGRAM_BOT_TOKEN"]) {
    assertEquals(isAllowedKey(key), true, key);
  }
});

Deno.test("isAllowedKey accepts well-formed CUSTOM_ keys", () => {
  assertEquals(isAllowedKey("CUSTOM_TEST_KEY"), true);
  assertEquals(isAllowedKey("CUSTOM_A"), true);
  assertEquals(isAllowedKey("CUSTOM_ABC_123_X"), true);
});

Deno.test("isAllowedKey rejects bad keys", () => {
  assertEquals(isAllowedKey("CUSTOM_lowercase"), false);
  assertEquals(isAllowedKey("CUSTOM_"), false);
  assertEquals(isAllowedKey("PATH"), false);
  assertEquals(isAllowedKey(""), false);
  assertEquals(isAllowedKey("CUSTOM_" + "A".repeat(41)), false);
  assertEquals(isAllowedKey("custom_test"), false);
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

Deno.test("missing token -> 401", async () => {
  const { deps } = makeDeps();
  const bare = new Request("http://localhost", {
    method: "POST",
    body: JSON.stringify({ action: "list" }),
  });
  const res = await handleSecretsRequest(bare, deps);
  assertEquals(res.status, 401);
});

Deno.test("invalid token -> 401", async () => {
  const { deps } = makeDeps();
  const failing: SecretsDeps = { ...deps, verify: () => Promise.resolve(null) };
  const res = await handleSecretsRequest(req({ action: "list" }), failing);
  assertEquals(res.status, 401);
});

Deno.test("non-admin -> 403", async () => {
  const { deps } = makeDeps({ admin: false });
  const res = await handleSecretsRequest(req({ action: "list" }), deps);
  assertEquals(res.status, 403);
});

Deno.test("GET -> 405", async () => {
  const { deps } = makeDeps();
  const res = await handleSecretsRequest(
    new Request("http://localhost", { method: "GET" }),
    deps,
  );
  assertEquals(res.status, 405);
});

Deno.test("bad json -> 400", async () => {
  const { deps } = makeDeps();
  const res = await handleSecretsRequest(
    new Request("http://localhost", {
      method: "POST",
      headers: { Authorization: `Bearer ${USER_JWT}` },
      body: "not json",
    }),
    deps,
  );
  assertEquals(res.status, 400);
});

Deno.test("unknown action -> 400", async () => {
  const { deps } = makeDeps();
  const res = await handleSecretsRequest(req({ action: "nope" }), deps);
  assertEquals(res.status, 400);
});

Deno.test("missing action -> 400", async () => {
  const { deps } = makeDeps();
  const res = await handleSecretsRequest(req({}), deps);
  assertEquals(res.status, 400);
});

// ---------------------------------------------------------------------------
// list / get_status
// ---------------------------------------------------------------------------

Deno.test("list forwards to the bridge list endpoint", async () => {
  const { deps, bridgeCalls, rpcCalls } = makeDeps();
  const res = await handleSecretsRequest(req({ action: "list" }), deps);
  assertEquals(res.status, 200);
  assertEquals(bridgeCalls.length, 1);
  assertEquals(bridgeCalls[0].path, "/list");
  assertEquals(rpcCalls.length, 0);
});

Deno.test("get_status forwards to the bridge status endpoint", async () => {
  const { deps, bridgeCalls } = makeDeps();
  const res = await handleSecretsRequest(req({ action: "get_status" }), deps);
  assertEquals(res.status, 200);
  assertEquals(bridgeCalls[0].path, "/status");
});

// ---------------------------------------------------------------------------
// set / delete
// ---------------------------------------------------------------------------

Deno.test("set forwards to the bridge and audits via service role", async () => {
  const { deps, bridgeCalls, rpcCalls } = makeDeps();
  const res = await handleSecretsRequest(
    req({ action: "set", params: { key: "CUSTOM_TEST_KEY", value: "abc123" } }),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals(bridgeCalls.length, 1);
  assertEquals(bridgeCalls[0].path, "/set");
  assertEquals(bridgeCalls[0].body.key, "CUSTOM_TEST_KEY");
  assertEquals(bridgeCalls[0].body.value, "abc123");
  assertEquals(rpcCalls.length, 1);
  assertEquals(rpcCalls[0].asService, true);
  assertEquals(rpcCalls[0].fn, "admin_log_secret_action");
  assertEquals(rpcCalls[0].args.p_action, "set");
  assertEquals(rpcCalls[0].args.p_key, "CUSTOM_TEST_KEY");
  assertEquals(rpcCalls[0].args.p_admin_user_id, "admin-uuid-1");
});

Deno.test("set rejects disallowed keys without calling the bridge", async () => {
  const { deps, bridgeCalls, rpcCalls } = makeDeps();
  const res = await handleSecretsRequest(
    req({ action: "set", params: { key: "PATH", value: "x" } }),
    deps,
  );
  assertEquals(res.status, 400);
  assertEquals(bridgeCalls.length, 0);
  assertEquals(rpcCalls.length, 0);
});

Deno.test("set rejects non-string and empty values", async () => {
  const { deps } = makeDeps();
  for (const value of [null, 42, "", "x".repeat(4097)]) {
    const res = await handleSecretsRequest(
      req({ action: "set", params: { key: "CUSTOM_TEST_KEY", value } }),
      deps,
    );
    assertEquals(res.status, 400, String(value).slice(0, 10));
  }
});

Deno.test("delete forwards to the bridge and audits", async () => {
  const { deps, bridgeCalls, rpcCalls } = makeDeps();
  const res = await handleSecretsRequest(
    req({ action: "delete", params: { key: "CUSTOM_TEST_KEY" } }),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals(bridgeCalls[0].path, "/delete");
  assertEquals(rpcCalls[0].fn, "admin_log_secret_action");
  assertEquals(rpcCalls[0].args.p_action, "delete");
});

Deno.test("delete rejects SECRET_BRIDGE_TOKEN", async () => {
  const { deps, bridgeCalls } = makeDeps();
  const res = await handleSecretsRequest(
    req({ action: "delete", params: { key: "SECRET_BRIDGE_TOKEN" } }),
    deps,
  );
  assertEquals(res.status, 400);
  assertEquals(bridgeCalls.length, 0);
});

Deno.test("set allows rotating SECRET_BRIDGE_TOKEN", async () => {
  const { deps, bridgeCalls } = makeDeps();
  const res = await handleSecretsRequest(
    req({ action: "set", params: { key: "SECRET_BRIDGE_TOKEN", value: "next-token" } }),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals(bridgeCalls[0].body.key, "SECRET_BRIDGE_TOKEN");
});

// ---------------------------------------------------------------------------
// get_audit
// ---------------------------------------------------------------------------

Deno.test("get_audit calls the admin list rpc as the user", async () => {
  const { deps, rpcCalls } = makeDeps();
  const res = await handleSecretsRequest(req({ action: "get_audit" }), deps);
  assertEquals(res.status, 200);
  assertEquals(rpcCalls.length, 1);
  assertEquals(rpcCalls[0].asService, false);
  assertEquals(rpcCalls[0].fn, "admin_list_secret_audit");
  assertEquals(rpcCalls[0].args.p_limit, 50);
});

// ---------------------------------------------------------------------------
// Bridge failures
// ---------------------------------------------------------------------------

Deno.test("bridge 500 -> 502, no audit entry", async () => {
  const { deps, bridgeCalls, rpcCalls } = makeDeps({ bridgeStatus: 500 });
  const res = await handleSecretsRequest(
    req({ action: "set", params: { key: "CUSTOM_TEST_KEY", value: "abc" } }),
    deps,
  );
  assertEquals(res.status, 502);
  assertEquals(bridgeCalls.length, 1);
  assertEquals(rpcCalls.length, 0);
});

Deno.test("bridge 400 -> 400, no audit entry", async () => {
  const { deps, rpcCalls } = makeDeps({ bridgeStatus: 400 });
  const res = await handleSecretsRequest(
    req({ action: "set", params: { key: "CUSTOM_TEST_KEY", value: "abc" } }),
    deps,
  );
  assertEquals(res.status, 400);
  assertEquals(rpcCalls.length, 0);
});
