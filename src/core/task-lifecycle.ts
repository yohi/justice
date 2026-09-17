import { randomUUID } from "node:crypto";
import type {
  FinalizationAttemptId,
  ObservationAgentId,
  TaskExecutionRef,
  ReviewPendingCommittedHandler,
} from "./types";
import type {
  LifecycleObservationRecord,
  PlanFinalizationState,
  PendingObservationRecord,
  TaskProgressState,
} from "./v2/observation-model";

export type TransitionOutcome<S extends string> = {
  readonly kind: "applied" | "duplicate" | "invalid";
  readonly state: S;
  readonly advisory?: string;
};

export type TaskLifecycleTransition = {
  readonly identity: string;
  readonly from: TaskProgressState;
  readonly to: TaskProgressState;
};

export type TransitionState<S extends string> = {
  readonly value: S;
  readonly lastTransitionIdentity?: string;
};

const TASK_TRANSITIONS: ReadonlyMap<TaskProgressState, ReadonlySet<TaskProgressState>> = new Map([
  ["pending", new Set(["authorized"])],
  ["authorized", new Set(["in_progress"])],
  ["in_progress", new Set(["worker_reported"])],
  ["worker_reported", new Set(["evidence_pending"])],
  ["evidence_pending", new Set(["review_pending"])],
  ["review_pending", new Set(["gate_pending", "rework_required"])],
  ["gate_pending", new Set(["accepted", "rework_required"])],
  ["accepted", new Set()],
  ["rework_required", new Set(["in_progress"])],
]);

const FINALIZATION_TRANSITIONS: ReadonlyMap<
  PlanFinalizationState,
  ReadonlySet<PlanFinalizationState>
> = new Map([
  ["tasks_pending", new Set(["all_tasks_accepted"])],
  ["all_tasks_accepted", new Set(["final_review_pending"])],
  ["final_review_pending", new Set(["final_gate_pending", "final_rework_required"])],
  ["final_gate_pending", new Set(["complete", "final_rework_required"])],
  ["complete", new Set()],
  ["final_rework_required", new Set(["final_review_pending"])],
]);

export function applyTaskTransition(
  state: TaskProgressState | TransitionState<TaskProgressState>,
  event: TaskLifecycleTransition,
): TransitionOutcome<TaskProgressState> {
  const current = typeof state === "string" ? state : state.value;
  const previousIdentity = typeof state === "string" ? undefined : state.lastTransitionIdentity;
  if (previousIdentity === event.identity && event.to === current) {
    return { kind: "duplicate", state: current };
  }
  if (
    previousIdentity !== undefined &&
    previousIdentity !== event.identity &&
    !(current === "rework_required" && event.to === "in_progress")
  ) {
    return { kind: "invalid", state: current, advisory: `stale identity ${event.identity}` };
  }
  if (event.to === current) return { kind: "duplicate", state: current };
  if (event.from !== current) {
    return {
      kind: "invalid",
      state: current,
      advisory: `${event.from} -> ${event.to} does not start at ${current}`,
    };
  }
  if (!TASK_TRANSITIONS.get(current)?.has(event.to)) {
    return { kind: "invalid", state: current, advisory: `${current} -> ${event.to} is not allowed` };
  }
  return { kind: "applied", state: event.to };
}

export type PlanFinalizationTransition = {
  readonly identity: string;
  readonly from: PlanFinalizationState;
  readonly to: PlanFinalizationState;
};

export function applyPlanTransition(
  state: PlanFinalizationState | TransitionState<PlanFinalizationState>,
  event: PlanFinalizationTransition,
): TransitionOutcome<PlanFinalizationState> {
  const current = typeof state === "string" ? state : state.value;
  const previousIdentity = typeof state === "string" ? undefined : state.lastTransitionIdentity;
  if (previousIdentity === event.identity && event.to === current) {
    return { kind: "duplicate", state: current };
  }
  if (
    previousIdentity !== undefined &&
    previousIdentity !== event.identity &&
    !(current === "final_rework_required" && event.to === "final_review_pending")
  ) {
    return { kind: "invalid", state: current, advisory: `stale identity ${event.identity}` };
  }
  if (event.to === current) return { kind: "duplicate", state: current };
  if (event.from !== current) {
    return {
      kind: "invalid",
      state: current,
      advisory: `${event.from} -> ${event.to} does not start at ${current}`,
    };
  }
  if (!FINALIZATION_TRANSITIONS.get(current)?.has(event.to)) {
    return { kind: "invalid", state: current, advisory: `${current} -> ${event.to} is not allowed` };
  }
  return { kind: "applied", state: event.to };
}

