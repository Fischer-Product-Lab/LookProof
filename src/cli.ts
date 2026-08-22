import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

type JsonRecord = Record<string, any>;
type Room = "explore" | "locked";

function emit(payload: JsonRecord, exitCode: number): never {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  process.exit(exitCode);
}

function fail(gate: string, detail: string, exitCode = 1, room: Room = "locked"): never {
  return emit(
    {
      status: "fail",
      room,
      gate,
      detail,
      warnings: [],
      compiledRequest: null,
      dispatched: false,
    },
    exitCode,
  );
}

function pass(room: Room, compiledRequest: JsonRecord): never {
  return emit(
    {
      status: "pass",
      room,
      gate: "pass",
      detail: "Creative-policy preflight compiled locally; no provider call occurred.",
      warnings: [],
      compiledRequest,
      dispatched: false,
    },
    0,
  );
}

function parseOptions(args: string[], allowed: Set<string>): Map<string, string> {
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      fail("arguments-invalid", "Options must be provided as --name value pairs.", 2);
    }
    const name = key.slice(2);
    if (!allowed.has(name) || options.has(name)) {
      fail("arguments-invalid", `Unknown or duplicate option: --${name}.`, 2);
    }
    options.set(name, value);
  }
  return options;
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

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

function readJsonValue(path: string, label: string): { bytes: Buffer; value: unknown } {
  try {
    const bytes = readFileSync(path);
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    return { bytes, value };
  } catch {
    fail(`${label}-unreadable`, `${label[0].toUpperCase()}${label.slice(1)} could not be read as JSON.`, 2);
  }
}

function readJson(path: string, label: string): { bytes: Buffer; value: JsonRecord } {
  const read = readJsonValue(path, label);
  if (!isRecord(read.value)) {
    fail(`${label}-unreadable`, `${label[0].toUpperCase()}${label.slice(1)} must be a JSON object.`, 2);
  }
  return { bytes: read.bytes, value: read.value };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isUniqueNonEmptyStrings(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every(isNonEmptyString) &&
    new Set(value).size === value.length
  );
}

