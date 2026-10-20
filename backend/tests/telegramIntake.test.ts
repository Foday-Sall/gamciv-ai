/** Unit tests for the telegram-intake pipeline (stubbed deps, no network). */
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildDeps,
  confirmationText,
  extractReport,
  firstNameFrom,
  handleRequest,
  parseUpdate,
  personalizedText,
  processReport,
  routeReport,
  type TelegramIntakeDeps,
} from "../functions/telegram-intake/index.ts";
import { FetchTelegramClient } from "../functions/telegram-intake/telegram.ts";
import { FetchTranscriber, loadTranscribeConfig } from "../functions/telegram-intake/transcribe.ts";
import {
  categoryLabel,
  telegramLinkedText,
  telegramLinkInstructions,
  telegramNotRegisteredText,
  telegramUnrecognizedText,
} from "../functions/_shared/telegramTexts.ts";
import { normalizePhoneOtp } from "../functions/_shared/otp.ts";
import type { RpcClient } from "../functions/_shared/rpcClient.ts";
import type { SubmitComplaintArgs, SubmitComplaintResult } from "../functions/_shared/types.ts";
import type { TelegramReport } from "../functions/telegram-intake/telegram.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseResult: SubmitComplaintResult = {
  status: "received",
  tracking_no: "GC-2026-00007",
  institution: "nawec",
  institution_name: "NAWEC",
  department: "Water Distribution",
  expected_response_at: "2026-10-20T09:00:00+00:00",
  confidence: 0.9,
  sensitive: false,
  group_id: null,
};

/** A minimal TelegramReport for pipeline tests. */
function makeReport(overrides: Partial<TelegramReport> = {}): TelegramReport {
  return {
    externalId: "tg:5022113344:111",
    chatId: "5022113344",
    messageId: 111,
    name: "Fatou (@fatou_b)",
    body: "No water in Bakoteh",
    photoFileId: null,
    voiceFileId: null,
    lat: null,
    lng: null,
    ...overrides,
  };
}

/** Default linked-chat profile row (get_telegram_link / find_verified_profile_by_phone). */
const TEST_PROFILE = {
  user_id: "11111111-1111-1111-1111-111111111111",
  full_name: "Fatou Ceesay",
  email: "fatou@example.com",
};

interface Recorded {
  aiCalls: string[];
  rpcCalls: Array<{ fn: string; args: unknown }>;
  sentMessages: Array<{ chatId: string; text: string }>;
  getFileCalls: string[];
  downloadCalls: string[];
  transcribeCalls: Array<{ size: number; filename: string }>;
}

function makeDeps(
  opts: {
    ai?: { category: string; urgency: "critical" | "high" | "normal" | "low"; confidence: number } | Error;
    rpcResult?: SubmitComplaintResult | Error;
    sendError?: Error;
    /** getFile resolution per file_id; missing key or null value → null URL. */
    fileMap?: Record<string, string | null>;
    getFileError?: Error;
    /** get_telegram_link result for the chat; null = unlinked. */
    linkRow?: { user_id: string; full_name: string | null; email: string | null } | null;
    linkError?: Error;
    /** find_verified_profile_by_phone result; null = not found. */
    verifiedProfile?: { user_id: string; full_name: string | null; email: string | null } | null;
    /** upsert_telegram_link failure injection. */
    upsertError?: Error;
    /** Transcription behavior: a transcript, an error, or null-transcriber. */
    transcript?: string | null;
    transcriberError?: Error;
    noTranscriber?: boolean;
  } = {},
): { deps: TelegramIntakeDeps; recorded: Recorded } {
  const recorded: Recorded = {
    aiCalls: [],
    rpcCalls: [],
    sentMessages: [],
    getFileCalls: [],
    downloadCalls: [],
    transcribeCalls: [],
  };
  const linkRow = opts.linkRow === undefined ? null : opts.linkRow;
  const deps: TelegramIntakeDeps = {
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
      call: ((fn: string, args: unknown): Promise<unknown> => {
        recorded.rpcCalls.push({ fn, args });
        if (fn === "get_telegram_link") {
          return opts.linkError
            ? Promise.reject(opts.linkError)
            : Promise.resolve(linkRow ? [linkRow] : []);
        }
        if (fn === "find_verified_profile_by_phone") {
          return Promise.resolve(opts.verifiedProfile ? [opts.verifiedProfile] : []);
        }
        if (fn === "upsert_telegram_link") {
          return opts.upsertError
            ? Promise.reject(opts.upsertError)
            : Promise.resolve(true);
        }
        if (opts.rpcResult instanceof Error) {
          return Promise.reject(opts.rpcResult);
        }
        return Promise.resolve(opts.rpcResult ?? baseResult);
      }) as unknown as RpcClient["call"],
    },
    telegram: {
      sendMessage: (chatId: string, text: string) => {
        recorded.sentMessages.push({ chatId, text });
        if (opts.sendError) return Promise.reject(opts.sendError);
        return Promise.resolve({ messageId: 42 });
      },
      getPhotoUrl: (fileId: string) => {
        recorded.getFileCalls.push(fileId);
        // Real contract: FetchTelegramClient.getPhotoUrl catches errors and
        // returns null, so a resolution failure never throws into the pipeline.
        if (opts.getFileError) return Promise.resolve(null);
        return Promise.resolve(opts.fileMap?.[fileId] ?? null);
      },
      getFileUrl: (fileId: string) => {
        recorded.getFileCalls.push(fileId);
        if (opts.getFileError) return Promise.resolve(null);
        return Promise.resolve(opts.fileMap?.[fileId] ?? null);
      },
      downloadFile: (url: string) => {
        recorded.downloadCalls.push(url);
        if (opts.getFileError) return Promise.resolve(null);
        return Promise.resolve(new Uint8Array([1, 2, 3, 4]));
      },
    },
    transcriber: opts.noTranscriber
      ? null
      : {
        transcribe: (audio: Uint8Array, filename: string) => {
          recorded.transcribeCalls.push({ size: audio.length, filename });
          if (opts.transcriberError) return Promise.reject(opts.transcriberError);
          return Promise.resolve(opts.transcript ?? null);
        },
      },
  };
  return { deps, recorded };
}