export type FinalizationContext = {
  readonly parentSessionId: string;
  readonly authorizationId: string;
  readonly planPath: string;
  readonly finalizationAttemptId: FinalizationAttemptId;
  readonly finalReviewRound: number;
  readonly state: PlanFinalizationState;
};

export function startNextFinalizationAttempt(
  current: FinalizationContext,
): FinalizationContext & { readonly from: "final_rework_required"; readonly to: "final_review_pending" };
export function startNextFinalizationAttempt(
  current: FinalizationContext,
  appendRecord: LifecycleRecordAppender,
  dependencies: LifecycleNotificationDependencies,
): Promise<
  | (FinalizationContext & { readonly from: "final_rework_required"; readonly to: "final_review_pending" })
  | { readonly kind: "failed" }
>;
export function startNextFinalizationAttempt(
  current: FinalizationContext,
  appendRecord?: LifecycleRecordAppender,
  dependencies?: LifecycleNotificationDependencies,
):
  | (FinalizationContext & { readonly from: "final_rework_required"; readonly to: "final_review_pending" })
  | Promise<
      | (FinalizationContext & { readonly from: "final_rework_required"; readonly to: "final_review_pending" })
      | { readonly kind: "failed" }
    > {
  const next = {
    ...current,
    finalizationAttemptId: randomUUID(),
    finalReviewRound: current.finalReviewRound + 1,
    state: "final_review_pending" as const,
    from: "final_rework_required" as const,
    to: "final_review_pending" as const,
  };
  if (appendRecord === undefined) return next;
  return appendReviewPendingAndNotify(
    current.parentSessionId,
    () =>
      appendPlanFinalizationTransition(
        {
          parentSessionId: current.parentSessionId,
          authorizationId: current.authorizationId,
          planPath: current.planPath,
          finalizationAttemptId: next.finalizationAttemptId,
          finalReviewRound: next.finalReviewRound,
          from: "final_rework_required",
          to: "final_review_pending",
          reason: "finalization_rework",
        },
        appendRecord,
      ),
    dependencies ?? {},
  ).then((result) => (result.kind === "committed" ? next : { kind: "failed" }));
}

export type LifecycleNotificationDependencies = {
  readonly onReviewPendingCommitted?: ReviewPendingCommittedHandler;
  readonly recordAdvisory?: (advisory: string, cause?: unknown) => Promise<void>;
};

export async function notifyReviewPendingCommitted(
  parentSessionId: string,
  dependencies: LifecycleNotificationDependencies,
): Promise<void> {
  if (dependencies.onReviewPendingCommitted === undefined) return;
  try {
    await dependencies.onReviewPendingCommitted(parentSessionId);
  } catch (cause: unknown) {
    try {
      await dependencies.recordAdvisory?.("review_pending_offer_failed", cause);
    } catch (cause: unknown) {
      void cause;
    }
  }
}

export type LifecycleAppendResult =
  | { readonly kind: "committed" }
  | { readonly kind: "failed" }
  | { readonly kind: "duplicate" }
  | { readonly kind: "invalid"; readonly advisory: string };

export type LifecycleRecordAppender = (
  record: PendingObservationRecord & LifecycleObservationRecord,
) => Promise<number>;

type TaskLifecycleTransitionInputBase = {
  readonly agentId?: ObservationAgentId;
  readonly sessionId?: string;
  readonly writerId?: string;
  readonly parentSessionId: string;
  readonly taskExecutionRef: TaskExecutionRef;
  readonly reason?: string;
};

