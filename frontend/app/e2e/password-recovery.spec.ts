import { expect, test } from "@playwright/test";

const testEmail = "reset-test@example.com";
const recoveryEmailKey = "gamciv:password-recovery-email";

for (const viewport of [
  { name: "desktop", width: 1280, height: 800 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test.describe(`${viewport.name} password recovery`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("forgot-password page starts with an email field", async ({ page }) => {
      const runtimeErrors: string[] = [];
      page.on("pageerror", (error) => runtimeErrors.push(error.message));

      await page.goto("/app/forgot-password", { waitUntil: "load" });
      await expect(page.getByRole("heading", { name: "Forgot your password?" }))
        .toBeVisible();
      await expect(page.getByLabel("Email")).toBeVisible();
      await expect(page.getByRole("button", { name: "Send reset code" }))
        .toBeVisible();
      await expect(page.locator("input[type=password]")).toHaveCount(0);
      expect(runtimeErrors).toEqual([]);
    });

    test("reset-code page explains the generic email response", async ({ page }) => {
      await page.addInitScript((key) => {
        window.sessionStorage.setItem(key, "reset-test@example.com");
      }, recoveryEmailKey);

      await page.goto("/app/reset-password", { waitUntil: "load" });
      await expect(page.getByRole("heading", { name: "Check your email" }))
        .toBeVisible();
      await expect(page.getByLabel("6-digit code")).toBeVisible();
      await expect(page.getByRole("status")).toContainText(
        "If an account exists for this email",
      );
      await expect(page.getByRole("button", { name: "Verify code" }))
        .toBeVisible();
    });
  });
}

test("a valid recovery OTP unlocks the new-password step", async ({ page }) => {
  let recoveryRequest: Record<string, unknown> | null = null;
  let otpRequest: Record<string, unknown> | null = null;
  let updatedPassword: string | null = null;
  const user = {
    id: "00000000-0000-0000-0000-000000000001",
    aud: "authenticated",
    role: "authenticated",
    email: testEmail,
    email_confirmed_at: "2026-10-20T00:00:00.000Z",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    identities: [],
    created_at: "2026-10-20T00:00:00.000Z",
  };

  await page.route("**/auth/v1/recover**", async (route) => {
    recoveryRequest = JSON.parse(route.request().postData() ?? "{}") as Record<
      string,
      unknown
    >;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "{}",
    });
  });
  await page.route("**/auth/v1/verify**", async (route) => {
    otpRequest = JSON.parse(route.request().postData() ?? "{}") as Record<
      string,
      unknown
    >;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        access_token:
          "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJmYWtlLXVzZXIiLCJleHAiOjQxMDI0NDQ4MDAsImF1ZCI6ImF1dGhlbnRpY2F0ZWQifQ.signature",
        token_type: "bearer",
        expires_in: 3600,
        refresh_token: "mock-refresh-token",
        user,
      }),
    });
  });
  await page.route("**/auth/v1/user**", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as {
      password?: string;
    };
    updatedPassword = body.password ?? null;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(user),
    });
  });

  await page.goto("/app/forgot-password");
  await page.getByLabel("Email").fill(testEmail);
  await page.getByRole("button", { name: "Send reset code" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" }))
    .toBeVisible();
  await expect(page.getByRole("status")).toContainText(
    "If an account exists for this email",
  );

  await page.getByLabel("6-digit code").fill("123456");
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(page.getByRole("heading", { name: "Choose a new password" }))
    .toBeVisible();

  await page.getByLabel("New password", { exact: true }).fill("NewPassword123");
  await page.getByLabel("Confirm new password", { exact: true })
    .fill("NewPassword123");
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.getByRole("heading", { name: "Welcome back" }))
    .toBeVisible();

  expect(recoveryRequest).toMatchObject({ email: testEmail });
  expect(otpRequest).toMatchObject({
    email: testEmail,
    token: "123456",
    type: "recovery",
  });
  expect(updatedPassword).toBe("NewPassword123");
});
