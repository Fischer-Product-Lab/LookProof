import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";


import {
  checkImage,
  compileRequest,
  explainRefusal,
  MAX_DETAIL_CHARS,
  MAX_GATE_CHARS,
  MAX_INTENT_CHARS,
  MAX_JSON_BYTES,
  MAX_PATH_CHARS,
  MAX_PROMPT_CHARS,
  MAX_REFERENCE_BYTES,
  MAX_TOTAL_REFERENCE_BYTES,
  NodeFiles,
  validateDocument,
  type CoreRun,
  type Files,
  type JsonRead,
  type JsonRecord,
  type Room,
} from "../src/core/index.js";

const repoRoot = process.cwd();
const fixtureRoot = resolve(repoRoot, "fixtures", "synthetic");
const files = new NodeFiles();
const pngPrefix = Buffer.from("89504e470d0a1a0a0000000d494844520000000100000001", "hex");

test("shared core exports the finite input and file limits", () => {
  assert.deepEqual(
    {
      MAX_PATH_CHARS,
      MAX_GATE_CHARS,
      MAX_INTENT_CHARS,
      MAX_PROMPT_CHARS,
      MAX_DETAIL_CHARS,
      MAX_JSON_BYTES,
      MAX_REFERENCE_BYTES,
      MAX_TOTAL_REFERENCE_BYTES,
    },
    {
      MAX_PATH_CHARS: 4096,
      MAX_GATE_CHARS: 128,
      MAX_INTENT_CHARS: 256,
      MAX_PROMPT_CHARS: 8_192,
      MAX_DETAIL_CHARS: 4096,
      MAX_JSON_BYTES: 1_048_576,
      MAX_REFERENCE_BYTES: 25 * 1_048_576,
      MAX_TOTAL_REFERENCE_BYTES: 100 * 1_048_576,
    },
  );
});

class PrefixOnlyFiles implements Files {
  readonly #delegate = new NodeFiles();
  readonly prefixRequests: Array<{ path: string; length: number }> = [];
  readBytesCalls = 0;

  readJsonValue(path: string, label: string): JsonRead {
    return this.#delegate.readJsonValue(path, label);
  }

  readJsonObject(path: string, label: string): { bytes: Buffer; value: JsonRecord } {
    return this.#delegate.readJsonObject(path, label);
  }

  readBytes(_path: string): Buffer {
    this.readBytesCalls += 1;
    throw new Error("full image reads are forbidden");
  }

  readPrefix(path: string, length: number): Buffer {
    this.prefixRequests.push({ path, length });
    return pngPrefix.subarray(0, length);
  }

  verifyReferences(lookPath: string, look: JsonRecord, referencedFiles: JsonRecord[], room: Room): JsonRecord[] {
    return this.#delegate.verifyReferences(lookPath, look, referencedFiles, room);
  }
}

class BoundaryFiles implements Files {
  readonly reads: Array<{ path: string; label: string }> = [];

  readJsonValue(path: string, label: string): JsonRead {
    this.reads.push({ path, label });
    const source =
      label === "binding"
        ? resolve(fixtureRoot, "binding.json")
        : label === "evidence-receipt"
          ? resolve(fixtureRoot, "receipts", "evidence.json")
          : label === "human-review-receipt"
            ? resolve(fixtureRoot, "receipts", "human-review.json")
            : resolve(fixtureRoot, "look.json");
    return new NodeFiles().readJsonValue(source, label);
  }

  readJsonObject(path: string, label: string): { bytes: Buffer; value: JsonRecord } {
    const read = this.readJsonValue(path, label);
    return { bytes: read.bytes, value: read.value as JsonRecord };
  }

  readBytes(_path: string): Buffer {
    throw new Error("unexpected whole-file read");
  }

  readPrefix(path: string, length: number): Buffer {
    this.reads.push({ path, label: "image" });
    return pngPrefix.subarray(0, length);
  }

  verifyReferences(_lookPath: string, _look: JsonRecord, referencedFiles: JsonRecord[]): JsonRecord[] {
    return referencedFiles;
  }
}

