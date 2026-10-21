import { expect, test, type Page } from "@playwright/test";

const productionBaseURL = process.env.BASE_URL;
const dashboardBaseURL = productionBaseURL
  ? new URL("/dash/", productionBaseURL).toString()
  : "http://127.0.0.1:4175/dash/";
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

async function installOfficerMocks(
  page: Page,
  failDashboardData = false,
  initialStatus = "in_progress",
  delayedCitizenPhoto = false,
) {
  let complaintQueryWasInstitutionScoped = false;
  let detailCalls = 0;
  let complaintStatus = initialStatus;
  let resolutionPhotoPath: string | null = null;
  let resolutionNote: string | null = null;
  let resolutionPhotoParamWasNull = false;
  let resolutionPhotoUploadAttempted = false;
  let reopenedReportWasRestarted = false;

  await page.route("**/rest/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (method === "OPTIONS") {
      await route.fulfill({ status: 204, headers: corsHeaders });
      return;
    }

    if (url.pathname.endsWith("/rpc/fn_dashboard_access")) {
      await route.fulfill({
        status: 200,
        headers: { ...corsHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          ok: true,
          role: "officer",
          institution: { id: institutionId, code: "NAWEC", name: "NAWEC", logo_url: null },
        }),
      });
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
            status: complaintStatus,
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

    if (url.pathname.endsWith("/rpc/fn_institution_map_complaints")) {
      await route.fulfill({
        status: 200,
        headers: { ...corsHeaders, "content-type": "application/json" },
        body: JSON.stringify({ ok: true, complaints: [], total: 0, scope: "institution" }),
      });
      return;
    }

    if (url.pathname.endsWith("/rpc/fn_officer_accept")) {
      complaintStatus = "assigned";
      await route.fulfill({
        status: 200,
        headers: { ...corsHeaders, "content-type": "application/json" },
        body: "true",
      });
      return;
    }

    if (url.pathname.endsWith("/rpc/fn_officer_set_status")) {
      const body = request.postDataJSON() as { p_status?: string };
      if (body.p_status === "in_progress" && ["assigned", "waiting_info", "reopened"].includes(complaintStatus)) {
        if (complaintStatus === "reopened") reopenedReportWasRestarted = true;
        complaintStatus = "in_progress";
      }
      await route.fulfill({
        status: 200,
        headers: { ...corsHeaders, "content-type": "application/json" },
        body: JSON.stringify(complaintStatus === "in_progress"),
      });
      return;
    }

    if (url.pathname.endsWith("/rpc/fn_officer_report_resolution")) {
      const body = request.postDataJSON() as { p_citizen_message?: string; p_resolution_photo_url?: string | null };
      complaintStatus = "citizen_confirmation";
      resolutionNote = body.p_citizen_message ?? null;
      resolutionPhotoParamWasNull = body.p_resolution_photo_url === null;
      resolutionPhotoPath = body.p_resolution_photo_url ?? null;
      await route.fulfill({
        status: 200,
        headers: { ...corsHeaders, "content-type": "application/json" },
        body: "true",
      });
      return;
    }

    if (url.pathname.endsWith("/rpc/fn_officer_complaint_detail")) {
      detailCalls += 1;
      const photoPath = delayedCitizenPhoto && detailCalls > 1
        ? "00000000-0000-4000-8000-000000000333/photo.png"
        : null;
      await route.fulfill({
        status: 200,
        headers: { ...corsHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          ok: true,
          complaint: {
            id: "00000000-0000-4000-8000-000000000333",
            tracking_no: "GC-NAWEC-001",
            title: "Low water pressure",
            description: "Water pressure is low across the neighbourhood.",
            status: complaintStatus,
            urgency: "normal",
            category: "Water supply",
            lat: 13.45,
            lng: -16.67,
            region: "Kanifing",
            council_area: "Kanifing Municipal Council",
            ward: "Kanifing",
            created_at: delayedCitizenPhoto
              ? new Date(Date.now() - 30_000).toISOString()
              : "2026-10-19T10:00:00.000Z",
            updated_at: "2026-10-19T11:00:00.000Z",
            is_anonymous: !delayedCitizenPhoto,
            photo_url: photoPath,
            resolution_photo_url: resolutionPhotoPath,
            resolution_note: resolutionNote,
            contact: null,
          },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 404,
      headers: { ...corsHeaders, "content-type": "application/json" },
      body: JSON.stringify({ message: "Unexpected test request" }),
    });
  });

  await page.route("**/storage/v1/object/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const signMarker = "/object/sign/complaint-photos/";
    const objectMarker = "/object/complaint-photos/";

    if (url.pathname.includes(signMarker)) {
      const objectPath = decodeURIComponent(url.pathname.slice(url.pathname.indexOf(signMarker) + signMarker.length));
      await route.fulfill({
        status: 200,
        headers: { ...corsHeaders, "content-type": "application/json" },
        body: JSON.stringify({ signedURL: `/storage/v1/object/sign/complaint-photos/${objectPath}?token=test-token` }),
      });
      return;
    }

    if (method === "POST" && url.pathname.includes(objectMarker)) {
      resolutionPhotoUploadAttempted = true;
      const objectPath = decodeURIComponent(url.pathname.slice(url.pathname.indexOf(objectMarker) + objectMarker.length));
      resolutionPhotoPath = objectPath;
      await route.fulfill({
        status: 200,
        headers: { ...corsHeaders, "content-type": "application/json" },
        body: JSON.stringify({ Key: objectPath }),
      });
      return;
    }

    await route.fulfill({ status: 200, headers: corsHeaders, body: "" });
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
    detailCalls: () => detailCalls,
    resolutionPhotoParamWasNull: () => resolutionPhotoParamWasNull,
    resolutionPhotoUploadAttempted: () => resolutionPhotoUploadAttempted,
    reopenedReportWasRestarted: () => reopenedReportWasRestarted,
  };
}

