/**
 * Task 18 — production Review Gate path over real durable custody:
 * the legacy disk event store, the content-addressed recovery store, the
 * Task 18 V2 journal, and the witness publication seam — including the
 * restart/reopen window where the chain continues from the persisted tail.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  createReviewGateCoordinator,
  type CallerRoutingDecisionV1,
  type ReviewGateWitnessPublicationSeamV1,
  type ReviewGateWorkspaceReader,
} from "../../src/runtime/review-gate-coordinator";
import {
  createLegacyReviewGateEventStore,
  type ReviewGateEventStore,
  type ReviewGateV2Journal,
} from "../../src/runtime/review-gate-event-store";
import { createReviewGateRecoveryStore } from "../../src/runtime/review-gate-recovery-store";
import { createReviewGateLockManager } from "../../src/runtime/review-gate-lock-manager";
import { createReviewGateProtocolDescriptor } from "../../src/runtime/review-gate-protocol";
import type { ReviewGateNextOperation } from "../../src/core/review-gate/orchestrator";
import { validateReviewGateEventRecord } from "../../src/core/review-gate/event-schema";

const DESIGN_PATH = "docs/design.md";
const PLAN_PATH = "docs/plan.md";

const afterAllCleanups: (() => void)[] = [];
afterAll(() => {
  for (const cleanup of afterAllCleanups) cleanup();
});

/**
 * Straight-through witness publication seam double: records the prepared
 * publication request and returns the derived publication record. This
 * exercises the coordinator → seam contract on real durable stores; the
 * witness-registry binding itself is the composition-root wiring beyond this
 * task's scope.
 */
function createRecordingSeam(): ReviewGateWitnessPublicationSeamV1 & {
  readonly calls: () => number;
} {
  let calls = 0;
  return {
    calls: () => calls,
    prepareAndPublish: async (input) => {
      calls += 1;
      return Object.freeze({
        installationId: "production-test-installation",
        workspaceIdentity: "production-test-workspace",
        scopeId: "production-test-scope",
        gateId: input.gateId,
        writerId: input.writerId,
        operationId: input.operationId,
        publicationId: `publication-${calls}`,
        expectedInstallationFrontier: "installation-frontier",
        expectedGlobalFrontier: input.baseFrontierHash,
        expectedWriterSequence: 0,
        expectedWriterHash: "expected-writer-hash",
        newWriterSequence: input.appendedEventCount,
        newWriterHash: input.newFrontierHash,
        canonicalShardPath: `${input.gateId}/events-v2.jsonl`,
        newTailLength: input.newTailLength,
        newTailDigest: input.newTailDigest,
        newGlobalFrontier: input.newFrontierHash,
        firstEnrollmentAuthorizationId: null,
        payloadSchemaVersion: 1,
        nextFrontier: Object.freeze({
          workspaceIdentity: "production-test-workspace",
          workspaceEnrollmentId: "production-test-enrollment",
          scopes: Object.freeze([]),
          writerHeads: Object.freeze([]),
          globalFrontierHash: input.newFrontierHash,
        }),
      });
    },
  };
}

interface ProductionHarness {
  readonly rootDir: string;
  readonly buildCoordinator: (
    sessionId: string,
  ) => ReturnType<typeof createReviewGateCoordinator>;
  readonly eventStore: () => ReviewGateEventStore;
  readonly recoveryStore: () => ReturnType<typeof createReviewGateRecoveryStore>;
}

/**
 * Build a fresh production-shaped harness. Every `buildCoordinator` call
 * creates NEW store instances over the SAME workspace root, mirroring the
 * restart/reopen window where persisted custody (not process state) is the
 * only authority.
 */
