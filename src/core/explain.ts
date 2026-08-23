import { enforceStringLimit, MAX_DETAIL_CHARS, MAX_GATE_CHARS } from "./limits.js";
import type { CoreRun, JsonRecord } from "./model.js";
import { captureCore, localPass } from "./outcome.js";

type Explanation = { summary: string; remediation: string };

const explanations: Readonly<Record<string, Explanation>> = Object.freeze({
  "arguments-invalid": {
    summary: "The command or option shape is invalid.",
    remediation: "Use --help and provide each supported option once as a --name value pair.",
  },
  "input-too-large": {
    summary: "A string input exceeds its configured character limit.",
    remediation: "Shorten the path, gate, intent, prompt, or compatibility detail to the documented limit.",
  },
  "file-too-large": {
    summary: "A JSON document or selected reference exceeds its configured byte limit.",
    remediation: "Provide a smaller JSON document or selected reference within the documented limit.",
  },
  "references-too-large": {
    summary: "The selected references exceed their configured total byte limit.",
    remediation: "Reduce the selected reference set so its combined bytes stay within the documented limit.",
  },
  "look-unreadable": {
    summary: "The Look could not be read as a JSON object.",
    remediation: "Provide a readable UTF-8 JSON Look document.",
  },
  "binding-unreadable": {
    summary: "The binding could not be read as a JSON object.",
    remediation: "Provide a readable UTF-8 JSON binding document.",
  },
  "schema-invalid": {
    summary: "A parsed document does not satisfy its closed runtime schema.",
    remediation: "Correct the fields named by the original verdict and remove unknown properties.",
  },
  "intent-missing": {
    summary: "No intent identifier was supplied.",
    remediation: "Select an intent declared by the Look.",
  },
  "intent-unknown": {
    summary: "The requested intent is not declared by the Look.",
    remediation: "Use an intent identifier present in the Look intents object.",
  },
  "lock-missing": {
    summary: "An intent requires a lock that the Look does not declare.",
    remediation: "Declare the required lock or correct the intent's requiredLocks list.",
  },
  "reference-set-missing": {
    summary: "The selected intent names an undeclared reference set.",
    remediation: "Declare the reference set or correct the intent's referenceSet value.",
  },
  "reference-conflict": {
    summary: "A selected reference explicitly conflicts with a required lock.",
    remediation: "Choose a non-conflicting reference set or revise the declared policy conflict.",
  },
  "deterministic-only-lock": {
    summary: "A deterministic-only lock cannot be represented by a generative request.",
    remediation: "Use a separate deterministic transformation workflow; LookProof will not weaken the lock.",
  },
  "prompt-never": {
    summary: "The prompt contains a term forbidden by the Look.",
    remediation: "Remove the forbidden request from the prompt without changing the Look policy.",
  },
  "invented-chrome": {
    summary: "The prompt requests UI chrome for an intent kind that forbids it.",
    remediation: "Remove UI, HUD, menu, or button language from the prompt.",
  },
  "references-required": {
    summary: "The binding requires references but the selected set is empty.",
    remediation: "Select a non-empty declared reference set.",
  },
  "references-over-limit": {
    summary: "The selected reference count exceeds the binding limit.",
    remediation: "Reduce the selected reference set or choose a binding with an appropriate inert limit.",
  },
  "reference-path-invalid": {
    summary: "A reference path failed local containment or existence checks.",
    remediation: "Use relative paths inside the declared references folder and avoid traversal or link escapes.",
  },
  "reference-unreadable": {
    summary: "A selected reference is not a safely readable regular file.",
    remediation: "Provide a readable regular file inside the declared references folder.",
  },
  "reference-hash-mismatch": {
    summary: "Reference bytes do not match the declared SHA-256.",
    remediation: "Restore the declared bytes or deliberately update the Look with the verified SHA-256.",
  },
  "evidence-receipt-unreadable": {
    summary: "The evidence receipt could not be read as JSON.",
    remediation: "Provide a readable evidence-receipt JSON document.",
  },
  "human-review-receipt-unreadable": {
    summary: "The human-review receipt could not be read as JSON.",
    remediation: "Provide a readable human-review-receipt JSON document.",
  },
  "lock-evidence-missing": {
    summary: "An evidence-required lock lacks a matching receipt and supporting reference.",
    remediation: "Provide the single matching evidence receipt for a selected supporting reference.",
  },
  "human-review-receipt-missing": {
    summary: "A human-review-required lock lacks a matching passing request-policy receipt.",
    remediation: "Review the request policy locally and provide a matching passing receipt with observed clauses.",
  },
  "image-unreadable": {
    summary: "The image is not a readable regular file.",
    remediation: "Provide a readable local PNG file.",
  },
  "image-not-png": {
    summary: "The image lacks a valid PNG signature and readable nonzero IHDR dimensions.",
    remediation: "Provide a PNG with a standard IHDR header and nonzero dimensions.",
  },
  "format-width": {
    summary: "The PNG width is below the intent minimum.",
    remediation: "Provide a wider PNG that meets the declared minimum width.",
  },
  "format-aspect": {
    summary: "The PNG aspect ratio exceeds the intent tolerance.",
    remediation: "Provide a PNG within the declared aspect-ratio tolerance.",
  },
});

const unknownExplanation: Explanation = {
  summary: "The refusal gate is not in LookProof's closed local explanation table.",
  remediation: "Review the original verdict and command inputs; no files were reread.",
};

export function explainRefusal(gate: string, _detail?: string): CoreRun {
  return captureCore(() => {
    enforceStringLimit(gate, MAX_GATE_CHARS);
    enforceStringLimit(_detail, MAX_DETAIL_CHARS);
    const explanation = Object.hasOwn(explanations, gate) ? explanations[gate]! : unknownExplanation;
    const data: JsonRecord = {
      refusalGate: gate,
      summary: explanation.summary,
      remediation: explanation.remediation,
    };
    return localPass("locked", "Refusal explanation generated locally; no inputs were reread.", data);
  });
}
