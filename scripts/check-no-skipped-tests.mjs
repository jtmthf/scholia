#!/usr/bin/env node
// Refuse to pass when any test was skipped. The hosted-path CI job sets
// DATABASE_URL and runs migrations, so no test should silently skip — a skip
// there means a hosted-path regression is hiding itself behind
// `describe.skipIf(!DATABASE_URL)`.
//
// Reads the JSON reporter output vitest writes to results.json:
//   pnpm test:ci --reporter=default --reporter=json --outputFile=results.json
//
// Usage: node ./scripts/check-no-skipped-tests.mjs <results.json>
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("usage: check-no-skipped-tests.mjs <results.json>");
  process.exit(2);
}

let parsed;
try {
  parsed = JSON.parse(readFileSync(file, "utf8"));
} catch (err) {
  console.error(`Could not read JSON results from ${file}: ${err.message}`);
  console.error("Did the test step run with --reporter=json --outputFile=...?");
  process.exit(2);
}

// Walk every assertion result across every test file. A skipped describe
// (skipIf) propagates status "skipped" to each contained assertion, so this
// catches both `it.skip()` and `describe.skipIf(true)`.
const skipped = [];
for (const suite of parsed.testResults ?? []) {
  for (const assertion of suite.assertionResults ?? []) {
    if (assertion.status === "skipped") {
      skipped.push(assertion.fullName ?? "(anonymous)");
    }
  }
}

if (skipped.length > 0) {
  console.error(
    `Refusing to pass: ${skipped.length} test(s) were skipped with DATABASE_URL set.\n` +
      "A skip in this job means a hosted-path regression hides itself. Skipped:\n- " +
      skipped.join("\n- "),
  );
  process.exit(1);
}

console.log("No skipped tests in hosted-path results.");