function createProductionHarness(): ProductionHarness {
  const rootDir = mkdtempSync(join(tmpdir(), "justice-task18-production-"));
  afterAllCleanups.push(() => rmSync(rootDir, { recursive: true, force: true }));
  mkdirSync(join(rootDir, DESIGN_PATH.split("/")[0] ?? "docs"), { recursive: true });

  const buildCoordinator = () => {
    const eventStore = createLegacyReviewGateEventStore(rootDir);
    const recoveryStore = createReviewGateRecoveryStore(rootDir);
    const seam = createRecordingSeam();
    const files = new Map<string, string>([
      [DESIGN_PATH, "# Design\nAcceptance boundary.\n"],
      [PLAN_PATH, "## Task 1: Verify\n- [ ] Verify the boundary\n"],
    ]);
    const workspaceReader: ReviewGateWorkspaceReader = {
      readWorkspaceFile: async (path) => {
        const contents = files.get(path);
        return contents === undefined ? null : Buffer.from(contents, "utf8");
      },
    };
    const coordinator = createReviewGateCoordinator({
      eventStore,
      lockManager: createReviewGateLockManager(join(rootDir, "locks"), { provider: null }),
      protocol: createReviewGateProtocolDescriptor(),
      workspaceReader,
      workspaceRoot: rootDir,
      workspaceIdentity: "production-test-workspace",
      recoveryStore,
      mutationSubstrate: null,
      witnessPublicationSeam: seam,
      inspectTargets: async (paths) =>
        new Map(paths.map((path) => [path, "clean_committed" as const])),
      newId: ((initial = 0) => () => `task18-id-${(initial += 1)}`)(),
      newWriterId: () => "task18-writer",
    });
    return { coordinator, eventStore, recoveryStore, seam };
  };

  return {
    rootDir,
    buildCoordinator,
    eventStore: () => createLegacyReviewGateEventStore(rootDir),
    recoveryStore: () => createReviewGateRecoveryStore(rootDir),
  };
}

