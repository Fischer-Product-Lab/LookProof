import assert from "node:assert/strict";
import {
  copyFileSync,
  cpSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { test } from "node:test";

import {
  checkImage,
  compileRequest,
  MAX_JSON_BYTES,
  MAX_REFERENCE_BYTES,
  MAX_TOTAL_REFERENCE_BYTES,
  NodeFiles,
  RootedFiles,
  sha256,
  validateDocument,
  validateLookDocument,
  type CoreRun,
} from "../src/core/index.js";

const repoRoot = process.cwd();
const synthetic = resolve(repoRoot, "fixtures", "synthetic");

function copyFixture(root: string): void {
  copyFileSync(join(synthetic, "look.json"), join(root, "look.json"));
  copyFileSync(join(synthetic, "binding.json"), join(root, "binding.json"));
  mkdirSync(join(root, "keepers"));
  copyFileSync(join(synthetic, "keepers", "reference.png"), join(root, "keepers", "reference.png"));
  mkdirSync(join(root, "receipts"));
  copyFileSync(join(synthetic, "receipts", "evidence.json"), join(root, "receipts", "evidence.json"));
  copyFileSync(join(synthetic, "receipts", "human-review.json"), join(root, "receipts", "human-review.json"));
}

function compilePass(files: RootedFiles, prefix = "") {
  const at = (path: string) => (prefix ? `${prefix}/${path}` : path);
  return compileRequest(files, {
    lookPath: at("look.json"),
    bindingPath: at("binding.json"),
    intentId: "pass-tile",
    prompt: "Render the declared synthetic geometry.",
    evidenceReceiptPath: at("receipts/evidence.json"),
    humanReviewReceiptPath: at("receipts/human-review.json"),
  });
}

test("NodeFiles and RootedFiles accept exact-size JSON and refuse max plus one before whole-file reads", (t) => {
  const parent = mkdtempSync(join(tmpdir(), "lookproof-json-limits-"));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, "root");
  mkdirSync(root);
  const lookBytes = readFileSync(join(synthetic, "look.json"));
  assert.ok(lookBytes.length < MAX_JSON_BYTES);
  const exactBytes = Buffer.concat([lookBytes, Buffer.alloc(MAX_JSON_BYTES - lookBytes.length, 0x20)]);
  const overBytes = Buffer.concat([exactBytes, Buffer.from(" ")]);
  const exactPath = join(root, "exact.json");
  const overPath = join(root, "over.json");
  writeFileSync(exactPath, exactBytes);
  writeFileSync(overPath, overBytes);

  const nodeExact = validateDocument(new NodeFiles(), "look", exactPath);
  assert.equal(nodeExact.exitCode, 0, JSON.stringify(nodeExact.verdict));
  const nodeOver = validateDocument(new NodeFiles(), "look", overPath);
  assert.equal(nodeOver.exitCode, 1);
  assert.equal(nodeOver.verdict.gate, "file-too-large");

  const rooted = RootedFiles.create(root);
  const rootedExact = validateLookDocument(rooted, "exact.json");
  assert.equal(rootedExact.exitCode, 0, JSON.stringify(rootedExact.verdict));
  const rootedOver = validateLookDocument(rooted, "over.json");
  assert.equal(rootedOver.exitCode, 1);
  assert.equal(rootedOver.verdict.gate, "file-too-large");
  for (const refusal of [nodeOver, rootedOver]) {
    assert.equal(refusal.verdict.compiledRequest, null);
    assert.equal(refusal.verdict.dispatched, false);
    assert.equal(JSON.stringify(refusal.verdict).includes(root), false);
  }

  const outsideOver = join(parent, "outside-over.json");
  writeFileSync(outsideOver, overBytes);
  const containmentFirst = validateLookDocument(rooted, "../outside-over.json");
  assert.equal(containmentFirst.exitCode, 2);
  assert.equal(containmentFirst.verdict.gate, "look-unreadable");
});

function caughtRun(operation: () => unknown): CoreRun {
  try {
    operation();
  } catch (error) {
    if (typeof error === "object" && error !== null && "run" in error) return (error as { run: CoreRun }).run;
    throw error;
  }
  throw new Error("expected a core refusal");
}

