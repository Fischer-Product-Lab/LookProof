import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { test } from "node:test";


const repoRoot = process.cwd();
const cliPath = resolve(repoRoot, "dist", "src", "cli.js");
const goldenPath = resolve(repoRoot, "tests", "golden", "v0.1-cli.json");
const sourceFixtureRoot = resolve(repoRoot, "fixtures", "synthetic");

type JsonRecord = Record<string, any>;

type Fixture = {
  root: string;
  lookPath: string;
  bindingPath: string;
  evidencePath: string;
  humanPath: string;
  imagePath: string;
  look: JsonRecord;
  binding: JsonRecord;
  evidence: JsonRecord;
  human: JsonRecord;
  writeLook(): void;
  writeBinding(): void;
  writeEvidence(): void;
  writeHuman(): void;
};

type GoldenCase = {
  name: string;
  gate: string;
  status: 0 | 1 | 2;
  args(fixture: Fixture): string[];
  prepare?(fixture: Fixture): void;
};

type GoldenResult = {
  name: string;
  status: number | null;
  stdout: string;
  stderr: string;
};

function readJson(path: string): JsonRecord {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function fixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "lookproof-v01-golden-"));
  const keepers = join(root, "keepers");
  const receipts = join(root, "receipts");
  mkdirSync(keepers);
  mkdirSync(receipts);

  const result: Fixture = {
    root,
    lookPath: join(root, "look.json"),
    bindingPath: join(root, "binding.json"),
    evidencePath: join(receipts, "evidence.json"),
    humanPath: join(receipts, "human.json"),
    imagePath: join(keepers, "reference.png"),
    look: readJson(join(sourceFixtureRoot, "look.json")),
    binding: readJson(join(sourceFixtureRoot, "binding.json")),
    evidence: readJson(join(sourceFixtureRoot, "receipts", "evidence.json")),
    human: readJson(join(sourceFixtureRoot, "receipts", "human-review.json")),
    writeLook() {
      writeJson(this.lookPath, this.look);
    },
    writeBinding() {
      writeJson(this.bindingPath, this.binding);
    },
    writeEvidence() {
      writeJson(this.evidencePath, this.evidence);
    },
    writeHuman() {
      writeJson(this.humanPath, this.human);
    },
  };
  copyFileSync(join(sourceFixtureRoot, "keepers", "reference.png"), result.imagePath);
  result.writeLook();
  result.writeBinding();
  result.writeEvidence();
  result.writeHuman();
  return result;
}

function preflight(
  value: Fixture,
  options: {
    look?: string;
    binding?: string;
    intent?: string;
    prompt?: string;
    room?: string;
    evidence?: string | false;
    human?: string | false;
  } = {},
): string[] {
  const args = [
    "preflight",
    "--look",
    options.look ?? value.lookPath,
    "--binding",
    options.binding ?? value.bindingPath,
  ];
  if (options.intent !== "") args.push("--intent", options.intent ?? "pass-tile");
  if (options.prompt !== undefined) {
    if (options.prompt !== "") args.push("--prompt", options.prompt);
  } else {
    args.push("--prompt", "Render the declared synthetic geometry.");
  }
  if (options.room !== undefined) args.push("--room", options.room);
  if (options.evidence !== false) args.push("--evidence-receipt", options.evidence ?? value.evidencePath);
  if (options.human !== false) args.push("--human-review-receipt", options.human ?? value.humanPath);
  return args;
}

function check(value: Fixture, intent = "pass-tile", image: string | false = value.imagePath): string[] {
  const args = ["check", "--look", value.lookPath, "--intent", intent];
  if (image !== false) args.push("--image", image);
  return args;
}

