import { describe, expect, it } from "vitest";
import { createReviewDispatchState } from "../../src/core/review-dispatch-state";
import type { ApprovedPlanBinding } from "../../src/core/plan-authorization";
import type { ReviewCorrelation, TaskExecutionRef } from "../../src/core/types";
import type {
  PendingReviewDispatchTransitionRecord,
  PersistedLogRecord,
  PlanFinalizationTransitionRecord,
  ReviewDispatchTransitionRecord,
  TaskLifecycleTransitionRecord,
} from "../../src/core/v2/observation-model";

const parentSessionId = "parent-1";
const authorizationId = "auth-1";
const planPath = "docs/plan.md";
const fingerprint = { algorithm: "sha256" as const, value: "fingerprint-1" };

type TestEnvelope = {
  readonly schemaVersion: 1;
  readonly timestamp: string;
  readonly agentId: "atlas";
  readonly sessionId: string;
  readonly writerId: string;
  readonly recordType: "observation";
  readonly sequence: number;
};

type ReviewDispatchFixture = {
  readonly state: ReturnType<typeof createReviewDispatchState>;
  readonly records: PersistedLogRecord[];
  readonly delivered: ReviewCorrelation[];
};

function activeBinding(): Extract<ApprovedPlanBinding, { readonly status: "active" }> {
  return {
    authorizationId,
    sessionId: parentSessionId,
    planPath,
    planFingerprint: fingerprint,
    canonicalSnapshot: {
      schema: "justice-plan-v1",
      documentDigest: "document",
      globalBodyDigest: "global",
      tasks: [{ taskId: "task-1", title: "Task", canonicalBody: "body", digest: "task" }],
    },
    fingerprintSchema: "justice-plan-v1",
    approvedAt: "2026-09-20T00:00:00.000Z",
    status: "active",
  };
}

function taskRef(attemptId: string): TaskExecutionRef {
  return { authorizationId, taskId: "task-1", attemptId };
}

function taskCorrelation(
  attemptId: string,
  reviewRound = 1,
): Extract<ReviewCorrelation, { readonly reviewKind: "task-review" }> {
  return { reviewKind: "task-review", taskExecutionRef: taskRef(attemptId), reviewRound };
}

function finalCorrelation(
  attemptId: string,
  finalReviewRound = 1,
): Extract<ReviewCorrelation, { readonly reviewKind: "final-review" }> {
  return {
    reviewKind: "final-review",
    authorizationId,
    planPath,
    planFingerprint: fingerprint,
    finalizationAttemptId: attemptId,
    finalReviewRound,
  };
}

function envelope(sequence: number): TestEnvelope {
  return {
    schemaVersion: 1 as const,
    timestamp: `2026-09-20T00:00:${String(sequence).padStart(2, "0")}.000Z`,
    agentId: "atlas" as const,
    sessionId: parentSessionId,
    writerId: "writer-1",
    recordType: "observation" as const,
    sequence,
  };
}

function taskReviewPending(ref: TaskExecutionRef, firstSequence: number): readonly PersistedLogRecord[] {
  const transitions: readonly (readonly [
    TaskLifecycleTransitionRecord["from"],
    TaskLifecycleTransitionRecord["to"],
  ])[] = [
    ["pending", "authorized"],
    ["authorized", "in_progress"],
    ["in_progress", "worker_reported"],
    ["worker_reported", "evidence_pending"],
    ["evidence_pending", "review_pending"],
  ];
  return transitions.map(([from, to], index) => ({
    ...envelope(firstSequence + index),
    kind: "task_lifecycle_transition" as const,
    parentSessionId,
    taskExecutionRef: ref,
    from,
    to,
  }));
}

function finalReviewPending(attemptId: string, firstSequence: number): readonly PersistedLogRecord[] {
  const transitions: readonly (readonly [
    PlanFinalizationTransitionRecord["from"],
    PlanFinalizationTransitionRecord["to"],
  ])[] = [
    ["tasks_pending", "all_tasks_accepted"],
    ["all_tasks_accepted", "final_review_pending"],
  ];
  return transitions.map(([from, to], index) => ({
    ...envelope(firstSequence + index),
    kind: "plan_finalization_transition" as const,
    parentSessionId,
    authorizationId,
    planPath,
    finalizationAttemptId: attemptId,
    finalReviewRound: 1,
    from,
    to,
  }));
}

function dispatch(
  sequence: number,
  correlation: ReviewCorrelation,
  from: null | "pending" | "claimed",
  to: "pending" | "claimed" | "terminal",
): ReviewDispatchTransitionRecord {
  const base = {
    ...envelope(sequence),
    kind: "review_dispatch_transition" as const,
    transitionId: `dispatch-${sequence}`,
    parentSessionId,
    correlation,
    expectedCategory: correlation.reviewKind === "task-review" ? ("sp-review" as const) : ("sp-final-review" as const),
  };
  if (from === null && to === "pending") return { ...base, from, to };
  if (from === "pending" && to === "claimed") {
    return {
      ...base,
      from,
      to,
      callId: `call-${sequence}`,
      artifactReservation: {
        status: "usable",
        artifactId: `artifact-${sequence}`,
        artifactPath: `.justice/reviews/artifact-${sequence}.json`,
        leasePath: `.justice/reviews/.leases/artifact-${sequence}.lease`,
        artifactIdentity: { device: "1", inode: String(sequence) },
      },
    };
  }
  if (from === "claimed" && to === "terminal") {
    return {
      ...base,
      from,
      to,
      callId: `call-${sequence - 1}`,
      terminalReason: "review_execution_failed",
    };
  }
  return { ...base, from: "pending", to: "terminal", terminalReason: "cancelled" };
}

