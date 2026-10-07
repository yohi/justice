import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export type StorageScanInput = {
  readonly isolatedRoot: string;
  readonly sessionFiles: readonly string[];
  readonly capabilityIds: readonly string[];
};

export type StorageScanResult = {
  readonly tokenFound: boolean;
  readonly filesChecked: number;
  readonly entriesChecked: number;
  readonly unsafeStorage: boolean;
};

function walk(root: string): readonly string[] {
  const results: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      try {
        const st = statSync(full);
        if (st.isDirectory()) {
          stack.push(full);
        } else if (st.isFile()) {
          results.push(full);
        }
      } catch {
        // ignore inaccessible entries
      }
    }
  }
  return results;
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
    statSync(path);
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

export async function inspectCapabilitySessionStorage(input: StorageScanInput): Promise<StorageScanResult> {
  let filesChecked = 0;
  let entriesChecked = 0;
  let tokenFound = false;
  let unsafeStorage = false;

  const allFiles = new Set(input.sessionFiles);
  for (const file of input.sessionFiles) {
    for (const found of walk(file)) {
      allFiles.add(found);
    }
  }
  for (const rootFile of input.sessionFiles) {
    try {
      statSync(rootFile);
    } catch {
      unsafeStorage = true;
    }
  }
  for (const path of allFiles) {
    filesChecked++;
    let raw: Buffer;
    try {
      raw = readFileSync(path);
    } catch {
      unsafeStorage = true;
      continue;
    }
    // Scan raw UTF-8 bytes.
    const rawText = raw.toString("utf8");
    for (const token of input.capabilityIds) {
      if (rawText.includes(token)) {
        tokenFound = true;
      }
    }
    // Scan recursively decoded JSON line entries (JSONL sessions, history, logs).
    for (const line of rawText.split("\n")) {
      if (!line.trim()) continue;
      entriesChecked++;
      try {
        const parsed = JSON.parse(line) as unknown;
        if (scanValue(parsed, input.capabilityIds)) {
          tokenFound = true;
        }
      } catch {
        // Not JSON; raw text already scanned above.
      }
    }
  }

  return { tokenFound, filesChecked, entriesChecked, unsafeStorage };
}
