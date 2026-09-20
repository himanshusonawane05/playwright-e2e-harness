import { defineConfig, devices } from "@playwright/test";

/**
 * Ports are env-driven so CI, local runs and a developer's own dev server never collide.
 * 8090 rather than 8080 because 8080 is commonly taken (Apache/XAMPP on Windows).
 */
const PORT = Number(process.env.PORT ?? 8090);
const BASE_URL = process.env.APP_URL ?? `http://127.0.0.1:${PORT}`;
const CI = !!process.env.CI;

export default defineConfig({
  testDir: "./tests",
  /* Every file runs in parallel, not just files against each other. Tests are written
     to be independent (each creates its own user), so this is safe. */
  fullyParallel: true,
  /* A retry masks a real bug as easily as it hides a flake. One retry in CI only, to
     absorb genuine infrastructure noise; locally a failure must stay a failure so it
     gets fixed. Anything that needs more than this belongs in quarantine, not in a
     higher retry count. */
  retries: CI ? 1 : 0,
  /* Each worker drives a full browser, so the useful ceiling tracks physical cores, not
     threads. Measured on a 6-core/12-thread dev box with background apps running: 3
     workers is green in ~5s, while Playwright's default (50% of logical CPUs = 6) made
     page loads time out. CI runners are quieter and dedicated, so they get more. */
  workers: CI ? "50%" : "25%",
  /* Fail the CI build if someone commits test.only. */
  forbidOnly: CI,
  timeout: 30_000,
  expect: { timeout: 5_000 },

  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
    /* Machine-readable output drives the flake detector and PR annotations. */
    ["json", { outputFile: "test-results/results.json" }],
    ...(CI ? ([["github"]] as const) : []),
  ],

  use: {
    baseURL: BASE_URL,
    /* Artifacts on failure only. Capturing them for green runs costs minutes of upload
       time and gigabytes of storage for output nobody opens. Trace is kept on every
       failure because the first failure is the one you want to debug; measurement showed
       tracing costs far less than video. */
    trace: "retain-on-failure",
    /* Measured on a 6-core machine: "retain-on-failure" records video for EVERY test and
       throws it away when the test passes. That is an ffmpeg pipeline per context, and at
       4+ workers it starved the machine badly enough that page.goto timed out - i.e. the
       artifact settings were manufacturing the flakes. "on-first-retry" records only the
       run that actually needs diagnosing. */
    video: "on-first-retry",
    screenshot: "only-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },

  projects: [
    /* Logs in once and writes storageState, so no test pays for a UI login. */
    { name: "setup", testMatch: /auth\.setup\.ts/ },

    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "playwright/.auth/user.json" },
      dependencies: ["setup"],
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"], storageState: "playwright/.auth/user.json" },
      dependencies: ["setup"],
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"], storageState: "playwright/.auth/user.json" },
      dependencies: ["setup"],
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"], storageState: "playwright/.auth/user.json" },
      dependencies: ["setup"],
    },
  ],

  /* Playwright owns the app's lifecycle so `npx playwright test` is the only command a
     new contributor needs. Locally an already-running server is reused; CI always
     starts a clean one. */
  webServer: {
    command: "node app/server.js",
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: !CI,
    timeout: 30_000,
    env: {
      PORT: String(PORT),
      /* Point the third-party dependency at a closed local port so it fails instantly
         instead of doing real DNS. Tests that care about tip content intercept the
         request in the browser; none of them should touch the internet. */
      TIP_URL: process.env.TIP_URL ?? "http://127.0.0.1:9/tip",
    },
    stdout: "pipe",
    stderr: "pipe",
  },
});
