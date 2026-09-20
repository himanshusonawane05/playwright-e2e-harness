import { test, expect, gotoApp } from "../fixtures";

/**
 * The login flow itself, exercised through the UI. Everything else in the suite skips
 * the form via storageState or the API, so this file is what keeps that shortcut honest.
 */

// Opt out of the saved session: these tests need to meet a signed-out browser.
test.use({ storageState: { cookies: [], origins: [] } });

test("signed-out visitor sees the auth view, not the app", async ({ page }) => {
  await gotoApp(page);
  await expect(page.getByTestId("auth-view")).toBeVisible();
  await expect(page.getByTestId("app-view")).toBeHidden();
});

test("rejects bad credentials without revealing whether the account exists", async ({ page, user }) => {
  await gotoApp(page);
  await page.getByTestId("auth-email").fill(user.email);
  await page.getByTestId("auth-password").fill("definitely-not-the-password");
  await page.getByTestId("auth-submit").click();

  await expect(page.getByTestId("auth-error")).toHaveText("invalid credentials");
  await expect(page.getByTestId("app-view")).toBeHidden();
});

test("registers, signs in and lands in an empty app", async ({ page, user }) => {
  await gotoApp(page);
  await page.getByTestId("auth-toggle").click();
  await expect(page.getByTestId("auth-mode-label")).toHaveText("Create account");

  await page.getByTestId("auth-email").fill(user.email);
  await page.getByTestId("auth-password").fill(user.password);
  await page.getByTestId("auth-submit").click();

  await expect(page.getByTestId("app-view")).toBeVisible();
  await expect(page.getByTestId("current-user")).toHaveText(user.email);
  await expect(page.getByTestId("empty-state")).toHaveText("No tasks yet");
});

test("rejects a password under the minimum length", async ({ page, user }) => {
  await gotoApp(page);
  await page.getByTestId("auth-toggle").click();
  await page.getByTestId("auth-email").fill(user.email);
  await page.getByTestId("auth-password").fill("short");
  await page.getByTestId("auth-submit").click();

  await expect(page.getByTestId("auth-error")).toHaveText("password must be at least 8 characters");
});

test("logging out returns to the auth view and drops the session", async ({ page, user }) => {
  await gotoApp(page);
  await page.getByTestId("auth-toggle").click();
  await page.getByTestId("auth-email").fill(user.email);
  await page.getByTestId("auth-password").fill(user.password);
  await page.getByTestId("auth-submit").click();
  await expect(page.getByTestId("app-view")).toBeVisible();

  await page.getByTestId("logout").click();
  await expect(page.getByTestId("auth-view")).toBeVisible();

  // A reload must not resurrect the session - the cookie is genuinely gone.
  await gotoApp(page);
  await expect(page.getByTestId("auth-view")).toBeVisible();
});
