import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  createReviewGateCoordinator,
  type CallerRoutingDecisionV1,
} from "../../src/runtime/review-gate-coordinator";
import {
  createReviewGateRecoveryStore,
  type ReviewGateRecoveryStore,
} from "../../src/runtime/review-gate-recovery-store";
import { createReviewGateLockManager } from "../../src/runtime/review-gate-lock-manager";
import { createReviewGateProtocolDescriptor } from "../../src/runtime/review-gate-protocol";
import type { ReviewGateNextOperation } from "../../src/core/review-gate/orchestrator";
import {
  createInMemoryReviewGateEventStore,
  createMapReviewWorkspaceReader,
  type InMemoryReviewGateEventStore,
} from "../helpers/review-gate-coordinator";

import type {
  PreparedV2JournalPublicationInputV1,
  PreparedWitnessPublicationV1,
  ReviewGateWitnessPublicationSeamV1,
} from "../../src/runtime/review-gate-witness-contracts";
import { validateReviewGateEventRecord } from "../../src/core/review-gate/event-schema";
import type { ArtifactDigest } from "../../src/core/review-gate-types";

/** Test-only branded digest construction. */
const asArtifactDigest = (value: string): ArtifactDigest => value as ArtifactDigest;

const DESIGN_PATH = "docs/design.md";
const PLAN_PATH = "docs/plan.md";

let harnessCounter = 0;

interface Task17Harness {
  readonly sessionId: string;
  readonly coordinator: ReturnType<typeof createReviewGateCoordinator>;
  readonly eventStore: InMemoryReviewGateEventStore;
  readonly recoveryStore: ReviewGateRecoveryStore;
  readonly rootDir: string;
  readonly witnessSeam: ReviewGateWitnessPublicationSeamV1;
}

function createHarness(
  witnessSeam: ReviewGateWitnessPublicationSeamV1 | null = null,
): Task17Harness & { readonly sessionId: string } {
  harnessCounter += 1;
  const prefix = `task17-${harnessCounter}`;
  const rootDir = mkdtempSync(join(tmpdir(), `justice-task17-${harnessCounter}-`));
  const eventStore = createInMemoryReviewGateEventStore();
  const recoveryStore = createReviewGateRecoveryStore(rootDir);
  let idSerial = 0;
  const coordinator = createReviewGateCoordinator({
    eventStore,
    lockManager: createReviewGateLockManager(join(rootDir, "locks"), {
      provider: null,
    }),
    protocol: createReviewGateProtocolDescriptor(),
    workspaceReader: createMapReviewWorkspaceReader(
      new Map([
        [DESIGN_PATH, "# Design\n"],
        [PLAN_PATH, "# Plan\n"],
      ]),
    ),
    recoveryStore,
    mutationSubstrate: null,
    inspectTargets: async (paths) =>
      new Map(paths.map((path) => [path, "clean_committed" as const])),
    witnessPublicationSeam: witnessSeam,
    now: () => {
      idSerial += 1;
      return new Date(Date.UTC(2026, 9, 16, 0, 0, idSerial)).toISOString();
    },
    newId: (() => {
      let n = 0;
      return () => {
        n += 1;
        return `${prefix}-id-${n}`;
      };
    })(),
    newWriterId: () => `${prefix}-writer`,
  });
  return {
    coordinator,
    eventStore,
    recoveryStore,
    witnessSeam: (witnessSeam ?? createRecordingWitnessSeam()) satisfies ReviewGateWitnessPublicationSeamV1,
    rootDir,
    sessionId: `${prefix}-session`,
  };
}

const afterAllCleanups: (() => void)[] = [];
afterAll(() => {
  for (const cleanup of afterAllCleanups) cleanup();
});

/* Test double for the Task 18 witness publication seam. */
interface RecordingWitnessSeam extends ReviewGateWitnessPublicationSeamV1 {
  readonly calls: () => readonly PreparedV2JournalPublicationInputV1[];
  readonly publications: () => readonly PreparedWitnessPublicationV1[];
  /** Make the next prepareAndPublish call throw with the given message. */
  failNextWith: (message: string) => void;
}

