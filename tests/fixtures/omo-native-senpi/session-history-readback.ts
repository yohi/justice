const SESSION_ENTRY_TYPES = [
  "message",
  "thinking_level_change",
  "configuration_update",
  "model_change",
  "model_change_rejected",
  "usage",
  "compaction",
  "branch_summary",
  "custom",
  "custom_message",
  "context_edit",
  "label",
  "session_info",
] as const;

const SESSION_ENTRY_TYPE_SET: ReadonlySet<string> = new Set(SESSION_ENTRY_TYPES);
const SANITIZER_FAILURE_ERROR = "justice_capability_outbound_sanitize_failed";
const PROVIDER_STREAM_ERROR = "justice-spike-provider-stream-failure";

type SessionHistoryFailureReason =
  | "empty_jsonl"
  | "malformed_jsonl"
  | "header_missing_or_malformed"
  | "header_not_first_or_duplicated"
  | "header_in_get_entries"
  | "unknown_entry_type"
  | "invalid_entry_identity"
  | "duplicate_entry_id"
  | "missing_parent"
  | "entry_identity_mismatch";

export type SessionManagerHistoryReadback = Readonly<{
  readonly sessionId: string;
  readonly headerValid: boolean;
  readonly headerCount: number;
  readonly sessionEntriesObserved: number;
  readonly diskEntriesObserved: number;
  readonly sanitizerFailureFallbackMemoryEntries: number;
  readonly sanitizerFailureFallbackDiskEntries: number;
  readonly providerStreamErrorMemoryEntries: number;
  readonly providerStreamErrorDiskEntries: number;
  readonly providerStreamErrorTokenFreeInMemory: boolean;
  readonly providerStreamErrorTokenFreeInDisk: boolean;
  readonly selectedMethodReadMemoryEntries: number;
  readonly selectedMethodReadDiskEntries: number;
  readonly selectedMethodReadPersistedInMemory: boolean;
  readonly selectedMethodReadPersistedInDisk: boolean;
  readonly entryIdsAndBranchesMatch: boolean;
  readonly tokenFoundInMemoryEntries: boolean;
  readonly tokenFoundInDiskEntries: boolean;
  readonly unsafeStorage: boolean;
  readonly failureReasons: readonly SessionHistoryFailureReason[];
}>;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function containsCapability(value: unknown, capabilityIds: readonly string[]): boolean {
  const tokens = capabilityIds.filter((token) => token.length > 0);
  if (tokens.length === 0) return false;
  const pending: unknown[] = [value];
  const visited = new Set<object>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current === "string") {
      if (tokens.some((token) => current.includes(token))) return true;
      continue;
    }
    if (current === null || typeof current !== "object" || visited.has(current)) continue;
    visited.add(current);
    if (current instanceof Uint8Array) {
      const text = current.toString();
      if (tokens.some((token) => text.includes(token))) return true;
      continue;
    }
    if (Array.isArray(current)) pending.push(...current);
    else pending.push(...Object.values(current));
  }
  return false;
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function validHeader(value: unknown, expectedSessionId: string): boolean {
  if (!isRecord(value)) return false;
  return (
    value.type === "session" &&
    value.id === expectedSessionId &&
    typeof value.cwd === "string" &&
    validTimestamp(value.timestamp) &&
    (value.version === undefined || (typeof value.version === "number" && Number.isInteger(value.version) && value.version > 0)) &&
    (value.parentSession === undefined || typeof value.parentSession === "string")
  );
}

type ValidatedEntries = Readonly<{
  readonly identities: readonly string[];
  readonly valid: boolean;
}>;

function validateEntries(
  entries: readonly unknown[],
  reasons: Set<SessionHistoryFailureReason>,
): ValidatedEntries {
  const identities: string[] = [];
  const entryIds = new Set<string>();
  const parentIds: Array<string | null> = [];
  let valid = true;

  for (const entry of entries) {
    if (!isRecord(entry) || entry.type === "session") {
      reasons.add("header_in_get_entries");
      valid = false;
      continue;
    }
    if (typeof entry.type !== "string" || !SESSION_ENTRY_TYPE_SET.has(entry.type)) {
      reasons.add("unknown_entry_type");
      valid = false;
      continue;
    }
    if (
      typeof entry.id !== "string" ||
      entry.id.length === 0 ||
      (entry.parentId !== null && typeof entry.parentId !== "string") ||
      !validTimestamp(entry.timestamp)
    ) {
      reasons.add("invalid_entry_identity");
      valid = false;
      continue;
    }
    if (entryIds.has(entry.id)) {
      reasons.add("duplicate_entry_id");
      valid = false;
    }
    entryIds.add(entry.id);
    parentIds.push(entry.parentId);
    identities.push(JSON.stringify({ id: entry.id, parentId: entry.parentId, type: entry.type }));
  }

  for (const parentId of parentIds) {
    if (parentId !== null && !entryIds.has(parentId)) {
      reasons.add("missing_parent");
      valid = false;
    }
  }
  return { identities: identities.sort(), valid };
}

