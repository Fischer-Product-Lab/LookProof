export type JsonRecord = Record<string, any>;
export type Room = "explore" | "locked";
export type ExitCode = 0 | 1 | 2;

export type Verdict = {
  status: "pass" | "fail";
  room: Room;
  gate: string;
  detail: string;
  warnings: string[];
  compiledRequest: JsonRecord | null;
  dispatched: false;
  data?: JsonRecord;
};

export type CoreRun = {
  exitCode: ExitCode;
  verdict: Verdict;
  internalError?: unknown;
};

export type JsonRead = {
  bytes: Buffer;
  value: unknown;
};

export interface Files {
  readJsonValue(path: string, label: string): JsonRead;
  readJsonObject(path: string, label: string): { bytes: Buffer; value: JsonRecord };
  readBytes(path: string): Buffer;
  readPrefix(path: string, length: number): Buffer;
  verifyReferences(lookPath: string, look: JsonRecord, files: JsonRecord[], room: Room): JsonRecord[];
}

export type CompileRequestInput = {
  lookPath: string;
  bindingPath: string;
  intentId?: string;
  prompt?: string;
  room?: string;
  evidenceReceiptPath?: string;
  humanReviewReceiptPath?: string;
};

export type CheckImageInput = {
  lookPath: string;
  intentId?: string;
  imagePath?: string;
};
