import AxeBuilder from "@axe-core/playwright";

import { test, expect, gotoApp } from "../fixtures";

/**
 * Accessibility checks with axe-core.
 *
 * Automated scanning catches roughly a third of real accessibility problems - contrast,
 * missing labels, broken landmark structure, unlabelled controls. It cannot judge whether
 * a flow makes sense to a screen-reader user. Treat a green scan as "no obvious defects",
 * not as a compliance claim, and say so to clients rather than overselling it.
 *
 * Scoped to wcag2a/wcag2aa/wcag21aa: the tags that map to what procurement and legal
 * actually ask about. Scanning every rule produces noise nobody triages.
 */

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/** Prints the offending selectors, so a failure says what to fix, not just how many. */
function describe(violations: Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"]): string {
  return violations
    .map((v) => {
      const where = v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ");
      return `${v.id} (${v.impact}): ${v.help}\n    at: ${where}\n    ${v.helpUrl}`;
    })
    .join("\n\n");
}

test("sign-in page has no detectable accessibility violations", async ({ page }) => {
  await page.context().clearCookies();
  await gotoApp(page);
  await expect(page.getByTestId("auth-view")).toBeVisible();

  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(results.violations, describe(results.violations)).toEqual([]);
});

test("todo list has no detectable accessibility violations", async ({ api, authedPage }) => {
  await api.seed(["a pending task", "a completed task"]);
  await gotoApp(authedPage);
  await expect(authedPage.getByTestId("todo-item")).toHaveCount(2);

  const results = await new AxeBuilder({ page: authedPage }).withTags(TAGS).analyze();
  expect(results.violations, describe(results.violations)).toEqual([]);
});

test("the error state stays announced and readable", async ({ authedPage }) => {
  await gotoApp(authedPage);
  await authedPage.getByTestId("todo-input").fill("x".repeat(201));
  await authedPage.getByTestId("todo-add").click();
  await expect(authedPage.getByTestId("todo-error")).toBeVisible();

  // role="alert" is what makes a validation failure reach a screen reader at all.
  await expect(authedPage.getByTestId("todo-error")).toHaveAttribute("role", "alert");

  const results = await new AxeBuilder({ page: authedPage }).withTags(TAGS).analyze();
  expect(results.violations, describe(results.violations)).toEqual([]);
});

test("the whole flow is reachable by keyboard alone", async ({ authedPage }) => {
  await gotoApp(authedPage);

  // Not an axe rule, but the single most common real-world failure: a control that a
  // mouse can reach and a keyboard cannot. Tab order follows the DOM, so logout (in the
  // header) comes before the form - asserted explicitly, because a change to that order
  // is exactly the kind of regression worth catching.
  await authedPage.keyboard.press("Tab");
  await expect(authedPage.getByTestId("logout")).toBeFocused();

  await authedPage.keyboard.press("Tab");
  await expect(authedPage.getByTestId("todo-input")).toBeFocused();

  await authedPage.keyboard.type("added without a mouse");
  await authedPage.keyboard.press("Tab");
  await expect(authedPage.getByTestId("todo-add")).toBeFocused();
  await authedPage.keyboard.press("Enter");

  await expect(authedPage.getByTestId("todo-item")).toHaveCount(1);
  await expect(authedPage.getByTestId("todo-title")).toHaveText(["added without a mouse"]);
});
