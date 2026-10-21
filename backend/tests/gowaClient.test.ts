/** Unit tests for the GOWA webhook parsing, signature verification, and the
 * timeout/retry wrapper used by all outbound fetches. */
import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  extractMessage,
  FetchGowaClient,
  GowaError,
  normalizePhone,
  parseGowaEnvelope,
  verifyGowaSignature,
} from "../functions/_shared/gowaClient.ts";
import { fetchWithRetry, isNetworkError } from "../functions/_shared/http.ts";

const SECRET = "test-secret";

// ---- fetchWithRetry: timeout + one retry on network errors ----

function networkFailThenReturn(
  responses: Array<Response | Error>,
): { fetchImpl: typeof fetch; calls: () => number } {
  let calls = 0;
  return {
    calls: () => calls,
    fetchImpl: ((_url: string | URL | Request, _init?: RequestInit) => {
      const r = responses[calls];
      calls++;
      if (r instanceof Error) return Promise.reject(r);
      return Promise.resolve(r);
    }) as typeof fetch,
  };
}

const ok200 = () => new Response("{}", { status: 200 });

Deno.test("fetchWithRetry retries once on timeout (AbortError) then succeeds", async () => {
  const abort = new DOMException("The operation was aborted.", "AbortError");
  const { fetchImpl, calls } = networkFailThenReturn([abort, ok200()]);
  const res = await fetchWithRetry(fetchImpl, "http://x/y", { method: "GET" });
  assertEquals(res.status, 200);
  assertEquals(calls(), 2); // exactly one retry
});

Deno.test("fetchWithRetry retries once on TypeError (network failure) then succeeds", async () => {
  const { fetchImpl, calls } = networkFailThenReturn([
    new TypeError("fetch failed"),
    ok200(),
  ]);
  const res = await fetchWithRetry(fetchImpl, "http://x/y", { method: "GET" });
  assertEquals(res.status, 200);
  assertEquals(calls(), 2);
});

Deno.test("fetchWithRetry propagates the error when the retry also fails", async () => {
  const abort = new DOMException("aborted", "AbortError");
  const { fetchImpl, calls } = networkFailThenReturn([abort, abort]);
  await assertRejects(() => fetchWithRetry(fetchImpl, "http://x/y", {}));
  assertEquals(calls(), 2); // no second retry
});

Deno.test("fetchWithRetry does NOT retry on HTTP error statuses", async () => {
  const { fetchImpl, calls } = networkFailThenReturn([
    new Response("nope", { status: 502 }),
  ]);
  const res = await fetchWithRetry(fetchImpl, "http://x/y", {});
  assertEquals(res.status, 502);
  assertEquals(calls(), 1); // error status is a real response, returned as-is
});

Deno.test("fetchWithRetry does not retry on non-network errors", async () => {
  const { fetchImpl, calls } = networkFailThenReturn([new RangeError("bad")]);
  await assertRejects(
    () => fetchWithRetry(fetchImpl, "http://x/y", {}),
    RangeError,
  );
  assertEquals(calls(), 1);
});

Deno.test("isNetworkError covers abort/timeout/typeerror only", () => {
  assertEquals(isNetworkError(new TypeError("fetch failed")), true);
  assertEquals(isNetworkError(new DOMException("abort", "AbortError")), true);
  assertEquals(isNetworkError(new DOMException("t/o", "TimeoutError")), true);
  assertEquals(isNetworkError(new GowaError("gowa send HTTP 500")), false);
  assertEquals(isNetworkError(null), false);
});

Deno.test("FetchGowaClient sendMessage succeeds after a timed-out first attempt", async () => {
  const abort = new DOMException("aborted", "AbortError");
  let calls = 0;
  const client = new FetchGowaClient(
    { baseUrl: "http://gowa:3000", basicAuth: "u:p" },
    ((_url, init) => {
      calls++;
      // prove a fresh timeout signal is attached on each attempt
      assertEquals(
        init !== undefined && "signal" in init && init.signal instanceof AbortSignal,
        true,
      );
      if (calls === 1) return Promise.reject(abort);
      return Promise.resolve(
        new Response(JSON.stringify({ message_id: "M1", status: "sent" }), {
          status: 200,
        }),
      );
    }) as typeof fetch,
  );
  const out = await client.sendMessage("2207123456", "hello");
  assertEquals(out.messageId, "M1");
  assertEquals(out.status, "sent");
  assertEquals(calls, 2);
});

Deno.test("FetchGowaClient HTTP error status is thrown without retry", async () => {
  let calls = 0;
  const client = new FetchGowaClient(
    { baseUrl: "http://gowa:3000", basicAuth: "u:p" },
    (() => {
      calls++;
      return Promise.resolve(new Response("bad gateway", { status: 502 }));
    }) as typeof fetch,
  );
  await assertRejects(() => client.sendMessage("2207123456", "hello"), GowaError);
  assertEquals(calls, 1);
});

