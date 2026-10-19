/** Unit tests for the Go channels service bridge (channelBridge.ts). */
import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  channelsUrl,
  ChannelsBridge,
  ChannelsBridgeError,
  sendOrFallback,
} from "../functions/_shared/channelBridge.ts";

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.test("channelsUrl trims trailing slashes and returns null when unset", () => {
  assertEquals(channelsUrl({ get: () => undefined }), null);
  assertEquals(channelsUrl({ get: () => "" }), null);
  assertEquals(channelsUrl({ get: () => "   " }), null);
  assertEquals(channelsUrl({ get: () => "http://localhost:8811///" }), "http://localhost:8811");
});

Deno.test("ChannelsBridge.send posts to /send and accepts queued", async () => {
  let calledPath = "";
  let calledBody = "";
  const fetchStub = ((_url: string | URL, init?: RequestInit) => {
    calledPath = String(_url);
    calledBody = String(init?.body ?? "");
    return Promise.resolve(jsonRes({ status: "queued" }, 202));
  }) as typeof fetch;

  const bridge = new ChannelsBridge("http://127.0.0.1:8811/", fetchStub);
  const result = await bridge.send("telegram", "12345", "hello");
  assertEquals(result, { status: "queued" });
  assertEquals(calledPath, "http://127.0.0.1:8811/send");
  assertEquals(calledBody, JSON.stringify({ channel: "telegram", to: "12345", content: "hello" }));
});

Deno.test("ChannelsBridge.send rejects validation errors from the service", async () => {
  const fetchStub = (() =>
    Promise.resolve(jsonRes({ status: "error", error: "channel, to and content are required" }, 400))) as typeof fetch;
  const bridge = new ChannelsBridge("http://127.0.0.1:8811", fetchStub);
  await assertRejects(
    () => bridge.send("telegram", "12345", "hi"),
    ChannelsBridgeError,
    "HTTP 400",
  );
});

Deno.test("ChannelsBridge.send surfaces bus publish failures (502)", async () => {
  const fetchStub = (() =>
    Promise.resolve(jsonRes({ status: "error", error: "message bus closed" }, 502))) as typeof fetch;
  const bridge = new ChannelsBridge("http://127.0.0.1:8811", fetchStub);
  await assertRejects(() => bridge.send("whatsapp", "2207123456", "hi"), ChannelsBridgeError);
});

Deno.test("ChannelsBridge.send rejects unexpected status payloads", async () => {
  const fetchStub = (() => Promise.resolve(jsonRes({ status: "weird" }, 200))) as typeof fetch;
  const bridge = new ChannelsBridge("http://127.0.0.1:8811", fetchStub);
  await assertRejects(
    () => bridge.send("telegram", "1", "hi"),
    ChannelsBridgeError,
    "unexpected status",
  );
});

Deno.test("ChannelsBridge.send throws when the service is unreachable", async () => {
  const fetchStub = (() => Promise.reject(new Error("connect refused"))) as typeof fetch;
  const bridge = new ChannelsBridge("http://127.0.0.1:8811", fetchStub);
  await assertRejects(
    () => bridge.send("telegram", "1", "hi"),
    ChannelsBridgeError,
    "unreachable",
  );
});

Deno.test("ChannelsBridge.send validates arguments locally", async () => {
  const fetchStub = (() => Promise.resolve(jsonRes({ status: "queued" }, 202))) as typeof fetch;
  const bridge = new ChannelsBridge("http://127.0.0.1:8811", fetchStub);
  await assertRejects(
    () => bridge.send("telegram" as never, "", "hi"),
    ChannelsBridgeError,
    "required",
  );
  await assertRejects(() => bridge.send("telegram", "", "hi"), ChannelsBridgeError, "required");
  await assertRejects(() => bridge.send("telegram", "1", ""), ChannelsBridgeError, "required");
});

Deno.test("sendOrFallback falls back to direct send when CHANNELS_URL is unset", async () => {
  let directCalled = 0;
  const result = await sendOrFallback(
    { get: () => undefined },
    "whatsapp",
    "2207123456",
    "hello",
    () => {
      directCalled++;
      return Promise.resolve();
    },
  );
  assertEquals(directCalled, 1);
  assertEquals(result, { status: "fallback" });
});

Deno.test("sendOrFallback routes through the bridge when CHANNELS_URL is set", async () => {
  let directCalled = 0;
  let postedPath = "";
  const fetchStub = ((_url: string | URL, init?: RequestInit) => {
    postedPath = String(_url);
    return Promise.resolve(jsonRes({ status: "queued" }, 202));
  }) as typeof fetch;

  const result = await sendOrFallback(
    { get: (n) => (n === "CHANNELS_URL" ? "http://127.0.0.1:8811" : undefined) },
    "telegram",
    "12345",
    "hello",
    () => {
      directCalled++;
      return Promise.resolve();
    },
    fetchStub,
  );
  assertEquals(directCalled, 0);
  assertEquals(postedPath, "http://127.0.0.1:8811/send");
  assertEquals(result, { status: "queued" });
});

Deno.test("sendOrFallback propagates bridge errors (no silent direct retry)", async () => {
  const fetchStub = (() =>
    Promise.resolve(jsonRes({ status: "error", error: "bus closed" }, 502))) as typeof fetch;
  let directCalled = 0;
  await assertRejects(
    () =>
      sendOrFallback(
        { get: (n) => (n === "CHANNELS_URL" ? "http://127.0.0.1:8811" : undefined) },
        "telegram",
        "1",
        "hi",
        () => {
          directCalled++;
          return Promise.resolve();
        },
        fetchStub,
      ),
    ChannelsBridgeError,
  );
  assertEquals(directCalled, 0);
});
