import { expect, test } from "@playwright/test";

const USER_ID = "00000000-0000-4000-8000-000000000401";
const NAWEC_ID = "00000000-0000-4000-8000-000000000402";
const CATEGORY_ID = "00000000-0000-4000-8000-000000000403";
const COMPLAINT_ID = "00000000-0000-4000-8000-000000000404";

test("photo retry is visible and works after a fetch failure", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const session = {
    access_token: "test-access-token",
    refresh_token: "test-refresh-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: USER_ID,
      aud: "authenticated",
      role: "authenticated",
      email: "citizen@example.invalid",
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

  const profile = {
    user_id: USER_ID,
    email: "citizen@example.invalid",
    role: "citizen",
    full_name: "Test Citizen",
    phone_verified: true,
    email_verified: true,
  };
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
    const pathname = new URL(request.url()).pathname;
    if (pathname.endsWith("/profiles")) {
      await route.fulfill({ status: 200, headers, body: JSON.stringify(profile) });
      return;
    }
    if (pathname.endsWith("/institutions")) {
      await route.fulfill({
        status: 200,
        headers,
        body: JSON.stringify([{
          id: NAWEC_ID,
          code: "NAWEC",
          name: "National Water and Electricity Company",
          type: "utility",
          logo_url: null,
        }]),
      });
      return;
    }
    if (pathname.endsWith("/categories")) {
      await route.fulfill({
        status: 200,
        headers,
        body: JSON.stringify([{
          id: CATEGORY_ID,
          slug: "water_supply",
          name: "Water supply",
          default_institution_id: NAWEC_ID,
          is_sensitive: false,
          is_emergency: false,
          deadline_hours: 24,
        }]),
      });
      return;
    }
    if (pathname.endsWith("/rpc/fn_dashboard_access")) {
      await route.fulfill({ status: 200, headers, body: JSON.stringify({ ok: true, role: "citizen" }) });
      return;
    }
    if (pathname.endsWith("/rpc/submit_complaint")) {
      await route.fulfill({
        status: 200,
        headers,
        body: JSON.stringify({
          complaint_id: COMPLAINT_ID,
          tracking_no: "GC-TEST-RETRY",
          institution: "NAWEC",
          institution_name: "National Water and Electricity Company",
        }),
      });
      return;
    }
    await route.fulfill({ status: 404, headers, body: JSON.stringify({ message: "Unexpected test request" }) });
  });

  let uploadAttempts = 0;
  await page.route("**/functions/v1/citizen-photo-upload", async (route) => {
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
    uploadAttempts += 1;
    if (uploadAttempts === 1) {
      await route.abort("failed");
      return;
    }
    await route.fulfill({ status: 200, headers, body: JSON.stringify({ ok: true }) });
  });

  await page.goto("/app/report");
  await expect(page.getByRole("heading", { name: "Who should handle it?" })).toBeVisible();
  await page.getByRole("button", { name: /National Water and Electricity Company/ }).click();
  await page.getByRole("button", { name: "Water supply" }).click();
  await page.getByLabel("Title").fill("Water is unavailable at the clinic");
  await page.getByLabel("What happened?").fill("Water supply has been unavailable since this morning.");
  await page.locator('input[type="file"]').setInputFiles({
    name: "report.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1WQAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("combobox").click();
  await page.getByRole("option").first().click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Send report", exact: true }).click();
  await page.getByRole("button", { name: "Yes, submit report", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Report submitted" })).toBeVisible();
  const failureNotice = page.getByRole("alert").filter({ hasText: "We could not confirm the photo attachment" });
  await expect(failureNotice).toContainText("photo_service_unreachable");
  const retryButton = page.getByRole("button", { name: "Retry photo upload", exact: true });
  await expect(retryButton).toBeVisible();
  await expect(retryButton).toBeInViewport();
  await retryButton.click();

  await expect(failureNotice).toHaveCount(0);
  await expect(page.getByText("Photo attached to your report.", { exact: true })).toBeVisible();
  expect(uploadAttempts).toBe(2);
});
