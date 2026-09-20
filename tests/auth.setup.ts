import { test as setup, expect } from "@playwright/test";

/**
 * Logs in once for the whole run and saves the browser state to disk. Every browser
 * project then starts already authenticated, so no test spends 1-2 seconds replaying
 * a login form. On a 40-test suite that alone is most of the runtime.
 *
 * This shared account is for tests that only read or navigate. Anything that mutates
 * data uses the per-test `user` fixture instead, so parallel tests cannot collide.
 */
const AUTH_FILE = "playwright/.auth/user.json";

setup("authenticate the shared demo user", async ({ page, request, baseURL }) => {
  const email = process.env.E2E_USER ?? "demo@example.test";
  const password = process.env.E2E_PASSWORD ?? "correct-horse-battery";

  // 409 means a previous run already created it: the server keeps state in memory for
  // its lifetime, and re-running setup against a live server must stay idempotent.
  const register = await request.post(`${baseURL}/api/register`, { data: { email, password } });
  expect([201, 409]).toContain(register.status());

  // Deliberately through the UI: this is the one place the real login flow runs, so the
  // saved state is produced exactly the way a user produces it.
  await page.goto("/");
  await page.getByTestId("auth-email").fill(email);
  await page.getByTestId("auth-password").fill(password);
  await page.getByTestId("auth-submit").click();

  await expect(page.getByTestId("app-view")).toBeVisible();
  await expect(page.getByTestId("current-user")).toHaveText(email);

  await page.context().storageState({ path: AUTH_FILE });
});
