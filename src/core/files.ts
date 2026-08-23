import { closeSync, existsSync, openSync, readFileSync, readSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, posix, relative, resolve, sep, win32 } from "node:path";

import { sha256 } from "./hash.js";
import {
  enforceStringLimit,
  MAX_JSON_BYTES,
  MAX_PATH_CHARS,
  MAX_REFERENCE_BYTES,
  MAX_TOTAL_REFERENCE_BYTES,
} from "./limits.js";
import type { Files, JsonRead, JsonRecord, Room } from "./model.js";
import { raise } from "./outcome.js";
import { isRecord } from "./validators.js";

function isContained(base: string, candidate: string): boolean {
  const relation = relative(base, candidate);
  return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
}

function readPrefixSync(path: string, length: number): Buffer {
  const bytes = Buffer.alloc(length);
  const descriptor = openSync(path, "r");
  let offset = 0;
  try {
    while (offset < length) {
      const count = readSync(descriptor, bytes, offset, length - offset, offset);
      if (count === 0) break;
      offset += count;
    }
  } finally {
    closeSync(descriptor);
  }
  return bytes.subarray(0, offset);
}

export class NodeFiles implements Files {
  readJsonValue(path: string, label: string): JsonRead {
    let size: number;
    try {
      const stats = statSync(path);
      if (!stats.isFile()) throw new Error("not a regular file");
      size = stats.size;
    } catch {
      raise(`${label}-unreadable`, `${label.charAt(0).toUpperCase()}${label.slice(1)} could not be read as JSON.`, 2);
    }
    if (size > MAX_JSON_BYTES) {
      raise("file-too-large", "A JSON input exceeds the configured byte limit.");
    }
    try {
      const bytes = readFileSync(path);
      const value: unknown = JSON.parse(bytes.toString("utf8"));
      return { bytes, value };
    } catch {
      raise(`${label}-unreadable`, `${label.charAt(0).toUpperCase()}${label.slice(1)} could not be read as JSON.`, 2);
    }
  }

  readJsonObject(path: string, label: string): { bytes: Buffer; value: JsonRecord } {
    const read = this.readJsonValue(path, label);
    if (!isRecord(read.value)) {
      raise(`${label}-unreadable`, `${label.charAt(0).toUpperCase()}${label.slice(1)} must be a JSON object.`, 2);
    }
    return { bytes: read.bytes, value: read.value };
  }

  readBytes(path: string): Buffer {
    if (!existsSync(path) || !statSync(path).isFile()) throw new Error("not a regular file");
    return readFileSync(path);
  }

  readPrefix(path: string, length: number): Buffer {
    if (!existsSync(path) || !statSync(path).isFile()) throw new Error("not a regular file");
    return readPrefixSync(path, length);
  }