function parseSessionJsonl(contents: string): Readonly<{
  readonly rows: readonly unknown[];
  readonly valid: boolean;
}> {
  const lines = contents.split(/\r?\n/u);
  if (lines.at(-1) === "") lines.pop();
  if (lines.length === 0) return { rows: [], valid: false };
  const rows: unknown[] = [];
  for (const line of lines) {
    if (line.trim().length === 0) return { rows, valid: false };
    try {
      const parsed: unknown = JSON.parse(line);
      rows.push(parsed);
    } catch (error: unknown) {
      if (error instanceof SyntaxError) return { rows, valid: false };
      throw error;
    }
  }
  return { rows, valid: true };
}

export function inspectSessionManagerHistoryReadback(input: {
  readonly sessionId: string;
  readonly sessionManagerEntries: unknown;
  readonly sessionJsonl: string;
  readonly capabilityIds: readonly string[];
  readonly providerStreamErrorCallId?: string;
  readonly selectedMethodReadToolCallId?: string;
}): SessionManagerHistoryReadback {
  const reasons = new Set<SessionHistoryFailureReason>();
  const memoryEntries = Array.isArray(input.sessionManagerEntries) ? input.sessionManagerEntries : [];
  if (!Array.isArray(input.sessionManagerEntries)) reasons.add("invalid_entry_identity");
  const parsedDisk = parseSessionJsonl(input.sessionJsonl);
  if (!parsedDisk.valid) reasons.add(parsedDisk.rows.length === 0 ? "empty_jsonl" : "malformed_jsonl");

  const diskRows = parsedDisk.rows;
  const diskHeader = diskRows[0];
  const headers = diskRows.filter((row) => isRecord(row) && row.type === "session");
  const headerValid =
    parsedDisk.valid &&
    headers.length === 1 &&
    diskHeader !== undefined &&
    validHeader(diskHeader, input.sessionId);
  if (!headerValid) {
    reasons.add(headers.length > 0 && diskHeader !== headers[0] ? "header_not_first_or_duplicated" : "header_missing_or_malformed");
  }
  if (headers.length !== 1 || diskRows.slice(1).some((row) => isRecord(row) && row.type === "session")) {
    reasons.add("header_not_first_or_duplicated");
  }

  const diskEntries = diskRows.slice(1);
  const sanitizerFailureFallbackMemoryEntries = memoryEntries.filter(
    (entry) => isRecord(entry) && hasSanitizerFailureFallback(entry),
  ).length;
  const sanitizerFailureFallbackDiskEntries = diskEntries.filter(
    (entry) => isRecord(entry) && hasSanitizerFailureFallback(entry),
  ).length;
  const providerStreamErrorCallId = input.providerStreamErrorCallId;
  const providerStreamErrorMemoryEntries = providerStreamErrorCallId === undefined
    ? []
    : memoryEntries.filter(
        (entry) => isRecord(entry) && hasProviderStreamError(entry, providerStreamErrorCallId),
      );
  const providerStreamErrorDiskEntries = providerStreamErrorCallId === undefined
    ? []
    : diskEntries.filter(
        (entry) => isRecord(entry) && hasProviderStreamError(entry, providerStreamErrorCallId),
      );
  const selectedMethodReadToolCallId = input.selectedMethodReadToolCallId;
  const selectedMethodReadMemoryEntries = selectedMethodReadToolCallId === undefined
    ? []
    : memoryEntries.filter(
        (entry) => isRecord(entry) && hasSelectedMethodReadResult(entry, selectedMethodReadToolCallId),
      );
  const selectedMethodReadDiskEntries = selectedMethodReadToolCallId === undefined
    ? []
    : diskEntries.filter(
        (entry) => isRecord(entry) && hasSelectedMethodReadResult(entry, selectedMethodReadToolCallId),
      );
  const memoryValidation = validateEntries(memoryEntries, reasons);
  const diskValidation = validateEntries(diskEntries, reasons);
  const entryIdsAndBranchesMatch =
    parsedDisk.valid &&
    headerValid &&
    memoryValidation.valid &&
    diskValidation.valid &&
    memoryValidation.identities.length === memoryEntries.length &&
    diskValidation.identities.length === diskEntries.length &&
    JSON.stringify(memoryValidation.identities) === JSON.stringify(diskValidation.identities);
  if (!entryIdsAndBranchesMatch) reasons.add("entry_identity_mismatch");

  return {
    sessionId: input.sessionId,
    headerValid,
    headerCount: headers.length,
    sessionEntriesObserved: memoryEntries.length,
    diskEntriesObserved: diskEntries.length,
    sanitizerFailureFallbackMemoryEntries,
    sanitizerFailureFallbackDiskEntries,
    providerStreamErrorMemoryEntries: providerStreamErrorMemoryEntries.length,
    providerStreamErrorDiskEntries: providerStreamErrorDiskEntries.length,
    providerStreamErrorTokenFreeInMemory:
      providerStreamErrorMemoryEntries.length === 1 &&
      !containsCapability(providerStreamErrorMemoryEntries, input.capabilityIds),
    providerStreamErrorTokenFreeInDisk:
      providerStreamErrorDiskEntries.length === 1 &&
      !containsCapability(providerStreamErrorDiskEntries, input.capabilityIds),
    selectedMethodReadMemoryEntries: selectedMethodReadMemoryEntries.length,
    selectedMethodReadDiskEntries: selectedMethodReadDiskEntries.length,
    selectedMethodReadPersistedInMemory: selectedMethodReadMemoryEntries.length === 1,
    selectedMethodReadPersistedInDisk: selectedMethodReadDiskEntries.length === 1,
    entryIdsAndBranchesMatch,
    tokenFoundInMemoryEntries: containsCapability(memoryEntries, input.capabilityIds),
    tokenFoundInDiskEntries:
      containsCapability(diskRows, input.capabilityIds) ||
      input.capabilityIds.some((token) => token.length > 0 && input.sessionJsonl.includes(token)),
    unsafeStorage: reasons.size > 0,
    failureReasons: Array.from(reasons).sort(),
  };
}

