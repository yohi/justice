import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  arrangeReviewArtifactCompletionFixture,
} from "../helpers/review-artifact-e2e-fixture";
import type { ReviewArtifactCompletionFixture } from "../helpers/review-artifact-e2e-fixture";
import { parseReviewWorkerResult } from "../../src/core/review-artifact";
import { project } from "../../src/core/v2/state-projection";
import type { PendingDecisionRecord } from "../../src/core/v2/decision-model";
import type { PersistedLogRecord } from "../../src/core/v2/observation-model";

/**
 * Task 3.6 — review artifact I/O and completion-domain coverage. The fixture
 * constructs the real completion domain and the real Task 3.2 within-boundary
 * Gate evaluator; the only doubles are the injected filesystem capability,
 * durable append ports, advisory spy, and the deterministic PASS rule result.
 * A reserved artifact is never read through the ordinary `FileReader.readFile`.
 */
describe("review artifact completion (Task 3.6)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a finding with any empty required text field", () => {
    const finding = { itemKey: "item-1", severity: "major", summary: "summary", location: "src/file.ts" };

    for (const field of ["itemKey", "summary", "location"] as const) {
      expect(
        parseReviewWorkerResult({
          schemaVersion: 1,
          complete: true,
          findings: [{ ...finding, [field]: "" }],
        }),
      ).toBeUndefined();
    }
  });

  it("reads exactly once from matching artifact, lease, and durable identities", async () => {
    const fixture = await arrangeReviewArtifactCompletionFixture("claimed");
    await fixture.writeReservedArtifact(fixture.reservation, fixture.validReviewWorkerJson);

    await expect(fixture.consume()).resolves.toMatchObject({ kind: "terminalized" });
    expect(fixture.readReservedArtifact).toHaveBeenCalledTimes(1);
    expect(fixture.genericArtifactRead).not.toHaveBeenCalled();
    expect(fixture.parseAndAssemble).toHaveBeenCalledTimes(1);
  });

  it("waits for the delegated child binding before consuming a review result", async () => {
    const fixture = await arrangeReviewArtifactCompletionFixture("claimed_without_child_binding");

    await expect(fixture.consume()).resolves.toMatchObject({ kind: "awaiting_child_binding" });

    const pending = (await fixture.durableRecords()).filter(
      (record) => record.recordType === "observation" &&
        record.kind === "review_post_tooluse_pending",
    );
    expect(pending).toHaveLength(1);
    expect(fixture.readReservedArtifact).not.toHaveBeenCalled();
  });

  it("does not read a reserved artifact when the read-attempt marker cannot be persisted", async () => {
    const fixture = await arrangeReviewArtifactCompletionFixture("claimed_with_failed_read_attempt");

    await expect(fixture.consume()).resolves.toMatchObject({ kind: "blocked" });

    expect(fixture.readReservedArtifact).not.toHaveBeenCalled();
    expect(fixture.parseAndAssemble).not.toHaveBeenCalled();
  });

  it("moves a clean live completion through exactly one Gate and Acceptance decision", async () => {
    const fixture = await arrangeReviewArtifactCompletionFixture("claimed");
    await fixture.writeReservedArtifact(fixture.reservation, fixture.validReviewWorkerJson);

    await expect(fixture.consume()).resolves.toMatchObject({ kind: "terminalized" });
    await expect(fixture.durableGateDecisions()).resolves.toHaveLength(1);
    await expect(fixture.durableAcceptanceDecisions()).resolves.toHaveLength(1);
  });

  it("stages artifact_read_failed before parsing when the artifact is replaced", async () => {
    const fixture = await arrangeReviewArtifactCompletionFixture("claimed");
    await fixture.replaceArtifactWithDifferentInode("replacement artifact");

    await expect(fixture.consume()).resolves.toMatchObject({ kind: "blocked" });
    await expect(fixture.durableFailureStaging()).resolves.toEqual(
      expect.objectContaining({ terminalReason: "artifact_read_failed" }),
    );
    expect(fixture.parseAndAssemble).not.toHaveBeenCalled();
    await expect(fixture.durableGateDecisions()).resolves.toEqual([]);
    await expect(fixture.durableAcceptanceDecisions()).resolves.toEqual([]);
  });

  it("terminalizes a reserved artifact reader exception as artifact_read_failed", async () => {
    const fixture = await arrangeReviewArtifactCompletionFixture("claimed");
    fixture.readReservedArtifact.mockRejectedValueOnce(new Error("reserved read failed"));

    await expect(fixture.consume()).resolves.toMatchObject({ kind: "blocked" });

    await expect(fixture.durableFailureStaging()).resolves.toMatchObject({
      terminalReason: "artifact_read_failed",
    });
    expect(fixture.recordAdvisory).toHaveBeenCalledWith(
      "review_artifact_read_unhandled",
      expect.any(Error),
    );
    expect(fixture.parseAndAssemble).not.toHaveBeenCalled();
  });

  it("retains a replacement path during terminal cleanup and records an advisory", async () => {
    const fixture = await arrangeReviewArtifactCompletionFixture("terminalized");
    await fixture.replaceArtifactWithDifferentInode("replacement artifact");

    await fixture.ensureCleanup();

    await expect(fixture.readReplacementArtifact()).resolves.toBe("replacement artifact");
    expect(fixture.unlinkArtifactPath).not.toHaveBeenCalled();
    expect(fixture.recordAdvisory).toHaveBeenCalledWith("review_artifact_identity_mismatch");
  });

  it("propagates cleanup_incomplete without using mock unlink counts as native security evidence", async () => {
    const fixture = await arrangeReviewArtifactCompletionFixture("terminalized");
    fixture.failNextLeaseDelete();

    await fixture.ensureCleanup();

    expect(fixture.recordAdvisory).toHaveBeenCalledWith("review_artifact_cleanup_incomplete");
    await expect(fixture.leaseExists()).resolves.toBe(true);
  });

  it("records a durable cleanup record with the exact provider status", async () => {
    const fixture = await arrangeReviewArtifactCompletionFixture("terminalized");

    await fixture.ensureCleanup();

    const cleanups = await fixture.durableCleanupRecords();
    const finished = cleanups.filter((record) => record.phase === "finished");
    expect(finished).toHaveLength(1);
    expect(finished[0]).toMatchObject({ status: "cleaned", artifactId: fixture.reservation.artifactId });
  });

  it("appends a review_observed record carrying the review correlation (N3 dedup key)", async () => {
    const fixture = await arrangeReviewArtifactCompletionFixture("claimed");
    await fixture.writeReservedArtifact(fixture.reservation, fixture.validReviewWorkerJson);

    await expect(fixture.consume()).resolves.toMatchObject({ kind: "terminalized" });
    const observed = (await fixture.durableRecords()).find(
      (record) => record.recordType === "observation" && record.kind === "review_observed",
    );
    expect(observed).toBeDefined();
    expect(observed).toMatchObject({
      correlation: fixture.correlation,
      reviewScope: "task:task-1",
    });
  });

  it("does not let failure staging terminalize an attempt whose completion staging is rejected", async () => {
    const fixture = await arrangeReviewArtifactCompletionFixture("claimed");
    const stagedRecord = {
      schemaVersion: 1 as const,
      timestamp: "2026-09-05T00:00:00.500Z",
      agentId: fixture.agentId,
      sessionId: fixture.parentSessionId,
      writerId: fixture.writerId,
      recordType: "observation" as const,
      kind: "review_completion_staged" as const,
      parentSessionId: fixture.parentSessionId,
      staging: {
        callId: fixture.callId,
        correlation: fixture.correlation,
        artifactConsumption: {
          artifactId: fixture.reservation.artifactId,
          digest: `sha256:${"0".repeat(64)}`,
        },
        reviewArtifact: {
          schemaVersion: 1 as const,
          reviewKind: fixture.correlation.reviewKind,
          reviewSource: fixture.expectedCategory,
          correlation: fixture.correlation,
          observedExecution: fixture.observedExecution,
          complete: true,
          findings: [],
        },
        observedExecution: fixture.observedExecution,
      },
    };
    await fixture.appendPendingRecord(stagedRecord);
    await fixture.appendPendingRecord({ ...stagedRecord, timestamp: "2026-09-05T00:00:00.600Z" });
    await fixture.appendPendingRecord({
      schemaVersion: 1,
      timestamp: "2026-09-05T00:00:00.700Z",
      agentId: fixture.agentId,
      sessionId: fixture.parentSessionId,
      writerId: fixture.writerId,
      recordType: "observation",
      kind: "review_artifact_read_started",
      parentSessionId: fixture.parentSessionId,
      callId: fixture.callId,
      correlation: fixture.correlation,
      artifactId: fixture.reservation.artifactId,
      artifactPath: fixture.reservation.artifactPath,
    });
    await fixture.appendPendingRecord({
      schemaVersion: 1,
      timestamp: "2026-09-05T00:00:00.800Z",
      agentId: fixture.agentId,
      sessionId: fixture.parentSessionId,
      writerId: fixture.writerId,
      recordType: "observation",
      kind: "review_artifact_failure_staged",
      parentSessionId: fixture.parentSessionId,
      callId: fixture.callId,
      correlation: fixture.correlation,
      terminalReason: "artifact_read_failed",
    });

    await fixture.completion.recoverStagedReviewCompletionsAfterRestart();

    const records = await fixture.durableRecords();
    expect(records.filter(
      (record) => record.recordType === "observation" &&
        record.kind === "review_dispatch_transition" && record.to === "terminal",
    )).toHaveLength(0);
    expect(records.filter(
      (record) => record.recordType === "observation" &&
        record.kind === "review_artifact_failure_staged",
    )).toHaveLength(1);
    expect(records.filter(
      (record) => record.recordType === "observation" &&
        record.kind === "review_artifact_cleanup",
    )).toHaveLength(0);
    expect(await fixture.artifactExists()).toBe(true);
  });
});

