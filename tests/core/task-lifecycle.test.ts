import { describe, expect, it } from "vitest";
import {
  applyPlanTransition,
  applyTaskTransition,
  advanceFinalizationAfterAllTasksAccepted,
  appendPlanFinalizationTransition,
  appendTaskLifecycleTransition,
  recordWorkerReportedAndEvidence,
  requestCurrentTaskReview,
  startNextFinalizationAttempt,
  startImplementationAttempt,
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

  it("treats a replay with the same task identity as a duplicate", () => {
    expect(
      applyTaskTransition(
        { value: "worker_reported", lastTransitionIdentity: "attempt-1" },
        { identity: "attempt-1", from: "in_progress", to: "worker_reported" },
      ),
    ).toEqual({ kind: "duplicate", state: "worker_reported" });
  });

  it("applies an allowed plan finalization transition", () => {
    expect(
      applyPlanTransition("tasks_pending", {
        identity: "final-1",
        from: "tasks_pending",
        to: "all_tasks_accepted",
      }),
    ).toEqual({ kind: "applied", state: "all_tasks_accepted" });
  });

  it("treats a replay with the same plan identity as a duplicate", () => {
    expect(
      applyPlanTransition(
        { value: "final_review_pending", lastTransitionIdentity: "final-1" },
        { identity: "final-1", from: "all_tasks_accepted", to: "final_review_pending" },
      ),
    ).toEqual({ kind: "duplicate", state: "final_review_pending" });
    expect(
      applyPlanTransition("final_review_pending", {
        identity: "final-1",
        from: "final_review_pending",
        to: "final_review_pending",
      }),
    ).toEqual({ kind: "duplicate", state: "final_review_pending" });
  });

  it("rejects plan finalization source mismatches", () => {
    expect(
      applyPlanTransition("final_review_pending", {
        identity: "final-1",
        from: "all_tasks_accepted",
        to: "final_gate_pending",
      }),
    ).toEqual({
      kind: "invalid",
      state: "final_review_pending",
      advisory: "all_tasks_accepted -> final_gate_pending does not start at final_review_pending",
    });
  });

  it("rejects plan finalization transitions from a terminal state", () => {
    expect(
      applyPlanTransition("complete", {
        identity: "final-1",
        from: "complete",
        to: "final_review_pending",
      }),
    ).toEqual({
      kind: "invalid",
      state: "complete",
      advisory: "complete -> final_review_pending is not allowed",
    });
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

  it("stops worker lifecycle recording when the first append fails", async () => {
    const result = await recordWorkerReportedAndEvidence({
      parentSessionId: "parent-1",
      taskExecutionRef: { authorizationId: "auth-1", taskId: "task-1", attemptId: "attempt-1" },
      appendRecord: async () => {
        throw new Error("append failed");
      },
    });

    expect(result).toEqual({ kind: "failed" });
  });

  it("returns the second append failure when evidence recording fails", async () => {
    let calls = 0;
    const result = await recordWorkerReportedAndEvidence({
      parentSessionId: "parent-1",
      taskExecutionRef: { authorizationId: "auth-1", taskId: "task-1", attemptId: "attempt-1" },
      appendRecord: async () => {
        calls += 1;
        if (calls === 2) throw new Error("append failed");
        return calls;
      },
    });

    expect(result).toEqual({ kind: "failed" });
    expect(calls).toBe(2);
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

  it("returns failed when appending a task lifecycle record fails", async () => {
    const result = await appendTaskLifecycleTransition(
      {
        parentSessionId: "parent-1",
        taskExecutionRef: { authorizationId: "auth-1", taskId: "task-1", attemptId: "attempt-1" },
        from: "review_pending",
        to: "gate_pending",
      },
      async () => {
        throw new Error("append failed");
      },
    );

    expect(result).toEqual({ kind: "failed" });
  });

  it("appends a plan finalization record without an optional reason", async () => {
    const records: PendingObservationRecord[] = [];
    const result = await appendPlanFinalizationTransition(
      {
        parentSessionId: "parent-1",
        authorizationId: "auth-1",
        planPath: "plan.md",
        finalizationAttemptId: "final-1",
        finalReviewRound: 1,
        from: "tasks_pending",
        to: "all_tasks_accepted",
      },
      async (record) => {
        records.push(record);
        return 1;
      },
    );

    expect(result).toEqual({ kind: "committed" });
    expect(records[0]).toMatchObject({
      kind: "plan_finalization_transition",
      from: "tasks_pending",
      to: "all_tasks_accepted",
    });
    expect(records[0]).not.toHaveProperty("reason");
  });

  it("returns failed when appending a plan finalization record fails", async () => {
    const result = await appendPlanFinalizationTransition(
      {
        parentSessionId: "parent-1",
        authorizationId: "auth-1",
        planPath: "plan.md",
        finalizationAttemptId: "final-1",
        finalReviewRound: 1,
        from: "tasks_pending",
        to: "all_tasks_accepted",
      },
      async () => {
        throw new Error("append failed");
      },
    );

    expect(result).toEqual({ kind: "failed" });
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

  it("stops finalization when the initial transition fails", async () => {
    const records: PendingObservationRecord[] = [];
    const result = await advanceFinalizationAfterAllTasksAccepted(
      {
        parentSessionId: "parent-1",
        authorizationId: "auth-1",
        planPath: "plan.md",
      },
      async (record) => {
        records.push(record);
        throw new Error("append failed");
      },
      {},
    );

    expect(result).toEqual({ kind: "failed" });
    expect(records).toHaveLength(1);
  });

  it("returns failed when the final review transition fails", async () => {
    const result = await advanceFinalizationAfterAllTasksAccepted(
      {
        parentSessionId: "parent-1",
        authorizationId: "auth-1",
        planPath: "plan.md",
        finalizationAttemptId: "final-1",
      },
      async () => {
        throw new Error("append failed");
      },
      {},
    );

    expect(result).toEqual({ kind: "failed" });
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

  it("preserves a committed transition when advisory recording also fails", async () => {
    const result = await requestCurrentTaskReview({
      parentSessionId: "parent-1",
      taskExecutionRef: { authorizationId: "auth-1", taskId: "task-1", attemptId: "attempt-1" },
      appendRecord: async () => 1,
      dependencies: {
        onReviewPendingCommitted: async () => {
          throw new Error("offer failed");
        },
        recordAdvisory: async () => {
          throw new Error("advisory failed");
        },
      },
    });

    expect(result).toEqual({ kind: "committed" });
  });

  it("returns the append result when requesting review fails", async () => {
    const result = await requestCurrentTaskReview({
      parentSessionId: "parent-1",
      taskExecutionRef: { authorizationId: "auth-1", taskId: "task-1", attemptId: "attempt-1" },
      appendRecord: async () => {
        throw new Error("append failed");
      },
    });

    expect(result).toEqual({ kind: "failed" });
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

  it("creates a finalization transition without durable side effects", () => {
    const next = startNextFinalizationAttempt({
      parentSessionId: "parent-1",
      authorizationId: "auth-1",
      planPath: "plan.md",
      finalizationAttemptId: "final-1",
      finalReviewRound: 1,
      state: "final_rework_required",
    });

    expect(next).toMatchObject({
      from: "final_rework_required",
      to: "final_review_pending",
      finalReviewRound: 2,
    });
    expect(next.finalizationAttemptId).not.toBe("final-1");
  });

  it("starts implementation from authorized and rework states", () => {
    const authorized = startImplementationAttempt({
      authorizationId: "auth-1",
      taskId: "task-1",
      state: "authorized",
    });
    const rework = startImplementationAttempt({
      authorizationId: "auth-1",
      taskId: "task-1",
      state: "rework_required",
    });

    expect(authorized).toMatchObject({
      taskExecutionRef: { authorizationId: "auth-1", taskId: "task-1" },
      reviewRound: 1,
    });
    expect(rework).toMatchObject({
      taskExecutionRef: { authorizationId: "auth-1", taskId: "task-1" },
      reviewRound: 1,
    });
  });

  it("rejects implementation from a non-startable state", () => {
    expect(() =>
      startImplementationAttempt({
        authorizationId: "auth-1",
        taskId: "task-1",
        state: "in_progress",
      }),
    ).toThrow("cannot start implementation from in_progress");
  });
});
