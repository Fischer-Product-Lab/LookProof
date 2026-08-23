import { sha256 } from "./hash.js";
import { enforceStringLimit, MAX_PATH_CHARS } from "./limits.js";
import type { CoreRun, Files, JsonRecord, Room } from "./model.js";
import { captureCore, localPass, raise } from "./outcome.js";
import {
  isRecord,
  validateBinding,
  validateEvidenceReceipt,
  validateHumanReviewReceipt,
  validateLook,
} from "./validators.js";

export const schemaNames = ["look", "binding", "evidence-receipt", "human-review-receipt"] as const;
export type SchemaName = (typeof schemaNames)[number];

export function isSchemaName(value: string): value is SchemaName {
  return (schemaNames as readonly string[]).includes(value);
}

export function validateDocument(files: Files, schema: SchemaName, filePath: string): CoreRun {
  return captureCore(() => {
    enforceStringLimit(filePath, MAX_PATH_CHARS);
    const read = files.readJsonValue(filePath, schema);
    const value = read.value;
    let room: Room = "locked";
    if (schema === "look") {
      if (!isRecord(value)) {
        raise("schema-invalid", "Look does not satisfy the runtime schema: Look.");
      }
      validateLook(value);
      room = value.defaultRoom === "explore" ? "explore" : "locked";
    } else if (schema === "binding") {
      if (!isRecord(value)) {
        raise("schema-invalid", "Binding does not satisfy the runtime schema: Binding.");
      }
      validateBinding(value);
    } else if (schema === "evidence-receipt") {
      validateEvidenceReceipt(value, room);
    } else {
      validateHumanReviewReceipt(value, room);
    }
    const data: JsonRecord = { schema, sha256: sha256(read.bytes) };
    return localPass(
      room,
      `Document satisfies the ${schema} runtime schema; no references or cross-document readiness were checked.`,
      data,
    );
  });
}

function validateInternalLinks(look: JsonRecord, room: Room): void {
  for (const [intentId, intent] of Object.entries(look.intents as JsonRecord)) {
    for (const lockId of (intent.requiredLocks ?? []) as string[]) {
      if (!isRecord(look.locks?.[lockId])) {
        raise("look-link-invalid", `Intent ${intentId} requires undeclared lock ${lockId}.`, 1, room);
      }
    }
    if (!isRecord(look.references.sets[intent.referenceSet])) {
      raise(
        "look-link-invalid",
        `Intent ${intentId} selects undeclared reference set ${String(intent.referenceSet)}.`,
        1,
        room,
      );
    }
  }
  for (const set of Object.values(look.references.sets as JsonRecord)) {
    for (const reference of set.files as JsonRecord[]) {
      for (const key of ["supportsLocks", "conflictsWithLocks"]) {
        for (const lockId of (reference[key] ?? []) as string[]) {
          if (!isRecord(look.locks?.[lockId])) {
            raise(
              "look-link-invalid",
              `Reference ${String(reference.id)} links to undeclared lock ${lockId}.`,
              1,
              room,
            );
          }
        }
      }
    }
  }
}

export function validateLookDocument(files: Files, filePath: string): CoreRun {
  return captureCore(() => {
    enforceStringLimit(filePath, MAX_PATH_CHARS);
    const read = files.readJsonValue(filePath, "look");
    if (!isRecord(read.value)) {
      raise("schema-invalid", "Look does not satisfy the runtime schema: Look.");
    }
    validateLook(read.value);
    const room: Room = read.value.defaultRoom === "explore" ? "explore" : "locked";
    validateInternalLinks(read.value, room);
    return localPass(
      room,
      "Look schema and internal links are valid; reference files were not read.",
      { schema: "look", sha256: sha256(read.bytes) },
    );
  });
}