function fixture(
  initial: readonly PersistedLogRecord[],
  bindings: readonly ApprovedPlanBinding[] = [activeBinding()],
): ReviewDispatchFixture {
  const records = [...initial];
  const delivered: ReviewCorrelation[] = [];
  let id = 100;
  const state = createReviewDispatchState({
    readDurableRecords: async () => records,
    readDurableAuthorizations: async () => bindings,
    findAuthorizationById: async (candidate) =>
      bindings.find((binding) => binding.authorizationId === candidate) ?? null,
    appendReviewDispatchTransition: async (input: PendingReviewDispatchTransitionRecord) => {
      const record = { ...input, sequence: records.length + 1 };
      records.push(record);
      return { kind: "committed" as const, record };
    },
    reserveReviewArtifact: async () => ({
      status: "usable" as const,
      artifactId: "reserved",
      artifactPath: ".justice/reviews/reserved.json",
      leasePath: ".justice/reviews/.leases/reserved.lease",
      artifactIdentity: { device: "1", inode: "reserved" },
    }),
    injectReviewRequiredDirective: async (delivery) => {
      delivered.push(delivery.directive.correlation);
    },
    withAuthorizationReviewBoundary: async (_parent, operation) => operation(),
    hydrateAuthorizationsBeforeReviewRecovery: async () => undefined,
    recordAdvisory: async () => undefined,
    generateId: () => `generated-${id++}`,
    now: () => "2026-09-20T00:01:00.000Z",
  });
  return { state, records, delivered };
}

describe("review dispatch lifecycle authority", () => {
  it("offers the current task attempt instead of retrying a stale task dispatch", async () => {
    const stale = taskCorrelation("attempt-stale");
    const current = taskCorrelation("attempt-current");
    const subject = fixture([
      dispatch(1, stale, null, "pending"),
      dispatch(2, stale, "pending", "claimed"),
      dispatch(3, stale, "claimed", "terminal"),
      ...taskReviewPending(current.taskExecutionRef, 4),
    ]);

    const outcome = await subject.state.offerNextMandatoryReview(parentSessionId);

    expect(outcome).toEqual({ kind: "offered", correlation: current });
  });

  it("offers the current finalization attempt instead of retrying a stale final dispatch", async () => {
    const stale = finalCorrelation("final-stale");
    const current = finalCorrelation("final-current");
    const subject = fixture([
      dispatch(1, stale, null, "pending"),
      dispatch(2, stale, "pending", "claimed"),
      dispatch(3, stale, "claimed", "terminal"),
      ...finalReviewPending(current.finalizationAttemptId, 4),
    ]);

    const outcome = await subject.state.offerNextMandatoryReview(parentSessionId);

    expect(outcome).toEqual({ kind: "offered", correlation: current });
  });

  it("discards a queued directive whose pending slot is no longer the current lifecycle", async () => {
    const stale = taskCorrelation("attempt-stale");
    const subject = fixture([dispatch(1, stale, null, "pending"), ...taskReviewPending(taskRef("attempt-current"), 2)]);

    const outcome = await subject.state.validateQueuedReviewDirectiveWithinParentSessionClaim({
      parentSessionId,
      directive: { kind: "review_required", correlation: stale },
    });

    expect(outcome).toBe("discard");
  });

  it("terminalizes claimed recovery slots after their authorization becomes terminal", async () => {
    const correlation = taskCorrelation("attempt-current");
    const binding: ApprovedPlanBinding = { ...activeBinding(), status: "released", releasedAt: "2026-09-20T00:02:00.000Z" };
    const subject = fixture(
      [
        ...taskReviewPending(correlation.taskExecutionRef, 1),
        dispatch(6, correlation, null, "pending"),
        dispatch(7, correlation, "pending", "claimed"),
      ],
      [binding],
    );

    await subject.state.recoverReviewDispatchesAfterRestart();

    expect(subject.records.at(-1)).toMatchObject({
      kind: "review_dispatch_transition",
      from: "claimed",
      to: "terminal",
      terminalReason: "cancelled",
    });
  });

  it("converges a stale pending slot before offering the current mandatory review", async () => {
    const stale = taskCorrelation("attempt-stale");
    const current = taskCorrelation("attempt-current");
    const subject = fixture([dispatch(1, stale, null, "pending"), ...taskReviewPending(current.taskExecutionRef, 2)]);

    const outcome = await subject.state.offerNextMandatoryReview(parentSessionId);

    expect(outcome).toEqual({ kind: "offered", correlation: current });
    expect(subject.records).toContainEqual(
      expect.objectContaining({
        kind: "review_dispatch_transition",
        correlation: stale,
        from: "pending",
        to: "terminal",
        terminalReason: "cancelled",
      }),
    );
  });
});
