import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { test } from "node:test";


const repoRoot = process.cwd();

test("public demo shows a receipt-bearing pass, required refusals, and no dispatch", () => {
  const result = spawnSync(
    process.execPath,
    [resolve(repoRoot, "dist", "scripts", "demo.js")],
    { cwd: repoRoot, encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const demo = JSON.parse(result.stdout);
  assert.equal(demo.demo, "lookproof");
  assert.equal(demo.dispatched, false);
  assert.deepEqual(
    demo.scenarios.map((scenario: any) => [scenario.name, scenario.exitCode, scenario.verdict.gate]),
    [
      ["pass-with-human-review-receipt", 0, "pass"],
      ["reference-conflict-refusal", 1, "reference-conflict"],
      ["deterministic-only-refusal", 1, "deterministic-only-lock"],
      ["mechanical-png-check", 0, "pass"],
    ],
  );
  assert.equal(
    demo.scenarios[0].verdict.compiledRequest.receipts.humanReview.receiptId,
    "synthetic-review-receipt",
  );
  for (const scenario of demo.scenarios) assert.equal(scenario.verdict.dispatched, false);
});