function validateObject(
  value: unknown,
  path: string,
  allowedKeys: string[],
  errors: string[],
): value is JsonRecord {
  if (!isRecord(value)) {
    errors.push(path);
    return false;
  }
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${path}.${key}`);
  return true;
}

function validateLook(look: JsonRecord): void {
  const errors: string[] = [];
  validateObject(
    look,
    "Look",
    ["schemaVersion", "identity", "defaultRoom", "grammar", "nevers", "locks", "intents", "references", "paths"],
    errors,
  );
  if (look.schemaVersion !== "1.0.0") errors.push("schemaVersion");
  if (validateObject(look.identity, "identity", ["id", "name"], errors)) {
    if (!isNonEmptyString(look.identity.id)) errors.push("identity.id");
    if (!isNonEmptyString(look.identity.name)) errors.push("identity.name");
  }
  if (look.defaultRoom !== "locked" && look.defaultRoom !== "explore") errors.push("defaultRoom");
  if (validateObject(look.grammar, "grammar", ["silhouette", "costume", "face", "era", "palette"], errors)) {
    for (const key of ["silhouette", "costume", "face", "era"]) {
      if (typeof look.grammar[key] !== "string") errors.push(`grammar.${key}`);
    }
    if (!Array.isArray(look.grammar.palette) || !look.grammar.palette.every((item: unknown) => typeof item === "string" && /^#[0-9A-Fa-f]{6}$/.test(item))) {
      errors.push("grammar.palette");
    }
  }
  if (validateObject(look.nevers, "nevers", ["categories", "promptNever", "forbidUiChromeForKinds"], errors)) {
    for (const key of ["categories", "promptNever", "forbidUiChromeForKinds"]) {
      if (!isUniqueNonEmptyStrings(look.nevers[key])) errors.push(`nevers.${key}`);
    }
  }
  if (look.locks !== undefined) {
    if (!isRecord(look.locks)) {
      errors.push("locks");
    } else {
      for (const [lockId, lock] of Object.entries(look.locks)) {
        const path = `locks.${lockId}`;
        if (!isNonEmptyString(lockId)) errors.push("locks");
        if (!validateObject(lock, path, ["description", "enforcement", "evidenceRequired", "mustShow", "reviewRule"], errors)) continue;
        if (!isNonEmptyString(lock.description)) errors.push(`${path}.description`);
        if (lock.enforcement !== undefined && !["generativeLock", "deterministicOnly", "humanReviewRequired"].includes(lock.enforcement)) {
          errors.push(`${path}.enforcement`);
        }
        if (lock.evidenceRequired !== undefined && typeof lock.evidenceRequired !== "boolean") errors.push(`${path}.evidenceRequired`);
        if (lock.mustShow !== undefined && !isUniqueNonEmptyStrings(lock.mustShow)) errors.push(`${path}.mustShow`);
        if (lock.reviewRule !== undefined && !isNonEmptyString(lock.reviewRule)) errors.push(`${path}.reviewRule`);
      }
    }
  }
  if (!isRecord(look.intents) || Object.keys(look.intents).length === 0) {
    errors.push("intents");
  } else {
    for (const [intentId, intent] of Object.entries(look.intents)) {
      const path = `intents.${intentId}`;
      if (!validateObject(intent, path, ["kind", "aspectRatio", "minWidth", "referenceSet", "requiredLocks"], errors)) continue;
      if (!isNonEmptyString(intent.kind)) errors.push(`${path}.kind`);
      if (validateObject(intent.aspectRatio, `${path}.aspectRatio`, ["width", "height", "tolerance"], errors)) {
        if (!Number.isInteger(intent.aspectRatio.width) || intent.aspectRatio.width < 1) errors.push(`${path}.aspectRatio.width`);
        if (!Number.isInteger(intent.aspectRatio.height) || intent.aspectRatio.height < 1) errors.push(`${path}.aspectRatio.height`);
        if (!Number.isFinite(intent.aspectRatio.tolerance) || intent.aspectRatio.tolerance < 0 || intent.aspectRatio.tolerance > 1) errors.push(`${path}.aspectRatio.tolerance`);
      }
      if (!Number.isInteger(intent.minWidth) || intent.minWidth < 1) errors.push(`${path}.minWidth`);
      if (!isNonEmptyString(intent.referenceSet)) errors.push(`${path}.referenceSet`);
      if (intent.requiredLocks !== undefined && !isUniqueNonEmptyStrings(intent.requiredLocks)) errors.push(`${path}.requiredLocks`);
    }
  }
  if (validateObject(look.references, "references", ["sets"], errors)) {
    if (!isRecord(look.references.sets)) {
      errors.push("references.sets");
    } else {
      for (const [setId, set] of Object.entries(look.references.sets)) {
        const setPath = `references.sets.${setId}`;
        if (!validateObject(set, setPath, ["description", "files"], errors)) continue;
        if (!isNonEmptyString(set.description)) errors.push(`${setPath}.description`);
        if (!Array.isArray(set.files)) {
          errors.push(`${setPath}.files`);
          continue;
        }
        set.files.forEach((file: unknown, index: number) => {
          const path = `${setPath}.files.${index}`;
          if (!validateObject(file, path, ["id", "path", "sha256", "scopes", "status", "source", "permittedUse", "knownLimits", "supportsLocks", "conflictsWithLocks"], errors)) return;
          if (!isNonEmptyString(file.id)) errors.push(`${path}.id`);
          if (!isNonEmptyString(file.path)) errors.push(`${path}.path`);
          if (typeof file.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(file.sha256)) errors.push(`${path}.sha256`);
          for (const key of ["scopes", "permittedUse", "knownLimits"]) if (!isUniqueNonEmptyStrings(file[key])) errors.push(`${path}.${key}`);
          for (const key of ["supportsLocks", "conflictsWithLocks"]) if (file[key] !== undefined && !isUniqueNonEmptyStrings(file[key])) errors.push(`${path}.${key}`);
          if (file.status !== "REFERENCE" && file.status !== "AUTHORITY") errors.push(`${path}.status`);
          if (!isNonEmptyString(file.source)) errors.push(`${path}.source`);
        });
      }
    }
  }
  if (validateObject(look.paths, "paths", ["references"], errors) && !isNonEmptyString(look.paths.references)) {
    errors.push("paths.references");
  }
  if (errors.length > 0) {
    const room: Room = look.defaultRoom === "explore" ? "explore" : "locked";
    fail("schema-invalid", `Look does not satisfy the runtime schema: ${errors.join(", ")}.`, 1, room);
  }
}

function validateBinding(binding: JsonRecord): void {
  const errors: string[] = [];
  validateObject(binding, "Binding", ["schemaVersion", "id", "provider", "model", "limits"], errors);
  if (binding.schemaVersion !== "1.0.0") errors.push("binding.schemaVersion");
  for (const key of ["id", "provider", "model"]) if (!isNonEmptyString(binding[key])) errors.push(`binding.${key}`);
  if (validateObject(binding.limits, "binding.limits", ["maxReferences", "requireReferences"], errors)) {
    if (!Number.isInteger(binding.limits.maxReferences) || binding.limits.maxReferences < 0) errors.push("binding.limits.maxReferences");
    if (typeof binding.limits.requireReferences !== "boolean") errors.push("binding.limits.requireReferences");
  }
  if (errors.length > 0) fail("schema-invalid", `Binding does not satisfy the runtime schema: ${errors.join(", ")}.`);
}

function isValidDateTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})[Tt](?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:[Zz]|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  const calendarDate = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(calendarDate.getTime()) && calendarDate.toISOString().slice(0, 10) === date;
}

function validateEvidenceReceipt(receipt: unknown, room: Room): asserts receipt is JsonRecord {
  const errors: string[] = [];
  if (
    validateObject(
      receipt,
      "evidenceReceipt",
      ["schemaVersion", "receiptId", "kind", "lockId", "referenceId", "referenceSha256", "recordedAt", "statement"],
      errors,
    )
  ) {
    if (receipt.schemaVersion !== "1.0.0") errors.push("evidenceReceipt.schemaVersion");
    if (!isNonEmptyString(receipt.receiptId)) errors.push("evidenceReceipt.receiptId");
    if (receipt.kind !== "reference-evidence") errors.push("evidenceReceipt.kind");
    if (!isNonEmptyString(receipt.lockId)) errors.push("evidenceReceipt.lockId");
    if (!isNonEmptyString(receipt.referenceId)) errors.push("evidenceReceipt.referenceId");
    if (typeof receipt.referenceSha256 !== "string" || !/^[a-f0-9]{64}$/.test(receipt.referenceSha256)) {
      errors.push("evidenceReceipt.referenceSha256");
    }
    if (!isValidDateTime(receipt.recordedAt)) errors.push("evidenceReceipt.recordedAt");
    if (!isNonEmptyString(receipt.statement)) errors.push("evidenceReceipt.statement");
  }
  if (errors.length > 0) {
    fail("schema-invalid", `Evidence receipt does not satisfy the runtime schema: ${errors.join(", ")}.`, 1, room);
  }
}

function validateHumanReviewReceipt(receipt: unknown, room: Room): asserts receipt is JsonRecord {
  const errors: string[] = [];
  if (
    validateObject(
      receipt,
      "humanReviewReceipt",
      ["schemaVersion", "receiptId", "kind", "lookId", "intentId", "scope", "decision", "reviewedAt", "reviewer", "findings"],
      errors,
    )
  ) {
    if (receipt.schemaVersion !== "1.0.0") errors.push("humanReviewReceipt.schemaVersion");
    if (!isNonEmptyString(receipt.receiptId)) errors.push("humanReviewReceipt.receiptId");
    if (receipt.kind !== "human-review") errors.push("humanReviewReceipt.kind");
    if (!isNonEmptyString(receipt.lookId)) errors.push("humanReviewReceipt.lookId");
    if (!isNonEmptyString(receipt.intentId)) errors.push("humanReviewReceipt.intentId");
    if (receipt.scope !== "request-policy") errors.push("humanReviewReceipt.scope");
    if (receipt.decision !== "pass" && receipt.decision !== "fail") errors.push("humanReviewReceipt.decision");
    if (!isValidDateTime(receipt.reviewedAt)) errors.push("humanReviewReceipt.reviewedAt");
    if (!isNonEmptyString(receipt.reviewer)) errors.push("humanReviewReceipt.reviewer");
    if (!Array.isArray(receipt.findings)) {
      errors.push("humanReviewReceipt.findings");
    } else {
      receipt.findings.forEach((finding: unknown, index: number) => {
        const path = `humanReviewReceipt.findings.${index}`;
        if (!validateObject(finding, path, ["lockId", "clause", "observed", "note"], errors)) return;
        if (!isNonEmptyString(finding.lockId)) errors.push(`${path}.lockId`);
        if (!isNonEmptyString(finding.clause)) errors.push(`${path}.clause`);
        if (typeof finding.observed !== "boolean") errors.push(`${path}.observed`);
        if (typeof finding.note !== "string") errors.push(`${path}.note`);
      });
    }
  }
  if (errors.length > 0) {
    fail("schema-invalid", `Human-review receipt does not satisfy the runtime schema: ${errors.join(", ")}.`, 1, room);
  }
}

function isContained(base: string, candidate: string): boolean {
  const relation = relative(base, candidate);
  return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
}

function verifyReferences(lookPath: string, look: JsonRecord, files: JsonRecord[], room: Room): JsonRecord[] {
  const lookRoot = dirname(resolve(lookPath));
  const configuredRoot = look.paths?.references;
  if (typeof configuredRoot !== "string" || configuredRoot.trim() === "" || isAbsolute(configuredRoot)) {
    fail("reference-path-invalid", "Configured references path must be a non-empty relative path.", 1, room);
  }
  const referencesRoot = resolve(lookRoot, configuredRoot);
  if (!isContained(lookRoot, referencesRoot) || !existsSync(referencesRoot)) {
    fail("reference-path-invalid", "Configured references path must resolve inside the Look folder.", 1, room);
  }

  let lookRootReal: string;
  let referencesRootReal: string;
  try {
    lookRootReal = realpathSync(lookRoot);
    referencesRootReal = realpathSync(referencesRoot);
    if (!statSync(referencesRootReal).isDirectory() || !isContained(lookRootReal, referencesRootReal)) {
      throw new Error("unsafe root");
    }
  } catch {
    fail("reference-path-invalid", "Configured references folder could not be safely resolved.", 1, room);
  }

  return files.map((file) => {
    if (typeof file.path !== "string" || isAbsolute(file.path)) {
      fail("reference-path-invalid", `Reference ${String(file.id)} must use a relative path.`, 1, room);
    }
    const candidate = resolve(lookRoot, file.path);
    if (!isContained(referencesRoot, candidate) || !existsSync(candidate)) {
      fail("reference-path-invalid", `Reference ${String(file.id)} escapes or is missing from the references folder.`, 1, room);
    }
    let candidateReal: string;
    let actualHash: string;
    try {
      candidateReal = realpathSync(candidate);
      if (!isContained(referencesRootReal, candidateReal) || !statSync(candidateReal).isFile()) {
        throw new Error("unsafe reference");
      }
      actualHash = sha256(readFileSync(candidateReal));
    } catch {
      fail("reference-unreadable", `Reference ${String(file.id)} could not be safely read.`, 1, room);
    }
    if (actualHash !== file.sha256) {
      fail("reference-hash-mismatch", `Reference ${String(file.id)} does not match its declared SHA-256.`, 1, room);
    }
    return { ...file, path: file.path, sha256: actualHash };
  });
}

function normalized(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findForbiddenPromptEntry(prompt: string, entries: string[]): string | undefined {
  const value = normalized(prompt);
  return entries.find((entry) => {
    const candidate = normalized(entry);
    if (candidate.includes(" ")) return value.includes(candidate);
    return new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(candidate)}(?![\\p{L}\\p{N}_])`, "iu").test(value);
  });
}