function pngWithDimensions(source: string, width: number, height: number): Buffer {
  const bytes = Buffer.from(readFileSync(source));
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

const cases: GoldenCase[] = [
  { name: "no-command", gate: "arguments-invalid", status: 2, args: () => [] },
  { name: "unknown-command", gate: "arguments-invalid", status: 2, args: () => ["unknown"] },
  {
    name: "option-pair-required",
    gate: "arguments-invalid",
    status: 2,
    args: (f) => ["preflight", "--look", f.lookPath, "--binding"],
  },
  {
    name: "unknown-option",
    gate: "arguments-invalid",
    status: 2,
    args: (f) => ["check", "--look", f.lookPath, "--mystery", "value"],
  },
  {
    name: "duplicate-option",
    gate: "arguments-invalid",
    status: 2,
    args: (f) => ["check", "--look", f.lookPath, "--look", f.lookPath],
  },
  { name: "missing-look-precedes-binding", gate: "arguments-invalid", status: 2, args: () => ["preflight"] },
  {
    name: "missing-binding",
    gate: "arguments-invalid",
    status: 2,
    args: (f) => ["preflight", "--look", f.lookPath],
  },
  {
    name: "look-malformed",
    gate: "look-unreadable",
    status: 2,
    prepare: (f) => writeFileSync(f.lookPath, "{"),
    args: (f) => preflight(f),
  },
  {
    name: "look-non-object",
    gate: "look-unreadable",
    status: 2,
    prepare: (f) => writeJson(f.lookPath, []),
    args: (f) => preflight(f),
  },
  {
    name: "look-schema-precedes-binding",
    gate: "schema-invalid",
    status: 1,
    prepare: (f) => {
      f.look.grammar.palette = ["blue"];
      f.writeLook();
    },
    args: (f) => preflight(f, { binding: join(f.root, "missing-binding.json") }),
  },
  {
    name: "invalid-room",
    gate: "arguments-invalid",
    status: 2,
    args: (f) => preflight(f, { room: "staging" }),
  },
  {
    name: "intent-missing",
    gate: "intent-missing",
    status: 1,
    args: (f) => preflight(f, { intent: "" }),
  },
  {
    name: "intent-unknown",
    gate: "intent-unknown",
    status: 1,
    args: (f) => preflight(f, { intent: "unknown" }),
  },
  {
    name: "lock-missing",
    gate: "lock-missing",
    status: 1,
    prepare: (f) => {
      delete f.look.locks.shape;
      f.writeLook();
    },
    args: (f) => preflight(f),
  },
  {
    name: "reference-set-missing",
    gate: "reference-set-missing",
    status: 1,
    prepare: (f) => {
      delete f.look.references.sets.primary;
      f.writeLook();
    },
    args: (f) => preflight(f),
  },
  {
    name: "reference-conflict-precedes-readiness-and-determinism",
    gate: "reference-conflict",
    status: 1,
    prepare: (f) => {
      f.look.references.sets.primary.files[0].path = "keepers/missing.png";
      f.look.references.sets.primary.files[0].conflictsWithLocks = ["shape"];
      f.look.locks.shape.enforcement = "deterministicOnly";
      f.writeLook();
    },
    args: (f) => preflight(f, { binding: join(f.root, "missing-binding.json") }),
  },
  {
    name: "deterministic-only-precedes-binding",
    gate: "deterministic-only-lock",
    status: 1,
    prepare: (f) => {
      f.look.locks.shape.enforcement = "deterministicOnly";
      f.look.locks.shape.evidenceRequired = false;
      f.writeLook();
    },
    args: (f) => preflight(f, { binding: join(f.root, "missing-binding.json") }),
  },
  {
    name: "binding-malformed",
    gate: "binding-unreadable",
    status: 2,
    prepare: (f) => writeFileSync(f.bindingPath, "{"),
    args: (f) => preflight(f),
  },
  {
    name: "binding-non-object",
    gate: "binding-unreadable",
    status: 2,
    prepare: (f) => writeJson(f.bindingPath, []),
    args: (f) => preflight(f),
  },
  {
    name: "binding-schema-precedes-prompt-policy",
    gate: "schema-invalid",
    status: 1,
    prepare: (f) => {
      f.binding.limits.maxReferences = -1;
      f.writeBinding();
    },
    args: (f) => preflight(f, { prompt: "Add a watermark." }),
  },
  {
    name: "prompt-missing",
    gate: "arguments-invalid",
    status: 2,
    args: (f) => preflight(f, { prompt: "" }),
  },
  {
    name: "prompt-never-precedes-reference-readiness",
    gate: "prompt-never",
    status: 1,
    prepare: (f) => {
      f.look.references.sets.primary.files[0].path = "keepers/missing.png";
      f.writeLook();
    },
    args: (f) => preflight(f, { prompt: "Add a watermark." }),
  },
  {
    name: "invented-chrome",
    gate: "invented-chrome",
    status: 1,
    args: (f) => preflight(f, { prompt: "Add a HUD around the tile." }),
  },
  {
    name: "references-required",
    gate: "references-required",
    status: 1,
    prepare: (f) => {
      f.look.references.sets.primary.files = [];
      f.writeLook();
    },
    args: (f) => preflight(f),
  },
  {
    name: "reference-limit-precedes-path-readiness",
    gate: "references-over-limit",
    status: 1,
    prepare: (f) => {
      f.binding.limits.maxReferences = 0;
      f.look.references.sets.primary.files[0].path = "keepers/missing.png";
      f.writeBinding();
      f.writeLook();
    },
    args: (f) => preflight(f),
  },
  {
    name: "configured-reference-root-absolute",
    gate: "reference-path-invalid",
    status: 1,
    prepare: (f) => {
      f.look.paths.references = isAbsolute(f.root) ? f.root : resolve(f.root);
      f.writeLook();
    },
    args: (f) => preflight(f),
  },
  {
    name: "configured-reference-root-traversal",
    gate: "reference-path-invalid",
    status: 1,
    prepare: (f) => {
      f.look.paths.references = "../outside";
      f.writeLook();
    },
    args: (f) => preflight(f),
  },
  {
    name: "reference-path-absolute",
    gate: "reference-path-invalid",
    status: 1,
    prepare: (f) => {
      f.look.references.sets.primary.files[0].path = f.imagePath;
      f.writeLook();
    },
    args: (f) => preflight(f),
  },
  {
    name: "reference-path-missing",
    gate: "reference-path-invalid",
    status: 1,
    prepare: (f) => {
      f.look.references.sets.primary.files[0].path = "keepers/missing.png";
      f.writeLook();
    },
    args: (f) => preflight(f),
  },
  {
    name: "reference-non-file",
    gate: "reference-unreadable",
    status: 1,
    prepare: (f) => {
      f.look.references.sets.primary.files[0].path = "keepers";
      f.writeLook();
    },
    args: (f) => preflight(f),
  },
  {
    name: "reference-hash-precedes-receipts",
    gate: "reference-hash-mismatch",
    status: 1,
    prepare: (f) => {
      f.look.references.sets.primary.files[0].sha256 = "0".repeat(64);
      f.writeLook();
      writeFileSync(f.evidencePath, "{");
    },
    args: (f) => preflight(f),
  },
  {
    name: "evidence-receipt-malformed-precedes-human",
    gate: "evidence-receipt-unreadable",
    status: 2,
    prepare: (f) => {
      writeFileSync(f.evidencePath, "{");
      writeFileSync(f.humanPath, "{");
    },
    args: (f) => preflight(f),
  },
  {
    name: "evidence-receipt-schema",
    gate: "schema-invalid",
    status: 1,
    prepare: (f) => writeJson(f.evidencePath, []),
    args: (f) => preflight(f),
  },
  {
    name: "human-receipt-malformed",
    gate: "human-review-receipt-unreadable",
    status: 2,
    prepare: (f) => writeFileSync(f.humanPath, "{"),
    args: (f) => preflight(f),
  },
  {
    name: "human-receipt-schema",
    gate: "schema-invalid",
    status: 1,
    prepare: (f) => writeJson(f.humanPath, []),
    args: (f) => preflight(f),
  },
  {
    name: "evidence-missing-precedes-human-review",
    gate: "lock-evidence-missing",
    status: 1,
    args: (f) => preflight(f, { evidence: false, human: false }),
  },
  {
    name: "human-review-missing",
    gate: "human-review-receipt-missing",
    status: 1,
    args: (f) => preflight(f, { human: false }),
  },
  { name: "preflight-pass", gate: "pass", status: 0, args: (f) => preflight(f) },
  {
    name: "preflight-default-explore-pass",
    gate: "pass",
    status: 0,
    prepare: (f) => {
      f.look.defaultRoom = "explore";
      f.writeLook();
    },
    args: (f) => preflight(f),
  },
  {
    name: "check-unknown-intent-precedes-image",
    gate: "intent-unknown",
    status: 1,
    args: (f) => check(f, "unknown", false),
  },
  { name: "check-image-option-missing", gate: "arguments-invalid", status: 2, args: (f) => check(f, "pass-tile", false) },
  {
    name: "image-unreadable",
    gate: "image-unreadable",
    status: 1,
    args: (f) => check(f, "pass-tile", join(f.root, "missing.png")),
  },
  {
    name: "image-not-png",
    gate: "image-not-png",
    status: 1,
    prepare: (f) => writeFileSync(f.imagePath, "not png"),
    args: (f) => check(f),
  },
  {
    name: "png-zero-dimension",
    gate: "image-not-png",
    status: 1,
    prepare: (f) => writeFileSync(f.imagePath, pngWithDimensions(f.imagePath, 0, 1)),
    args: (f) => check(f),
  },
  {
    name: "png-width-precedes-aspect",
    gate: "format-width",
    status: 1,
    prepare: (f) => {
      f.look.intents["pass-tile"].minWidth = 2;
      f.look.intents["pass-tile"].aspectRatio = { width: 2, height: 1, tolerance: 0 };
      f.writeLook();
    },
    args: (f) => check(f),
  },
  {
    name: "png-aspect",
    gate: "format-aspect",
    status: 1,
    prepare: (f) => {
      f.look.intents["pass-tile"].aspectRatio = { width: 2, height: 1, tolerance: 0 };
      f.writeLook();
    },
    args: (f) => check(f),
  },
  { name: "check-pass", gate: "pass", status: 0, args: (f) => check(f) },
];

function executeGoldenCases(): GoldenResult[] {
  return cases.map((entry) => {
    const value = fixture();
    try {
      entry.prepare?.(value);
      const result = spawnSync(process.execPath, [cliPath, ...entry.args(value)], {
        cwd: repoRoot,
        encoding: "utf8",
      });
      assert.equal(result.error, undefined, entry.name);
      assert.equal(result.status, entry.status, `${entry.name}: ${result.stderr || result.stdout}`);
      assert.equal(result.stderr, "", entry.name);
      assert.ok(result.stdout.endsWith("\n"), entry.name);
      assert.equal(result.stdout.endsWith("\n\n"), false, entry.name);
      const verdict = JSON.parse(result.stdout);
      assert.equal(verdict.gate, entry.gate, entry.name);
      assert.equal(verdict.dispatched, false, entry.name);
      return { name: entry.name, status: result.status, stdout: result.stdout, stderr: result.stderr };
    } finally {
      rmSync(value.root, { recursive: true, force: true });
    }
  });
}

test("v0.1 CLI golden corpus preserves exact bytes and gate precedence", () => {
  const actual = executeGoldenCases();
  if (process.env.UPDATE_LOOKPROOF_GOLDEN === "1") {
    mkdirSync(resolve(repoRoot, "tests", "golden"), { recursive: true });
    writeFileSync(goldenPath, `${JSON.stringify(actual, null, 2)}\n`);
  }
  assert.deepEqual(actual, JSON.parse(readFileSync(goldenPath, "utf8")));
  assert.equal(cases.length, 47);
  assert.deepEqual(
    new Set(cases.map((entry) => entry.gate)),
    new Set([
      "arguments-invalid",
      "look-unreadable",
      "schema-invalid",
      "intent-missing",
      "intent-unknown",
      "lock-missing",
      "reference-set-missing",
      "reference-conflict",
      "deterministic-only-lock",
      "binding-unreadable",
      "prompt-never",
      "invented-chrome",
      "references-required",
      "references-over-limit",
      "reference-path-invalid",
      "reference-unreadable",
      "reference-hash-mismatch",
      "evidence-receipt-unreadable",
      "human-review-receipt-unreadable",
      "lock-evidence-missing",
      "human-review-receipt-missing",
      "image-unreadable",
      "image-not-png",
      "format-width",
      "format-aspect",
      "pass",
    ]),
  );
});
