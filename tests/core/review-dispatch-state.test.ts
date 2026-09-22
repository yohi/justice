import { describe, expect, it } from "vitest";
import {
  createReviewDirectiveSink,
  createReviewDispatchState,
  projectReviewDispatchSlots,
  projectTaskCallBindings,
  type ReviewDispatchDependencies,
  type ReviewDirectiveDelivery,
} from "../../src/core/review-dispatch-state";
import type { ApprovedPlanBinding } from "../../src/core/plan-authorization";
import type {
  PersistedLogRecord,
  PlanFinalizationTransitionRecord,
  ReviewDispatchTransitionRecord,
  TaskLifecycleTransitionRecord,
} from "../../src/core/v2/observation-model";
import type { ReviewArtifactReservation, ReviewCorrelation } from "../../src/core/types";
import {
  fromSerializableProjectedState,
  project,
  toSerializableProjectedState,
} from "../../src/core/v2/state-projection";

const correlation: Extract<ReviewCorrelation, { readonly reviewKind: "task-review" }> = {
  reviewKind: "task-review",
  taskExecutionRef: {
    authorizationId: "auth-1",
    taskId: "task-1",
    attemptId: "attempt-1",
  },
  reviewRound: 1,
};

const finalCorrelation: Extract<ReviewCorrelation, { readonly reviewKind: "final-review" }> = {
  reviewKind: "final-review",
  planPath: "plan.md",
  authorizationId: "auth-1",
  planFingerprint: { algorithm: "sha256", value: "plan-fingerprint" },
  finalizationAttemptId: "finalization-1",
  finalReviewRound: 1,
};

const usableReservation: ReviewArtifactReservation = {
  status: "usable",
  artifactId: "artifact-1",
  artifactPath: ".justice/reviews/artifact-1.json",
  leasePath: ".justice/reviews/.leases/artifact-1.lease",
  artifactIdentity: { device: "1", inode: "2" },
};

function activeAuthorization(): ApprovedPlanBinding {
  return {
    authorizationId: "auth-1",
    sessionId: "parent-1",
    planPath: "plan.md",
    planFingerprint: { algorithm: "sha256", value: "plan-fingerprint" },
    canonicalSnapshot: {
      schema: "justice-plan-v1",
      documentDigest: "document",
      globalBodyDigest: "body",
      tasks: [{ taskId: "task-1", title: "Task 1", canonicalBody: "body", digest: "digest" }],
    },
    fingerprintSchema: "justice-plan-v1",
    approvedAt: "2026-09-20T00:00:00.000Z",
    status: "active",
  };
}

function taskLifecycle(
  sequence: number,
  from: TaskLifecycleTransitionRecord["from"],
  to: TaskLifecycleTransitionRecord["to"],
): PersistedLogRecord {
  return {
    schemaVersion: 1,
    timestamp: `2026-09-20T00:00:0${sequence}.000Z`,
    agentId: "atlas",
    sessionId: "parent-1",
    writerId: "writer-1",
    recordType: "observation",
    sequence,
    kind: "task_lifecycle_transition",
    parentSessionId: "parent-1",
    taskExecutionRef: correlation.taskExecutionRef,
    from,
    to,
  };
}

function seedReviewPending(records: PersistedLogRecord[]): void {
  const transitions: readonly [
    TaskLifecycleTransitionRecord["from"],
    TaskLifecycleTransitionRecord["to"],
  ][] = [
    ["pending", "authorized"],
    ["authorized", "in_progress"],
    ["in_progress", "worker_reported"],
    ["worker_reported", "evidence_pending"],
    ["evidence_pending", "review_pending"],
  ];
  records.push(...transitions.map(([from, to], index) => taskLifecycle(index + 1, from, to)));
}

function finalizationTransition(
  sequence: number,
  finalizationAttemptId: string,
  from: PlanFinalizationTransitionRecord["from"],
  to: PlanFinalizationTransitionRecord["to"],
): PersistedLogRecord {
  return {
    schemaVersion: 1,
    timestamp: `2026-09-20T00:00:${String(sequence).padStart(2, "0")}.000Z`,
    agentId: "atlas",
    sessionId: "parent-1",
    writerId: "writer-1",
    recordType: "observation",
    sequence,
    kind: "plan_finalization_transition",
    parentSessionId: "parent-1",
    authorizationId: "auth-1",
    planPath: "plan.md",
    finalizationAttemptId,
    finalReviewRound: 1,
    from,
    to,
  };
}