/** Read the durable V2 journal file directly from disk. */
function readV2JournalFile(rootDir: string, gateId: string): readonly unknown[] {
  return readFileSync(join(rootDir, ".justice", "review-gates", gateId, "events-v2.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

describe("Task 18 production coordinator end-to-end authority path", () => {
  it("durable happy path: prepared record, executed dispatch, V2 journal on disk, witness publication", async () => {
    const harness = createProductionHarness();
    const sessionId = "task18-production-session";
    const first = harness.buildCoordinator();
    const started = await first.coordinator.startOrResume(sessionId, {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
    });
    expect(started.gateId).not.toBeNull();
    const gateId = started.gateId as string;

    // Prepare a caller-owned dispatch operation.
    const prepared = await first.coordinator.prepareCallerOperation(sessionId, {
      kind: "dispatch_reviewer",
      phase: "design",
    } as ReviewGateNextOperation);

    // The record digest is content-addressed and validates on read.
    const stored = await first.recoveryStore.read(prepared.preparedRecoveryDigest);
    expect(stored).not.toBeNull();
    const storedRecord = JSON.parse((stored as Buffer).toString("utf8")) as Record<string, unknown>;
    expect(storedRecord.recordKind).toBe("review_gate_prepared_operation");
    expect(storedRecord.operationId).toBe(prepared.operationId);
    expect(storedRecord.gateId).toBe(gateId);

    // The prepared-record intent event is durable in the V2 journal with the
    // record digest as its input binding.
    const journalOnDisk = readV2JournalFile(harness.rootDir, gateId);
    expect(journalOnDisk.length).toBe(1);
    const intentVerified = validateReviewGateEventRecord(journalOnDisk[0]);
    if (!("schemaVersion" in intentVerified) || intentVerified.schemaVersion !== 2) {
      throw new Error("expected a V2 intent event on disk");
    }
    expect(intentVerified.eventType).toBe("EXTERNAL_OPERATION_DISPATCHED");
    expect(intentVerified.payload.inputBindingDigest).toBe(prepared.preparedRecoveryDigest);
    expect(intentVerified.parentEventId).toBe(gateId);

    // Execute the caller-owned routing decision.
    const decision: CallerRoutingDecisionV1 = {
      kind: "execute_operation",
      operationId: prepared.operationId,
      reason: null,
    };
    const outcome = await first.coordinator.executeNextOperation(sessionId, decision);
    expect(outcome.kind).toBe("executed");
    expect(outcome.operationId).toBe(prepared.operationId);

    // The executed dispatch appends one chained V2 event to the same journal.
    const journalAfterExecute = await first.eventStore.readV2Journal(gateId);
    expect(journalAfterExecute.eventCount).toBe(2);
    const dispatchVerified = journalAfterExecute.events.at(-1);
    expect(dispatchVerified?.eventType).toBe("EXTERNAL_OPERATION_DISPATCHED");
    if (dispatchVerified !== undefined) {
      expect(dispatchVerified.parentEventId).toBe(intentVerified.eventId);
    }
    // The bytes on disk match the durable store view, and the legacy journal
    // file never carries V2 custody.
    const diskLines = readV2JournalFile(harness.rootDir, gateId);
    expect(diskLines.length).toBe(2);
    const legacyFile = readFileSync(
      join(harness.rootDir, ".justice", "review-gates", gateId, "events.jsonl"),
      "utf8",
    );
    expect(legacyFile).not.toContain("schemaVersion");

    // Every V2 append was handed to the witness publication seam exactly once
    // (prepare-time intent + execute-time dispatch).
    expect(first.seam.calls()).toBe(2);
  });

  it("restart recovery: reopened sessions continue the V2 chain from the persisted tail", async () => {
    const harness = createProductionHarness();
    const sessionId = "task18-restart-session";
    const first = harness.buildCoordinator();
    const started = await first.coordinator.startOrResume(sessionId, {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
    });
    const gateId = started.gateId as string;

    const preparedBeforeRestart = await first.coordinator.prepareCallerOperation(sessionId, {
      kind: "dispatch_reviewer",
      phase: "design",
    } as ReviewGateNextOperation);
    await first.coordinator.executeNextOperation(sessionId, {
      kind: "execute_operation",
      operationId: preparedBeforeRestart.operationId,
      reason: null,
    });
    const journalBeforeRestart: ReviewGateV2Journal = await first.eventStore.readV2Journal(gateId);
    expect(journalBeforeRestart.eventCount).toBe(2);
    const tailBeforeRestart = journalBeforeRestart.tailEventId;
    expect(tailBeforeRestart).not.toBeNull();

    // Restart: release the live session first (graceful cooperative close,
    // releasing the gate/scope locks), then create a fresh coordinator plus
    // fresh stores over the same workspace root. Only durable custody — not
    // process state — decides.
    first.coordinator.releaseSession(sessionId);
    const restartedSessionId = "task18-restart-session-2";
    const second = harness.buildCoordinator();
    const resumed = await second.coordinator.startOrResume(restartedSessionId, {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
    });
    expect(resumed.gateId).toBe(gateId);
    expect(resumed.completedReuse).toBe(false);
    expect(resumed.guidance.startsWith("[JUSTICE: REVIEW GATE BLOCKED]")).toBe(false);

    // The prepared record from before the restart is still durable and
    // content-addressed; a freshly re-prepared operation executes against the
    // reopened gate and the V2 chain continues from the persisted tail.
    const stillThere = await second.recoveryStore.read(
      preparedBeforeRestart.preparedRecoveryDigest,
    );
    expect(stillThere).not.toBeNull();

    const rePrepared = await second.coordinator.prepareCallerOperation(restartedSessionId, {
      kind: "dispatch_reviewer",
      phase: "design",
    } as ReviewGateNextOperation);
    expect(rePrepared.operationId).not.toBe(preparedBeforeRestart.operationId);
    const outcome = await second.coordinator.executeNextOperation(restartedSessionId, {
      kind: "execute_operation",
      operationId: rePrepared.operationId,
      reason: null,
    });
    expect(outcome.kind).toBe("executed");

    const journalAfterRestart = await second.eventStore.readV2Journal(gateId);
    expect(journalAfterRestart.eventCount).toBe(4);
    expect(journalAfterRestart.tailEventId).not.toBe(tailBeforeRestart);
    // The restart-time intent event chains from the pre-restart tail.
    expect(journalAfterRestart.events[2]?.parentEventId).toBe(tailBeforeRestart);
    // No duplicated event ids across the restart window.
    const eventIds = new Set(journalAfterRestart.events.map((event) => event.eventId));
    expect(eventIds.size).toBe(journalAfterRestart.events.length);
    // And every persisted line re-decodes through the codec after restart.
    const diskEvents = readV2JournalFile(harness.rootDir, gateId);
    expect(diskEvents.length).toBe(4);
    for (const record of diskEvents) {
      expect(() => validateReviewGateEventRecord(record)).not.toThrow();
    }
  });
});
