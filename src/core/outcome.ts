import type { CoreRun, ExitCode, JsonRecord, Room } from "./model.js";

export class CoreFault extends Error {
  readonly run: CoreRun;

  constructor(run: CoreRun) {
    super(run.verdict.detail);
    this.name = "CoreFault";
    this.run = run;
  }
}

export function failureRun(
  gate: string,
  detail: string,
  exitCode: ExitCode = 1,
  room: Room = "locked",
): CoreRun {
  return {
    exitCode,
    verdict: {
      status: "fail",
      room,
      gate,
      detail,
      warnings: [],
      compiledRequest: null,
      dispatched: false,
    },
  };
}

export function raise(
  gate: string,
  detail: string,
  exitCode: ExitCode = 1,
  room: Room = "locked",
): never {
  throw new CoreFault(failureRun(gate, detail, exitCode, room));
}

export function preflightPass(room: Room, compiledRequest: JsonRecord): CoreRun {
  return {
    exitCode: 0,
    verdict: {
      status: "pass",
      room,
      gate: "pass",
      detail: "Creative-policy preflight compiled locally; no provider call occurred.",
      warnings: [],
      compiledRequest,
      dispatched: false,
    },
  };
}

export function checkPass(room: Room, width: number, height: number): CoreRun {
  return {
    exitCode: 0,
    verdict: {
      status: "pass",
      room,
      gate: "pass",
      detail: `Mechanical PNG format passes (${width}x${height}); no visual-policy claim was made.`,
      warnings: [],
      compiledRequest: null,
      dispatched: false,
    },
  };
}

export function localPass(room: Room, detail: string, data: JsonRecord): CoreRun {
  return {
    exitCode: 0,
    verdict: {
      status: "pass",
      room,
      gate: "pass",
      detail,
      warnings: [],
      compiledRequest: null,
      dispatched: false,
      data,
    },
  };
}

export function captureCore(operation: () => CoreRun): CoreRun {
  try {
    return operation();
  } catch (error) {
    if (error instanceof CoreFault) return error.run;
    return {
      ...failureRun("internal-error", "An unexpected local error occurred."),
      internalError: error,
    };
  }
}
