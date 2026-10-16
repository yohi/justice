/**
 * Task 6 — durable Review Gate event custody with protected publication CAS.
 *
 * Two construction modes share this module:
 *
 * 1. `createReviewGateEventStore(root, options)` — the **authority store**.
 *    It is bound to one workspace identity, one writer id and one injected
 *    Task 5 `ReviewGateScopeWitness`. Every durable event write flows through
 *    the FDR-011 publication protocol — protected staging + pending identity
 *    first, exact shard tail + directory sync second, witness CAS third —
 *    and every read independently re-verifies Gate→scope membership and the
 *    expected writer frontier against the witness. Durable events live in
 *    per-writer shards at
 *    `.justice/review-gates/events/<reviewScopeId>/<gateId>/<writerId>.jsonl`.
 *    `locks/scope-index.json` stays a non-authoritative cache.
 *
 *    The legacy V1/V2 convenience surface (`appendEvents`/`readEvents`/…)
 *    keeps its signatures but is witness-verified: an unenrolled Gate, a
 *    missing member writer, or a shard that no longer matches the witnessed
 *    frontier fails closed. `readVerifiedScope` hands projection/history a
 *    complete verified scope snapshot; while a prepared publication has an
 *    unanchored tail on disk the witness blocks the whole workspace read, so
 *    readers observe either the old or the new complete frontier.
 *
 *    The FDR-011 owner API — `prepareVerifiedEventPublication`,
 *    `publishPreparedEvent`, `recoverPreparedPublication` — is the only
 *    publication authority: only a successful `publishPreparedEvent` witness
 *    CAS grants projection/admission authority. `recoverPreparedPublication`
 *    is the sole coordinator recovery entrypoint and classifies the crash
 *    matrix (pre-prepare, prepared without tail, matching unanchored tail,
 *    already advanced, partial/unexpected tail) without ever truncating
 *    unknown bytes or minting new event ids.
 *
 *    The PLAN-030 terminal-intent route — `prepareTerminalIntentPublication`,
 *    `publishSealedTerminalIntent`, `recoverPreparedTerminalIntentPublication`
 *    — is the only way a `TARGET_WRITER_HANDOFF_REQUESTED` terminal-revoke
 *    intent may reach the ledger. The prepared intent is staged together with
 *    the protected `TARGET_CLOSING_SEALED` marker but is NOT published; the
 *    generic append/publish/recovery paths reject a terminal intent unless
 *    the witness verifies a complete closing seal (marker plus authenticated
 *    sealed receipt) for the exact prepared event digest.
 *
 * 2. `createLegacyReviewGateEventStore(root)` — the pre-Task-6 local journal
 *    store, byte-for-byte. It keeps the original
 *    `.justice/review-gates/<gateId>/events.jsonl` layout, its atomic-rename
 *    durability and its torn-tail recovery contract unchanged: original
 *    legacy files remain immutable inputs for the Task 8 verified
 *    continuation bridge, and the not-yet-migrated coordinator/history/
 *    approval callers keep their exact behavior until Tasks 7–18 move them
 *    onto the authority store.
 *
 * Lock discipline: the authority store acquires no locks itself. Every
 * witness entrypoint it calls acquires the installation guard and the
 * scope/Gate locks in the canonical order, so publication methods must not be
 * invoked while already holding a scope or Gate lock.
 */

import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
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
import {
  computeArtifactDigest,
  computeCanonicalJsonFingerprint,
  validateStorageGateId,
} from "../core/review-gate/identity";
import type {
  ScopeEnrollmentV1,
  VerifiedClosingSealReceiptV1,
  VerifiedScopeFrontier,
  VerifiedTargetWriterHandoffIntentV1,
} from "../core/review-gate/types";
import type { ReviewGateEvent, ReviewGatePhase } from "../core/review-gate-types";
import type { ReviewGateOperationKind } from "../core/review-gate/agent-protocol";
import type {
  PreparedWitnessPublicationV1,
  ReviewGateScopeWitness,
  TrustedFirstEnrollmentV1,
} from "./review-gate-scope-witness";

const REVIEW_GATES_DIR = ".justice/review-gates";
const EVENTS_DIR = `${REVIEW_GATES_DIR}/events`;
const SCOPE_INDEX_FILE = `${REVIEW_GATES_DIR}/locks/scope-index.json`;
const DISPATCH_JOURNALS_DIR = ".justice/review-gate-dispatches";

/** Task 18 — durable V2 journal file inside the Gate namespace. */
const V2_JOURNAL_FILENAME = "events-v2.jsonl";

