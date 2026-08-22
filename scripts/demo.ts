import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const cliPath = resolve(repoRoot, "src", "cli.ts");
const fixtureRoot = resolve(repoRoot, "fixtures", "synthetic");
const look = resolve(fixtureRoot, "look.json");
const binding = resolve(fixtureRoot, "binding.json");
const evidence = resolve(fixtureRoot, "receipts", "evidence.json");
const review = resolve(fixtureRoot, "receipts", "human-review.json");
const image = resolve(fixtureRoot, "keepers", "reference.png");

function run(name: string, args: string[]) {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", cliPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status === null || result.error) throw result.error ?? new Error(`${name} did not exit`);
  let verdict: unknown;
  try {
    verdict = JSON.parse(result.stdout);
  } catch {
    throw new Error(`${name} did not emit one JSON verdict: ${result.stderr || result.stdout}`);
  }
  return { name, exitCode: result.status, verdict };
}

const shared = ["--look", look, "--binding", binding];
const scenarios = [
  run("pass-with-human-review-receipt", [
    "preflight",
    ...shared,
    "--intent",
    "pass-tile",
    "--prompt",
    "Render the declared synthetic geometry.",
    "--evidence-receipt",
    evidence,
    "--human-review-receipt",
    review,
  ]),
  run("reference-conflict-refusal", [
    "preflight",
    ...shared,
    "--intent",
    "conflict-tile",
    "--prompt",
    "Render the declared synthetic geometry.",
  ]),
  run("deterministic-only-refusal", [
    "preflight",
    ...shared,
    "--intent",
    "deterministic-tile",
    "--prompt",
    "Render the declared synthetic geometry.",
  ]),
  run("mechanical-png-check", [
    "check",
    "--look",
    look,
    "--intent",
    "pass-tile",
    "--image",
    image,
  ]),
];

process.stdout.write(
  `${JSON.stringify(
    {
      demo: "lookproof",
      dispatched: scenarios.some((scenario: any) => scenario.verdict.dispatched !== false),
      scenarios,
    },
    null,
    2,
  )}\n`,
);
