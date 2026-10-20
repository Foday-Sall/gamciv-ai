import { defineConfig } from "@playwright/test";

const productionBaseURL = process.env.BASE_URL;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: productionBaseURL ?? "http://127.0.0.1:4173",
    browserName: "chromium",
    headless: true,
    trace: "retain-on-failure",
  },
  ...(productionBaseURL
    ? {}
    : {
        webServer: [
          {
            command: "npm run preview -- --host 127.0.0.1 --port 4173 --strictPort",
            url: "http://127.0.0.1:4173/app/",
            reuseExistingServer: !process.env.CI,
            timeout: 30_000,
          },
          {
            command: "npm run preview -- --host 127.0.0.1 --port 4174 --strictPort",
            cwd: "../landing",
            url: "http://127.0.0.1:4174/",
            reuseExistingServer: !process.env.CI,
            timeout: 30_000,
          },
          {
            command: "npm run preview -- --host 127.0.0.1 --port 4175 --strictPort",
            cwd: "../dashboard/admin",
            url: "http://127.0.0.1:4175/dashboard/",
            reuseExistingServer: !process.env.CI,
            timeout: 30_000,
          },
        ],
      }),
});