function effectiveLock(lock: JsonRecord): JsonRecord {
  return {
    description: lock.description,
    enforcement: lock.enforcement ?? "generativeLock",
    evidenceRequired: lock.evidenceRequired ?? false,
    mustShow: lock.mustShow ?? [],
    reviewRule: lock.reviewRule ?? null,
  };
}

function resolvePreflightPolicy(look: JsonRecord, options: Map<string, string>) {
  const requestedRoom = options.get("room");
  const defaultRoom: Room = look.defaultRoom === "explore" ? "explore" : "locked";
  if (requestedRoom !== undefined && requestedRoom !== "explore" && requestedRoom !== "locked") {
    fail("arguments-invalid", "--room must be explore or locked.", 2, defaultRoom);
  }
  const room: Room = requestedRoom === undefined ? defaultRoom : requestedRoom;
  const intentId = options.get("intent");
  if (!intentId) fail("intent-missing", "Missing required --intent option.", 1, room);
  const intent = look.intents?.[intentId];
  if (!isRecord(intent)) fail("intent-unknown", `Intent ${intentId} is not declared by this Look.`, 1, room);
  const requiredLockIds: string[] = intent.requiredLocks ?? [];
  const requiredLocks = requiredLockIds.map((lockId) => {
    const declared = look.locks?.[lockId];
    if (!isRecord(declared)) fail("lock-missing", `Required lock ${lockId} is not declared.`, 1, room);
    return { lockId, ...effectiveLock(declared) };
  });
  const referenceSet = look.references?.sets?.[intent.referenceSet];
  if (!isRecord(referenceSet) || !Array.isArray(referenceSet.files)) {
    fail("reference-set-missing", `Reference set ${String(intent.referenceSet)} is not declared.`, 1, room);
  }
  const files = referenceSet.files as JsonRecord[];
  for (const lockId of requiredLockIds) {
    const conflictingReference = files.find(
      (file) => Array.isArray(file.conflictsWithLocks) && file.conflictsWithLocks.includes(lockId),
    );
    if (conflictingReference) {
      fail(
        "reference-conflict",
        `Reference ${String(conflictingReference.id)} conflicts with required lock ${lockId}.`,
        1,
        room,
      );
    }
  }
  return { room, intentId, intent, requiredLocks, files };
}

