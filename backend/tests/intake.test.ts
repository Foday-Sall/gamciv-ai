/** Unit tests for the whatsapp-intake pipeline (stubbed deps, no network). */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  handleRequest,
  type IntakeDeps,
  processReport,
  resolveMediaUrl,
} from "../functions/whatsapp-intake/index.ts";
import {
  classificationConfirmedText,
  classificationFailedText,
  lowConfidenceText,
  looksLikeGreeting,
  notRegisteredText,
} from "../functions/_shared/intakeTexts.ts";
import { type ExtractedMessage, extractMessage, parseGowaEnvelope } from "../functions/_shared/gowaClient.ts";
import type { SubmitComplaintArgs, SubmitComplaintResult } from "../functions/_shared/types.ts";

function makeMsg(overrides: Partial<ExtractedMessage> = {}): ExtractedMessage {
  return {
    messageId: "MSG-1",
    phone: "2207123456",
    name: "Lamin",
    body: "No water in Bakoteh since morning",
    imageUrl: null,
    audioUrl: null,
    lat: null,
    lng: null,
    isGroup: false,
    isFromMe: false,
    ...overrides,
  };
}

const testProfile = { fullName: "Lamin Jallow", email: "lamin@example.com" };

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
  transcribeCalls: Array<{ name: string; bytes: number }>;
  rpcCalls: Array<{ fn: string; args: unknown }>;
  gowaSends: Array<{ phone: string; message: string }>;
  profileLookups: string[];
  fetchCalls: Array<{ url: string; status: number; body: Uint8Array<ArrayBufferLike> }>;
}

function makeDeps(
  opts: {
    ai?:
      | { category: string; urgency: "critical" | "high" | "normal" | "low"; confidence: number }
      | Error;
    rpcResult?: SubmitComplaintResult | Error;
    gowaError?: Error;
    profile?: { fullName: string; email: string } | null | Error;
    transcript?: string | null;
    audioResponse?: Uint8Array | Error;
  } = {},
): { deps: IntakeDeps; recorded: Recorded } {
  const recorded: Recorded = {
    aiCalls: [],
    transcribeCalls: [],
    rpcCalls: [],
    gowaSends: [],
    profileLookups: [],
    fetchCalls: [],
  };
  const deps: IntakeDeps = {
    ai: {
      classify: (description: string) => {
        recorded.aiCalls.push(description);
        if (opts.ai instanceof Error) return Promise.reject(opts.ai);
        return Promise.resolve(
          opts.ai ?? { category: "water_supply", urgency: "high", confidence: 0.9 },
        );
      },
      transcribe: (audio: Uint8Array, name: string) => {
        recorded.transcribeCalls.push({ name, bytes: audio.byteLength });
        if (opts.transcript !== undefined) return Promise.resolve(opts.transcript);
        return Promise.resolve("No water in Bakoteh since morning");
      },
    },
    rpc: {
      call: (fn: string, args: unknown) => {
        recorded.rpcCalls.push({ fn, args });
        if (opts.rpcResult instanceof Error) return Promise.reject(opts.rpcResult);
        return Promise.resolve((opts.rpcResult ?? baseResult) as never);
      },
    },
    findProfileByPhone: (phone: string) => {
      recorded.profileLookups.push(phone);
      if (opts.profile instanceof Error) return Promise.reject(opts.profile);
      return Promise.resolve(opts.profile === undefined ? testProfile : opts.profile);
    },
    gowa: {
      sendMessage: (phone: string, message: string) => {
        recorded.gowaSends.push({ phone, message });
        if (opts.gowaError) return Promise.reject(opts.gowaError);
        return Promise.resolve({ messageId: "gowa-1", status: "sent" });
      },
    },
    mediaUrl: (path: string) =>
      path.startsWith("http") ? path : `http://gowa.test/${path.replace(/^\/+/, "")}`,
    fetchImpl: ((_url: string | URL | Request) => {
      const url = String(_url);
      const body = opts.audioResponse instanceof Error
        ? new Uint8Array(16)
        : (opts.audioResponse ?? new Uint8Array(16));
      recorded.fetchCalls.push({ url, status: 200, body });
      return Promise.resolve(new Response(body as unknown as BodyInit, { status: 200 }));
    }) as typeof fetch,
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
  const outcome = await processReport(makeMsg(), testProfile, deps);
  assertEquals(outcome.status, "accepted");
  assertEquals(outcome.tracking_no, "GC-2026-00001");
  assertEquals(recorded.aiCalls.length, 1);
  assertEquals(recorded.rpcCalls.length, 1);
  assertEquals(recorded.rpcCalls[0].fn, "submit_complaint");
  const args = recorded.rpcCalls[0].args as SubmitComplaintArgs;
  assertEquals(args.p_channel, "whatsapp");
  assertEquals(args.p_external_id, "MSG-1");
  assertEquals(args.p_ai_category, "water_supply");
  // Citizen fields come from the verified profile, not the message.
  assertEquals(args.p_citizen_name, "Lamin Jallow");
  assertEquals(recorded.gowaSends.length, 1);
  assertEquals(recorded.gowaSends[0].phone, "2207123456");
  // Personalized confirmation
  assertEquals(recorded.gowaSends[0].message.startsWith("Hello Lamin Jallow,"), true);
  assertEquals(recorded.gowaSends[0].message.includes("NAWEC"), true);
  assertEquals(recorded.gowaSends[0].message.includes("GC-2026-00001"), true);
  assertEquals(recorded.gowaSends[0].message.includes("lamin@example.com"), true);
});

