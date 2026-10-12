/**
 * Task 6 (scoped) — durable Review Gate event journal with protected
 * publication CAS (runtime, brief layout).
 *
 * JSON persistence under the workspace root:
 *
 * - `.justice/review-gates/<gateId>/events.jsonl`     — ReviewGateEvent ledger
 * - `.justice/review-gates/<gateId>/dispatches.jsonl` — dispatch records
 * - `.justice/review-gates/scope-index.json`         — reviewScopeId → gateId
 *   (non-authoritative cache)
 *
 * Durability contract:
 * - Every mutation writes the complete next journal to a fresh O_EXCL temp
 *   file, fsyncs the file, atomically renames it over the ledger, and fsyncs
 *   the containing directory. A crash between the temp write and the rename
 *   can never publish partial bytes: readers observe either the previous or
 *   the next complete journal, and the abandoned temp file is swept by
 *   `recoverJournal`.
 * - Journal lines are the Task 4c canonical codec encoding
 *   (`encodeReviewGateEventRecord`) of each event, newline-terminated. A line
 *   is committed iff it is newline-terminated and codec-valid.
 *
 * Protected publication CAS:
 * - `readFrontierHash` returns the SHA-256 of the canonical journal bytes
 *   (the empty journal hashes the empty string).
 * - `publishEvents` appends only when the caller's expected frontier hash
 *   matches the current committed frontier; a stale frontier rejects with
 *   `review_gate_publication_cas_conflict` and leaves the journal untouched.
 *   A publication retried after a lost acknowledgement therefore conflicts
 *   instead of duplicating events.
 *
 * Recovery:
 * - A torn trailing append (trailing content without a final newline) fails
 *   closed on every read/append/publication with
 *   `review_gate_journal_torn_tail`. `recoverJournal` is the sole repair
 *   entrypoint: it validates every complete line, drops the uncommitted torn
 *   fragment, rewrites the journal atomically, and sweeps stale temp files.
 * - A corrupt complete line (`review_gate_journal_corrupt`) is never
 *   repaired; recovery leaves the bytes untouched.
 *
 * Event versions:
 * - V1 legacy events (`ReviewGateEvent`) and V2 typed events (Task 4c
 *   `VerifiedReviewGateEvent`) are both validated by the codec before any
 *   mutation. The legacy `appendEvents`/`readEvents` surface is V1-only and
 *   fails closed with `review_gate_event_unsupported_v2` when the batch or
 *   journal holds a V2 event; `publishEvents`/`readVerifiedEvents` accept
 *   both versions.
 *
 * The store serializes all operations through one internal op chain, so the
 * persistence order for same-gate appends is exactly call order. Reads answer
 * from a private in-memory cache seeded from persisted content and return
 * frozen snapshots. Per-writer witness-bound shards and the versioned
 * envelope (design spec §11) arrive with the coordinator integration.
 */

import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import type { Dirent } from "node:fs";
import { dirname, join } from "node:path";
import {
  encodeReviewGateEventRecord,
  validateReviewGateEventRecord,
  type VerifiedReviewGateEvent,
} from "../core/review-gate/event-schema";
import { validateStorageGateId } from "../core/review-gate/identity";
import type { ReviewGateEvent, ReviewGatePhase } from "../core/review-gate-types";
import type { ReviewGateOperationKind } from "../core/review-gate/agent-protocol";

const REVIEW_GATES_DIR = ".justice/review-gates";
const SCOPE_INDEX_FILE = `${REVIEW_GATES_DIR}/scope-index.json`;

