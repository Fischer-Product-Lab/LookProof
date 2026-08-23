import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";


const repoRoot = process.cwd();
const cliPath = resolve(repoRoot, "dist", "src", "cli.js");

function runCli(args: string[]) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

test("preflight requires an explicit binding beside the look", () => {
  const result = runCli(["preflight", "--look", "look.json"]);

  assert.equal(result.status, 2);
  const verdict = JSON.parse(result.stdout);
  assert.equal(verdict.status, "fail");
  assert.equal(verdict.gate, "arguments-invalid");
  assert.match(verdict.detail, /--binding/);
  assert.equal(verdict.dispatched, false);
});

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), "lookproof-"));
  const keepers = join(root, "keepers");
  mkdirSync(keepers);
  const referencePath = join(keepers, "reference.png");
  writeFileSync(referencePath, png);
  const referenceHash = sha256(png);

  const look: any = {
    schemaVersion: "1.0.0",
    identity: { id: "synthetic-look", name: "Synthetic Geometry" },
    defaultRoom: "locked",
    grammar: {
      silhouette: "one centered square",
      costume: "not applicable",
      face: "not applicable",
      era: "timeless",
      palette: ["#112233", "#DDEEFF"],
    },
    nevers: {
      categories: ["format-intent"],
      promptNever: ["watermark"],
      forbidUiChromeForKinds: ["synthetic-tile"],
    },
    locks: {
      shape: {
        description: "Keep a single centered square.",
        enforcement: "humanReviewRequired",
        evidenceRequired: true,
        mustShow: ["one centered blue square"],
        reviewRule: "Confirm the clause is visible in the compiled request.",
      },
    },
    intents: {
      tile: {
        kind: "synthetic-tile",
        aspectRatio: { width: 1, height: 1, tolerance: 0 },
        minWidth: 1,
        referenceSet: "primary",
        requiredLocks: ["shape"],
      },
    },
    references: {
      sets: {
        primary: {
          description: "Synthetic reference set.",
          files: [
            {
              id: "reference-square",
              path: "keepers/reference.png",
              sha256: referenceHash,
              scopes: ["shape"],
              status: "AUTHORITY",
              source: "synthetic test fixture",
              permittedUse: ["tests", "documentation"],
              knownLimits: ["mechanical fixture only"],
              supportsLocks: ["shape"],
            },
          ],
        },
      },
    },
    paths: { references: "keepers" },
  };
  const binding: any = {
    schemaVersion: "1.0.0",
    id: "example-binding",
    provider: "Example Provider",
    model: "example-model",
    limits: { maxReferences: 2, requireReferences: true },
  };
  const evidenceReceipt = {
    schemaVersion: "1.0.0",
    receiptId: "evidence-example",
    kind: "reference-evidence",
    lockId: "shape",
    referenceId: "reference-square",
    referenceSha256: referenceHash,
    recordedAt: "2000-01-01T00:00:00Z",
    statement: "The synthetic reference is declared as evidence for the shape lock.",
  };
  const humanReviewReceipt = {
    schemaVersion: "1.0.0",
    receiptId: "review-example",
    kind: "human-review",
    lookId: "synthetic-look",
    intentId: "tile",
    scope: "request-policy",
    decision: "pass",
    reviewedAt: "2000-01-01T00:00:00Z",
    reviewer: "Example Reviewer",
    findings: [
      {
        lockId: "shape",
        clause: "one centered blue square",
        observed: true,
        note: "The clause is present in the frozen prompt prefix.",
      },
    ],
  };

  const paths = {
    root,
    look: join(root, "look.json"),
    binding: join(root, "binding.json"),
    evidenceReceipt: join(root, "evidence-receipt.json"),
    humanReviewReceipt: join(root, "human-review-receipt.json"),
    image: referencePath,
  };
  writeJson(paths.look, look);
  writeJson(paths.binding, binding);
  writeJson(paths.evidenceReceipt, evidenceReceipt);
  writeJson(paths.humanReviewReceipt, humanReviewReceipt);
  return { paths, look, binding, evidenceReceipt, humanReviewReceipt };
}