function createRecordingWitnessSeam(): RecordingWitnessSeam {
  const calls: PreparedV2JournalPublicationInputV1[] = [];
  const publications: PreparedWitnessPublicationV1[] = [];
  let failure: string | null = null;
  return {
    calls: () => [...calls],
    publications: () => [...publications],
    failNextWith: (message) => {
      failure = message;
    },
    prepareAndPublish: async (input) => {
      calls.push(input);
      if (failure !== null) throw new Error(failure);
      const publication: PreparedWitnessPublicationV1 = Object.freeze({
        installationId: "test-installation",
        workspaceIdentity: "test-workspace",
        scopeId: "test-scope",
        gateId: input.gateId,
        writerId: input.writerId,
        operationId: input.operationId,
        publicationId: `test-publication-${calls.length}`,
        expectedInstallationFrontier: "test-installation-frontier",
        expectedGlobalFrontier: input.baseFrontierHash,
        expectedWriterSequence: 0,
        expectedWriterHash: "test-expected-writer-hash",
        newWriterSequence: input.appendedEventCount,
        newWriterHash: input.newFrontierHash,
        canonicalShardPath: `${input.gateId}/events-v2.jsonl`,
        newTailLength: input.newTailLength,
        newTailDigest: input.newTailDigest,
        newGlobalFrontier: input.newFrontierHash,
        firstEnrollmentAuthorizationId: null,
        payloadSchemaVersion: 1,
        nextFrontier: Object.freeze({
          workspaceIdentity: "test-workspace",
          workspaceEnrollmentId: "test-enrollment",
          scopes: Object.freeze([]),
          writerHeads: Object.freeze([]),
          globalFrontierHash: input.newFrontierHash,
        }),
      });
      publications.push(publication);
      return publication;
    },
  };
}

async function startGateWithSession(harness: Task17Harness): Promise<string> {
  const result = await harness.coordinator.startOrResume(
    harness.sessionId,
    { source: "command", designPath: DESIGN_PATH, planPath: PLAN_PATH },
  );
  expect(result.gateId).not.toBeNull();
  return result.gateId as string;
}