function refuseDeterministicOnly(requiredLocks: JsonRecord[], room: Room): void {
  const deterministicLock = requiredLocks.find((lock) => lock.enforcement === "deterministicOnly");
  if (deterministicLock) {
    fail(
      "deterministic-only-lock",
      `Required lock ${deterministicLock.lockId} is deterministic-only and cannot be compiled into a generative request.`,
      1,
      room,
    );
  }
}

function frozenPrefix(look: JsonRecord, intentId: string, intent: JsonRecord, locks: JsonRecord[]): string {
  const lines = [
    `LOOK: ${look.identity.id} | ${look.identity.name}`,
    `SILHOUETTE: ${look.grammar.silhouette}`,
    `COSTUME: ${look.grammar.costume}`,
    `FACE: ${look.grammar.face}`,
    `ERA: ${look.grammar.era}`,
    `PALETTE: ${look.grammar.palette.join(", ")}`,
    `INTENT: ${intentId} (${intent.kind})`,
  ];
  for (const lock of locks) {
    lines.push(`REQUIRED LOCK: ${lock.lockId} (${lock.enforcement})`);
    for (const clause of lock.mustShow) lines.push(`MUST SHOW [${lock.lockId}]: ${clause}`);
  }
  lines.push(
    `FORMAT: ${intent.aspectRatio.width}:${intent.aspectRatio.height}; minimum width ${intent.minWidth}px; aspect tolerance ${intent.aspectRatio.tolerance}`,
  );
  return lines.join("\n");
}

