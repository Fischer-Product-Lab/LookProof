import type { JsonRecord, Room } from "./model.js";
import { raise } from "./outcome.js";

export function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isUniqueNonEmptyStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString) && new Set(value).size === value.length;
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

export function validateLook(look: JsonRecord): void {
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
    if (
      !Array.isArray(look.grammar.palette) ||
      !look.grammar.palette.every(
        (item: unknown) => typeof item === "string" && /^#[0-9A-Fa-f]{6}$/.test(item),
      )
    ) {
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
        if (
          !validateObject(
            lock,
            path,
            ["description", "enforcement", "evidenceRequired", "mustShow", "reviewRule"],
            errors,
          )
        ) {
          continue;
        }
        if (!isNonEmptyString(lock.description)) errors.push(`${path}.description`);
        if (
          lock.enforcement !== undefined &&
          !["generativeLock", "deterministicOnly", "humanReviewRequired"].includes(lock.enforcement)
        ) {
          errors.push(`${path}.enforcement`);
        }
        if (lock.evidenceRequired !== undefined && typeof lock.evidenceRequired !== "boolean") {
          errors.push(`${path}.evidenceRequired`);
        }
        if (lock.mustShow !== undefined && !isUniqueNonEmptyStrings(lock.mustShow)) {
          errors.push(`${path}.mustShow`);
        }
        if (lock.reviewRule !== undefined && !isNonEmptyString(lock.reviewRule)) {
          errors.push(`${path}.reviewRule`);
        }
      }
    }
  }
  if (!isRecord(look.intents) || Object.keys(look.intents).length === 0) {
    errors.push("intents");
  } else {
    for (const [intentId, intent] of Object.entries(look.intents)) {
      const path = `intents.${intentId}`;
      if (
        !validateObject(intent, path, ["kind", "aspectRatio", "minWidth", "referenceSet", "requiredLocks"], errors)
      ) {
        continue;
      }
      if (!isNonEmptyString(intent.kind)) errors.push(`${path}.kind`);
      if (validateObject(intent.aspectRatio, `${path}.aspectRatio`, ["width", "height", "tolerance"], errors)) {
        if (!Number.isInteger(intent.aspectRatio.width) || intent.aspectRatio.width < 1) {
          errors.push(`${path}.aspectRatio.width`);
        }
        if (!Number.isInteger(intent.aspectRatio.height) || intent.aspectRatio.height < 1) {
          errors.push(`${path}.aspectRatio.height`);
        }
        if (
          !Number.isFinite(intent.aspectRatio.tolerance) ||
          intent.aspectRatio.tolerance < 0 ||
          intent.aspectRatio.tolerance > 1
        ) {
          errors.push(`${path}.aspectRatio.tolerance`);
        }
      }
      if (!Number.isInteger(intent.minWidth) || intent.minWidth < 1) errors.push(`${path}.minWidth`);
      if (!isNonEmptyString(intent.referenceSet)) errors.push(`${path}.referenceSet`);
      if (intent.requiredLocks !== undefined && !isUniqueNonEmptyStrings(intent.requiredLocks)) {
        errors.push(`${path}.requiredLocks`);
      }
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
          if (
            !validateObject(
              file,
              path,
              [
                "id",
                "path",
                "sha256",
                "scopes",
                "status",
                "source",
                "permittedUse",
                "knownLimits",
                "supportsLocks",
                "conflictsWithLocks",
              ],
              errors,
            )
          ) {
            return;
          }
          if (!isNonEmptyString(file.id)) errors.push(`${path}.id`);
          if (!isNonEmptyString(file.path)) errors.push(`${path}.path`);
          if (typeof file.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(file.sha256)) {
            errors.push(`${path}.sha256`);
          }
          for (const key of ["scopes", "permittedUse", "knownLimits"]) {
            if (!isUniqueNonEmptyStrings(file[key])) errors.push(`${path}.${key}`);
          }
          for (const key of ["supportsLocks", "conflictsWithLocks"]) {
            if (file[key] !== undefined && !isUniqueNonEmptyStrings(file[key])) errors.push(`${path}.${key}`);
          }
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
    raise("schema-invalid", `Look does not satisfy the runtime schema: ${errors.join(", ")}.`, 1, room);
  }
}

export function validateBinding(binding: JsonRecord): void {
  const errors: string[] = [];
  validateObject(binding, "Binding", ["schemaVersion", "id", "provider", "model", "limits"], errors);
  if (binding.schemaVersion !== "1.0.0") errors.push("binding.schemaVersion");
  for (const key of ["id", "provider", "model"]) {
    if (!isNonEmptyString(binding[key])) errors.push(`binding.${key}`);
  }
  if (validateObject(binding.limits, "binding.limits", ["maxReferences", "requireReferences"], errors)) {
    if (!Number.isInteger(binding.limits.maxReferences) || binding.limits.maxReferences < 0) {
      errors.push("binding.limits.maxReferences");
    }
    if (typeof binding.limits.requireReferences !== "boolean") errors.push("binding.limits.requireReferences");
  }
  if (errors.length > 0) {
    raise("schema-invalid", `Binding does not satisfy the runtime schema: ${errors.join(", ")}.`);
  }
}

function isValidDateTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})[Tt](?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:[Zz]|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(
    value,
  );
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  const calendarDate = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(calendarDate.getTime()) && calendarDate.toISOString().slice(0, 10) === date;
}

export function validateEvidenceReceipt(receipt: unknown, room: Room): asserts receipt is JsonRecord {
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
    raise(
      "schema-invalid",
      `Evidence receipt does not satisfy the runtime schema: ${errors.join(", ")}.`,
      1,
      room,
    );
  }
}

export function validateHumanReviewReceipt(receipt: unknown, room: Room): asserts receipt is JsonRecord {
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
    raise(
      "schema-invalid",
      `Human-review receipt does not satisfy the runtime schema: ${errors.join(", ")}.`,
      1,
      room,
    );
  }
}