describe("Task 17 coordinator caller-owned routing", () => {
  it("executes a caller decision against the durable prepared operation from the recovery store", async () => {
    const harness = createHarness();
    afterAllCleanups.push(() => {
      harness.recoveryStore.close();
      rmSync(harness.rootDir, { recursive: true, force: true });
    });
    const gateId = await startGateWithSession(harness);

    // The caller supplies the planned operation; the coordinator validates it,
    // mints the logical operation id and publishes a durable prepared record.
    const dispatchesBefore = await harness.eventStore.listDispatches(gateId);
    const inFlightOperationId = dispatchesBefore.at(-1)?.operationId;
    expect(inFlightOperationId).toBeDefined();
    const prepared = await harness.coordinator.prepareCallerOperation(
      harness.sessionId,
      {
        kind: "dispatch_reviewer",
        phase: "design",
        redispatchedOperationId: inFlightOperationId,
      } as ReviewGateNextOperation,
    );
    expect(Object.isFrozen(prepared)).toBe(true);
    expect(prepared.operationId.length).toBeGreaterThan(0);
    expect(await harness.recoveryStore.list()).toContain(prepared.preparedRecoveryDigest);

    const decision: CallerRoutingDecisionV1 = {
      kind: "execute_operation",
      operationId: prepared.operationId,
      reason: null,
    };
    const outcome = await harness.coordinator.executeNextOperation(
      harness.sessionId,
      decision,
    );
    expect(outcome.kind).toBe("executed");
    expect(outcome.operationId).toBe(prepared.operationId);

    const replay = await harness.coordinator.executeNextOperation(
      harness.sessionId,
      decision,
    );
    expect(replay.kind).toBe("blocked");
    expect(replay.guidance).toBe("review_gate_operation_already_executed");

    const dispatches = await harness.eventStore.listDispatches(gateId);
    expect(dispatches.length).toBe(dispatchesBefore.length);
    expect(outcome.guidance).not.toBeNull();
    const claim = await harness.coordinator.preToolUse({
      type: "PreToolUse",
      sessionId: harness.sessionId,
      payload: {
        toolName: "task",
        toolInput: { prompt: outcome.guidance as string },
      },
      callId: "task17-call",
    });
    expect(claim).not.toBeNull();
    expect(
      (claim as { action: string; injectedContext: string }).injectedContext.startsWith(
        "[JUSTICE: REVIEW GATE OPERATION CLAIMED]",
      ),
    ).toBe(true);
  });

  it("block records the caller reason as a durable execution stop event", async () => {
    const harness = createHarness();
    afterAllCleanups.push(() => {
      harness.recoveryStore.close();
      rmSync(harness.rootDir, { recursive: true, force: true });
    });
    const gateId = await startGateWithSession(harness);
    await harness.recoveryStore.close();
    // A block never needs the recovery store; publishing after close proves it.
    const eventsBefore = await harness.eventStore.readEvents(gateId);
    const decision: CallerRoutingDecisionV1 = {
      kind: "block",
      operationId: null,
      reason: "caller_blocked_pending_review",
    };
    const outcome = await harness.coordinator.executeNextOperation(
      harness.sessionId,
      decision,
    );
    expect(outcome.kind).toBe("blocked");
    const events = await harness.eventStore.readEvents(gateId);
    expect(events.length).toBe(eventsBefore.length + 1);
    const stop = events.at(-1);
    expect(stop?.eventType).toBe("EXECUTION_SUSPENDED");
    expect(
      (stop as { payload: { readonly reason: string } }).payload.reason,
    ).toBe("caller_blocked_pending_review");
  });

  it("does not append another stop event when the Gate is already suspended", async () => {
    const harness = createHarness();
    afterAllCleanups.push(() => {
      harness.recoveryStore.close();
      rmSync(harness.rootDir, { recursive: true, force: true });
    });
    const gateId = await startGateWithSession(harness);
    const decision: CallerRoutingDecisionV1 = {
      kind: "block",
      operationId: null,
      reason: "caller_blocked_pending_review",
    };
    await harness.coordinator.executeNextOperation(harness.sessionId, decision);
    const suspendedEvents = await harness.eventStore.readEvents(gateId);

    await harness.coordinator.executeNextOperation(harness.sessionId, decision);

    expect(await harness.eventStore.readEvents(gateId)).toEqual(suspendedEvents);
  });

  it("blocks a prepared operation that differs from the current planner result", async () => {
    const harness = createHarness();
    afterAllCleanups.push(() => {
      harness.recoveryStore.close();
      rmSync(harness.rootDir, { recursive: true, force: true });
    });
    await startGateWithSession(harness);
    const prepared = await harness.coordinator.prepareCallerOperation(
      harness.sessionId,
      { kind: "commit_resolutions", lineageIds: [] } as ReviewGateNextOperation,
    );

    const result = await harness.coordinator.executeNextOperation(
      harness.sessionId,
      { kind: "execute_operation", operationId: prepared.operationId, reason: null },
    );

    expect(result.kind).toBe("blocked");
    expect(result.guidance).toBe("review_gate_prepared_operation_mismatch");
  });

  it("await_evidence returns without mutating any durable state", async () => {
    const harness = createHarness();
    afterAllCleanups.push(() => {
      harness.recoveryStore.close();
      rmSync(harness.rootDir, { recursive: true, force: true });
    });
    const gateId = await startGateWithSession(harness);
    const eventsBefore = await harness.eventStore.readEvents(gateId);
    const dispatchesBefore = await harness.eventStore.listDispatches(gateId);
    const decision: CallerRoutingDecisionV1 = {
      kind: "await_evidence",
      operationId: null,
      reason: "evidence_pending",
    };
    const outcome = await harness.coordinator.executeNextOperation(
      harness.sessionId,
      decision,
    );
    expect(outcome).toEqual({
      kind: "awaited",
      operationId: null,
      guidance: "evidence_pending",
    });
    expect(await harness.eventStore.readEvents(gateId)).toEqual(eventsBefore);
    expect(await harness.eventStore.listDispatches(gateId)).toEqual(dispatchesBefore);
    expect((await harness.recoveryStore.list()).length).toBe(0);
  });

  it("fails closed when the caller operation id mismatches the prepared operation", async () => {
    const harness = createHarness();
    afterAllCleanups.push(() => {
      harness.recoveryStore.close();
      rmSync(harness.rootDir, { recursive: true, force: true });
    });
    const gateId = await startGateWithSession(harness);
    const prepared = await harness.coordinator.prepareCallerOperation(
      harness.sessionId,
      { kind: "commit_resolutions", lineageIds: [] } as ReviewGateNextOperation,
    );
    const eventsBefore = await harness.eventStore.readEvents(gateId);
    const dispatchesBefore = await harness.eventStore.listDispatches(gateId);
    const outcome = await harness.coordinator.executeNextOperation(
      harness.sessionId,
      {
        kind: "execute_operation",
        operationId: `${prepared.operationId}-forged`,
        reason: null,
      },
    );
    expect(outcome.kind).toBe("blocked");
    expect(outcome.guidance).toBe("review_gate_prepared_operation_mismatch");
    // Fail closed: no event, no dispatch, no prepared-record execution.
    expect(await harness.eventStore.readEvents(gateId)).toEqual(eventsBefore);
    expect(await harness.eventStore.listDispatches(gateId)).toEqual(dispatchesBefore);
  });

  it("fails closed on a missing prepared operation, null operation id and unknown session", async () => {
    const harness = createHarness();
    afterAllCleanups.push(() => {
      harness.recoveryStore.close();
      rmSync(harness.rootDir, { recursive: true, force: true });
    });
    const gateId = await startGateWithSession(harness);

    const unavailable = await harness.coordinator.executeNextOperation(
      harness.sessionId,
      { kind: "execute_operation", operationId: "never-prepared", reason: null },
    );
    expect(unavailable).toEqual({
      kind: "blocked",
      operationId: "never-prepared",
      guidance: "review_gate_prepared_operation_unavailable",
    });

    const noId = await harness.coordinator.executeNextOperation(
      harness.sessionId,
      { kind: "execute_operation", operationId: null, reason: null },
    );
    expect(noId).toEqual({
      kind: "blocked",
      operationId: null,
      guidance: "review_gate_operation_id_required",
    });

    const ghostSession = await harness.coordinator.executeNextOperation(
      "task17-ghost-session",
      { kind: "execute_operation", operationId: "any", reason: null },
    );
    expect(ghostSession).toEqual({
      kind: "blocked",
      operationId: "any",
      guidance: "review_gate_session_not_active",
    });

    // Terminal plan kinds are routing states, not preparable operations.
    await expect(
      harness.coordinator.prepareCallerOperation(harness.sessionId, {
        kind: "suspended",
        reason: "review_non_convergent",
      } as ReviewGateNextOperation),
    ).rejects.toThrow("review_gate_operation_not_preparable");

    expect(gateId).not.toBeNull();
  });
});

