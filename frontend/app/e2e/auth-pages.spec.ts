import { expect, test, type Page } from "@playwright/test";

async function expectAuthPageToRender(
  page: Page,
  route: string,
  heading: string,
  labels: string[],
  submitButton: string,
) {
  const runtimeErrors: string[] = [];
  const assetFailures: string[] = [];
  const loadedAssetTypes = new Set<string>();

  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("response", (response) => {
    const pathname = new URL(response.url()).pathname;
    if (!pathname.startsWith("/app/assets/")) return;
    if (/\.(js|css)$/.test(pathname)) {
      if (response.status() >= 400) {
        assetFailures.push(`${response.status()} ${pathname}`);
      } else {
        loadedAssetTypes.add(pathname.endsWith(".js") ? "js" : "css");
      }
    }
  });

  await page.goto(route, { waitUntil: "load" });
  await expect(page.getByRole("heading", { name: heading, exact: true }))
    .toBeVisible();
  for (const label of labels) {
    const field = label === "Password"
      ? page.locator("input#password")
      : page.getByLabel(label);
    await expect(field).toBeVisible();
  }
  await expect(page.getByRole("button", { name: submitButton, exact: true }))
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
  test.describe(`${viewport.name} auth screens`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("login page renders with its assets", async ({ page }) => {
      await expectAuthPageToRender(
        page,
        "/app/login",
        "Welcome back",
        ["Email", "Password"],
        "Sign in",
      );
    });

    test("signup page renders with its assets", async ({ page }) => {
      await expectAuthPageToRender(
        page,
        "/app/signup",
        "Create your GamCiv account",
        ["Full name", "Email", "Password"],
        "Sign up",
      );
    });
  });
}
