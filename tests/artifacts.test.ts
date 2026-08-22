import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

function readJson(path: string): any {
  return JSON.parse(readFileSync(resolve(repoRoot, path), "utf8"));
}

test("public schemas separate provider-neutral policy, binding, and receipts", () => {
  const lookSchema = readJson("schema/look.schema.json");
  const bindingSchema = readJson("schema/binding.schema.json");
  const evidenceSchema = readJson("schema/evidence-receipt.schema.json");
  const reviewSchema = readJson("schema/human-review-receipt.schema.json");

  assert.equal(lookSchema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(lookSchema.additionalProperties, false);
  assert.equal(lookSchema.properties.provider, undefined);
  assert.equal(lookSchema.properties.model, undefined);
  assert.equal(lookSchema.properties.binding, undefined);
  assert.equal(lookSchema.properties.bindings, undefined);
  assert.deepEqual(lookSchema.$defs.lock.required, ["description"]);
  assert.equal(lookSchema.$defs.lock.properties.enforcement.default, "generativeLock");
  assert.equal(lookSchema.$defs.lock.properties.evidenceRequired.default, false);
  assert.deepEqual(lookSchema.$defs.lock.properties.mustShow.default, []);

  assert.equal(bindingSchema.additionalProperties, false);
  assert.ok(bindingSchema.required.includes("provider"));
  assert.ok(bindingSchema.required.includes("model"));
  assert.equal(evidenceSchema.properties.kind.const, "reference-evidence");
  assert.equal(reviewSchema.properties.kind.const, "human-review");
});

test("public schemas use LookProof identity without unpublished canonical IDs", () => {
  for (const path of [
    "schema/look.schema.json",
    "schema/binding.schema.json",
    "schema/evidence-receipt.schema.json",
    "schema/human-review-receipt.schema.json",
  ]) {
    const schema = readJson(path);
    assert.equal(schema.$id, undefined, path);
    assert.match(schema.title, /^LookProof\b/, path);
  }
});

test("package metadata uses the LookProof identity and remains private", () => {
  const pkg = readJson("package.json");
  assert.equal(pkg.name, "lookproof");
  assert.equal(pkg.private, true);
  assert.equal(pkg.license, "Apache-2.0");
  assert.equal(Object.keys(pkg.dependencies ?? {}).length, 0);
  assert.equal(Object.keys(pkg.devDependencies ?? {}).length, 0);
});

test("public documentation states the actual LookProof boundary", () => {
  const readme = readFileSync(resolve(repoRoot, "README.md"), "utf8");
  const threatModel = readFileSync(resolve(repoRoot, "docs", "threat-model.md"), "utf8");
  const limitations = readFileSync(resolve(repoRoot, "docs", "limitations.md"), "utf8");
  const license = readFileSync(resolve(repoRoot, "LICENSE"), "utf8");
  const notice = readFileSync(resolve(repoRoot, "NOTICE"), "utf8");

  assert.match(readme, /^# LookProof$/m);
  assert.match(readme, /proves declared checks ran and inputs were hashed/i);
  assert.match(readme, /does not prove artistic correctness or model compliance/i);
  assert.match(readme, /nothing is sent/i);
  assert.match(threatModel, /fail closed/i);
  assert.match(threatModel, /path traversal/i);
  assert.match(threatModel, /SHA-256/);
  assert.match(limitations, /does not inspect pixels for style/i);
  assert.match(license, /Apache License\s+Version 2\.0/);
  assert.match(notice, /^LookProof$/m);
});

test("README is a complete local command reference", () => {
  const readme = readFileSync(resolve(repoRoot, "README.md"), "utf8");
  for (const heading of [
    "## Try it",
    "## Selected output",
    "## Flow",
    "## Inputs and output",
    "## Commands",
    "### `preflight`",
    "### `check`",
    "## Schemas",
    "## Security and limitations",
    "## Development",
    "## License",
  ]) {
    assert.ok(readme.includes(heading), heading);
  }
  assert.match(readme, /look\.json \+ binding\.json \+ references \+ receipts -> local validation and compilation -> JSON envelope/);
  assert.match(readme, /https:\/\/github\.com\/Fischer-Product-Lab\/LookProof\.git/);
  assert.match(readme, /required[^\n]*`--look`[^\n]*`--binding`[^\n]*`--intent`[^\n]*`--prompt`/i);
  assert.match(readme, /optional[^\n]*`--room explore\|locked`[^\n]*`--evidence-receipt`[^\n]*`--human-review-receipt`/i);
  assert.match(readme, /conditionally required by the selected intent/i);
  assert.match(readme, /records the mode[^\n]*does not bypass checks/i);
  assert.match(readme, /required[^\n]*`--look`[^\n]*`--intent`[^\n]*`--image`/i);
  assert.match(readme, /PNG signature and IHDR dimensions/i);
  assert.match(readme, /exit code `0`/i);
  assert.match(readme, /exit code `1`/i);
  assert.match(readme, /exit code `2`/i);
});

test("fixture policy is provider-neutral and the CLI has no network or dispatch primitive", () => {
  const look = readJson("fixtures/synthetic/look.json");
  const source = readFileSync(resolve(repoRoot, "src", "cli.ts"), "utf8");
  for (const key of ["provider", "model", "binding", "bindings", "endpoint", "credentials"]) {
    assert.equal(look[key], undefined);
  }
  assert.doesNotMatch(source, /node:https|node:http|fetch\s*\(|XMLHttpRequest|WebSocket|axios|\.request\s*\(/);
  assert.doesNotMatch(source, /\bdispatch\s*\(/i);
});

test("CI is SHA-pinned, read-only, and limited to local quality gates", () => {
  const ci = readFileSync(resolve(repoRoot, ".github", "workflows", "ci.yml"), "utf8");

  assert.match(ci, /^name: CI$/m);
  const triggers = ci.match(/^on:\n([\s\S]*?)\npermissions:/m)?.[1];
  assert.equal(triggers, "  push:\n    branches:\n      - main\n  pull_request:\n    branches:\n      - main\n");
  const permissions = ci.match(/^permissions:\n([\s\S]*?)\njobs:/m)?.[1];
  assert.equal(permissions, "  contents: read\n");
  const jobs = ci.slice(ci.indexOf("jobs:\n") + "jobs:\n".length);
  assert.deepEqual([...jobs.matchAll(/^  ([A-Za-z0-9_-]+):$/gm)].map((match) => match[1]), ["test"]);
  assert.match(ci, /^  test:\n    runs-on: ubuntu-latest\n    timeout-minutes: 5$/m);
  assert.deepEqual([...ci.matchAll(/^      - uses: (.+)$/gm)].map((match) => match[1]), [
    "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1",
    "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0",
  ]);
  assert.match(ci, /^      - uses: actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7\.0\.0\n        with:\n          node-version: 22$/m);
  assert.deepEqual([...ci.matchAll(/^      - run: (.+)$/gm)].map((match) => match[1]), ["npm test", "npm run demo"]);
  assert.doesNotMatch(ci, /\b(?:npm|pnpm|yarn)\s+(?:ci|install|add|publish)\b/i);
  assert.doesNotMatch(ci, /\b(?:cache|matrix|artifacts?|secrets?|installs?|installation|deployments?|releases?|publish(?:ing)?|write)\b/i);
});

test("security policy keeps reports private, synthetic, and explicitly unsupported", () => {
  const security = readFileSync(resolve(repoRoot, "SECURITY.md"), "utf8");

  assert.match(security, /pre-1\.0[^\n]*only the latest `main`/i);
  assert.match(security, /https:\/\/github\.com\/Fischer-Product-Lab\/LookProof\/security\/advisories\/new/);
  assert.match(security, /do not open a public issue/i);
  assert.match(security, /synthetic reproduction/i);
  assert.match(security, /affected commit or version/i);
  assert.match(security, /impact/i);
  assert.match(security, /expected and actual behavior/i);
  assert.match(security, /never include credentials, private artwork, provider payloads, or other sensitive content/i);
  assert.match(security, /no response SLA/i);
  assert.match(security, /no security warranty/i);
  assert.doesNotMatch(security, /\u2014/);
  assert.doesNotMatch(security, /mailto:|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
});