/** Temp-file naming used by the atomic rename writes (`<ledger>.<uuid>.tmp`). */
const JOURNAL_TEMP_PATTERN =
  /^(?:events-v2|events|dispatches)\.jsonl\.[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.tmp$/u;

const SHA256_OF_EMPTY = createHash("sha256").update("").digest("hex");

/** Witness convention for a writer shard that does not exist yet. */
const EMPTY_SHARD_HASH = "0".repeat(64);

const MAX_PUBLICATION_TAIL_BYTES = 64 * 1024;
const MAX_WRITER_SHARD_BYTES = 8 * 1024 * 1024;

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

/**
 * Task 18 — durable state of one Gate's V2 journal
 * (`.justice/review-gates/<gateId>/events-v2.jsonl`). The V2 journal is the
 * durable anchor for chained V2 events; legacy V1 projection surfaces never
 * read it, so the legacy state-machine journal stays untouched by V2 custody.
 */
export type ReviewGateV2Journal = Readonly<{
  readonly events: readonly VerifiedReviewGateEvent[];
  /** Frontier hash of the journal bytes (sha256 of the canonical JSONL). */
  readonly frontierHash: string;
  /** eventId of the last chained event; null when the journal is empty. */
  readonly tailEventId: string | null;
  /** Number of chained V2 events. */
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
  /**
   * Task 18 — append one batch of codec-verified V2 events to the Gate's
   * durable V2 journal. The batch must be a non-empty chain: each event
   * carries `schemaVersion: 2`, named `gateId`, an eventId unique to the
   * journal, and a parentEventId chaining from the journal tail (first batch
   * member when the journal is empty). Fail closed on any violation.
   */
  readonly appendV2Events: (gateId: string, events: readonly VerifiedReviewGateEvent[]) => Promise<void>;
  /** Task 18 — durable V2 journal state: chained events, frontier hash, tail. */
  readonly readV2Journal: (gateId: string) => Promise<ReviewGateV2Journal>;
  readonly close: () => void;
}>;

/** Factory binding of the authority store (Task 6 two-arg migration). */
export type ReviewGateEventStoreOptions = Readonly<{
  readonly workspaceIdentity: string;
  readonly writerId: string;
  readonly witness: ReviewGateScopeWitness;
}>;

/** Trusted first-enrollment evidence for one genesis publication. */
export type VerifiedFirstEnrollment = Readonly<{
  /** The provisioner-authenticated enrollment record consumed by the witness. */
  readonly authorization: TrustedFirstEnrollmentV1;
  /** Generation id of the genesis Gate admitted by this publication. */
  readonly generationId: string;
  /** Workflow continuity id bound into the enrolled scope. */
  readonly workflowContinuityId: string;
}>;

/** Input of the FDR-011 publication owner API. */
export type VerifiedEventPublicationInput = Readonly<{
  readonly scopeId: string;
  readonly gateId: string;
  readonly writerId: string;
  readonly operationId: string;
  readonly canonicalEvents: readonly VerifiedReviewGateEvent[];
  readonly firstEnrollment: VerifiedFirstEnrollment | null;
}>;

/** Commit classification shared by publish and recovery entrypoints. */
export type VerifiedEventPublicationOutcome = "committed" | "already_committed" | "blocked";

/** Verified scope snapshot handed to projection, history and admission. */
export type VerifiedScopeRead = Readonly<{
  readonly frontier: VerifiedScopeFrontier;
  readonly gateIds: readonly string[];
  readonly eventsByGate: ReadonlyMap<string, readonly VerifiedReviewGateEvent[]>;
}>;

/** Store-level request for the PLAN-030 sealed terminal-intent route. */
export type TerminalIntentPublicationRequest = Readonly<{
  readonly intents: readonly VerifiedTargetWriterHandoffIntentV1[];
  readonly terminalTransitionOperationId: string;
  readonly scopeId: string;
  readonly gateId: string;
  readonly writerId: string;
  readonly operationId: string;
  readonly canonicalEvents: readonly VerifiedReviewGateEvent[];
}>;

/** Typed continuation returned while a terminal intent is prepared but unpublished. */
export type TerminalIntentPreparedContinuation = Readonly<{
  readonly kind: "TERMINAL_INTENT_PREPARED_UNPUBLISHED";
  readonly publication: PreparedWitnessPublicationV1;
  readonly closingSealOperationId: string;
}>;

/** Input of the sealed terminal-intent publish/recovery entrypoints. */
export type SealedTerminalIntentInput = Readonly<{
  readonly closingSealOperationId: string;
  readonly authorizeSealedReceipt: (payload: unknown) => Promise<string>;
}>;

/** The Task 6 authority surface added on top of the legacy store shape. */
export type VerifiedReviewGateEventStore = Readonly<{
  readonly readVerifiedScope: (scopeId: string) => Promise<VerifiedScopeRead>;
  readonly prepareVerifiedEventPublication: (
    input: VerifiedEventPublicationInput,
  ) => Promise<PreparedWitnessPublicationV1>;
  readonly publishPreparedEvent: (
    input: PreparedWitnessPublicationV1,
  ) => Promise<VerifiedEventPublicationOutcome>;
  readonly recoverPreparedPublication: (
    publicationId: string,
  ) => Promise<VerifiedEventPublicationOutcome>;
  readonly prepareTerminalIntentPublication: (
    input: TerminalIntentPublicationRequest,
  ) => Promise<TerminalIntentPreparedContinuation>;
  readonly publishSealedTerminalIntent: (
    input: SealedTerminalIntentInput,
  ) => Promise<VerifiedClosingSealReceiptV1>;
  readonly recoverPreparedTerminalIntentPublication: (
    input: SealedTerminalIntentInput,
  ) => Promise<VerifiedClosingSealReceiptV1>;
}>;

/** Full authority store: the legacy surface plus the Task 6 verified surface. */
export type DurableReviewGateEventStore = ReviewGateEventStore & VerifiedReviewGateEventStore;

type JournalRead = Readonly<{
  readonly events: readonly VerifiedReviewGateEvent[];
  readonly tornTail: boolean;
}>;

type VerifiedWriterHead = VerifiedScopeFrontier["writerHeads"][number];
type GateMembership = ScopeEnrollmentV1["gateMembership"][number];

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

function fsyncDirectorySync(directory: string): void {
  const descriptor = openSync(directory, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

/**
 * Durably replace one file: write the full content to a fresh O_EXCL temp
 * file, fsync it, atomically rename it into place, then fsync the directory
 * so the rename itself survives a crash.
 */
function writeAtomicUtf8File(file: string, content: string): void {
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
  fsyncDirectorySync(dirname(file));
}

/**
 * Local dispatch journal shared by both store modes. Pure coordinator
 * bookkeeping (`<gateId>/dispatches.jsonl`); never event authority.
 */
function createLocalDispatchJournal(rootDir: string) {
  const dispatchesByGate = new Map<string, readonly ReviewGateDispatchRecordV1[]>();
  const dispatchesFile = (gateId: string): string =>
    join(rootDir, DISPATCH_JOURNALS_DIR, `${gateId}.jsonl`);
  const legacyDispatchesFile = (gateId: string): string =>
    join(rootDir, REVIEW_GATES_DIR, gateId, "dispatches.jsonl");

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

  const load = (gateId: string): readonly ReviewGateDispatchRecordV1[] => {
    const cached = dispatchesByGate.get(gateId);
    if (cached !== undefined) return cached;
    const currentFile = dispatchesFile(gateId);
    const legacyFile = legacyDispatchesFile(gateId);
    const dispatchesByOperation = new Map<string, ReviewGateDispatchRecordV1>();
    for (const line of [
      ...readJsonlLines(legacyFile),
      ...readJsonlLines(currentFile),
    ]) {
      const dispatch = assertDispatchShape(JSON.parse(line));
      const prior = dispatchesByOperation.get(dispatch.operationId);
      if (prior !== undefined && !dispatchContentEquals(prior, dispatch))
        throw new Error("review_gate_dispatch_conflict");
      dispatchesByOperation.set(dispatch.operationId, dispatch);
    }
    const dispatches = [...dispatchesByOperation.values()];
    if (existsSync(legacyFile)) {
      writeAtomicUtf8File(currentFile, toJsonl(dispatches));
      unlinkSync(legacyFile);
      const legacyDirectory = dirname(legacyFile);
      fsyncDirectorySync(legacyDirectory);
      try {
        rmdirSync(legacyDirectory);
        fsyncDirectorySync(dirname(legacyDirectory));
      } catch (error: unknown) {
        if (
          !(error instanceof Error && "code" in error &&
            (error.code === "ENOTEMPTY" || error.code === "ENOENT"))
        )
          throw error;
      }
    }
    const frozen = Object.freeze(dispatches);
    dispatchesByGate.set(gateId, frozen);
    return frozen;
  };

  try {
    const namespaceRoot = join(rootDir, REVIEW_GATES_DIR);
    for (const entry of readdirSync(namespaceRoot, { withFileTypes: true })) {
      if (
        entry.isDirectory() &&
        validateStorageGateId(entry.name) &&
        existsSync(legacyDispatchesFile(entry.name))
      )
        load(entry.name);
    }
  } catch (error: unknown) {
    if (!isEnoent(error)) throw error;
  }

  return {
    record(gateId: string, dispatch: ReviewGateDispatchRecordV1): void {
      const validated = assertDispatchShape(dispatch);
      const current = load(gateId);
      const existing = current.find((record) => record.operationId === validated.operationId);
      if (existing !== undefined) {
        if (!dispatchContentEquals(existing, validated)) {
          throw new Error("review_gate_dispatch_conflict");
        }
        return; // idempotent re-record after a crash restart
      }
      const next: readonly ReviewGateDispatchRecordV1[] = [...current, validated];
      writeAtomicUtf8File(dispatchesFile(gateId), toJsonl(next));
      dispatchesByGate.set(gateId, next);
    },
    markCompleted(gateId: string, operationId: string): void {
      if (operationId.length === 0) throw new Error("review_gate_dispatch_unknown");
      const current = load(gateId);
      const existing = current.find((record) => record.operationId === operationId);
      if (existing === undefined) throw new Error("review_gate_dispatch_unknown");
      if (existing.completedAt !== null) {
        return; // idempotent: already completed
      }
      const completed: ReviewGateDispatchRecordV1 = Object.freeze({
        ...existing,
        completedAt: new Date().toISOString(),
      });
      const next: readonly ReviewGateDispatchRecordV1[] = current.map((record) =>
        record.operationId === operationId ? completed : record,
      );
      writeAtomicUtf8File(dispatchesFile(gateId), toJsonl(next));
      dispatchesByGate.set(gateId, next);
    },
    list(gateId: string): readonly ReviewGateDispatchRecordV1[] {
      return Object.freeze([...load(gateId)]);
    },
    reset(): void {
      dispatchesByGate.clear();
    },
  };
}

/** Runtime guard for the Task 18 V2 envelope over the codec union. */
type V2CodedEvent = VerifiedReviewGateEvent & {
  readonly schemaVersion: 2;
  readonly eventId: string;
  readonly parentEventId: string;
};
const asV2CodedEvent = (event: VerifiedReviewGateEvent): V2CodedEvent => {
  if (!("schemaVersion" in event) || event.schemaVersion !== 2) {
    throw new Error("review_gate_event_v2_required");
  }
  return event as V2CodedEvent;
};

/**
 * Task 18 — durable V2 journal shared by both store modes:
 * `.justice/review-gates/<gateId>/events-v2.jsonl`. Every record passes the
 * Task 4c codec, carries `schemaVersion: 2` and the named gate, and chains
 * from the journal tail (eventId unique across the journal; the first member
 * of every batch must name the current tail as parentEventId whenever the
 * journal is non-empty). Legacy events and torn tails fail closed; the
 * journal is owned by the append-only codec path and never read directly by
 * the legacy V1 state-machine projection.
 */
function createLocalV2Journal(rootDir: string) {
  const eventsByGate = new Map<string, readonly V2CodedEvent[]>();

  const journalFile = (gateId: string): string =>
    join(rootDir, REVIEW_GATES_DIR, gateId, V2_JOURNAL_FILENAME);

  const assertStorageId = (id: string): void => {
    if (!validateStorageGateId(id)) {
      throw new Error("review_gate_invalid_id");
    }
  };

  /** Canonical journal bytes for the committed V2 event list. */
  const journalBytes = (events: readonly V2CodedEvent[]): string =>
    events.length === 0 ? "" : `${events.map(encodeReviewGateEventRecord).join("\n")}\n`;

  const frontierHashOf = (events: readonly V2CodedEvent[]): string =>
    events.length === 0
      ? SHA256_OF_EMPTY
      : createHash("sha256").update(journalBytes(events), "utf8").digest("hex");

  const acquireJournalLock = (gateId: string): (() => void) => {
    const file = journalFile(gateId);
    const directory = dirname(file);
    const lockDirectory = `${file}.lock`;
    mkdirSync(directory, { recursive: true });
    try {
      mkdirSync(lockDirectory, { mode: 0o700 });
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "EEXIST"
      ) {
        throw new Error("review_gate_v2_journal_busy_retryable", { cause: error });
      }
      throw error;
    }
    return () => {
      rmdirSync(lockDirectory);
      fsyncDirectorySync(directory);
    };
  };

  const readCommittedEvents = (gateId: string, refresh = false): readonly V2CodedEvent[] => {
    const cached = eventsByGate.get(gateId);
    if (!refresh && cached !== undefined) return cached;
    let content: string;
    try {
      content = readFileSync(journalFile(gateId), "utf8");
    } catch (err) {
      if (isEnoent(err)) {
        const empty = Object.freeze([]) as readonly V2CodedEvent[];
        eventsByGate.set(gateId, empty);
        return empty;
      }
      throw err;
    }
    if (content.length > 0 && !content.endsWith("\n")) {
      // The V2 journal is append-only with atomic rename commits; a torn
      // tail means foreign or corrupted custody and fails closed.
      throw new Error("review_gate_journal_torn_tail");
    }
    const lines = content.split("\n").filter((line) => line.length > 0);
    const events: V2CodedEvent[] = [];
    for (const [index, line] of lines.entries()) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        throw new Error("review_gate_journal_corrupt");
      }
      const verified = asV2CodedEvent(validateReviewGateEventRecord(parsed));
      const prior = events[index - 1];
      if (prior !== undefined && verified.parentEventId !== prior.eventId) {
        throw new Error("review_gate_v2_journal_chain_invalid");
      }
      events.push(verified);
    }
    const frozen = Object.freeze(events);
    eventsByGate.set(gateId, frozen);
    return frozen;
  };

  return {
    append(gateId: string, batch: readonly VerifiedReviewGateEvent[]): void {
      assertStorageId(gateId);
      if (batch.length === 0) throw new Error("review_gate_event_batch_empty");
      const current = readCommittedEvents(gateId);
      const releaseLock = acquireJournalLock(gateId);
      try {
        const durable = readCommittedEvents(gateId, true);
        if (frontierHashOf(durable) !== frontierHashOf(current)) {
          throw new Error("review_gate_v2_journal_frontier_conflict");
        }
        const tailEventId = current.length > 0 ? current.at(-1)?.eventId ?? null : null;
        const seenEventIds = new Set<string>(current.map((event) => event.eventId));
        const verified: V2CodedEvent[] = [];
        for (const event of batch) {
          const validated = asV2CodedEvent(
            validateReviewGateEventRecord(structuredClone(event)),
          );
          if (validated.gateId !== gateId) {
            throw new Error("review_gate_event_gate_mismatch");
          }
          if (seenEventIds.has(validated.eventId)) {
            throw new Error("review_gate_v2_journal_event_id_conflict");
          }
          const expectedParentEventId =
            verified.length > 0 ? verified.at(-1)?.eventId ?? null : tailEventId;
          if (expectedParentEventId !== null && validated.parentEventId !== expectedParentEventId) {
            // The batch must chain from the durable journal tail (or the prior
            // batch member). The first V2 event of an empty journal anchors
            // freely — the coordinator pins it to the gate id.
            throw new Error("review_gate_v2_journal_chain_invalid");
          }
          seenEventIds.add(validated.eventId);
          verified.push(validated);
        }
        const next = Object.freeze([...current, ...verified]);
        writeAtomicUtf8File(journalFile(gateId), journalBytes(next));
        eventsByGate.set(gateId, next);
      } finally {
        releaseLock();
      }
    },

    readJournal(gateId: string): ReviewGateV2Journal {
      assertStorageId(gateId);
      const events = readCommittedEvents(gateId);
      return Object.freeze({
        events,
        frontierHash: frontierHashOf(events),
        tailEventId: events.at(-1)?.eventId ?? null,
        eventCount: events.length,
      });
    },

    reset(): void {
      eventsByGate.clear();
    },
  };
}