function seedFinalReviewPending(
  records: PersistedLogRecord[],
  firstSequence = 1,
  finalizationAttemptId = "finalization-1",
): void {
  records.push(
    finalizationTransition(firstSequence, finalizationAttemptId, "tasks_pending", "all_tasks_accepted"),
    finalizationTransition(
      firstSequence + 1,
      finalizationAttemptId,
      "all_tasks_accepted",
      "final_review_pending",
    ),
  );
}

function dispatchHarness() {
  const state = {
    records: [] as PersistedLogRecord[],
    authorizations: [activeAuthorization()] as ApprovedPlanBinding[],
    reservation: usableReservation,
    cleanupCalls: [] as ReviewArtifactReservation[],
    appendKind: "committed" as "committed" | "failed",
    readRecordsFailure: false,
    readAuthorizationsFailure: false,
    readAuthorizationsFailureAfter: undefined as number | undefined,
    readAuthorizationsCount: 0,
    lookupAuthorization: undefined as ApprovedPlanBinding | null | undefined,
    lookupSequence: undefined as (ApprovedPlanBinding | null)[] | undefined,
    directives: [] as ReviewDirectiveDelivery[],
    advisories: [] as string[],
    advisoryFailure: false,
    id: 0,
  };
  const dependencies: ReviewDispatchDependencies & {
    readonly cleanupReviewArtifactReservation: (
      reservation: ReviewArtifactReservation,
    ) => Promise<void>;
  } = {
    readDurableRecords: async () => {
      if (state.readRecordsFailure) throw new Error("records unavailable");
      return state.records;
    },
    readDurableAuthorizations: async () => {
      state.readAuthorizationsCount += 1;
      if (
        state.readAuthorizationsFailure ||
        (state.readAuthorizationsFailureAfter !== undefined &&
          state.readAuthorizationsCount > state.readAuthorizationsFailureAfter)
      ) {
        throw new Error("authorizations unavailable");
      }
      return state.authorizations;
    },
    findAuthorizationById: async () => {
      if (state.lookupSequence !== undefined && state.lookupSequence.length > 0) {
        return state.lookupSequence.shift() ?? null;
      }
      return state.lookupAuthorization === undefined
        ? (state.authorizations[0] ?? null)
        : state.lookupAuthorization;
    },
    appendReviewDispatchTransition: async (input) => {
      if (state.appendKind === "failed") return { kind: "failed" };
      const record = {
        ...input,
        sequence: state.records.length + 1,
      } as ReviewDispatchTransitionRecord;
      state.records.push(record);
      return { kind: "committed", record };
    },
    reserveReviewArtifact: async () => state.reservation,
    cleanupReviewArtifactReservation: async (reservation: ReviewArtifactReservation) => {
      state.cleanupCalls.push(reservation);
    },
    injectReviewRequiredDirective: async (delivery) => {
      state.directives.push(delivery);
    },
    withAuthorizationReviewBoundary: async (_parentSessionId, operation) => operation(),
    hydrateAuthorizationsBeforeReviewRecovery: async () => undefined,
    recordAdvisory: async (advisory) => {
      if (state.advisoryFailure) throw new Error("advisory unavailable");
      state.advisories.push(advisory);
    },
    generateId: () => `transition-${++state.id}`,
    now: () => "2026-09-20T00:00:10.000Z",
  };
  return { state, dispatch: createReviewDispatchState(dependencies) };
}

function claimInput() {
  return {
    parentSessionId: "parent-1",
    callId: "call-1",
    expectedCategory: "sp-review" as const,
    agentId: "atlas" as const,
    sessionId: "worker-1",
    writerId: "writer-1",
  };
}

const base = {
  schemaVersion: 1 as const,
  timestamp: "2026-09-20T00:00:00.000Z",
  agentId: "atlas" as const,
  sessionId: "parent-1",
  writerId: "writer-1",
  recordType: "observation" as const,
  kind: "review_dispatch_transition" as const,
  parentSessionId: "parent-1",
  correlation,
  expectedCategory: "sp-review" as const,
};

function pending(sequence = 1): ReviewDispatchTransitionRecord {
  return {
    ...base,
    sequence,
    transitionId: `transition-${sequence}`,
    from: null,
    to: "pending",
  };
}

