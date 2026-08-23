import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";


const repoRoot = process.cwd();

function readJson(path: string): any {
  return JSON.parse(readFileSync(resolve(repoRoot, path), "utf8"));
}

test("package is private v0.2 with exact runtime and development dependencies", () => {
  const pkg = readJson("package.json");
  assert.equal(pkg.name, "lookproof");
  assert.equal(pkg.version, "0.2.0");
  assert.equal(pkg.private, true);
  assert.deepEqual(pkg.bin, { lookproof: "dist/src/cli.js" });
  assert.deepEqual(pkg.dependencies, {
    "@modelcontextprotocol/server": "2.0.0",
    zod: "4.4.3",
  });
  assert.deepEqual(pkg.devDependencies, {
    "@types/node": "22.20.1",
    typescript: "7.0.2",
  });
  for (const name of ["build", "typecheck", "clean", "cli", "mcp", "check", "test", "demo"]) {
    assert.equal(typeof pkg.scripts[name], "string", name);
  }
  assert.match(pkg.scripts.test, /^npm run build && node --test --test-concurrency=1 dist\/tests\//);
  assert.match(pkg.scripts.demo, /^npm run build && node dist\/scripts\/demo\.js$/);
  assert.doesNotMatch(JSON.stringify(pkg.scripts), /experimental-strip-types/);
});

test("TypeScript emits strict NodeNext ES2023 JavaScript into ignored dist", () => {
  const tsconfig = readJson("tsconfig.json");
  assert.deepEqual(tsconfig.compilerOptions, {
    module: "NodeNext",
    moduleResolution: "NodeNext",
    target: "ES2023",
    strict: true,
    noUncheckedIndexedAccess: true,
    exactOptionalPropertyTypes: true,
    verbatimModuleSyntax: true,
    rootDir: ".",
    outDir: "dist",
    types: ["node"],
  });
  assert.deepEqual(tsconfig.exclude, ["dist", "node_modules"]);
  const gitignore = readFileSync(resolve(repoRoot, ".gitignore"), "utf8");
  assert.match(gitignore, /^dist\/$/m);
});

test("package lock records the exact direct dependency versions", () => {
  const lock = readJson("package-lock.json");
  const root = lock.packages[""];
  assert.equal(lock.lockfileVersion, 3);
  assert.equal(root.version, "0.2.0");
  assert.deepEqual(root.dependencies, {
    "@modelcontextprotocol/server": "2.0.0",
    zod: "4.4.3",
  });
  assert.deepEqual(root.devDependencies, {
    "@types/node": "22.20.1",
    typescript: "7.0.2",
  });
  assert.equal(lock.packages["node_modules/@modelcontextprotocol/server"].version, "2.0.0");
  assert.equal(lock.packages["node_modules/zod"].version, "4.4.3");
  assert.equal(lock.packages["node_modules/typescript"].version, "7.0.2");
  assert.equal(lock.packages["node_modules/@types/node"].version, "22.20.1");
});

test("CI keeps the test job and runs only clean install plus the local check", () => {
  const ci = readFileSync(resolve(repoRoot, ".github", "workflows", "ci.yml"), "utf8");
  assert.match(ci, /^name: CI$/m);
  const jobs = ci.slice(ci.indexOf("jobs:\n") + "jobs:\n".length);
  assert.deepEqual([...jobs.matchAll(/^  ([A-Za-z0-9_-]+):$/gm)].map((match) => match[1]), ["test"]);
  assert.deepEqual([...ci.matchAll(/^      - uses: (.+)$/gm)].map((match) => match[1]), [
    "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1",
    "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0",
  ]);
  assert.deepEqual([...ci.matchAll(/^      - run: (.+)$/gm)].map((match) => match[1]), [
    "npm ci --ignore-scripts",
    "npm run check",
  ]);
  assert.doesNotMatch(ci, /cache:|artifacts?|secrets?|publish/i);
});

test("Dependabot checks npm and pinned actions weekly without launch automation", () => {
  const dependabot = readFileSync(resolve(repoRoot, ".github", "dependabot.yml"), "utf8");
  assert.match(dependabot, /^version: 2$/m);
  assert.equal((dependabot.match(/package-ecosystem:/g) ?? []).length, 2);
  assert.match(dependabot, /package-ecosystem: "npm"[\s\S]*interval: "weekly"[\s\S]*versioning-strategy: increase/);
  assert.match(dependabot, /groups:[\s\S]*official-mcp:[\s\S]*"@modelcontextprotocol\/\*"/);
  assert.match(dependabot, /package-ecosystem: "github-actions"[\s\S]*interval: "weekly"/);
});