/**
 * S3-b Task 3 — the Review Completion caller decides `terminalized` only from a
 * fresh durable readback that proves formal completion (Design R0.1.2 §2.5 / §3.2).
 */
describe("review completion formal completion boundary (S3-b Task 3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const decisionEnvelope = (fixture: ReviewArtifactCompletionFixture) => ({
    schemaVersion: 1 as const,
    timestamp: "2026-09-05T00:00:00.500Z",
    agentId: fixture.agentId,
    sessionId: fixture.parentSessionId,
    writerId: fixture.writerId,
    recordType: "decision" as const,
  });

  /** Seeds an agreeing durable Gate PASS + final Acceptance for the fixture correlation. */
  async function seedAgreeingDecisions(
    fixture: ReviewArtifactCompletionFixture,
    include: { readonly gate: boolean } = { gate: true },
  ): Promise<void> {
    const correlation = fixture.correlation;
    const identity =
      correlation.reviewKind === "task-review"
        ? {
            taskId: correlation.taskExecutionRef.taskId,
            taskExecutionRef: correlation.taskExecutionRef,
            reviewRound: correlation.reviewRound,
          }
        : {
            authorizationId: correlation.authorizationId,
            planPath: correlation.planPath,
            finalizationAttemptId: correlation.finalizationAttemptId,
            finalReviewRound: correlation.finalReviewRound,
          };
    if (include.gate)
      await fixture.appendPendingDecision({
        ...decisionEnvelope(fixture),
        ...identity,
        gateType: correlation.reviewKind === "task-review" ? "task" : "plan",
        verdict: "PASS",
        reachableEnforcementLevel: "L1",
        appliedEnforcementLevel: "L0",
        ruleResults: [],
      } as unknown as PendingDecisionRecord);
    await fixture.appendPendingDecision({
      ...decisionEnvelope(fixture),
      ...identity,
      kind: correlation.reviewKind === "task-review" ? "task-acceptance" : "plan-acceptance",
      verdict: correlation.reviewKind === "task-review" ? "accepted" : "complete",
    } as unknown as PendingDecisionRecord);
  }

  const taskState = (records: readonly PersistedLogRecord[]): string | undefined =>
    project(records, "2026-09-05T01:00:00.000Z").lifecycle.taskStates.values().next().value;
  const planState = (records: readonly PersistedLogRecord[]): string | undefined =>
    project(records, "2026-09-05T01:00:00.000Z").lifecycle.finalization.values().next().value
      ?.state;
  const decisions = (records: readonly PersistedLogRecord[]): readonly PersistedLogRecord[] =>
    records.filter((record) => record.recordType === "decision");

  it("formal completion: a decided evaluator answer without a durable terminal Lifecycle is not terminalized", async () => {
    const fixture = await arrangeReviewArtifactCompletionFixture("claimed");
    await fixture.writeReservedArtifact(fixture.reservation, fixture.validReviewWorkerJson);
    await seedAgreeingDecisions(fixture);
    fixture.gateEvaluation.mockResolvedValueOnce({
      kind: "decided",
      decision: {} as never,
    });

    await expect(fixture.consume()).resolves.toEqual({ kind: "stale" });
    expect(taskState(await fixture.durableRecords())).toBe("gate_pending");
  });

  it("formal completion: not_applicable is never a success unless the durable Lifecycle proves it", async () => {
    const fixture = await arrangeReviewArtifactCompletionFixture("claimed");
    await fixture.writeReservedArtifact(fixture.reservation, fixture.validReviewWorkerJson);
    await seedAgreeingDecisions(fixture);
    fixture.gateEvaluation.mockResolvedValueOnce({ kind: "not_applicable" });

    await expect(fixture.consume()).resolves.toEqual({ kind: "stale" });
  });

  it("formal completion: a blocked evaluator answer is not promoted by existing Gate/Acceptance", async () => {
    const fixture = await arrangeReviewArtifactCompletionFixture("claimed");
    await fixture.writeReservedArtifact(fixture.reservation, fixture.validReviewWorkerJson);
    await seedAgreeingDecisions(fixture);
    fixture.gateEvaluation.mockResolvedValueOnce({ kind: "blocked", advisory: "test" });

    await expect(fixture.consume()).resolves.toEqual({ kind: "blocked" });
  });

  it("formal completion: a failed Lifecycle append after durable decisions stays blocked at gate_pending", async () => {
    const fixture = await arrangeReviewArtifactCompletionFixture("claimed");
    await fixture.writeReservedArtifact(fixture.reservation, fixture.validReviewWorkerJson);
    fixture.setLifecycleAppendFault(({ to }) => (to === "accepted" ? "fail" : undefined));

    await expect(fixture.consume()).resolves.toEqual({ kind: "blocked" });

    const records = await fixture.durableRecords();
    await expect(fixture.durableGateDecisions()).resolves.toHaveLength(1);
    await expect(fixture.durableAcceptanceDecisions()).resolves.toHaveLength(1);
    expect(taskState(records)).toBe("gate_pending");
  });

  it("formal completion: completed_with_findings terminalizes only as durable Review-Rework, never as acceptance", async () => {
    const fixture = await arrangeReviewArtifactCompletionFixture("claimed");
    await fixture.writeReservedArtifact(fixture.reservation, fixture.findingsReviewWorkerJson);

    await expect(fixture.consume()).resolves.toEqual({ kind: "terminalized" });

    const records = await fixture.durableRecords();
    expect(taskState(records)).toBe("rework_required");
    expect(
      records.filter(
        (record) =>
          "kind" in record &&
          record.kind === "task_lifecycle_transition" &&
          record.from === "review_pending" &&
          record.to === "rework_required",
      ),
    ).toHaveLength(1);
    expect(decisions(records)).toEqual([]);
    expect(fixture.gateEvaluation).not.toHaveBeenCalled();
    expect(fixture.releaseCompletedAuthorization).not.toHaveBeenCalled();
  });

  it("formal completion: completed_with_findings is not terminalized when the Rework transition is not durable", async () => {
    const fixture = await arrangeReviewArtifactCompletionFixture("claimed");
    await fixture.writeReservedArtifact(fixture.reservation, fixture.findingsReviewWorkerJson);
    fixture.setLifecycleAppendFault(({ to }) => (to === "rework_required" ? "lose" : undefined));

    await expect(fixture.consume()).resolves.toEqual({ kind: "stale" });
    expect(taskState(await fixture.durableRecords())).toBe("review_pending");
  });

  it("formal completion: a Plan findings review becomes final_rework_required without decisions or release", async () => {
    const fixture = await arrangeReviewArtifactCompletionFixture("claimed", { scope: "plan" });
    await fixture.writeReservedArtifact(fixture.reservation, fixture.findingsReviewWorkerJson);

    await expect(fixture.consume()).resolves.toEqual({ kind: "terminalized" });

    const records = await fixture.durableRecords();
    expect(planState(records)).toBe("final_rework_required");
    expect(decisions(records)).toEqual([]);
    expect(fixture.releaseCompletedAuthorization).not.toHaveBeenCalled();
  });

  it("formal completion: Plan complete releases the Authorization once the Lifecycle is durably complete", async () => {
    const fixture = await arrangeReviewArtifactCompletionFixture("claimed", { scope: "plan" });
    await fixture.writeReservedArtifact(fixture.reservation, fixture.validReviewWorkerJson);

    await expect(fixture.consume()).resolves.toEqual({ kind: "terminalized" });

    expect(planState(await fixture.durableRecords())).toBe("complete");
    expect(fixture.releaseCompletedAuthorization).toHaveBeenCalledTimes(1);
    expect(fixture.releaseCompletedAuthorization).toHaveBeenCalledWith(
      fixture.parentSessionId,
      fixture.authorizationId,
    );
  });

  it("formal completion: Plan release is withheld while the Finalization Lifecycle append fails", async () => {
    const fixture = await arrangeReviewArtifactCompletionFixture("claimed", { scope: "plan" });
    await fixture.writeReservedArtifact(fixture.reservation, fixture.validReviewWorkerJson);
    fixture.setLifecycleAppendFault(({ to }) => (to === "complete" ? "fail" : undefined));

    await expect(fixture.consume()).resolves.toEqual({ kind: "blocked" });

    expect(planState(await fixture.durableRecords())).toBe("final_gate_pending");
    expect(fixture.releaseCompletedAuthorization).not.toHaveBeenCalled();
  });

  it("formal completion: Plan release is withheld when a complete Acceptance and Lifecycle have no agreeing Gate", async () => {
    const fixture = await arrangeReviewArtifactCompletionFixture("claimed", { scope: "plan" });
    await fixture.writeReservedArtifact(fixture.reservation, fixture.validReviewWorkerJson);
    await seedAgreeingDecisions(fixture, { gate: false });
    const correlation = fixture.correlation;
    if (correlation.reviewKind !== "final-review") throw new Error("plan fixture expected");
    fixture.gateEvaluation.mockImplementationOnce(async () => {
      await fixture.appendPendingRecord({
        schemaVersion: 1,
        timestamp: "2026-09-05T00:00:00.900Z",
        agentId: fixture.agentId,
        sessionId: fixture.parentSessionId,
        writerId: fixture.writerId,
        recordType: "observation",
        kind: "plan_finalization_transition",
        parentSessionId: fixture.parentSessionId,
        authorizationId: correlation.authorizationId,
        planPath: correlation.planPath,
        finalizationAttemptId: correlation.finalizationAttemptId,
        finalReviewRound: correlation.finalReviewRound,
        from: "final_gate_pending",
        to: "complete",
      });
      return { kind: "blocked", advisory: "test" };
    });

    await expect(fixture.consume()).resolves.toEqual({ kind: "blocked" });

    expect(planState(await fixture.durableRecords())).toBe("complete");
    expect(fixture.releaseCompletedAuthorization).not.toHaveBeenCalled();
  });

  it("restart recovery rejects a second durable terminal for the same staged review", async () => {
    const fixture = await arrangeReviewArtifactCompletionFixture("claimed");
    await fixture.writeReservedArtifact(fixture.reservation, fixture.validReviewWorkerJson);
    await expect(fixture.consume()).resolves.toEqual({ kind: "terminalized" });

    const records = await fixture.durableRecords();
    const staging = records.find(
      (record) => record.recordType === "observation" && record.kind === "review_completion_staged",
    );
    const terminal = records.find(
      (record) => record.recordType === "observation" &&
        record.kind === "review_dispatch_transition" && record.to === "terminal",
    );
    if (staging === undefined || terminal === undefined) {
      throw new Error("test setup: expected durable staging and terminal records");
    }
    const { sequence: _sequence, ...duplicateTerminal } = terminal;
    expect(_sequence).toBeGreaterThan(0);
    await fixture.appendPendingRecord(duplicateTerminal);

    await expect(fixture.completion.recoverStagedReviewCompletion(staging)).resolves.toEqual({
      kind: "stale",
    });
    expect(fixture.recordAdvisory).toHaveBeenCalledWith(
      "review_staged_completion_identity_mismatch",
    );
  });

  it("restart recovery rejects a staged review contradicted by a later observation", async () => {
    const fixture = await arrangeReviewArtifactCompletionFixture("claimed");
    await fixture.writeReservedArtifact(fixture.reservation, fixture.validReviewWorkerJson);
    await expect(fixture.consume()).resolves.toEqual({ kind: "terminalized" });

    const records = await fixture.durableRecords();
    const staging = records.find(
      (record) => record.recordType === "observation" && record.kind === "review_completion_staged",
    );
    const observed = records.find(
      (record) => record.recordType === "observation" && record.kind === "review_observed",
    );
    if (staging === undefined || observed === undefined) {
      throw new Error("test setup: expected durable staging and review observation");
    }
    await fixture.appendPendingRecord({
      ...observed,
      items: [{
        itemKey: "contradictory-finding",
        evidenceId: "evidence-1",
        severity: "major",
        summary: "contradictory finding",
        location: "src/example.ts",
        status: "open",
      }],
    });

    await expect(fixture.completion.recoverStagedReviewCompletion(staging)).resolves.toEqual({
      kind: "stale",
    });
  });
});
