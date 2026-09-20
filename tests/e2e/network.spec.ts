import { test, expect, gotoApp } from "../fixtures";

/**
 * Network interception.
 *
 * The app shows a "tip of the day" from a third-party service. Left alone, that makes
 * the suite depend on someone else's uptime and rate limits - the most common source of
 * "the tests are red again and nobody changed anything". Intercepting it makes the test
 * deterministic and, more usefully, lets us assert the failure paths that are almost
 * impossible to trigger against the real service.
 */

test("renders the tip returned by the upstream service", async ({ authedPage }) => {
  await authedPage.route("**/api/tip", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ tip: "Write the test before the fix.", source: "external" }),
    });
  });

  await gotoApp(authedPage);

  await expect(authedPage.getByTestId("tip")).toHaveText("Write the test before the fix.");
  await expect(authedPage.getByTestId("tip-source")).toHaveText("external");
});

test("degrades gracefully when the upstream service is unavailable", async ({ authedPage }) => {
  await authedPage.route("**/api/tip", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ tip: null, source: "unavailable" }),
    });
  });

  await gotoApp(authedPage);

  await expect(authedPage.getByTestId("tip")).toHaveText("No tip available");
  // The rest of the app must still work when the third party is down.
  await authedPage.getByTestId("todo-input").fill("still usable");
  await authedPage.getByTestId("todo-add").click();
  await expect(authedPage.getByTestId("todo-item")).toHaveCount(1);
});

test("survives the tip request failing outright", async ({ authedPage }) => {
  await authedPage.route("**/api/tip", (route) => route.abort("failed"));

  await gotoApp(authedPage);

  await expect(authedPage.getByTestId("tip")).toHaveText("No tip available");
  await expect(authedPage.getByTestId("app-view")).toBeVisible();
});

test("shows the server error when the todo API rejects the request", async ({ authedPage }) => {
  await gotoApp(authedPage);

  // Simulating a 500 is the only practical way to cover this branch: the real server
  // has no input that produces one.
  await authedPage.route("**/api/todos", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "database unavailable" }),
    });
  });

  await authedPage.getByTestId("todo-input").fill("will fail");
  await authedPage.getByTestId("todo-add").click();

  await expect(authedPage.getByTestId("todo-error")).toHaveText("database unavailable");
});