test("reference verification enforces exact individual and selected-total byte boundaries", (t) => {
  const root = mkdtempSync(join(tmpdir(), "lookproof-reference-limits-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const keepers = join(root, "keepers");
  mkdirSync(keepers);
  writeFileSync(join(root, "look.json"), "{}\n");

  const exactPath = join(keepers, "exact-1.bin");
  writeFileSync(exactPath, "");
  truncateSync(exactPath, MAX_REFERENCE_BYTES);
  const exactHash = sha256(readFileSync(exactPath));
  const exactFiles = [1, 2, 3, 4].map((number) => {
    const name = `exact-${number}.bin`;
    if (number > 1) linkSync(exactPath, join(keepers, name));
    return { id: `exact-${number}`, path: `keepers/${name}`, sha256: exactHash };
  });
  assert.equal(exactFiles.length * MAX_REFERENCE_BYTES, MAX_TOTAL_REFERENCE_BYTES);

  const individualOverPath = join(keepers, "individual-over.bin");
  writeFileSync(individualOverPath, "");
  truncateSync(individualOverPath, MAX_REFERENCE_BYTES + 1);
  const individualOver = {
    id: "individual-over",
    path: "keepers/individual-over.bin",
    sha256: "0".repeat(64),
  };
  const totalOverPath = join(keepers, "total-over.bin");
  writeFileSync(totalOverPath, "x");
  const totalOver = { id: "total-over", path: "keepers/total-over.bin", sha256: "0".repeat(64) };
  const look = { paths: { references: "keepers" } };

  for (const [name, filesApi, lookPath] of [
    ["node", new NodeFiles(), join(root, "look.json")],
    ["rooted", RootedFiles.create(root), "look.json"],
  ] as const) {
    const exact = filesApi.verifyReferences(lookPath, look, exactFiles, "locked");
    assert.equal(exact.length, 4, name);
    assert.deepEqual(exact.map((file) => file.path), exactFiles.map((file) => file.path), name);

    const individualRefusal = caughtRun(() =>
      filesApi.verifyReferences(lookPath, look, [individualOver], "locked"),
    );
    assert.equal(individualRefusal.exitCode, 1, name);
    assert.equal(individualRefusal.verdict.gate, "file-too-large", name);

    const totalRefusal = caughtRun(() =>
      filesApi.verifyReferences(lookPath, look, [...exactFiles, totalOver], "locked"),
    );
    assert.equal(totalRefusal.exitCode, 1, name);
    assert.equal(totalRefusal.verdict.gate, "references-too-large", name);
    for (const refusal of [individualRefusal, totalRefusal]) {
      assert.equal(refusal.verdict.compiledRequest, null, name);
      assert.equal(refusal.verdict.dispatched, false, name);
      assert.equal(JSON.stringify(refusal.verdict).includes(root), false, name);
    }
  }
});

test("RootedFiles rejects empty, NUL, absolute, drive-relative, traversal, prefix collision, and non-files", (t) => {
  const parent = mkdtempSync(join(tmpdir(), "lookproof-root-parent-"));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, "root");
  const collision = join(parent, "root-other");
  mkdirSync(root);
  mkdirSync(collision);
  writeFileSync(join(root, "inside.txt"), "inside");
  writeFileSync(join(collision, "outside.txt"), "outside");
  mkdirSync(join(root, "directory"));
  const files = RootedFiles.create(root);

  const invalid = [
    "",
    "\0",
    "/absolute",
    "\\absolute",
    "C:\\absolute",
    "C:/absolute",
    "C:drive-relative",
    "\\\\server\\share\\file",
    "//server/share/file",
    "\\\\?\\C:\\device",
    "\\\\.\\PIPE\\device",
    "..",
    "../root-other/outside.txt",
    "nested/../inside.txt",
    "nested\\..\\inside.txt",
    `../${basename(collision)}/outside.txt`,
    "directory",
  ];
  for (const path of invalid) {
    assert.throws(() => files.readBytes(path), path.replaceAll("\0", "NUL"));
    assert.throws(() => files.readPrefix(path, 24), path.replaceAll("\0", "NUL"));
  }
  assert.equal(files.readBytes("inside.txt").toString("utf8"), "inside");
  assert.equal(files.readPrefix("inside.txt", 24).toString("utf8"), "inside");
});

test("prefix reads return only 24 bytes from a large regular file through node and rooted paths", (t) => {
  const root = mkdtempSync(join(tmpdir(), "lookproof-prefix-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  copyFixture(root);
  const prefix = Buffer.from("89504e470d0a1a0a0000000d494844520000000100000001", "hex");
  const absoluteImagePath = join(root, "keepers", "large.png");
  writeFileSync(absoluteImagePath, prefix);
  truncateSync(absoluteImagePath, MAX_REFERENCE_BYTES + 1);

  const nodePrefix = new NodeFiles().readPrefix(absoluteImagePath, 24);
  assert.equal(nodePrefix.length, 24);
  assert.deepEqual(nodePrefix, prefix);

  const files = RootedFiles.create(root);
  const rootedPrefix = files.readPrefix("keepers/large.png", 24);
  assert.equal(rootedPrefix.length, 24);
  assert.deepEqual(rootedPrefix, prefix);
  assert.throws(() => files.readPrefix("../outside.png", 24));

  const result = checkImage(files, {
    lookPath: "look.json",
    intentId: "pass-tile",
    imagePath: "keepers/large.png",
  });
  assert.equal(result.exitCode, 0, JSON.stringify(result.verdict));
});

test("RootedFiles blocks outside junctions or symlinks and permits in-root links when available", (t) => {
  const parent = mkdtempSync(join(tmpdir(), "lookproof-links-"));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, "root");
  const outside = join(parent, "outside");
  const insideTarget = join(root, "real");
  mkdirSync(root);
  mkdirSync(outside);
  mkdirSync(insideTarget);
  writeFileSync(join(outside, "secret.txt"), "outside-secret-marker");
  writeFileSync(join(insideTarget, "inside.txt"), "inside-link-ok");
  const files = RootedFiles.create(root);

  let outsideLinkCreated = false;
  for (const [name, type] of [["outside-junction", "junction"], ["outside-symlink", "dir"]] as const) {
    try {
      symlinkSync(outside, join(root, name), type);
      outsideLinkCreated = true;
      assert.throws(() => files.readBytes(`${name}/secret.txt`), name);
      break;
    } catch (error) {
      if (outsideLinkCreated) throw error;
    }
  }
  assert.equal(outsideLinkCreated, true, "this platform should support a directory junction or symlink");

  let insideLinkCreated = false;
  for (const [name, type] of [["inside-junction", "junction"], ["inside-symlink", "dir"]] as const) {
    try {
      symlinkSync(insideTarget, join(root, name), type);
      insideLinkCreated = true;
      assert.equal(files.readBytes(`${name}/inside.txt`).toString("utf8"), "inside-link-ok", name);
      break;
    } catch {
      // Try the next local link type.
    }
  }
  assert.equal(insideLinkCreated, true, "this platform should support a directory junction or symlink");
});

test("RootedFiles supports top-level and nested Looks while containing declared reference roots", (t) => {
  const root = mkdtempSync(join(tmpdir(), "lookproof-contained-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  copyFixture(root);
  cpSync(synthetic, join(root, "nested"), { recursive: true });
  const files = RootedFiles.create(root);

  const top = compilePass(files);
  const nested = compilePass(files, "nested");
  assert.equal(top.exitCode, 0, JSON.stringify(top.verdict));
  assert.equal(nested.exitCode, 0, JSON.stringify(nested.verdict));
  assert.equal(top.verdict.compiledRequest?.references[0].path, "keepers/reference.png");
  assert.equal(nested.verdict.compiledRequest?.references[0].path, "keepers/reference.png");
  for (const run of [top, nested]) {
    const serialized = JSON.stringify(run.verdict);
    assert.equal(serialized.includes(root), false);
    assert.equal(serialized.includes(resolve(root)), false);
  }

  const lookPath = join(root, "nested", "look.json");
  const look = JSON.parse(readFileSync(lookPath, "utf8"));
  look.references.sets.primary.files[0].path = "../keepers/reference.png";
  writeFileSync(lookPath, `${JSON.stringify(look, null, 2)}\n`);
  const refused = compilePass(files, "nested");
  assert.equal(refused.exitCode, 1);
  assert.equal(refused.verdict.gate, "reference-path-invalid");
  const serialized = JSON.stringify(refused.verdict);
  assert.equal(serialized.includes(root), false);
  assert.equal(serialized.includes("outside-secret-marker"), false);
});

test("RootedFiles refuses Windows absolute forms in declared Look reference paths", (t) => {
  const root = mkdtempSync(join(tmpdir(), "lookproof-declared-windows-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  copyFixture(root);
  const files = RootedFiles.create(root);
  const lookPath = join(root, "look.json");

  for (const path of ["C:\\outside.png", "C:outside.png", "\\\\server\\share\\outside.png", "\\\\?\\C:\\outside.png"]) {
    const look = JSON.parse(readFileSync(join(synthetic, "look.json"), "utf8"));
    look.references.sets.primary.files[0].path = path;
    writeFileSync(lookPath, `${JSON.stringify(look, null, 2)}\n`);
    const result = compilePass(files);
    assert.equal(result.exitCode, 1, path);
    assert.equal(result.verdict.gate, "reference-path-invalid", path);
    assert.equal(JSON.stringify(result.verdict).includes(root), false, path);
  }
});
