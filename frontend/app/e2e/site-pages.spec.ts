import { expect, test, type Page } from "@playwright/test";

const productionBaseURL = process.env.BASE_URL;
const landingURL = productionBaseURL
  ? new URL("/", productionBaseURL).toString()
  : "http://127.0.0.1:4174/";
const sharedLoginURL = productionBaseURL
  ? new URL("/app/login", productionBaseURL).toString()
  : "http://127.0.0.1:4173/app/login";
const dashboardLoginURL = productionBaseURL
  ? new URL("/dash/login", productionBaseURL).toString()
  : "http://127.0.0.1:4175/dash/login";
const trackURL = productionBaseURL
  ? new URL("/app/track", productionBaseURL).toString()
  : "http://127.0.0.1:4173/app/track";

async function expectPageAndAssetsToRender(
  page: Page,
  url: string,
  heading: string,
) {
  const runtimeErrors: string[] = [];
  const assetFailures: string[] = [];
  const loadedAssetTypes = new Set<string>();

  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("response", (response) => {
    const pathname = new URL(response.url()).pathname;
    if (!pathname.includes("/assets/") || !/\.(js|css)$/.test(pathname)) {
      return;
    }
    if (response.status() >= 400) {
      assetFailures.push(`${response.status()} ${pathname}`);
    } else {
      loadedAssetTypes.add(pathname.endsWith(".js") ? "js" : "css");
    }
  });

  await page.goto(url, { waitUntil: "load" });
  await expect(page.getByRole("heading", { name: heading, exact: true }))
    .toBeVisible();
  await expect(page.locator("#root")).not.toBeEmpty();
  expect([...loadedAssetTypes].sort()).toEqual(["css", "js"]);
  expect(assetFailures).toEqual([]);
  expect(runtimeErrors).toEqual([]);
}

async function installCitizenTrackerMocks(page: Page) {
  const userId = "00000000-0000-4000-8000-000000000101";
  let status = "citizen_confirmation";
  let citizenAction: Record<string, unknown> | null = null;
  const headers = {
    "access-control-allow-origin": new URL(trackURL).origin,
    "access-control-allow-headers": "apikey,authorization,content-type,x-client-info,prefer,range",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "content-type": "application/json",
  };

  await page.route("**/rest/v1/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers });
      return;
    }

    if (pathname.endsWith("/rpc/track_complaint")) {
      await route.fulfill({
        status: 200,
        headers,
        body: JSON.stringify({
          tracking_no: "GC-TEST-001",
          status,
          urgency: "high",
          title: "Street light is out",
          description: "The street light has been out for several nights.",
          institution: "NAWEC",
          department: null,
          expected_response_at: null,
          resolved_at: status === "closed" ? "2026-10-20T12:00:00.000Z" : null,
          closed_at: status === "closed" ? "2026-10-20T13:00:00.000Z" : null,
          timeline: [],
        }),
      });
      return;
    }

    if (pathname.endsWith("/rpc/fn_can_confirm_report")) {
      await route.fulfill({ status: 200, headers, body: "true" });
      return;
    }
    if (pathname.endsWith("/rpc/fn_dashboard_access")) {
      await route.fulfill({ status: 200, headers, body: JSON.stringify({ ok: true, role: "citizen" }) });
      return;
    }
    if (pathname.endsWith("/rpc/confirm_complaint")) {
      citizenAction = request.postDataJSON() as Record<string, unknown>;
      status = "closed";
      await route.fulfill({ status: 200, headers, body: "true" });
      return;
    }
    if (pathname.endsWith("/rpc/reopen_complaint")) {
      citizenAction = request.postDataJSON() as Record<string, unknown>;
      status = "reopened";
      await route.fulfill({ status: 200, headers, body: "true" });
      return;
    }
    if (pathname.endsWith("/profiles")) {
      await route.fulfill({
        status: 200,
        headers,
        body: JSON.stringify({
          user_id: userId,
          email: "citizen@example.invalid",
          role: "citizen",
          full_name: "Test Citizen",
          phone_verified: true,
          email_verified: true,
        }),
      });
      return;
    }

    await route.fulfill({ status: 404, headers, body: JSON.stringify({ message: "Unexpected test request" }) });
  });

  const session = {
    access_token: "test-access-token",
    refresh_token: "test-refresh-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: userId,
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
    for (const reference of ["example", "api", "ci-placeholder"]) {
      window.localStorage.setItem(`sb-${reference}-auth-token`, JSON.stringify(storedSession));
    }
  }, session);

  return { citizenAction: () => citizenAction };
}

