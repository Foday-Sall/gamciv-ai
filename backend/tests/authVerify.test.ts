/**
 * Regression tests for phone OTP verification. These ensure an unsuccessful
 * verification can never mark the user's profile as phone verified.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  handleVerifyPhoneOtp,
  type AuthVerifyDeps,
} from "../functions/auth-verify/index.ts";
import { hashOtp } from "../functions/_shared/otp.ts";

const USER_ID = "11111111-1111-1111-1111-111111111111";
const PHONE = "2207123456";

async function makeDeps(code: string | null) {
  const now = new Date("2026-10-20T12:00:00.000Z");
  const writes: Array<{ url: string; body: Record<string, unknown> }> = [];
  const rows = code === null
    ? []
    : [{
      id: "otp-row",
      code_hash: await hashOtp(code),
      expires_at: new Date(now.getTime() + 10 * 60_000).toISOString(),
      attempts: 0,
      consumed_at: null,
    }];
  const deps: AuthVerifyDeps = {
    postgrestUrl: "http://kong:8000",
    serviceRoleKey: "test-service-role-key",
    authUrl: "http://kong:8000/auth/v1",
    settings: null,
    resend: null,
    gowa: null,
    fetchImpl: async (input, init) => {
      const url = String(input);
      if (init?.method === "PATCH") {
        writes.push({
          url,
          body: JSON.parse(String(init.body)) as Record<string, unknown>,
        });
        return new Response(null, { status: 204 });
      }
      if (url.includes("/rest/v1/otp_codes?")) {
        return Response.json(rows);
      }
      return new Response("Not found", { status: 404 });
    },
    now,
  };
  return { deps, writes };
}

Deno.test("wrong phone code does not mark the profile verified", async () => {
  const { deps, writes } = await makeDeps("123456");
  const response = await handleVerifyPhoneOtp(
    { id: USER_ID, email: "citizen@example.com", app_metadata: {} },
    { phone: PHONE, code: "654321" },
    deps,
  );

  assertEquals(response.status, 400);
  assertEquals(writes.length, 1);
  assertEquals(writes[0].url.includes("/otp_codes?"), true);
  assertEquals(writes[0].body.attempts, 1);
  assertEquals(writes.some((write) => write.url.includes("/profiles?")), false);
});

Deno.test("correct phone code consumes the OTP and marks the profile verified", async () => {
  const { deps, writes } = await makeDeps("123456");
  const response = await handleVerifyPhoneOtp(
    { id: USER_ID, email: "citizen@example.com", app_metadata: {} },
    { phone: PHONE, code: "123456" },
    deps,
  );

  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    verified: true,
    message: "Phone verified. You are all set.",
  });
  const profileWrite = writes.find((write) => write.url.includes("/profiles?"));
  assertEquals(profileWrite?.body, { phone: PHONE, phone_verified: true });
});

Deno.test("missing active phone code does not update the profile", async () => {
  const { deps, writes } = await makeDeps(null);
  const response = await handleVerifyPhoneOtp(
    { id: USER_ID, email: "citizen@example.com", app_metadata: {} },
    { phone: PHONE, code: "123456" },
    deps,
  );

  assertEquals(response.status, 400);
  assertEquals(await response.json(), {
    error: "No active code. Request a new one.",
    message: "No active code. Request a new one.",
  });
  assertEquals(writes.length, 0);
});
