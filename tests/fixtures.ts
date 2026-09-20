import { randomUUID } from "node:crypto";

import { test as base, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Composition over inheritance.
 *
 * A Page Object hierarchy tends to grow a base class that every page extends and nobody
 * can change safely. Fixtures compose instead: a test declares the capabilities it needs
 * and Playwright builds exactly those, so unused setup never runs. The trade-off is that
 * selectors live in the specs rather than behind page objects - acceptable here because
 * the app exposes stable data-testids. For an app with sprawling, unstable markup, page
 * objects would earn their keep; the README covers when to switch.
 */

export type TestUser = { email: string; password: string };

export type TodoApi = {
  /** Creates a todo for the fixture's user and returns it. */
  create(title: string): Promise<Todo>;
  /** Creates several todos in order, so a test can seed a list in one line. */
  seed(titles: string[]): Promise<Todo[]>;
  list(): Promise<Todo[]>;
  setDone(id: number, done: boolean): Promise<Todo>;
};

export type Todo = { id: number; title: string; done: boolean; createdAt: string };

type Session = { request: APIRequestContext; cookieHeader: string };

type Fixtures = {
  /** A user that exists only for this test - the basis of isolation. */
  user: TestUser;
  /** Registers and logs in `user` exactly once, however many fixtures need it. */
  session: Session;
  /** API client already authenticated as `user`. */
  api: TodoApi;
  /** A page already logged in as `user`, without paying for a UI login. */
  authedPage: Page;
};

export const test = base.extend<Fixtures>({
  // Unique per test: two tests can never see each other's todos, so they can run in
  // any order, in parallel, against one shared server process.
  user: async ({}, use) => {
    await use({ email: `u-${randomUUID()}@example.test`, password: "correct-horse-battery" });
  },

  // Registration happens here and nowhere else, so `api` and `authedPage` in the same
  // test share one account instead of racing to register it twice.
  session: async ({ playwright, baseURL, user }, use) => {
    const request = await playwright.request.newContext({ baseURL });

    const register = await request.post("/api/register", { data: user });
    expect(register.status(), "registration should succeed for a fresh email").toBe(201);

    const login = await request.post("/api/login", { data: user });
    expect(login.status(), "login should succeed with the credentials just registered").toBe(200);

    const setCookie = login.headers()["set-cookie"] ?? "";
    expect(setCookie, "login must set a session cookie").toBeTruthy();

    await use({ request, cookieHeader: setCookie.split(";")[0] ?? "" });
    await request.dispose();
  },

  api: async ({ session }, use) => {
    const context = session.request;

    const client: TodoApi = {
      async create(title) {
        const res = await context.post("/api/todos", { data: { title } });
        expect(res.status(), `creating todo "${title}"`).toBe(201);
        return res.json();
      },
      async seed(titles) {
        const made: Todo[] = [];
        for (const title of titles) made.push(await client.create(title));
        return made;
      },
      async list() {
        const res = await context.get("/api/todos");
        expect(res.status()).toBe(200);
        return res.json();
      },
      async setDone(id, done) {
        const res = await context.patch(`/api/todos/${id}`, { data: { done } });
        expect(res.status(), `updating todo ${id}`).toBe(200);
        return res.json();
      },
    };

    await use(client);
    // the session fixture owns this context's lifetime
  },

  authedPage: async ({ browser, baseURL, session }, use) => {
    const context = await browser.newContext({ baseURL });
    const [name = "session", value = ""] = session.cookieHeader.split("=");
    // Injecting the session skips a UI login per test. The login form itself is
    // covered explicitly in auth.spec.ts, so nothing goes untested.
    await context.addCookies([{ name, value, url: baseURL! }]);

    const page = await context.newPage();
    await use(page);
    await context.close();
  },
});

export { expect };

/** Waits for the client-side bootstrap to finish, instead of sleeping. */
export async function gotoApp(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
}