function compileBoundary(filesApi: Files, overrides: Partial<Parameters<typeof compileRequest>[1]> = {}): CoreRun {
  return compileRequest(filesApi, {
    lookPath: "look.json",
    bindingPath: "binding.json",
    intentId: "pass-tile",
    prompt: "Render the declared synthetic geometry.",
    evidenceReceiptPath: "receipts/evidence.json",
    humanReviewReceiptPath: "receipts/human-review.json",
    ...overrides,
  });
}

test("core string limits accept exact boundaries and refuse max plus one before file reads", () => {
  const exactCases: Array<[string, () => CoreRun, BoundaryFiles | undefined]> = [];
  for (const [name, field, value] of [
    ["compile look path", "lookPath", "l".repeat(MAX_PATH_CHARS)],
    ["compile binding path", "bindingPath", "b".repeat(MAX_PATH_CHARS)],
    ["compile prompt", "prompt", "x".repeat(MAX_PROMPT_CHARS)],
    ["compile evidence path", "evidenceReceiptPath", "e".repeat(MAX_PATH_CHARS)],
    ["compile review path", "humanReviewReceiptPath", "h".repeat(MAX_PATH_CHARS)],
  ] as const) {
    const boundaryFiles = new BoundaryFiles();
    exactCases.push([name, () => compileBoundary(boundaryFiles, { [field]: value }), boundaryFiles]);
  }
  {
    const boundaryFiles = new BoundaryFiles();
    exactCases.push([
      "compile intent",
      () => compileBoundary(boundaryFiles, { intentId: "i".repeat(MAX_INTENT_CHARS) }),
      boundaryFiles,
    ]);
  }
  for (const [name, input] of [
    ["check look path", { lookPath: "l".repeat(MAX_PATH_CHARS), intentId: "pass-tile", imagePath: "image.png" }],
    ["check intent", { lookPath: "look.json", intentId: "i".repeat(MAX_INTENT_CHARS), imagePath: "image.png" }],
    ["check image path", { lookPath: "look.json", intentId: "pass-tile", imagePath: "i".repeat(MAX_PATH_CHARS) }],
  ] as const) {
    const boundaryFiles = new BoundaryFiles();
    exactCases.push([name, () => checkImage(boundaryFiles, input), boundaryFiles]);
  }
  {
    const boundaryFiles = new BoundaryFiles();
    exactCases.push([
      "validate file path",
      () => validateDocument(boundaryFiles, "look", "v".repeat(MAX_PATH_CHARS)),
      boundaryFiles,
    ]);
  }
  exactCases.push(["explain gate", () => explainRefusal("g".repeat(MAX_GATE_CHARS)), undefined]);
  exactCases.push([
    "explain detail",
    () => explainRefusal("reference-conflict", "d".repeat(MAX_DETAIL_CHARS)),
    undefined,
  ]);

  for (const [name, operation, boundaryFiles] of exactCases) {
    const result = operation();
    assert.notEqual(result.verdict.gate, "input-too-large", name);
    if (boundaryFiles) assert.ok(boundaryFiles.reads.length > 0, name);
  }

  const overCases: Array<[string, (files: BoundaryFiles) => CoreRun]> = [
    ["compile look path", (api) => compileBoundary(api, { lookPath: "l".repeat(MAX_PATH_CHARS + 1) })],
    ["compile binding path", (api) => compileBoundary(api, { bindingPath: "b".repeat(MAX_PATH_CHARS + 1) })],
    ["compile intent", (api) => compileBoundary(api, { intentId: "i".repeat(MAX_INTENT_CHARS + 1) })],
    ["compile prompt", (api) => compileBoundary(api, { prompt: "p".repeat(MAX_PROMPT_CHARS + 1) })],
    ["compile evidence path", (api) => compileBoundary(api, { evidenceReceiptPath: "e".repeat(MAX_PATH_CHARS + 1) })],
    ["compile review path", (api) => compileBoundary(api, { humanReviewReceiptPath: "h".repeat(MAX_PATH_CHARS + 1) })],
    ["check look path", (api) => checkImage(api, { lookPath: "l".repeat(MAX_PATH_CHARS + 1), intentId: "pass-tile", imagePath: "image.png" })],
    ["check intent", (api) => checkImage(api, { lookPath: "look.json", intentId: "i".repeat(MAX_INTENT_CHARS + 1), imagePath: "image.png" })],
    ["check image path", (api) => checkImage(api, { lookPath: "look.json", intentId: "pass-tile", imagePath: "i".repeat(MAX_PATH_CHARS + 1) })],
    ["validate file path", (api) => validateDocument(api, "look", "v".repeat(MAX_PATH_CHARS + 1))],
  ];

  for (const [name, operation] of overCases) {
    const boundaryFiles = new BoundaryFiles();
    const result = operation(boundaryFiles);
    assert.equal(result.exitCode, 1, name);
    assert.equal(result.verdict.gate, "input-too-large", name);
    assert.equal(result.verdict.compiledRequest, null, name);
    assert.equal(result.verdict.dispatched, false, name);
    assert.equal(boundaryFiles.reads.length, 0, name);
    assert.equal(JSON.stringify(result.verdict).includes(resolve(fixtureRoot)), false, name);
  }

  for (const [name, result] of [
    ["explain gate", explainRefusal("g".repeat(MAX_GATE_CHARS + 1))],
    ["explain detail", explainRefusal("reference-conflict", "d".repeat(MAX_DETAIL_CHARS + 1))],
  ] as const) {
    assert.equal(result.exitCode, 1, name);
    assert.equal(result.verdict.gate, "input-too-large", name);
    assert.equal(result.verdict.compiledRequest, null, name);
    assert.equal(result.verdict.dispatched, false, name);
  }
});