function runCheck(look: JsonRecord, options: Map<string, string>): never {
  const room: Room = look.defaultRoom === "explore" ? "explore" : "locked";
  const intentId = options.get("intent");
  if (!intentId) fail("intent-missing", "Missing required --intent option.", 1, room);
  const intent = look.intents?.[intentId];
  if (!isRecord(intent)) fail("intent-unknown", `Intent ${intentId} is not declared by this Look.`, 1, room);
  const imagePath = options.get("image");
  if (!imagePath) fail("arguments-invalid", "Missing required --image option.", 2, room);

  let bytes: Buffer;
  try {
    if (!existsSync(imagePath) || !statSync(imagePath).isFile()) throw new Error("missing");
    bytes = readFileSync(imagePath);
  } catch {
    fail("image-unreadable", "Image file could not be read.", 1, room);
  }
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (
    bytes.length < 24 ||
    !bytes.subarray(0, 8).equals(signature) ||
    bytes.readUInt32BE(8) !== 13 ||
    bytes.subarray(12, 16).toString("ascii") !== "IHDR"
  ) {
    fail("image-not-png", "Image is not a PNG with a readable IHDR header.", 1, room);
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width === 0 || height === 0) fail("image-not-png", "PNG dimensions must be nonzero.", 1, room);
  if (width < intent.minWidth) {
    fail("format-width", `PNG width ${width}px is below the required ${intent.minWidth}px.`, 1, room);
  }
  const expectedRatio = intent.aspectRatio.width / intent.aspectRatio.height;
  const aspectError = Math.abs(width / height - expectedRatio) / expectedRatio;
  if (aspectError > intent.aspectRatio.tolerance) {
    fail(
      "format-aspect",
      `PNG aspect error ${aspectError.toFixed(6)} exceeds tolerance ${intent.aspectRatio.tolerance}.`,
      1,
      room,
    );
  }
  return emit(
    {
      status: "pass",
      room,
      gate: "pass",
      detail: `Mechanical PNG format passes (${width}x${height}); no visual-policy claim was made.`,
      warnings: [],
      compiledRequest: null,
      dispatched: false,
    },
    0,
  );
}

