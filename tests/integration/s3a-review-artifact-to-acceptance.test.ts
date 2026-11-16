/**
 * S3-a F-004: Review Artifact -> Terminal -> Gate -> Acceptance integration.
 *
 * Drives the real `createReviewCompletionDomain`, the real Gate evaluator
 * (`createGatePendingAttemptEvaluator`), the real review dispatch state machine
 * (`createReviewDispatchState`, used for the Round 2 retry), the real
 * `AuthorizationStore`, and the real `ObservationLogStore` through the shared
 * durable review fixture. Test doubles are limited to the mock filesystem /
 * reserved-artifact IO, the advisory spy, the directive sink, and the
 * deterministic PASS rule evaluator.
 *
 * This is intentionally NOT `approved-review-resolution.test.ts`
 * (`justice_review.resolve`), which covers a different, approval-gated path.
 */
import { describe, expect, it } from "vitest";
import { arrangeReviewArtifactCompletionFixture } from "../helpers/review-artifact-e2e-fixture";
import type { ReviewArtifactCompletionFixture } from "../helpers/review-artifact-e2e-fixture";
import type { ReviewCorrelation, ObservedReviewExecutionV1 } from "../../src/core/types";
import type { PendingEnvelope, PersistedLogRecord } from "../../src/core/v2/observation-model";
import type { EvaluateRulesInput } from "../../src/core/acceptance-decision";
import type { HistoricalTaskGateDecisionPayload } from "../../src/core/v2/decision-model";
import { project } from "../../src/core/v2/state-projection";

type TaskReviewCorrelation = Extract<ReviewCorrelation, { readonly reviewKind: "task-review" }>;

function envelope(fixture: ReviewArtifactCompletionFixture): PendingEnvelope & {
  readonly recordType: "observation";
} {
  return {
    schemaVersion: 1,
    timestamp: "2026-09-05T00:00:00.000Z",
    agentId: fixture.agentId,
    sessionId: fixture.parentSessionId,
    writerId: fixture.writerId,
    recordType: "observation",
  };
}

function taskCorrelation(fixture: ReviewArtifactCompletionFixture): TaskReviewCorrelation {
  if (fixture.correlation.reviewKind !== "task-review") throw new Error("fixture is not a task review");
  return fixture.correlation;
}

const ofKind = <K extends string>(
  records: readonly PersistedLogRecord[],
  kind: K,
): Extract<PersistedLogRecord, { readonly kind: K }>[] =>
  records.filter(
    (record): record is Extract<PersistedLogRecord, { readonly kind: K }> =>
      "kind" in record && record.kind === kind,
  );

function lifecycleTo(
  records: readonly PersistedLogRecord[],
  to: string,
): Extract<PersistedLogRecord, { readonly kind: "task_lifecycle_transition" }>[] {
  return ofKind(records, "task_lifecycle_transition").filter((record) => record.to === to);
}

function completedTerminals(
  records: readonly PersistedLogRecord[],
): Extract<PersistedLogRecord, { readonly kind: "review_dispatch_transition" }>[] {
  return ofKind(records, "review_dispatch_transition").filter(
    (record) => record.to === "terminal" && "terminalReason" in record && record.terminalReason === "completed",
  );
}

function taskGateDecisions(records: readonly PersistedLogRecord[]): PersistedLogRecord[] {
  return records.filter(
    (record) => record.recordType === "decision" && "gateType" in record && record.gateType === "task",
  );
}

function taskAcceptanceDecisions(records: readonly PersistedLogRecord[]): PersistedLogRecord[] {
  return records.filter(
    (record) => record.recordType === "decision" && "kind" in record && record.kind === "task-acceptance",
  );
}

async function expectNoFormalAcceptance(fixture: ReviewArtifactCompletionFixture): Promise<void> {
  const records = await fixture.durableRecords();
  expect(taskAcceptanceDecisions(records)).toHaveLength(0);
  expect(lifecycleTo(records, "accepted")).toHaveLength(0);
}

function passGate(
  correlation: TaskReviewCorrelation,
): Omit<HistoricalTaskGateDecisionPayload, "reviewRound"> {
  return {
    recordType: "decision" as const,
    gateType: "task" as const,
    taskId: correlation.taskExecutionRef.taskId,
    taskExecutionRef: correlation.taskExecutionRef,
    verdict: "PASS" as const,
    reachableEnforcementLevel: "L1" as const,
    appliedEnforcementLevel: "L0" as const,
    ruleResults: [],
  };
}

