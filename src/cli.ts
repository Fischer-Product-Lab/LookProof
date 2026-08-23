#!/usr/bin/env node

import {
  checkImage,
  compileRequest,
  explainRefusal,
  failureRun,
  isSchemaName,
  NodeFiles,
  validateDocument,
  type CheckImageInput,
  type CompileRequestInput,
  type CoreRun,
} from "./core/index.js";

const HELP = `LookProof 0.2.0
Usage:
  lookproof preflight --look PATH --binding PATH --intent ID --prompt TEXT [--room explore|locked] [--evidence-receipt PATH] [--human-review-receipt PATH]
  lookproof check --look PATH --intent ID --image PATH
  lookproof validate --schema look|binding|evidence-receipt|human-review-receipt --file PATH
  lookproof explain --gate GATE [--detail TEXT]

Global options:
  --help       Show this local command reference.
  --version    Print the LookProof version.

Exit 0: command passed.
Exit 1: a declared check or input contract refused the operation.
Exit 2: command arguments were invalid or required JSON could not be read.
`;

function parseOptions(args: string[], allowed: Set<string>): Map<string, string> | CoreRun {
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      return failureRun("arguments-invalid", "Options must be provided as --name value pairs.", 2);
    }
    const name = key.slice(2);
    if (!allowed.has(name) || options.has(name)) {
      return failureRun("arguments-invalid", `Unknown or duplicate option: --${name}.`, 2);
    }
    options.set(name, value);
  }
  return options;
}

export function runCli(args: string[]): CoreRun {
  const [command, ...optionArgs] = args;
  if (command !== "preflight" && command !== "check" && command !== "validate" && command !== "explain") {
    return failureRun("arguments-invalid", "Command must be preflight or check.", 2);
  }

  let allowed: Set<string>;
  if (command === "preflight") {
    allowed = new Set(["look", "binding", "intent", "prompt", "room", "evidence-receipt", "human-review-receipt"]);
  } else if (command === "check") {
    allowed = new Set(["look", "intent", "image"]);
  } else if (command === "validate") {
    allowed = new Set(["schema", "file"]);
  } else {
    allowed = new Set(["gate", "detail"]);
  }
  const parsed = parseOptions(optionArgs, allowed);
  if (!(parsed instanceof Map)) return parsed;

  if (command === "validate") {
    const schema = parsed.get("schema");
    const filePath = parsed.get("file");
    if (!schema) return failureRun("arguments-invalid", "Missing required --schema option.", 2);
    if (!filePath) return failureRun("arguments-invalid", "Missing required --file option.", 2);
    if (!isSchemaName(schema)) {
      return failureRun(
        "arguments-invalid",
        "--schema must be look, binding, evidence-receipt, or human-review-receipt.",
        2,
      );
    }
    return validateDocument(new NodeFiles(), schema, filePath);
  }

  if (command === "explain") {
    const gate = parsed.get("gate");
    if (!gate) return failureRun("arguments-invalid", "Missing required --gate option.", 2);
    return explainRefusal(gate, parsed.get("detail"));
  }

  const lookPath = parsed.get("look");
  if (!lookPath) return failureRun("arguments-invalid", "Missing required --look option.", 2);
  if (command === "preflight" && !parsed.get("binding")) {
    return failureRun("arguments-invalid", "Missing required --binding option.", 2);
  }

  const files = new NodeFiles();
  if (command === "check") {
    const input: CheckImageInput = { lookPath };
    const intentId = parsed.get("intent");
    const imagePath = parsed.get("image");
    if (intentId !== undefined) input.intentId = intentId;
    if (imagePath !== undefined) input.imagePath = imagePath;
    return checkImage(files, input);
  }

  const input: CompileRequestInput = { lookPath, bindingPath: parsed.get("binding") as string };
  const intentId = parsed.get("intent");
  const prompt = parsed.get("prompt");
  const room = parsed.get("room");
  const evidenceReceiptPath = parsed.get("evidence-receipt");
  const humanReviewReceiptPath = parsed.get("human-review-receipt");
  if (intentId !== undefined) input.intentId = intentId;
  if (prompt !== undefined) input.prompt = prompt;
  if (room !== undefined) input.room = room;
  if (evidenceReceiptPath !== undefined) input.evidenceReceiptPath = evidenceReceiptPath;
  if (humanReviewReceiptPath !== undefined) input.humanReviewReceiptPath = humanReviewReceiptPath;
  return compileRequest(files, input);
}

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--help") {
  process.stdout.write(HELP);
} else if (args.length === 1 && args[0] === "--version") {
  process.stdout.write("lookproof 0.2.0\n");
} else {
  const result = runCli(args);
  process.stdout.write(`${JSON.stringify(result.verdict)}\n`);
  process.exitCode = result.exitCode;
}