/** Temp-file naming used by the atomic rename writes (`<ledger>.<uuid>.tmp`). */
const JOURNAL_TEMP_PATTERN =
  /^(?:events|dispatches)\.jsonl\.[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.tmp$/u;

const SHA256_OF_EMPTY = createHash("sha256").update("").digest("hex");

/** One durably recorded dispatch intent; completion may occur later. */
export type ReviewGateDispatchRecordV1 = Readonly<{
  readonly dispatchId: string;
  readonly operationId: string;
  readonly operation: ReviewGateOperationKind;
  readonly phase: ReviewGatePhase;
  readonly dispatchedAt: string;
  readonly completedAt: string | null;
}>;

/** Journal input: a V1 legacy event or a V2 typed event (Task 4c codec). */
export type ReviewGateJournalEventInput = ReviewGateEvent | VerifiedReviewGateEvent;

/** Result of one committed protected publication. */
export type ReviewGatePublicationResult = Readonly<{
  readonly frontierHash: string;
  readonly eventCount: number;
}>;

/** Result of the explicit journal recovery entrypoint. */
export type ReviewGateJournalRecovery = Readonly<{
  readonly status: "clean" | "recovered";
  readonly eventCount: number;
  readonly frontierHash: string;
}>;

export type ReviewGateEventStore = Readonly<{
  readonly appendEvents: (gateId: string, events: readonly ReviewGateEvent[]) => Promise<void>;
  readonly readEvents: (gateId: string) => Promise<readonly ReviewGateEvent[]>;
  readonly readVerifiedEvents: (gateId: string) => Promise<readonly VerifiedReviewGateEvent[]>;
  readonly readFrontierHash: (gateId: string) => Promise<string>;
  readonly publishEvents: (
    gateId: string,
    events: readonly ReviewGateJournalEventInput[],
    expectedFrontierHash: string,
  ) => Promise<ReviewGatePublicationResult>;
  readonly recoverJournal: (gateId: string) => Promise<ReviewGateJournalRecovery>;
  readonly recordDispatch: (gateId: string, dispatch: ReviewGateDispatchRecordV1) => Promise<void>;
  readonly markDispatchCompleted: (gateId: string, operationId: string) => Promise<void>;
  readonly listDispatches: (gateId: string) => Promise<readonly ReviewGateDispatchRecordV1[]>;
  readonly listGateIds: () => Promise<readonly string[]>;
  readonly readScopeIndex: (reviewScopeId: string) => Promise<string | null>;
  readonly writeScopeIndex: (reviewScopeId: string, gateId: string) => Promise<void>;
  readonly close: () => void;
}>;

type JournalRead = Readonly<{
  readonly events: readonly VerifiedReviewGateEvent[];
  readonly tornTail: boolean;
}>;

/**
 * Create the durable event store bound to one workspace root. Id scope
 * validation mirrors the native provider's gate-id contract: an id is never
 * empty and never contains `/`, `\`, `..`, or NUL.
 */
export function createReviewGateEventStore(rootDir: string): ReviewGateEventStore {
  if (rootDir.length === 0) {
    throw new Error("review_gate_invalid_root");
  }

  let closed = false;
  const eventsByGate = new Map<string, readonly VerifiedReviewGateEvent[]>();
  const dispatchesByGate = new Map<string, readonly ReviewGateDispatchRecordV1[]>();
  let scopeIndex: Record<string, string> | null = null;

  let opChain: Promise<unknown> = Promise.resolve();

  const serialize = <T>(operation: () => T): Promise<T> => {
    const next = opChain.then(operation);
    opChain = next.catch(() => undefined);
    return next;
  };

  const assertOpen = (): void => {
    if (closed) throw new Error("review_gate_store_closed");
  };

  const assertStorageId = (id: string): void => {
    if (!validateStorageGateId(id)) {
      throw new Error("review_gate_invalid_id");
    }
  };

  const gateDir = (gateId: string): string => join(rootDir, REVIEW_GATES_DIR, gateId);
  const eventsFile = (gateId: string): string => join(gateDir(gateId), "events.jsonl");
  const dispatchesFile = (gateId: string): string => join(gateDir(gateId), "dispatches.jsonl");

  /**
   * Durably replace one file: write the full content to a fresh O_EXCL temp
   * file, fsync it, atomically rename it into place, then fsync the directory
   * so the rename itself survives a crash.
   */
  const writeAtomicUtf8 = (file: string, content: string): void => {
    mkdirSync(dirname(file), { recursive: true });
    const temp = `${file}.${randomUUID()}.tmp`;
    const descriptor = openSync(temp, "wx", 0o600);
    try {
      writeFileSync(descriptor, content, "utf8");
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    renameSync(temp, file);
    fsyncDirectory(dirname(file));
  };

  const fsyncDirectory = (directory: string): void => {
    const descriptor = openSync(directory, "r");
    try {
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
  };

  /** Canonical journal bytes for the committed event list. */
  const journalBytes = (events: readonly VerifiedReviewGateEvent[]): string =>
    events.length === 0 ? "" : `${events.map(encodeReviewGateEventRecord).join("\n")}\n`;

  const frontierHashOf = (events: readonly VerifiedReviewGateEvent[]): string =>
    events.length === 0
      ? SHA256_OF_EMPTY
      : createHash("sha256").update(journalBytes(events), "utf8").digest("hex");

  /**
   * Read the raw journal: every newline-terminated line must parse and pass
   * the codec; trailing content without a final newline is reported as a torn
   * append and left for `recoverJournal`.
   */
  const readJournalFile = (file: string): JournalRead => {
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch (err) {
      if (isEnoent(err)) return { events: [], tornTail: false };
      throw err;
    }
    const tornTail = content.length > 0 && !content.endsWith("\n");
    const committed = tornTail ? content.slice(0, content.lastIndexOf("\n") + 1) : content;
    const lines = committed.split("\n").filter((line) => line.length > 0);
    const events = lines.map((line) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        throw new Error("review_gate_journal_corrupt");
      }
      try {
        return validateReviewGateEventRecord(parsed);
      } catch {
        throw new Error("review_gate_journal_corrupt");
      }
    });
    return { events: Object.freeze(events), tornTail };
  };

  const loadVerifiedEvents = (gateId: string): readonly VerifiedReviewGateEvent[] => {
    const cached = eventsByGate.get(gateId);
    if (cached !== undefined) return cached;
    const { events, tornTail } = readJournalFile(eventsFile(gateId));
    if (tornTail) throw new Error("review_gate_journal_torn_tail");
    eventsByGate.set(gateId, events);
    return events;
  };

  /** The legacy V1 surface never silently projects V2 typed events. */
  const assertLegacyJournal = (events: readonly VerifiedReviewGateEvent[]): void => {
    if (events.some((event) => "schemaVersion" in event)) {
      throw new Error("review_gate_event_unsupported_v2");
    }
  };

  const legacyView = (events: readonly VerifiedReviewGateEvent[]): readonly ReviewGateEvent[] =>
    Object.freeze([...events]) as readonly ReviewGateEvent[];

  /**
   * Validate one publication batch through the Task 4c codec on a private
   * clone so the caller's objects are never frozen or mutated in place.
   */
  const validateJournalBatch = (
    gateId: string,
    events: readonly ReviewGateJournalEventInput[],
  ): readonly VerifiedReviewGateEvent[] => {
    if (events.length === 0) throw new Error("review_gate_event_batch_empty");
    return events.map((event) => {
      const verified = validateReviewGateEventRecord(structuredClone(event));
      if (verified.gateId !== gateId) throw new Error("review_gate_event_gate_mismatch");
      return verified;
    });
  };

  /** Atomically install the next journal content and refresh the cache. */
  const commitJournal = (
    gateId: string,
    events: readonly VerifiedReviewGateEvent[],
  ): ReviewGatePublicationResult => {
    const frozen = Object.freeze([...events]);
    writeAtomicUtf8(eventsFile(gateId), journalBytes(frozen));
    eventsByGate.set(gateId, frozen);
    return Object.freeze({
      frontierHash: frontierHashOf(frozen),
      eventCount: frozen.length,
    });
  };

  /** Remove abandoned temp files left by a crash before the atomic rename. */
  const sweepStaleTempFiles = (directory: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(directory, { withFileTypes: true, encoding: "utf8" });
    } catch (err) {
      if (isEnoent(err)) return;
      throw err;
    }
    for (const entry of entries) {
      if (entry.isFile() && JOURNAL_TEMP_PATTERN.test(entry.name)) {
        // Entry name originates from the directory listing above.
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        unlinkSync(join(directory, entry.name));
      }
    }
  };

  const loadDispatches = (gateId: string): readonly ReviewGateDispatchRecordV1[] => {
    const cached = dispatchesByGate.get(gateId);
    if (cached !== undefined) return cached;
    const dispatches: ReviewGateDispatchRecordV1[] = readJsonlLines(dispatchesFile(gateId)).map(
      (line) => assertDispatchShape(JSON.parse(line)),
    );
    const frozen = Object.freeze(dispatches);
    dispatchesByGate.set(gateId, frozen);
    return frozen;
  };

  const readJsonlLines = (file: string): readonly string[] => {
    try {
      return readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => line.length > 0);
    } catch (err) {
      if (isEnoent(err)) return [];
      throw err;
    }
  };

  const readScopeIndexMap = (): Record<string, string> => {
    if (scopeIndex !== null) return scopeIndex;
    let bytes: string;
    try {
      bytes = readFileSync(join(rootDir, SCOPE_INDEX_FILE), "utf8");
    } catch (err) {
      if (isEnoent(err)) bytes = "{}";
      else throw err;
    }
    const parsed: unknown = JSON.parse(bytes);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("review_gate_scope_index_corrupt");
    }
    const map = Object.create(null) as Record<string, string>;
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== "string") throw new Error("review_gate_scope_index_corrupt");
      // Key originates from an already-persisted scope index entry.
      // eslint-disable-next-line security/detect-object-injection
      map[key] = value;
    }
    scopeIndex = map;
    return map;
  };

  const store: ReviewGateEventStore = {
    appendEvents: (gateId, events) =>
      serialize(() => {
        assertOpen();
        assertStorageId(gateId);
        const batch = validateJournalBatch(gateId, events);
        if (batch.some((event) => "schemaVersion" in event)) {
          throw new Error("review_gate_event_unsupported_v2");
        }
        const current = loadVerifiedEvents(gateId);
        assertLegacyJournal(current);
        commitJournal(gateId, [...current, ...batch]);
        return undefined;
      }),

    readEvents: (gateId) =>
      serialize(() => {
        assertOpen();
        assertStorageId(gateId);
        const events = loadVerifiedEvents(gateId);
        assertLegacyJournal(events);
        return legacyView(events);
      }),

    readVerifiedEvents: (gateId) =>
      serialize(() => {
        assertOpen();
        assertStorageId(gateId);
        return Object.freeze([...loadVerifiedEvents(gateId)]);
      }),

    readFrontierHash: (gateId) =>
      serialize(() => {
        assertOpen();
        assertStorageId(gateId);
        return frontierHashOf(loadVerifiedEvents(gateId));
      }),

    publishEvents: (gateId, events, expectedFrontierHash) =>
      serialize(() => {
        assertOpen();
        assertStorageId(gateId);
        const batch = validateJournalBatch(gateId, events);
        const current = loadVerifiedEvents(gateId);
        if (frontierHashOf(current) !== expectedFrontierHash) {
          throw new Error("review_gate_publication_cas_conflict");
        }
        return commitJournal(gateId, [...current, ...batch]);
      }),

    recoverJournal: (gateId) =>
      serialize(() => {
        assertOpen();
        assertStorageId(gateId);
        const { events, tornTail } = readJournalFile(eventsFile(gateId));
        sweepStaleTempFiles(gateDir(gateId));
        if (!tornTail) {
          return Object.freeze({
            status: "clean" as const,
            eventCount: events.length,
            frontierHash: frontierHashOf(events),
          });
        }
        // The torn fragment was never committed (no newline termination):
        // healing rewrites exactly the committed lines.
        const frozen = Object.freeze([...events]);
        writeAtomicUtf8(eventsFile(gateId), journalBytes(frozen));
        eventsByGate.set(gateId, frozen);
        return Object.freeze({
          status: "recovered" as const,
          eventCount: frozen.length,
          frontierHash: frontierHashOf(frozen),
        });
      }),

    recordDispatch: (gateId, dispatch) =>
      serialize(() => {
        assertOpen();
        assertStorageId(gateId);
        const validated = assertDispatchShape(dispatch);
        const current = loadDispatches(gateId);
        const existing = current.find((record) => record.operationId === validated.operationId);
        if (existing !== undefined) {
          if (!dispatchContentEquals(existing, validated)) {
            throw new Error("review_gate_dispatch_conflict");
          }
          return undefined; // idempotent re-record after a crash restart
        }
        const next: readonly ReviewGateDispatchRecordV1[] = [...current, validated];
        writeAtomicUtf8(dispatchesFile(gateId), toJsonl(next));
        dispatchesByGate.set(gateId, next);
        return undefined;
      }),

    markDispatchCompleted: (gateId, operationId) =>
      serialize(() => {
        assertOpen();
        assertStorageId(gateId);
        if (operationId.length === 0) throw new Error("review_gate_dispatch_unknown");
        const current = loadDispatches(gateId);
        const existing = current.find((record) => record.operationId === operationId);
        if (existing === undefined) throw new Error("review_gate_dispatch_unknown");
        if (existing.completedAt !== null) {
          return undefined; // idempotent: already completed
        }
        const completed: ReviewGateDispatchRecordV1 = Object.freeze({
          ...existing,
          completedAt: new Date().toISOString(),
        });
        const next: readonly ReviewGateDispatchRecordV1[] = current.map((record) =>
          record.operationId === operationId ? completed : record,
        );
        writeAtomicUtf8(dispatchesFile(gateId), toJsonl(next));
        dispatchesByGate.set(gateId, next);
        return undefined;
      }),

    listDispatches: (gateId) =>
      serialize(() => {
        assertOpen();
        assertStorageId(gateId);
        return Object.freeze([...loadDispatches(gateId)]);
      }),

    listGateIds: () =>
      serialize(() => {
        assertOpen();
        const gatesRoot = join(rootDir, REVIEW_GATES_DIR);
        let entries: Dirent[];
        try {
          entries = readdirSync(gatesRoot, { withFileTypes: true, encoding: "utf8" });
        } catch (err) {
          if (isEnoent(err)) return Object.freeze([]);
          throw err;
        }
        return Object.freeze(
          entries
            .filter(
              (entry) =>
                entry.isDirectory() &&
                entry.name !== "recovery" &&
                validateStorageGateId(entry.name),
            )
            .map((entry) => entry.name)
            .sort((left, right) => left.localeCompare(right)),
        );
      }),

    readScopeIndex: (reviewScopeId) =>
      serialize(() => {
        assertOpen();
        assertStorageId(reviewScopeId);
        const map = readScopeIndexMap();
        // Key originates from the validated caller scope id.
        // eslint-disable-next-line security/detect-object-injection
        const gateId = Object.hasOwn(map, reviewScopeId) ? map[reviewScopeId] : undefined;
        return gateId === undefined ? null : gateId;
      }),

    writeScopeIndex: (reviewScopeId, gateId) =>
      serialize(() => {
        assertOpen();
        assertStorageId(reviewScopeId);
        assertStorageId(gateId);
        const map = Object.assign(
          Object.create(null) as Record<string, string>,
          readScopeIndexMap(),
        );
        // Both keys originate from validated caller ids (checked above).
        // eslint-disable-next-line security/detect-object-injection
        map[reviewScopeId] = gateId;
        scopeIndex = map;
        writeAtomicUtf8(join(rootDir, SCOPE_INDEX_FILE), `${JSON.stringify(map)}\n`);
        return undefined;
      }),

    close: () => {
      if (closed) return;
      closed = true;
      eventsByGate.clear();
      dispatchesByGate.clear();
      scopeIndex = null;
    },
  };

  return store;
}

