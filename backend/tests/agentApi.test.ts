/** Unit tests for the agent-api edge function (routing, auth, MCP, validation). */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  confirmationText,
  type AgentApiDeps,
  type ReportRequestBody,
  handleReport,
  handleStatus,
  route,
  validateReport,
} from "../functions/agent-api/index.ts";
import type { SubmitComplaintResult } from "../functions/_shared/types.ts";
import type { RpcClient } from "../functions/_shared/rpcClient.ts";

const KEY = "test-api-key";

/** Recording RPC stub. */
function makeRpc(
  submitResult: Record<string, unknown> = {
    tracking_no: "GMC-2026-00123",
    status: "received",
    institution: "nawec",
    institution_name: "NAWEC",
    department: "Water Distribution",
    expected_response_at: "2026-10-20T09:00:00+00:00",
    confidence: 0.86,
    sensitive: false,
    complaint_id: "11111111-1111-1111-1111-111111111111",
    duplicate: false,
  },
) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const rpc: RpcClient = {
    // deno-lint-ignore require-await
    async call<TArgs, TResult>(fnName: string, args: TArgs): Promise<TResult> {
      calls.push({ fn: fnName, args: args as Record<string, unknown> });
      if (fnName === "submit_complaint") return submitResult as TResult;
      if (fnName === "track_complaint") {
        return {
          tracking_no: "GMC-2026-00123",
          status: "in_progress",
          urgency: "high",
          title: "No water",
          institution: "NAWEC",
          department: null,
          expected_response_at: null,
          timeline: [{ status: "in_progress", message: "Technician assigned", at: "2026-10-19T10:00:00Z" }],
        } as TResult;
      }
      if (fnName === "fn_notify") return "22222222-2222-2222-2222-222222222222" as TResult;
      throw new Error(`unexpected fn ${fnName}`);
    },
  };
  return { rpc, calls };
}

function makeDeps(): { deps: AgentApiDeps; calls: Array<{ fn: string; args: Record<string, unknown> }> } {
  const { rpc, calls } = makeRpc();
  const fetches: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = ((
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    fetches.push({ url: String(input), init: init ?? {} });
    return Promise.resolve(new Response(JSON.stringify({ id: "email_1" }), { status: 200 }));
  }) as unknown as typeof fetch;
  return {
    deps: { rpc, fetchImpl, resendApiKey: "re_test", resendFrom: "test@example.com" },
    calls,
  };
}

