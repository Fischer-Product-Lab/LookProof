import { canonicalJson, sha256 } from "./hash.js";
import { enforceStringLimit, MAX_INTENT_CHARS, MAX_PATH_CHARS, MAX_PROMPT_CHARS } from "./limits.js";
import type { CompileRequestInput, CoreRun, Files, JsonRecord, Room } from "./model.js";
import { captureCore, preflightPass, raise } from "./outcome.js";
import {
  isRecord,
  validateBinding,
  validateEvidenceReceipt,
  validateHumanReviewReceipt,
  validateLook,
} from "./validators.js";

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

function resolvePreflightPolicy(look: JsonRecord, input: CompileRequestInput) {
  const requestedRoom = input.room;
  const defaultRoom: Room = look.defaultRoom === "explore" ? "explore" : "locked";
  if (requestedRoom !== undefined && requestedRoom !== "explore" && requestedRoom !== "locked") {
    raise("arguments-invalid", "--room must be explore or locked.", 2, defaultRoom);
  }
  const room: Room = requestedRoom === undefined ? defaultRoom : requestedRoom;
  const intentId = input.intentId;
  if (!intentId) raise("intent-missing", "Missing required --intent option.", 1, room);
  const intent = look.intents?.[intentId];
  if (!isRecord(intent)) raise("intent-unknown", `Intent ${intentId} is not declared by this Look.`, 1, room);
  const requiredLockIds: string[] = intent.requiredLocks ?? [];
  const requiredLocks: JsonRecord[] = requiredLockIds.map((lockId) => {
    const declared = look.locks?.[lockId];
    if (!isRecord(declared)) raise("lock-missing", `Required lock ${lockId} is not declared.`, 1, room);
    return { lockId, ...effectiveLock(declared) };
  });
  const referenceSet = look.references?.sets?.[intent.referenceSet];
  if (!isRecord(referenceSet) || !Array.isArray(referenceSet.files)) {
    raise("reference-set-missing", `Reference set ${String(intent.referenceSet)} is not declared.`, 1, room);
  }
  const files = referenceSet.files as JsonRecord[];
  for (const lockId of requiredLockIds) {
    const conflictingReference = files.find(
      (file) => Array.isArray(file.conflictsWithLocks) && file.conflictsWithLocks.includes(lockId),
    );
    if (conflictingReference) {
      raise(
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
    raise(
      "deterministic-only-lock",
      `Required lock ${String(deterministicLock.lockId)} is deterministic-only and cannot be compiled into a generative request.`,
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

export function compileRequest(filesApi: Files, input: CompileRequestInput): CoreRun {
  return captureCore(() => {
    enforceStringLimit(input.lookPath, MAX_PATH_CHARS);
    enforceStringLimit(input.bindingPath, MAX_PATH_CHARS);
    enforceStringLimit(input.intentId, MAX_INTENT_CHARS);
    enforceStringLimit(input.prompt, MAX_PROMPT_CHARS);
    enforceStringLimit(input.evidenceReceiptPath, MAX_PATH_CHARS);
    enforceStringLimit(input.humanReviewReceiptPath, MAX_PATH_CHARS);
    const lookRead = filesApi.readJsonObject(input.lookPath, "look");
    const look = lookRead.value;
    validateLook(look);
    const policy = resolvePreflightPolicy(look, input);
    refuseDeterministicOnly(policy.requiredLocks, policy.room);

    const bindingRead = filesApi.readJsonObject(input.bindingPath, "binding");
    const binding = bindingRead.value;
    validateBinding(binding);

    const { room, intentId, intent, requiredLocks, files } = policy;
    const prompt = input.prompt;
    if (prompt === undefined) raise("arguments-invalid", "Missing required --prompt option.", 2, room);
    const forbiddenPromptEntry = findForbiddenPromptEntry(prompt, look.nevers.promptNever);
    if (forbiddenPromptEntry !== undefined) {
      raise("prompt-never", `Prompt matches declared never: ${forbiddenPromptEntry}.`, 1, room);
    }
    if (look.nevers.forbidUiChromeForKinds.includes(intent.kind)) {
      const chromeEntry = findForbiddenPromptEntry(prompt, ["ui", "hud", "menu", "menus", "button", "buttons"]);
      if (chromeEntry !== undefined) {
        raise("invented-chrome", `Prompt asks for forbidden UI chrome: ${chromeEntry}.`, 1, room);
      }
    }
    if (binding.limits.requireReferences && files.length === 0) {
      raise("references-required", "The selected binding requires at least one reference file.", 1, room);
    }
    if (files.length > binding.limits.maxReferences) {
      raise(
        "references-over-limit",
        `Selected reference set has ${files.length} files; binding limit is ${binding.limits.maxReferences}.`,
        1,
        room,
      );
    }
    const verifiedReferences = filesApi.verifyReferences(input.lookPath, look, files, room);

    const evidenceReceipts: JsonRecord[] = [];
    if (input.evidenceReceiptPath) {
      const evidenceReceipt = filesApi.readJsonValue(input.evidenceReceiptPath, "evidence-receipt").value;
      validateEvidenceReceipt(evidenceReceipt, room);
      evidenceReceipts.push(evidenceReceipt);
    }
    let humanReviewReceipt: JsonRecord | null = null;
    if (input.humanReviewReceiptPath) {
      const receipt = filesApi.readJsonValue(input.humanReviewReceiptPath, "human-review-receipt").value;
      validateHumanReviewReceipt(receipt, room);
      humanReviewReceipt = receipt;
    }

    for (const lock of requiredLocks) {
      if (!lock.evidenceRequired) continue;
      const supportingReceipt = evidenceReceipts.find((receipt) => {
        if (
          receipt.schemaVersion !== "1.0.0" ||
          receipt.kind !== "reference-evidence" ||
          receipt.lockId !== lock.lockId
        ) {
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
        raise(
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
        humanReviewReceipt.kind === "human-review" &&
        humanReviewReceipt.lookId === look.identity.id &&
        humanReviewReceipt.intentId === intentId &&
        humanReviewReceipt.scope === "request-policy" &&
        humanReviewReceipt.decision === "pass" &&
        typeof humanReviewReceipt.reviewer === "string" &&
        humanReviewReceipt.reviewer.trim() !== "" &&
        Array.isArray(humanReviewReceipt.findings) &&
        lock.mustShow.every((clause: string) =>
          humanReviewReceipt.findings.some(
            (finding: JsonRecord) =>
              finding.lockId === lock.lockId && finding.clause === clause && finding.observed === true,
          ),
        );
      if (!receiptMatchesRequest) {
        raise(
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
        humanReviewReceipt.lookId === look.identity.id &&
        humanReviewReceipt.intentId === intentId,
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
    return preflightPass(room, compiledRequest);
  });
}
