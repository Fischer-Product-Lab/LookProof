import { resolve } from "node:path";

import { checkImage, compileRequest, NodeFiles, type CoreRun } from "../src/core/index.js";

const repoRoot = process.cwd();
const fixtureRoot = resolve(repoRoot, "fixtures", "synthetic");
const look = resolve(fixtureRoot, "look.json");
const binding = resolve(fixtureRoot, "binding.json");
const evidence = resolve(fixtureRoot, "receipts", "evidence.json");
const review = resolve(fixtureRoot, "receipts", "human-review.json");
const image = resolve(fixtureRoot, "keepers", "reference.png");
const files = new NodeFiles();

function scenario(name: string, run: CoreRun) {
  return { name, exitCode: run.exitCode, verdict: run.verdict };
}

const scenarios = [
  scenario(
    "pass-with-human-review-receipt",
    compileRequest(files, {
      lookPath: look,
      bindingPath: binding,
      intentId: "pass-tile",
      prompt: "Render the declared synthetic geometry.",
      evidenceReceiptPath: evidence,
      humanReviewReceiptPath: review,
    }),
  ),
  scenario(
    "reference-conflict-refusal",
    compileRequest(files, {
      lookPath: look,
      bindingPath: binding,
      intentId: "conflict-tile",
      prompt: "Render the declared synthetic geometry.",
    }),
  ),
  scenario(
    "deterministic-only-refusal",
    compileRequest(files, {
      lookPath: look,
      bindingPath: binding,
      intentId: "deterministic-tile",
      prompt: "Render the declared synthetic geometry.",
    }),
  ),
  scenario(
    "mechanical-png-check",
    checkImage(files, { lookPath: look, intentId: "pass-tile", imagePath: image }),
  ),
];

process.stdout.write(
  `${JSON.stringify(
    {
      demo: "lookproof",
      dispatched: scenarios.some((entry) => entry.verdict.dispatched !== false),
      scenarios,
    },
    null,
    2,
  )}\n`,
);