function req(
  method: string,
  path: string,
  body?: unknown,
  key = KEY,
): Request {
  const headers: Record<string, string> = {};
  if (key) headers["Authorization"] = `Bearer ${key}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return new Request(`http://localhost${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// validateReport
// ---------------------------------------------------------------------------

Deno.test("validateReport accepts a valid report", () => {
  const r = validateReport({ text: "No water in Bakoteh since morning" });
  assertEquals(r.ok, true);
  if (r.ok) {
    assertEquals(r.channel, "whatsapp");
    assertEquals(r.peer, null);
  }
});

Deno.test("validateReport rejects short text", () => {
  const r = validateReport({ text: "hi" });
  assertEquals(r.ok, false);
});

Deno.test("validateReport rejects unknown channel", () => {
  const r = validateReport({ text: "No water in Bakoteh", channel: "sms" });
  assertEquals(r.ok, false);
});

Deno.test("validateReport truncates long peer and caps text length", () => {
  const long = "x".repeat(3000);
  const r = validateReport({ text: long, peer: "y".repeat(100) });
  assertEquals(r.ok, false); // text exceeds 2000
  const r2 = validateReport({ text: "No water in Bakoteh", peer: "y".repeat(100) });
  if (r2.ok) assertEquals(r2.peer?.length, 32);
});

// ---------------------------------------------------------------------------
// route: auth
// ---------------------------------------------------------------------------

Deno.test("route rejects missing/invalid API key", async () => {
  const { deps } = makeDeps();
  const res1 = await route(req("POST", "/report", { text: "No water" }), deps, "");
  assertEquals(res1.status, 401);
  const res2 = await route(req("POST", "/report", { text: "No water" }, "wrong"), deps);
  assertEquals(res2.status, 401);
});

Deno.test("route rejects unknown paths", async () => {
  const { deps } = makeDeps();
  const res = await route(req("GET", "/other"), deps, KEY);
  assertEquals(res.status, 404);
});

// ---------------------------------------------------------------------------
// POST /report
// ---------------------------------------------------------------------------

Deno.test("POST /report submits and returns tracking + confirmation", async () => {
  const { deps, calls } = makeDeps();
  const res = await route(
    req("POST", "/report", { text: "No water in Bakoteh since morning", peer: "2201234567" }),
    deps,
    KEY,
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.tracking_number, "GMC-2026-00123");
  assertEquals(body.confirmation_text.includes("GMC-2026-00123"), true);
  assertEquals(body.sms_queued, true);

  // submit_complaint called once with the report text
  const submit = calls.find((c) => c.fn === "submit_complaint");
  assertEquals(submit !== undefined, true);
  assertEquals((submit?.args as { p_description: string }).p_description, "No water in Bakoteh since morning");
  // SMS queued via existing fn_notify path
  const notify = calls.find((c) => c.fn === "fn_notify");
  assertEquals(notify !== undefined, true);
  assertEquals((notify?.args as { p_channel: string }).p_channel, "sms");
});

Deno.test("POST /report validates and rejects bad input without RPC calls", async () => {
  const { deps, calls } = makeDeps();
  const res = await route(req("POST", "/report", { text: "hi" }), deps, KEY);
  assertEquals(res.status, 400);
  assertEquals(calls.length, 0);
});

Deno.test("POST /report without a phone-like peer skips the SMS queue", async () => {
  const { deps, calls } = makeDeps();
  const res = await route(
    req("POST", "/report", { text: "No water in Bakoteh", peer: "tg-chat-42" }),
    deps,
    KEY,
  );
  const body = await res.json();
  assertEquals(body.sms_queued, false);
  assertEquals(calls.find((c) => c.fn === "fn_notify"), undefined);
});

Deno.test("confirmationText follows the shared copy contract", () => {
  const low = {
    tracking_no: "GMC-2026-00123",
    status: "received",
  } as unknown as SubmitComplaintResult;
  // confidence < 0.7 → triage copy
  const triage = confirmationText({ ...low, confidence: 0.4, institution: "x" });
  assertEquals(triage.includes("Central Desk"), true);
  const normal = confirmationText({
    ...low,
    confidence: 0.9,
    institution_name: "NAWEC",
    department: null,
  });
  assertEquals(normal.includes("NAWEC is responsible"), true);
});

// ---------------------------------------------------------------------------
// GET /status
// ---------------------------------------------------------------------------

Deno.test("GET /status proxies track_complaint", async () => {
  const { deps, calls } = makeDeps();
  const res = await route(req("GET", "/status?tracking=gmc-2026-00123"), deps, KEY);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.status, "in_progress");
  assertEquals(body.tracking_number, "GMC-2026-00123");
  const tc = calls.find((c) => c.fn === "track_complaint");
  assertEquals(tc !== undefined, true);
});

Deno.test("GET /status without tracking param is a 400", async () => {
  const { deps } = makeDeps();
  const res = await route(req("GET", "/status"), deps, KEY);
  assertEquals(res.status, 400);
});

Deno.test("GET /status unknown tracking returns not_found", async () => {
  const { rpc } = makeRpc();
  const deps: AgentApiDeps = {
    rpc: {
      // deno-lint-ignore require-await
      async call(_fn, _args) {
        return null as never;
      },
    },
    fetchImpl: fetch,
    resendApiKey: null,
    resendFrom: "t@e.com",
  };
  void rpc;
  const res = await handleStatus("GMC-2026-99999", deps);
  const body = await res.json();
  assertEquals(body.status, "not_found");
});

