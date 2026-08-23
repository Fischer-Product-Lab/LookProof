#!/usr/bin/env node

import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { RootConfigurationError, RootedFiles } from "./core/index.js";
import { createLookProofServer } from "./mcp/server.js";

function startupRoot(args: string[]): string | undefined {
  if (args.length !== 2 || args[0] !== "--root" || args[1] === undefined || args[1].trim() === "") {
    return undefined;
  }
  return args[1];
}

function diagnostic(message: string): void {
  process.stderr.write(`lookproof mcp: ${message}.\n`);
}

function fatal(message: string): void {
  process.stderr.write(`lookproof mcp: ${message}.\n`, () => process.exit(2));
}

const rootPath = startupRoot(process.argv.slice(2));
if (rootPath === undefined) {
  fatal("invalid startup arguments");
} else {
  try {
    const files = RootedFiles.create(rootPath);
    const handle = serveStdio(() => createLookProofServer(files, () => diagnostic("internal error")), {
      onerror: () => diagnostic("protocol error"),
    });
    let closing = false;
    const close = (): void => {
      if (closing) return;
      closing = true;
      void handle.close().catch(() => diagnostic("close error"));
    };
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
  } catch (error) {
    if (error instanceof RootConfigurationError) {
      fatal("root must resolve to a directory");
    } else {
      fatal("startup failed");
    }
  }
}
