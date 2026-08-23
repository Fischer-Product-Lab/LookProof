import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();
const productionPaths = [
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
];
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

test("production source has no network, provider, credential, environment, or filesystem-write primitive", () => {
  const source = productionPaths.map((path) => read(path)).join("\n");
  assert.doesNotMatch(source, /node:(?:http|https|net|tls|dgram)|undici|axios|XMLHttpRequest|WebSocket|\bfetch\s*\(/);
  assert.doesNotMatch(source, /\bdispatch\s*\(|process\.env|\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|credentials?)\b/i);
  assert.doesNotMatch(
    source,
    /\b(?:writeFile|appendFile|createWriteStream|mkdir|rename|unlink|copyFile|cpSync|rmSync|rmdir)\w*\s*\(/,
  );
  assert.doesNotMatch(source, /\b(?:generate|upload|publish|providerCall)\s*\(/i);
});

test("MCP surface is stdio-only tools with no optional protocol features or error-marked policy results", () => {
  const lifecycle = read("src/mcp.ts");
  const server = read("src/mcp/server.ts");
  assert.match(lifecycle, /@modelcontextprotocol\/server\/stdio/);
  assert.doesNotMatch(lifecycle, /http|listen\s*\(|process\.env|process\.exitCode/);
  assert.match(server, /@modelcontextprotocol\/server/);
  assert.doesNotMatch(server, /@modelcontextprotocol\/(?:core|client)|registerResource|registerPrompt|completion|logging|sampling|elicitation|tasks?|isError/i);
  assert.equal((server.match(/registerTool\s*\(/g) ?? []).length, 4);
  assert.equal((server.match(/openWorldHint: false/g) ?? []).length, 1);
  assert.doesNotMatch(server, /process\.(?:argv|stdout|exit|exitCode)/);
  for (const path of productionPaths.filter((path) => path.startsWith("src/core/"))) {
    assert.doesNotMatch(read(path), /@modelcontextprotocol|process\.(?:argv|stdout|stderr|exit|exitCode)/, path);
  }
});

test("demo calls the shared core directly and compiled scripts contain no type stripping", () => {
  const demo = read("scripts/demo.ts");
  const pkg = JSON.parse(read("package.json"));
  assert.match(demo, /from "\.\.\/src\/core\/index\.js"/);
  assert.doesNotMatch(demo, /node:child_process|spawn|src\/cli/);
  assert.match(pkg.scripts.demo, /^npm run build && node dist\/scripts\/demo\.js$/);
  assert.match(pkg.scripts.test, /^npm run build && node --test[^\n]*dist\/tests\//);
  assert.doesNotMatch(JSON.stringify(pkg.scripts), /experimental-strip-types|tsx|ts-node/);
  assert.equal(pkg.private, true);
  assert.equal(pkg.scripts.publish, undefined);
});

test("README documents compiled CLI and contained MCP usage without claiming generation or publication", () => {
  const readme = read("README.md");
  for (const phrase of [
    "npm ci",
    "npm run build",
    "dist/src/cli.js",
    "dist/src/mcp.js --root",
    "validate_look",
    "compile_request",
    "check_image",
    "explain_refusal",
    "no environment variables",
    "does not generate images",
    "does not call a provider",
    "not a sandbox",
  ]) {
    assert.match(readme, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), phrase);
  }
  assert.match(
    readme,
    /^mcp_servers:\n  lookproof:\n    command: "node"\n    args:\n      - "C:\/absolute\/path\/to\/LookProof\/dist\/src\/mcp\.js"\n      - "--root"\n      - "C:\/absolute\/path\/to\/contained\/files"$/m,
  );
  assert.doesNotMatch(readme, /^\s*env:|mcpServers|npm publish|experimental-strip-types|zero-dependency|no package dependencies/im);
});

test("security docs state root containment and residual local TOCTOU without sandbox claims", () => {
  const threat = read("docs/threat-model.md");
  const limitations = read("docs/limitations.md");
  assert.match(threat, /canonical root/i);
  assert.match(threat, /symlink|junction/i);
  assert.match(threat, /TOCTOU/i);
  assert.match(threat, /not a sandbox/i);
  assert.match(limitations, /local-only MCP/i);
  assert.match(limitations, /TOCTOU/i);
  assert.match(limitations, /not a sandbox/i);
  assert.doesNotMatch(limitations, /zero-dependency/i);
});

test("public prose and runtime commands contain no em dash or obsolete source execution", () => {
  for (const path of ["README.md", "SECURITY.md", "docs/limitations.md", "docs/threat-model.md"]) {
    const content = read(path);
    assert.doesNotMatch(content, /\u2014/, path);
    assert.doesNotMatch(content, /experimental-strip-types/, path);
  }
  for (const path of ["Dockerfile", "docker-compose.yml", "compose.yml", "Procfile"]) {
    assert.equal(existsSync(resolve(repoRoot, path)), false, path);
  }
});

test("candidate-wide text contains no literal em dash", () => {
  const excludedDirectories = new Set([".git", "node_modules", "dist"]);
  const binaryFixtureExtensions = new Set([".gif", ".ico", ".jpeg", ".jpg", ".pdf", ".png", ".webp", ".zip"]);
  const emDashUtf8 = Buffer.from([0xe2, 0x80, 0x94]);
  const textPaths: string[] = [];

  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const candidatePath = relative(repoRoot, absolute).replaceAll("\\", "/");
      if (candidatePath.startsWith("fixtures/") && binaryFixtureExtensions.has(extname(entry.name).toLowerCase())) {
        continue;
      }
      textPaths.push(candidatePath);
      const bytes = readFileSync(absolute);
      assert.equal(bytes.indexOf(emDashUtf8), -1, candidatePath);
    }
  }

  visit(repoRoot);
  for (const requiredPrefix of ["src/", "tests/", ".github/workflows/", "docs/"]) {
    assert.ok(textPaths.some((path) => path.startsWith(requiredPrefix)), requiredPrefix);
  }
  for (const requiredPath of ["package.json", "package-lock.json", "tsconfig.json", "README.md"]) {
    assert.ok(textPaths.includes(requiredPath), requiredPath);
  }
});