function finalPending(sequence = 1): ReviewDispatchTransitionRecord {
  return {
    ...base,
    sequence,
    transitionId: `final-transition-${sequence}`,
    correlation: finalCorrelation,
    expectedCategory: "sp-final-review",
    from: null,
    to: "pending",
  };
}

function claimed(sequence = 2): ReviewDispatchTransitionRecord {
  return {
    ...base,
    sequence,
    transitionId: `transition-${sequence}`,
    from: "pending",
    to: "claimed",
    callId: "call-1",
    artifactReservation: {
      status: "usable",
      artifactId: "artifact-1",
      artifactPath: ".justice/reviews/artifact-1.json",
      leasePath: ".justice/reviews/.leases/artifact-1.lease",
      artifactIdentity: { device: "1", inode: "2" },
    },
  };
}

function finalClaimed(sequence = 2): ReviewDispatchTransitionRecord {
  return {
    ...claimed(sequence),
    transitionId: `final-transition-${sequence}`,
    correlation: finalCorrelation,
    expectedCategory: "sp-final-review",
  };
}

function finalTerminal(sequence = 3): ReviewDispatchTransitionRecord {
  return {
    ...terminal("call-1", sequence),
    transitionId: `final-transition-${sequence}`,
    correlation: finalCorrelation,
    expectedCategory: "sp-final-review",
  };
}

function claimedUnusable(sequence = 2): ReviewDispatchTransitionRecord {
  return {
    ...base,
    sequence,
    transitionId: `transition-${sequence}`,
    from: "pending",
    to: "claimed",
    callId: "call-1",
    artifactReservation: { status: "unusable", reason: "artifact_path_invalid" },
  };
}

function terminal(callId: string, sequence = 3): ReviewDispatchTransitionRecord {
  return {
    ...base,
    sequence,
    transitionId: `transition-${sequence}`,
    from: "claimed",
    to: "terminal",
    callId,
    terminalReason: "review_execution_failed",
  };
}

describe("durable review dispatch projection", () => {
  it("uses shard sequence order and restores a claimed task binding", () => {
    const records = [claimed(), pending()];

    expect(projectReviewDispatchSlots(records)).toMatchObject([
      { state: "claimed", callId: "call-1", key: { correlation } },
    ]);
    expect(projectTaskCallBindings(records)).toMatchObject([
      {
        purpose: "task_review",
        callId: "call-1",
        expectedCategory: "sp-review",
        correlation,
      },
    ]);
  });

  it("projects final-review bindings and rejects terminal transitions for another call", () => {
    const records = [
      finalPending(),
      finalClaimed(2),
      {
        ...finalClaimed(3),
        transitionId: "final-terminal-3",
        from: "claimed" as const,
        to: "terminal" as const,
        callId: "other-call",
        terminalReason: "review_execution_failed" as const,
      },
    ];

    expect(projectReviewDispatchSlots(records)).toMatchObject([
      { state: "claimed", expectedCategory: "sp-final-review", callId: "call-1" },
    ]);
    expect(projectTaskCallBindings(records)).toMatchObject([
      { purpose: "final_review", expectedCategory: "sp-final-review", callId: "call-1" },
    ]);
  });

  it("ignores a terminal transition whose claimed call identity does not match", () => {
    expect(
      projectReviewDispatchSlots([pending(), claimed(), terminal("other-call")]),
    ).toMatchObject([{ state: "claimed", callId: "call-1" }]);
  });

  it("round-trips slots and task bindings through the projected cache", () => {
    const state = project([pending(), claimed()], "2026-09-20T00:00:01.000Z");
    const restored = fromSerializableProjectedState(toSerializableProjectedState(state));

    expect(restored.reviewDispatchSlots).toEqual(state.reviewDispatchSlots);
    expect(restored.taskCallBindings).toEqual(state.taskCallBindings);
  });
});

