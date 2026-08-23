import { enforceStringLimit, MAX_INTENT_CHARS, MAX_PATH_CHARS } from "./limits.js";
import type { CheckImageInput, CoreRun, Files, Room } from "./model.js";
import { captureCore, checkPass, raise } from "./outcome.js";
import { isRecord, validateLook } from "./validators.js";

export function checkImage(files: Files, input: CheckImageInput): CoreRun {
  return captureCore(() => {
    enforceStringLimit(input.lookPath, MAX_PATH_CHARS);
    enforceStringLimit(input.intentId, MAX_INTENT_CHARS);
    enforceStringLimit(input.imagePath, MAX_PATH_CHARS);
    const lookRead = files.readJsonObject(input.lookPath, "look");
    const look = lookRead.value;
    validateLook(look);
    const room: Room = look.defaultRoom === "explore" ? "explore" : "locked";
    const intentId = input.intentId;
    if (!intentId) raise("intent-missing", "Missing required --intent option.", 1, room);
    const intent = look.intents?.[intentId];
    if (!isRecord(intent)) raise("intent-unknown", `Intent ${intentId} is not declared by this Look.`, 1, room);
    const imagePath = input.imagePath;
    if (!imagePath) raise("arguments-invalid", "Missing required --image option.", 2, room);

    let bytes: Buffer;
    try {
      bytes = files.readPrefix(imagePath, 24);
    } catch {
      raise("image-unreadable", "Image file could not be read.", 1, room);
    }
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (
      bytes.length < 24 ||
      !bytes.subarray(0, 8).equals(signature) ||
      bytes.readUInt32BE(8) !== 13 ||
      bytes.subarray(12, 16).toString("ascii") !== "IHDR"
    ) {
      raise("image-not-png", "Image is not a PNG with a readable IHDR header.", 1, room);
    }
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    if (width === 0 || height === 0) raise("image-not-png", "PNG dimensions must be nonzero.", 1, room);
    if (width < intent.minWidth) {
      raise("format-width", `PNG width ${width}px is below the required ${intent.minWidth}px.`, 1, room);
    }
    const expectedRatio = intent.aspectRatio.width / intent.aspectRatio.height;
    const aspectError = Math.abs(width / height - expectedRatio) / expectedRatio;
    if (aspectError > intent.aspectRatio.tolerance) {
      raise(
        "format-aspect",
        `PNG aspect error ${aspectError.toFixed(6)} exceeds tolerance ${intent.aspectRatio.tolerance}.`,
        1,
        room,
      );
    }
    return checkPass(room, width, height);
  });
}