for (const viewport of [
  { name: "desktop", width: 1280, height: 800 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test.describe(`${viewport.name} site pages`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("landing page renders with its assets", async ({ page }) => {
      await expectPageAndAssetsToRender(
        page,
        landingURL,
        "What can you report",
      );
    });

    test("shared citizen and staff sign-in renders with its assets", async ({ page }) => {
      await expectPageAndAssetsToRender(page, sharedLoginURL, "Welcome back");
      await expect(page.locator("#email")).toBeVisible();
      await expect(page.locator("#password")).toBeVisible();
    });
  });
}

test("dashboard login route redirects to the shared sign-in page", async ({ page }) => {
  await page.goto(dashboardLoginURL);
  await expect(page).toHaveURL(/\/app\/login\/?$/);
  if (productionBaseURL) {
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  }
});

test("citizen tracker shows six readable stages on mobile and labels the reported fix consistently", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/rest/v1/rpc/track_complaint", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        tracking_no: "GC-TEST-001",
        status: "citizen_confirmation",
        urgency: "high",
        title: "Street light is out",
        description: "The street light has been out for several nights.",
        institution: "NAWEC",
        department: null,
        expected_response_at: null,
        resolved_at: "2026-10-20T12:00:00.000Z",
        closed_at: null,
        timeline: [
          { status: "received", message: "Report received.", at: "2026-10-20T08:00:00.000Z" },
          { status: "assigned", message: "Report assigned to an officer.", at: "2026-10-20T09:00:00.000Z" },
          { status: "in_progress", message: "An officer has started work.", at: "2026-10-20T10:00:00.000Z" },
          { status: "citizen_confirmation", message: "Fix reported: the street light was replaced.", at: "2026-10-20T12:00:00.000Z" },
        ],
      }),
    });
  });

  await page.goto(`${trackURL}?ref=GC-TEST-001`);
  await expect(page.getByRole("heading", { name: "Street light is out" })).toBeVisible();

  const progress = page.getByRole("region", { name: "Report progress, six stages" });
  await expect(progress.locator("li")).toHaveCount(6);
  await expect(progress.getByText("Fix reported", { exact: true })).toBeVisible();
  await expect(progress.getByText("Closed", { exact: true })).toBeVisible();
  const columnCount = await progress.locator("ol").evaluate((list) =>
    getComputedStyle(list).gridTemplateColumns.split(" ").length,
  );
  expect(columnCount).toBe(1);
  await expect(progress).toContainText("Step 5 of 6");
});

test("the reporting citizen can confirm a fix and close the report", async ({ page }) => {
  const mocks = await installCitizenTrackerMocks(page);
  await page.goto(`${trackURL}?ref=GC-TEST-001`);

  const progress = page.getByRole("region", { name: "Report progress, six stages" });
  await page.getByRole("button", { name: "Confirm fix and close report" }).click();
  await expect(progress).toContainText("Step 6 of 6");
  await expect(progress.getByText("Closed", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your response is needed" })).toHaveCount(0);
  expect(mocks.citizenAction()).toMatchObject({ p_tracking_no: "GC-TEST-001", p_phone: null });
});

test("the reporting citizen can reopen a fix that did not solve the problem", async ({ page }) => {
  const mocks = await installCitizenTrackerMocks(page);
  await page.goto(`${trackURL}?ref=GC-TEST-001`);

  await page.getByLabel("If it is not fixed, explain what still needs attention").fill("The light is still out.");
  await page.getByRole("button", { name: "Reopen report" }).click();
  const progress = page.getByRole("region", { name: "Report progress, six stages" });
  await expect(progress).toContainText("Step 3 of 6");
  await expect(progress).toContainText("Reopened");
  expect(mocks.citizenAction()).toMatchObject({
    p_tracking_no: "GC-TEST-001",
    p_reason: "The light is still out.",
    p_phone: null,
  });
});