Deno.test("processReport: AI failure still files the report (hints null) and replies sorry", async () => {
  const { deps, recorded } = makeDeps({ ai: new Error("ai down") });
  const outcome = await processReport(makeMsg(), testProfile, deps);
  assertEquals(outcome.status, "accepted");
  const args = recorded.rpcCalls[0].args as SubmitComplaintArgs;
  assertEquals(args.p_ai_category, null);
  assertEquals(args.p_confidence, null);
  // Never silent: the citizen gets the actionable sorry text
  assertEquals(recorded.gowaSends.length, 2);
  assertEquals(recorded.gowaSends[1].message, classificationFailedText());
});

Deno.test("processReport: GOWA confirmation failure does NOT fail the intake", async () => {
  const { deps, recorded } = makeDeps({ gowaError: new Error("gowa down") });
  const outcome = await processReport(makeMsg(), testProfile, deps);
  assertEquals(outcome.status, "accepted");
  assertEquals(recorded.rpcCalls.length, 1);
  assertEquals(recorded.gowaSends.length, 1);
});

Deno.test("lowConfidenceText: names reporter, review and email", () => {
  const t = lowConfidenceText(testProfile, "water_supply", "GC-2026-00001");
  assertEquals(t.includes("Hello Lamin Jallow,"), true);
  assertEquals(t.includes("Water Supply complaint"), true);
  assertEquals(t.includes("GC-2026-00001"), true);
  assertEquals(t.includes("reviewed by our team"), true);
  assertEquals(t.includes("lamin@example.com"), true);
});

Deno.test("lowConfidenceText: unclassified report reads as just a report", () => {
  const t = lowConfidenceText(testProfile, null, "GC-2026-00001");
  assertEquals(t.includes("your report (GC-2026-00001)"), true);
});

Deno.test("classificationConfirmedText: names category, institution, tracking and email", () => {
  const t = classificationConfirmedText(testProfile, "water_supply", "NAWEC", "GC-2026-00001");
  assertEquals(t.includes("Water Supply complaint"), true);
  assertEquals(t.includes("sent to NAWEC"), true);
  assertEquals(t.includes("tracking number GC-2026-00001"), true);
  assertEquals(t.includes("lamin@example.com"), true);
});

