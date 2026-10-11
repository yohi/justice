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

export type StorageScanResult = {
  readonly tokenFound: boolean;
  readonly filesChecked: number;
  readonly entriesChecked: number;
  readonly unsafeStorage: boolean;
  readonly explicitSessionFilesRequired: number;
  readonly explicitSessionFilesObserved: number;
  readonly sessionIdsRequired: number;
  readonly sessionIdsObserved: number;
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
  let tokenFound = false;
  let unsafeStorage = false;
  const classes = new Set<string>();
  const expectedSessionFiles = new Set<string>();
  const observedSessionFiles = new Set<string>();
  const expectedSessionIds = new Set(input.sessionIds ?? []);
  const observedSessionIds = new Set<string>();
  const root = resolve(input.isolatedRoot);

  // Fail closed: the isolated runtime root itself must be a usable directory.
  try {
    if (!lstatSync(root).isDirectory()) unsafeStorage = true;
  } catch {
    unsafeStorage = true;
  }

  if (input.sessionFiles.length === 0) unsafeStorage = true;

  // Fail closed: every explicit parent/child session target must exist as a file.
  for (const file of input.sessionFiles) {
    try {
      const absolutePath = resolve(file);
      const relativePath = relative(root, absolutePath);
      if (relativePath === "" || relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
        unsafeStorage = true;
        continue;
      }
      if (!lstatSync(absolutePath).isFile()) {
        unsafeStorage = true;
        continue;
      }
      expectedSessionFiles.add(absolutePath);
    } catch {
      unsafeStorage = true;
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
      unsafeStorage = true;
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      if (excluded.has(posixRelative(root, full))) continue;
      let st;
      try {
        st = lstatSync(full);
      } catch {
        unsafeStorage = true;
        continue;
      }
      if (st.isSymbolicLink()) {
        unsafeStorage = true;
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
      if (observed === "sessions") {
        const basename = relativePath.split("/").at(-1) ?? "";
        for (const sessionId of expectedSessionIds) {
          if (basename.endsWith(`_${sessionId}.jsonl`) || basename === `${sessionId}.jsonl`) {
            observedSessionIds.add(sessionId);
          }
        }
      }
      let raw: Buffer;
      try {
        raw = readFileSync(full);
      } catch {
        unsafeStorage = true;
        continue;
      }
      const rawText = raw.toString("utf8");
      for (const token of input.capabilityIds) {
        if (rawText.includes(token)) {
          tokenFound = true;
        }
      }
      // Recursively decoded JSONL entries (sessions, history, task state, logs, evidence).
      for (const line of rawText.split("\n")) {
        if (!line.trim()) continue;
        entriesChecked++;
        try {
          const parsed = JSON.parse(line) as unknown;
          if (scanValue(parsed, input.capabilityIds)) {
            tokenFound = true;
          }
        } catch {
          // Not JSON; raw UTF-8 bytes were already scanned above.
        }
      }
    }
  }

  if (observedSessionFiles.size !== expectedSessionFiles.size) unsafeStorage = true;
  if (observedSessionIds.size !== expectedSessionIds.size) unsafeStorage = true;

  return {
    tokenFound,
    filesChecked,
    entriesChecked,
    unsafeStorage,
    explicitSessionFilesRequired: expectedSessionFiles.size,
    explicitSessionFilesObserved: observedSessionFiles.size,
    sessionIdsRequired: expectedSessionIds.size,
    sessionIdsObserved: observedSessionIds.size,
    classesObserved: Array.from(classes).sort(),
  };
}
