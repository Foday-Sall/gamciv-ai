import { expect, test } from "@playwright/test";

test("requesting a new WhatsApp code clears the previously entered code", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });

  const profile = {
    user_id: "00000000-0000-4000-8000-000000000301",
    email: "citizen@example.invalid",
    role: "citizen",
    full_name: "Test Citizen",
    phone_verified: false,
    email_verified: true,
  };
  const session = {
    access_token: "test-access-token",
    refresh_token: "test-refresh-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: profile.user_id,
      aud: "authenticated",
      role: "authenticated",
      email: profile.email,
      app_metadata: { provider: "email", providers: ["email"] },
      user_metadata: {},
      identities: [],
      created_at: "2026-10-20T00:00:00.000Z",
    },
  };
  await page.addInitScript((storedSession) => {
    for (const projectRef of ["ci-placeholder", "api", "example"]) {
      window.localStorage.setItem(`sb-${projectRef}-auth-token`, JSON.stringify(storedSession));
    }
  }, session);

  const sendPhones: string[] = [];
  await page.route("**/rest/v1/**", async (route) => {
    const request = route.request();
    const origin = request.headers().origin ?? "*";
    const headers = {
      "access-control-allow-origin": origin,
      "access-control-allow-headers": "apikey,authorization,content-type,x-client-info,prefer,range",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "content-type": "application/json",
    };
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers });
      return;
    }
    if (new URL(request.url()).pathname.endsWith("/profiles")) {
      await route.fulfill({ status: 200, headers, body: JSON.stringify(profile) });
      return;
    }
    await route.fulfill({ status: 404, headers, body: JSON.stringify({ message: "Unexpected test request" }) });
  });

  await page.route("**/functions/v1/auth-verify/**", async (route) => {
    const request = route.request();
    const origin = request.headers().origin ?? "*";
    const headers = {
      "access-control-allow-origin": origin,
      "access-control-allow-headers": "apikey,authorization,content-type,x-client-info",
      "access-control-allow-methods": "POST,OPTIONS",
      "content-type": "application/json",
    };
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers });
      return;
    }
    const body = request.postDataJSON() as { phone?: string };
    sendPhones.push(body.phone ?? "");
    await route.fulfill({ status: 200, headers, body: JSON.stringify({ sent: true, message: "Code sent" }) });
  });

  await page.goto("/app/verify/phone");
  await expect(page.getByText("Verify your phone", { exact: true })).toBeVisible();
  await page.getByLabel("Phone number").fill("7123456");
  const sendButton = page.getByRole("button", { name: "Send code on WhatsApp" });
  await expect(sendButton).toBeEnabled();
  await sendButton.click();

  const codeInput = page.getByLabel("6-digit WhatsApp code");
  await expect(codeInput).toBeVisible();
  await codeInput.fill("123456");
  const resendButton = page.getByRole("button", { name: "Resend code", exact: true });
  await expect(resendButton).toBeEnabled({ timeout: 70_000 });
  await resendButton.click();

  await expect(codeInput).toHaveValue("");
  expect(sendPhones).toEqual(["2207123456", "2207123456"]);
});
