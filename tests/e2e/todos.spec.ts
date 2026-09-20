import { test, expect, gotoApp } from "../fixtures";

/**
 * API-seeded, UI-asserted.
 *
 * Setting up state through the API and asserting through the UI is the pattern most
 * client suites are missing. It removes the slowest and flakiest part of a test - the
 * clicking needed to reach an interesting state - while still testing what the user
 * actually sees. Each test seeds through its own user, so they stay independent.
 */

test("renders seeded todos in server order", async ({ api, authedPage }) => {
  await api.seed(["buy milk", "renew passport", "book dentist"]);

  await gotoApp(authedPage);

  await expect(authedPage.getByTestId("todo-item")).toHaveCount(3);
  await expect(authedPage.getByTestId("todo-title")).toHaveText([
    "buy milk",
    "renew passport",
    "book dentist",
  ]);
  await expect(authedPage.getByTestId("todo-count")).toHaveText("0 of 3 done");
});

test("adding a todo through the UI persists it in the API", async ({ api, authedPage }) => {
  await gotoApp(authedPage);
  await expect(authedPage.getByTestId("empty-state")).toBeVisible();

  await authedPage.getByTestId("todo-input").fill("file tax return");
  await authedPage.getByTestId("todo-add").click();

  await expect(authedPage.getByTestId("todo-item")).toHaveCount(1);
  await expect(authedPage.getByTestId("todo-count")).toHaveText("0 of 1 done");

  // The real assertion: the server stored it, not just the DOM.
  const stored = await api.list();
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({ title: "file tax return", done: false });
});

test("toggling in the UI updates the stored record", async ({ api, authedPage }) => {
  const seeded = await api.seed(["water the plants", "call the bank"]);
  const first = seeded[0]!;

  await gotoApp(authedPage);
  const row = authedPage.locator(`[data-todo-id="${first.id}"]`);
  await row.getByTestId("todo-toggle").click();

  await expect(row).toHaveAttribute("data-done", "true");
  await expect(authedPage.getByTestId("todo-count")).toHaveText("1 of 2 done");

  const stored = await api.list();
  expect(stored.find((t) => t.id === first.id)?.done).toBe(true);
});

test("deleting removes the row and the record", async ({ api, authedPage }) => {
  const second = (await api.seed(["keep this", "delete this"]))[1]!;

  await gotoApp(authedPage);
  await authedPage.locator(`[data-todo-id="${second.id}"]`).getByTestId("todo-delete").click();

  await expect(authedPage.getByTestId("todo-item")).toHaveCount(1);
  await expect(authedPage.getByTestId("todo-title")).toHaveText(["keep this"]);
  expect(await api.list()).toHaveLength(1);
});

test("state set via the API shows up in the UI already completed", async ({ api, authedPage }) => {
  const done = (await api.seed(["already finished", "still pending"]))[0]!;
  await api.setDone(done.id, true);

  await gotoApp(authedPage);

  await expect(authedPage.locator(`[data-todo-id="${done.id}"]`)).toHaveAttribute("data-done", "true");
  await expect(authedPage.getByTestId("todo-count")).toHaveText("1 of 2 done");
});

test("surfaces the server's validation error verbatim", async ({ authedPage }) => {
  await gotoApp(authedPage);

  await authedPage.getByTestId("todo-input").fill("x".repeat(201));
  await authedPage.getByTestId("todo-add").click();

  await expect(authedPage.getByTestId("todo-error")).toHaveText("title must be 1-200 characters");
  await expect(authedPage.getByTestId("todo-item")).toHaveCount(0);
});

test("one user cannot see another user's todos", async ({ api, authedPage, playwright, baseURL }) => {
  await api.seed(["mine only"]);

  // A second, unrelated account created inline - the clearest way to prove isolation.
  const other = { email: `other-${Date.now()}@example.test`, password: "correct-horse-battery" };
  const ctx = await playwright.request.newContext({ baseURL });
  await ctx.post("/api/register", { data: other });
  await ctx.post("/api/login", { data: other });
  await ctx.post("/api/todos", { data: { title: "theirs only" } });

  await gotoApp(authedPage);
  await expect(authedPage.getByTestId("todo-title")).toHaveText(["mine only"]);

  await ctx.dispose();
});