export type TaskLifecycleTransitionInput =
  | (TaskLifecycleTransitionInputBase & { readonly from: "pending"; readonly to: "authorized" })
  | (TaskLifecycleTransitionInputBase & { readonly from: "authorized"; readonly to: "in_progress" })
  | (TaskLifecycleTransitionInputBase & { readonly from: "in_progress"; readonly to: "worker_reported" })
  | (TaskLifecycleTransitionInputBase & { readonly from: "worker_reported"; readonly to: "evidence_pending" })
  | (TaskLifecycleTransitionInputBase & { readonly from: "evidence_pending"; readonly to: "review_pending" })
  | (TaskLifecycleTransitionInputBase & { readonly from: "review_pending"; readonly to: "gate_pending" | "rework_required" })
  | (TaskLifecycleTransitionInputBase & { readonly from: "gate_pending"; readonly to: "accepted" | "rework_required" })
  | (TaskLifecycleTransitionInputBase & { readonly from: "rework_required"; readonly to: "in_progress" });

export async function appendTaskLifecycleTransition(
  input: TaskLifecycleTransitionInput,
  appendRecord: LifecycleRecordAppender,
): Promise<{ readonly kind: "committed" | "failed" }> {
  try {
    await appendRecord({
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      agentId: input.agentId ?? "system",
      sessionId: input.sessionId ?? input.parentSessionId,
      writerId: input.writerId ?? "w-lifecycle",
      taskId: input.taskExecutionRef.taskId,
      recordType: "observation",
      kind: "task_lifecycle_transition",
      parentSessionId: input.parentSessionId,
      taskExecutionRef: input.taskExecutionRef,
      from: input.from,
      to: input.to,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
    });
    return { kind: "committed" };
  } catch {
    return { kind: "failed" };
  }
}

type PlanFinalizationTransitionInputBase = {
  readonly agentId?: ObservationAgentId;
  readonly sessionId?: string;
  readonly writerId?: string;
  readonly parentSessionId: string;
  readonly authorizationId: string;
  readonly planPath: string;
  readonly finalizationAttemptId: FinalizationAttemptId;
  readonly reason?: string;
};

export type PlanFinalizationTransitionInput =
  | (PlanFinalizationTransitionInputBase & {
      readonly finalReviewRound: 1;
      readonly from: "tasks_pending";
      readonly to: "all_tasks_accepted";
    })
  | (PlanFinalizationTransitionInputBase & {
      readonly finalReviewRound: 1;
      readonly from: "all_tasks_accepted";
      readonly to: "final_review_pending";
    })
  | (PlanFinalizationTransitionInputBase & {
      readonly finalReviewRound: number;
      readonly from: "final_review_pending";
      readonly to: "final_gate_pending" | "final_rework_required";
    })
  | (PlanFinalizationTransitionInputBase & {
      readonly finalReviewRound: number;
      readonly from: "final_gate_pending";
      readonly to: "complete" | "final_rework_required";
    })
  | (PlanFinalizationTransitionInputBase & {
      readonly finalReviewRound: number;
      readonly from: "final_rework_required";
      readonly to: "final_review_pending";
    });

export async function appendPlanFinalizationTransition(
  input: PlanFinalizationTransitionInput,
  appendRecord: LifecycleRecordAppender,
): Promise<{ readonly kind: "committed" | "failed" }> {
  try {
    await appendRecord({
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      agentId: input.agentId ?? "system",
      sessionId: input.sessionId ?? input.parentSessionId,
      writerId: input.writerId ?? "w-lifecycle",
      recordType: "observation",
      kind: "plan_finalization_transition",
      parentSessionId: input.parentSessionId,
      authorizationId: input.authorizationId,
      planPath: input.planPath,
      finalizationAttemptId: input.finalizationAttemptId,
      finalReviewRound: input.finalReviewRound,
      from: input.from,
      to: input.to,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
    });
    return { kind: "committed" };
  } catch {
    return { kind: "failed" };
  }
}

export type FinalizationAdvanceInput = {
  readonly parentSessionId: string;
  readonly authorizationId: string;
  readonly planPath: string;
  readonly finalizationAttemptId?: FinalizationAttemptId;
};

export type FinalizationAdvanceResult =
  | {
      readonly kind: "committed";
      readonly finalizationAttemptId: FinalizationAttemptId;
      readonly finalReviewRound: 1;
    }
  | { readonly kind: "failed" };

