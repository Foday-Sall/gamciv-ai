/**
 * Tests for the welcome-email function (functions/welcome-email).
 *
 * Runs handleWelcomeEmail with stubbed Resend client and PostgREST fetch:
 * guard checks, single-send policy, logging, invalid payloads — no network.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  handleWelcomeEmail,
  looksLikeEmail,
  type WelcomeEmailDeps,
} from "../functions/welcome-email/index.ts";

interface SendRec {
  to: string;
  subject: string;
}

interface Route {
  /** Substring to match in the request URL. */
  match: string;
  status: number;
  body?: unknown;
}

function makeDeps(sends: SendRec[], _logs: unknown[], routes: Route[]): WelcomeEmailDeps {
  return {
    postgrestUrl: "http://kong:8000",
    serviceRoleKey: "service-role-key",
    resend: {
      send: (o) => {
        sends.push({ to: o.to, subject: o.subject });
        return Promise.resolve({ ok: true, id: `id_${sends.length}` });
      },
    },
    from: "GamCiv <noreply@pocketsoftware.dev>",
    fetchImpl: (url: string | URL | Request) => {
      const u = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
      const route = routes.find((r) => u.includes(r.match));
      return Promise.resolve(
        new Response(route?.body ? JSON.stringify(route.body) : null, {
          status: route?.status ?? 404,
        }),
      );
    },
    now: new Date(),
  };
}

Deno.test("looksLikeEmail accepts normal addresses and rejects garbage", () => {
  assertEquals(looksLikeEmail("person@example.com"), true);
  assertEquals(looksLikeEmail("a.b+tag@sub.domain.org"), true);
  assertEquals(looksLikeEmail("nope"), false);
  assertEquals(looksLikeEmail("no-at-sign.com"), false);
  assertEquals(looksLikeEmail(""), false);
});

Deno.test("first-time Google user: exactly one welcome email is sent and logged", async () => {
  const sends: SendRec[] = [];
  const logWrites: unknown[] = [];
  const deps = makeDeps(sends, [], [
    // guard table: empty (no rows yet)
    { match: "welcome_email_log", status: 200, body: [] },
    // email_log: no previous welcome for this address
    { match: "email_log", status: 200, body: [] },
  ]);
  // capture the email_log write (logSystemEmail POSTs the row)
  const baseFetch = deps.fetchImpl;
  deps.fetchImpl = (url, init) => {
    const u = typeof url === "string" ? url : String((url as URL).href);
    if (u.includes("email_log") && init && "method" in init && init.method === "POST") {
      logWrites.push(JSON.parse(String("body" in init ? init.body : undefined)));
      return Promise.resolve(new Response(null, { status: 201 }));
    }
    return baseFetch(url, init);
  };

  const res = await handleWelcomeEmail(
    { user_id: "11111111-1111-1111-1111-111111111111", email: "NewGoogle.User@Example.com " },
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals(sends.length, 1);
  assertEquals(sends[0].to, "newgoogle.user@example.com");
  assertEquals(sends[0].subject, "Welcome to GamCiv");
  // one email_log row written
  assertEquals(logWrites.length, 1);
  const logRow = logWrites[0] as { template: string; status: string };
  assertEquals(logRow.template, "welcome");
  assertEquals(logRow.status, "sent");
});

Deno.test("guard rows present: no second send (replayed call is a no-op)", async () => {
  const sends: SendRec[] = [];
  const deps = makeDeps(sends, [], [
    {
      match: "welcome_email_log",
      status: 200,
      body: [{ user_id: "11111111-1111-1111-1111-111111111111" }],
    },
  ]);

  const res = await handleWelcomeEmail(
    { user_id: "11111111-1111-1111-1111-111111111111", email: "person@example.com" },
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals(sends.length, 0);
});

Deno.test("email_log already has a welcome for this address: no second send", async () => {
  const sends: SendRec[] = [];
  const deps = makeDeps(sends, [], [
    { match: "welcome_email_log", status: 200, body: [] },
    { match: "email_log", status: 200, body: [{ to_email: "person@example.com" }] },
  ]);

  const res = await handleWelcomeEmail(
    { user_id: "11111111-1111-1111-1111-111111111111", email: "person@example.com" },
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals(sends.length, 0);
});

Deno.test("invalid payloads: 400 and no send", async () => {
  const sends: SendRec[] = [];
  const deps = makeDeps(sends, [], []);

  const badEmail = await handleWelcomeEmail(
    { user_id: "11111111-1111-1111-1111-111111111111", email: "not-an-email" },
    deps,
  );
  assertEquals(badEmail.status, 400);

  const noUser = await handleWelcomeEmail({ email: "a@b.co" }, deps);
  assertEquals(noUser.status, 400);

  assertEquals(sends.length, 0);
});

Deno.test("failed Resend send is logged as failed and still answers 200", async () => {
  const deps = makeDeps([], [], [
    { match: "welcome_email_log", status: 200, body: [] },
    { match: "email_log", status: 200, body: [] },
  ]);
  deps.resend = {
    send: () => Promise.resolve({ ok: false as const, error: "resend HTTP 500" }),
  };
  // capture the log write
  const logWrites: unknown[] = [];
  const baseFetch = deps.fetchImpl;
  deps.fetchImpl = (url, init) => {
    const u = typeof url === "string" ? url : String((url as URL).href);
    if (u.includes("email_log") && init && "method" in init && init.method === "POST") {
      logWrites.push(JSON.parse(String("body" in init ? init.body : undefined)));
      return Promise.resolve(new Response(null, { status: 201 }));
    }
    return baseFetch(url, init);
  };

  const res = await handleWelcomeEmail(
    { user_id: "11111111-1111-1111-1111-111111111111", email: "person@example.com" },
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals(logWrites.length, 1);
  const row = logWrites[0] as { template: string; status: string; error: string };
  assertEquals(row.template, "welcome");
  assertEquals(row.status, "failed");
  assertEquals(row.error, "resend HTTP 500");
});