test("signed-out visitors cannot open the institution dashboard", async ({ page }) => {
  await page.goto(new URL("/dash/", dashboardOrigin).toString());
  await expect(page).toHaveURL(/\/app\/login\/?$/);
  if (productionBaseURL) {
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  }
});

test("officers see only their institution and are redirected away from admin secrets", async ({ page }) => {
  const mocks = await installOfficerMocks(page);
  await page.goto(new URL("/dash/settings", dashboardOrigin).toString());

  await expect(page).toHaveURL(/\/dash\/?$/);
  await expect(page.getByRole("heading", { name: "NAWEC operations overview" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Officer navigation" })).toBeVisible();
  await expect(page.locator("#overview")).toBeVisible();
  await expect(page.locator("#complaints")).toHaveCount(0);
  const sidebar = page.getByRole("complementary", { name: "Officer workspace sidebar" });
  await sidebar.getByRole("navigation").getByRole("button", { name: "Complaint map" }).click();
  await expect(page.getByRole("heading", { name: "NAWEC report map" })).toBeVisible();
  await expect(page.locator("#map")).toBeVisible();
  await expect(page.locator("#overview")).toHaveCount(0);
  await expect(page.locator("#complaints")).toHaveCount(0);
  await sidebar.getByRole("navigation").getByRole("button", { name: "Complaint queue" }).click();
  await expect(page.getByRole("heading", { name: "NAWEC complaint queue" })).toBeVisible();
  await expect(page.locator("#complaints")).toBeVisible();
  await expect(page.locator("#complaints").getByText("Low water pressure", { exact: true })).toBeVisible();
  const queueRow = page.locator("#complaints tbody tr").filter({ hasText: "GC-NAWEC-001" });
  await queueRow.locator("td").nth(1).click();
  const details = page.getByRole("dialog", { name: "Report details" });
  await expect(details).toBeVisible();
  await expect(details.getByRole("heading", { name: "Low water pressure" })).toBeVisible();
  await expect(details).toContainText("GC-NAWEC-001");
  await details.getByRole("button", { name: "Close details" }).click();
  await expect(details).toHaveCount(0);
  await expect(page.getByText("API keys and secrets", { exact: true })).toHaveCount(0);
  await expect(page.getByText("TELEGRAM_BOT_TOKEN", { exact: true })).toHaveCount(0);
  expect(mocks.complaintQueryWasInstitutionScoped()).toBe(true);
  await sidebar.getByRole("navigation").getByRole("button", { name: "Service trends" }).click();
  await expect(page.getByRole("heading", { name: "NAWEC service trends" })).toBeVisible();
  const timeRange = page.getByRole("group", { name: "Trend time range" });
  await timeRange.getByRole("button", { name: "7 days" }).click();
  await expect(timeRange.getByRole("button", { name: "7 days" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("group", { name: "Complaint trend for the last 7 days" })).toBeVisible();
  await page.getByRole("button", { name: "Hide resolved reports" }).click();
  await expect(page.getByRole("button", { name: "Show resolved reports" })).toHaveAttribute("aria-pressed", "false");
  await expect(sidebar).toBeVisible();
  if (process.env.GAMCIV_DASHBOARD_SCREENSHOT === "1") {
    await page.screenshot({ path: "/tmp/gamciv-officer-sidebar-expanded.png" });
  }
  await sidebar.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(sidebar.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
  await sidebar.getByRole("navigation", { name: "Officer navigation" }).getByRole("button", { name: "Complaint queue" }).click();
  await expect(page.getByRole("heading", { name: "NAWEC complaint queue" })).toBeVisible();
  await expect(sidebar.getByRole("navigation").getByRole("button", { name: "Complaint queue" })).toHaveAttribute("aria-current", "location");
  if (process.env.GAMCIV_DASHBOARD_SCREENSHOT === "1") {
    await page.screenshot({ path: "/tmp/gamciv-institution-dashboard.png", fullPage: true });
  }
});

test("report details pick up a citizen photo attached after the dialog first opens", async ({ page }) => {
  const mocks = await installOfficerMocks(page, false, "in_progress", true);
  await page.goto(new URL("/dash/", dashboardOrigin).toString());
  await page.getByRole("navigation", { name: "Officer navigation" }).getByRole("button", { name: "Complaint queue" }).click();

  const queueRow = page.locator("#complaints tbody tr").filter({ hasText: "GC-NAWEC-001" });
  await queueRow.locator("td").nth(1).click();
  const details = page.getByRole("dialog", { name: "Report details" });
  await expect(details.getByText("Checking for a recently uploaded photo...")).toBeVisible();
  const photo = details.getByRole("img", { name: "Photo submitted with report GC-NAWEC-001" });
  await expect(photo).toBeVisible({ timeout: 10_000 });
  await expect(photo).toHaveAttribute("src", /complaint-photos/);
  expect(mocks.detailCalls()).toBeGreaterThanOrEqual(2);
});

test("officers can accept a report, start work, and report a fix without uploading a photo", async ({ page }) => {
  const mocks = await installOfficerMocks(page, false, "received");
  await page.goto(new URL("/dash/", dashboardOrigin).toString());
  await page.getByRole("navigation", { name: "Officer navigation" }).getByRole("button", { name: "Complaint queue" }).click();

  const queueRow = page.locator("#complaints tbody tr").filter({ hasText: "GC-NAWEC-001" });
  await queueRow.locator("td").nth(1).click();
  const details = page.getByRole("dialog", { name: "Report details" });
  await expect(details.getByRole("button", { name: "Accept report" })).toBeVisible();
  await expect(details.getByLabel("Resolution photo (optional)")).toHaveCount(0);

  await details.getByRole("button", { name: "Accept report" }).click();
  await expect(details.getByRole("button", { name: "Mark in progress" })).toBeVisible();
  await expect(details.getByLabel("Resolution photo (optional)")).toHaveCount(0);
  await expect(details.getByRole("button", { name: "Send fix for confirmation" })).toHaveCount(0);

  await details.getByRole("button", { name: "Mark in progress" }).click();
  await expect(details.getByText("In Progress", { exact: true })).toBeVisible();
  await expect(details.getByRole("button", { name: "Send fix for confirmation" })).toBeVisible();
  await details.getByLabel("Resolution note").fill("Power restored and service checked.");
  await details.getByRole("button", { name: "Send fix for confirmation" }).click();

  await expect(details.getByText("Fix reported", { exact: true })).toBeVisible();
  await expect(details.getByText("No resolution photo has been added.", { exact: true })).toBeVisible();
  expect(mocks.resolutionPhotoParamWasNull()).toBe(true);
  expect(mocks.resolutionPhotoUploadAttempted()).toBe(false);
});

test("officers can restart work after a citizen reopens a report", async ({ page }) => {
  const mocks = await installOfficerMocks(page, false, "reopened");
  await page.goto(new URL("/dash/", dashboardOrigin).toString());
  await page.getByRole("navigation", { name: "Officer navigation" }).getByRole("button", { name: "Complaint queue" }).click();

  const queueRow = page.locator("#complaints tbody tr").filter({ hasText: "GC-NAWEC-001" });
  await queueRow.locator("td").nth(1).click();
  const details = page.getByRole("dialog", { name: "Report details" });
  await expect(details.getByRole("button", { name: "Mark in progress" })).toBeVisible();
  await expect(details.getByRole("button", { name: "Accept report" })).toHaveCount(0);
  await details.getByRole("button", { name: "Mark in progress" }).click();

  await expect(details.getByText("In Progress", { exact: true })).toBeVisible();
  expect(mocks.reopenedReportWasRestarted()).toBe(true);
});

test("a lost connection produces a clear retry message instead of an unhandled error", async ({ page }) => {
  test.setTimeout(20_000);
  await installOfficerMocks(page, true);
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  await page.goto(new URL("/dash/", dashboardOrigin).toString());

  const connectionAlert = page.getByRole("alert").filter({ hasText: /connection/i });
  await expect(connectionAlert).toContainText(/connection/i, { timeout: 12_000 });
  await expect(connectionAlert.getByRole("button", { name: "Retry" })).toBeVisible();
  expect(runtimeErrors).toEqual([]);
});

test("the institution dashboard remains usable at a mobile width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installOfficerMocks(page);
  await page.goto(new URL("/dash/", dashboardOrigin).toString());

  await expect(page.getByRole("heading", { name: "NAWEC operations overview" })).toBeVisible();
  const menuButton = page.getByRole("button", { name: "Open navigation" });
  await expect(menuButton).toBeVisible();
  await menuButton.click();
  const drawer = page.getByRole("dialog", { name: "Officer navigation" });
  await expect(drawer).toBeVisible();
  if (process.env.GAMCIV_DASHBOARD_SCREENSHOT === "1") {
    await page.waitForTimeout(250);
    await page.screenshot({ path: "/tmp/gamciv-officer-drawer-mobile.png" });
  }
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await menuButton.click();
  await expect(drawer).toBeVisible();
  const mobileNav = drawer.getByRole("navigation", { name: "Officer navigation" });
  await expect(mobileNav.getByRole("button", { name: "Dashboard" })).toBeVisible();
  await mobileNav.getByRole("button", { name: "Service trends" }).click();
  await expect(drawer).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "NAWEC service trends" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Complaint trend for the last 14 days" })).toBeVisible();
  await expect(page.locator("#complaints")).toHaveCount(0);
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