// ---------------------------------------------------------------------------
// MCP endpoint
// ---------------------------------------------------------------------------

Deno.test("MCP initialize returns protocol version", async () => {
  const { deps } = makeDeps();
  const res = await route(
    req("POST", "/mcp", { jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    deps,
    KEY,
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.result.protocolVersion, "2025-06-18");
  assertEquals(body.result.serverInfo.name, "gamciv-agent-api");
});

Deno.test("MCP tools/list exposes the two tools", async () => {
  const { deps } = makeDeps();
  const res = await route(
    req("POST", "/mcp", { jsonrpc: "2.0", id: 2, method: "tools/list" }),
    deps,
    KEY,
  );
  const body = await res.json();
  const names = body.result.tools.map((t: { name: string }) => t.name);
  assertEquals(names.includes("gamciv_report"), true);
  assertEquals(names.includes("gamciv_status"), true);
});

Deno.test("MCP tools/call gamciv_report files the report", async () => {
  const { deps, calls } = makeDeps();
  const res = await route(
    req("POST", "/mcp", {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "gamciv_report",
        arguments: { text: "No water in Bakoteh", peer: "2201234567", channel: "whatsapp" },
      },
    }),
    deps,
    KEY,
  );
  const body = await res.json();
  assertEquals(body.result.content[0].text.includes("GMC-2026-00123"), true);
  assertEquals(calls.find((c) => c.fn === "submit_complaint") !== undefined, true);
});

Deno.test("MCP tools/call gamciv_status returns status content", async () => {
  const { deps } = makeDeps();
  const res = await route(
    req("POST", "/mcp", {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "gamciv_status", arguments: { tracking: "GMC-2026-00123" } },
    }),
    deps,
    KEY,
  );
  const body = await res.json();
  assertEquals(body.result.content[0].text.includes("in_progress"), true);
});

Deno.test("MCP tools/call unknown tool returns a JSON-RPC error", async () => {
  const { deps } = makeDeps();
  const res = await route(
    req("POST", "/mcp", {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "nope", arguments: {} },
    }),
    deps,
    KEY,
  );
  const body = await res.json();
  assertEquals(body.error.code, -32602);
});

Deno.test("MCP notifications return 202 without a body", async () => {
  const { deps } = makeDeps();
  const res = await route(
    req("POST", "/mcp", { jsonrpc: "2.0", method: "notifications/initialized" }),
    deps,
    KEY,
  );
  assertEquals(res.status, 202);
});

// ---------------------------------------------------------------------------
// handleReport direct (SMS queue failure must not fail the report)
// ---------------------------------------------------------------------------

Deno.test("report still succeeds when the SMS queue fails", async () => {
  const { rpc } = makeRpc();
  let notifyCalls = 0;
  const deps: AgentApiDeps = {
    rpc: {
      // deno-lint-ignore require-await
      async call(fn, _args) {
        if (fn === "submit_complaint") {
          return {
            tracking_no: "GMC-2026-00123",
            status: "received",
            institution: "nawec",
            institution_name: "NAWEC",
            department: null,
            expected_response_at: "2026-10-20T09:00:00+00:00",
            confidence: 0.9,
            sensitive: false,
            complaint_id: "11111111-1111-1111-1111-111111111111",
            duplicate: false,
          } as never;
        }
        notifyCalls++;
        throw new Error("fn_notify down");
      },
    },
    fetchImpl: fetch,
    resendApiKey: null,
    resendFrom: "t@e.com",
  };
  void rpc;
  const body: ReportRequestBody = { text: "No water in Bakoteh", peer: "2201234567" };
  const res = await handleReport(body, deps);
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(json.tracking_number, "GMC-2026-00123");
  assertEquals(json.sms_queued, false);
  assertEquals(notifyCalls, 1);
});
