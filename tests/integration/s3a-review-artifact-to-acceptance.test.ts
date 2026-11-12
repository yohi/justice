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

      // Observed behavior: staging/terminal/review_observed are still appended and the
      // task reaches gate_pending; the mismatch is caught at Gate admission
      // (`projectCompletedReviewCallHistory` -> staging_identity_mismatch), so no
      // formal decision is recorded. Only the protected acceptance is asserted here.
      expect(outcome.kind).toBe("blocked");
      const records = await fixture.durableRecords();
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
