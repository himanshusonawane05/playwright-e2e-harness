# Playwright end-to-end harness

A reference test suite against a self-hosted demo app: auth, a REST API, and a UI. It
exists to show how a suite is put together when the goal is speed and trustworthiness
rather than test count.

## Measured results

All numbers from this repo, on a 6-core/12-thread Windows dev box, 17 tests, Chromium.

All numbers below are from this repo on an idle 6-core/12-thread Windows box, 24 tests,
Chromium.

| | Result |
|---|---|
| Full suite, parallel | **4.1 s** |
| Full suite, serial (1 worker) | **9.4 s** |
| Stability | **5 of 5 runs green** on an idle machine |
| Login cost across the suite | **one** UI login (0.32 s), reused by every test |
| Artifacts on a green run | none |
| Regression check | breaking one line of app code failed 4 tests with traces attached |
| Bugs found in the app under test | **5** (3 timing/network, 2 accessibility) |

**The finding worth stealing:** competing CPU load, not worker count, is what breaks a
Playwright suite. While a game installer was using 99.5% of all 12 threads, this suite
failed **2 runs in 5** with `page.goto` timing out, and 6 workers took 55 s. On the same
machine once idle: **0 failures in 5 runs**, and 3, 6 and 12 workers all finish in
4.0-4.6 s. Before you tune a config, check what else is running - and be sceptical of any
benchmark (including an earlier version of this README) taken on a busy machine.

Worker count barely matters for a suite this size: past the core count, parallelism stops
paying. `video: "retain-on-failure"` costs a measured ~7% (4.0 s → 4.3 s at 6 workers),
which is worth it for the video of a first failure - though on a CPU-constrained CI runner
`on-first-retry` is the better switch.

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
4. **Colour contrast below WCAG AA.** The muted grey and the error red failed 4.5:1 on
   four elements, including the validation message. Found by axe, fixed in the palette.
5. **A wrong assumption about tab order**, caught by the keyboard test - the test encoded
   what I expected rather than what the DOM does. The test was wrong, not the app, and the
   corrected version now pins the real order so a future change to it is caught.

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

## Case study: diagnosing a flaky suite

Worth reading if you have ever been told "the tests are just flaky". This suite was
failing 2 runs in 5, with `page.goto` timing out. The investigation, in order:

1. **Is it the app?** Added `LOG_REQUESTS=1` to timestamp every request. During a failing
   run the slowest response was **45.8 ms**, and the log showed a **10-second window with
   zero inbound requests** while a test sat waiting. The browser never sent one. Not the
   app.
2. **Is it server capacity?** `tools/bench-api.mjs` drove 24 concurrent clients through
   register → login → create → list: **495 ms total, zero errors**. Not capacity.
3. **Is it browser concurrency?** `tools/bench-browsers.mjs` launched 6 independent
   browsers: each loaded the page in **~40 ms**. Not concurrency.
4. **What else was running?** A game installer was using **99.5% of all 12 threads**.
   Once it finished: **0 failures in 5 runs**, 4.0-4.6 s at every worker count tried.

The root cause was CPU starvation from an unrelated process, and every "fix" attempted
before finding it - tuning worker counts, changing artifact settings - was measuring
noise. Two of those conclusions were wrong and are corrected above.

The transferable lesson: **measure before tuning, and know what else is on the machine.**
The diagnostic tools are in `tools/`, and `LOG_REQUESTS=1` stays in the app because "did
this request even reach the server" should always be one command away.

## Visual regression

Screenshots catch what assertions never do - a stylesheet that failed to load, a button
pushed off-screen, a layout that collapses at mobile width. They also produce the most
false positives of any technique, so `tests/e2e/visual.spec.ts` follows three rules:
shoot a component rather than the whole page, mask anything that legitimately varies
(the random test email, the third-party tip), and seed fixed data so the pixels depend on
the code and nothing else.

Thresholds sit in `playwright.config.ts`: per-pixel tolerance 0.2 and **at most 1% of
pixels may differ**. That absorbs font hinting and anti-aliasing differences between
machines while still failing on a moved button. Animations are disabled and the caret is
hidden, because both are classic screenshot flakes.

Baselines are per-browser and committed. To update them deliberately:

```bash
npm run visual:update      # then review every diff before committing
```

An updated baseline is how a real bug gets blessed into the repo forever, so treat the
diff images as a code review, not a formality.

## Accessibility

`tests/e2e/a11y.spec.ts` runs axe-core against the sign-in page, the populated list and
the error state, scoped to `wcag2a`/`wcag2aa`/`wcag21aa` - the tags procurement and legal
actually ask about. Failures print the offending selector and the rule's help URL, so the
output says what to fix.

**Stated honestly to clients:** automated scanning catches roughly a third of real
accessibility problems. It cannot tell you whether a flow makes sense to a screen-reader
user. A green scan means "no obvious defects", not "compliant". There is also one
keyboard-only test, because a control the mouse can reach and the keyboard cannot is the
most common real-world failure and no scanner reports it.

## Flakes and quarantine

Policy in [`docs/quarantine.md`](docs/quarantine.md). The short version: a flaky test is a
bug report, and raising the retry count converts a real signal into silence. Tests that
genuinely cannot be fixed locally are tagged `@quarantine` with a date and an issue link;
they are excluded from the blocking run and executed in a separate non-blocking CI job, so
they keep running without holding up a merge.

```bash
npm run flaky              # anything that passed only on a retry
npm run test:quarantine    # run the quarantined tests on purpose
```

`tools/flaky.mjs` also reports tests whose duration varies more than 3x across projects -
usually a race that has not failed yet.