function toJsonl(records: readonly unknown[]): string {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

function dispatchContentEquals(
  left: ReviewGateDispatchRecordV1,
  right: ReviewGateDispatchRecordV1,
): boolean {
  return (
    left.dispatchId === right.dispatchId &&
    left.operationId === right.operationId &&
    left.operation === right.operation &&
    left.phase === right.phase &&
    left.dispatchedAt === right.dispatchedAt &&
    left.completedAt === right.completedAt
  );
}

function assertDispatchShape(record: unknown): ReviewGateDispatchRecordV1 {
  if (typeof record !== "object" || record === null) {
    throw new Error("review_gate_dispatch_schema_invalid");
  }
  const candidate = record as Record<string, unknown>;
  const { dispatchId, operationId, operation, phase, dispatchedAt, completedAt } = candidate;
  if (
    typeof dispatchId !== "string" ||
    dispatchId.length === 0 ||
    typeof operationId !== "string" ||
    operationId.length === 0 ||
    typeof operation !== "string" ||
    typeof dispatchedAt !== "string" ||
    dispatchedAt.length === 0 ||
    (completedAt !== null && typeof completedAt !== "string") ||
    (phase !== "design" && phase !== "plan")
  ) {
    throw new Error("review_gate_dispatch_schema_invalid");
  }
  return candidate as unknown as ReviewGateDispatchRecordV1;
}

function isEnoent(err: unknown): boolean {
  return err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT";
}