async function sign(body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return "sha256=" +
    Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.test("verifyGowaSignature accepts a valid HMAC", async () => {
  const body = JSON.stringify({ event: "message", payload: { body: "hi" } });
  const sig = await sign(body);
  assertEquals(await verifyGowaSignature(new TextEncoder().encode(body), sig, SECRET), true);
});

Deno.test("verifyGowaSignature rejects a tampered body", async () => {
  const body = JSON.stringify({ event: "message", payload: { body: "hi" } });
  const sig = await sign(body);
  const tampered = body.replace("hi", "BYE");
  assertEquals(await verifyGowaSignature(new TextEncoder().encode(tampered), sig, SECRET), false);
});

Deno.test("verifyGowaSignature rejects missing/bad prefix", async () => {
  const body = '{"event":"message"}';
  assertEquals(await verifyGowaSignature(new TextEncoder().encode(body), null, SECRET), false);
  assertEquals(
    await verifyGowaSignature(new TextEncoder().encode(body), "sha256=deadbeef", SECRET),
    false,
  );
});

Deno.test("parseGowaEnvelope rejects invalid JSON and missing event", () => {
  assertEquals(parseGowaEnvelope("not json"), null);
  assertEquals(parseGowaEnvelope('{"payload":{}}'), null);
  const ok = parseGowaEnvelope('{"event":"message","payload":{"body":"x"}}');
  assertEquals(ok?.event, "message");
});

Deno.test("extractMessage handles a text report", () => {
  const env = parseGowaEnvelope(
    JSON.stringify({
      event: "message",
      device_id: "2205000000@s.whatsapp.net",
      payload: {
        id: "MSG1",
        chat_id: "2207123456@s.whatsapp.net",
        from: "2207123456@s.whatsapp.net",
        sender_display_name: "Lamin",
        is_from_me: false,
        body: "No water in Bakoteh since morning",
      },
    }),
  )!;
  const msg = extractMessage(env)!;
  assertEquals(msg.phone, "2207123456");
  assertEquals(msg.name, "Lamin");
  assertEquals(msg.body, "No water in Bakoteh since morning");
  assertEquals(msg.isGroup, false);
});

Deno.test("extractMessage ignores own outgoing messages", () => {
  const env = parseGowaEnvelope(
    JSON.stringify({
      event: "message",
      payload: { from: "2205000000@s.whatsapp.net", is_from_me: true, body: "out" },
    }),
  )!;
  assertEquals(extractMessage(env), null);
});

Deno.test("extractMessage ignores group chats", () => {
  const env = parseGowaEnvelope(
    JSON.stringify({
      event: "message",
      payload: {
        chat_id: "120363410888139023@g.us",
        from: "2207123456@s.whatsapp.net",
        body: "group msg",
      },
    }),
  )!;
  assertEquals(extractMessage(env), null);
});

Deno.test("extractMessage ignores non-message events", () => {
  const env = parseGowaEnvelope(JSON.stringify({ event: "message.ack", payload: {} }))!;
  assertEquals(extractMessage(env), null);
});

Deno.test("extractMessage reads location payloads", () => {
  const env = parseGowaEnvelope(
    JSON.stringify({
      event: "message",
      payload: {
        from: "2207123456@s.whatsapp.net",
        location: { degreesLatitude: 13.455, degreesLongitude: -16.689, name: "Bakoteh" },
      },
    }),
  )!;
  const msg = extractMessage(env)!;
  assertEquals(msg.lat, 13.455);
  assertEquals(msg.lng, -16.689);
});

Deno.test("extractMessage reads captioned image (object form)", () => {
  const env = parseGowaEnvelope(
    JSON.stringify({
      event: "message",
      payload: {
        from: "2207123456@s.whatsapp.net",
        body: "overflowing dump",
        image: { path: "statics/media/x.jpeg" },
      },
    }),
  )!;
  const msg = extractMessage(env)!;
  assertEquals(msg.body, "overflowing dump");
  assertEquals(msg.imageUrl, "statics/media/x.jpeg");
});

Deno.test("extractMessage reads image path string form", () => {
  const env = parseGowaEnvelope(
    JSON.stringify({
      event: "message",
      payload: { from: "2207123456@s.whatsapp.net", image: "statics/media/x.jpeg" },
    }),
  )!;
  const msg = extractMessage(env)!;
  assertEquals(msg.imageUrl, "statics/media/x.jpeg");
});

Deno.test("normalizePhone strips JID to digits", () => {
  assertEquals(normalizePhone("2207123456@s.whatsapp.net"), "2207123456");
  assertEquals(normalizePhone("2207123456"), "2207123456");
  assertEquals(normalizePhone("120363410888139023@g.us"), "120363410888139023");
});
