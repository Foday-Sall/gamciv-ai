import { expect, test, type Page } from "@playwright/test";

const productionBaseURL = process.env.BASE_URL;
const landingURL = productionBaseURL
  ? new URL("/", productionBaseURL).toString()
  : "http://127.0.0.1:4174/";
const dashboardURL = productionBaseURL
  ? new URL("/dashboard/", productionBaseURL).toString()
  : "http://127.0.0.1:4175/dashboard/";

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

    test("dashboard login renders with its assets", async ({ page }) => {
      await expectPageAndAssetsToRender(page, dashboardURL, "GamCiv Dashboard");
      await expect(page.locator("#otp-email")).toBeVisible();
    });
  });
}