/** Non-authoritative `scope-index.json` cache shared by both store modes. */
function createLocalScopeIndexCache(rootDir: string) {
  let scopeIndex: Record<string, string> | null = null;

  const readMap = (): Record<string, string> => {
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

  return {
    read(reviewScopeId: string): string | null {
      const map = readMap();
      // Key originates from the validated caller scope id.
      // eslint-disable-next-line security/detect-object-injection
      const gateId = Object.hasOwn(map, reviewScopeId) ? map[reviewScopeId] : undefined;
      return gateId === undefined ? null : gateId;
    },
    write(reviewScopeId: string, gateId: string): void {
      const map = Object.assign(
        Object.create(null) as Record<string, string>,
        readMap(),
      );
      // Both keys originate from validated caller ids (checked by the caller).
      // eslint-disable-next-line security/detect-object-injection
      map[reviewScopeId] = gateId;
      scopeIndex = map;
      writeAtomicUtf8File(join(rootDir, SCOPE_INDEX_FILE), `${JSON.stringify(map)}\n`);
    },
    reset(): void {
      scopeIndex = null;
    },
  };
}

/**
 * Create the pre-Task-6 local journal store bound to one workspace root.
 * Id scope validation mirrors the native provider's gate-id contract: an id
 * is never empty and never contains `/`, `\`, `..`, or NUL.
 */
export function createLegacyReviewGateEventStore(rootDir: string): ReviewGateEventStore {
  if (rootDir.length === 0) {
    throw new Error("review_gate_invalid_root");
  }

  let closed = false;
  const eventsByGate = new Map<string, readonly VerifiedReviewGateEvent[]>();
  const dispatchJournal = createLocalDispatchJournal(rootDir);
  const scopeIndexCache = createLocalScopeIndexCache(rootDir);
  /** Task 18 — durable V2 journal custody shared by the Task 18 coordinator. */
  const v2Journal = createLocalV2Journal(rootDir);

  let opChain: Promise<unknown> = Promise.resolve();

  const serialize = <T>(operation: () => T | Promise<T>): Promise<T> => {
    const next = opChain.then(() => operation());
    opChain = next.then(() => undefined, () => undefined);
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
    writeAtomicUtf8File(eventsFile(gateId), journalBytes(frozen));
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
        writeAtomicUtf8File(eventsFile(gateId), journalBytes(frozen));
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
        dispatchJournal.record(gateId, dispatch);
        return undefined;
      }),

    markDispatchCompleted: (gateId, operationId) =>
      serialize(() => {
        assertOpen();
        assertStorageId(gateId);
        dispatchJournal.markCompleted(gateId, operationId);
        return undefined;
      }),

    listDispatches: (gateId) =>
      serialize(() => {
        assertOpen();
        assertStorageId(gateId);
        return dispatchJournal.list(gateId);
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
                entry.name !== "events" &&
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
        return scopeIndexCache.read(reviewScopeId);
      }),

    writeScopeIndex: (reviewScopeId, gateId) =>
      serialize(() => {
        assertOpen();
        assertStorageId(reviewScopeId);
        assertStorageId(gateId);
        scopeIndexCache.write(reviewScopeId, gateId);
        return undefined;
      }),

    /** Task 18 — durable V2 journal custody (append-only, fail closed). */
    appendV2Events: (gateId, events) =>
      serialize(() => {
        assertOpen();
        v2Journal.append(gateId, events);
        return undefined;
      }),

    readV2Journal: (gateId) =>
      serialize(() => {
        assertOpen();
        return v2Journal.readJournal(gateId);
      }),

    close: () => {
      if (closed) return;
      closed = true;
      eventsByGate.clear();
      dispatchJournal.reset();
      scopeIndexCache.reset();
      v2Journal.reset();
    },
  };

  return store;
}