test("preflight uses the Look default when --room is absent", (t) => {
  const fixture = makeFixture();
  t.after(() => rmSync(fixture.paths.root, { recursive: true, force: true }));
  fixture.look.defaultRoom = "explore";
  writeJson(fixture.paths.look, fixture.look);

  const result = runCli([
    "preflight",
    "--look",
    fixture.paths.look,
    "--binding",
    fixture.paths.binding,
    "--intent",
    "tile",
    "--prompt",
    "Render the declared synthetic geometry.",
    "--evidence-receipt",
    fixture.paths.evidenceReceipt,
    "--human-review-receipt",
    fixture.paths.humanReviewReceipt,
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const verdict = JSON.parse(result.stdout);
  assert.equal(verdict.room, "explore");
  assert.equal(verdict.compiledRequest.room, "explore");
  assert.equal(verdict.dispatched, false);
});

test("preflight rejects an explicit invalid --room value", (t) => {
  const fixture = makeFixture();
  t.after(() => rmSync(fixture.paths.root, { recursive: true, force: true }));

  const result = runCli([
    "preflight",
    "--look",
    fixture.paths.look,
    "--binding",
    fixture.paths.binding,
    "--intent",
    "tile",
    "--prompt",
    "Render the declared synthetic geometry.",
    "--room",
    "staging",
    "--evidence-receipt",
    fixture.paths.evidenceReceipt,
    "--human-review-receipt",
    fixture.paths.humanReviewReceipt,
  ]);

  assert.equal(result.status, 2);
  const verdict = JSON.parse(result.stdout);
  assert.equal(verdict.gate, "arguments-invalid");
  assert.match(verdict.detail, /--room.*explore.*locked/i);
  assert.equal(verdict.compiledRequest, null);
  assert.equal(verdict.dispatched, false);
});

test("locked preflight compiles must-show policy and carries receipts without dispatch", (t) => {
  const fixture = makeFixture();
  t.after(() => rmSync(fixture.paths.root, { recursive: true, force: true }));

  const result = runCli([
    "preflight",
    "--look",
    fixture.paths.look,
    "--binding",
    fixture.paths.binding,
    "--intent",
    "tile",
    "--prompt",
    "Render the declared synthetic geometry.",
    "--evidence-receipt",
    fixture.paths.evidenceReceipt,
    "--human-review-receipt",
    fixture.paths.humanReviewReceipt,
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const verdict = JSON.parse(result.stdout);
  assert.equal(verdict.status, "pass");
  assert.equal(verdict.gate, "pass");
  assert.equal(verdict.dispatched, false);
  assert.equal(verdict.compiledRequest.references[0].path, "keepers/reference.png");
  assert.deepEqual(verdict.compiledRequest.policy.requiredLocks[0].mustShow, [
    "one centered blue square",
  ]);
  assert.equal(verdict.compiledRequest.policy.requiredLocks[0].humanReviewRequired, true);
  assert.equal(verdict.compiledRequest.policy.requiredLocks[0].humanReviewReceiptPresent, true);
  assert.match(verdict.compiledRequest.frozenPromptPrefix, /^LOOK: synthetic-look \| Synthetic Geometry$/m);
  assert.doesNotMatch(verdict.compiledRequest.frozenPromptPrefix, /\u2014/);
  assert.match(verdict.compiledRequest.frozenPromptPrefix, /MUST SHOW \[shape\]: one centered blue square/);
  assert.equal(verdict.compiledRequest.receipts.humanReview.receiptId, "review-example");
  assert.equal(verdict.compiledRequest.receipts.evidence[0].receiptId, "evidence-example");
  assert.match(verdict.compiledRequest.look.sha256, /^[a-f0-9]{64}$/);
  assert.match(verdict.compiledRequest.binding.sha256, /^[a-f0-9]{64}$/);
  assert.match(verdict.compiledRequest.requestSha256, /^[a-f0-9]{64}$/);

  const { requestSha256, ...withoutHash } = verdict.compiledRequest;
  assert.equal(requestSha256, sha256(canonicalJson(withoutHash)));
});

test("preflight refuses a selected reference that conflicts with a required lock", (t) => {
  const fixture = makeFixture();
  t.after(() => rmSync(fixture.paths.root, { recursive: true, force: true }));
  fixture.look.references.sets.primary.files[0].conflictsWithLocks = ["shape"];
  writeJson(fixture.paths.look, fixture.look);

  const result = runCli([
    "preflight",
    "--look",
    fixture.paths.look,
    "--binding",
    fixture.paths.binding,
    "--intent",
    "tile",
    "--prompt",
    "Render the declared synthetic geometry.",
    "--evidence-receipt",
    fixture.paths.evidenceReceipt,
    "--human-review-receipt",
    fixture.paths.humanReviewReceipt,
  ]);

  assert.equal(result.status, 1);
  const verdict = JSON.parse(result.stdout);
  assert.equal(verdict.gate, "reference-conflict");
  assert.equal(verdict.compiledRequest, null);
  assert.equal(verdict.dispatched, false);
});

test("declared reference conflict precedes missing reference-file readiness", (t) => {
  const fixture = makeFixture();
  t.after(() => rmSync(fixture.paths.root, { recursive: true, force: true }));
  fixture.look.references.sets.primary.files[0].path = "keepers/missing.png";
  fixture.look.references.sets.primary.files[0].conflictsWithLocks = ["shape"];
  writeJson(fixture.paths.look, fixture.look);

  const result = runCli([
    "preflight",
    "--look",
    fixture.paths.look,
    "--binding",
    fixture.paths.binding,
    "--intent",
    "tile",
    "--prompt",
    "Render the declared synthetic geometry.",
    "--evidence-receipt",
    fixture.paths.evidenceReceipt,
    "--human-review-receipt",
    fixture.paths.humanReviewReceipt,
  ]);

  assert.equal(result.status, 1);
  const verdict = JSON.parse(result.stdout);
  assert.equal(verdict.gate, "reference-conflict");
  assert.match(verdict.detail, /reference-square.*shape/);
  assert.equal(verdict.compiledRequest, null);
  assert.equal(verdict.dispatched, false);
});

test("preflight refuses deterministic-only locks instead of compiling a generative request", (t) => {
  const fixture = makeFixture();
  t.after(() => rmSync(fixture.paths.root, { recursive: true, force: true }));
  fixture.look.locks.shape.enforcement = "deterministicOnly";
  fixture.look.locks.shape.evidenceRequired = false;
  writeJson(fixture.paths.look, fixture.look);

  const result = runCli([
    "preflight",
    "--look",
    fixture.paths.look,
    "--binding",
    fixture.paths.binding,
    "--intent",
    "tile",
    "--prompt",
    "Render the declared synthetic geometry.",
  ]);

  assert.equal(result.status, 1);
  const verdict = JSON.parse(result.stdout);
  assert.equal(verdict.gate, "deterministic-only-lock");
  assert.match(verdict.detail, /shape/);
  assert.equal(verdict.compiledRequest, null);
  assert.equal(verdict.dispatched, false);
});

test("deterministic-only refusal precedes reading explicitly supplied binding bytes", (t) => {
  const fixture = makeFixture();
  t.after(() => rmSync(fixture.paths.root, { recursive: true, force: true }));
  fixture.look.locks.shape.enforcement = "deterministicOnly";
  fixture.look.locks.shape.evidenceRequired = false;
  writeJson(fixture.paths.look, fixture.look);

  const result = runCli([
    "preflight",
    "--look",
    fixture.paths.look,
    "--binding",
    join(fixture.paths.root, "missing-binding.json"),
    "--intent",
    "tile",
    "--prompt",
    "Render the declared synthetic geometry.",
  ]);

  assert.equal(result.status, 1);
  const verdict = JSON.parse(result.stdout);
  assert.equal(verdict.gate, "deterministic-only-lock");
  assert.match(verdict.detail, /shape/);
  assert.equal(verdict.compiledRequest, null);
  assert.equal(verdict.dispatched, false);
});

test("locked preflight requires declared evidence for evidence-required locks", (t) => {
  const fixture = makeFixture();
  t.after(() => rmSync(fixture.paths.root, { recursive: true, force: true }));

  const result = runCli([
    "preflight",
    "--look",
    fixture.paths.look,
    "--binding",
    fixture.paths.binding,
    "--intent",
    "tile",
    "--prompt",
    "Render the declared synthetic geometry.",
    "--human-review-receipt",
    fixture.paths.humanReviewReceipt,
  ]);

  assert.equal(result.status, 1);
  const verdict = JSON.parse(result.stdout);
  assert.equal(verdict.gate, "lock-evidence-missing");
  assert.match(verdict.detail, /shape/);
  assert.equal(verdict.dispatched, false);
});

test("evidence receipts obey their closed published runtime schema", (t) => {
  const fixture = makeFixture();
  t.after(() => rmSync(fixture.paths.root, { recursive: true, force: true }));

  const mutations: Array<[string, (receipt: any) => void]> = [
    ...[
      "schemaVersion",
      "receiptId",
      "kind",
      "lockId",
      "referenceId",
      "referenceSha256",
      "recordedAt",
      "statement",
    ].map((field) => [`missing ${field}`, (receipt: any) => delete receipt[field]] as [string, (receipt: any) => void]),
    ["wrong schemaVersion constant", (receipt) => (receipt.schemaVersion = "2.0.0")],
    ["blank receiptId", (receipt) => (receipt.receiptId = " \t")],
    ["wrong kind constant", (receipt) => (receipt.kind = "human-review")],
    ["non-string lockId", (receipt) => (receipt.lockId = 7)],
    ["blank referenceId", (receipt) => (receipt.referenceId = " ")],
    ["non-lowercase SHA-256", (receipt) => (receipt.referenceSha256 = "A".repeat(64))],
    ["invalid timestamp", (receipt) => (receipt.recordedAt = "2000-02-30T00:00:00Z")],
    ["blank statement", (receipt) => (receipt.statement = "\n")],
    ["extra top-level property", (receipt) => (receipt.extra = true)],
  ];

  for (const [name, mutate] of mutations) {
    const receipt = structuredClone(fixture.evidenceReceipt);
    mutate(receipt);
    writeJson(fixture.paths.evidenceReceipt, receipt);
    const result = runCli([
      "preflight",
      "--look",
      fixture.paths.look,
      "--binding",
      fixture.paths.binding,
      "--intent",
      "tile",
      "--prompt",
      "Render the declared synthetic geometry.",
      "--evidence-receipt",
      fixture.paths.evidenceReceipt,
      "--human-review-receipt",
      fixture.paths.humanReviewReceipt,
    ]);

    assert.equal(result.status, 1, `${name}: ${result.stderr || result.stdout}`);
    const verdict = JSON.parse(result.stdout);
    assert.equal(verdict.gate, "schema-invalid", `${name}: ${result.stdout}`);
    assert.match(verdict.detail, /evidence receipt/i, name);
    assert.equal(verdict.compiledRequest, null, name);
    assert.equal(verdict.dispatched, false, name);
  }
});

test("a parsed non-object evidence receipt fails the receipt schema", (t) => {
  const fixture = makeFixture();
  t.after(() => rmSync(fixture.paths.root, { recursive: true, force: true }));
  writeJson(fixture.paths.evidenceReceipt, []);

  const result = runCli([
    "preflight",
    "--look",
    fixture.paths.look,
    "--binding",
    fixture.paths.binding,
    "--intent",
    "tile",
    "--prompt",
    "Render the declared synthetic geometry.",
    "--evidence-receipt",
    fixture.paths.evidenceReceipt,
    "--human-review-receipt",
    fixture.paths.humanReviewReceipt,
  ]);

  assert.equal(result.status, 1);
  const verdict = JSON.parse(result.stdout);
  assert.equal(verdict.gate, "schema-invalid");
  assert.match(verdict.detail, /evidence receipt/i);
  assert.equal(verdict.compiledRequest, null);
  assert.equal(verdict.dispatched, false);
});

test("a parsed non-object human-review receipt fails the receipt schema", (t) => {
  const fixture = makeFixture();
  t.after(() => rmSync(fixture.paths.root, { recursive: true, force: true }));
  writeJson(fixture.paths.humanReviewReceipt, []);

  const result = runCli([
    "preflight",
    "--look",
    fixture.paths.look,
    "--binding",
    fixture.paths.binding,
    "--intent",
    "tile",
    "--prompt",
    "Render the declared synthetic geometry.",
    "--evidence-receipt",
    fixture.paths.evidenceReceipt,
    "--human-review-receipt",
    fixture.paths.humanReviewReceipt,
  ]);

  assert.equal(result.status, 1);
  const verdict = JSON.parse(result.stdout);
  assert.equal(verdict.gate, "schema-invalid");
  assert.match(verdict.detail, /human-review receipt/i);
  assert.equal(verdict.compiledRequest, null);
  assert.equal(verdict.dispatched, false);
});

test("human-review receipts and findings obey their closed published runtime schema", (t) => {
  const fixture = makeFixture();
  t.after(() => rmSync(fixture.paths.root, { recursive: true, force: true }));

  const mutations: Array<[string, (receipt: any) => void]> = [
    ...[
      "schemaVersion",
      "receiptId",
      "kind",
      "lookId",
      "intentId",
      "scope",
      "decision",
      "reviewedAt",
      "reviewer",
      "findings",
    ].map((field) => [`missing ${field}`, (receipt: any) => delete receipt[field]] as [string, (receipt: any) => void]),
    ["wrong schemaVersion constant", (receipt) => (receipt.schemaVersion = "2.0.0")],
    ["blank receiptId", (receipt) => (receipt.receiptId = " \t")],
    ["wrong kind constant", (receipt) => (receipt.kind = "reference-evidence")],
    ["blank lookId", (receipt) => (receipt.lookId = " ")],
    ["non-string intentId", (receipt) => (receipt.intentId = 7)],
    ["wrong scope constant", (receipt) => (receipt.scope = "generated-image")],
    ["invalid decision enum", (receipt) => (receipt.decision = "review")],
    ["invalid timestamp", (receipt) => (receipt.reviewedAt = "2000-02-30T00:00:00Z")],
    ["blank reviewer", (receipt) => (receipt.reviewer = "\n")],
    ["non-array findings", (receipt) => (receipt.findings = {})],
    ["extra top-level property", (receipt) => (receipt.extra = true)],
    ...["lockId", "clause", "observed", "note"].map(
      (field) =>
        [`finding missing ${field}`, (receipt: any) => delete receipt.findings[0][field]] as [
          string,
          (receipt: any) => void,
        ],
    ),
    ["blank finding lockId", (receipt) => (receipt.findings[0].lockId = " ")],
    ["non-string finding clause", (receipt) => (receipt.findings[0].clause = 7)],
    ["non-boolean finding observed", (receipt) => (receipt.findings[0].observed = "true")],
    ["non-string finding note", (receipt) => (receipt.findings[0].note = null)],
    ["extra nested finding property", (receipt) => (receipt.findings[0].extra = true)],
  ];

  for (const [name, mutate] of mutations) {
    const receipt = structuredClone(fixture.humanReviewReceipt);
    mutate(receipt);
    writeJson(fixture.paths.humanReviewReceipt, receipt);
    const result = runCli([
      "preflight",
      "--look",
      fixture.paths.look,
      "--binding",
      fixture.paths.binding,
      "--intent",
      "tile",
      "--prompt",
      "Render the declared synthetic geometry.",
      "--evidence-receipt",
      fixture.paths.evidenceReceipt,
      "--human-review-receipt",
      fixture.paths.humanReviewReceipt,
    ]);

    assert.equal(result.status, 1, `${name}: ${result.stderr || result.stdout}`);
    const verdict = JSON.parse(result.stdout);
    assert.equal(verdict.gate, "schema-invalid", `${name}: ${result.stdout}`);
    assert.match(verdict.detail, /human-review receipt/i, name);
    assert.equal(verdict.compiledRequest, null, name);
    assert.equal(verdict.dispatched, false, name);
  }
});

test("locked preflight requires a matching receipt for human-review locks", (t) => {
  const fixture = makeFixture();
  t.after(() => rmSync(fixture.paths.root, { recursive: true, force: true }));

  const result = runCli([
    "preflight",
    "--look",
    fixture.paths.look,
    "--binding",
    fixture.paths.binding,
    "--intent",
    "tile",
    "--prompt",
    "Render the declared synthetic geometry.",
    "--evidence-receipt",
    fixture.paths.evidenceReceipt,
  ]);

  assert.equal(result.status, 1);
  const verdict = JSON.parse(result.stdout);
  assert.equal(verdict.gate, "human-review-receipt-missing");
  assert.match(verdict.detail, /shape/);
  assert.equal(verdict.dispatched, false);
});

test("preflight refuses a reference whose bytes do not match the declared hash", (t) => {
  const fixture = makeFixture();
  t.after(() => rmSync(fixture.paths.root, { recursive: true, force: true }));
  fixture.look.references.sets.primary.files[0].sha256 = "0".repeat(64);
  writeJson(fixture.paths.look, fixture.look);

  const result = runCli([
    "preflight",
    "--look",
    fixture.paths.look,
    "--binding",
    fixture.paths.binding,
    "--intent",
    "tile",
    "--prompt",
    "Render the declared synthetic geometry.",
    "--evidence-receipt",
    fixture.paths.evidenceReceipt,
    "--human-review-receipt",
    fixture.paths.humanReviewReceipt,
  ]);

  assert.equal(result.status, 1);
  const verdict = JSON.parse(result.stdout);
  assert.equal(verdict.gate, "reference-hash-mismatch");
  assert.equal(verdict.dispatched, false);
});

test("preflight refuses references outside the declared references folder", (t) => {
  const fixture = makeFixture();
  t.after(() => rmSync(fixture.paths.root, { recursive: true, force: true }));
  writeFileSync(join(fixture.paths.root, "outside.png"), png);
  fixture.look.references.sets.primary.files[0].path = "outside.png";
  writeJson(fixture.paths.look, fixture.look);

  const result = runCli([
    "preflight",
    "--look",
    fixture.paths.look,
    "--binding",
    fixture.paths.binding,
    "--intent",
    "tile",
    "--prompt",
    "Render the declared synthetic geometry.",
    "--evidence-receipt",
    fixture.paths.evidenceReceipt,
    "--human-review-receipt",
    fixture.paths.humanReviewReceipt,
  ]);

  assert.equal(result.status, 1);
  const verdict = JSON.parse(result.stdout);
  assert.equal(verdict.gate, "reference-path-invalid");
  assert.equal(verdict.dispatched, false);
});

test("check performs only a mechanical PNG format check", (t) => {
  const fixture = makeFixture();
  t.after(() => rmSync(fixture.paths.root, { recursive: true, force: true }));

  const result = runCli([
    "check",
    "--look",
    fixture.paths.look,
    "--intent",
    "tile",
    "--image",
    fixture.paths.image,
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const verdict = JSON.parse(result.stdout);
  assert.equal(verdict.status, "pass");
  assert.equal(verdict.gate, "pass");
  assert.equal(verdict.detail, "Mechanical PNG format passes (1x1); no visual-policy claim was made.");
  assert.equal(verdict.compiledRequest, null);
  assert.equal(verdict.dispatched, false);
});

test("preflight rejects provider bindings embedded in look.json", (t) => {
  const fixture = makeFixture();
  t.after(() => rmSync(fixture.paths.root, { recursive: true, force: true }));
  (fixture.look as Record<string, unknown>).provider = "must-not-be-here";
  writeJson(fixture.paths.look, fixture.look);

  const result = runCli([
    "preflight",
    "--look",
    fixture.paths.look,
    "--binding",
    fixture.paths.binding,
    "--intent",
    "tile",
    "--prompt",
    "Render the declared synthetic geometry.",
    "--evidence-receipt",
    fixture.paths.evidenceReceipt,
    "--human-review-receipt",
    fixture.paths.humanReviewReceipt,
  ]);

  assert.equal(result.status, 1);
  const verdict = JSON.parse(result.stdout);
  assert.equal(verdict.gate, "schema-invalid");
  assert.match(verdict.detail, /Look\.provider/);
  assert.equal(verdict.dispatched, false);
});

test("legacy locks may omit the newer enforcement and observability fields", (t) => {
  const fixture = makeFixture();
  t.after(() => rmSync(fixture.paths.root, { recursive: true, force: true }));
  delete fixture.look.locks.shape.enforcement;
  delete fixture.look.locks.shape.evidenceRequired;
  delete fixture.look.locks.shape.mustShow;
  delete fixture.look.locks.shape.reviewRule;
  writeJson(fixture.paths.look, fixture.look);

  const result = runCli([
    "preflight",
    "--look",
    fixture.paths.look,
    "--binding",
    fixture.paths.binding,
    "--intent",
    "tile",
    "--prompt",
    "Render the declared synthetic geometry.",
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const verdict = JSON.parse(result.stdout);
  assert.equal(verdict.compiledRequest.policy.requiredLocks[0].enforcement, "generativeLock");
  assert.equal(verdict.compiledRequest.policy.requiredLocks[0].evidenceRequired, false);
  assert.deepEqual(verdict.compiledRequest.policy.requiredLocks[0].mustShow, []);
  assert.equal(verdict.compiledRequest.policy.requiredLocks[0].reviewRule, null);
  assert.equal(verdict.dispatched, false);
});

test("preflight rejects executable connection fields in binding.json", (t) => {
  const fixture = makeFixture();
  t.after(() => rmSync(fixture.paths.root, { recursive: true, force: true }));
  (fixture.binding as Record<string, unknown>).endpoint = "https://example.invalid/generate";
  writeJson(fixture.paths.binding, fixture.binding);

  const result = runCli([
    "preflight",
    "--look",
    fixture.paths.look,
    "--binding",
    fixture.paths.binding,
    "--intent",
    "tile",
    "--prompt",
    "Render the declared synthetic geometry.",
    "--evidence-receipt",
    fixture.paths.evidenceReceipt,
    "--human-review-receipt",
    fixture.paths.humanReviewReceipt,
  ]);

  assert.equal(result.status, 1);
  const verdict = JSON.parse(result.stdout);
  assert.equal(verdict.gate, "schema-invalid");
  assert.match(verdict.detail, /Binding\.endpoint/);
  assert.equal(verdict.dispatched, false);
});

test("preflight fails closed when the Look violates the public schema", (t) => {
  const fixture = makeFixture();
  t.after(() => rmSync(fixture.paths.root, { recursive: true, force: true }));
  fixture.look.grammar.palette = ["blue"];
  writeJson(fixture.paths.look, fixture.look);

  const result = runCli([
    "preflight",
    "--look",
    fixture.paths.look,
    "--binding",
    fixture.paths.binding,
    "--intent",
    "tile",
    "--prompt",
    "Render the declared synthetic geometry.",
    "--evidence-receipt",
    fixture.paths.evidenceReceipt,
    "--human-review-receipt",
    fixture.paths.humanReviewReceipt,
  ]);

  assert.equal(result.status, 1);
  const verdict = JSON.parse(result.stdout);
  assert.equal(verdict.gate, "schema-invalid");
  assert.match(verdict.detail, /grammar\.palette/);
  assert.equal(verdict.dispatched, false);
});

test("preflight enforces the separately selected binding reference limit", (t) => {
  const fixture = makeFixture();
  t.after(() => rmSync(fixture.paths.root, { recursive: true, force: true }));
  fixture.binding.limits.maxReferences = 0;
  writeJson(fixture.paths.binding, fixture.binding);

  const result = runCli([
    "preflight",
    "--look",
    fixture.paths.look,
    "--binding",
    fixture.paths.binding,
    "--intent",
    "tile",
    "--prompt",
    "Render the declared synthetic geometry.",
    "--evidence-receipt",
    fixture.paths.evidenceReceipt,
    "--human-review-receipt",
    fixture.paths.humanReviewReceipt,
  ]);

  assert.equal(result.status, 1);
  const verdict = JSON.parse(result.stdout);
  assert.equal(verdict.gate, "references-over-limit");
  assert.match(verdict.detail, /1 files; binding limit is 0/);
  assert.equal(verdict.dispatched, false);
});

test("locked preflight refuses a declared prompt-never token", (t) => {
  const fixture = makeFixture();
  t.after(() => rmSync(fixture.paths.root, { recursive: true, force: true }));

  const result = runCli([
    "preflight",
    "--look",
    fixture.paths.look,
    "--binding",
    fixture.paths.binding,
    "--intent",
    "tile",
    "--prompt",
    "Add a watermark to the synthetic geometry.",
    "--evidence-receipt",
    fixture.paths.evidenceReceipt,
    "--human-review-receipt",
    fixture.paths.humanReviewReceipt,
  ]);

  assert.equal(result.status, 1);
  const verdict = JSON.parse(result.stdout);
  assert.equal(verdict.gate, "prompt-never");
  assert.match(verdict.detail, /watermark/);
  assert.equal(verdict.dispatched, false);
});

test("locked preflight refuses UI chrome for kinds that forbid it", (t) => {
  const fixture = makeFixture();
  t.after(() => rmSync(fixture.paths.root, { recursive: true, force: true }));

  const result = runCli([
    "preflight",
    "--look",
    fixture.paths.look,
    "--binding",
    fixture.paths.binding,
    "--intent",
    "tile",
    "--prompt",
    "Add a HUD around the synthetic geometry.",
    "--evidence-receipt",
    fixture.paths.evidenceReceipt,
    "--human-review-receipt",
    fixture.paths.humanReviewReceipt,
  ]);

  assert.equal(result.status, 1);
  const verdict = JSON.parse(result.stdout);
  assert.equal(verdict.gate, "invented-chrome");
  assert.match(verdict.detail, /HUD/i);
  assert.equal(verdict.dispatched, false);
});
