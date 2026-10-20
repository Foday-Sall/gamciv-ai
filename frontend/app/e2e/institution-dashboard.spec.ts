import { expect, test, type Page } from "@playwright/test";

const productionBaseURL = process.env.BASE_URL;
const dashboardBaseURL = productionBaseURL
  ? new URL("/dashboard/", productionBaseURL).toString()
  : "http://127.0.0.1:4175/dashboard/";
const dashboardOrigin = new URL(dashboardBaseURL).origin;
const institutionId = "00000000-0000-4000-8000-000000000111";
const officerId = "00000000-0000-4000-8000-000000000222";

const stats = {
  institution: { id: institutionId, code: "NAWEC", name: "NAWEC" },
  total: 3,
  today: 1,
  open: 2,
  resolved_week: 1,
  overdue: 1,
  avg_resolution_hours: 18.5,
  by_status: [
    { status: "in_progress", count: 2 },
    { status: "closed", count: 1 },
  ],
  by_category: [
    { category: "Water Supply", count: 2 },
    { category: "Power", count: 1 },
  ],
  by_channel: [
    { channel: "whatsapp", count: 2 },
    { channel: "web", count: 1 },
  ],
  by_urgency: [
    { urgency: "normal", count: 2 },
    { urgency: "high", count: 1 },
  ],
  daily: [
    { date: "2026-10-18", received: 1, resolved: 0 },
    { date: "2026-10-19", received: 1, resolved: 1 },
  ],
};

const corsHeaders = {
  "access-control-allow-origin": dashboardOrigin,
  "access-control-allow-credentials": "true",
  "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "access-control-allow-headers": "apikey,authorization,content-type,x-client-info,prefer,accept,range",
  "access-control-max-age": "86400",
};

async function installOfficerMocks(page: Page, failDashboardData = false) {
  let complaintQueryWasInstitutionScoped = false;

  await page.route("**/rest/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (method === "OPTIONS") {
      await route.fulfill({ status: 204, headers: corsHeaders });
      return;
    }

    if (url.pathname.endsWith("/profiles")) {
      await route.fulfill({
        status: 200,
        headers: { ...corsHeaders, "content-type": "application/json" },
        body: JSON.stringify({ role: "officer" }),
      });
      return;
    }

    if (url.pathname.endsWith("/officers")) {
      await route.fulfill({
        status: 200,
        headers: { ...corsHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          institution_id: institutionId,
          is_active: true,
          institutions: { name: "NAWEC" },
        }),
      });
      return;
    }

    if (url.pathname.endsWith("/complaints")) {
      if (failDashboardData) {
        await route.abort("internetdisconnected");
        return;
      }
      complaintQueryWasInstitutionScoped =
        url.searchParams.get("institution_id") === `eq.${institutionId}`;
      await route.fulfill({
        status: 200,
        headers: { ...corsHeaders, "content-type": "application/json" },
        body: JSON.stringify([
          {
            id: "00000000-0000-4000-8000-000000000333",
            institution_id: institutionId,
            tracking_no: "GC-NAWEC-001",
            title: "Low water pressure",
            status: "in_progress",
            urgency: "normal",
            created_at: "2026-10-19T10:00:00.000Z",
            updated_at: "2026-10-19T11:00:00.000Z",
          },
        ]),
      });
      return;
    }

    if (url.pathname.endsWith("/rpc/fn_institution_dashboard_stats")) {
      if (failDashboardData) {
        await route.abort("internetdisconnected");
        return;
      }
      await route.fulfill({
        status: 200,
        headers: { ...corsHeaders, "content-type": "application/json" },
        body: JSON.stringify(stats),
      });
      return;
    }

    await route.fulfill({
      status: 404,
      headers: { ...corsHeaders, "content-type": "application/json" },
      body: JSON.stringify({ message: "Unexpected test request" }),
    });
  });

  await page.routeWebSocket(/\/realtime\/v1\/websocket/, (socket) => {
    socket.close();
  });

  const projectRefs = productionBaseURL ? ["api"] : ["ci-placeholder", "api"];
  const fakeSession = {
    access_token: "test-access-token",
    refresh_token: "test-refresh-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: officerId,
      aud: "authenticated",
      role: "authenticated",
      email: "officer@example.invalid",
      app_metadata: { provider: "email", providers: ["email"] },
      user_metadata: {},
      identities: [],
      created_at: "2026-01-01T00:00:00.000Z",
    },
  };

  await page.addInitScript(
    ({ storageKeys, session }) => {
      for (const storageKey of storageKeys) {
        window.localStorage.setItem(storageKey, JSON.stringify(session));
      }
    },
    { storageKeys: projectRefs.map((projectRef) => `sb-${projectRef}-auth-token`), session: fakeSession },
  );

  return {
    complaintQueryWasInstitutionScoped: () => complaintQueryWasInstitutionScoped,
  };
}