test("shared core compiles a local request without process or transport side effects", () => {
  const result = compileRequest(files, {
    lookPath: resolve(fixtureRoot, "look.json"),
    bindingPath: resolve(fixtureRoot, "binding.json"),
    intentId: "pass-tile",
    prompt: "Render the declared synthetic geometry.",
    evidenceReceiptPath: resolve(fixtureRoot, "receipts", "evidence.json"),
    humanReviewReceiptPath: resolve(fixtureRoot, "receipts", "human-review.json"),
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.verdict.status, "pass");
  assert.equal(result.verdict.gate, "pass");
  assert.equal(result.verdict.dispatched, false);
  assert.equal(result.verdict.compiledRequest?.requestSha256, "7c982a8bbf2f0f013618d0432d87ff316ad923ab8769afd1a7f39d224c5a55d8");
});

test("shared core returns policy refusals as structured runs", () => {
  const result = compileRequest(files, {
    lookPath: resolve(fixtureRoot, "look.json"),
    bindingPath: resolve(fixtureRoot, "binding.json"),
    intentId: "conflict-tile",
    prompt: "Render the declared synthetic geometry.",
  });

  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.verdict, {
    status: "fail",
    room: "locked",
    gate: "reference-conflict",
    detail: "Reference synthetic-square-conflict conflicts with required lock shape.",
    warnings: [],
    compiledRequest: null,
    dispatched: false,
  });
});

test("shared core mechanically checks PNG headers without visual claims", () => {
  const result = checkImage(files, {
    lookPath: resolve(fixtureRoot, "look.json"),
    intentId: "pass-tile",
    imagePath: resolve(fixtureRoot, "keepers", "reference.png"),
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.verdict.detail, "Mechanical PNG format passes (1x1); no visual-policy claim was made.");
  assert.equal(result.verdict.compiledRequest, null);
  assert.equal(result.verdict.dispatched, false);
});

test("checkImage requests only the first 24 PNG bytes", () => {
  const prefixOnlyFiles = new PrefixOnlyFiles();
  const imagePath = "memory://reference.png";

  const result = checkImage(prefixOnlyFiles, {
    lookPath: resolve(fixtureRoot, "look.json"),
    intentId: "pass-tile",
    imagePath,
  });

  assert.equal(prefixOnlyFiles.readBytesCalls, 0, "checkImage must not read the full image");
  assert.deepEqual(prefixOnlyFiles.prefixRequests, [{ path: imagePath, length: 24 }]);
  assert.equal(result.exitCode, 0, JSON.stringify(result.verdict));
});
