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

const DESIGN_PATH = "docs/design.md";
const PLAN_PATH = "docs/plan.md";

let harnessCounter = 0;

interface Task17Harness {
  readonly coordinator: ReturnType<typeof createReviewGateCoordinator>;
  readonly eventStore: InMemoryReviewGateEventStore;
  readonly recoveryStore: ReviewGateRecoveryStore;
  readonly rootDir: string;
}

function createHarness(): Task17Harness & { readonly sessionId: string } {
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
    rootDir,
    sessionId: `${prefix}-session`,
  };
}

const afterAllCleanups: (() => void)[] = [];
afterAll(() => {
  for (const cleanup of afterAllCleanups) cleanup();
});

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