export async function advanceFinalizationAfterAllTasksAccepted(
  input: FinalizationAdvanceInput,
  appendRecord: LifecycleRecordAppender,
  dependencies: LifecycleNotificationDependencies,
): Promise<FinalizationAdvanceResult> {
  const finalizationAttemptId = input.finalizationAttemptId ?? randomUUID();
  if (input.finalizationAttemptId === undefined) {
    const initial = await appendPlanFinalizationTransition(
      {
        ...input,
        finalizationAttemptId,
        finalReviewRound: 1,
        from: "tasks_pending",
        to: "all_tasks_accepted",
        reason: "all_tasks_accepted",
      },
      appendRecord,
    );
    if (initial.kind !== "committed") return { kind: "failed" };
  }

  const reviewPending = await appendReviewPendingAndNotify(
    input.parentSessionId,
    () =>
      appendPlanFinalizationTransition(
        {
          ...input,
          finalizationAttemptId,
          finalReviewRound: 1,
          from: "all_tasks_accepted",
          to: "final_review_pending",
          reason: "final_review_requested",
        },
        appendRecord,
      ),
    dependencies,
  );
  return reviewPending.kind === "committed"
    ? { kind: "committed", finalizationAttemptId, finalReviewRound: 1 }
    : { kind: "failed" };
}

export type LifecycleTransitionAppender = (
  transition: TaskLifecycleTransition,
) => Promise<LifecycleAppendResult>;

export async function recordWorkerReportedAndEvidence(input: {
  readonly parentSessionId: string;
  readonly taskExecutionRef: TaskExecutionRef;
  readonly appendRecord: LifecycleRecordAppender;
}): Promise<LifecycleAppendResult> {
  const workerReported = await appendTaskLifecycleTransition(
    {
      parentSessionId: input.parentSessionId,
      taskExecutionRef: input.taskExecutionRef,
      from: "in_progress",
      to: "worker_reported",
      reason: "worker_output_recorded",
    },
    input.appendRecord,
  );
  if (workerReported.kind !== "committed") return workerReported;
  const evidencePending = await appendTaskLifecycleTransition(
    {
      parentSessionId: input.parentSessionId,
      taskExecutionRef: input.taskExecutionRef,
      from: "worker_reported",
      to: "evidence_pending",
      reason: "worker_evidence_recorded",
    },
    input.appendRecord,
  );
  return evidencePending.kind === "committed"
    ? { kind: "committed" }
    : evidencePending;
}

export async function requestCurrentTaskReview(input: {
  readonly parentSessionId: string;
  readonly taskExecutionRef: TaskExecutionRef;
  readonly appendRecord: LifecycleRecordAppender;
  readonly dependencies?: LifecycleNotificationDependencies;
}): Promise<LifecycleAppendResult> {
  return appendReviewPendingAndNotify(
    input.parentSessionId,
    () => appendTaskLifecycleTransition(
      {
        parentSessionId: input.parentSessionId,
        taskExecutionRef: input.taskExecutionRef,
        from: "evidence_pending",
        to: "review_pending",
        reason: "worker_evidence_recorded",
      },
      input.appendRecord,
    ).then((result) => result),
    input.dependencies ?? {},
  );
}

export async function appendReviewPendingAndNotify(
  parentSessionId: string,
  append: () => Promise<LifecycleAppendResult>,
  dependencies: LifecycleNotificationDependencies,
): Promise<LifecycleAppendResult> {
  const result = await append();
  if (result.kind === "committed") await notifyReviewPendingCommitted(parentSessionId, dependencies);
  return result;
}

export type ImplementationAttempt = {
  readonly taskExecutionRef: TaskExecutionRef;
  readonly reviewRound: 1;
};

export function startImplementationAttempt(input: {
  readonly authorizationId: string;
  readonly taskId: string;
  readonly state: TaskProgressState;
}): ImplementationAttempt {
  if (input.state !== "rework_required" && input.state !== "authorized") {
    throw new Error(`cannot start implementation from ${input.state}`);
  }
  return {
    taskExecutionRef: {
      authorizationId: input.authorizationId,
      taskId: input.taskId,
      attemptId: randomUUID(),
    },
    reviewRound: 1,
  };
}
