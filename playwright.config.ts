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
  /* Measured on an idle 6-core/12-thread box: 3, 6 and 12 workers are all green, at 4.1s,
     4.0s and 4.6s. Parallelism stops paying past the core count for a suite this size, so
     the default is left to Playwright (50% of logical CPUs). What actually breaks runs is
     competing CPU load, not worker count - see the README. */
  workers: CI ? "50%" : undefined,
  /* Fail the CI build if someone commits test.only. */
  forbidOnly: CI,
  timeout: 30_000,
  expect: {
    timeout: 5_000,
    toHaveScreenshot: {
      /* Anti-aliasing and font hinting differ between machines, so a zero-tolerance
         comparison fails on noise. 0.2 is the per-pixel colour tolerance; the ratio cap
         is what actually decides - 1% of pixels may differ, which catches a moved button
         or a broken layout while ignoring sub-pixel text rendering. */
      threshold: 0.2,
      maxDiffPixelRatio: 0.01,
      /* CSS animations mid-flight are the classic screenshot flake. */
      animations: "disabled",
      caret: "hide",
    },
  },

  /* Quarantined tests are known-flaky and must not block a merge. They still run, in a
     separate non-blocking job, so they cannot rot unnoticed. See docs/quarantine.md. */
  grepInvert: process.env.RUN_QUARANTINED === "1" ? undefined : /@quarantine/,
  grep: process.env.RUN_QUARANTINED === "1" ? /@quarantine/ : undefined,

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
    /* "retain-on-failure" records video for EVERY test and discards it on pass, which
       costs a measured ~7% on an idle 6-core machine (4.0s -> 4.3s at 6 workers). Worth
       it: the video of the FIRST failure is often what explains it. Note the cost is not
       constant - on a CPU-starved machine the same setting amplifies contention badly,
       so "on-first-retry" is the right switch for constrained CI runners. */
    video: "retain-on-failure",
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
      /* Visual specs are chromium-only; maintaining four baseline sets is not worth it. */
      testIgnore: /visual\.spec\.ts/,
      name: "firefox",
      use: { ...devices["Desktop Firefox"], storageState: "playwright/.auth/user.json" },
      dependencies: ["setup"],
    },
    {
      testIgnore: /visual\.spec\.ts/,
      name: "webkit",
      use: { ...devices["Desktop Safari"], storageState: "playwright/.auth/user.json" },
      dependencies: ["setup"],
    },
    {
      testIgnore: /visual\.spec\.ts/,
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


