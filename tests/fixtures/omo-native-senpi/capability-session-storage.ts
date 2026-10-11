/// <reference types="node" />

import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export type StorageScanInput = {
  readonly isolatedRoot: string;
  readonly sessionFiles: readonly string[];
  readonly sessionIds?: readonly string[];
  readonly capabilityIds: readonly string[];
  /**
   * Fixture-input files (relative to isolatedRoot) that legitimately embed fixture
   * capability identities by construction, e.g. the deterministic mock script's echo
   * steps. Excluded paths are skipped entirely: neither scanned nor counted, and
   * they never mark the scan unsafe.
   */
  readonly excludedRelativePaths?: readonly string[];
};

export type StorageScanFailureReason =
  | "root_unavailable"
  | "explicit_session_file_invalid"
  | "explicit_session_file_unavailable"
  | "directory_unreadable"
  | "entry_unavailable"
  | "symlink_detected"
  | "file_unreadable"
  | "session_jsonl_invalid"
  | "explicit_session_files_incomplete"
  | "session_ids_incomplete";

export type StorageScanResult = {
  readonly tokenFound: boolean;
  readonly filesChecked: number;
  readonly entriesChecked: number;
  readonly unsafeStorage: boolean;
  readonly explicitSessionFilesRequired: number;
  readonly explicitSessionFilesObserved: number;
  readonly sessionIdsRequired: number;
  readonly sessionIdsObserved: number;
  readonly sessionManagerEntriesRequired: number;
  readonly sessionManagerEntriesObserved: number;
  readonly unsafeReasons: readonly StorageScanFailureReason[];
  /**
   * Fixture-private observation: which pinned-runtime storage classes the scan
   * actually walked (no paths, no tokens). The authoritative evaluator requires
   * every REQUIRED_STORAGE_CLASSES entry on the final scan before PROVEN.
   */
  readonly classesObserved: readonly string[];
};

/**
 * Storage classes the authoritative scan must observe for the pinned runtime:
 * session/history branches, task-state tree, actual logs, and evidence storage.
 * Detection is by path shape relative to the isolated root, matching the pinned
 * OmO v5.1.17 / Senpi v2026.10.8 sandbox layout the harness creates.
 */
export const REQUIRED_STORAGE_CLASSES: readonly string[] = Object.freeze([
  "sessions",
  "task_state",
  "logs",
  "evidence",
]);

function posixRelative(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

function classifyFile(relativePath: string): string | null {
  const components = relativePath.toLowerCase().split("/");
  if (components.some((component) => component === "evidence" || component.startsWith("evidence."))) return "evidence";
  if (components.some((component) => component === "sessions" || component === "history")) return "sessions";
  if (components.some((component) => component === "logs" || component.endsWith(".log") || component.endsWith(".log.jsonl"))) return "logs";
  if (components.some((component) => component === "task-state" || component === "task_state" || component === "tasks" || component === "projects")) return "task_state";
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function scanValue(value: unknown, tokens: ReadonlyArray<string>): boolean {
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (typeof current === "string") {
      for (const token of tokens) {
        if (current.includes(token)) return true;
      }
    } else if (current instanceof Uint8Array || Buffer.isBuffer(current)) {
      const text = current.toString("utf8");
      for (const token of tokens) {
        if (text.includes(token)) return true;
      }
    } else if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
    } else if (current !== null && typeof current === "object") {
      for (const v of Object.values(current)) stack.push(v);
    }
  }
  return false;
}

export const AUTH_JSON_RELATIVE_PATH = ".senpi/agent/auth.json";

export type CredentialStoreScan = {
  readonly authJsonPresent: boolean;
  readonly credentialEnvVarsFound: readonly string[];
  readonly scannedEnvVarNames: readonly string[];
};

function safeExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/** Scans the fixture HOME for persisted credential stores and the runtime environment for provider key variables. */
export function scanCredentialStores(input: {
  readonly homeDir: string;
  readonly env: NodeJS.ProcessEnv;
  readonly credentialEnvVars: readonly string[];
}): CredentialStoreScan {
  const authJsonPresent = safeExists(join(input.homeDir, AUTH_JSON_RELATIVE_PATH));
  const found = input.credentialEnvVars.filter((name) => {
    const value = input.env[name];
    return typeof value === "string" && value.length > 0;
  });
  return {
    authJsonPresent,
    credentialEnvVarsFound: found,
    scannedEnvVarNames: input.credentialEnvVars,
  };
}

/**
 * Authoritative capability-token scan over the isolated runtime tree.
 *
 * Fails closed: an unusable isolated root, an unreadable/missing explicit
 * session file, or any inaccessible entry inside the tree marks the scan
 * unsafeStorage. Every file under isolatedRoot is read raw and rescanned as
 * recursively decoded JSONL entries, covering session/history branches, the
 * task-state tree, actual logs, and evidence storage.
 */
