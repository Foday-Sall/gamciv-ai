/**
 * Tests for the GoTrue Send Email hook (functions/email-hook).
 *
 * Runs handleHookRequest with stubbed Resend client and PostgREST fetch:
 * signature verification, template rendering, the signup welcome email,
 * and email_log writes — no network.
 */
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { Webhook } from "npm:standardwebhooks@1.0.0";
import {
  handleHookRequest,
  renderHookEmail,
  type EmailHookDeps,
} from "../functions/email-hook/index.ts";

const SECRET = "v1,whsec_zY8lj1MFwMZNgUwNqSzs88gK1XMuTa2zpHvB5VaFrs4=";

interface SendRec {
  to: string;
  subject: string;
}

interface LogRec {
  to: string;
  subject: string;
  template: string;
  status: string;
}

function makeDeps(sends: SendRec[], logs: LogRec[]): EmailHookDeps {
  return {
    secret: SECRET,
    resend: {
      send: (o) => {
        sends.push({ to: o.to, subject: o.subject });
        return Promise.resolve({ ok: true, id: `id_${sends.length}` });
      },
    },
    logDeps: {
      postgrestUrl: "http://kong:8000",
      serviceRoleKey: "service-role-key",
      fetchImpl: (_url, init) => {
        if (init?.body) {
          const row = JSON.parse(String(init.body)) as LogRec;
          logs.push(row);
        }
        return Promise.resolve(new Response(null, { status: 201 }));
      },
    },
    fetchImpl: fetch,
    from: "GamCiv <onboarding@resend.dev>",
  };
}

function signedRequest(body: string, secret = SECRET): Request {
  // Mirror the hook: strip the version prefix before constructing Webhook.
  const wh = new Webhook(secret.replace(/^v1,/, ""));
  const id = "msg_test_1";
  const timestamp = new Date();
  const signature = wh.sign(id, timestamp, body);
  return new Request("http://kong:8000/functions/v1/email-hook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "webhook-id": id,
      "webhook-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
      "webhook-signature": signature,
    },
    body,
  });
}

Deno.test("renderHookEmail: signup uses the verification template", () => {
  const r = renderHookEmail("signup", "123456", "citizen@example.com");
  assertEquals(r.template, "email_verify");
  assertStringIncludes(r.subject, "123456");
  assertStringIncludes(r.html, "<strong>123456</strong>");
  assertStringIncludes(r.text, "123456");
});

Deno.test("renderHookEmail: recovery and email_change get their own templates", () => {
  assertEquals(renderHookEmail("recovery", "111111", "x@y.z").template, "email_recovery");
  assertEquals(renderHookEmail("email_change", "222222", "x@y.z").template, "email_change");
  assertEquals(renderHookEmail("magiclink", "333333", "x@y.z").template, "email_magiclink");
  assertEquals(renderHookEmail(undefined, "444444", "x@y.z").template, "email_verify");
});

Deno.test("handleHookRequest: 405 for non-POST", async () => {
  const sends: SendRec[] = [];
  const logs: LogRec[] = [];
  const res = await handleHookRequest(
    new Request("http://kong:8000/functions/v1/email-hook"),
    makeDeps(sends, logs),
  );
  assertEquals(res.status, 405);
  assertEquals(sends.length, 0);
});

Deno.test("handleHookRequest: bad signature is rejected with 401 and no send", async () => {
  const sends: SendRec[] = [];
  const logs: LogRec[] = [];
  const body = JSON.stringify({
    user: { email: "citizen@example.com" },
    email_data: { token: "654321", email_action_type: "signup" },
  });
  const req = signedRequest(body, "v1,whsec_wrongsecretwrongsecretwrongsecret12=");
  const res = await handleHookRequest(req, makeDeps(sends, logs));
  assertEquals(res.status, 401);
  assertEquals(sends.length, 0);
  assertEquals(logs.length, 0);
});

Deno.test("handleHookRequest: valid signature, signup sends verification + welcome and logs both", async () => {
  const sends: SendRec[] = [];
  const logs: LogRec[] = [];
  const body = JSON.stringify({
    user: { email: "Citizen@Example.com" },
    email_data: { token: "654321", email_action_type: "signup", redirect_to: "https://x" },
  });
  const res = await handleHookRequest(signedRequest(body), makeDeps(sends, logs));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), {});
  assertEquals(sends.length, 2);
  assertEquals(sends[0].to, "citizen@example.com");
  assertStringIncludes(sends[0].subject, "654321");
  assertEquals(sends[1].subject, "Welcome to GamCiv");
  assertEquals(logs.length, 2);
  assertEquals(logs[0].template, "email_verify");
  assertEquals(logs[0].status, "sent");
  assertEquals(logs[1].template, "welcome");
});

Deno.test("handleHookRequest: non-signup action sends exactly one email", async () => {
  const sends: SendRec[] = [];
  const logs: LogRec[] = [];
  const body = JSON.stringify({
    user: { email: "citizen@example.com" },
    email_data: { token: "777777", email_action_type: "recovery" },
  });
  const res = await handleHookRequest(signedRequest(body), makeDeps(sends, logs));
  assertEquals(res.status, 200);
  assertEquals(sends.length, 1);
  assertEquals(logs.length, 1);
  assertEquals(logs[0].template, "email_recovery");
});

Deno.test("handleHookRequest: missing token or email is a 400 and sends nothing", async () => {
  const sends: SendRec[] = [];
  const logs: LogRec[] = [];
  const deps = makeDeps(sends, logs);
  const noToken = signedRequest(JSON.stringify({
    user: { email: "citizen@example.com" },
    email_data: { email_action_type: "signup" },
  }));
  assertEquals((await handleHookRequest(noToken, deps)).status, 400);
  const noEmail = signedRequest(JSON.stringify({
    user: {},
    email_data: { token: "654321", email_action_type: "signup" },
  }));
  assertEquals((await handleHookRequest(noEmail, deps)).status, 400);
  assertEquals(sends.length, 0);
  assertEquals(logs.length, 0);
});

Deno.test("handleHookRequest: failed Resend send is logged as failed but still 200", async () => {
  const sends: SendRec[] = [];
  const logs: LogRec[] = [];
  const deps = makeDeps(sends, logs);
  const failing: EmailHookDeps = {
    ...deps,
    resend: {
      send: () => Promise.resolve({ ok: false, error: "resend HTTP 422: domain not verified" }),
    },
  };
  const body = JSON.stringify({
    user: { email: "citizen@example.com" },
    email_data: { token: "654321", email_action_type: "signup" },
  });
  const res = await handleHookRequest(signedRequest(body), failing);
  assertEquals(res.status, 200);
  assertEquals(logs.length, 1);
  assertEquals(logs[0].status, "failed");
});
