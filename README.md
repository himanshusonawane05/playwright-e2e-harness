# Playwright end-to-end harness

A reference test suite against a self-hosted demo app: auth, a REST API, and a UI. It
exists to show how a suite is put together when the goal is speed and trustworthiness
rather than test count.

## Measured results

All numbers from this repo, on a 6-core/12-thread Windows dev box, 17 tests, Chromium.

| | Result |
|---|---|
| Serial run (1 worker) | **6.7 s** |
| Default run (3 workers), green | **4.3-4.8 s** |
| Local stability | **2 of 5 runs hit the stall below** - see Known issue |
| Login cost across the suite | **one** UI login (0.36 s), reused by every test |
| Artifacts on a green run | none |
| Regression check | breaking one line of app code failed 4 tests with traces attached |

**The finding worth stealing:** `video: "retain-on-failure"` records video for *every*
test and deletes it when the test passes. At 6 workers that alone took the suite from
**14.6 s to 55 s** and turned page loads into timeouts - the artifact setting was
manufacturing the flakes. `video: "on-first-retry"` records only the run you actually
need to watch.

## What it demonstrates

- **Auth reuse via `storageState`** - a `setup` project logs in once and saves browser
  state; every browser project starts authenticated. No test replays the login form.
- **API-seeded, UI-asserted tests** - state is created through the API, assertions run
  against the UI, and the final check reads back from the API to confirm the server
  really stored what the screen showed.
- **Per-test isolation without resets** - each test registers its own user, so tests
  share one server process yet cannot see each other's data. No reset endpoint, no
  ordering assumptions, no shared mutable state.
- **Network interception** - the app's third-party "tip" call is stubbed, so the suite
  never depends on someone else's uptime, and failure paths that are impossible to
  trigger against the real service get covered.
- **Failure-only artifacts** - trace and screenshot on failure, video on retry.
- **Parallel + sharded** - `fullyParallel`, with CI running a 4-browser x 2-shard matrix
  and merging the shards into one HTML report.
- **Cross-browser** - chromium, firefox, webkit and a mobile viewport.

## Architecture, and why

**Fixtures, not page objects.** `tests/fixtures.ts` exposes `user`, `session`, `api` and
`authedPage`. A test declares what it needs and Playwright builds exactly that, so unused
setup never runs. A page-object tree tends to grow a base class everyone extends and
nobody can change safely.

The trade-off is real: selectors live in the specs. That works here because the app
exposes stable `data-testid` hooks. Against an app with sprawling or unstable markup,
page objects earn their keep - and the fixtures would then return page objects instead
of raw pages, which is a small change.

**Two authentication paths on purpose.** The shared `storageState` account covers tests
that only read or navigate. Anything that mutates data uses the per-test `user` fixture,
authenticated through the API. That keeps the speed of a single login without letting
parallel tests collide over one account's data.

**Retries are deliberate.** One retry in CI, none locally. A retry hides a real bug as
easily as a flake, so locally a failure stays a failure until someone fixes it. The two
flakes found while building this repo were both fixed at the source (below), not retried.

## Bugs this suite found in its own app

Kept here because they are the failure modes worth recognising in a client's codebase:

1. **`ECONNRESET` under parallel load.** Node closes idle keep-alive sockets after 5 s; a
   client reusing a socket at that instant gets a reset. Fixed by raising the server's
   `keepAliveTimeout` above any client's, not by retrying.
2. **A third-party call gating page readiness.** The app awaited the tip service before
   declaring itself ready, so DNS latency for someone else's domain became this app's
   page-load time. Now fire-and-forget.
3. **An unguarded `fetch` crashing startup.** A dropped request rejected, the bootstrap
   promise died, and the page never finished loading. Found by the test that aborts the
   request outright.

## Running it

```bash
npm ci
npx playwright install chromium     # or --with-deps on Linux
npm test                            # starts the app, runs the suite
npm run test:serial                 # 1 worker
npm run report                      # open the HTML report
```

Playwright starts and stops the demo app itself, so `npm test` is the only command
needed. Copy `.env.example` to `.env` to change ports or credentials; **8090** is the
default because 8080 is so often taken.

## Adapting this to your app

1. Replace `app/` with your application, or point `webServer.url` at an existing one.
2. Rewrite `auth.setup.ts` for your login form - everything downstream is unchanged.
3. Reshape the `api` fixture around your endpoints; specs keep calling `api.seed(...)`.
4. Swap the `data-testid` selectors. If your markup lacks stable hooks, adding them is
   cheaper than maintaining brittle CSS selectors, and this is the argument for doing so.

## Known issue: intermittent local stalls

Honest status: on this Windows machine **2 runs in 5** have a test stall on `page.goto`
and time out, at any worker count above 1. Green runs finish in 4.8 s; affected runs take
15 s and report one or two failures. The machine was running a torrent client and two
vendor background apps throughout, which is representative of a developer laptop but not
of CI.

What the evidence says it is **not**: during a failing run the server's slowest response
was **45.8 ms**, and the request log shows a **10-second window with zero inbound
requests** while a test sat waiting - the browser never sent one. Separately, the API
serves 24 concurrent clients in 495 ms with no errors, and 6 independent browsers each
load the page in ~40 ms. So neither the app nor browser concurrency explains it; the
stall is in the local browser/network layer, with security software the leading suspect.

Reproduce the diagnosis with `LOG_REQUESTS=1 node app/server.js`, which timestamps every
request and makes "did this even reach the server" a one-glance question.

This is unresolved and stated as such. It has not been observed in CI.

## Not built yet

Deliberately deferred, in order of value: visual regression via `toHaveScreenshot` with a
documented baseline workflow, axe-core accessibility checks, a flaky-test detector reading
`test-results/results.json`, and a quarantine mechanism that keeps known-flaky tests
running without blocking the build.
