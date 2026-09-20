# Flake and quarantine policy

A suite people trust is worth more than a suite that covers everything. The moment a red
build stops meaning "something is broken", the suite has stopped working, no matter how
many tests it contains. This policy exists to keep that from happening.

## The rule

**A flaky test is a bug report, not a nuisance.** It is telling you that the app, or the
test, depends on something it should not: timing, ordering, a shared record, someone
else's server. Fix the cause. Raising the retry count converts a real signal into silence.

Retries here are one in CI, none locally. CI gets one because a runner can genuinely drop
a connection; local gets none because a failure you can reproduce is a gift.

## When a test flakes

1. **Reproduce it.** `npx playwright test path/to.spec.ts --repeat-each=20 --workers=1`.
   If it only fails in parallel, the cause is shared state, not timing.
2. **Read the trace**, not the error line. `npx playwright show-trace <trace.zip>` gives
   you the network log, the DOM at each step and the exact action that hung.
3. **Fix the cause.** The common ones, in the order they actually occur:
   - waiting on a timeout instead of a condition
   - two tests sharing a user, record or fixture file
   - an assertion racing an animation or a pending request
   - a third-party call that should be intercepted
   - the app itself being genuinely racy - the most valuable thing the suite can find
4. **Only if the cause is outside your control**, quarantine it, with an expiry.

## Quarantining

Tag the test and link the issue:

```ts
// @quarantine 2026-11-01 - upstream provider returns 503 under load, see #142
test("imports a report from the partner API @quarantine", async ({ page }) => {
```

What that does:

- The blocking run skips it: `grepInvert: /@quarantine/` in `playwright.config.ts`.
- A separate non-blocking CI job runs exactly those tests with `RUN_QUARANTINED=1`, so
  they keep executing and their results stay visible.
- Nothing is deleted, and nothing silently rots.

Every quarantine entry carries a **date and an issue link**. A tag with neither is how a
suite ends up with forty skipped tests nobody remembers.

## Getting out of quarantine

Review quarantined tests **weekly**. A test leaves quarantine when it passes 20
consecutive runs in the non-blocking job. A test that is still quarantined after 30 days
is escalated or deleted - keeping a test nobody trusts and nobody fixes is the worst of
both worlds.

## Detecting flakes

`node tools/flaky.mjs` reads `test-results/results.json` and reports any test that passed
only after a retry, plus any test whose duration varies by more than 3x across projects.
Wire it into CI after the test job; it exits non-zero when a test passed on retry, which
is how a flake becomes visible on the day it appears rather than a month later.
