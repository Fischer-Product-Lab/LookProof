import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";


const repoRoot = process.cwd();

function readJson(path: string): any {
  return JSON.parse(readFileSync(resolve(repoRoot, path), "utf8"));
}

function readText(path: string): string {
  return readFileSync(resolve(repoRoot, path), "utf8").replaceAll(String.fromCharCode(13, 10), "\n");
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
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), ["@modelcontextprotocol/server", "zod"]);
  assert.match(pkg.dependencies["@modelcontextprotocol/server"], /^2\./);
  assert.match(pkg.dependencies.zod, /^4\./);
  assert.deepEqual(Object.keys(pkg.devDependencies).sort(), ["@types/node", "typescript"]);
  assert.match(pkg.devDependencies["@types/node"], /^22\./);
  assert.match(pkg.devDependencies.typescript, /^7\./);
});

test("public documentation states the actual LookProof boundary", () => {
  const readme = readText("README.md");
  const threatModel = readText("docs/threat-model.md");
  const limitations = readText("docs/limitations.md");
  const license = readText("LICENSE");
  const notice = readText("NOTICE");

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

test("public case study shows the synthetic refusal without private study artifacts or pixel-success claims", () => {
  const readme = readText("README.md");
  const caseStudy = readText("docs/case-study.md");
  const sharedCore = readText("docs/shared-core-example.md");
  const diagram = readText("docs/refusal-flow.svg");
  const publicEvidence = [caseStudy, sharedCore, diagram].join("\n");

  assert.match(readme, /\[case study\]\(docs\/case-study\.md\)/i);
  assert.match(caseStudy, /\!\[Synthetic request refused before spend\]\(refusal-flow\.svg\)/);
  assert.match(caseStudy, /\[shared-core example\]\(shared-core-example\.md\)/);
  assert.match(sharedCore, /--intent deterministic-tile/);
  assert.match(sharedCore, /"gate": "deterministic-only-lock"/);
  assert.match(sharedCore, /"compiledRequest": null/);
  assert.match(sharedCore, /"dispatched": false/);
  assert.match(sharedCore, /asserts deep equality between CLI and MCP verdicts/i);
  assert.match(diagram, /Example: refused before spend/);
  assert.match(diagram, /0 generation calls/);
  assert.doesNotMatch(publicEvidence, /NANO-|FLUX2-|POSTHASTE|\bPip\b|\bMoxie\b|C:[/\\]Users|prompt[_-]?id|creditsUsed|89\.70/i);
  assert.doesNotMatch(caseStudy, /LookProof (fixed|improved|made).*pixels/i);
});

test("README is a complete local command reference", () => {
  const readme = readText("README.md");
  for (const heading of [
    "## Try it",
    "## Selected output",
    "## Flow",
    "## Inputs and output",
    "## Commands",
    "### `preflight`",
    "### `check`",
    "### `validate`",
    "### `explain`",
    "## MCP server",
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
  assert.match(readme, /npm ci/);
  assert.match(readme, /npm run build/);
  assert.match(readme, /dist\/src\/cli\.js/);
  assert.match(readme, /dist\/src\/mcp\.js --root/);
  assert.doesNotMatch(readme, /experimental-strip-types|zero-dependency|no package dependencies/i);
  assert.match(readme, /exit code `0`/i);
  assert.match(readme, /exit code `1`/i);
  assert.match(readme, /exit code `2`/i);
});

test("README uses the exact Hermes YAML configuration for the contained MCP server", () => {
  const readme = readText("README.md");
  const expected = [
    "```yaml",
    "mcp_servers:",
    "  lookproof:",
    '    command: "node"',
    "    args:",
    '      - "C:/absolute/path/to/LookProof/dist/src/mcp.js"',
    '      - "--root"',
    '      - "C:/absolute/path/to/contained/files"',
    "```",
  ].join("\n");
  const actual = readme.match(/Example Hermes stdio configuration:\n\n(```[\s\S]*?```)/)?.[1];

  assert.equal(actual, expected);
  assert.doesNotMatch(actual ?? "", /^\s*env:/m);
  assert.doesNotMatch(readme, /mcpServers|\u2014/);
});

test("README gives a copy-paste Hermes MCP onboarding path with root-relative tool arguments", () => {
  const readme = readText("README.md");

  assert.match(readme, /### Hermes CLI setup/);
  assert.match(readme, /hermes mcp add lookproof --command node --args/);
  assert.match(readme, /fixtures\/synthetic/);
  assert.match(readme, /hermes chat --in C:\/absolute\/path\/to\/LookProof/i);
  assert.match(readme, /MCP paths are relative to the configured root/i);
  assert.match(readme, /\[shared-core example\]\(docs\/shared-core-example\.md\)/);
  for (const value of [
    "`look.json`",
    "`binding.json`",
    "`receipts/evidence.json`",
    "`receipts/human-review.json`",
    "`keepers/reference.png`",
    "`mcp__lookproof__compile_request`",
  ]) {
    assert.ok(readme.includes(value), value);
  }
});

test("fixture policy is provider-neutral and production has no network or dispatch primitive", () => {
  const look = readJson("fixtures/synthetic/look.json");
  const source = [
    "src/cli.ts",
    "src/mcp.ts",
    "src/mcp/server.ts",
    "src/core/check.ts",
    "src/core/compile.ts",
    "src/core/explain.ts",
    "src/core/files.ts",
    "src/core/hash.ts",
    "src/core/index.ts",
    "src/core/limits.ts",
    "src/core/model.ts",
    "src/core/outcome.ts",
    "src/core/validate.ts",
    "src/core/validators.ts",
  ].map((path) => readText(path)).join("\n");
  for (const key of ["provider", "model", "binding", "bindings", "endpoint", "credentials"]) {
    assert.equal(look[key], undefined);
  }
  assert.doesNotMatch(source, /node:https|node:http|fetch\s*\(|XMLHttpRequest|WebSocket|axios|\.request\s*\(/);
  assert.doesNotMatch(source, /\bdispatch\s*\(/i);
});

test("CI is SHA-pinned, read-only, and limited to local quality gates", () => {
  const ci = readText(".github/workflows/ci.yml");

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
  assert.deepEqual([...ci.matchAll(/^      - run: (.+)$/gm)].map((match) => match[1]), [
    "npm ci --ignore-scripts",
    "npm run check",
  ]);
  assert.doesNotMatch(ci, /\b(?:cache|matrix|artifacts?|secrets?|deployments?|releases?|publish(?:ing)?|write)\b/i);
});

test("security policy keeps reports private, synthetic, and explicitly unsupported", () => {
  const security = readText("SECURITY.md");

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
