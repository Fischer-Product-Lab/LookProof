import { raise } from "./outcome.js";

export const MAX_PATH_CHARS = 4096;
export const MAX_GATE_CHARS = 128;
export const MAX_INTENT_CHARS = 256;
export const MAX_PROMPT_CHARS = 8_192;
export const MAX_DETAIL_CHARS = 4096;
export const MAX_JSON_BYTES = 1_048_576;
export const MAX_REFERENCE_BYTES = 25 * 1_048_576;
export const MAX_TOTAL_REFERENCE_BYTES = 100 * 1_048_576;

export function enforceStringLimit(value: string | undefined, maximum: number): void {
  if (value !== undefined && value.length > maximum) {
    raise("input-too-large", "An input exceeds its configured character limit.");
  }
}