describe("S3-a review artifact to acceptance (F-004)", () => {
  it("accepts a matching round-1 review artifact through terminal, observation, gate and acceptance", async () => {
    const fixture = await arrangeReviewArtifactCompletionFixture("claimed");
    const correlation = taskCorrelation(fixture);
    await fixture.writeReservedArtifact(fixture.reservation, fixture.validReviewWorkerJson);

    await expect(fixture.consume()).resolves.toEqual({ kind: "terminalized" });

    const records = await fixture.durableRecords();
    const staged = ofKind(records, "review_completion_staged");
    expect(staged).toHaveLength(1);
    expect(staged[0]?.staging).toMatchObject({ callId: fixture.callId, correlation });

    const terminals = completedTerminals(records);
    expect(terminals).toHaveLength(1);
    expect(terminals[0]).toMatchObject({
      from: "claimed",
      to: "terminal",
      terminalReason: "completed",
      callId: fixture.callId,
      correlation,
    });

    const observed = ofKind(records, "review_observed");
    expect(observed).toHaveLength(1);
    expect(observed[0]).toMatchObject({
      correlation,
      reviewScope: "task:task-1",
      isCompleteSnapshot: true,
      items: [],
    });

    const gates = taskGateDecisions(records);
    expect(gates).toHaveLength(1);
    expect(gates[0]).toMatchObject({
      taskExecutionRef: correlation.taskExecutionRef,
      reviewRound: 1,
      verdict: "PASS",
    });

    const acceptances = taskAcceptanceDecisions(records);
    expect(acceptances).toHaveLength(1);
    expect(acceptances[0]).toMatchObject({
      taskExecutionRef: correlation.taskExecutionRef,
      reviewRound: 1,
      verdict: "accepted",
    });

    const gatePending = lifecycleTo(records, "gate_pending");
    const accepted = lifecycleTo(records, "accepted");
    expect(gatePending).toHaveLength(1);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toMatchObject({ from: "gate_pending", taskExecutionRef: correlation.taskExecutionRef });

    // Causal order on the single durable shard:
    // staged -> terminal -> review_observed -> gate_pending -> Gate -> Acceptance -> accepted.
    const order = [
      staged[0],
      terminals[0],
      observed[0],
      gatePending[0],
      gates[0],
      acceptances[0],
      accepted[0],
    ].map((record) => record?.sequence ?? Number.NaN);
    expect(order.every((value) => Number.isFinite(value))).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);

    // Rules saw exactly the admitted round-1 correlation.
    expect(fixture.evaluateRules).toHaveBeenCalledTimes(1);
    const input = fixture.evaluateRules.mock.calls[0]?.[0] as EvaluateRulesInput;
    expect(input.context).toMatchObject({ scope: "task", reviewRound: 1 });
  });

  it("accepts completed retry round 2 but never old round 1 evidence", async () => {
    const fixture = await arrangeReviewArtifactCompletionFixture("claimed");
    const round1 = taskCorrelation(fixture);

    // Round 1 fails through the real dispatch state machine, which offers Round 2.
    await expect(
      fixture.reviewDispatch.terminalizeReviewFailure(
        {
          parentSessionId: fixture.parentSessionId,
          callId: fixture.callId,
          expectedCategory: "sp-review",
          agentId: fixture.agentId,
          sessionId: fixture.parentSessionId,
          writerId: fixture.writerId,
          correlation: round1,
        },
        "review_execution_failed",
      ),
    ).resolves.toEqual({
      kind: "retried",
      correlation: { ...round1, reviewRound: 2 },
    });

    // A stale Round 1 completion is no longer consumable (its slot is terminal).
    await fixture.writeReservedArtifact(fixture.reservation, fixture.validReviewWorkerJson);
    await expect(fixture.consume()).resolves.toEqual({ kind: "stale" });

    // Plant stale Round 1 review evidence (open finding) that must never leak into Round 2.
    await fixture.appendPendingRecord({
      ...envelope(fixture),
      kind: "review_observed",
      taskId: "task-1",
      reviewScope: "task:task-1",
      isCompleteSnapshot: true,
      correlation: round1,
      items: [
        {
          itemKey: "round-1-finding",
          evidenceId: "round-1-finding",
          severity: "critical",
          summary: "stale round 1 finding",
          location: "src/round-1.ts",
          status: "open",
        },
      ],
    });

    // Round 2 is claimed through the real dispatch state machine with a fresh reservation.
    const round2CallId = "review-artifact-call-round-2";
    const claim = await fixture.reviewDispatch.claimReviewDispatch({
      parentSessionId: fixture.parentSessionId,
      callId: round2CallId,
      expectedCategory: "sp-review",
      agentId: fixture.agentId,
      sessionId: fixture.parentSessionId,
      writerId: fixture.writerId,
    });
    if (claim.kind !== "claimed" || claim.taskCallBinding.artifactReservation.status !== "usable") {
      throw new Error(`round 2 claim failed: ${claim.kind}`);
    }
    const round2 = claim.taskCallBinding.correlation;
    expect(round2).toEqual({ ...round1, reviewRound: 2 });
    const round2Reservation = claim.taskCallBinding.artifactReservation;
    const round2Child = "child-review-artifact-round-2";
    await fixture.appendPendingRecord({
      ...envelope(fixture),
      kind: "delegated_execution_binding",
      relation: {
        kind: "delegated_execution_relation_observed",
        provenance: "observed",
        runtimeEventId: "review-artifact-execution-round-2",
        parentSessionId: fixture.parentSessionId,
        parentCallId: round2CallId,
        childSessionId: round2Child,
        category: "sp-review",
      },
      binding: {
        relationId: "review-artifact-execution-round-2",
        parentSessionId: fixture.parentSessionId,
        parentCallId: round2CallId,
        childSessionId: round2Child,
        scope: { kind: "task", taskExecutionRef: round1.taskExecutionRef, reviewRound: 2 },
        correlation: round2,
      },
    });
    await fixture.writeReservedArtifact(round2Reservation, fixture.validReviewWorkerJson);
    const observedExecution: ObservedReviewExecutionV1 = {
      schemaVersion: 1,
      provenance: "observed",
      reviewExecutionEventId: "review-artifact-execution-round-2",
      parentSessionId: fixture.parentSessionId,
      callId: round2CallId,
      childSessionId: round2Child,
      correlation: round2,
    };

    await expect(
      fixture.consumeWith({
        parentSessionId: fixture.parentSessionId,
        callId: round2CallId,
        postToolUse: { type: "PostToolUse", sessionId: fixture.parentSessionId, callId: round2CallId },
        observedExecution,
        agentId: fixture.agentId,
        writerId: fixture.writerId,
      }),
    ).resolves.toEqual({ kind: "terminalized" });

    const records = await fixture.durableRecords();
    // Round 1 remains a failed terminal; only Round 2 completed.
    const terminals = ofKind(records, "review_dispatch_transition").filter((record) => record.to === "terminal");
    expect(
      terminals.filter(
        (record) =>
          record.correlation.reviewKind === "task-review" &&
          record.correlation.reviewRound === 1 &&
          "terminalReason" in record &&
          record.terminalReason === "review_execution_failed",
      ),
    ).toHaveLength(1);
    const completed = completedTerminals(records);
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ callId: round2CallId, correlation: round2 });

    const gates = taskGateDecisions(records);
    const acceptances = taskAcceptanceDecisions(records);
    expect(gates).toHaveLength(1);
    expect(gates[0]).toMatchObject({ reviewRound: 2, verdict: "PASS" });
    expect(acceptances).toHaveLength(1);
    expect(acceptances[0]).toMatchObject({ reviewRound: 2, verdict: "accepted" });
    expect(lifecycleTo(records, "accepted")).toHaveLength(1);

    // Rules saw Round 2 only; the stale Round 1 finding was not admitted.
    expect(fixture.evaluateRules).toHaveBeenCalledTimes(1);
    const input = fixture.evaluateRules.mock.calls[0]?.[0] as EvaluateRulesInput;
    expect(input.context).toMatchObject({ scope: "task", reviewRound: 2 });
    expect(input.admittedReviewSummary.open).toEqual([]);
    expect(input.admittedReviewSummary.critical).toEqual([]);
  });

  describe("does not accept mismatched parent session, roundless decision, conflicting verdict or revoked authority", () => {
    it("rejects a completion delivered under a mismatched parent session", async () => {
      const fixture = await arrangeReviewArtifactCompletionFixture("claimed");
      await fixture.writeReservedArtifact(fixture.reservation, fixture.validReviewWorkerJson);
      const other = "parent-review-artifact-other";

      await expect(
        fixture.consumeWith({
          parentSessionId: other,
          callId: fixture.callId,
          postToolUse: { type: "PostToolUse", sessionId: other, callId: fixture.callId },
          observedExecution: { ...fixture.observedExecution, parentSessionId: other },
          agentId: fixture.agentId,
          writerId: fixture.writerId,
        }),
      ).resolves.toEqual({ kind: "stale" });
      await expect(
        fixture.consumeWith({
          parentSessionId: fixture.parentSessionId,
          callId: fixture.callId,
          postToolUse: { type: "PostToolUse", sessionId: other, callId: fixture.callId },
          observedExecution: fixture.observedExecution,
          agentId: fixture.agentId,
          writerId: fixture.writerId,
        }),
      ).resolves.toEqual({ kind: "stale" });

      const records = await fixture.durableRecords();
      expect(ofKind(records, "review_completion_staged")).toHaveLength(0);
      expect(completedTerminals(records)).toHaveLength(0);
      expect(taskGateDecisions(records)).toHaveLength(0);
      await expectNoFormalAcceptance(fixture);
    });

    it("rejects an observed execution that reports a different parent session", async () => {
      const fixture = await arrangeReviewArtifactCompletionFixture("claimed");
      await fixture.writeReservedArtifact(fixture.reservation, fixture.validReviewWorkerJson);

      const outcome = await fixture.consumeWith({
        parentSessionId: fixture.parentSessionId,
        callId: fixture.callId,
        postToolUse: { type: "PostToolUse", sessionId: fixture.parentSessionId, callId: fixture.callId },
        observedExecution: { ...fixture.observedExecution, parentSessionId: "parent-review-artifact-other" },
        agentId: fixture.agentId,
        writerId: fixture.writerId,
      });

      // Rejected early, before any durable write: same `stale` outcome as the other
      // session mismatches, with a pinned identity-mismatch advisory.
      expect(outcome).toEqual({ kind: "stale" });
      expect(fixture.recordAdvisory).toHaveBeenCalledWith(
        "review_observed_execution_identity_mismatch",
      );
      expect(fixture.readReservedArtifact).not.toHaveBeenCalled();
      const records = await fixture.durableRecords();
      expect(ofKind(records, "review_artifact_read_started")).toHaveLength(0);
      expect(ofKind(records, "review_artifact_failure_staged")).toHaveLength(0);
      expect(ofKind(records, "review_completion_staged")).toHaveLength(0);
      expect(
        ofKind(records, "review_dispatch_transition").filter((record) => record.to === "terminal"),
      ).toHaveLength(0);
      expect(ofKind(records, "review_observed")).toHaveLength(0);
      expect(lifecycleTo(records, "gate_pending")).toHaveLength(0);
      expect(taskGateDecisions(records)).toHaveLength(0);
      await expectNoFormalAcceptance(fixture);
    });

    it.each([
      {
        name: "call id",
        mutate: (observed: ObservedReviewExecutionV1): ObservedReviewExecutionV1 => ({
          ...observed,
          callId: "review-artifact-call-other",
        }),
      },
      {
        name: "correlation",
        mutate: (observed: ObservedReviewExecutionV1): ObservedReviewExecutionV1 => {
          const correlation: ReviewCorrelation =
            observed.correlation.reviewKind === "task-review"
              ? { ...observed.correlation, reviewRound: observed.correlation.reviewRound + 1 }
              : { ...observed.correlation, finalReviewRound: observed.correlation.finalReviewRound + 1 };
          return { ...observed, correlation };
        },
      },
      {
        name: "child session",
        mutate: (observed: ObservedReviewExecutionV1): ObservedReviewExecutionV1 => ({
          ...observed,
          childSessionId: "review-artifact-child-other",
        }),
      },
    ])("rejects an observed execution that reports a different $name", async ({ mutate }) => {
      const fixture = await arrangeReviewArtifactCompletionFixture("claimed");
      await fixture.writeReservedArtifact(fixture.reservation, fixture.validReviewWorkerJson);

      const outcome = await fixture.consumeWith({
        parentSessionId: fixture.parentSessionId,
        callId: fixture.callId,
        postToolUse: { type: "PostToolUse", sessionId: fixture.parentSessionId, callId: fixture.callId },
        observedExecution: mutate(fixture.observedExecution),
        agentId: fixture.agentId,
        writerId: fixture.writerId,
      });

      expect(outcome).toEqual({ kind: "stale" });
      expect(fixture.recordAdvisory).toHaveBeenCalledWith(
        "review_observed_execution_identity_mismatch",
      );
      expect(fixture.readReservedArtifact).not.toHaveBeenCalled();
      const records = await fixture.durableRecords();
      expect(ofKind(records, "review_artifact_read_started")).toHaveLength(0);
      expect(ofKind(records, "review_artifact_failure_staged")).toHaveLength(0);
      expect(ofKind(records, "review_completion_staged")).toHaveLength(0);
      expect(
        ofKind(records, "review_dispatch_transition").filter((record) => record.to === "terminal"),
      ).toHaveLength(0);
      expect(ofKind(records, "review_observed")).toHaveLength(0);
      expect(lifecycleTo(records, "gate_pending")).toHaveLength(0);
      expect(taskGateDecisions(records)).toHaveLength(0);
      await expectNoFormalAcceptance(fixture);
    });

    it.each([
      ["historic roundless Task Gate decision", "gate"],
      ["historic roundless Task Acceptance decision", "acceptance"],
    ] as const)("does not accept beside a %s", async (_label, shape) => {
      const fixture = await arrangeReviewArtifactCompletionFixture("claimed");
      const correlation = taskCorrelation(fixture);
      const base = {
        schemaVersion: 1 as const,
        timestamp: "2026-09-05T00:00:00.000Z",
        agentId: fixture.agentId,
        sessionId: fixture.parentSessionId,
        writerId: fixture.writerId,
      };
      await fixture.appendPendingDecision(
        shape === "gate"
          ? { ...base, ...passGate(correlation) }
          : {
              ...base,
              recordType: "decision",
              kind: "task-acceptance",
              taskId: correlation.taskExecutionRef.taskId,
              taskExecutionRef: correlation.taskExecutionRef,
              verdict: "accepted",
            },
      );
      await fixture.writeReservedArtifact(fixture.reservation, fixture.validReviewWorkerJson);

      await expect(fixture.consume()).resolves.toEqual({ kind: "blocked" });
      await expect(fixture.gateEvaluation.mock.results[0]?.value).resolves.toEqual({
        kind: "blocked",
        advisory: "decision_integrity_violation",
      });

      const records = await fixture.durableRecords();
      // Only the seeded roundless record exists; no round-1 decision is written beside it.
      expect(
        records.filter(
          (record) => record.recordType === "decision" && "reviewRound" in record && record.reviewRound !== undefined,
        ),
      ).toHaveLength(0);
      expect(lifecycleTo(records, "accepted")).toHaveLength(0);
      expect(lifecycleTo(records, "rework_required")).toHaveLength(0);
    });

    it.each([
      ["Gate PASS with a rework-required Acceptance", "mismatch"],
      ["accepted Acceptance without a Gate", "acceptance_only"],
    ] as const)("does not accept a conflicting verdict: %s", async (_label, shape) => {
      const fixture = await arrangeReviewArtifactCompletionFixture("claimed");
      const correlation = taskCorrelation(fixture);
      const base = {
        schemaVersion: 1 as const,
        timestamp: "2026-09-05T00:00:00.000Z",
        agentId: fixture.agentId,
        sessionId: fixture.parentSessionId,
        writerId: fixture.writerId,
      };
      if (shape === "mismatch") {
        await fixture.appendPendingDecision({ ...base, ...passGate(correlation), reviewRound: 1 });
      }
      await fixture.appendPendingDecision({
        ...base,
        recordType: "decision",
        kind: "task-acceptance",
        taskId: correlation.taskExecutionRef.taskId,
        taskExecutionRef: correlation.taskExecutionRef,
        reviewRound: 1,
        verdict: shape === "mismatch" ? "rework-required" : "accepted",
      });
      await fixture.writeReservedArtifact(fixture.reservation, fixture.validReviewWorkerJson);

      await expect(fixture.consume()).resolves.toEqual({ kind: "blocked" });

      const records = await fixture.durableRecords();
      expect(taskGateDecisions(records)).toHaveLength(shape === "mismatch" ? 1 : 0);
      expect(taskAcceptanceDecisions(records)).toHaveLength(1);
      expect(lifecycleTo(records, "accepted")).toHaveLength(0);
      expect(lifecycleTo(records, "rework_required")).toHaveLength(0);
      expect(fixture.evaluateRules).not.toHaveBeenCalled();
    });

    it("does not accept after the Authorization is revoked before completion", async () => {
      const fixture = await arrangeReviewArtifactCompletionFixture("claimed");
      await fixture.writeReservedArtifact(fixture.reservation, fixture.validReviewWorkerJson);
      await fixture.revokeAuthorization();

      await expect(fixture.consume()).resolves.toEqual({ kind: "blocked" });

      const records = await fixture.durableRecords();
      expect(ofKind(records, "review_completion_staged")).toHaveLength(0);
      expect(completedTerminals(records)).toHaveLength(0);
      expect(taskGateDecisions(records)).toHaveLength(0);
      expect(fixture.readReservedArtifact).not.toHaveBeenCalled();
      await expectNoFormalAcceptance(fixture);
    });

    it("does not accept when the Authorization is revoked while the Gate is evaluating", async () => {
      const fixture = await arrangeReviewArtifactCompletionFixture("claimed");
      const correlation = taskCorrelation(fixture);
      await fixture.writeReservedArtifact(fixture.reservation, fixture.validReviewWorkerJson);
      fixture.evaluateRules.mockImplementationOnce(async () => {
        await fixture.revokeAuthorization();
        return { ...passGate(correlation), reviewRound: 1 };
      });

      await expect(fixture.consume()).resolves.toEqual({ kind: "blocked" });

      const records = await fixture.durableRecords();
      // The review itself completed, but no formal decision is recorded after revocation.
      expect(completedTerminals(records)).toHaveLength(1);
      expect(fixture.evaluateRules).toHaveBeenCalledTimes(1);
      expect(taskGateDecisions(records)).toHaveLength(0);
      await expectNoFormalAcceptance(fixture);
    });
  });
});