  verifyReferences(lookPath: string, look: JsonRecord, files: JsonRecord[], room: Room): JsonRecord[] {
    const lookRoot = dirname(resolve(lookPath));
    const configuredRoot = look.paths?.references;
    if (typeof configuredRoot !== "string" || configuredRoot.trim() === "" || isAbsolute(configuredRoot)) {
      raise("reference-path-invalid", "Configured references path must be a non-empty relative path.", 1, room);
    }
    enforceStringLimit(configuredRoot, MAX_PATH_CHARS);
    const referencesRoot = resolve(lookRoot, configuredRoot);
    if (!isContained(lookRoot, referencesRoot) || !existsSync(referencesRoot)) {
      raise("reference-path-invalid", "Configured references path must resolve inside the Look folder.", 1, room);
    }

    let lookRootReal: string;
    let referencesRootReal: string;
    try {
      lookRootReal = realpathSync(lookRoot);
      referencesRootReal = realpathSync(referencesRoot);
      if (!statSync(referencesRootReal).isDirectory() || !isContained(lookRootReal, referencesRootReal)) {
        throw new Error("unsafe root");
      }
    } catch {
      raise("reference-path-invalid", "Configured references folder could not be safely resolved.", 1, room);
    }

    let totalBytes = 0;
    return files.map((file) => {
      if (typeof file.path !== "string" || isAbsolute(file.path)) {
        raise("reference-path-invalid", `Reference ${String(file.id)} must use a relative path.`, 1, room);
      }
      enforceStringLimit(file.path, MAX_PATH_CHARS);
      const candidate = resolve(lookRoot, file.path);
      if (!isContained(referencesRoot, candidate) || !existsSync(candidate)) {
        raise(
          "reference-path-invalid",
          `Reference ${String(file.id)} escapes or is missing from the references folder.`,
          1,
          room,
        );
      }
      let candidateReal: string;
      let size: number;
      try {
        candidateReal = realpathSync(candidate);
        const stats = statSync(candidateReal);
        if (!isContained(referencesRootReal, candidateReal) || !stats.isFile()) {
          throw new Error("unsafe reference");
        }
        size = stats.size;
      } catch {
        raise("reference-unreadable", `Reference ${String(file.id)} could not be safely read.`, 1, room);
      }
      if (size > MAX_REFERENCE_BYTES) {
        raise("file-too-large", "A selected reference exceeds the configured byte limit.", 1, room);
      }
      totalBytes += size;
      if (totalBytes > MAX_TOTAL_REFERENCE_BYTES) {
        raise("references-too-large", "Selected references exceed the configured total byte limit.", 1, room);
      }
      let actualHash: string;
      try {
        actualHash = sha256(readFileSync(candidateReal));
      } catch {
        raise("reference-unreadable", `Reference ${String(file.id)} could not be safely read.`, 1, room);
      }
      if (actualHash !== file.sha256) {
        raise(
          "reference-hash-mismatch",
          `Reference ${String(file.id)} does not match its declared SHA-256.`,
          1,
          room,
        );
      }
      return { ...file, path: file.path, sha256: actualHash };
    });
  }
}

export class RootConfigurationError extends Error {
  constructor() {
    super("Root must resolve to a directory.");
    this.name = "RootConfigurationError";
  }
}

export class RootedPathError extends Error {
  constructor() {
    super("Path is not a contained regular file.");
    this.name = "RootedPathError";
  }
}

function safeRelativePath(value: string): string {
  if (
    value.length === 0 ||
    value.includes("\0") ||
    value.startsWith("/") ||
    value.startsWith("\\") ||
    /^[A-Za-z]:/.test(value) ||
    posix.isAbsolute(value) ||
    win32.isAbsolute(value)
  ) {
    throw new RootedPathError();
  }
  const segments = value.split(/[\\/]+/);
  if (segments.some((segment) => segment === "..")) throw new RootedPathError();
  return segments.filter((segment) => segment !== "" && segment !== ".").join(sep);
}

export class RootedFiles implements Files {
  readonly #root: string;

  private constructor(root: string) {
    this.#root = root;
  }

  static create(rootPath: string): RootedFiles {
    try {
      const root = realpathSync(rootPath);
      if (!statSync(root).isDirectory()) throw new RootConfigurationError();
      return new RootedFiles(root);
    } catch {
      throw new RootConfigurationError();
    }
  }