/** A private-chat text update from Telegram's webhook format. */
function textUpdate(text: string, msgId = 111, userId = 5022113344): Record<string, unknown> {
  return {
    update_id: 900,
    message: {
      message_id: msgId,
      from: { id: userId, first_name: "Fatou", username: "fatou_b" },
      chat: { id: userId, type: "private" },
      text,
    },
  };
}

/** Build a signed request the same way Telegram sends updates. */
function telegramRequest(update: unknown, secret = "tgsecret"): Request {
  return new Request("https://api.pocketsoftware.dev/functions/v1/telegram-intake", {
    method: "POST",
    headers: {
      "X-Telegram-Bot-Api-Secret-Token": secret,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(update),
  });
}

// ---------------------------------------------------------------------------
// Secret token check
// ---------------------------------------------------------------------------

Deno.test("handleRequest: valid secret token + linked chat runs the pipeline", async () => {
  const { deps, recorded } = makeDeps({ linkRow: TEST_PROFILE });
  const res = await handleRequest(
    telegramRequest(textUpdate("No water in Bakoteh")),
    deps,
    "tgsecret",
  );
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(json.status, "accepted");
  assertEquals(recorded.rpcCalls.filter((c) => c.fn === "submit_complaint").length, 1);
});

Deno.test("handleRequest: invalid secret token rejected 401", async () => {
  const { deps, recorded } = makeDeps({ linkRow: TEST_PROFILE });
  const res = await handleRequest(telegramRequest(textUpdate("hi"), "wrong"), deps, "tgsecret");
  assertEquals(res.status, 401);
  assertEquals(recorded.rpcCalls.length, 0);
});

Deno.test("handleRequest: missing secret token rejected 401", async () => {
  const { deps, recorded } = makeDeps({ linkRow: TEST_PROFILE });
  const req = new Request("https://example.com/telegram-intake", {
    method: "POST",
    body: JSON.stringify(textUpdate("hi")),
  });
  const res = await handleRequest(req, deps, "tgsecret");
  assertEquals(res.status, 401);
  assertEquals(recorded.rpcCalls.length, 0);
});

Deno.test("handleRequest: unconfigured secret rejects everything", async () => {
  const { deps, recorded } = makeDeps({ linkRow: TEST_PROFILE });
  const res = await handleRequest(telegramRequest(textUpdate("hi"), "tgsecret"), deps, "");
  assertEquals(res.status, 401);
  assertEquals(recorded.rpcCalls.length, 0);
});

Deno.test("handleRequest: invalid JSON body rejected 400", async () => {
  const { deps } = makeDeps({ linkRow: TEST_PROFILE });
  const req = new Request("https://example.com/telegram-intake", {
    method: "POST",
    headers: { "X-Telegram-Bot-Api-Secret-Token": "tgsecret" },
    body: "not json",
  });
  const res = await handleRequest(req, deps, "tgsecret");
  assertEquals(res.status, 400);
});

Deno.test("handleRequest: oversized body rejected 413 before parsing", async () => {
  const { deps, recorded } = makeDeps({ linkRow: TEST_PROFILE });
  const req = new Request("https://example.com/telegram-intake", {
    method: "POST",
    headers: { "X-Telegram-Bot-Api-Secret-Token": "tgsecret" },
    body: "x".repeat(513 * 1024), // just over the 512KB cap
  });
  const res = await handleRequest(req, deps, "tgsecret");
  assertEquals(res.status, 413);
  assertEquals(recorded.rpcCalls.length, 0);
});

// ---------------------------------------------------------------------------
// Text message pipeline (linked chat)
// ---------------------------------------------------------------------------

Deno.test("handleRequest + processReport: text message files a report with correct args", async () => {
  const { deps, recorded } = makeDeps({ linkRow: TEST_PROFILE });
  const res = await handleRequest(
    telegramRequest(textUpdate("No water in Bakoteh since morning")),
    deps,
    "tgsecret",
  );
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(json.status, "accepted");
  assertEquals(json.tracking_no, "GC-2026-00007");

  const submitCalls = recorded.rpcCalls.filter((c) => c.fn === "submit_complaint");
  assertEquals(submitCalls.length, 1);
  const args = submitCalls[0].args as SubmitComplaintArgs;
  assertEquals(args.p_channel, "web"); // fallback until DB enum adds telegram
  assertEquals(args.p_title, "No water in Bakoteh since morning");
  assertEquals(args.p_description, "No water in Bakoteh since morning");
  assertEquals(args.p_category_hint, "water_supply");
  assertEquals(args.p_urgency_hint, "high");
  assertEquals(args.p_confidence, 0.9);
  assertEquals(args.p_ai_category, "water_supply");
  assertEquals(args.p_ai_urgency, "high");
  assertEquals(args.p_lat, null);
  assertEquals(args.p_lng, null);
  assertEquals(args.p_photo_url, null);
  assertEquals(args.p_citizen_name, "Fatou (@fatou_b)");
  assertEquals(args.p_citizen_phone, null); // Telegram exposes no phone
  assertEquals(args.p_is_anonymous, false);
  assertEquals(args.p_external_id, "tg:5022113344:111");

  // Personalized confirmation sent back to the same chat
  assertEquals(recorded.sentMessages.length, 1);
  assertEquals(recorded.sentMessages[0].chatId, "5022113344");
  assertStringIncludes(recorded.sentMessages[0].text, "Hello Fatou");
  assertStringIncludes(recorded.sentMessages[0].text, "GC-2026-00007");
  assertStringIncludes(recorded.sentMessages[0].text, "NAWEC");
  assertStringIncludes(recorded.sentMessages[0].text, "fatou@example.com");
  assertEquals(recorded.getFileCalls.length, 0);
});

Deno.test("processReport: AI failure still files the report (hints null)", async () => {
  const { deps, recorded } = makeDeps({ ai: new Error("ai down") });
  const report = makeReport();
  const outcome = await processReport(report, deps, TEST_PROFILE);
  assertEquals(outcome.status, "accepted");
  const args = recorded.rpcCalls[0].args as SubmitComplaintArgs;
  assertEquals(args.p_ai_category, null);
  assertEquals(args.p_urgency_hint, null);
  assertEquals(args.p_confidence, null);
});

// ---------------------------------------------------------------------------
// Photo message pipeline
// ---------------------------------------------------------------------------

Deno.test("processReport: photo is downloaded and stored in the bucket (no token URL persisted)", async () => {
  // Real getPhotoUrl returns a token-bearing, short-lived URL. It must be
  // consumed in-process; only the token-free bucket reference is persisted.
  const tokenUrl = "https://api.telegram.org/file/botSECRETTOKEN123/photos/file_10.jpg";
  let downloadedFrom: string | null = null;
  let uploadedTo: string | null = null;

  // Simulate storage env being present (Deno.env in tests).
  Deno.env.set("SUPABASE_URL", "http://127.0.0.1:54321");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");

  const { deps, recorded } = makeDeps({ fileMap: { photo123: tokenUrl } });
  const realFetch = globalThis.fetch;
  try {
    (globalThis as { fetch: typeof fetch }).fetch = ((url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("api.telegram.org/file/bot")) {
        downloadedFrom = u;
        return Promise.resolve(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg" } }));
      }
      if (u.includes("/storage/v1/object/")) {
        uploadedTo = u;
        return Promise.resolve(new Response(JSON.stringify({ Key: "x" }), { status: 200 }));
      }
      return realFetch(url, init);
    }) as typeof fetch;

    const update = {
      message: {
        message_id: 222,
        from: { id: 777, first_name: "Lamin" },
        chat: { id: 777, type: "private" },
        caption: "Broken pipe flooding the street",
        photo: [
          { file_id: "photo_small", width: 90, height: 90 },
          { file_id: "photo123", width: 1280, height: 960 },
        ],
      },
    };
    const report = extractReport(update)!;
    assertEquals(report.photoFileId, "photo123"); // largest size picked
    assertEquals(report.body, "Broken pipe flooding the street");

    await processReport(report, deps, TEST_PROFILE);
    assertEquals(downloadedFrom, tokenUrl); // token URL consumed in-process only
    assertEquals(uploadedTo, "http://127.0.0.1:54321/storage/v1/object/complaint-photos/telegram/photo123");
    assertEquals(recorded.getFileCalls, ["photo123"]);
    const args = recorded.rpcCalls[0].args as SubmitComplaintArgs;
    assertEquals(args.p_photo_url, "complaint-photos/telegram/photo123"); // token-free
    assertEquals(args.p_photo_url!.includes("bot"), false);
    assertEquals(args.p_external_id, "tg:777:222");
  } finally {
    (globalThis as { fetch: typeof fetch }).fetch = realFetch;
    Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
  }
});

Deno.test("processReport: getFile failure files the report without photo (no loss)", async () => {
  const { deps, recorded } = makeDeps({ getFileError: new Error("getFile down") });
  const update = {
    message: {
      message_id: 333,
      from: { id: 888, first_name: "Fatou" },
      chat: { id: 888, type: "private" },
      caption: "Dumping site near school",
      photo: [{ file_id: "photoX", width: 400, height: 300 }],
    },
  };
  await processReport(extractReport(update)!, deps, TEST_PROFILE);
  assertEquals(recorded.rpcCalls.length, 1);
  const args = recorded.rpcCalls[0].args as SubmitComplaintArgs;
  assertEquals(args.p_photo_url, null);
  assertEquals(args.p_description, "Dumping site near school");
});

Deno.test("processReport: upload failure stores token-free fallback reference (never the token URL)", async () => {
  const tokenUrl = "https://api.telegram.org/file/botSECRETTOKEN456/photos/broken.jpg";
  Deno.env.set("SUPABASE_URL", "http://127.0.0.1:54321");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
  const { deps, recorded } = makeDeps({ fileMap: { photoBad: tokenUrl } });
  const realFetch = globalThis.fetch;
  try {
    (globalThis as { fetch: typeof fetch }).fetch = ((_url: string | URL, _init?: RequestInit) => {
      // Download works, upload always fails.
      if (String(_url).includes("api.telegram.org")) {
        return Promise.resolve(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
      }
      return Promise.resolve(new Response("boom", { status: 500 }));
    }) as typeof fetch;

    const update = {
      message: {
        message_id: 334,
        from: { id: 890, first_name: "Fatou" },
        chat: { id: 890, type: "private" },
        caption: "Fallen tree on the road",
        photo: [{ file_id: "photoBad", width: 500, height: 400 }],
      },
    };
    await processReport(extractReport(update)!, deps, TEST_PROFILE);
    const args = recorded.rpcCalls[0].args as SubmitComplaintArgs;
    assertEquals(args.p_photo_url, "telegram/photoBad"); // bare, token-free ref
    assertEquals(args.p_photo_url!.includes("botSECRETTOKEN"), false);
    assertEquals(args.p_photo_url!.includes("http"), false);
  } finally {
    (globalThis as { fetch: typeof fetch }).fetch = realFetch;
    Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
  }
});

Deno.test("processReport: photo without caption still files with generated description", async () => {
  Deno.env.set("SUPABASE_URL", "http://127.0.0.1:54321");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
  const tokenUrl = "https://api.telegram.org/file/botSECRETTOKEN789/q.jpg";
  const { deps, recorded } = makeDeps({ fileMap: { photoQ: tokenUrl } });
  const realFetch = globalThis.fetch;
  try {
    (globalThis as { fetch: typeof fetch }).fetch = ((url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("api.telegram.org")) {
        return Promise.resolve(new Response(new Uint8Array([1]), { status: 200 }));
      }
      if (u.includes("/storage/v1/object/")) {
        return Promise.resolve(new Response(JSON.stringify({ Key: "x" }), { status: 200 }));
      }
      return realFetch(url, init);
    }) as typeof fetch;

    const update = {
      message: {
        message_id: 444,
        from: { id: 999, first_name: "Modou" },
        chat: { id: 999, type: "private" },
        photo: [{ file_id: "photoQ", width: 100, height: 100 }],
      },
    };
    await processReport(extractReport(update)!, deps, TEST_PROFILE);
    const args = recorded.rpcCalls[0].args as SubmitComplaintArgs;
    assertEquals(args.p_description, "Photo report sent via Telegram (no caption)");
    assertEquals(args.p_photo_url, "complaint-photos/telegram/photoQ");
  } finally {
    (globalThis as { fetch: typeof fetch }).fetch = realFetch;
    Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
  }
});

// ---------------------------------------------------------------------------
// Location message pipeline
// ---------------------------------------------------------------------------

Deno.test("processReport: location message passes lat/lng through", async () => {
  const { deps, recorded } = makeDeps();
  const update = {
    message: {
      message_id: 555,
      from: { id: 1010, first_name: "Awa" },
      chat: { id: 1010, type: "private" },
      location: { latitude: 13.4549, longitude: -16.579 },
    },
  };
  await processReport(extractReport(update)!, deps, TEST_PROFILE);
  const args = recorded.rpcCalls[0].args as SubmitComplaintArgs;
  assertEquals(args.p_lat, 13.4549);
  assertEquals(args.p_lng, -16.579);
  assertEquals(args.p_photo_url, null);
  assertEquals(args.p_external_id, "tg:1010:555");
  assertEquals(args.p_description, "Location pin sent via Telegram (no text)");
});

Deno.test("processReport: text + location combine in one report", async () => {
  const { deps, recorded } = makeDeps();
  const update = {
    message: {
      message_id: 556,
      from: { id: 1010, first_name: "Awa" },
      chat: { id: 1010, type: "private" },
      text: "Flooding here",
      location: { latitude: 13.45, longitude: -16.58 },
    },
  };
  await processReport(extractReport(update)!, deps, TEST_PROFILE);
  const args = recorded.rpcCalls[0].args as SubmitComplaintArgs;
  assertEquals(args.p_description, "Flooding here");
  assertEquals(args.p_lat, 13.45);
  assertEquals(args.p_lng, -16.58);
});

// ---------------------------------------------------------------------------
// Voice note pipeline
// ---------------------------------------------------------------------------

Deno.test("processReport: voice note is transcribed and used as the report body", async () => {
  const { deps, recorded } = makeDeps({
    fileMap: { voice1: "https://api.telegram.org/file/botSECRET/voice/voice1.ogg" },
    transcript: "The water has been off in Bakoteh for three days",
  });
  const report = makeReport({
    messageId: 700,
    externalId: "tg:5022113344:700",
    body: "Voice report sent via Telegram (transcription failed)",
    voiceFileId: "voice1",
  });
  await processReport(report, deps, TEST_PROFILE);
  assertEquals(recorded.getFileCalls, ["voice1"]);
  assertEquals(recorded.downloadCalls.length, 1);
  assertEquals(recorded.transcribeCalls, [{ size: 4, filename: "voice.ogg" }]);
  const args = recorded.rpcCalls[0].args as SubmitComplaintArgs;
  assertEquals(args.p_description, "The water has been off in Bakoteh for three days");
  assertEquals(args.p_title, "The water has been off in Bakoteh for three days");
  // The transcript, not the placeholder, is what the classifier saw.
  assertEquals(recorded.aiCalls, ["The water has been off in Bakoteh for three days"]);
});

Deno.test("processReport: transcription failure falls back to the placeholder body", async () => {
  const { deps, recorded } = makeDeps({
    fileMap: { voice2: "https://api.telegram.org/file/botSECRET/voice/voice2.ogg" },
    transcriberError: new Error("asr down"),
  });
  const report = makeReport({
    messageId: 701,
    body: "Voice report sent via Telegram (transcription failed)",
    voiceFileId: "voice2",
  });
  const outcome = await processReport(report, deps, TEST_PROFILE);
  assertEquals(outcome.status, "accepted");
  const args = recorded.rpcCalls[0].args as SubmitComplaintArgs;
  assertEquals(args.p_description, "Voice report sent via Telegram (transcription failed)");
  assertEquals(recorded.transcribeCalls.length, 1);
});

Deno.test("processReport: voice with no transcriber configured still files with placeholder", async () => {
  const { deps, recorded } = makeDeps({ noTranscriber: true });
  const report = makeReport({
    messageId: 702,
    body: "Voice report sent via Telegram (transcription failed)",
    voiceFileId: "voice3",
  });
  const outcome = await processReport(report, deps, TEST_PROFILE);
  assertEquals(outcome.status, "accepted");
  assertEquals(recorded.getFileCalls.length, 0); // getFile not even attempted
  const args = recorded.rpcCalls[0].args as SubmitComplaintArgs;
  assertEquals(args.p_description, "Voice report sent via Telegram (transcription failed)");
});

Deno.test("processReport: getFile failure on a voice note files with placeholder body", async () => {
  const { deps, recorded } = makeDeps({ getFileError: new Error("getFile down") });
  const report = makeReport({
    messageId: 703,
    body: "Voice report sent via Telegram (transcription failed)",
    voiceFileId: "voice4",
  });
  await processReport(report, deps, TEST_PROFILE);
  assertEquals(recorded.rpcCalls.length, 1);
  const args = recorded.rpcCalls[0].args as SubmitComplaintArgs;
  assertEquals(args.p_description, "Voice report sent via Telegram (transcription failed)");
  assertEquals(recorded.transcribeCalls.length, 0);
});

Deno.test("extractReport: voice-only message becomes a report with placeholder body", () => {
  const update = {
    message: {
      message_id: 710,
      from: { id: 404, first_name: "Fatou" },
      chat: { id: 404, type: "private" },
      voice: { file_id: "voiceX", duration: 9, mime_type: "audio/ogg" },
    },
  };
  const report = extractReport(update)!;
  assertEquals(report.voiceFileId, "voiceX");
  assertEquals(report.body, "Voice report sent via Telegram (transcription failed)");
  assertEquals(report.photoFileId, null);
});

// ---------------------------------------------------------------------------
// Linking flow + registered-users gate (routeReport)
// ---------------------------------------------------------------------------

Deno.test("routeReport: linked chat goes through the report pipeline", async () => {
  const { deps, recorded } = makeDeps({ linkRow: TEST_PROFILE });
  const outcome = await routeReport(makeReport(), deps);
  assertEquals(outcome.status, "accepted");
  assertEquals(recorded.rpcCalls.some((c) => c.fn === "submit_complaint"), true);
});

Deno.test("routeReport: unlinked chat with a report gets instructions, files nothing", async () => {
  const { deps, recorded } = makeDeps({ linkRow: null });
  const outcome = await routeReport(
    makeReport({ body: "No water in Bakoteh since morning" }),
    deps,
  );
  assertEquals(outcome.status, "unlinked");
  assertEquals(recorded.rpcCalls.some((c) => c.fn === "submit_complaint"), false);
  assertEquals(recorded.sentMessages.length, 1);
  assertStringIncludes(recorded.sentMessages[0].text, "gamciv.pocketsoftware.dev/app");
  assertStringIncludes(recorded.sentMessages[0].text, "phone number");
});

Deno.test("routeReport: unlinked chat sending a registered phone gets linked", async () => {
  const { deps, recorded } = makeDeps({ linkRow: null, verifiedProfile: TEST_PROFILE });
  const outcome = await routeReport(makeReport({ body: "+220 7 123 456", messageId: 800 }), deps);
  assertEquals(outcome.status, "linked");
  assertEquals(recorded.rpcCalls.some((c) => c.fn === "find_verified_profile_by_phone"), true);
  assertEquals(recorded.rpcCalls.some((c) => c.fn === "upsert_telegram_link"), true);
  assertEquals(recorded.rpcCalls.some((c) => c.fn === "submit_complaint"), false);
  assertEquals(recorded.sentMessages.length, 1);
  assertEquals(recorded.sentMessages[0].text, telegramLinkedText());
});

Deno.test("routeReport: unregistered phone explains and does not link", async () => {
  const { deps, recorded } = makeDeps({ linkRow: null, verifiedProfile: null });
  const outcome = await routeReport(makeReport({ body: "220999999001", messageId: 801 }), deps);
  assertEquals(outcome.status, "link_failed");
  assertEquals(recorded.rpcCalls.some((c) => c.fn === "upsert_telegram_link"), false);
  assertEquals(recorded.rpcCalls.some((c) => c.fn === "submit_complaint"), false);
  assertEquals(recorded.sentMessages.length, 1);
  assertEquals(recorded.sentMessages[0].text, telegramNotRegisteredText());
});

Deno.test("routeReport: gate holds even when the phone lookup RPC fails", async () => {
  const { deps, recorded } = makeDeps({
    linkRow: null,
    verifiedProfile: TEST_PROFILE,
    upsertError: new Error("db down"),
  });
  const outcome = await routeReport(makeReport({ body: "220999999002", messageId: 802 }), deps);
  assertEquals(outcome.status, "link_failed");
  assertEquals(recorded.rpcCalls.some((c) => c.fn === "submit_complaint"), false);
});

Deno.test("routeReport: gate holds when get_telegram_link RPC fails (fail closed)", async () => {
  const { deps, recorded } = makeDeps({ linkRow: TEST_PROFILE, linkError: new Error("db down") });
  const outcome = await routeReport(makeReport(), deps);
  assertEquals(outcome.status, "unlinked");
  assertEquals(recorded.rpcCalls.some((c) => c.fn === "submit_complaint"), false);
  // Fail-closed still tells the user how to proceed (link instructions).
  assertEquals(recorded.sentMessages.length, 1);
  assertStringIncludes(recorded.sentMessages[0].text, "phone number");
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

Deno.test("processReport: duplicate update id reuses the same external_id (SQL side dedupes)", async () => {
  const { deps, recorded } = makeDeps();
  const first = extractReport(textUpdate("No water in Bakoteh", 111, 5022113344))!;
  await processReport(first, deps, TEST_PROFILE);
  // Same Telegram update delivered again (webhook retry / dedupe miss):
  const second = extractReport(textUpdate("No water in Bakoteh", 111, 5022113344))!;
  await processReport(second, deps, TEST_PROFILE);

  assertEquals(recorded.rpcCalls.length, 2);
  const a1 = recorded.rpcCalls[0].args as SubmitComplaintArgs;
  const a2 = recorded.rpcCalls[1].args as SubmitComplaintArgs;
  // Both attempts carry the same idempotency key, so the SQL side's
  // p_external_id dedupe returns the first result without a second row.
  assertEquals(a1.p_external_id, a2.p_external_id);
  assertEquals(a1.p_external_id, "tg:5022113344:111");
});

Deno.test("extractReport: edited_message and group messages are not intake", () => {
  assertEquals(
    extractReport(
      { edited_message: textUpdate("x") } as unknown as Parameters<typeof extractReport>[0],
    ),
    null,
  );
  const groupUpdate = {
    message: {
      message_id: 1,
      from: { id: 1, first_name: "G" },
      chat: { id: -1001234, type: "group" },
      text: "hello group",
    },
  };
  assertEquals(extractReport(groupUpdate), null);
  assertEquals(
    extractReport({ message: { message_id: 1, chat: { id: 1, type: "private" } } }),
    null,
  );
});

// ---------------------------------------------------------------------------
// Personalized confirmation copy
// ---------------------------------------------------------------------------

Deno.test("personalizedText: full sentence with name, category, institution, email, tracking", () => {
  const t = personalizedText(baseResult, TEST_PROFILE, 0.9, "water_supply");
  assertEquals(
    t,
    "Hello Fatou Ceesay, your Water Supply complaint has been sent to NAWEC and will be checked. " +
      "We will email you at fatou@example.com with your tracking number GC-2026-00007.",
  );
});

Deno.test("personalizedText: low confidence uses the reviewing variant", () => {
  const t = personalizedText(baseResult, TEST_PROFILE, 0.5, "other");
  assertStringIncludes(t, "is being reviewed by our team");
  assertStringIncludes(t, "GC-2026-00007");
});

Deno.test("personalizedText: missing name and email degrade gracefully", () => {
  const t = personalizedText(
    baseResult,
    { full_name: null, email: null },
    0.9,
    "illegal_dumping",
  );
  assertStringIncludes(t, "Hello there,");
  assertStringIncludes(t, "your registered email address");
});

Deno.test("confirmationText: low confidence routes copy to Central Desk", () => {
  const t = confirmationText({
    ...baseResult,
    confidence: 0.5,
    institution: "central",
    institution_name: "Central Desk",
    department: null,
  });
  assertStringIncludes(t, "Central Desk");
  assertStringIncludes(t, "GC-2026-00007");
});

Deno.test("confirmationText: names institution and department", () => {
  const t = confirmationText(baseResult);
  assertStringIncludes(t, "NAWEC");
  assertStringIncludes(t, "Water Distribution");
});

// ---------------------------------------------------------------------------
// Linking texts & phone parsing
// ---------------------------------------------------------------------------

Deno.test("telegramLinkInstructions: mentions signup URL and phone request", () => {
  const t = telegramLinkInstructions();
  assertStringIncludes(t, "https://gamciv.pocketsoftware.dev/app");
  assertStringIncludes(t, "phone number");
});

Deno.test("telegramNotRegisteredText and telegramUnrecognizedText: explain next steps", () => {
  assertStringIncludes(telegramNotRegisteredText(), "isn't registered");
  assertStringIncludes(telegramUnrecognizedText(), "phone number");
});

Deno.test("normalizePhoneOtp: accepts the formats users send", () => {
  assertEquals(normalizePhoneOtp("+220 7 123 456"), "2207123456");
  assertEquals(normalizePhoneOtp("220999999003"), "220999999003");
  assertEquals(normalizePhoneOtp("00220-999-999-003"), "220999999003");
  assertEquals(normalizePhoneOtp("not a phone"), null);
  assertEquals(normalizePhoneOtp("12345"), null); // too short
});

Deno.test("categoryLabel: slug to human label", () => {
  assertEquals(categoryLabel("water_supply"), "water supply");
  assertEquals(categoryLabel(null), "report");
  assertEquals(categoryLabel("unknown_slug"), "report");
});

Deno.test("firstNameFrom: first word or null", () => {
  assertEquals(firstNameFrom("Fatou Ceesay"), "Fatou");
  assertEquals(firstNameFrom("Fatou"), "Fatou");
  assertEquals(firstNameFrom("   "), null);
  assertEquals(firstNameFrom(null), null);
});

Deno.test("processReport: Telegram send failure does not fail the intake", async () => {
  const { deps, recorded } = makeDeps({ sendError: new Error("telegram down") });
  const report = makeReport();
  const outcome = await processReport(report, deps, TEST_PROFILE);
  assertEquals(outcome.status, "accepted");
  assertEquals(recorded.sentMessages.length, 1);
});

Deno.test("processReport: RPC failure propagates (caller returns 500 so Telegram retries)", async () => {
  const { deps } = makeDeps({ rpcResult: new Error("db down") });
  const report = makeReport();
  let threw = false;
  try {
    await processReport(report, deps, TEST_PROFILE);
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

// ---------------------------------------------------------------------------
// setWebhook helper & client construction
// ---------------------------------------------------------------------------

Deno.test("buildDeps: throws without TELEGRAM_BOT_TOKEN", () => {
  const saved = Deno.env.get("TELEGRAM_BOT_TOKEN");
  try {
    Deno.env.delete("TELEGRAM_BOT_TOKEN");
    let threw = false;
    try {
      buildDeps();
    } catch {
      threw = true;
    }
    assertEquals(threw, true);
  } finally {
    if (saved !== undefined) Deno.env.set("TELEGRAM_BOT_TOKEN", saved);
  }
});

function withAiEnv(): { restore: () => void } {
  const saved: Record<string, string | undefined> = {};
  const keys = [
    "TELEGRAM_BOT_TOKEN",
    "AI_BASE_URL",
    "AI_API_KEY",
    "AI_MODEL",
    "AI_TRANSCRIBE_MODEL",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
  ];
  for (const k of keys) saved[k] = Deno.env.get(k);
  Deno.env.set("TELEGRAM_BOT_TOKEN", "x");
  Deno.env.set("AI_BASE_URL", "https://ai.example.com");
  Deno.env.set("AI_API_KEY", "k");
  Deno.env.set("AI_MODEL", "m");
  Deno.env.set("SUPABASE_URL", "http://127.0.0.1:54321");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
  return {
    restore: () => {
      for (const k of keys) {
        if (saved[k] !== undefined) Deno.env.set(k, saved[k]!);
        else Deno.env.delete(k);
      }
    },
  };
}

Deno.test("buildDeps: transcriber is null without AI_TRANSCRIBE_MODEL", () => {
  const env = withAiEnv();
  try {
    Deno.env.delete("AI_TRANSCRIBE_MODEL");
    const deps = buildDeps();
    assertEquals(deps.transcriber, null);
  } finally {
    env.restore();
  }
});

Deno.test("buildDeps: transcriber is built when AI_TRANSCRIBE_MODEL is set", () => {
  const env = withAiEnv();
  try {
    Deno.env.set("AI_TRANSCRIBE_MODEL", "@cf/openai/whisper");
    const deps = buildDeps();
    assertEquals(deps.transcriber !== null, true);
  } finally {
    env.restore();
  }
});

Deno.test("FetchTelegramClient.getPhotoUrl builds file download URL from mocked API", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fakeFetch = (url: string, init?: { body?: string }) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
    return Promise.resolve(
      new Response(
        JSON.stringify({ ok: true, result: { file_path: "photos/file_1.jpg" } }),
        { status: 200 },
      ),
    );
  };
  const client = new FetchTelegramClient({ botToken: "TOKEN" }, fakeFetch as typeof fetch);
  const url = await client.getPhotoUrl("abc");
  assertEquals(url, "https://api.telegram.org/file/botTOKEN/photos/file_1.jpg");
  assertEquals(calls[0].url, "https://api.telegram.org/botTOKEN/getFile");
  assertEquals(calls[0].body, { file_id: "abc" });
});

Deno.test("FetchTelegramClient.getFileUrl and downloadFile fetch voice bytes", async () => {
  const calls: string[] = [];
  const fakeFetch = (url: string, _init?: { body?: string }) => {
    calls.push(url);
    if (String(url).endsWith("/getFile")) {
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true, result: { file_path: "voice/file_1.ogg" } }), {
          status: 200,
        }),
      );
    }
    return Promise.resolve(new Response(new Uint8Array([9, 8, 7]), { status: 200 }));
  };
  const client = new FetchTelegramClient({ botToken: "TOKEN" }, fakeFetch as typeof fetch);
  const url = await client.getFileUrl("voice1");
  assertEquals(url, "https://api.telegram.org/file/botTOKEN/voice/file_1.ogg");
  const bytes = await client.downloadFile(url!);
  assertEquals(bytes, new Uint8Array([9, 8, 7]));
  assertEquals(calls.filter((c) => c.includes("/getFile")).length, 1);
});