/**
 * S3-b Task 4 — Staged Restart Recovery (Design R0.1.2 §5.1). The durable log is
 * left in a partial state by a fault on the live path; "restart" is the existing
 * `recoverStagedReviewCompletion` entry driven from the durable staging record.
 */
describe("S3-b staged restart recovery", () => {
  type Scope = "task" | "plan";
  type StagingRecord = Extract<PersistedLogRecord, { readonly kind: "review_completion_staged" }>;

  const lifecycleState = (records: readonly PersistedLogRecord[], scope: Scope): string | undefined => {
    const lifecycle = project(records, "2026-09-05T01:00:00.000Z").lifecycle;
    return scope === "task"
      ? lifecycle.taskStates.values().next().value
      : lifecycle.finalization.values().next().value?.state;
  };
  const transitions = (
    records: readonly PersistedLogRecord[],
    scope: Scope,
    from: string,
    to: string,
  ): readonly PersistedLogRecord[] =>
    records.filter(
      (record) =>
        "kind" in record &&
        record.kind === (scope === "task" ? "task_lifecycle_transition" : "plan_finalization_transition") &&
        record.from === from &&
        record.to === to,
    );
  const terminals = (records: readonly PersistedLogRecord[]): readonly PersistedLogRecord[] =>
    ofKind(records, "review_dispatch_transition").filter((record) => record.to === "terminal");
  const decisionRecords = (records: readonly PersistedLogRecord[]): readonly PersistedLogRecord[] =>
    records.filter((record) => record.recordType === "decision");
  const stagingOf = async (fixture: ReviewArtifactCompletionFixture): Promise<StagingRecord> => {
    const staged = ofKind(await fixture.durableRecords(), "review_completion_staged");
    if (staged.length !== 1 || staged[0] === undefined) throw new Error("expected one staging");
    return staged[0];
  };
  const claimedBindingGone = async (fixture: ReviewArtifactCompletionFixture): Promise<boolean> =>
    project(await fixture.durableRecords(), "2026-09-05T01:00:00.000Z").reviewDispatchSlots.every(
      (slot) => slot.state !== "claimed",
    );
  const restart = async (
    fixture: ReviewArtifactCompletionFixture,
  ): Promise<{ readonly kind: string }> => {
    fixture.setLifecycleAppendFault(() => undefined);
    return fixture.completion.recoverStagedReviewCompletion(await stagingOf(fixture));
  };

  it.each(["task", "plan"] as const)(
    "staged restart: %s completed with a matching terminal recovers only the Lifecycle from durable decisions",
    async (scope) => {
      const fixture = await arrangeReviewArtifactCompletionFixture("claimed", { scope });
      await fixture.writeReservedArtifact(fixture.reservation, fixture.validReviewWorkerJson);
      const terminalState = scope === "task" ? "accepted" : "complete";
      const pendingState = scope === "task" ? "gate_pending" : "final_gate_pending";
      fixture.setLifecycleAppendFault(({ to }) => (to === terminalState ? "fail" : undefined));
      await expect(fixture.consume()).resolves.toEqual({ kind: "blocked" });
      const before = await fixture.durableRecords();
      expect(lifecycleState(before, scope)).toBe(pendingState);
      expect(decisionRecords(before)).toHaveLength(2);
      // The claimed-only review call binding no longer exists after the terminal.
      await expect(claimedBindingGone(fixture)).resolves.toBe(true);
      expect(fixture.releaseCompletedAuthorization).not.toHaveBeenCalled();

      await expect(restart(fixture)).resolves.toEqual({ kind: "terminalized" });
      // A second restart converges to the same state without any new record.
      const once = await fixture.durableRecords();
      await expect(restart(fixture)).resolves.toEqual({ kind: "terminalized" });
      const after = await fixture.durableRecords();

      expect(lifecycleState(after, scope)).toBe(terminalState);
      expect(transitions(after, scope, pendingState, terminalState)).toHaveLength(1);
      expect(decisionRecords(after)).toHaveLength(2);
      expect(terminals(after)).toHaveLength(1);
      expect(fixture.evaluateRules).toHaveBeenCalledTimes(1);
      expect(after.filter((record) => !("kind" in record && record.kind === "review_artifact_cleanup")))
        .toHaveLength(once.filter((record) => !("kind" in record && record.kind === "review_artifact_cleanup")).length);
      expect(fixture.releaseCompletedAuthorization).toHaveBeenCalledTimes(scope === "plan" ? 2 : 0);
    },
  );

  it("staged restart: completed without a matching terminal appends the terminal once and requires the proven history", async () => {
    const fixture = await arrangeReviewArtifactCompletionFixture("claimed");
    await fixture.writeReservedArtifact(fixture.reservation, fixture.validReviewWorkerJson);
    fixture.failNextTerminalAppend();
    await expect(fixture.consume()).resolves.toEqual({ kind: "blocked" });
    expect(terminals(await fixture.durableRecords())).toHaveLength(0);

    await expect(restart(fixture)).resolves.toEqual({ kind: "terminalized" });
    await expect(restart(fixture)).resolves.toEqual({ kind: "terminalized" });

    const after = await fixture.durableRecords();
    expect(terminals(after)).toHaveLength(1);
    expect(completedTerminals(after)).toHaveLength(1);
    expect(lifecycleState(after, "task")).toBe("accepted");
    expect(lifecycleTo(after, "accepted")).toHaveLength(1);
    expect(taskGateDecisions(after)).toHaveLength(1);
    expect(taskAcceptanceDecisions(after)).toHaveLength(1);
  });

  it.each([
    ["task", "terminal"],
    ["task", "no terminal"],
    ["plan", "terminal"],
    ["plan", "no terminal"],
  ] as const)(
    "staged restart: %s completed_with_findings with %s converges to durable Review-Rework only",
    async (scope, terminalCase) => {
      const fixture = await arrangeReviewArtifactCompletionFixture("claimed", { scope });
      await fixture.writeReservedArtifact(fixture.reservation, fixture.findingsReviewWorkerJson);
      const pendingState = scope === "task" ? "review_pending" : "final_review_pending";
      const reworkState = scope === "task" ? "rework_required" : "final_rework_required";
      if (terminalCase === "terminal") {
        fixture.setLifecycleAppendFault(({ to }) => (to === reworkState ? "fail" : undefined));
      } else {
        fixture.failNextTerminalAppend();
      }
      await expect(fixture.consume()).resolves.toEqual({ kind: "blocked" });
      const before = await fixture.durableRecords();
      expect(terminals(before)).toHaveLength(terminalCase === "terminal" ? 1 : 0);
      expect(lifecycleState(before, scope)).toBe(pendingState);

      await expect(restart(fixture)).resolves.toEqual({ kind: "terminalized" });
      await expect(restart(fixture)).resolves.toEqual({ kind: "terminalized" });

      const after = await fixture.durableRecords();
      // Durable transition record and projection are asserted separately.
      expect(transitions(after, scope, pendingState, reworkState)).toHaveLength(1);
      expect(lifecycleState(after, scope)).toBe(reworkState);
      expect(terminals(after)).toHaveLength(1);
      expect(terminals(after)[0]).toMatchObject({ terminalReason: "completed_with_findings" });
      expect(decisionRecords(after)).toEqual([]);
      expect(fixture.gateEvaluation).not.toHaveBeenCalled();
      expect(fixture.releaseCompletedAuthorization).not.toHaveBeenCalled();
      expect(transitions(after, scope, scope === "task" ? "gate_pending" : "final_gate_pending", scope === "task" ? "accepted" : "complete")).toEqual([]);
    },
  );

  it("staged restart: a missing staging is never replaced by a terminal plus decisions", async () => {
    const fixture = await arrangeReviewArtifactCompletionFixture("claimed");
    await fixture.writeReservedArtifact(fixture.reservation, fixture.validReviewWorkerJson);
    fixture.setLifecycleAppendFault(({ to }) => (to === "accepted" ? "fail" : undefined));
    await expect(fixture.consume()).resolves.toEqual({ kind: "blocked" });
    fixture.setLifecycleAppendFault(() => undefined);
    const staging = await stagingOf(fixture);
    const before = await fixture.durableRecords();

    // A staging whose call does not exist in the durable log (no staged record for it).
    const forged: StagingRecord = {
      ...staging,
      staging: { ...staging.staging, callId: "another-call" },
    };
    await expect(fixture.completion.recoverStagedReviewCompletion(forged)).resolves.toEqual({
      kind: "stale",
    });
    expect(await fixture.durableRecords()).toHaveLength(before.length);
    expect(lifecycleState(await fixture.durableRecords(), "task")).toBe("gate_pending");
  });

  it.each([
    ["artifact id", (staging: StagingRecord): StagingRecord => ({ ...staging, staging: { ...staging.staging, artifactConsumption: { ...staging.staging.artifactConsumption, artifactId: "other-artifact" } } })],
    ["artifact digest", (staging: StagingRecord): StagingRecord => ({ ...staging, staging: { ...staging.staging, artifactConsumption: { ...staging.staging.artifactConsumption, digest: "sha256:other" } } })],
    ["child session", (staging: StagingRecord): StagingRecord => ({ ...staging, staging: { ...staging.staging, observedExecution: { ...staging.staging.observedExecution, childSessionId: "other-child" } } })],
    ["review round", (staging: StagingRecord): StagingRecord => ({ ...staging, staging: { ...staging.staging, correlation: { ...staging.staging.correlation, reviewRound: 2 } as ReviewCorrelation } })],
    ["terminal reason", (staging: StagingRecord): StagingRecord => ({ ...staging, staging: { ...staging.staging, reviewArtifact: { ...staging.staging.reviewArtifact, findings: [{ itemKey: "f", severity: "major", summary: "s", location: "l" }] } } })],
  ] as const)(
    "staged restart: a staging whose %s disagrees with the durable history writes nothing",
    async (_name, tamper) => {
      const fixture = await arrangeReviewArtifactCompletionFixture("claimed");
      await fixture.writeReservedArtifact(fixture.reservation, fixture.validReviewWorkerJson);
      fixture.setLifecycleAppendFault(({ to }) => (to === "accepted" ? "fail" : undefined));
      await expect(fixture.consume()).resolves.toEqual({ kind: "blocked" });
      fixture.setLifecycleAppendFault(() => undefined);
      const before = await fixture.durableRecords();

      const outcome = await fixture.completion.recoverStagedReviewCompletion(
        tamper(await stagingOf(fixture)),
      );

      expect(outcome.kind).not.toBe("terminalized");
      expect(await fixture.durableRecords()).toHaveLength(before.length);
      expect(lifecycleState(await fixture.durableRecords(), "task")).toBe("gate_pending");
    },
  );

  it("staged restart: duplicate stagings, a competing terminal or a duplicated delegated binding fail closed", async () => {
    for (const corrupt of ["staging", "terminal", "delegated"] as const) {
      const fixture = await arrangeReviewArtifactCompletionFixture("claimed");
      await fixture.writeReservedArtifact(fixture.reservation, fixture.validReviewWorkerJson);
      fixture.setLifecycleAppendFault(({ to }) => (to === "accepted" ? "fail" : undefined));
      await expect(fixture.consume()).resolves.toEqual({ kind: "blocked" });
      fixture.setLifecycleAppendFault(() => undefined);
      const staging = await stagingOf(fixture);
      const records = await fixture.durableRecords();
      const source =
        corrupt === "staging"
          ? staging
          : corrupt === "terminal"
            ? terminals(records)[0]
            : ofKind(records, "delegated_execution_binding")[0];
      if (source === undefined) throw new Error("fixture record missing");
      const duplicate = Object.fromEntries(
        Object.entries(source).filter(([key]) => key !== "sequence"),
      );
      await fixture.appendPendingRecord(
        (corrupt === "terminal"
          ? { ...duplicate, transitionId: "competing-terminal" }
          : duplicate) as never,
      );
      const before = await fixture.durableRecords();

      const outcome = await fixture.completion.recoverStagedReviewCompletion(staging);

      expect(outcome.kind, corrupt).not.toBe("terminalized");
      expect(await fixture.durableRecords(), corrupt).toHaveLength(before.length);
      expect(lifecycleState(await fixture.durableRecords(), "task"), corrupt).toBe("gate_pending");
    }
  });

  it("staged restart: a revoked Authorization blocks recovery without any Lifecycle write", async () => {
    const fixture = await arrangeReviewArtifactCompletionFixture("claimed");
    await fixture.writeReservedArtifact(fixture.reservation, fixture.validReviewWorkerJson);
    fixture.setLifecycleAppendFault(({ to }) => (to === "accepted" ? "fail" : undefined));
    await expect(fixture.consume()).resolves.toEqual({ kind: "blocked" });
    await fixture.revokeAuthorization();

    await expect(restart(fixture)).resolves.toEqual({ kind: "blocked" });

    const after = await fixture.durableRecords();
    expect(lifecycleState(after, "task")).toBe("gate_pending");
    expect(lifecycleTo(after, "accepted")).toHaveLength(0);
  });

  it("staged restart: review_incomplete stays non-accepted and creates no decision", async () => {
    const fixture = await arrangeReviewArtifactCompletionFixture("claimed");
    await fixture.writeReservedArtifact(
      fixture.reservation,
      JSON.stringify({ schemaVersion: 1, complete: false, findings: [] }),
    );
    await expect(fixture.consume()).resolves.toEqual({ kind: "blocked" });

    await expect(restart(fixture)).resolves.toEqual({ kind: "blocked" });

    const after = await fixture.durableRecords();
    expect(decisionRecords(after)).toEqual([]);
    expect(lifecycleState(after, "task")).toBe("review_pending");
  });

  it("staged restart: a staging of a superseded attempt is stale and appends nothing", async () => {
    const fixture = await arrangeReviewArtifactCompletionFixture("claimed");
    await fixture.writeReservedArtifact(fixture.reservation, fixture.findingsReviewWorkerJson);
    await expect(fixture.consume()).resolves.toEqual({ kind: "terminalized" });
    const correlation = taskCorrelation(fixture);
    // The task was reworked under a new attempt that is again awaiting review.
    const nextRef = { ...correlation.taskExecutionRef, attemptId: "attempt-next" };
    for (const [from, to] of [
      ["rework_required", "in_progress"],
      ["in_progress", "worker_reported"],
      ["worker_reported", "evidence_pending"],
      ["evidence_pending", "review_pending"],
    ] as const) {
      await fixture.appendPendingRecord({
        ...envelope(fixture),
        kind: "task_lifecycle_transition",
        parentSessionId: fixture.parentSessionId,
        taskExecutionRef: nextRef,
        from,
        to,
      });
    }
    const before = await fixture.durableRecords();
    expect(lifecycleState(before, "task")).toBe("review_pending");

    await expect(restart(fixture)).resolves.toEqual({ kind: "stale" });

    expect(await fixture.durableRecords()).toHaveLength(before.length);
  });

  it.each(["childSessionId", "reviewExecutionEventId"] as const)(
    "staged restart: a durable staging whose observed %s is not the persisted delegated binding is rejected",
    async (field) => {
      const fixture = await arrangeReviewArtifactCompletionFixture("claimed");
      const observedExecution = { ...fixture.observedExecution, [field]: "not-the-delegated-one" };
      const staging = await fixture.appendPendingRecord({
        ...envelope(fixture),
        kind: "review_completion_staged",
        parentSessionId: fixture.parentSessionId,
        staging: {
          callId: fixture.callId,
          correlation: fixture.correlation,
          artifactConsumption: {
            artifactId: fixture.reservation.artifactId,
            digest: `sha256:${"0".repeat(64)}`,
          },
          reviewArtifact: {
            schemaVersion: 1,
            reviewKind: "task-review",
            reviewSource: "sp-review",
            correlation: fixture.correlation,
            observedExecution,
            complete: true,
            findings: [],
          },
          observedExecution,
        },
      });
      const before = await fixture.durableRecords();
      // The staging is durable and valid; only the delegated identity disagrees.
      expect(ofKind(before, "review_completion_staged")).toHaveLength(1);

      await expect(
        fixture.completion.recoverStagedReviewCompletion(staging as StagingRecord),
      ).resolves.toEqual({ kind: "stale" });

      expect(await fixture.durableRecords()).toHaveLength(before.length);
      expect(terminals(await fixture.durableRecords())).toHaveLength(0);
    },
  );

  it("staged restart: a not_applicable Gate without durable decisions is stale, never terminalized", async () => {
    const fixture = await arrangeReviewArtifactCompletionFixture("claimed");
    await fixture.writeReservedArtifact(fixture.reservation, fixture.validReviewWorkerJson);
    fixture.evaluateRules.mockResolvedValue({ verdict: "SKIP", reason: "no gate" });
    await expect(fixture.consume()).resolves.toEqual({ kind: "stale" });

    await expect(restart(fixture)).resolves.toEqual({ kind: "stale" });

    const after = await fixture.durableRecords();
    expect(decisionRecords(after)).toEqual([]);
    expect(lifecycleState(after, "task")).toBe("gate_pending");
    expect(lifecycleTo(after, "accepted")).toHaveLength(0);
  });

  it("staged restart: the restart entry replays every durable staging through the same recovery", async () => {
    const fixture = await arrangeReviewArtifactCompletionFixture("claimed");
    await fixture.writeReservedArtifact(fixture.reservation, fixture.validReviewWorkerJson);
    fixture.setLifecycleAppendFault(({ to }) => (to === "accepted" ? "fail" : undefined));
    await expect(fixture.consume()).resolves.toEqual({ kind: "blocked" });
    fixture.setLifecycleAppendFault(() => undefined);

    await fixture.completion.recoverStagedReviewCompletionsAfterRestart();
    await fixture.completion.recoverStagedReviewCompletionsAfterRestart();

    const after = await fixture.durableRecords();
    expect(lifecycleState(after, "task")).toBe("accepted");
    expect(lifecycleTo(after, "accepted")).toHaveLength(1);
    expect(taskGateDecisions(after)).toHaveLength(1);
    expect(taskAcceptanceDecisions(after)).toHaveLength(1);
  });
});