  #regularFile(path: string): string {
    try {
      const normalized = safeRelativePath(path);
      const candidate = resolve(this.#root, normalized);
      if (!isContained(this.#root, candidate)) throw new RootedPathError();
      const real = realpathSync(candidate);
      if (!isContained(this.#root, real) || !statSync(real).isFile()) throw new RootedPathError();
      return real;
    } catch {
      throw new RootedPathError();
    }
  }

  readJsonValue(path: string, label: string): JsonRead {
    let regularPath: string;
    let size: number;
    try {
      regularPath = this.#regularFile(path);
      size = statSync(regularPath).size;
    } catch {
      raise(`${label}-unreadable`, `${label.charAt(0).toUpperCase()}${label.slice(1)} could not be read as JSON.`, 2);
    }
    if (size > MAX_JSON_BYTES) {
      raise("file-too-large", "A JSON input exceeds the configured byte limit.");
    }
    try {
      const bytes = readFileSync(regularPath);
      const value: unknown = JSON.parse(bytes.toString("utf8"));
      return { bytes, value };
    } catch {
      raise(`${label}-unreadable`, `${label.charAt(0).toUpperCase()}${label.slice(1)} could not be read as JSON.`, 2);
    }
  }

  readJsonObject(path: string, label: string): { bytes: Buffer; value: JsonRecord } {
    const read = this.readJsonValue(path, label);
    if (!isRecord(read.value)) {
      raise(`${label}-unreadable`, `${label.charAt(0).toUpperCase()}${label.slice(1)} must be a JSON object.`, 2);
    }
    return { bytes: read.bytes, value: read.value };
  }

  readBytes(path: string): Buffer {
    return readFileSync(this.#regularFile(path));
  }

  readPrefix(path: string, length: number): Buffer {
    return readPrefixSync(this.#regularFile(path), length);
  }

  verifyReferences(lookPath: string, look: JsonRecord, files: JsonRecord[], room: Room): JsonRecord[] {
    let lookRootReal: string;
    try {
      lookRootReal = dirname(this.#regularFile(lookPath));
      if (!isContained(this.#root, lookRootReal)) throw new RootedPathError();
    } catch {
      raise("reference-path-invalid", "The real Look folder could not be safely resolved.", 1, room);
    }

    const configuredRoot = look.paths?.references;
    let configuredRelative: string;
    if (typeof configuredRoot === "string") enforceStringLimit(configuredRoot, MAX_PATH_CHARS);
    try {
      if (typeof configuredRoot !== "string" || configuredRoot.trim() === "") throw new RootedPathError();
      configuredRelative = safeRelativePath(configuredRoot);
    } catch {
      raise("reference-path-invalid", "Configured references path must be a non-empty relative path.", 1, room);
    }
    const referencesRoot = resolve(lookRootReal, configuredRelative);
    if (!isContained(lookRootReal, referencesRoot) || !isContained(this.#root, referencesRoot) || !existsSync(referencesRoot)) {
      raise("reference-path-invalid", "Configured references path must resolve inside the Look folder.", 1, room);
    }

    let referencesRootReal: string;
    try {
      referencesRootReal = realpathSync(referencesRoot);
      if (
        !statSync(referencesRootReal).isDirectory() ||
        !isContained(lookRootReal, referencesRootReal) ||
        !isContained(this.#root, referencesRootReal)
      ) {
        throw new RootedPathError();
      }
    } catch {
      raise("reference-path-invalid", "Configured references folder could not be safely resolved.", 1, room);
    }

    let totalBytes = 0;
    return files.map((file) => {
      let declaredRelative: string;
      if (typeof file.path === "string") enforceStringLimit(file.path, MAX_PATH_CHARS);
      try {
        if (typeof file.path !== "string") throw new RootedPathError();
        declaredRelative = safeRelativePath(file.path);
      } catch {
        raise("reference-path-invalid", `Reference ${String(file.id)} must use a relative path.`, 1, room);
      }
      const candidate = resolve(lookRootReal, declaredRelative);
      if (
        !isContained(referencesRoot, candidate) ||
        !isContained(this.#root, candidate) ||
        !existsSync(candidate)
      ) {
        raise(
          "reference-path-invalid",
          `Reference ${String(file.id)} escapes or is missing from the references folder.`,
          1,
          room,
        );
      }
      let candidateReal: string;
      let size: number;
      try {
        candidateReal = realpathSync(candidate);
        const stats = statSync(candidateReal);
        if (
          !isContained(referencesRootReal, candidateReal) ||
          !isContained(this.#root, candidateReal) ||
          !stats.isFile()
        ) {
          throw new RootedPathError();
        }
        size = stats.size;
      } catch {
        raise("reference-unreadable", `Reference ${String(file.id)} could not be safely read.`, 1, room);
      }
      if (size > MAX_REFERENCE_BYTES) {
        raise("file-too-large", "A selected reference exceeds the configured byte limit.", 1, room);
      }
      totalBytes += size;
      if (totalBytes > MAX_TOTAL_REFERENCE_BYTES) {
        raise("references-too-large", "Selected references exceed the configured total byte limit.", 1, room);
      }
      let actualHash: string;
      try {
        actualHash = sha256(readFileSync(candidateReal));
      } catch {
        raise("reference-unreadable", `Reference ${String(file.id)} could not be safely read.`, 1, room);
      }
      if (actualHash !== file.sha256) {
        raise(
          "reference-hash-mismatch",
          `Reference ${String(file.id)} does not match its declared SHA-256.`,
          1,
          room,
        );
      }
      return { ...file, path: file.path, sha256: actualHash };
    });
  }
}