function hasSanitizerFailureFallback(entry: Record<string, unknown>): boolean {
  if (entry.type !== "message" || !isRecord(entry.message)) return false;
  return (
    entry.message.role === "assistant" &&
    entry.message.errorMessage === SANITIZER_FAILURE_ERROR &&
    Array.isArray(entry.message.content) &&
    entry.message.content.length === 0
  );
}

function hasProviderStreamError(entry: Record<string, unknown>, toolCallId: string): boolean {
  if (entry.type !== "message" || !isRecord(entry.message)) return false;
  const message = entry.message;
  return (
    message.role === "assistant" &&
    message.stopReason === "error" &&
    message.errorMessage === PROVIDER_STREAM_ERROR &&
    Array.isArray(message.content) &&
    message.content.some(
      (part) => isRecord(part) && part.type === "toolCall" && part.id === toolCallId,
    )
  );
}

function hasSelectedMethodReadResult(entry: Record<string, unknown>, toolCallId: string): boolean {
  if (entry.type !== "message" || !isRecord(entry.message)) return false;
  return (
    entry.message.role === "toolResult" &&
    entry.message.toolName === "read" &&
    entry.message.toolCallId === toolCallId &&
    entry.message.isError !== true
  );
}

export function areSessionManagerHistoriesComplete(
  readbacks: readonly unknown[],
  expectedSessionIds: readonly string[],
): boolean {
  if (expectedSessionIds.length === 0 || new Set(expectedSessionIds).size !== expectedSessionIds.length) return false;
  const expected = new Set(expectedSessionIds);
  const shutdownReadbacks = new Map<string, Record<string, unknown>>();
  for (const value of readbacks) {
    if (!isRecord(value) || (value.phase !== "session_shutdown" && value.phase !== "turn_end")) return false;
    if (typeof value.sessionId !== "string" || !expected.has(value.sessionId)) return false;
    if (value.phase === "turn_end") continue;
    if (
      value.headerValid !== true ||
      value.headerCount !== 1 ||
      typeof value.sessionEntriesObserved !== "number" ||
      value.sessionEntriesObserved < 0 ||
      value.diskEntriesObserved !== value.sessionEntriesObserved ||
      value.entryIdsAndBranchesMatch !== true ||
      value.tokenFoundInMemoryEntries !== false ||
      value.tokenFoundInDiskEntries !== false ||
      value.unsafeStorage !== false
    ) {
      return false;
    }
    if (value.phase === "session_shutdown") {
      if (shutdownReadbacks.has(value.sessionId)) return false;
      shutdownReadbacks.set(value.sessionId, value);
    }
  }
  if (shutdownReadbacks.size !== expected.size) return false;
  return expectedSessionIds.every((sessionId) => {
    const value = shutdownReadbacks.get(sessionId);
    return value !== undefined;
  });
}