/**
 * S3-b Task 6 — integration acceptance across the evaluator, the completion domain
 * and the staged restart entry (single process). Written after Tasks 1–5, so these
 * are acceptance/regression checks, not RED-first tests.
 */
describe("S3-b integration acceptance", () => {
  type Scope = "task" | "plan";
  const stateOf = (records: readonly PersistedLogRecord[], scope: Scope): string | undefined => {
    const lifecycle = project(records, "2026-09-05T01:00:00.000Z").lifecycle;
    return scope === "task"
      ? lifecycle.taskStates.values().next().value
      : lifecycle.finalization.values().next().value?.state;
  };
  const lifecycleRecordsTo = (records: readonly PersistedLogRecord[], to: string): number =>
    records.filter(
      (record) =>
        "kind" in record &&
        (record.kind === "task_lifecycle_transition" ||
          record.kind === "plan_finalization_transition") &&
        record.to === to,
    ).length;
  const decisionCount = (records: readonly PersistedLogRecord[]): number =>
    records.filter((record) => record.recordType === "decision").length;
  const restart = async (
    fixture: ReviewArtifactCompletionFixture,
  ): Promise<{ readonly kind: string }> => {
    fixture.setLifecycleAppendFault(() => undefined);
    const staged = ofKind(await fixture.durableRecords(), "review_completion_staged");
    if (staged[0] === undefined) throw new Error("expected a staging");
    return fixture.completion.recoverStagedReviewCompletion(staged[0]);
  };
  const failingGate = (verdict: "WARN" | "FAIL") =>
    async ({ context }: EvaluateRulesInput): Promise<unknown> => ({
      recordType: "decision",
      verdict,
      reachableEnforcementLevel: "L1",
      appliedEnforcementLevel: "L0",
      ruleResults: [],
      ...(context.scope === "task"
        ? {
            gateType: "task",
            taskId: context.taskExecutionRef.taskId,
            taskExecutionRef: context.taskExecutionRef,
            reviewRound: context.reviewRound,
          }
        : {
            gateType: "plan",
            authorizationId: context.authorizationId,
            planPath: context.planPath,
            finalizationAttemptId: context.finalizationAttemptId,
            finalReviewRound: context.finalReviewRound,
          }),
    });

  it.each([
    ["task", "WARN"],
    ["task", "FAIL"],
    ["plan", "WARN"],
    ["plan", "FAIL"],
  ] as const)(
    "S3-b: %s Gate %s with durable decisions and a failed Lifecycle append converges to rework after restart, never to acceptance",
    async (scope, verdict) => {
      const fixture = await arrangeReviewArtifactCompletionFixture("claimed", { scope });
      await fixture.writeReservedArtifact(fixture.reservation, fixture.validReviewWorkerJson);
      fixture.evaluateRules.mockImplementation(failingGate(verdict));
      const rework = scope === "task" ? "rework_required" : "final_rework_required";
      const accepted = scope === "task" ? "accepted" : "complete";
      fixture.setLifecycleAppendFault(({ to }) => (to === rework ? "fail" : undefined));

      await expect(fixture.consume()).resolves.toEqual({ kind: "blocked" });
      const before = await fixture.durableRecords();
      expect(decisionCount(before)).toBe(2);
      expect(lifecycleRecordsTo(before, rework)).toBe(0);

      await expect(restart(fixture)).resolves.toEqual({ kind: "terminalized" });
      await expect(restart(fixture)).resolves.toEqual({ kind: "terminalized" });

      const after = await fixture.durableRecords();
      expect(stateOf(after, scope)).toBe(rework);
      expect(lifecycleRecordsTo(after, rework)).toBe(1);
      expect(lifecycleRecordsTo(after, accepted)).toBe(0);
      expect(decisionCount(after)).toBe(2);
      expect(fixture.evaluateRules).toHaveBeenCalledTimes(1);
      expect(fixture.releaseCompletedAuthorization).not.toHaveBeenCalled();
    },
  );

  it("S3-b: a Lifecycle append that is acknowledged but not durable is never completed, and one retry repairs it", async () => {
    const fixture = await arrangeReviewArtifactCompletionFixture("claimed");
    await fixture.writeReservedArtifact(fixture.reservation, fixture.validReviewWorkerJson);
    fixture.setLifecycleAppendFault(({ to }) => (to === "accepted" ? "lose" : undefined));

    await expect(fixture.consume()).resolves.toEqual({ kind: "blocked" });
    expect(fixture.gateEvaluation).toHaveBeenCalledTimes(1);
    await expect(fixture.gateEvaluation.mock.results[0]?.value).resolves.toEqual({
      kind: "blocked",
      advisory: "lifecycle_readback_not_verified",
    });
    expect(stateOf(await fixture.durableRecords(), "task")).toBe("gate_pending");

    await expect(restart(fixture)).resolves.toEqual({ kind: "terminalized" });

    const after = await fixture.durableRecords();
    expect(stateOf(after, "task")).toBe("accepted");
    expect(lifecycleRecordsTo(after, "accepted")).toBe(1);
    expect(decisionCount(after)).toBe(2);
  });

  it("S3-b: concurrent recoveries of the same correlation converge with one transition and no duplicate decision", async () => {
    const fixture = await arrangeReviewArtifactCompletionFixture("claimed");
    await fixture.writeReservedArtifact(fixture.reservation, fixture.validReviewWorkerJson);
    fixture.setLifecycleAppendFault(({ to }) => (to === "accepted" ? "fail" : undefined));
    await expect(fixture.consume()).resolves.toEqual({ kind: "blocked" });
    fixture.setLifecycleAppendFault(() => undefined);
    const staged = ofKind(await fixture.durableRecords(), "review_completion_staged")[0];
    if (staged === undefined) throw new Error("expected a staging");

    const outcomes = await Promise.all([
      fixture.completion.recoverStagedReviewCompletion(staged),
      fixture.completion.recoverStagedReviewCompletion(staged),
      fixture.completion.recoverStagedReviewCompletion(staged),
    ]);

    expect(outcomes).toEqual([
      { kind: "terminalized" },
      { kind: "terminalized" },
      { kind: "terminalized" },
    ]);
    const after = await fixture.durableRecords();
    expect(lifecycleRecordsTo(after, "accepted")).toBe(1);
    expect(decisionCount(after)).toBe(2);
    expect(completedTerminals(after)).toHaveLength(1);
  });

  it("S3-b: the normal clean completion still decides exactly once with no recovery needed", async () => {
    const fixture = await arrangeReviewArtifactCompletionFixture("claimed");
    await fixture.writeReservedArtifact(fixture.reservation, fixture.validReviewWorkerJson);

    await expect(fixture.consume()).resolves.toEqual({ kind: "terminalized" });
    await expect(restart(fixture)).resolves.toEqual({ kind: "terminalized" });

    const after = await fixture.durableRecords();
    expect(stateOf(after, "task")).toBe("accepted");
    expect(lifecycleRecordsTo(after, "accepted")).toBe(1);
    expect(decisionCount(after)).toBe(2);
    expect(fixture.evaluateRules).toHaveBeenCalledTimes(1);
  });
});
