import { describe, expect, it } from "vitest";
import {
  applyPlanTransition,
  applyTaskTransition,
  advanceFinalizationAfterAllTasksAccepted,
  appendTaskLifecycleTransition,
  recordWorkerReportedAndEvidence,
  requestCurrentTaskReview,
  startNextFinalizationAttempt,
  type TaskLifecycleTransition,
} from "../../src/core/task-lifecycle";
import type { PendingObservationRecord } from "../../src/core/v2/observation-model";

describe("task lifecycle transitions", () => {
  it("keeps state for duplicate and illegal transitions", () => {
    const acceptedToPendingEvent: TaskLifecycleTransition = {
      identity: "attempt-1",
      from: "accepted",
      to: "pending",
    };
    const duplicateStartEvent: TaskLifecycleTransition = {
      identity: "attempt-1",
      from: "in_progress",
      to: "in_progress",
    };

    expect(applyTaskTransition("accepted", acceptedToPendingEvent)).toEqual({
      kind: "invalid",
      state: "accepted",
      advisory: "accepted -> pending is not allowed",
    });
    expect(applyTaskTransition("in_progress", duplicateStartEvent)).toEqual({
      kind: "duplicate",
      state: "in_progress",
    });
  });

  it("rejects a transition whose declared source differs from the projected state", () => {
    expect(
      applyTaskTransition("in_progress", {
        identity: "attempt-1",
        from: "pending",
        to: "gate_pending",
      }),
    ).toEqual({
      kind: "invalid",
      state: "in_progress",
      advisory: "pending -> gate_pending does not start at in_progress",
    });
  });

  it("uses identity to distinguish duplicate replay from stale attempts", () => {
    const event = { identity: "attempt-1", from: "in_progress" as const, to: "worker_reported" as const };

    expect(applyTaskTransition("worker_reported", event)).toEqual({
      kind: "duplicate",
      state: "worker_reported",
    });
    expect(applyTaskTransition({ value: "in_progress", lastTransitionIdentity: "attempt-1" }, { ...event, identity: "attempt-0" })).toMatchObject({
      kind: "invalid",
      state: "in_progress",
    });
    expect(applyPlanTransition({ value: "final_review_pending", lastTransitionIdentity: "final-1" }, {
      identity: "final-0",
      from: "final_review_pending",
      to: "final_gate_pending",
    })).toMatchObject({ kind: "invalid", state: "final_review_pending" });
  });

  it("accepts a fresh attempt when rework starts", () => {
    expect(
      applyTaskTransition(
        { value: "rework_required", lastTransitionIdentity: "attempt-1" },
        { identity: "attempt-2", from: "rework_required", to: "in_progress" },
      ),
    ).toEqual({ kind: "applied", state: "in_progress" });
  });

  it("records worker output and derived evidence only for the current attempt", async () => {
    const records: string[] = [];
    await recordWorkerReportedAndEvidence(
      {
        parentSessionId: "parent-1",
        taskExecutionRef: { authorizationId: "auth-1", taskId: "task-1", attemptId: "attempt-1" },
        appendRecord: async (record) => {
          if (record.kind === "task_lifecycle_transition") {
            records.push(`${record.from}->${record.to}`);
          }
          return 1;
        },
      },
    );
    expect(records).toEqual(["in_progress->worker_reported", "worker_reported->evidence_pending"]);
  });

  it("appends a task lifecycle record through the supplied durable callback", async () => {
    const records: PendingObservationRecord[] = [];
    const result = await appendTaskLifecycleTransition(
      {
        parentSessionId: "parent-1",
        taskExecutionRef: { authorizationId: "auth-1", taskId: "task-1", attemptId: "attempt-1" },
        from: "review_pending",
        to: "gate_pending",
      },
      async (record) => {
        records.push(record);
        return 1;
      },
    );

    expect(result).toEqual({ kind: "committed" });
    expect(records[0]).toMatchObject({
      kind: "task_lifecycle_transition",
      parentSessionId: "parent-1",
      from: "review_pending",
      to: "gate_pending",
    });
  });

  it("records finalization identity only after both initial transitions commit", async () => {
    const records: PendingObservationRecord[] = [];
    const result = await advanceFinalizationAfterAllTasksAccepted(
      {
        parentSessionId: "parent-1",
        authorizationId: "auth-1",
        planPath: "plan.md",
      },
      async (record) => {
        records.push(record);
        return records.length;
      },
      {},
    );

    expect(result.kind).toBe("committed");
    if (result.kind === "committed") expect(result.finalReviewRound).toBe(1);
    expect(records.filter((record) => record.kind === "plan_finalization_transition").map((record) => [record.kind, record.from, record.to])).toEqual([
      ["plan_finalization_transition", "tasks_pending", "all_tasks_accepted"],
      ["plan_finalization_transition", "all_tasks_accepted", "final_review_pending"],
    ]);
  });

  it("reuses a durable finalization identity when only the second append remains", async () => {
    const records: PendingObservationRecord[] = [];
    const result = await advanceFinalizationAfterAllTasksAccepted(
      {
        parentSessionId: "parent-1",
        authorizationId: "auth-1",
        planPath: "plan.md",
        finalizationAttemptId: "final-1",
      },
      async (record) => {
        records.push(record);
        return records.length;
      },
      {},
    );

    expect(result).toEqual({
      kind: "committed",
      finalizationAttemptId: "final-1",
      finalReviewRound: 1,
    });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      from: "all_tasks_accepted",
      to: "final_review_pending",
      finalizationAttemptId: "final-1",
    });
  });

  it("notifies only after a committed review-pending transition", async () => {
    let offers = 0;
    const offer = async (_parentSessionId: string): Promise<void> => {
      offers += 1;
    };
    let calls = 0;
    const result = await requestCurrentTaskReview({
      parentSessionId: "parent-1",
      taskExecutionRef: { authorizationId: "auth-1", taskId: "task-1", attemptId: "attempt-1" },
      appendRecord: async () => {
        calls += 1;
        return 1;
      },
      dependencies: { onReviewPendingCommitted: offer },
    });

    expect(result).toEqual({ kind: "committed" });
    expect(calls).toBe(1);
    expect(offers).toBe(1);
  });

  it("preserves a committed transition when review notification fails", async () => {
    const advisories: string[] = [];
    const result = await requestCurrentTaskReview({
      parentSessionId: "parent-1",
      taskExecutionRef: { authorizationId: "auth-1", taskId: "task-1", attemptId: "attempt-1" },
      appendRecord: async () => 1,
      dependencies: {
        onReviewPendingCommitted: async () => {
          throw new Error("offer failed");
        },
        recordAdvisory: async (advisory) => {
          advisories.push(advisory);
        },
      },
    });

    expect(result).toEqual({ kind: "committed" });
    expect(advisories).toEqual(["review_pending_offer_failed"]);
  });

  it("rotates finalization identity only for final rework", async () => {
    const current = {
      parentSessionId: "parent-1",
      authorizationId: "auth-1",
      planPath: "plan.md",
      finalizationAttemptId: "final-1",
      finalReviewRound: 1,
      state: "final_rework_required" as const,
    };
    const records: PendingObservationRecord[] = [];
    const next = await startNextFinalizationAttempt(
      current,
      async (record) => {
        records.push(record);
        return records.length;
      },
      {},
    );

    expect(next).toMatchObject({
      from: "final_rework_required",
      to: "final_review_pending",
      finalReviewRound: 2,
    });
    if ("kind" in next) throw new Error("expected finalization transition to commit");
    expect(next.finalizationAttemptId).not.toBe(current.finalizationAttemptId);
    expect(records).toHaveLength(1);
  });
});