test("signed-out visitors cannot open the institution dashboard", async ({ page }) => {
  await page.goto(new URL("/dashboard/institute", dashboardOrigin).toString());
  await expect(page).toHaveURL(/\/dashboard\/login\/?$/);
  await expect(page.getByRole("heading", { name: "GamCiv Dashboard" })).toBeVisible();
});

test("officers see only their institution and are redirected away from admin secrets", async ({ page }) => {
  const mocks = await installOfficerMocks(page);
  await page.goto(new URL("/dashboard/settings", dashboardOrigin).toString());

  await expect(page).toHaveURL(/\/dashboard\/institute\/?$/);
  await expect(page.getByRole("heading", { name: "Complaint overview" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Dashboard sections" })).toBeVisible();
  await expect(page.getByText("Complaint trend", { exact: true })).toBeVisible();
  await expect(page.getByText("Case status", { exact: true })).toBeVisible();
  await expect(page.getByText("Complaints by category", { exact: true })).toBeVisible();
  await expect(page.getByText("Intake channels", { exact: true })).toBeVisible();
  await expect(page.locator(".recharts-sector")).toHaveCount(4);
  await expect.poll(() => page.locator(".recharts-sector").evaluateAll((paths) =>
    paths.filter((path) => (path as SVGPathElement).getBBox().width > 0).length,
  )).toBe(4);
  await expect(page.getByText("Low water pressure", { exact: true })).toBeVisible();
  await expect(page.getByText("API keys and secrets", { exact: true })).toHaveCount(0);
  await expect(page.getByText("TELEGRAM_BOT_TOKEN", { exact: true })).toHaveCount(0);
  expect(mocks.complaintQueryWasInstitutionScoped()).toBe(true);
  const timeRange = page.getByRole("group", { name: "Trend time range" });
  await timeRange.getByRole("button", { name: "7 days" }).click();
  await expect(timeRange.getByRole("button", { name: "7 days" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("group", { name: "Complaint trend for the last 7 days" })).toBeVisible();
  await page.getByRole("button", { name: "Hide resolved reports" }).click();
  await expect(page.getByRole("button", { name: "Show resolved reports" })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("navigation", { name: "Dashboard sections" }).getByRole("button", { name: /Complaints/ }).click();
  await expect(page.getByRole("heading", { name: "Recent complaints" })).toBeInViewport();
  if (process.env.GAMCIV_DASHBOARD_SCREENSHOT === "1") {
    await page.screenshot({ path: "/tmp/gamciv-institution-dashboard.png", fullPage: true });
  }
});

test("a lost connection produces a clear retry message instead of an unhandled error", async ({ page }) => {
  test.setTimeout(20_000);
  await installOfficerMocks(page, true);
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  await page.goto(new URL("/dashboard/institute", dashboardOrigin).toString());

  const connectionAlert = page.getByRole("alert");
  await expect(connectionAlert).toContainText(/connection/i, { timeout: 12_000 });
  await expect(connectionAlert.getByRole("button", { name: "Retry" })).toBeVisible();
  expect(runtimeErrors).toEqual([]);
});

test("the institution dashboard remains usable at a mobile width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installOfficerMocks(page);
  await page.goto(new URL("/dashboard/institute", dashboardOrigin).toString());

  await expect(page.getByRole("heading", { name: "Complaint overview" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Dashboard sections" })).toBeVisible();
  await expect(page.getByText("Complaint trend", { exact: true })).toBeVisible();
  await expect(page.getByText("Recent complaints", { exact: true })).toBeVisible();
  const timeRange = page.getByRole("group", { name: "Trend time range" });
  await expect(timeRange.getByRole("button", { name: "7 days" })).toBeVisible();
  await timeRange.getByRole("button", { name: "7 days" }).click();
  await expect(timeRange.getByRole("button", { name: "7 days" })).toHaveAttribute("aria-pressed", "true");
  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
  if (process.env.GAMCIV_DASHBOARD_SCREENSHOT === "1") {
    await page.screenshot({ path: "/tmp/gamciv-institution-dashboard-mobile.png", fullPage: true });
  }
});