Deno.test("FetchTranscriber: posts multipart form to audio/transcriptions and parses text", async () => {
  const seen: { url: string; auth?: string; contentType?: string }[] = [];
  const fakeFetch = (url: string, init?: RequestInit) => {
    seen.push({
      url: String(url),
      auth: (init?.headers as Record<string, string>)?.Authorization,
      contentType: (init?.headers as Record<string, string>)?.["Content-Type"],
    });
    return Promise.resolve(new Response(JSON.stringify({ text: " hello world " }), { status: 200 }));
  };
  const cfg = loadTranscribeConfig({
    get: (k: string) =>
      ({
        AI_BASE_URL: "https://ai.example.com/",
        AI_API_KEY: "k",
        AI_TRANSCRIBE_MODEL: "@cf/openai/whisper",
      })[k],
  });
  const t = new FetchTranscriber(cfg!, fakeFetch as typeof fetch);
  const text = await t.transcribe(new Uint8Array([1, 2, 3]), "voice.ogg");
  assertEquals(text, "hello world");
  assertEquals(seen[0].url, "https://ai.example.com/audio/transcriptions");
  assertEquals(seen[0].auth, "Bearer k");
  assertEquals(seen[0].contentType, undefined); // browser must set the multipart boundary
});

Deno.test("FetchTranscriber: HTTP failure throws TranscribeError (caller degrades to placeholder)", async () => {
  const fakeFetch = (_url: string, _init?: RequestInit) =>
    Promise.resolve(new Response("boom", { status: 500 }));
  const cfg = loadTranscribeConfig({
    get: (k: string) =>
      ({ AI_BASE_URL: "https://ai.example.com", AI_API_KEY: "k", AI_TRANSCRIBE_MODEL: "m" })[k],
  });
  const t = new FetchTranscriber(cfg!, fakeFetch as typeof fetch);
  let threw = false;
  try {
    await t.transcribe(new Uint8Array([1]), "voice.ogg");
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

Deno.test("loadTranscribeConfig: null when any required var is missing", () => {
  assertEquals(
    loadTranscribeConfig({ get: () => undefined }),
    null,
  );
});

Deno.test("parseUpdate: rejects invalid JSON and non-objects", () => {
  assertEquals(parseUpdate("not json"), null);
  assertEquals(parseUpdate("[1,2,3]"), null);
  assertEquals(parseUpdate('{"message":{"message_id":1,"chat":{"id":2,"type":"private"}}}')?.message?.message_id, 1);
});

Deno.test("FetchTelegramClient.sendMessage truncates to the 4096 Telegram limit", async () => {
  const bodies: unknown[] = [];
  const fakeFetch = (_url: string, init?: { body?: unknown }) => {
    bodies.push(JSON.parse(init!.body as string));
    return Promise.resolve(
      new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 }),
    );
  };
  const client = new FetchTelegramClient({ botToken: "TOKEN" }, fakeFetch as typeof fetch);
  await client.sendMessage("123", "x".repeat(5000));
  const body = bodies[0] as { text: string };
  assertEquals(body.text.length, 4000);
});