describe("review directive sink", () => {
  const delivery: ReviewDirectiveDelivery = {
    parentSessionId: "parent-1",
    directive: { kind: "review_required", correlation },
  };

  it("deduplicates deliveries and applies inject, retain, and discard decisions", async () => {
    const sink = createReviewDirectiveSink();
    await sink.deliver(delivery);
    await sink.deliver(delivery);

    await expect(sink.drainForParentSession("parent-1", async () => "inject")).resolves.toEqual([
      delivery,
    ]);

    await sink.deliver(delivery);
    await expect(sink.drainForParentSession("parent-1", async () => "retain")).resolves.toEqual([]);
    await expect(sink.drainForParentSession("parent-1", async () => "inject")).resolves.toEqual([
      delivery,
    ]);

    await sink.deliver(delivery);
    await expect(sink.drainForParentSession("parent-1", async () => "discard")).resolves.toEqual(
      [],
    );
  });

  it("restores all deliveries when the decision callback throws", async () => {
    const sink = createReviewDirectiveSink();
    await sink.deliver(delivery);

    await expect(
      sink.drainForParentSession("parent-1", async () => {
        throw new Error("decision failed");
      }),
    ).rejects.toThrow("decision failed");
    await expect(sink.drainForParentSession("parent-1", async () => "inject")).resolves.toEqual([
      delivery,
    ]);
  });
});

