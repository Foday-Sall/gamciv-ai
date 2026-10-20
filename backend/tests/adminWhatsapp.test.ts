/**
 * Contract tests for the admin-whatsapp edge function.
 *
 * The router (`handleWhatsappRequest`) is exercised with injected deps:
 *   - `verify` is stubbed (valid token -> echoes the token, else null)
 *   - `adminUserId` is stubbed (returns an admin id unless disabled)
 *   - registry and GOWA clients are stubs that record their calls
 * so no network, real JWT verification, or running GOWA is involved.
 * Send endpoints are never exercised (the function does not have them).
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  handleWhatsappRequest,
  normalizePhone,
  joinViews,
  type WhatsappDeps,
  type RegistryRow,
  type GowaDevice,
} from "../functions/admin-whatsapp/index.ts";

const USER_JWT = "user.jwt.token";

interface RegistryCalls {
  upserts: Array<{ number: string; status: string; role: string }>;
  updates: Array<{ number: string; patch: Record<string, unknown> }>;
  deletes: Array<string>;
}

interface GowaCalls {
  created: Array<string>;
  deleted: Array<string>;
  codes: Array<{ deviceId: string; phone: string }>;
  logouts: Array<string>;
  statuses: Array<string>;
}

function makeRow(opts: Partial<RegistryRow> = {}): RegistryRow {
  return {
    id: "row-1",
    number: "220000000001",
    role: "chat",
    status: "pending",
    gowa_instance: "wa-220000000001",
    linked_at: null,
    revoked_at: null,
    created_at: new Date().toISOString(),
    ...opts,
  };
}

function makeDeps(opts: { admin?: boolean; registry?: RegistryRow[]; loggedIn?: boolean } = {}): {
  deps: WhatsappDeps;
  registryCalls: RegistryCalls;
  gowaCalls: GowaCalls;
} {
  const registry = opts.registry ?? [];
  const registryCalls: RegistryCalls = { upserts: [], updates: [], deletes: [] };
  const gowaCalls: GowaCalls = {
    created: [],
    deleted: [],
    codes: [],
    logouts: [],
    statuses: [],
  };

  const deps: WhatsappDeps = {
    verify: (jwt) => Promise.resolve(jwt === USER_JWT ? jwt : null),
    adminUserId: () => Promise.resolve(opts.admin === false ? null : "admin-user-id"),
    listRegistry: () => Promise.resolve(registry.map((row) => ({ ...row }))),
    upsertRegistry: (row) => {
      registryCalls.upserts.push({ number: row.number, status: row.status, role: row.role ?? "chat" });
      return Promise.resolve(makeRow({ number: row.number, status: row.status, role: row.role ?? "chat" }));
    },
    updateRegistry: (number, patch) => {
      registryCalls.updates.push({ number, patch: { ...patch } });
      return Promise.resolve(makeRow({ number, ...patch }));
    },
    deleteRegistry: (number) => {
      registryCalls.deletes.push(number);
      return Promise.resolve(true);
    },
    getSetting: () => Promise.resolve("220000000000"),
    gowaListDevices: () =>
      Promise.resolve(
        registry
          .filter((row) => row.gowa_instance)
          .map((row) => ({ id: row.gowa_instance!, state: row.status === "linked" ? "logged_in" : "disconnected" })),
      ),
    gowaCreateDevice: (deviceId) => {
      gowaCalls.created.push(deviceId);
      return Promise.resolve({ id: deviceId, state: "disconnected" });
    },
    gowaDeleteDevice: (deviceId) => {
      gowaCalls.deleted.push(deviceId);
      return Promise.resolve(true);
    },
    gowaPairingCode: (deviceId, phone) => {
      gowaCalls.codes.push({ deviceId, phone });
      return Promise.resolve("PAIR-CODE-1");
    },
    gowaStatus: (deviceId) => {
      gowaCalls.statuses.push(deviceId);
      return Promise.resolve({ is_logged_in: opts.loggedIn ?? false, jid: `${deviceId}@s.whatsapp.net` });
    },
    gowaLogout: (deviceId) => {
      gowaCalls.logouts.push(deviceId);
      return Promise.resolve(true);
    },
  };
  return { deps, registryCalls, gowaCalls };
}

function req(body: Record<string, unknown>, opts: { token?: string | null } = {}): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.token !== null) headers["Authorization"] = `Bearer ${opts.token ?? USER_JWT}`;
  return new Request("http://localhost", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

Deno.test("normalizePhone strips non-digits and enforces length", () => {
  assertEquals(normalizePhone("+220 511-1924"), "2205111924");
  assertEquals(normalizePhone("2205111924"), "2205111924");
  assertEquals(normalizePhone(""), null);
  assertEquals(normalizePhone("12345"), null);
  assertEquals(normalizePhone("not-a-phone"), null);
});

Deno.test("joinViews derives status from live GOWA state", () => {
  const registry = [makeRow({ status: "linked" })];
  const devices: GowaDevice[] = [{ id: "wa-220000000001", state: "disconnected" }];
  const views = joinViews(registry, devices);
  assertEquals(views[0].status, "revoked");
  assertEquals(views[0].gowaState, "disconnected");
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

Deno.test("missing token -> 401", async () => {
  const { deps } = makeDeps();
  const bare = new Request("http://localhost", {
    method: "POST",
    body: JSON.stringify({ action: "list_numbers" }),
  });
  const res = await handleWhatsappRequest(bare, deps);
  assertEquals(res.status, 401);
});

Deno.test("invalid token -> 401", async () => {
  const { deps } = makeDeps();
  const failing: WhatsappDeps = { ...deps, verify: () => Promise.resolve(null) };
  const res = await handleWhatsappRequest(req({ action: "list_numbers" }, { token: "bad" }), failing);
  assertEquals(res.status, 401);
});

Deno.test("non-admin -> 403", async () => {
  const { deps } = makeDeps({ admin: false });
  const res = await handleWhatsappRequest(req({ action: "list_numbers" }), deps);
  assertEquals(res.status, 403);
});

Deno.test("GET -> 405", async () => {
  const { deps } = makeDeps();
  const res = await handleWhatsappRequest(new Request("http://localhost", { method: "GET" }), deps);
  assertEquals(res.status, 405);
});

Deno.test("unknown action -> 400", async () => {
  const { deps } = makeDeps();
  const res = await handleWhatsappRequest(req({ action: "send_message" }), deps);
  assertEquals(res.status, 400);
});

Deno.test("missing action -> 400", async () => {
  const { deps } = makeDeps();
  const res = await handleWhatsappRequest(req({}), deps);
  assertEquals(res.status, 400);
});

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

Deno.test("list_numbers joins GOWA devices with the registry", async () => {
  const row = makeRow({ status: "linked", role: "otp" });
  const { deps } = makeDeps({ registry: [row] });
  const res = await handleWhatsappRequest(req({ action: "list_numbers" }), deps);
  assertEquals(res.status, 200);
  const body = (await res.json()) as { data: { numbers: Array<{ number: string; status: string; role: string }> } };
  assertEquals(body.data.numbers[0].number, "220000000001");
  assertEquals(body.data.numbers[0].role, "otp");
});

Deno.test("start_link creates the GOWA slot, stores pending, returns a code", async () => {
  const { deps, registryCalls, gowaCalls } = makeDeps();
  const res = await handleWhatsappRequest(
    req({ action: "start_link", params: { phone: "220000000002", role: "chat" } }),
    deps,
  );
  assertEquals(res.status, 200);
  const body = (await res.json()) as { data: { pairingCode: string; gowaInstance: string } };
  assertEquals(body.data.pairingCode, "PAIR-CODE-1");
  assertEquals(body.data.gowaInstance, "wa-220000000002");
  assertEquals(gowaCalls.created, ["wa-220000000002"]);
  assertEquals(gowaCalls.codes.length, 1);
  assertEquals(registryCalls.upserts.length, 1);
  assertEquals(registryCalls.upserts[0].status, "pending");
});

Deno.test("start_link rejects invalid phones", async () => {
  const { deps, gowaCalls } = makeDeps();
  const res = await handleWhatsappRequest(req({ action: "start_link", params: { phone: "12" } }), deps);
  assertEquals(res.status, 400);
  assertEquals(gowaCalls.created.length, 0);
});

Deno.test("confirm_link marks the number linked when GOWA is logged in", async () => {
  const row = makeRow({ number: "220000000003", status: "pending" });
  const { deps, registryCalls } = makeDeps({ registry: [row], loggedIn: true });
  const res = await handleWhatsappRequest(
    req({ action: "confirm_link", params: { phone: "220000000003" } }),
    deps,
  );
  assertEquals(res.status, 200);
  const body = (await res.json()) as { data: { status: string } };
  assertEquals(body.data.status, "linked");
  assertEquals(registryCalls.updates.length, 1);
  assertEquals(registryCalls.updates[0].patch.status, "linked");
});

Deno.test("confirm_link reports pending when not yet logged in", async () => {
  const row = makeRow({ number: "220000000004", status: "pending" });
  const { deps, registryCalls } = makeDeps({ registry: [row], loggedIn: false });
  const res = await handleWhatsappRequest(
    req({ action: "confirm_link", params: { phone: "220000000004" } }),
    deps,
  );
  assertEquals(res.status, 200);
  const body = (await res.json()) as { data: { status: string; loggedIn: boolean } };
  assertEquals(body.data.status, "pending");
  assertEquals(body.data.loggedIn, false);
  assertEquals(registryCalls.updates.length, 0);
});

Deno.test("confirm_link 404s for unknown numbers", async () => {
  const { deps } = makeDeps({ registry: [] });
  const res = await handleWhatsappRequest(
    req({ action: "confirm_link", params: { phone: "220000000005" } }),
    deps,
  );
  assertEquals(res.status, 404);
});

Deno.test("set_role updates the registry", async () => {
  const row = makeRow({ number: "220000000006" });
  const { deps, registryCalls } = makeDeps({ registry: [row] });
  const res = await handleWhatsappRequest(
    req({ action: "set_role", params: { phone: "220000000006", role: "otp" } }),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals(registryCalls.updates[0].patch.role, "otp");
});

Deno.test("set_role rejects invalid roles", async () => {
  const row = makeRow({ number: "220000000007" });
  const { deps, registryCalls } = makeDeps({ registry: [row] });
  const res = await handleWhatsappRequest(
    req({ action: "set_role", params: { phone: "220000000007", role: "sender" } }),
    deps,
  );
  assertEquals(res.status, 400);
  assertEquals(registryCalls.updates.length, 0);
});

Deno.test("revoke logs out the GOWA slot and marks revoked", async () => {
  const row = makeRow({ number: "220000000008", status: "linked" });
  const { deps, registryCalls, gowaCalls } = makeDeps({ registry: [row] });
  const res = await handleWhatsappRequest(
    req({ action: "revoke", params: { phone: "220000000008" } }),
    deps,
  );
  assertEquals(res.status, 200);
  const body = (await res.json()) as { data: { status: string; gowaLogoutOk: boolean } };
  assertEquals(body.data.status, "revoked");
  assertEquals(body.data.gowaLogoutOk, true);
  assertEquals(gowaCalls.logouts, ["wa-220000000001"]);
  assertEquals(registryCalls.updates[0].patch.status, "revoked");
});

Deno.test("delete_number removes the registry row and GOWA slot", async () => {
  const row = makeRow({ number: "220000000009" });
  const { deps, registryCalls, gowaCalls } = makeDeps({ registry: [row] });
  const res = await handleWhatsappRequest(
    req({ action: "delete_number", params: { phone: "220000000009" } }),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals(registryCalls.deletes, ["220000000009"]);
  assertEquals(gowaCalls.deleted, ["wa-220000000001"]);
});

Deno.test("get_sender prefers the registry over app_settings", async () => {
  const row = makeRow({ number: "220000000010", role: "otp", status: "linked" });
  const { deps } = makeDeps({ registry: [row] });
  const res = await handleWhatsappRequest(req({ action: "get_sender" }), deps);
  assertEquals(res.status, 200);
  const body = (await res.json()) as { data: { sender: string; source: string } };
  assertEquals(body.data.sender, "220000000010");
  assertEquals(body.data.source, "registry");
});

Deno.test("get_sender falls back to app_settings when the registry is empty", async () => {
  const { deps } = makeDeps({ registry: [] });
  const res = await handleWhatsappRequest(req({ action: "get_sender" }), deps);
  assertEquals(res.status, 200);
  const body = (await res.json()) as { data: { sender: string; source: string } };
  assertEquals(body.data.sender, "220000000000");
  assertEquals(body.data.source, "app_settings");
});
