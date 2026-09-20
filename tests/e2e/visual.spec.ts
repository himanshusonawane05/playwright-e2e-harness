import { test, expect, gotoApp } from "../fixtures";

/**
 * Visual regression.
 *
 * Screenshots catch what assertions never do - a stylesheet that failed to load, a button
 * pushed off-screen, a layout that collapses at mobile width. They also produce the most
 * false positives of any technique, so the rules here are deliberate:
 *
 *   - Screenshot a COMPONENT, not the whole page, wherever the assertion allows it. A
 *     full-page baseline breaks every time any unrelated copy changes.
 *   - Mask anything that legitimately varies (dates, ids, the tip from a third party).
 *   - Seed fixed data so the pixels are a function of the code, not of what ran before.
 *
 * Thresholds live in playwright.config.ts: 1% of pixels may differ, which absorbs
 * font-rendering noise between machines but not a real layout change.
 *
 * Baselines are per-project (browser), and are committed. To update them deliberately:
 *   npx playwright test visual --update-snapshots
 * Review the diff images before committing - an updated baseline is how a real bug gets
 * blessed into the repo forever.
 */

/**
 * These run on the chromium project only - see `testIgnore` on the other projects in
 * playwright.config.ts. One canonical browser keeps the baseline set reviewable; four
 * would multiply every approval by four, and cross-browser behaviour is already covered
 * by the functional specs that do run everywhere.
 */
test.describe("visual", () => {

  test("empty state", async ({ authedPage }) => {
    // The third-party tip is stubbed: its content must never decide whether the suite is
    // green, and an empty tip box keeps the shot stable.
    await authedPage.route("**/api/tip", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ tip: "Fixed tip for visual tests", source: "external" }),
      }),
    );

    await gotoApp(authedPage);
    await expect(authedPage.getByTestId("empty-state")).toBeVisible();

    await expect(authedPage.getByTestId("app-view")).toHaveScreenshot("app-empty.png", {
      // The signed-in email is random per test, so it can never match a baseline.
      mask: [authedPage.getByTestId("current-user")],
    });
  });

  test("populated list with a completed item", async ({ api, authedPage }) => {
    await authedPage.route("**/api/tip", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ tip: "Fixed tip for visual tests", source: "external" }),
      }),
    );

    const seeded = await api.seed(["review the contract", "renew the domain", "pay invoice 4102"]);
    await api.setDone(seeded[0]!.id, true);

    await gotoApp(authedPage);
    await expect(authedPage.getByTestId("todo-item")).toHaveCount(3);

    await expect(authedPage.getByTestId("todo-list")).toHaveScreenshot("todo-list.png");
  });

  test("validation error state", async ({ authedPage }) => {
    await gotoApp(authedPage);
    await authedPage.getByTestId("todo-input").fill("x".repeat(201));
    await authedPage.getByTestId("todo-add").click();
    await expect(authedPage.getByTestId("todo-error")).toBeVisible();

    await expect(authedPage.getByTestId("todo-error")).toHaveScreenshot("todo-error.png");
  });
});
