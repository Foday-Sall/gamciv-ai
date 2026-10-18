/** Unit tests for the notify-out pipeline (stubbed deps, no network). */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type ClaimRow, handleRequest, type NotifyOutDeps } from "../functions/notify-out/index.ts";
import {
  buildSmsClient,
  FetchHttpGatewayClient,
  selectSmsProvider,
  type SmsClient,
} from "../functions/notify-out/smsProvider.ts";

interface Recorded {
  rpcCalls: Array<{ fn: string; args: unknown }>;
  gowaSends: Array<{ phone: string; message: string }>;
}

function makeClaim(overrides: Partial<ClaimRow> = {}): ClaimRow {
  return {
    notification_id: "d19617d7-bb02-4ef4-b848-5201e16f621f",
    channel: "whatsapp",
    recipient: "+2207123456",
    message: "Received. Reference GC-2026-00001. NAWEC is responsible.",
    ...overrides,
  };
}

function makeDeps(
  opts: {
    claim?: ClaimRow | null | Error;
    gowaError?: Error;
    gowaStatus?: string;
    sms?: SmsClient | null;
  } = {},
): { deps: NotifyOutDeps; recorded: Recorded } {
  const recorded: Recorded = { rpcCalls: [], gowaSends: [] };
  const deps: NotifyOutDeps = {
    gowa: {
      sendMessage: (phone: string, message: string) => {
        recorded.gowaSends.push({ phone, message });
        if (opts.gowaError) return Promise.reject(opts.gowaError);
        return Promise.resolve({ messageId: "gowa-123", status: opts.gowaStatus ?? "sent" });
      },
    },
    sms: opts.sms ?? null,
    rpc: {
      call: (fn: string, args: unknown) => {
        recorded.rpcCalls.push({ fn, args });
        if (opts.claim instanceof Error) return Promise.reject(opts.claim);
        if (fn === "notify_out_claim") {
          const c = opts.claim !== undefined ? (opts.claim as ClaimRow | null) : makeClaim();
          return Promise.resolve(c as never);
        }
        return Promise.resolve(true as never);
      },
    },
  };
  return { deps, recorded };
}

function req(notificationId: string | null): Request {
  return new Request("http://localhost/functions/v1/notify-out", {
    method: "POST",
    headers: { "x-gamciv-key": "testkey" },
    body: JSON.stringify(notificationId === null ? {} : { notification_id: notificationId }),
  });
}

Deno.test("notify-out: happy path WhatsApp send + result reported", async () => {
  const { deps, recorded } = makeDeps();
  const res = await handleRequest(req("d19617d7-bb02-4ef4-b848-5201e16f621f"), deps, "testkey");
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(json.status, "sent");
  assertEquals(json.channel, "whatsapp");
  assertEquals(recorded.rpcCalls[0].fn, "notify_out_claim");
  assertEquals(recorded.rpcCalls[1].fn, "notify_out_result");
  assertEquals((recorded.rpcCalls[1].args as Record<string, unknown>).p_status, "sent");
  assertEquals(recorded.gowaSends.length, 1);
  assertEquals(recorded.gowaSends[0].phone, "+2207123456");
});

Deno.test("notify-out: SMS path via configured provider", async () => {
  const recordedSms: Array<{ to: string; message: string }> = [];
  const sms: SmsClient = {
    sendSms: (to, message) => {
      recordedSms.push({ to, message });
      return Promise.resolve({ status: "success", message_id: "tm-1", error: null });
    },
  };
  const { deps, recorded } = makeDeps({ claim: makeClaim({ channel: "sms" }), sms });
  const res = await handleRequest(req("d19617d7-bb02-4ef4-b848-5201e16f621f"), deps, "testkey");
  const json = await res.json();
  assertEquals(json.status, "sent");
  assertEquals(json.channel, "sms");
  assertEquals(recordedSms.length, 1);
  assertEquals((recorded.rpcCalls[1].args as Record<string, unknown>).p_provider_ref, "tm-1");
});

Deno.test("notify-out: missing sms config records failure, no throw", async () => {
  const { deps, recorded } = makeDeps({ claim: makeClaim({ channel: "sms" }) });
  const res = await handleRequest(req("d19617d7-bb02-4ef4-b848-5201e16f621f"), deps, "testkey");
  const json = await res.json();
  assertEquals(json.status, "failed");
  assertEquals((recorded.rpcCalls[1].args as Record<string, unknown>).p_status, "failed");
});

