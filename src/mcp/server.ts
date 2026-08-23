import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import {
  checkImage,
  compileRequest,
  explainRefusal,
  failureRun,
  MAX_DETAIL_CHARS,
  MAX_GATE_CHARS,
  MAX_INTENT_CHARS,
  MAX_PATH_CHARS,
  MAX_PROMPT_CHARS,
  validateLookDocument,
  type CompileRequestInput,
  type CoreRun,
  type RootedFiles,
} from "../core/index.js";

const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const relativePath = z.string().min(1).max(MAX_PATH_CHARS);

function textResult(operation: () => CoreRun, onInternalError: () => void) {
  let run: CoreRun;
  try {
    run = operation();
  } catch {
    onInternalError();
    run = failureRun("internal-error", "An unexpected local error occurred.");
  }
  if (run.internalError !== undefined) onInternalError();
  return { content: [{ type: "text" as const, text: JSON.stringify(run.verdict) }] };
}

export function createLookProofServer(files: RootedFiles, onInternalError: () => void = () => {}): McpServer {
  const server = new McpServer(
    { name: "lookproof", title: "LookProof", version: "0.2.0" },
    { capabilities: { tools: { listChanged: false } } },
  );

  server.registerTool(
    "validate_look",
    {
      description: "Validate a Look's schema and internal links locally without reading reference bytes or checking readiness.",
      inputSchema: z.object({ look_path: relativePath }).strict(),
      annotations,
    },
    async ({ look_path }) => textResult(() => validateLookDocument(files, look_path), onInternalError),
  );

  server.registerTool(
    "compile_request",
    {
      description:
        "Compile a local provider-neutral request after verifying references, hashes, and required receipts; never calls a provider or writes files.",
      inputSchema: z
        .object({
          look_path: relativePath,
          binding_path: relativePath,
          intent_id: z.string().min(1).max(MAX_INTENT_CHARS),
          prompt: z.string().max(MAX_PROMPT_CHARS),
          room: z.enum(["explore", "locked"]).optional(),
          evidence_receipt_path: relativePath.optional(),
          human_review_receipt_path: relativePath.optional(),
        })
        .strict(),
      annotations,
    },
    async (args) =>
      textResult(() => {
        const input: CompileRequestInput = {
          lookPath: args.look_path,
          bindingPath: args.binding_path,
          intentId: args.intent_id,
          prompt: args.prompt,
        };
        if (args.room !== undefined) input.room = args.room;
        if (args.evidence_receipt_path !== undefined) input.evidenceReceiptPath = args.evidence_receipt_path;
        if (args.human_review_receipt_path !== undefined) {
          input.humanReviewReceiptPath = args.human_review_receipt_path;
        }
        return compileRequest(files, input);
      }, onInternalError),
  );

  server.registerTool(
    "check_image",
    {
      description:
        "Check only a local PNG signature, IHDR dimensions, minimum width, and aspect ratio; never judges pixels.",
      inputSchema: z
        .object({
          look_path: relativePath,
          intent_id: z.string().min(1).max(MAX_INTENT_CHARS),
          image_path: relativePath,
        })
        .strict(),
      annotations,
    },
    async ({ look_path, intent_id, image_path }) =>
      textResult(
        () => checkImage(files, { lookPath: look_path, intentId: intent_id, imagePath: image_path }),
        onInternalError,
      ),
  );

  server.registerTool(
    "explain_refusal",
    {
      description: "Explain a LookProof refusal gate from a closed local table without reading files.",
      inputSchema: z
        .object({
          gate: z.string().min(1).max(MAX_GATE_CHARS),
          detail: z.string().max(MAX_DETAIL_CHARS).optional(),
        })
        .strict(),
      annotations,
    },
    async ({ gate, detail }) => textResult(() => explainRefusal(gate, detail), onInternalError),
  );

  return server;
}
