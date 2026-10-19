/** Unit tests for the telegram-intake pipeline (stubbed deps, no network). */
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildDeps,
  confirmationText,
  extractReport,
  handleRequest,
  processReport,
  type TelegramIntakeDeps,
} from "../functions/telegram-intake/index.ts";
import { FetchTelegramClient } from "../functions/telegram-intake/telegram.ts";
import type { SubmitComplaintArgs, SubmitComplaintResult } from "../functions/_shared/types.ts";

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

interface Recorded {
  aiCalls: string[];
  rpcCalls: Array<{ fn: string; args: unknown }>;
  sentMessages: Array<{ chatId: string; text: string }>;
  getFileCalls: string[];
}

function makeDeps(
  opts: {
    ai?:
      | { category: string; urgency: "critical" | "high" | "normal" | "low"; confidence: number }
      | Error;
    rpcResult?: SubmitComplaintResult | Error;
    sendError?: Error;
    /** getFile resolution per photo file_id; missing key or null value → null URL. */
    fileMap?: Record<string, string | null>;
    getFileError?: Error;
  } = {},
): { deps: TelegramIntakeDeps; recorded: Recorded } {
  const recorded: Recorded = { aiCalls: [], rpcCalls: [], sentMessages: [], getFileCalls: [] };
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
      call: (fn: string, args: unknown) => {
        recorded.rpcCalls.push({ fn, args });
        if (opts.rpcResult instanceof Error) return Promise.reject(opts.rpcResult);
        return Promise.resolve((opts.rpcResult ?? baseResult) as never);
      },
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

Deno.test("handleRequest: valid secret token passes and runs the pipeline", async () => {
  const { deps, recorded } = makeDeps();
  const res = await handleRequest(
    telegramRequest(textUpdate("No water in Bakoteh")),
    deps,
    "tgsecret",
  );
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(json.status, "accepted");
  assertEquals(recorded.rpcCalls.length, 1);
});

Deno.test("handleRequest: invalid secret token rejected 401", async () => {
  const { deps, recorded } = makeDeps();
  const res = await handleRequest(telegramRequest(textUpdate("hi"), "wrong"), deps, "tgsecret");
  assertEquals(res.status, 401);
  assertEquals(recorded.rpcCalls.length, 0);
});

Deno.test("handleRequest: missing secret token rejected 401", async () => {
  const { deps, recorded } = makeDeps();
  const req = new Request("https://example.com/telegram-intake", {
    method: "POST",
    body: JSON.stringify(textUpdate("hi")),
  });
  const res = await handleRequest(req, deps, "tgsecret");
  assertEquals(res.status, 401);
  assertEquals(recorded.rpcCalls.length, 0);
});

Deno.test("handleRequest: unconfigured secret rejects everything", async () => {
  const { deps, recorded } = makeDeps();
  const res = await handleRequest(telegramRequest(textUpdate("hi"), "tgsecret"), deps, "");
  assertEquals(res.status, 401);
  assertEquals(recorded.rpcCalls.length, 0);
});

Deno.test("handleRequest: invalid JSON body rejected 400", async () => {
  const { deps } = makeDeps();
  const req = new Request("https://example.com/telegram-intake", {
    method: "POST",
    headers: { "X-Telegram-Bot-Api-Secret-Token": "tgsecret" },
    body: "not json",
  });
  const res = await handleRequest(req, deps, "tgsecret");
  assertEquals(res.status, 400);
});

Deno.test("handleRequest: oversized body rejected 413 before parsing", async () => {
  const { deps, recorded } = makeDeps();
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
// Text message pipeline
// ---------------------------------------------------------------------------

Deno.test("handleRequest + processReport: text message files a report with correct args", async () => {
  const { deps, recorded } = makeDeps();
  const res = await handleRequest(
    telegramRequest(textUpdate("No water in Bakoteh since morning")),
    deps,
    "tgsecret",
  );
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(json.status, "accepted");
  assertEquals(json.tracking_no, "GC-2026-00007");

  assertEquals(recorded.rpcCalls.length, 1);
  assertEquals(recorded.rpcCalls[0].fn, "submit_complaint");
  const args = recorded.rpcCalls[0].args as SubmitComplaintArgs;
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

  // Confirmation sent back to the same chat
  assertEquals(recorded.sentMessages.length, 1);
  assertEquals(recorded.sentMessages[0].chatId, "5022113344");
  assertStringIncludes(recorded.sentMessages[0].text, "GC-2026-00007");
  assertStringIncludes(recorded.sentMessages[0].text, "NAWEC");
  assertEquals(recorded.getFileCalls.length, 0);
});

Deno.test("processReport: AI failure still files the report (hints null)", async () => {
  const { deps, recorded } = makeDeps({ ai: new Error("ai down") });
  const report = extractReport(textUpdate("No water in Bakoteh"))!;
  const outcome = await processReport(report, deps);
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

    await processReport(report, deps);
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
  await processReport(extractReport(update)!, deps);
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
    await processReport(extractReport(update)!, deps);
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
    await processReport(extractReport(update)!, deps);
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
  await processReport(extractReport(update)!, deps);
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
  await processReport(extractReport(update)!, deps);
  const args = recorded.rpcCalls[0].args as SubmitComplaintArgs;
  assertEquals(args.p_description, "Flooding here");
  assertEquals(args.p_lat, 13.45);
  assertEquals(args.p_lng, -16.58);
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

Deno.test("processReport: duplicate update id reuses the same external_id (SQL side dedupes)", async () => {
  const { deps, recorded } = makeDeps();
  const first = extractReport(textUpdate("No water in Bakoteh", 111, 5022113344))!;
  await processReport(first, deps);
  // Same Telegram update delivered again (webhook retry / dedupe miss):
  const second = extractReport(textUpdate("No water in Bakoteh", 111, 5022113344))!;
  await processReport(second, deps);

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
// Confirmation copy & misc
// ---------------------------------------------------------------------------

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

Deno.test("processReport: Telegram send failure does not fail the intake", async () => {
  const { deps, recorded } = makeDeps({ sendError: new Error("telegram down") });
  const report = extractReport(textUpdate("No water in Bakoteh"))!;
  const outcome = await processReport(report, deps);
  assertEquals(outcome.status, "accepted");
  assertEquals(recorded.sentMessages.length, 1);
});

Deno.test("processReport: RPC failure propagates (caller returns 500 so Telegram retries)", async () => {
  const { deps } = makeDeps({ rpcResult: new Error("db down") });
  const report = extractReport(textUpdate("No water in Bakoteh"))!;
  let threw = false;
  try {
    await processReport(report, deps);
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