/**
 * Create the authority event store: one workspace identity, one writer and one
 * injected Task 5 witness. Id scope validation mirrors the native provider's
 * gate-id contract: an id is never empty and never contains `/`, `\`, `..`,
 * or NUL.
 */
export function createReviewGateEventStore(
  rootDir: string,
  options: ReviewGateEventStoreOptions,
): DurableReviewGateEventStore {
  if (rootDir.length === 0) {
    throw new Error("review_gate_invalid_root");
  }
  if (options === null || typeof options !== "object") {
    throw new Error("review_gate_witness_required");
  }
  const { workspaceIdentity, writerId, witness } = options;
  if (typeof workspaceIdentity !== "string" || workspaceIdentity.length === 0) {
    throw new Error("review_gate_workspace_identity_required");
  }
  if (typeof writerId !== "string" || !validateStorageGateId(writerId)) {
    throw new Error("review_gate_invalid_id");
  }
  if (
    witness === null ||
    typeof witness !== "object" ||
    typeof witness.preparePublication !== "function" ||
    typeof witness.readWorkspaceScopeFrontier !== "function"
  ) {
    throw new Error("review_gate_witness_required");
  }

  let closed = false;
  const dispatchJournal = createLocalDispatchJournal(rootDir);
  const scopeIndexCache = createLocalScopeIndexCache(rootDir);
  /** Task 18 — durable V2 journal custody shared by the Task 18 coordinator. */
  const v2Journal = createLocalV2Journal(rootDir);

  let opChain: Promise<unknown> = Promise.resolve();

  const serialize = <T>(operation: () => T | Promise<T>): Promise<T> => {
    const next = opChain.then(() => operation());
    opChain = next.then(() => undefined, () => undefined);
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

  const shardFile = (scopeId: string, gateId: string, shardWriterId: string): string =>
    join(rootDir, EVENTS_DIR, scopeId, gateId, `${shardWriterId}.jsonl`);

  const readShardBytes = (
    scopeId: string,
    gateId: string,
    shardWriterId: string,
  ): Buffer | null => {
    try {
      return readFileSync(shardFile(scopeId, gateId, shardWriterId));
    } catch (err) {
      if (isEnoent(err)) return null;
      throw err;
    }
  };

  /** Decode one writer shard; torn or codec-invalid bytes fail closed. */
  const decodeShard = (bytes: Buffer): readonly VerifiedReviewGateEvent[] => {
    if (bytes.length === 0) return [];
    const text = bytes.toString("utf8");
    if (!text.endsWith("\n")) throw new Error("review_gate_journal_torn_tail");
    return text
      .slice(0, -1)
      .split("\n")
      .map((line) => {
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
  };

  /**
   * Observe the verified workspace frontier. `readWorkspaceScopeFrontier`
   * re-verifies every witnessed writer head against the on-disk shard bytes
   * and the protected journal mirror and rejects orphan shards, so this is
   * the independent Gate→scope and expected-writer-frontier check.
   */
  const observeFrontier = async (): Promise<VerifiedScopeFrontier> => {
    const frontier = await witness.readWorkspaceScopeFrontier();
    if (frontier.workspaceIdentity !== workspaceIdentity) {
      throw new Error("review_gate_workspace_identity_mismatch");
    }
    return frontier;
  };

  const findScope = (
    frontier: VerifiedScopeFrontier,
    scopeId: string,
  ): ScopeEnrollmentV1 | null =>
    frontier.scopes.find((scope) => scope.scopeId === scopeId) ?? null;

  const findGate = (scope: ScopeEnrollmentV1, gateId: string): GateMembership | null =>
    scope.gateMembership.find((gate) => gate.gateId === gateId) ?? null;

  /** The witness is the only Gate→scope authority: resolve by membership. */
  const findScopeByGate = (
    frontier: VerifiedScopeFrontier,
    gateId: string,
  ): ScopeEnrollmentV1 | null =>
    frontier.scopes.find((scope) =>
      scope.gateMembership.some((gate) => gate.gateId === gateId),
    ) ?? null;
  const findHead = (
    frontier: VerifiedScopeFrontier,
    scopeId: string,
    gateId: string,
    headWriterId: string,
  ): VerifiedWriterHead | null =>
    frontier.writerHeads.find(
      (head) =>
        head.scopeId === scopeId && head.gateId === gateId && head.writerId === headWriterId,
    ) ?? null;

  /** Aggregate one Gate's events across its member writers in canonical order. */
  const readGateVerifiedEvents = async (
    scopeId: string,
    gate: GateMembership,
  ): Promise<readonly VerifiedReviewGateEvent[]> => {
    const events: VerifiedReviewGateEvent[] = [];
    for (const memberWriterId of [...gate.writerIds].sort()) {
      const bytes = readShardBytes(scopeId, gate.gateId, memberWriterId);
      if (bytes === null) continue;
      events.push(...decodeShard(bytes));
    }
    return Object.freeze(events);
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
    batchWriterId: string,
    events: readonly (ReviewGateEvent | VerifiedReviewGateEvent)[],
  ): readonly VerifiedReviewGateEvent[] => {
    if (events.length === 0) throw new Error("review_gate_event_batch_empty");
    return events.map((event) => {
      const verified = validateReviewGateEventRecord(structuredClone(event));
      if (verified.gateId !== gateId) throw new Error("review_gate_event_gate_mismatch");
      if (verified.writerId !== batchWriterId) throw new Error("review_gate_event_writer_mismatch");
      return verified;
    });
  };

  const isTerminalIntentEvent = (
    event: VerifiedReviewGateEvent,
  ): event is Extract<
    VerifiedReviewGateEvent,
    { readonly eventType: "TARGET_WRITER_HANDOFF_REQUESTED" }
  > =>
    event.eventType === "TARGET_WRITER_HANDOFF_REQUESTED" &&
    event.payload.purpose === "TERMINAL_REVOKE_ONLY";

  /** Generic appends may never carry an unpublished terminal intent. */
  const assertNoTerminalIntent = (events: readonly VerifiedReviewGateEvent[]): void => {
    if (events.some(isTerminalIntentEvent)) {
      throw new Error("review_gate_terminal_intent_requires_seal");
    }
  };

  const findTerminalIntent = (
    events: readonly VerifiedReviewGateEvent[],
  ): Extract<
    VerifiedReviewGateEvent,
    { readonly eventType: "TARGET_WRITER_HANDOFF_REQUESTED" }
  > | null => events.find(isTerminalIntentEvent) ?? null;

  const decodeStagedEvents = (bytes: Buffer): readonly VerifiedReviewGateEvent[] =>
    bytes
      .toString("utf8")
      .trimEnd()
      .split("\n")
      .map((line) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          throw new Error("review_gate_journal_corrupt");
        }
        return validateReviewGateEventRecord(parsed);
      });

  /**
   * A terminal intent may pass the generic commit/recovery paths only when
   * the witness verifies a COMPLETE closing seal: the protected marker for
   * the exact prepared event digest plus its authenticated sealed receipt.
   */
  const hasCompleteClosingSeal = async (
    closingSealOperationId: string,
    preparedEventDigest: string,
  ): Promise<boolean> => {
    try {
      const marker = await witness.verifyClosingSeal({
        closingSealOperationId,
        preparedEventDigest,
      });
      return marker.sealedReceiptDigest !== null;
    } catch {
      return false;
    }
  };

  /** Reject a terminal intent on a generic commit path unless fully sealed. */
  const assertTerminalIntentSealed = async (
    events: readonly VerifiedReviewGateEvent[],
    preparedEventDigest: string,
  ): Promise<boolean> => {
    const terminal = findTerminalIntent(events);
    if (terminal === null) return true;
    const closingSealOperationId = terminal.payload.closingSealOperationId;
    if (closingSealOperationId === null) return false;
    return hasCompleteClosingSeal(closingSealOperationId, preparedEventDigest);
  };

  const writerHeadKey = (head: VerifiedWriterHead): string =>
    `${head.scopeId}\0${head.gateId}\0${head.writerId}`;

  const buildGenesisScope = (
    input: Readonly<{ scopeId: string; gateId: string; writerId: string }>,
    firstEnrollment: VerifiedFirstEnrollment,
  ): ScopeEnrollmentV1 => {
    const authority = firstEnrollment.authorization.authority;
    return Object.freeze({
      scopeId: input.scopeId,
      workflowContinuityId: firstEnrollment.workflowContinuityId,
      canonicalDesignPath: authority.canonicalDesignPath,
      canonicalPlanPath: authority.canonicalPlanPath,
      pathPairDigest: computeCanonicalJsonFingerprint([
        authority.canonicalDesignPath,
        authority.canonicalPlanPath,
      ]),
      provenance: Object.freeze({
        kind: "verified_genesis" as const,
        evidenceDigest: computeCanonicalJsonFingerprint(authority),
        priorScopeId: null,
        priorGateId: null,
      }),
      gateMembership: [
        Object.freeze({
          gateId: input.gateId,
          generationId: firstEnrollment.generationId,
          supersedesGateId: null,
          admissionEventId: authority.authorizationEventId,
          writerIds: [input.writerId],
        }),
      ],
    });
  };

  type PublicationDraft = Readonly<{
    readonly publication: PreparedWitnessPublicationV1;
    readonly bytes: Buffer;
    readonly priorHead: VerifiedWriterHead | null;
  }>;

  /**
   * Build the exact canonical next shard bytes and the complete
   * `PreparedWitnessPublicationV1` for one publication. The prior shard bytes
   * are re-read from disk and cross-checked against the witnessed writer
   * head, so the staged tail always extends the verified frontier.
   */
  const buildPublication = async (
    input: Readonly<{
      scopeId: string;
      gateId: string;
      writerId: string;
      operationId: string;
      canonicalEvents: readonly VerifiedReviewGateEvent[];
      firstEnrollment: VerifiedFirstEnrollment | null;
    }>,
    frontier?: VerifiedScopeFrontier,
  ): Promise<PublicationDraft> => {
    const observed = frontier ?? (await observeFrontier());
    const priorHead = findHead(observed, input.scopeId, input.gateId, input.writerId);
    const priorBytes = readShardBytes(input.scopeId, input.gateId, input.writerId);
    if (priorHead === null) {
      if (priorBytes !== null && priorBytes.length > 0) {
        throw new Error("review_gate_writer_frontier_mismatch");
      }
    } else if (
      priorBytes === null ||
      priorBytes.length === 0 ||
      computeArtifactDigest(priorBytes) !== priorHead.hash
    ) {
      throw new Error("review_gate_writer_frontier_mismatch");
    }

    let scopes: readonly ScopeEnrollmentV1[];
    if (input.firstEnrollment !== null) {
      // A genesis publication is the only enrollment path; a second one is
      // never minted from an already-enrolled workspace frontier.
      if (observed.scopes.length !== 0) {
        throw new Error("review_gate_second_genesis_forbidden");
      }
      const authority = input.firstEnrollment.authorization.authority;
      const genesis = input.canonicalEvents[0];
      if (
        genesis === undefined ||
        genesis.eventType !== "GATE_CREATED" ||
        genesis.payload.reviewScopeId !== input.scopeId ||
        genesis.payload.designArtifact.canonicalPath !== authority.canonicalDesignPath ||
        genesis.payload.planArtifact.canonicalPath !== authority.canonicalPlanPath
      ) {
        throw new Error("review_gate_genesis_event_invalid");
      }
      scopes = [buildGenesisScope(input, input.firstEnrollment)];
    } else {
      const scope = findScope(observed, input.scopeId);
      const gate = scope === null ? null : findGate(scope, input.gateId);
      if (scope === null || gate === null) {
        throw new Error("review_gate_gate_membership_missing");
      }
      if (!gate.writerIds.includes(input.writerId)) {
        throw new Error("review_gate_writer_membership_missing");
      }
      scopes = observed.scopes;
    }

    const tailLines = input.canonicalEvents.map(encodeReviewGateEventRecord).join("\n");
    const tailBytes = Buffer.from(`${tailLines}\n`);
    const bytes = Buffer.concat([priorBytes ?? Buffer.alloc(0), tailBytes]);
    if (tailBytes.length > MAX_PUBLICATION_TAIL_BYTES) {
      throw new Error("review_gate_publication_bytes_exceeded");
    }
    if (bytes.length > MAX_WRITER_SHARD_BYTES) {
      throw new Error("review_gate_publication_bytes_exceeded");
    }
    const newTailDigest = computeArtifactDigest(tailBytes);
    const newWriterHash = computeArtifactDigest(bytes);
    const expectedWriterSequence = priorHead?.sequence ?? 0;
    const newWriterSequence = expectedWriterSequence + input.canonicalEvents.length;
    const head: VerifiedWriterHead = Object.freeze({
      scopeId: input.scopeId,
      gateId: input.gateId,
      writerId: input.writerId,
      sequence: newWriterSequence,
      hash: newWriterHash,
    });
    const writerHeads = [...observed.writerHeads.filter((entry) => entry !== priorHead), head]
      .sort(
        (left, right) =>
          writerHeadKey(left) < writerHeadKey(right)
            ? -1
            : writerHeadKey(left) > writerHeadKey(right)
              ? 1
              : 0,
      );
    const contents = {
      workspaceIdentity: observed.workspaceIdentity,
      workspaceEnrollmentId: observed.workspaceEnrollmentId,
      scopes,
      writerHeads,
    };
    const globalFrontierHash = computeCanonicalJsonFingerprint(contents);
    const publicationId = computeCanonicalJsonFingerprint({
      scopeId: input.scopeId,
      gateId: input.gateId,
      writerId: input.writerId,
      operationId: input.operationId,
      newTailDigest,
    });
    const installation = await witness.readInstallation();
    const publication: PreparedWitnessPublicationV1 = Object.freeze({
      installationId: installation.installationId,
      workspaceIdentity: observed.workspaceIdentity,
      scopeId: input.scopeId,
      gateId: input.gateId,
      writerId: input.writerId,
      operationId: input.operationId,
      publicationId,
      expectedInstallationFrontier: await witness.readInstallationFrontierHash(),
      expectedGlobalFrontier: observed.globalFrontierHash,
      expectedWriterSequence,
      expectedWriterHash: priorHead?.hash ?? EMPTY_SHARD_HASH,
      newWriterSequence,
      newWriterHash,
      canonicalShardPath: `${input.scopeId}/${input.gateId}/${input.writerId}.jsonl`,
      newTailLength: tailBytes.length,
      newTailDigest,
      newGlobalFrontier: globalFrontierHash,
      firstEnrollmentAuthorizationId:
        input.firstEnrollment === null
          ? null
          : input.firstEnrollment.authorization.authority.authorizationEventId,
      payloadSchemaVersion: 1,
      nextFrontier: Object.freeze({ ...contents, globalFrontierHash }),
    });
    return { publication, bytes, priorHead };
  };

  /**
   * FDR-011 durable prepare: protected staging + pending identity first,
   * then the exact shard tail and its containing directory synced through
   * the witness's native preimage-CAS replace.
   */
  const prepareAndSyncShard = async (
    publication: PreparedWitnessPublicationV1,
    bytes: Buffer,
  ): Promise<void> => {
    const outcome = await witness.preparePublication(publication, bytes);
    if (outcome !== "prepared" && outcome !== "already_prepared") {
      throw new Error("review_gate_publication_cas_conflict");
    }
    await witness.publishPreparedJournal(publication.publicationId);
  };

  const commitOutcome = (
    result: "advanced" | "already_committed" | "blocked",
  ): VerifiedEventPublicationOutcome =>
    result === "advanced" ? "committed" : result === "already_committed" ? result : "blocked";

  const commitOrRecover = async (input: {
    readonly publicationId: string;
    readonly expectedGlobalFrontier: string;
    readonly expectedWriterHash: string;
  }): Promise<"advanced" | "already_committed"> => {
    const committed = await witness.commitPreparedPublicationCAS(input);
    if (committed !== "blocked") return committed;
    const recovered = await witness.recoverPreparedPublication(input.publicationId);
    if (recovered === "blocked") {
      throw new Error(`review_gate_publication_cas_conflict:${input.publicationId}`);
    }
    return recovered;
  };

  const store: DurableReviewGateEventStore = {
    appendEvents: (gateId, events) =>
      serialize(async () => {
        assertOpen();
        assertStorageId(gateId);
        const batch = validateJournalBatch(gateId, writerId, events);
        if (batch.some((event) => "schemaVersion" in event)) {
          throw new Error("review_gate_event_unsupported_v2");
        }
        assertNoTerminalIntent(batch);
        const frontier = await observeFrontier();
        const scope = findScopeByGate(frontier, gateId);
        if (scope === null) throw new Error("review_gate_gate_membership_missing");
        const gate = findGate(scope, gateId);
        if (gate === null) throw new Error("review_gate_gate_membership_missing");
        if (!gate.writerIds.includes(writerId)) {
          throw new Error("review_gate_writer_membership_missing");
        }
        const current = await readGateVerifiedEvents(scope.scopeId, gate);
        assertLegacyJournal(current);
        const priorHead = findHead(frontier, scope.scopeId, gateId, writerId);
        const { publication, bytes } = await buildPublication(
          {
            scopeId: scope.scopeId,
            gateId,
            writerId,
            operationId: `append-${(priorHead?.sequence ?? 0) + batch.length}`,
            canonicalEvents: batch,
            firstEnrollment: null,
          },
          frontier,
        );
        await prepareAndSyncShard(publication, bytes);
        await commitOrRecover({
          publicationId: publication.publicationId,
          expectedGlobalFrontier: publication.expectedGlobalFrontier,
          expectedWriterHash: publication.expectedWriterHash,
        });
        return undefined;
      }),

    readEvents: (gateId) =>
      serialize(async () => {
        assertOpen();
        assertStorageId(gateId);
        const frontier = await observeFrontier();
        const scope = findScopeByGate(frontier, gateId);
        if (scope === null) throw new Error("review_gate_gate_membership_missing");
        const gate = findGate(scope, gateId);
        if (gate === null) throw new Error("review_gate_gate_membership_missing");
        const events = await readGateVerifiedEvents(scope.scopeId, gate);
        assertLegacyJournal(events);
        return legacyView(events);
      }),

    readVerifiedEvents: (gateId) =>
      serialize(async () => {
        assertOpen();
        assertStorageId(gateId);
        const frontier = await observeFrontier();
        const scope = findScopeByGate(frontier, gateId);
        if (scope === null) throw new Error("review_gate_gate_membership_missing");
        const gate = findGate(scope, gateId);
        if (gate === null) throw new Error("review_gate_gate_membership_missing");
        return readGateVerifiedEvents(scope.scopeId, gate);
      }),

    readFrontierHash: (gateId) =>
      serialize(async () => {
        assertOpen();
        assertStorageId(gateId);
        const frontier = await observeFrontier();
        const scope = findScopeByGate(frontier, gateId);
        if (scope === null) throw new Error("review_gate_gate_membership_missing");
        return findHead(frontier, scope.scopeId, gateId, writerId)?.hash ?? EMPTY_SHARD_HASH;
        throw new Error("review_gate_gate_membership_missing");
      }),

    publishEvents: (gateId, events, expectedFrontierHash) =>
      serialize(async () => {
        assertOpen();
        assertStorageId(gateId);
        const batch = validateJournalBatch(gateId, writerId, events);
        assertNoTerminalIntent(batch);
        const frontier = await observeFrontier();
        const scope = findScopeByGate(frontier, gateId);
        if (scope === null) throw new Error("review_gate_gate_membership_missing");
        const gate = findGate(scope, gateId);
        if (gate === null) throw new Error("review_gate_gate_membership_missing");
        if (!gate.writerIds.includes(writerId)) {
          throw new Error("review_gate_writer_membership_missing");
        }
        const priorHead = findHead(frontier, scope.scopeId, gateId, writerId);
        if ((priorHead?.hash ?? EMPTY_SHARD_HASH) !== expectedFrontierHash) {
          throw new Error("review_gate_publication_cas_conflict");
        }
        const { publication, bytes } = await buildPublication(
          {
            scopeId: scope.scopeId,
            gateId,
            writerId,
            operationId: `publish-${(priorHead?.sequence ?? 0) + batch.length}`,
            canonicalEvents: batch,
            firstEnrollment: null,
          },
          frontier,
        );
        await prepareAndSyncShard(publication, bytes);
        await commitOrRecover({
          publicationId: publication.publicationId,
          expectedGlobalFrontier: publication.expectedGlobalFrontier,
          expectedWriterHash: publication.expectedWriterHash,
        });
        return Object.freeze({
          frontierHash: publication.newWriterHash,
          eventCount: publication.newWriterSequence,
        });
      }),

    /**
     * Verified clean check of one Gate. Authority shards are only ever
     * written through the native preimage-CAS replace, so there is no torn
     * tail to heal: crash recovery belongs to `recoverPreparedPublication`
     * and this entrypoint never mutates authority bytes.
     */
    recoverJournal: (gateId) =>
      serialize(async () => {
        assertOpen();
        assertStorageId(gateId);
        const frontier = await observeFrontier();
        const scope =
          frontier.scopes.find((entry) =>
            entry.gateMembership.some((gate) => gate.gateId === gateId),
          ) ?? null;
        if (scope === null) throw new Error("review_gate_gate_membership_missing");
        const gate = findGate(scope, gateId);
        if (gate === null) throw new Error("review_gate_gate_membership_missing");
        const events = await readGateVerifiedEvents(scope.scopeId, gate);
        return Object.freeze({
          status: "clean" as const,
          eventCount: events.length,
          frontierHash: findHead(frontier, scope.scopeId, gateId, writerId)?.hash ?? EMPTY_SHARD_HASH,
        });
      }),

    recordDispatch: (gateId, dispatch) =>
      serialize(() => {
        assertOpen();
        assertStorageId(gateId);
        dispatchJournal.record(gateId, dispatch);
        return undefined;
      }),

    markDispatchCompleted: (gateId, operationId) =>
      serialize(() => {
        assertOpen();
        assertStorageId(gateId);
        dispatchJournal.markCompleted(gateId, operationId);
        return undefined;
      }),

    listDispatches: (gateId) =>
      serialize(() => {
        assertOpen();
        assertStorageId(gateId);
        return dispatchJournal.list(gateId);
      }),

    /** Gate namespaces are enumerated from the witnessed membership only. */
    listGateIds: () =>
      serialize(async () => {
        assertOpen();
        const frontier = await observeFrontier();
        const ids = new Set<string>();
        for (const scope of frontier.scopes) {
          for (const gate of scope.gateMembership) ids.add(gate.gateId);
        }
        return Object.freeze([...ids].sort((left, right) => left.localeCompare(right)));
      }),

    readScopeIndex: (reviewScopeId) =>
      serialize(() => {
        assertOpen();
        assertStorageId(reviewScopeId);
        return scopeIndexCache.read(reviewScopeId);
      }),

    writeScopeIndex: (reviewScopeId, gateId) =>
      serialize(() => {
        assertOpen();
        assertStorageId(reviewScopeId);
        assertStorageId(gateId);
        scopeIndexCache.write(reviewScopeId, gateId);
        return undefined;
      }),

    readVerifiedScope: (scopeId) =>
      serialize(async () => {
        assertOpen();
        assertStorageId(scopeId);
        const frontier = await observeFrontier();
        const scope = findScope(frontier, scopeId);
        if (scope === null) throw new Error("review_gate_scope_membership_missing");
        const gateIds = Object.freeze(
          scope.gateMembership.map((gate) => gate.gateId).sort((left, right) => left.localeCompare(right)),
        );
        const eventsByGate = new Map<string, readonly VerifiedReviewGateEvent[]>();
        for (const gate of scope.gateMembership) {
          eventsByGate.set(gate.gateId, await readGateVerifiedEvents(scopeId, gate));
        }
        return Object.freeze({ frontier, gateIds, eventsByGate });
      }),

    /**
     * FDR-011 publication owner: create the exact encoded bytes/length/digest
     * and the stable derived publication id, durably stage them in the
     * protected witness registry, then write and fsync the matching shard
     * tail. The returned record is not yet authority; only a successful
     * `publishPreparedEvent` witness CAS grants projection/admission rights.
     */
    prepareVerifiedEventPublication: (input) =>
      serialize(async () => {
        assertOpen();
        if (input === null || typeof input !== "object") {
          throw new Error("review_gate_publication_input_invalid");
        }
        assertStorageId(input.scopeId);
        assertStorageId(input.gateId);
        assertStorageId(input.writerId);
        assertStorageId(input.operationId);
        if (!Array.isArray(input.canonicalEvents) || input.canonicalEvents.length === 0) {
          throw new Error("review_gate_event_batch_empty");
        }
        const canonicalEvents = validateJournalBatch(
          input.gateId,
          input.writerId,
          input.canonicalEvents,
        );
        assertNoTerminalIntent(canonicalEvents);
        const { publication, bytes } = await buildPublication({
          scopeId: input.scopeId,
          gateId: input.gateId,
          writerId: input.writerId,
          operationId: input.operationId,
          canonicalEvents,
          firstEnrollment: input.firstEnrollment,
        });
        await prepareAndSyncShard(publication, bytes);
        return publication;
      }),

    /**
     * Commit one prepared publication: verify the exact shard bytes on disk
     * against the protected staged record, then invoke the witness CAS. Only
     * this success grants projection/admission authority.
     */
    publishPreparedEvent: (input) =>
      serialize(async () => {
        assertOpen();
        if (input === null || typeof input !== "object") {
          throw new Error("review_gate_publication_input_invalid");
        }
        if (typeof input.publicationId !== "string" || input.publicationId.length === 0) {
          throw new Error("review_gate_publication_unprepared");
        }
        let record: Awaited<ReturnType<typeof witness.readPreparedPublication>>;
        try {
          record = await witness.readPreparedPublication(input.publicationId);
        } catch (error: unknown) {
          if (error instanceof Error) return "blocked" as const;
          throw error;
        }
        if (
          record.input.scopeId !== input.scopeId ||
          record.input.gateId !== input.gateId ||
          record.input.writerId !== input.writerId ||
          record.input.operationId !== input.operationId ||
          record.input.newTailDigest !== input.newTailDigest ||
          record.input.newTailLength !== input.newTailLength ||
          record.input.expectedGlobalFrontier !== input.expectedGlobalFrontier ||
          record.input.expectedWriterHash !== input.expectedWriterHash
        ) {
          return "blocked" as const;
        }
        const events = decodeStagedEvents(record.bytes);
        if (!(await assertTerminalIntentSealed(events, record.input.newTailDigest))) {
          return "blocked" as const;
        }
        const shard = readShardBytes(
          record.input.scopeId,
          record.input.gateId,
          record.input.writerId,
        );
        if (shard === null || !shard.equals(record.bytes)) {
          return "blocked" as const;
        }
        const result = await commitOrRecover({
          publicationId: input.publicationId,
          expectedGlobalFrontier: input.expectedGlobalFrontier,
          expectedWriterHash: input.expectedWriterHash,
        });
        return commitOutcome(result);
      }),

    /**
     * Sole coordinator recovery entrypoint. Re-reads the protected pending
     * record and the on-disk shard tail, classifies the crash window and
     * retries the exact same bytes and operation — never truncating unknown
     * bytes, reconstructing agent output or minting new event ids.
     */
    recoverPreparedPublication: (publicationId) =>
      serialize(async () => {
        assertOpen();
        if (typeof publicationId !== "string" || publicationId.length === 0) {
          throw new Error("review_gate_publication_unprepared");
        }
        let record: Awaited<ReturnType<typeof witness.readPreparedPublication>>;
        try {
          record = await witness.readPreparedPublication(publicationId);
        } catch (error: unknown) {
          if (error instanceof Error) return "blocked" as const;
          throw error;
        }
        const classification = await witness.classifyPreparedPublication(publicationId);
        if (classification === "blocked") return "blocked" as const;
        const shard = readShardBytes(
          record.input.scopeId,
          record.input.gateId,
          record.input.writerId,
        );
        if (classification === "committed") {
          // Witness already advanced: idempotent only when the shard holds
          // the exact committed tail; a missing shard stays blocked.
          return shard !== null && shard.length >= record.bytes.length &&
            shard.subarray(0, record.bytes.length).equals(record.bytes)
            ? ("already_committed" as const)
            : ("blocked" as const);
        }
        const events = decodeStagedEvents(record.bytes);
        if (!(await assertTerminalIntentSealed(events, record.input.newTailDigest))) {
          return "blocked" as const;
        }
        if (shard !== null && shard.equals(record.bytes)) {
          // Complete matching unanchored tail: finish the same CAS.
          return commitOutcome(await witness.recoverPreparedPublication(publicationId));
        }
        const shardDigest = shard === null ? null : computeArtifactDigest(shard);
        if (shard === null || shardDigest === record.input.expectedWriterHash) {
          if (shard === null && record.input.expectedWriterHash !== EMPTY_SHARD_HASH) {
            // The witnessed preimage shard is gone: never reconstruct it.
            return "blocked" as const;
          }
          // Prepared with no tail: reload the durably protected staged
          // bytes and append the exact same tail for the same operation.
          await witness.publishPreparedJournal(publicationId);
          return commitOutcome(await witness.recoverPreparedPublication(publicationId));
        }
        // Partial or unexpected tail: blocked without truncating it.
        return "blocked" as const;
      }),

    /**
     * PLAN-030 terminal-intent route. Stages the exact canonical terminal
     * intent bytes together with the protected `TARGET_CLOSING_SEALED`
     * marker while the Gate lease is held, but does NOT publish: the
     * prepared record is non-authoritative until the outer sealed driver
     * calls `publishSealedTerminalIntent`.
     */
    prepareTerminalIntentPublication: (input) =>
      serialize(async () => {
        assertOpen();
        if (input === null || typeof input !== "object") {
          throw new Error("review_gate_terminal_intent");
        }
        assertStorageId(input.scopeId);
        assertStorageId(input.gateId);
        assertStorageId(input.writerId);
        assertStorageId(input.operationId);
        assertStorageId(input.terminalTransitionOperationId);
        if (!Array.isArray(input.intents) || input.intents.length === 0) {
          throw new Error("review_gate_terminal_intent");
        }
        const closingSealOperationId = input.intents[0]?.closingSealOperationId;
        if (
          closingSealOperationId === null ||
          closingSealOperationId === undefined ||
          input.intents.some(
            (intent) =>
              intent.purpose !== "TERMINAL_REVOKE_ONLY" ||
              intent.closingSealOperationId !== closingSealOperationId ||
              intent.gateId !== input.gateId ||
              intent.newOwner !== null,
          )
        ) {
          throw new Error("review_gate_terminal_intent");
        }
        if (!Array.isArray(input.canonicalEvents) || input.canonicalEvents.length === 0) {
          throw new Error("review_gate_event_batch_empty");
        }
        const canonicalEvents = validateJournalBatch(
          input.gateId,
          input.writerId,
          input.canonicalEvents,
        );
        for (const event of canonicalEvents) {
          if (
            event.eventType !== "TARGET_WRITER_HANDOFF_REQUESTED" ||
            event.payload.purpose !== "TERMINAL_REVOKE_ONLY" ||
            event.payload.closingSealOperationId !== closingSealOperationId
          ) {
            throw new Error("review_gate_terminal_intent");
          }
        }
        const { publication, bytes } = await buildPublication({
          scopeId: input.scopeId,
          gateId: input.gateId,
          writerId: input.writerId,
          operationId: input.operationId,
          canonicalEvents,
          firstEnrollment: null,
        });
        const outcome = await witness.prepareTerminalIntentPublication(
          {
            intents: input.intents,
            terminalTransitionOperationId: input.terminalTransitionOperationId,
            publication,
          },
          bytes,
        );
        if (outcome !== "prepared" && outcome !== "already_prepared") {
          throw new Error("review_gate_terminal_intent");
        }
        return Object.freeze({
          kind: "TERMINAL_INTENT_PREPARED_UNPUBLISHED" as const,
          publication,
          closingSealOperationId,
        });
      }),

    /**
     * Publish the sealed terminal intent through the ordinary Gate-owned
     * witness CAS. The witness verifies the complete protected target-set
     * seal, durably replaces the shard, commits the publication and binds the
     * authenticated sealed receipt; the call is idempotent per seal.
     */
    publishSealedTerminalIntent: (input) =>
      serialize(async () => {
        assertOpen();
        if (input === null || typeof input !== "object") {
          throw new Error("review_gate_terminal_intent");
        }
        assertStorageId(input.closingSealOperationId);
        if (typeof input.authorizeSealedReceipt !== "function") {
          throw new Error("review_gate_terminal_intent");
        }
        return witness.publishSealedTerminalIntent(input);
      }),

    /** Idempotent recovery of a sealed-but-unpublished terminal intent. */
    recoverPreparedTerminalIntentPublication: (input) =>
      serialize(async () => {
        assertOpen();
        if (input === null || typeof input !== "object") {
          throw new Error("review_gate_terminal_intent");
        }
        assertStorageId(input.closingSealOperationId);
        if (typeof input.authorizeSealedReceipt !== "function") {
          throw new Error("review_gate_terminal_intent");
        }
        return witness.recoverPreparedTerminalIntentPublication(input);
      }),
    /** Task 18 — durable V2 journal custody (shared local journal namespace). */
    appendV2Events: (gateId, events) =>
      serialize(async () => {
        assertOpen();
        v2Journal.append(gateId, events);
        return undefined;
      }),

    readV2Journal: (gateId) =>
      serialize(async () => {
        assertOpen();
        return v2Journal.readJournal(gateId);
      }),

    close: () => {
      if (closed) return;
      closed = true;
      dispatchJournal.reset();
      scopeIndexCache.reset();
      v2Journal.reset();
    },
  };

  return store;
}
