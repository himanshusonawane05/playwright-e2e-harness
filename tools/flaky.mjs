#!/usr/bin/env node
/**
 * Flaky-test detector.
 *
 * Reads Playwright's JSON report and reports two things a green build hides:
 *   1. tests that failed and then passed on a retry - the definition of a flake
 *   2. tests whose duration varies wildly between projects, which is usually a race
 *      that has not surfaced as a failure yet
 *
 * Exits 1 when a flake is found, so CI can surface it the day it appears instead of
 * a month later when everyone has learned to re-run the build.
 *
 * Usage: node tools/flaky.mjs [path-to-results.json]
 */
import { readFileSync } from "node:fs";

const FILE = process.argv[2] ?? "test-results/results.json";
const DURATION_SPREAD = 3; // slowest project run this many times the fastest

let report;
try {
  report = JSON.parse(readFileSync(FILE, "utf8"));
} catch (err) {
  console.error(`Could not read ${FILE}: ${err.message}`);
  console.error("Run the suite first - the json reporter writes it.");
  process.exit(2);
}

/** Playwright nests suites arbitrarily deep; walk to the specs. */
function* walk(suites, trail = []) {
  for (const suite of suites ?? []) {
    const here = [...trail, suite.title].filter(Boolean);
    for (const spec of suite.specs ?? []) yield { spec, trail: here };
    yield* walk(suite.suites, here);
  }
}

const flakes = [];
const durations = new Map(); // title -> [{project, ms}]

for (const { spec, trail } of walk(report.suites)) {
  const title = [...trail, spec.title].join(" > ");
  for (const test of spec.tests ?? []) {
    const results = test.results ?? [];
    const failedThenPassed =
      results.length > 1 && results.at(-1)?.status === "passed" &&
      results.slice(0, -1).some((r) => r.status === "failed" || r.status === "timedOut");

    if (failedThenPassed || test.status === "flaky") {
      flakes.push({
        title,
        project: test.projectName ?? "?",
        attempts: results.length,
        firstError: (results.find((r) => r.error)?.error?.message ?? "")
          .split("\n")[0]
          .slice(0, 120),
      });
    }

    const last = results.at(-1);
    if (last?.status === "passed") {
      if (!durations.has(title)) durations.set(title, []);
      durations.get(title).push({ project: test.projectName ?? "?", ms: last.duration ?? 0 });
    }
  }
}

const spreads = [...durations.entries()]
  .map(([title, runs]) => {
    const sorted = [...runs].sort((a, b) => a.ms - b.ms);
    const fastest = sorted[0];
    const slowest = sorted.at(-1);
    return { title, fastest, slowest, ratio: fastest.ms > 0 ? slowest.ms / fastest.ms : 0 };
  })
  .filter((d) => d.ratio >= DURATION_SPREAD && d.slowest.ms > 1000)
  .sort((a, b) => b.ratio - a.ratio);

console.log(`Flake report - ${FILE}`);
console.log("=".repeat(64));

if (flakes.length === 0) {
  console.log("No tests passed on retry.");
} else {
  console.log(`${flakes.length} test(s) passed only after a retry:\n`);
  for (const f of flakes) {
    console.log(`  [${f.project}] ${f.title}`);
    console.log(`      attempts: ${f.attempts}${f.firstError ? `  first error: ${f.firstError}` : ""}`);
  }
  console.log("\nFix the cause before reaching for a retry - see docs/quarantine.md.");
}

if (spreads.length) {
  console.log(`\n${spreads.length} test(s) vary more than ${DURATION_SPREAD}x across projects:\n`);
  for (const s of spreads.slice(0, 10)) {
    console.log(
      `  ${s.title}\n      ${s.fastest.project} ${s.fastest.ms}ms vs ` +
        `${s.slowest.project} ${s.slowest.ms}ms (${s.ratio.toFixed(1)}x)`,
    );
  }
  console.log("\nA wide spread is often a race that has not failed yet.");
}

process.exit(flakes.length > 0 ? 1 : 0);