export async function inspectCapabilitySessionStorage(input: StorageScanInput): Promise<StorageScanResult> {
  let filesChecked = 0;
  let entriesChecked = 0;
  let sessionManagerEntriesObserved = 0;
  let tokenFound = false;
  const unsafeReasons = new Set<StorageScanFailureReason>();
  const markUnsafe = (reason: StorageScanFailureReason): void => {
    unsafeReasons.add(reason);
  };
  const classes = new Set<string>();
  const expectedSessionFiles = new Set<string>();
  const observedSessionFiles = new Set<string>();
  const expectedSessionIds = new Set(input.sessionIds ?? []);
  const observedSessionIds = new Set<string>();
  const root = resolve(input.isolatedRoot);

  // Fail closed: the isolated runtime root itself must be a usable directory.
  try {
    if (!lstatSync(root).isDirectory()) markUnsafe("root_unavailable");
  } catch {
    markUnsafe("root_unavailable");
  }

  // Explicit runtime-provided session paths are an additional fail-closed check
  // when available. They are not required when the isolated tree and expected
  // session IDs are scanned directly below; the authoritative caller verifies
  // that every expected parent/child ID was actually found in session storage.
  for (const file of input.sessionFiles) {
    try {
      const absolutePath = resolve(file);
      const relativePath = relative(root, absolutePath);
      if (relativePath === "" || relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
        markUnsafe("explicit_session_file_invalid");
        continue;
      }
      if (!lstatSync(absolutePath).isFile()) {
        markUnsafe("explicit_session_file_invalid");
        continue;
      }
      expectedSessionFiles.add(absolutePath);
    } catch {
      markUnsafe("explicit_session_file_unavailable");
    }
  }

  const excluded = new Set(input.excludedRelativePaths ?? []);

  // Walk the full isolated runtime tree; any unreadable entry fails the scan closed.
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      markUnsafe("directory_unreadable");
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      if (excluded.has(posixRelative(root, full))) continue;
      let st;
      try {
        st = lstatSync(full);
      } catch {
        markUnsafe("entry_unavailable");
        continue;
      }
      if (st.isSymbolicLink()) {
        markUnsafe("symlink_detected");
        continue;
      }
      if (st.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!st.isFile()) continue;
      filesChecked++;
      if (expectedSessionFiles.has(full)) observedSessionFiles.add(full);
      const relativePath = posixRelative(root, full);
      const observed = classifyFile(relativePath);
      if (observed) classes.add(observed);
      if (expectedSessionFiles.has(full)) classes.add("sessions");
      let raw: Buffer;
      try {
        raw = readFileSync(full);
      } catch {
        markUnsafe("file_unreadable");
        continue;
      }
      const rawText = raw.toString("utf8");
      for (const token of input.capabilityIds) {
        if (rawText.includes(token)) {
          tokenFound = true;
        }
      }
      const isSessionJsonl =
        (observed === "sessions" || expectedSessionFiles.has(full)) &&
        relativePath.toLowerCase().endsWith(".jsonl");
      const lines = rawText.split(/\r?\n/u);
      if (lines.at(-1) === "") lines.pop();
      let headerCount = 0;
      let nonBlankLineIndex = 0;
      for (const line of lines) {
        if (!line.trim()) continue;
        entriesChecked++;
        try {
          const parsed: unknown = JSON.parse(line);
          if (isSessionJsonl) {
            if (isRecord(parsed) && parsed.type === "session") {
              headerCount++;
              const isExplicitSessionFile = expectedSessionFiles.has(full);
              const validHeader =
                nonBlankLineIndex === 0 &&
                headerCount === 1 &&
                typeof parsed.id === "string" &&
                typeof parsed.cwd === "string" &&
                typeof parsed.timestamp === "string" &&
                Number.isFinite(Date.parse(parsed.timestamp)) &&
                (parsed.version === undefined ||
                  (typeof parsed.version === "number" && Number.isInteger(parsed.version) && parsed.version > 0)) &&
                (parsed.parentSession === undefined || typeof parsed.parentSession === "string");
              if (!validHeader) markUnsafe("session_jsonl_invalid");
              if (typeof parsed.id === "string" && isExplicitSessionFile) {
                if (expectedSessionIds.size > 0 && !expectedSessionIds.has(parsed.id)) {
                  markUnsafe("session_jsonl_invalid");
                } else if (expectedSessionIds.size > 0) {
                  observedSessionIds.add(parsed.id);
                }
              }
            } else {
              if (headerCount === 0) markUnsafe("session_jsonl_invalid");
              else sessionManagerEntriesObserved++;
            }
          }
          if (scanValue(parsed, input.capabilityIds)) {
            tokenFound = true;
          }
        } catch {
          // Not JSON; raw UTF-8 bytes were already scanned above.
          if (isSessionJsonl) markUnsafe("session_jsonl_invalid");
        }
        nonBlankLineIndex++;
      }
      if (isSessionJsonl && headerCount !== 1) markUnsafe("session_jsonl_invalid");
    }
  }

  if (observedSessionFiles.size !== expectedSessionFiles.size) markUnsafe("explicit_session_files_incomplete");
  if (observedSessionIds.size !== expectedSessionIds.size) markUnsafe("session_ids_incomplete");

  return {
    tokenFound,
    filesChecked,
    entriesChecked,
    unsafeStorage: unsafeReasons.size > 0,
    explicitSessionFilesRequired: expectedSessionFiles.size,
    explicitSessionFilesObserved: observedSessionFiles.size,
    sessionIdsRequired: expectedSessionIds.size,
    sessionIdsObserved: observedSessionIds.size,
    sessionManagerEntriesRequired: Math.max(1, sessionManagerEntriesObserved),
    sessionManagerEntriesObserved,
    unsafeReasons: Array.from(unsafeReasons).sort(),
    classesObserved: Array.from(classes).sort(),
  };
}