describe("review dispatch state machine", () => {
  it("offers and claims a mandatory task review", async () => {
    const harness = dispatchHarness();
    seedReviewPending(harness.state.records);

    await expect(harness.dispatch.offerNextMandatoryReview("parent-1")).resolves.toEqual({
      kind: "offered",
      correlation,
    });
    expect(harness.state.directives).toHaveLength(1);
    expect(projectReviewDispatchSlots(harness.state.records)).toMatchObject([
      { state: "pending", expectedCategory: "sp-review" },
    ]);

    await expect(harness.dispatch.claimReviewDispatch(claimInput())).resolves.toEqual({
      kind: "claimed",
      taskCallBinding: {
        purpose: "task_review",
        parentSessionId: "parent-1",
        callId: "call-1",
        correlation,
        expectedCategory: "sp-review",
        artifactReservation: usableReservation,
      },
    });
    expect(projectReviewDispatchSlots(harness.state.records)).toMatchObject([
      { state: "claimed", callId: "call-1", artifactReservation: usableReservation },
    ]);
  });

  it("blocks claims when the category or pending slot is unavailable", async () => {
    const harness = dispatchHarness();
    seedReviewPending(harness.state.records);
    await harness.dispatch.offerNextMandatoryReview("parent-1");

    await expect(
      harness.dispatch.claimReviewDispatch({
        ...claimInput(),
        expectedCategory: "sp-final-review",
      }),
    ).resolves.toEqual({ kind: "blocked", advisory: "review_claim_unavailable" });

    harness.state.records = [];
    await expect(harness.dispatch.claimReviewDispatch(claimInput())).resolves.toEqual({
      kind: "blocked",
      advisory: "review_claim_unavailable",
    });
  });

  it("cancels stale slots before checking claim availability", async () => {
    const harness = dispatchHarness();
    harness.state.records.push(pending());

    await expect(harness.dispatch.claimReviewDispatch(claimInput())).resolves.toEqual({
      kind: "blocked",
      advisory: "review_claim_unavailable",
    });
    expect(projectReviewDispatchSlots(harness.state.records)).toMatchObject([
      { state: "terminal", terminalReason: "cancelled" },
    ]);
  });

  it("returns a usable claim with an unusable artifact and terminalizes it", async () => {
    const harness = dispatchHarness();
    harness.state.reservation = { status: "unusable", reason: "artifact_storage_unavailable" };
    seedReviewPending(harness.state.records);
    await harness.dispatch.offerNextMandatoryReview("parent-1");

    await expect(harness.dispatch.claimReviewDispatch(claimInput())).resolves.toMatchObject({
      kind: "claimed_unusable",
      artifactPathOmitted: true,
      advisory: "artifact_reservation_unusable",
    });
    expect(projectReviewDispatchSlots(harness.state.records)).toMatchObject([
      { state: "terminal", terminalReason: "artifact_reservation_unusable" },
    ]);
  });

  it("offers and claims a mandatory final review", async () => {
    const harness = dispatchHarness();
    seedFinalReviewPending(harness.state.records);

    await expect(harness.dispatch.offerNextMandatoryReview("parent-1")).resolves.toEqual({
      kind: "offered",
      correlation: finalCorrelation,
    });
    await expect(
      harness.dispatch.claimReviewDispatch({
        ...claimInput(),
        expectedCategory: "sp-final-review",
      }),
    ).resolves.toMatchObject({
      kind: "claimed",
      taskCallBinding: { purpose: "final_review", expectedCategory: "sp-final-review" },
    });
  });

  it("does not advance a final review round for a current pending slot", async () => {
    const harness = dispatchHarness();
    seedFinalReviewPending(harness.state.records);
    harness.state.records.push(finalPending(3));

    await expect(harness.dispatch.offerNextMandatoryReview("parent-1")).resolves.toEqual({
      kind: "deferred",
    });
  });

  it("advances a final review round after a matching failed dispatch", async () => {
    const harness = dispatchHarness();
    seedFinalReviewPending(harness.state.records);
    harness.state.records.push(finalPending(3), finalClaimed(4), finalTerminal(5));

    await expect(harness.dispatch.offerNextMandatoryReview("parent-1")).resolves.toEqual({
      kind: "offered",
      correlation: { ...finalCorrelation, finalReviewRound: 2 },
    });
  });

  it("ignores a finalization transition from an older attempt", async () => {
    const harness = dispatchHarness();
    seedFinalReviewPending(harness.state.records);
    harness.state.records.push(
      finalizationTransition(3, "finalization-1", "final_review_pending", "final_rework_required"),
      finalizationTransition(4, "finalization-2", "final_rework_required", "final_review_pending"),
    );

    await expect(harness.dispatch.offerNextMandatoryReview("parent-1")).resolves.toEqual({
      kind: "offered",
      correlation: { ...finalCorrelation, finalizationAttemptId: "finalization-2" },
    });
  });

  it("retries a failed claimed review with the next round", async () => {
    const harness = dispatchHarness();
    seedReviewPending(harness.state.records);
    await harness.dispatch.offerNextMandatoryReview("parent-1");
    await harness.dispatch.claimReviewDispatch(claimInput());

    await expect(
      harness.dispatch.terminalizeReviewFailure(
        { ...claimInput(), correlation },
        "review_execution_failed",
      ),
    ).resolves.toEqual({
      kind: "retried",
      correlation: { ...correlation, reviewRound: 2 },
    });
    expect(harness.state.directives.at(-1)?.directive.correlation).toEqual({
      ...correlation,
      reviewRound: 2,
    });
  });

  it("cancels terminal-authorized slots and blocks failed offers", async () => {
    const harness = dispatchHarness();
    seedReviewPending(harness.state.records);
    await harness.dispatch.offerNextMandatoryReview("parent-1");

    await harness.dispatch.cancelReviewDispatchesForTerminalAuthorization("parent-1", "auth-1");
    expect(projectReviewDispatchSlots(harness.state.records)).toMatchObject([
      { state: "terminal", terminalReason: "cancelled" },
    ]);

    const failed = dispatchHarness();
    seedReviewPending(failed.state.records);
    failed.state.appendKind = "failed";
    await expect(failed.dispatch.offerNextMandatoryReview("parent-1")).resolves.toEqual({
      kind: "blocked",
    });
  });

  it("cancels stale slots and reports ambiguous authorization slots", async () => {
    const ambiguous = dispatchHarness();
    ambiguous.state.records.push(pending(), finalPending(2));

    await ambiguous.dispatch.cancelReviewDispatchesForTerminalAuthorization("parent-1", "auth-1");

    expect(ambiguous.state.advisories).toContain("review_dispatch_integrity_violation");
    expect(projectReviewDispatchSlots(ambiguous.state.records)).toMatchObject([
      { state: "pending" },
      { state: "pending" },
    ]);

    const stale = dispatchHarness();
    stale.state.authorizations = [];
    stale.state.records.push(pending());

    await expect(stale.dispatch.offerNextMandatoryReview("parent-1")).resolves.toEqual({
      kind: "none",
    });
    expect(projectReviewDispatchSlots(stale.state.records)).toMatchObject([
      { state: "terminal", terminalReason: "cancelled" },
    ]);
  });

  it("does not offer a review for an authorization from another parent session", async () => {
    const harness = dispatchHarness();
    harness.state.authorizations = [{ ...activeAuthorization(), sessionId: "other-parent" }];
    seedReviewPending(harness.state.records);

    await expect(harness.dispatch.offerNextMandatoryReview("parent-1")).resolves.toEqual({
      kind: "none",
    });
  });

  it("cancels a pending final slot when its finalization is no longer projected", async () => {
    const harness = dispatchHarness();
    harness.state.records.push(finalPending());

    await expect(harness.dispatch.offerNextMandatoryReview("parent-1")).resolves.toEqual({
      kind: "none",
    });
    expect(projectReviewDispatchSlots(harness.state.records)).toMatchObject([
      { state: "terminal", terminalReason: "cancelled" },
    ]);
  });

  it("does not offer a final review for an inactive authorization", async () => {
    const harness = dispatchHarness();
    seedFinalReviewPending(harness.state.records);
    harness.state.authorizations = [
      { ...activeAuthorization(), status: "released", releasedAt: "2026-09-20T00:01:00.000Z" },
    ];

    await expect(harness.dispatch.offerNextMandatoryReview("parent-1")).resolves.toEqual({
      kind: "none",
    });
  });

  it("cancels pending slots when the second authorization read fails", async () => {
    const harness = dispatchHarness();
    harness.state.readAuthorizationsFailureAfter = 1;
    seedReviewPending(harness.state.records);
    harness.state.records.push(pending(6));

    await expect(harness.dispatch.offerNextMandatoryReview("parent-1")).resolves.toEqual({
      kind: "blocked",
    });
    expect(harness.state.advisories).toContain("review_authorization_unreadable");
    expect(projectReviewDispatchSlots(harness.state.records)).toMatchObject([
      { state: "terminal", terminalReason: "cancelled" },
    ]);
  });

  it("keeps authorization failures fail-open when advisory recording fails", async () => {
    const harness = dispatchHarness();
    harness.state.readAuthorizationsFailure = true;
    harness.state.advisoryFailure = true;
    seedReviewPending(harness.state.records);

    await expect(harness.dispatch.offerNextMandatoryReview("parent-1")).resolves.toEqual({
      kind: "blocked",
    });
    expect(projectReviewDispatchSlots(harness.state.records)).toEqual([]);
  });

  it("blocks offer and claim when multiple active slots exist", async () => {
    const harness = dispatchHarness();
    seedReviewPending(harness.state.records);
    seedFinalReviewPending(harness.state.records, 6);
    harness.state.records.push(pending(8), finalPending(9));

    await expect(harness.dispatch.offerNextMandatoryReview("parent-1")).resolves.toEqual({
      kind: "blocked",
    });
    await expect(harness.dispatch.claimReviewDispatch(claimInput())).resolves.toEqual({
      kind: "blocked",
      advisory: "review_dispatch_integrity_violation",
    });
    expect(harness.state.advisories).toContain("review_dispatch_integrity_violation");
  });

  it("blocks an offer when its authorization becomes terminal", async () => {
    const harness = dispatchHarness();
    harness.state.lookupAuthorization = null;
    seedReviewPending(harness.state.records);

    await expect(harness.dispatch.offerNextMandatoryReview("parent-1")).resolves.toEqual({
      kind: "blocked",
    });
  });

  it("cancels an offer when authorization changes during the append", async () => {
    const harness = dispatchHarness();
    harness.state.lookupSequence = [activeAuthorization(), null];
    seedReviewPending(harness.state.records);

    await expect(harness.dispatch.offerNextMandatoryReview("parent-1")).resolves.toEqual({
      kind: "blocked",
    });
    expect(projectReviewDispatchSlots(harness.state.records)).toMatchObject([
      { state: "terminal", terminalReason: "cancelled" },
    ]);
  });

  it("blocks claims when authorization hydration fails", async () => {
    const harness = dispatchHarness();
    harness.state.readAuthorizationsFailure = true;

    await expect(harness.dispatch.claimReviewDispatch(claimInput())).resolves.toEqual({
      kind: "blocked",
      advisory: "review_authorization_unreadable",
    });
  });

  it("blocks claim commits and terminal authorizations", async () => {
    const failed = dispatchHarness();
    seedReviewPending(failed.state.records);
    await failed.dispatch.offerNextMandatoryReview("parent-1");
    failed.state.appendKind = "failed";

    await expect(failed.dispatch.claimReviewDispatch(claimInput())).resolves.toEqual({
      kind: "blocked",
      advisory: "review_claim_commit_failed",
    });
    expect(failed.state.cleanupCalls).toEqual([usableReservation]);

    const terminal = dispatchHarness();
    seedReviewPending(terminal.state.records);
    await terminal.dispatch.offerNextMandatoryReview("parent-1");
    terminal.state.lookupAuthorization = null;

    await expect(terminal.dispatch.claimReviewDispatch(claimInput())).resolves.toEqual({
      kind: "blocked",
      advisory: "review_authorization_terminal",
    });
    expect(projectReviewDispatchSlots(terminal.state.records)).toMatchObject([
      { state: "terminal", terminalReason: "cancelled" },
    ]);
  });

  it("cancels terminalization and recovery for inactive authorizations", async () => {
    const terminal = dispatchHarness();
    terminal.state.records.push(pending(), claimed());
    terminal.state.lookupAuthorization = null;

    await expect(
      terminal.dispatch.terminalizeReviewFailure({ ...claimInput(), correlation }, "lost_conclusive"),
    ).resolves.toEqual({ kind: "blocked" });
    expect(projectReviewDispatchSlots(terminal.state.records)).toMatchObject([
      { state: "terminal", terminalReason: "cancelled" },
    ]);

    const recovery = dispatchHarness();
    recovery.state.records.push(pending());
    recovery.state.lookupAuthorization = null;

    await expect(recovery.dispatch.recoverReviewDispatchesAfterRestart()).resolves.toBeUndefined();
    expect(projectReviewDispatchSlots(recovery.state.records)).toMatchObject([
      { state: "terminal", terminalReason: "cancelled" },
    ]);
  });

  it("validates queued directives and recovers pending and unusable claimed slots", async () => {
    const harness = dispatchHarness();
    seedReviewPending(harness.state.records);
    await harness.dispatch.offerNextMandatoryReview("parent-1");
    const delivery: ReviewDirectiveDelivery = {
      parentSessionId: "parent-1",
      directive: { kind: "review_required", correlation },
    };

    await expect(
      harness.dispatch.validateQueuedReviewDirectiveWithinParentSessionClaim(delivery),
    ).resolves.toBe("inject");
    harness.state.records = [];
    await expect(
      harness.dispatch.validateQueuedReviewDirectiveWithinParentSessionClaim(delivery),
    ).resolves.toBe("discard");
    harness.state.readRecordsFailure = true;
    await expect(
      harness.dispatch.validateQueuedReviewDirectiveWithinParentSessionClaim(delivery),
    ).resolves.toBe("retain");
    expect(harness.state.advisories).toContain("review_directive_delivery_unreadable");

    harness.state.readRecordsFailure = false;
    seedReviewPending(harness.state.records);
    await harness.dispatch.offerNextMandatoryReview("parent-1");
    await expect(harness.dispatch.recoverReviewDispatchesAfterRestart()).resolves.toBeUndefined();
    expect(harness.state.directives.at(-1)?.directive.correlation).toEqual(correlation);
  });

  it("recovers an unusable claimed slot and records unreadable authorization failures", async () => {
    const harness = dispatchHarness();
    harness.state.records.push(pending(), claimedUnusable());
    await expect(harness.dispatch.recoverReviewDispatchesAfterRestart()).resolves.toBeUndefined();
    expect(projectReviewDispatchSlots(harness.state.records)).toMatchObject([
      { state: "terminal", terminalReason: "artifact_reservation_unusable" },
    ]);

    const unreadable = dispatchHarness();
    seedReviewPending(unreadable.state.records);
    unreadable.state.readAuthorizationsFailure = true;
    await expect(unreadable.dispatch.offerNextMandatoryReview("parent-1")).resolves.toEqual({
      kind: "blocked",
    });
    expect(unreadable.state.advisories).toContain("review_authorization_unreadable");
  });

  it("leaves terminal and usable claimed slots unchanged during recovery", async () => {
    const terminalized = dispatchHarness();
    terminalized.state.records.push(pending(), claimed(), terminal("call-1"));

    await terminalized.dispatch.recoverReviewDispatchesAfterRestart();

    expect(terminalized.state.records).toHaveLength(3);
    expect(projectReviewDispatchSlots(terminalized.state.records)).toMatchObject([
      { state: "terminal", terminalReason: "review_execution_failed" },
    ]);

    const usable = dispatchHarness();
    usable.state.records.push(pending(), claimed());

    await usable.dispatch.recoverReviewDispatchesAfterRestart();

    expect(usable.state.records).toHaveLength(2);
    expect(projectReviewDispatchSlots(usable.state.records)).toMatchObject([
      { state: "claimed", callId: "call-1", artifactReservation: usableReservation },
    ]);
  });
});
