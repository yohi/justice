/**
 * Task 12 Phase A — durable Review Gate event store (runtime, brief layout).
 *
 * JSON-only persistence with atomic temp-file-plus-rename writes:
 *
 * - `.justice/review-gates/<gateId>/events.jsonl`     — ReviewGateEvent ledger
 * - `.justice/review-gates/<gateId>/dispatches.jsonl` — dispatch records
 * - `.justice/review-gates/scope-index.json`         — reviewScopeId → gateId
 *
 * The store serializes all operations through one internal op chain, so the
 * persistence order for same-gate appends is exactly call order. Every
 * publication is a whole-file atomic replace (temp file + rename); reads
 * answer from a private in-memory cache seeded from persisted content and
 * return frozen snapshots. This is the interim Task 12 layout; per-writer
 * shards and the versioned envelope (design spec §11) arrive with the Phase
 * C coordinator.
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import type { Dirent } from "node:fs";
import { dirname, join } from "node:path";
import { validateStorageGateId } from "../core/review-gate/identity";
import type { ReviewGateEvent, ReviewGatePhase } from "../core/review-gate-types";
import type { ReviewGateOperationKind } from "../core/review-gate/agent-protocol";

const REVIEW_GATES_DIR = ".justice/review-gates";
const SCOPE_INDEX_FILE = `${REVIEW_GATES_DIR}/scope-index.json`;

/** One durably recorded dispatch intent; completion may occur later. */
export type ReviewGateDispatchRecordV1 = Readonly<{
  readonly dispatchId: string;
  readonly operationId: string;
  readonly operation: ReviewGateOperationKind;
  readonly phase: ReviewGatePhase;
  readonly dispatchedAt: string;
  readonly completedAt: string | null;
}>;

export type ReviewGateEventStore = Readonly<{
  readonly appendEvents: (gateId: string, events: readonly ReviewGateEvent[]) => Promise<void>;
  readonly readEvents: (gateId: string) => Promise<readonly ReviewGateEvent[]>;
  readonly recordDispatch: (gateId: string, dispatch: ReviewGateDispatchRecordV1) => Promise<void>;
  readonly markDispatchCompleted: (gateId: string, operationId: string) => Promise<void>;
  readonly listDispatches: (gateId: string) => Promise<readonly ReviewGateDispatchRecordV1[]>;
  readonly listGateIds: () => Promise<readonly string[]>;
  readonly readScopeIndex: (reviewScopeId: string) => Promise<string | null>;
  readonly writeScopeIndex: (reviewScopeId: string, gateId: string) => Promise<void>;
  readonly close: () => void;
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
  const eventsByGate = new Map<string, readonly ReviewGateEvent[]>();
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

  const writeAtomicUtf8 = (file: string, content: string): void => {
    mkdirSync(dirname(file), { recursive: true });
    const temp = `${file}.${randomUUID()}.tmp`;
    writeFileSync(temp, content, "utf8");
    renameSync(temp, file);
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

  const loadEvents = (gateId: string): readonly ReviewGateEvent[] => {
    const cached = eventsByGate.get(gateId);
    if (cached !== undefined) return cached;
    const events: ReviewGateEvent[] = readJsonlLines(eventsFile(gateId)).map((line) =>
      castEvent(JSON.parse(line)),
    );
    const frozen = Object.freeze(events.map((event) => deepFreeze(event)));
    eventsByGate.set(gateId, frozen);
    return frozen;
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
    appendEvents: (gateId, events) => {
      const snapshots = events.map((event) => deepFreeze(structuredClone(event)));
      return serialize(() => {
        assertOpen();
        assertStorageId(gateId);
        if (events.length === 0) throw new Error("review_gate_event_batch_empty");
        for (const event of events) {
          assertEventShape(event);
          if (event.gateId !== gateId) throw new Error("review_gate_event_gate_mismatch");
        }
        const next: readonly ReviewGateEvent[] = Object.freeze([
          ...loadEvents(gateId),
          ...snapshots,
        ]);
        writeAtomicUtf8(eventsFile(gateId), toJsonl(next));
        eventsByGate.set(gateId, next);
        return undefined;
      });
    },

    readEvents: (gateId) =>
      serialize(() => {
        assertOpen();
        assertStorageId(gateId);
        return Object.freeze([...loadEvents(gateId)]);
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

function assertEventShape(event: unknown): void {
  if (typeof event !== "object" || event === null) {
    throw new Error("review_gate_event_schema_invalid");
  }
  const record = event as Record<string, unknown>;
  for (const field of ["eventType", "gateId", "writerId", "epochId", "emittedAt"] as const) {
    // Field name originates from the frozen literal field list above.
    // eslint-disable-next-line security/detect-object-injection
    const value = record[field];
    if (typeof value !== "string" || value.length === 0) {
      throw new Error("review_gate_event_schema_invalid");
    }
  }
  // Field name originates from the frozen literal field list above.
  // eslint-disable-next-line security/detect-object-injection
  const payload = record.payload;
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("review_gate_event_schema_invalid");
  }
}

function castEvent(record: unknown): ReviewGateEvent {
  assertEventShape(record);
  return record as ReviewGateEvent;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
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