Deno.test("looksLikeGreeting: greetings vs reports", () => {
  assertEquals(looksLikeGreeting("Hi"), true);
  assertEquals(looksLikeGreeting("Good morning"), true);
  assertEquals(looksLikeGreeting("hello!"), true);
  assertEquals(looksLikeGreeting("No water in Bakoteh since morning"), false);
  assertEquals(looksLikeGreeting("help me water is off"), false);
});

Deno.test("notRegisteredText: onboarding copy carries signup url and phone verification", () => {
  const t = notRegisteredText("Fatou");
  assertEquals(t.includes("Hello Fatou"), true);
  assertEquals(t.includes("https://gamciv.pocketsoftware.dev/app"), true);
  assertEquals(t.includes("verify your phone number"), true);
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

Deno.test("handleRequest: oversized body rejected 413 before parsing", async () => {
  const { deps, recorded } = makeDeps();
  const res = await handleRequest(
    await signedRequestAsync("x".repeat(513 * 1024)),
    deps,
    "whsec",
  );
  assertEquals(res.status, 413);
  assertEquals(recorded.rpcCalls.length, 0);
});

Deno.test("handleRequest: unregistered phone gets gate text, nothing filed", async () => {
  const body = JSON.stringify({
    event: "message",
    payload: {
      id: "MGATE",
      from: "220999999001@s.whatsapp.net",
      is_from_me: false,
      body: "No water in Bakoteh since morning",
    },
  });
  const { deps, recorded } = makeDeps({ profile: null });
  const res = await handleRequest(await signedRequestAsync(body), deps, "whsec");
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(json.status, "not_registered");
  // No classification, no submission
  assertEquals(recorded.aiCalls.length, 0);
  assertEquals(recorded.rpcCalls.length, 0);
  // The gate reply was sent
  assertEquals(recorded.gowaSends.length, 1);
  assertEquals(
    recorded.gowaSends[0].message.includes("https://gamciv.pocketsoftware.dev/app"),
    true,
  );
  assertEquals(recorded.gowaSends[0].message.includes("verify your phone number"), true);
});

Deno.test("handleRequest: profile lookup failure fails closed (treated unregistered)", async () => {
  const body = JSON.stringify({
    event: "message",
    payload: {
      id: "MGATE2",
      from: "220999999001@s.whatsapp.net",
      is_from_me: false,
      body: "No water in Bakoteh",
    },
  });
  const { deps, recorded } = makeDeps({ profile: new Error("db down") });
  const res = await handleRequest(await signedRequestAsync(body), deps, "whsec");
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(json.status, "not_registered");
  assertEquals(recorded.rpcCalls.length, 0);
});

Deno.test("handleRequest: onboards a registered user's bare greeting without filing", async () => {
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
  assertEquals(recorded.gowaSends[0].message.startsWith("Hello Lamin Jallow"), true);
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

Deno.test("handleRequest: voice note is transcribed and filed with the transcript", async () => {
  const audio = new Uint8Array([1, 2, 3, 4, 5]);
  const body = JSON.stringify({
    event: "message",
    payload: {
      id: "MVOICE",
      from: "2207123456@s.whatsapp.net",
      is_from_me: false,
      audio: "statics/media/voice-note.ogg",
    },
  });
  const { deps, recorded } = makeDeps({ audioResponse: audio });
  const res = await handleRequest(await signedRequestAsync(body), deps, "whsec");
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(json.status, "accepted");
  // audio was fetched from GOWA_BASE_URL + path (with basic auth embedded)
  assertEquals(recorded.fetchCalls.length, 1);
  assertEquals(recorded.fetchCalls[0].url.includes("statics/media/voice-note.ogg"), true);
  assertEquals(recorded.transcribeCalls.length, 1);
  assertEquals(recorded.transcribeCalls[0].bytes, 5);
  // The transcript was classified and submitted
  assertEquals(recorded.aiCalls.length, 1);
  assertEquals(recorded.aiCalls[0].includes("Bakoteh"), true);
  const args = recorded.rpcCalls[0].args as SubmitComplaintArgs;
  assertEquals(args.p_description, "No water in Bakoteh since morning");
  assertEquals(recorded.gowaSends.length, 1);
});

Deno.test("handleRequest: failed voice transcription asks the user to type", async () => {
  const body = JSON.stringify({
    event: "message",
    payload: {
      id: "MVOICE2",
      from: "2207123456@s.whatsapp.net",
      is_from_me: false,
      audio: "statics/media/voice-note.ogg",
    },
  });
  const { deps, recorded } = makeDeps({ transcript: null });
  const res = await handleRequest(await signedRequestAsync(body), deps, "whsec");
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(json.status, "rejected");
  assertEquals(json.reason, "transcription failed");
  // Nothing filed, user was told to type
  assertEquals(recorded.aiCalls.length, 0);
  assertEquals(recorded.rpcCalls.length, 0);
  assertEquals(recorded.gowaSends.length, 1);
  assertEquals(recorded.gowaSends[0].message.includes("Please type your report"), true);
});

Deno.test("gowaClient: extractMessage surfaces audio and keeps audio-only messages", () => {
  const env = parseGowaEnvelope(
    JSON.stringify({
      event: "message",
      payload: {
        id: "MA1",
        from: "2207123456@s.whatsapp.net",
        is_from_me: false,
        audio: "statics/media/voice.ogg",
      },
    }),
  )!;
  const msg = extractMessage(env)!;
  assertEquals(msg.audioUrl, "statics/media/voice.ogg");
  assertEquals(msg.body, "");
  // audio object shape (no auto-download)
  const env2 = parseGowaEnvelope(
    JSON.stringify({
      event: "message",
      payload: {
        id: "MA2",
        from: "2207123456@s.whatsapp.net",
        is_from_me: false,
        audio: { url: "https://mmg.whatsapp.net/v.ogg" },
      },
    }),
  )!;
  assertEquals(extractMessage(env2)!.audioUrl, "https://mmg.whatsapp.net/v.ogg");
  // A message with no text, no image, no location AND no audio is still ignored
  const env3 = parseGowaEnvelope(
    JSON.stringify({
      event: "message",
      payload: { id: "MA3", from: "2207123456@s.whatsapp.net", is_from_me: false },
    }),
  )!;
  assertEquals(extractMessage(env3), null);
});

Deno.test("processReport: oversized fields are truncated to the shared limits", async () => {
  const { deps, recorded } = makeDeps();
  const longBody = "no water ".repeat(300); // 2700 chars > 2000 limit
  const msg = makeMsg({ body: longBody, name: "N".repeat(150) });
  await processReport(msg, testProfile, deps);
  const args = recorded.rpcCalls[0].args as SubmitComplaintArgs;
  assertEquals(args.p_description.length, 2000);
  // Name now comes from the verified profile
  assertEquals(args.p_citizen_name!.length, "Lamin Jallow".length);
  // makeTitle caps the first line at 80 (inner function), outer bounded() keeps it ≤ 200
  assertEquals(args.p_title!.length, 80);
});

Deno.test("resolveMediaUrl: relative path resolves against GOWA base with embedded auth", () => {
  const url = resolveMediaUrl(
    "statics/media/voice.ogg",
    "http://gowa:3000",
    "admin:secret",
  );
  assertEquals(url, "http://admin:secret@gowa:3000/statics/media/voice.ogg");
});

Deno.test("resolveMediaUrl: absolute url passes through, non-static path without auth", () => {
  assertEquals(
    resolveMediaUrl("https://mmg.whatsapp.net/v.ogg", "http://gowa:3000", "admin:secret"),
    "https://mmg.whatsapp.net/v.ogg",
  );
  assertEquals(
    resolveMediaUrl("media/voice.ogg", "http://gowa:3000/", "admin:secret"),
    "http://gowa:3000/media/voice.ogg",
  );
  assertEquals(resolveMediaUrl("statics/media/voice.ogg", "", "admin:secret"), null);
});