describe("Task 18 coordinator V2 journal custody and witness publication", () => {
  it("appends the prepared-record intent and the executed dispatch events with witness publication", async () => {
    const seam = createRecordingWitnessSeam();
    const harness = createHarness(seam);
    afterAllCleanups.push(() => {
      harness.recoveryStore.close();
      rmSync(harness.rootDir, { recursive: true, force: true });
    });
    const gateId = await startGateWithSession(harness);

    const prepared = await harness.coordinator.prepareCallerOperation(
      harness.sessionId,
      {
        kind: "dispatch_reviewer",
        phase: "design",
        redispatchedOperationId: (await harness.eventStore.listDispatches(gateId)).at(-1)?.operationId,
      },
    );

    // Prepared record publication: one bounded V2 intent event whose input
    // binding is the content-addressed record digest.
    let journal = await harness.eventStore.readV2Journal(gateId);
    expect(journal.eventCount).toBe(1);
    const intentEvent = journal.events[0];
    if (intentEvent === undefined || !("schemaVersion" in intentEvent)) {
      throw new Error("expected V2 intent event");
    }
    expect(intentEvent?.eventType).toBe("EXTERNAL_OPERATION_DISPATCHED");
    expect("schemaVersion" in intentEvent ? intentEvent.schemaVersion : null).toBe(2);
    expect(journal.tailEventId).toBe(intentEvent?.eventId ?? null);
    const intentPayload = intentEvent?.payload as {
      readonly inputBindingDigest: string;
      readonly role: string;
      readonly phase: string;
      readonly protectedLeaseProofDigest: string | null;
      readonly expectedWitnessFrontier: string;
    };
    expect(intentPayload.inputBindingDigest).toBe(prepared.preparedRecoveryDigest);
    expect(intentPayload.role).toBe("reviewer");
    expect(intentPayload.phase).toBe("design");
    expect(intentPayload.protectedLeaseProofDigest).toBeNull();
    // The first V2 event anchors to the gate id (the deterministic empty-journal anchor).
    expect(intentEvent?.parentEventId).toBe(gateId);

    const decision: CallerRoutingDecisionV1 = {
      kind: "execute_operation",
      operationId: prepared.operationId,
      reason: null,
    };
    const outcome = await harness.coordinator.executeNextOperation(harness.sessionId, decision);
    expect(outcome.kind).toBe("executed");

    // V2 event append after execute_operation: one chained dispatch event.
    journal = await harness.eventStore.readV2Journal(gateId);
    expect(journal.eventCount).toBe(2);
    const dispatchEvent = journal.events[1];
    if (dispatchEvent === undefined || !("schemaVersion" in dispatchEvent)) {
      throw new Error("expected V2 dispatch event");
    }
    expect(dispatchEvent?.eventType).toBe("EXTERNAL_OPERATION_DISPATCHED");
    expect(dispatchEvent?.parentEventId).toBe(intentEvent?.eventId);
    const dispatchPayload = dispatchEvent?.payload as { readonly role: string; readonly phase: string };
    expect(dispatchPayload.role).toBe("reviewer");
    expect(dispatchPayload.phase).toBe("design");

    // Every journal event re-decodes through the Task 4c codec.
    for (const event of journal.events) {
      expect(validateReviewGateEventRecord(JSON.parse(JSON.stringify(event)))).toEqual(event);
    }

    // Witness publication: exactly one prepared publication per V2 append.
    expect(seam.calls().length).toBe(2);
    const [prepareCall, executeCall] = seam.calls();
    expect(prepareCall?.gateId).toBe(gateId);
    expect(prepareCall?.operationId).toBe(prepared.operationId);
    expect(prepareCall?.appendedEventCount).toBe(1);
    expect(prepareCall?.newFrontierHash).not.toBe(prepareCall?.baseFrontierHash);
    const prepareBytes = Buffer.from(prepareCall?.canonicalEventBytes ?? new Uint8Array());
    expect(prepareBytes.toString("utf8").endsWith("\n")).toBe(true);
    const preparedLines = prepareBytes.toString("utf8").trimEnd().split("\n");
    expect(preparedLines.length).toBe(1);
    expect(journal.events[0]).toEqual(
      validateReviewGateEventRecord(JSON.parse(preparedLines[0] as string)),
    );
    expect(executeCall?.baseFrontierHash).toBe(prepareCall?.newFrontierHash);
    expect(executeCall?.appendedEventCount).toBe(1);
    expect(seam.publications().map((publication) => publication.newWriterHash)).toEqual(
      [prepareCall?.newFrontierHash, executeCall?.newFrontierHash],
    );
  });

  it.each(["new", "existing_resolved", "existing_regressed"] as const)(
    "rejects unobserved %s reconciliation without publishing resolution evidence",
    async (status) => {
      const seam = createRecordingWitnessSeam();
      const harness = createHarness(seam);
      afterAllCleanups.push(() => {
        harness.recoveryStore.close();
        rmSync(harness.rootDir, { recursive: true, force: true });
      });
      const gateId = await startGateWithSession(harness);

      const eventsBefore = await harness.eventStore.readEvents(gateId);
      const dispatchesBefore = await harness.eventStore.listDispatches(gateId);
      const journalBefore = await harness.eventStore.readV2Journal(gateId);
      // Caller-supplied findings are not observed validation evidence. The
      // current planner still requires redispatch of the in-flight reviewer.
      const newFindingPrepared = await harness.coordinator.prepareCallerOperation(
        harness.sessionId,
        {
          kind: "commit_finding_reconciliation",
          batch: {
            findings: [
              {
                candidateId: "candidate-1",
                existingLineageId: null,
                basisDigest: asArtifactDigest("a".repeat(64)),
                ownerScope: "design",
                observedPhase: "design",
                status,
                severity: "blocking",
                descriptionDigest: asArtifactDigest("a".repeat(64)),
              },
            ],
          },
        },
      );
      const outcome = await harness.coordinator.executeNextOperation(harness.sessionId, {
        kind: "execute_operation",
        operationId: newFindingPrepared.operationId,
        reason: null,
      });
      expect(outcome).toEqual({
        kind: "blocked",
        operationId: newFindingPrepared.operationId,
        guidance: "review_gate_prepared_operation_mismatch",
      });
      expect(await harness.eventStore.readEvents(gateId)).toEqual(eventsBefore);
      expect(await harness.eventStore.listDispatches(gateId)).toEqual(dispatchesBefore);
      expect(await harness.eventStore.readV2Journal(gateId)).toEqual(journalBefore);
      expect(seam.calls()).toHaveLength(0);
    },
  );

  it("fails closed with a typed reason when the witness publication seam rejects", async () => {
    const seam = createRecordingWitnessSeam();
    const harness = createHarness(seam);
    afterAllCleanups.push(() => {
      harness.recoveryStore.close();
      rmSync(harness.rootDir, { recursive: true, force: true });
    });
    const gateId = await startGateWithSession(harness);

    // The first seam call is the prepare-time intent publication.
    const prepared = await harness.coordinator.prepareCallerOperation(
      harness.sessionId,
      {
        kind: "dispatch_reviewer",
        phase: "design",
        redispatchedOperationId: (await harness.eventStore.listDispatches(gateId)).at(-1)?.operationId,
      },
    );
    expect((await harness.eventStore.readV2Journal(gateId)).eventCount).toBe(1);
    expect(seam.calls().length).toBe(1);

    // The second seam call is the execute-time dispatch publication: failure
    // there fails the decision closed while the legacy outcome stays durable.
    seam.failNextWith("witness_io_down");
    const outcome = await harness.coordinator.executeNextOperation(harness.sessionId, {
      kind: "execute_operation",
      operationId: prepared.operationId,
      reason: null,
    });
    expect(outcome.kind).toBe("blocked");
    expect(outcome.guidance).toContain("review_gate_witness_publication_failed");
    expect(outcome.guidance).toContain("witness_io_down");
  });

  it("rejects a V2 batch whose parent chain does not continue the journal tail", async () => {
    const harness = createHarness();
    afterAllCleanups.push(() => {
      harness.recoveryStore.close();
      rmSync(harness.rootDir, { recursive: true, force: true });
    });
    const gateId = await startGateWithSession(harness);

    const prepared = await harness.coordinator.prepareCallerOperation(
      harness.sessionId,
      {
        kind: "dispatch_reviewer",
        phase: "design",
        redispatchedOperationId: (await harness.eventStore.listDispatches(gateId)).at(-1)?.operationId,
      },
    );
    expect((await harness.eventStore.readV2Journal(gateId)).eventCount).toBe(1);

    // Craft a chained V2 event whose parent is NOT the durable tail.
    const staleTail = await harness.eventStore.readV2Journal(gateId);
    const forgedBatch = [
      validateReviewGateEventRecord(
        structuredClone({
          schemaVersion: 2,
          eventId: "forged-id",
          parentEventId: "not-the-tail",
          emittedAt: new Date(Date.UTC(2026, 9, 16, 1)).toISOString(),
          gateId,
          epochId: staleTail.events[0]?.epochId ?? "",
          generationId: gateId,
          writerId: "forged-writer",
          eventType: "EXTERNAL_OPERATION_DISPATCHED",
          payload: {
            eventType: "EXTERNAL_OPERATION_DISPATCHED",
            gateId,
            generationId: gateId,
            epochId: staleTail.events[0]?.epochId ?? "",
            operationId: "forged-op",
            dispatchAttemptId: "forged-attempt",
            phase: "design",
            role: "reviewer",
            candidateOrTargetSetDigest: "forged",
            inputBindingDigest: "forged",
            protocolFingerprint: "forged",
            expectedWitnessFrontier: "forged-frontier",
            protectedLeaseProofDigest: null,
          },
        }),
      ),
    ];
    await expect(harness.eventStore.appendV2Events(gateId, forgedBatch)).rejects.toThrow(
      "review_gate_v2_journal_chain_invalid",
    );

    // Duplicate event ids also fail closed.
    await expect(
      harness.eventStore.appendV2Events(gateId, [staleTail.events[0] as never]),
    ).rejects.toThrow("review_gate_v2_journal_event_id_conflict");

    // Legacy events are rejected by the V2 journal.
    const legacyJournal = await harness.eventStore.readEvents(gateId);
    const gateCreated = legacyJournal.find((event) => event.eventType === "GATE_CREATED");
    expect(gateCreated).toBeDefined();
    await expect(
      harness.eventStore.appendV2Events(gateId, [gateCreated as never]),
    ).rejects.toThrow("review_gate_event_v2_required");

    // The prepared operation remains executable against the intact chain.
    const outcome = await harness.coordinator.executeNextOperation(harness.sessionId, {
      kind: "execute_operation",
      operationId: prepared.operationId,
      reason: null,
    });
    expect(outcome.kind).toBe("executed");
  });
});
