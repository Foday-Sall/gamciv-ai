/** Unit tests for the whatsapp-intake pipeline (stubbed deps, no network). */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  confirmationText,
  handleRequest,
  type IntakeDeps,
  looksLikeGreeting,
  processReport,
} from "../functions/whatsapp-intake/index.ts";
import type { ExtractedMessage } from "../functions/_shared/gowaClient.ts";
import type { SubmitComplaintArgs, SubmitComplaintResult } from "../functions/_shared/types.ts";

function makeMsg(overrides: Partial<ExtractedMessage> = {}): ExtractedMessage {
  return {
    messageId: "MSG-1",
    phone: "2207123456",
    name: "Lamin",
    body: "No water in Bakoteh since morning",
    imageUrl: null,
    lat: null,
    lng: null,
    isGroup: false,
    isFromMe: false,
    ...overrides,
  };
}

const baseResult: SubmitComplaintResult = {
  status: "received",
  tracking_no: "GC-2026-00001",
  institution: "nawec",
  institution_name: "NAWEC",
  department: "Water Distribution",
  expected_response_at: "2026-10-20T09:00:00+00:00",
  confidence: 0.9,
  sensitive: false,
  group_id: null,
};

interface Recorded {
  aiCalls: string[];
  rpcCalls: Array<{ fn: string; args: unknown }>;
  gowaSends: Array<{ phone: string; message: string }>;
}

function makeDeps(
  opts: {
    ai?:
      | { category: string; urgency: "critical" | "high" | "normal" | "low"; confidence: number }
      | Error;
    rpcResult?: SubmitComplaintResult | Error;
    gowaError?: Error;
  } = {},
): { deps: IntakeDeps; recorded: Recorded } {
  const recorded: Recorded = { aiCalls: [], rpcCalls: [], gowaSends: [] };
  const deps: IntakeDeps = {
    ai: {
      classify: (description: string) => {
        recorded.aiCalls.push(description);
        if (opts.ai instanceof Error) return Promise.reject(opts.ai);
        return Promise.resolve(
          opts.ai ?? { category: "water_supply", urgency: "high", confidence: 0.9 },
        );
      },
    },
    rpc: {
      call: (fn: string, args: unknown) => {
        recorded.rpcCalls.push({ fn, args });
        if (opts.rpcResult instanceof Error) return Promise.reject(opts.rpcResult);
        return Promise.resolve((opts.rpcResult ?? baseResult) as never);
      },
    },
    gowa: {
      sendMessage: (phone: string, message: string) => {
        recorded.gowaSends.push({ phone, message });
        if (opts.gowaError) return Promise.reject(opts.gowaError);
        return Promise.resolve({ messageId: "gowa-1", status: "sent" });
      },
    },
  };
  return { deps, recorded };
}

async function signedRequestAsync(body: string, secret = "whsec"): Promise<Request> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const hex = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return new Request("http://localhost/functions/v1/whatsapp-intake", {
    method: "POST",
    headers: { "x-hub-signature-256": `sha256=${hex}` },
    body,
  });
}

Deno.test("processReport: classify → rpc → confirmation, happy path", async () => {
  const { deps, recorded } = makeDeps();
  const outcome = await processReport(makeMsg(), deps);
  assertEquals(outcome.status, "accepted");
  assertEquals(outcome.tracking_no, "GC-2026-00001");
  assertEquals(recorded.aiCalls.length, 1);
  assertEquals(recorded.rpcCalls.length, 1);
  assertEquals(recorded.rpcCalls[0].fn, "submit_complaint");
  const args = recorded.rpcCalls[0].args as SubmitComplaintArgs;
  assertEquals(args.p_channel, "whatsapp");
  assertEquals(args.p_external_id, "MSG-1");
  assertEquals(args.p_ai_category, "water_supply");
  assertEquals(recorded.gowaSends.length, 1);
  assertEquals(recorded.gowaSends[0].phone, "2207123456");
});

Deno.test("processReport: AI failure still files the report (hints null)", async () => {
  const { deps, recorded } = makeDeps({ ai: new Error("ai down") });
  const outcome = await processReport(makeMsg(), deps);
  assertEquals(outcome.status, "accepted");
  const args = recorded.rpcCalls[0].args as SubmitComplaintArgs;
  assertEquals(args.p_ai_category, null);
  assertEquals(args.p_confidence, null);
});

Deno.test("processReport: GOWA confirmation failure does NOT fail the intake", async () => {
  const { deps, recorded } = makeDeps({ gowaError: new Error("gowa down") });
  const outcome = await processReport(makeMsg(), deps);
  assertEquals(outcome.status, "accepted");
  assertEquals(recorded.rpcCalls.length, 1);
  assertEquals(recorded.gowaSends.length, 1);
});

Deno.test("confirmationText: low confidence routes copy to Central Desk", () => {
  const t = confirmationText({
    ...baseResult,
    confidence: 0.5,
    institution: "central",
    institution_name: "Central Desk",
    department: null,
  });
  assertEquals(t.includes("Central Desk"), true);
  assertEquals(t.includes("GC-2026-00001"), true);
});

Deno.test("confirmationText: normal path names institution and department", () => {
  const t = confirmationText(baseResult);
  assertEquals(t.includes("NAWEC"), true);
  assertEquals(t.includes("Water Distribution"), true);
});

Deno.test("looksLikeGreeting: greetings vs reports", () => {
  assertEquals(looksLikeGreeting("Hi"), true);
  assertEquals(looksLikeGreeting("Good morning"), true);
  assertEquals(looksLikeGreeting("hello!"), true);
  assertEquals(looksLikeGreeting("No water in Bakoteh since morning"), false);
  assertEquals(looksLikeGreeting("help me water is off"), false);
});

Deno.test("handleRequest: rejects bad signature", async () => {
  const { deps } = makeDeps();
  const req = new Request("http://localhost/", {
    method: "POST",
    headers: { "x-hub-signature-256": "sha256=0000" },
    body: '{"event":"message"}',
  });
  const res = await handleRequest(req, deps, "whsec");
  assertEquals(res.status, 401);
});

Deno.test("handleRequest: onboards a bare greeting without filing", async () => {
  const body = JSON.stringify({
    event: "message",
    payload: { id: "M2", from: "2207000000@s.whatsapp.net", is_from_me: false, body: "Hello" },
  });
  const { deps, recorded } = makeDeps();
  const res = await handleRequest(await signedRequestAsync(body), deps, "whsec");
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(json.status, "sent_onboarding");
  assertEquals(recorded.rpcCalls.length, 0);
  assertEquals(recorded.gowaSends.length, 1);
});

Deno.test("handleRequest: files a real report end to end", async () => {
  const body = JSON.stringify({
    event: "message",
    payload: {
      id: "M3",
      from: "2207123456@s.whatsapp.net",
      is_from_me: false,
      body: "No water in Bakoteh since morning",
    },
  });
  const { deps, recorded } = makeDeps();
  const res = await handleRequest(await signedRequestAsync(body), deps, "whsec");
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(json.status, "accepted");
  assertEquals(recorded.rpcCalls[0].fn, "submit_complaint");
  assertEquals(recorded.gowaSends.length, 1);
});