Deno.test("notify-out: provider failure is recorded as failed (no retry loop)", async () => {
  const { deps, recorded } = makeDeps({ gowaError: new Error("gowa 500") });
  const res = await handleRequest(req("d19617d7-bb02-4ef4-b848-5201e16f621f"), deps, "testkey");
  const json = await res.json();
  assertEquals(json.status, "failed");
  assertEquals((recorded.rpcCalls[1].args as Record<string, unknown>).p_status, "failed");
});

Deno.test("notify-out: gowa non-sent status is a failure", async () => {
  const { deps, recorded } = makeDeps({ gowaStatus: "queued" });
  const res = await handleRequest(req("d19617d7-bb02-4ef4-b848-5201e16f621f"), deps, "testkey");
  const json = await res.json();
  assertEquals(json.status, "failed");
  assertEquals(
    (recorded.rpcCalls[1].args as Record<string, unknown>).p_error,
    "gowa status queued",
  );
});

Deno.test("notify-out: unclaimable id returns noop without sends", async () => {
  const { deps, recorded } = makeDeps({ claim: null });
  const res = await handleRequest(req("d19617d7-bb02-4ef4-b848-5201e16f621f"), deps, "testkey");
  const json = await res.json();
  assertEquals(json.status, "noop");
  assertEquals(recorded.gowaSends.length, 0);
  assertEquals(recorded.rpcCalls.length, 1);
});

Deno.test("notify-out: missing recipient records failure without sending", async () => {
  const { deps, recorded } = makeDeps({ claim: makeClaim({ recipient: null }) });
  const res = await handleRequest(req("d19617d7-bb02-4ef4-b848-5201e16f621f"), deps, "testkey");
  const json = await res.json();
  assertEquals(json.status, "failed");
  assertEquals(recorded.gowaSends.length, 0);
  assertEquals(recorded.rpcCalls.length, 2);
});

Deno.test("notify-out: wrong key → 401", async () => {
  const { deps } = makeDeps();
  const res = await handleRequest(req("d19617d7-bb02-4ef4-b848-5201e16f621f"), deps, "testkey");
  const res2 = await handleRequest(
    new Request("http://localhost/", {
      method: "POST",
      headers: { "x-gamciv-key": "wrong" },
      body: `{"notification_id":"d19617d7-bb02-4ef4-b848-5201e16f621f"}`,
    }),
    deps,
    "testkey",
  );
  assertEquals(res.status, 200);
  assertEquals(res2.status, 401);
});

Deno.test("notify-out: missing notification_id → 400", async () => {
  const { deps } = makeDeps();
  const res = await handleRequest(req(null), deps, "testkey");
  assertEquals(res.status, 400);
});

// ---- SMS provider selection & http_gateway client ----

function fakeEnv(vars: Record<string, string>) {
  return { get: (key: string) => vars[key] };
}

Deno.test("smsProvider: explicit termii selection", () => {
  assertEquals(
    selectSmsProvider(fakeEnv({ SMS_PROVIDER: "termii", TERMII_API_KEY: "k" })),
    "termii",
  );
  assertEquals(selectSmsProvider(fakeEnv({ SMS_PROVIDER: "termii" })), null);
});

Deno.test("smsProvider: explicit http_gateway selection", () => {
  assertEquals(
    selectSmsProvider(fakeEnv({
      SMS_PROVIDER: "http_gateway",
      HTTP_GATEWAY_URL: "https://x",
      HTTP_GATEWAY_API_KEY: "k",
    })),
    "http_gateway",
  );
  assertEquals(
    selectSmsProvider(fakeEnv({ SMS_PROVIDER: "http_gateway", HTTP_GATEWAY_URL: "https://x" })),
    null,
  );
});

Deno.test("smsProvider: auto-detect prefers http_gateway, falls back to termii", () => {
  assertEquals(
    selectSmsProvider(fakeEnv({
      HTTP_GATEWAY_URL: "https://x",
      HTTP_GATEWAY_API_KEY: "k",
      TERMII_API_KEY: "t",
    })),
    "http_gateway",
  );
  assertEquals(selectSmsProvider(fakeEnv({ TERMII_API_KEY: "t" })), "termii");
  assertEquals(selectSmsProvider(fakeEnv({})), null);
});