function runPreflight(
  lookPath: string,
  lookRead: { bytes: Buffer; value: JsonRecord },
  bindingRead: { bytes: Buffer; value: JsonRecord },
  options: Map<string, string>,
  policy: ReturnType<typeof resolvePreflightPolicy>,
): never {
  const look = lookRead.value;
  const binding = bindingRead.value;
  const { room, intentId, intent, requiredLocks, files } = policy;
  const prompt = options.get("prompt");
  if (prompt === undefined) fail("arguments-invalid", "Missing required --prompt option.", 2, room);
  const forbiddenPromptEntry = findForbiddenPromptEntry(prompt, look.nevers.promptNever);
  if (forbiddenPromptEntry !== undefined) {
    fail("prompt-never", `Prompt matches declared never: ${forbiddenPromptEntry}.`, 1, room);
  }
  if (look.nevers.forbidUiChromeForKinds.includes(intent.kind)) {
    const chromeEntry = findForbiddenPromptEntry(prompt, ["ui", "hud", "menu", "menus", "button", "buttons"]);
    if (chromeEntry !== undefined) {
      fail("invented-chrome", `Prompt asks for forbidden UI chrome: ${chromeEntry}.`, 1, room);
    }
  }
  if (binding.limits.requireReferences && files.length === 0) {
    fail("references-required", "The selected binding requires at least one reference file.", 1, room);
  }
  if (files.length > binding.limits.maxReferences) {
    fail(
      "references-over-limit",
      `Selected reference set has ${files.length} files; binding limit is ${binding.limits.maxReferences}.`,
      1,
      room,
    );
  }
  const verifiedReferences = verifyReferences(lookPath, look, files, room);

  const evidenceReceipts: JsonRecord[] = [];
  const evidenceReceiptPath = options.get("evidence-receipt");
  if (evidenceReceiptPath) {
    const evidenceReceipt = readJsonValue(evidenceReceiptPath, "evidence-receipt").value;
    validateEvidenceReceipt(evidenceReceipt, room);
    evidenceReceipts.push(evidenceReceipt);
  }
  const humanReceiptPath = options.get("human-review-receipt");
  let humanReviewReceipt: JsonRecord | null = null;
  if (humanReceiptPath) {
    const receipt = readJsonValue(humanReceiptPath, "human-review-receipt").value;
    validateHumanReviewReceipt(receipt, room);
    humanReviewReceipt = receipt;
  }

  for (const lock of requiredLocks) {
    if (!lock.evidenceRequired) continue;
    const supportingReceipt = evidenceReceipts.find((receipt) => {
      if (receipt.schemaVersion !== "1.0.0" || receipt.kind !== "reference-evidence" || receipt.lockId !== lock.lockId) {
        return false;
      }
      return verifiedReferences.some(
        (reference) =>
          reference.id === receipt.referenceId &&
          reference.sha256 === receipt.referenceSha256 &&
          Array.isArray(reference.supportsLocks) &&
          reference.supportsLocks.includes(lock.lockId),
      );
    });
    if (!supportingReceipt) {
      fail(
        "lock-evidence-missing",
        `Required lock ${lock.lockId} has no matching evidence receipt and supporting reference.`,
        1,
        room,
      );
    }
  }

  for (const lock of requiredLocks) {
    if (lock.enforcement !== "humanReviewRequired") continue;
    const receiptMatchesRequest =
      humanReviewReceipt?.schemaVersion === "1.0.0" &&
      humanReviewReceipt?.kind === "human-review" &&
      humanReviewReceipt?.lookId === look.identity.id &&
      humanReviewReceipt?.intentId === intentId &&
      humanReviewReceipt?.scope === "request-policy" &&
      humanReviewReceipt?.decision === "pass" &&
      typeof humanReviewReceipt?.reviewer === "string" &&
      humanReviewReceipt.reviewer.trim() !== "" &&
      Array.isArray(humanReviewReceipt?.findings) &&
      lock.mustShow.every((clause: string) =>
        humanReviewReceipt.findings.some(
          (finding: JsonRecord) =>
            finding.lockId === lock.lockId && finding.clause === clause && finding.observed === true,
        ),
      );
    if (!receiptMatchesRequest) {
      fail(
        "human-review-receipt-missing",
        `Required lock ${lock.lockId} has no matching passing request-policy review receipt.`,
        1,
        room,
      );
    }
  }

  const observableLocks = requiredLocks.map((lock) => ({
    ...lock,
    humanReviewRequired: lock.enforcement === "humanReviewRequired",
    humanReviewReceiptPresent:
      lock.enforcement === "humanReviewRequired" &&
      humanReviewReceipt?.decision === "pass" &&
      humanReviewReceipt?.lookId === look.identity.id &&
      humanReviewReceipt?.intentId === intentId,
  }));

  const withoutHash: JsonRecord = {
    look: { id: look.identity.id, name: look.identity.name, sha256: sha256(lookRead.bytes) },
    binding: {
      id: binding.id,
      provider: binding.provider,
      model: binding.model,
      limits: binding.limits,
      sha256: sha256(bindingRead.bytes),
    },
    room,
    intent: { id: intentId, kind: intent.kind },
    output: { aspectRatio: intent.aspectRatio, minWidth: intent.minWidth },
    policy: { requiredLocks: observableLocks },
    frozenPromptPrefix: frozenPrefix(look, intentId, intent, observableLocks),
    userPrompt: prompt,
    references: verifiedReferences,
    receipts: { evidence: evidenceReceipts, humanReview: humanReviewReceipt },
  };
  const compiledRequest = { ...withoutHash, requestSha256: sha256(canonicalJson(withoutHash)) };
  return pass(room, compiledRequest);
}

const [command, ...optionArgs] = process.argv.slice(2);
if (command !== "preflight" && command !== "check") {
  fail("arguments-invalid", "Command must be preflight or check.", 2);
}

const allowed =
  command === "preflight"
    ? new Set(["look", "binding", "intent", "prompt", "room", "evidence-receipt", "human-review-receipt"])
    : new Set(["look", "intent", "image"]);
const options = parseOptions(optionArgs, allowed);
const lookPath = options.get("look");
if (!lookPath) fail("arguments-invalid", "Missing required --look option.", 2);
if (command === "preflight" && !options.get("binding")) {
  fail("arguments-invalid", "Missing required --binding option.", 2);
}

const lookRead = readJson(lookPath, "look");
validateLook(lookRead.value);
if (command === "check") runCheck(lookRead.value, options);
const policy = resolvePreflightPolicy(lookRead.value, options);
refuseDeterministicOnly(policy.requiredLocks, policy.room);
const bindingPath = options.get("binding")!;
const bindingRead = readJson(bindingPath, "binding");
validateBinding(bindingRead.value);
runPreflight(lookPath, lookRead, bindingRead, options, policy);