Deno.test("smsProvider: unknown SMS_PROVIDER falls back to auto-detect", () => {
  assertEquals(
    selectSmsProvider(fakeEnv({ SMS_PROVIDER: "carrier_pigeon", TERMII_API_KEY: "t" })),
    "termii",
  );
});

Deno.test("smsProvider: buildSmsClient returns matching client or null", () => {
  const gw = buildSmsClient(fakeEnv({
    SMS_PROVIDER: "http_gateway",
    HTTP_GATEWAY_URL: "https://gw.example",
    HTTP_GATEWAY_API_KEY: "k",
  }));
  assertEquals(gw instanceof FetchHttpGatewayClient, true);
  const tm = buildSmsClient(fakeEnv({ SMS_PROVIDER: "termii", TERMII_API_KEY: "k" }));
  assertEquals(tm !== null && tm.constructor.name !== "FetchHttpGatewayClient", true);
  assertEquals(buildSmsClient(fakeEnv({})), null);
});

Deno.test("smsProvider: http_gateway sends TextBee-shaped request with x-api-key", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const client = new FetchHttpGatewayClient(
    {
      baseUrl: "https://api.textbee.dev/api/v1",
      apiKey: "SECRET_KEY",
      authHeader: "x-api-key",
      deviceId: null,
    },
    ((url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedInit = init;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              success: true,
              message: "SMS added to queue",
              smsBatchId: "batch123",
              recipientCount: 1,
            },
          }),
          { status: 200 },
        ),
      );
    }) as typeof fetch,
  );
  const result = await client.sendSms("+2207771234", "Hello from GamCiv");
  assertEquals(result.status, "success");
  assertEquals(result.message_id, "batch123");
  assertEquals(capturedUrl, "https://api.textbee.dev/api/v1/gateway/send-sms");
  const headers = capturedInit?.headers as Record<string, string>;
  assertEquals(headers["x-api-key"], "SECRET_KEY");
  const body = JSON.parse(capturedInit?.body as string);
  assertEquals(body.recipients, ["+2207771234"]);
  assertEquals(body.message, "Hello from GamCiv");
});

Deno.test("smsProvider: http_gateway accepts queued batch without success flag", async () => {
  const client = new FetchHttpGatewayClient(
    {
      baseUrl: "https://api.textbee.dev/api/v1",
      apiKey: "SECRET_KEY",
      authHeader: "x-api-key",
      deviceId: null,
    },
    (() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: { smsBatchId: "b-9", recipientCount: 1 } }), {
          status: 200,
        }),
      )) as typeof fetch,
  );
  const result = await client.sendSms("+2207771234", "hi");
  assertEquals(result.status, "success");
  assertEquals(result.message_id, "b-9");
});

Deno.test("smsProvider: http_gateway bearer auth header", async () => {
  let capturedInit: RequestInit | undefined;
  const client = new FetchHttpGatewayClient(
    {
      baseUrl: "https://gw.example",
      apiKey: "SECRET_KEY",
      authHeader: "bearer",
      deviceId: null,
    },
    ((_url: string | URL | Request, init?: RequestInit) => {
      capturedInit = init;
      return Promise.resolve(
        new Response(JSON.stringify({ data: { success: true, smsBatchId: "b2" } }), {
          status: 200,
        }),
      );
    }) as typeof fetch,
  );
  await client.sendSms("+2207771234", "hi");
  const headers = capturedInit?.headers as Record<string, string>;
  assertEquals(headers["Authorization"], "Bearer SECRET_KEY");
});

Deno.test("smsProvider: http_gateway non-2xx is an error", async () => {
  const client = new FetchHttpGatewayClient(
    {
      baseUrl: "https://gw.example",
      apiKey: "SECRET_KEY",
      authHeader: "x-api-key",
      deviceId: null,
    },
    (() =>
      Promise.resolve(
        new Response(JSON.stringify({ message: "No enabled device found" }), { status: 400 }),
      )) as typeof fetch,
  );
  const result = await client.sendSms("+2207771234", "hi");
  assertEquals(result.status, "error");
  assertEquals(result.message_id, null);
  assertEquals(result.error?.startsWith("HTTP 400"), true);
});
