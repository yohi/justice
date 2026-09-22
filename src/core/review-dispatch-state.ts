import {
  authorizationIdFor,
  isCurrentActiveAuthorization,
  sameReviewCorrelation,
  type GateEvaluationDependencies,
} from "./acceptance-decision";
import type { ApprovedPlanBinding, AuthorizationReviewBoundary } from "./plan-authorization";
import type {
  ObservationAgentId,
  ReviewArtifactReservation,
  ReviewCorrelation,
  ReviewRequiredDirective,
  ReviewTaskCallBinding,
  TaskCallBinding,
} from "./types";
import { orderEventsForProjection } from "./v2/integrity";
import type {
  PendingReviewDispatchTransitionRecord,
  PlanFinalizationTransitionRecord,
  PersistedEnvelope,
  PersistedLogRecord,
  ReviewDispatchTransitionRecord,
  TaskLifecycleTransitionRecord,
} from "./v2/observation-model";
import { project, taskLifecycleKey, type ProjectedState } from "./v2/state-projection";

export type ReviewDispatchSlotKey = {
  readonly parentSessionId: string;
  readonly correlation: ReviewCorrelation;
};
export type ReviewDispatchSlot = {
  readonly key: ReviewDispatchSlotKey;
  readonly expectedCategory: "sp-review" | "sp-final-review";
  readonly state: "pending" | "claimed" | "terminal";
  readonly callId?: string;
  readonly artifactReservation?: ReviewArtifactReservation;
  readonly terminalReason?: string;
  readonly agentId: ObservationAgentId;
  readonly sessionId: string;
  readonly writerId: string;
};
export type ReviewDirectiveDelivery = {
  readonly parentSessionId: string;
  readonly directive: ReviewRequiredDirective;
};
export type ReviewDirectiveSink = {
  readonly deliver: (delivery: ReviewDirectiveDelivery) => Promise<void>;
  readonly drainForParentSession: (
    parentSessionId: string,
    decide: (delivery: ReviewDirectiveDelivery) => Promise<"inject" | "discard" | "retain">,
  ) => Promise<readonly ReviewDirectiveDelivery[]>;
};
export type ClaimInput = {
  readonly parentSessionId: string;
  readonly callId: string;
  readonly expectedCategory: "sp-review" | "sp-final-review";
  readonly agentId: ObservationAgentId;
  readonly sessionId: string;
  readonly writerId: string;
};
export type ClaimedReviewDispatch = ClaimInput & { readonly correlation: ReviewCorrelation };
export type ClaimReviewDispatchOutcome =
  | { readonly kind: "claimed"; readonly taskCallBinding: ReviewTaskCallBinding }
  | {
      readonly kind: "claimed_unusable";
      readonly taskCallBinding: ReviewTaskCallBinding;
      readonly artifactPathOmitted: true;
      readonly advisory: "artifact_reservation_unusable";
    }
  | { readonly kind: "blocked"; readonly advisory: string };
export type ReviewOfferOutcome =
  | { readonly kind: "offered"; readonly correlation: ReviewCorrelation }
  | { readonly kind: "deferred" | "blocked" | "none" };
export type ReviewFailureOutcome =
  | { readonly kind: "retried"; readonly correlation: ReviewCorrelation }
  | { readonly kind: "blocked" };

export type ReviewDispatchDependencies = {
  readonly readDurableRecords: () => Promise<readonly PersistedLogRecord[]>;
  readonly readDurableAuthorizations: () => Promise<readonly ApprovedPlanBinding[]>;
  readonly findAuthorizationById: GateEvaluationDependencies["findAuthorizationById"];
  readonly appendReviewDispatchTransition: (
    input: PendingReviewDispatchTransitionRecord,
  ) => Promise<
    | { readonly kind: "committed"; readonly record: ReviewDispatchTransitionRecord }
    | { readonly kind: "failed" }
  >;
  readonly reserveReviewArtifact: () => Promise<ReviewArtifactReservation>;
  readonly cleanupReviewArtifactReservation: (
    reservation: Extract<ReviewArtifactReservation, { readonly status: "usable" }>,
  ) => Promise<void>;
  readonly injectReviewRequiredDirective: (delivery: ReviewDirectiveDelivery) => Promise<void>;
  readonly withAuthorizationReviewBoundary: AuthorizationReviewBoundary["withParentSession"];
  readonly hydrateAuthorizationsBeforeReviewRecovery: () => Promise<unknown>;
  readonly recordAdvisory: (advisory: string, cause?: unknown) => Promise<void>;
  readonly generateId: () => string;
  readonly now?: () => string;
};

export function createReviewDirectiveSink(): ReviewDirectiveSink {
  const queued = new Map<string, ReviewDirectiveDelivery[]>();
  const restore = (parentSessionId: string, deliveries: readonly ReviewDirectiveDelivery[]): void => {
    const existing = queued.get(parentSessionId) ?? [];
    const restored = [...deliveries, ...existing].filter(
      (delivery, index, all) =>
        all.findIndex((candidate) =>
          sameReviewCorrelation(candidate.directive.correlation, delivery.directive.correlation),
        ) === index,
    );
    if (restored.length > 0) queued.set(parentSessionId, restored);
  };
  return {
    async deliver(delivery) {
      restore(delivery.parentSessionId, [delivery]);
    },
    async drainForParentSession(parentSessionId, decide) {
      const deliveries = queued.get(parentSessionId) ?? [];
      queued.delete(parentSessionId);
      const inject: ReviewDirectiveDelivery[] = [];
      const retain: ReviewDirectiveDelivery[] = [];
      try {
        for (const delivery of deliveries) {
          const decision = await decide(delivery);
          if (decision === "inject") inject.push(delivery);
          else if (decision === "retain") retain.push(delivery);
        }
      } catch (cause) {
        restore(parentSessionId, deliveries);
        throw cause;
      }
      restore(parentSessionId, retain);
      return inject;
    },
  };
}

type PersistedTaskLifecycleTransition = PersistedEnvelope &
  { readonly recordType: "observation" } & TaskLifecycleTransitionRecord;
type PersistedPlanFinalizationTransition = PersistedEnvelope &
  { readonly recordType: "observation" } & PlanFinalizationTransitionRecord;

function isReviewDispatchTransition(
  record: PersistedLogRecord,
): record is ReviewDispatchTransitionRecord {
  return (
    record.recordType === "observation" &&
    "kind" in record &&
    record.kind === "review_dispatch_transition"
  );
}

function isTaskLifecycleTransition(
  record: PersistedLogRecord,
): record is PersistedTaskLifecycleTransition {
  return (
    record.recordType === "observation" &&
    "kind" in record &&
    record.kind === "task_lifecycle_transition"
  );
}

function isPlanFinalizationTransition(
  record: PersistedLogRecord,
): record is PersistedPlanFinalizationTransition {
  return (
    record.recordType === "observation" &&
    "kind" in record &&
    record.kind === "plan_finalization_transition"
  );
}

export function projectReviewDispatchSlots(
  records: readonly PersistedLogRecord[],
): readonly ReviewDispatchSlot[] {
  return project(records, "").reviewDispatchSlots;
}

export function projectTaskCallBindings(records: readonly PersistedLogRecord[]): readonly TaskCallBinding[] {
  return project(records, "").taskCallBindings;
}

function activeBinding(
  correlation: ReviewCorrelation,
  authorizations: readonly ApprovedPlanBinding[],
  parentSessionId: string,
): Extract<ApprovedPlanBinding, { readonly status: "active" }> | undefined {
  const binding = authorizations.find(
    (candidate) => candidate.authorizationId === authorizationIdFor(correlation),
  );
  if (binding?.status !== "active") return undefined;
  if (binding.sessionId !== parentSessionId) return undefined;
  if (correlation.reviewKind === "task-review") {
    return binding.canonicalSnapshot.tasks.some(
      (task) => task.taskId === correlation.taskExecutionRef.taskId,
    )
      ? binding
      : undefined;
  }
  return binding.planPath === correlation.planPath &&
    binding.planFingerprint.algorithm === correlation.planFingerprint.algorithm &&
    binding.planFingerprint.value === correlation.planFingerprint.value
    ? binding
    : undefined;
}

function sameTaskExecutionRef(
  left: Extract<ReviewCorrelation, { readonly reviewKind: "task-review" }>["taskExecutionRef"],
  right: Extract<ReviewCorrelation, { readonly reviewKind: "task-review" }>["taskExecutionRef"],
): boolean {
  return (
    left.authorizationId === right.authorizationId &&
    left.taskId === right.taskId &&
    left.attemptId === right.attemptId
  );
}

function retryableSlot(slot: ReviewDispatchSlot): boolean {
  return (
    slot.state === "terminal" &&
    (slot.terminalReason === "review_execution_failed" || slot.terminalReason === "lost_conclusive")
  );
}

function currentTaskReviewCorrelation(
  parentSessionId: string,
  state: ProjectedState,
  taskExecutionRef: Extract<ReviewCorrelation, { readonly reviewKind: "task-review" }>["taskExecutionRef"],
): Extract<ReviewCorrelation, { readonly reviewKind: "task-review" }> | undefined {
  const key = taskLifecycleKey(parentSessionId, taskExecutionRef);
  const current = state.lifecycle.currentTaskExecutionRefs.get(key);
  if (state.lifecycle.taskStates.get(key) !== "review_pending" || current === undefined) return undefined;
  if (!sameTaskExecutionRef(current, taskExecutionRef)) return undefined;
  const reviewRound = state.reviewDispatchSlots.reduce((round, slot) => {
    if (slot.key.parentSessionId !== parentSessionId || slot.key.correlation.reviewKind !== "task-review") {
      return round;
    }
    if (!sameTaskExecutionRef(slot.key.correlation.taskExecutionRef, taskExecutionRef)) return round;
    return Math.max(round, slot.key.correlation.reviewRound + (retryableSlot(slot) ? 1 : 0));
  }, 1);
  return { reviewKind: "task-review", taskExecutionRef, reviewRound };
}

function currentFinalReviewCorrelation(
  parentSessionId: string,
  state: ProjectedState,
  binding: Extract<ApprovedPlanBinding, { readonly status: "active" }>,
): Extract<ReviewCorrelation, { readonly reviewKind: "final-review" }> | undefined {
  const finalization = [...state.lifecycle.finalization.values()].find(
    (value) =>
      value.parentSessionId === parentSessionId &&
      value.authorizationId === binding.authorizationId &&
      value.planPath === binding.planPath &&
      value.state === "final_review_pending",
  );
  if (finalization === undefined) return undefined;
  const finalReviewRound = state.reviewDispatchSlots.reduce((round, slot) => {
    if (slot.key.parentSessionId !== parentSessionId || slot.key.correlation.reviewKind !== "final-review") {
      return round;
    }
    const correlation = slot.key.correlation;
    if (
      correlation.authorizationId !== finalization.authorizationId ||
      correlation.planPath !== finalization.planPath ||
      correlation.finalizationAttemptId !== finalization.finalizationAttemptId ||
      correlation.planFingerprint.algorithm !== binding.planFingerprint.algorithm ||
      correlation.planFingerprint.value !== binding.planFingerprint.value
    ) {
      return round;
    }
    return Math.max(round, correlation.finalReviewRound + (retryableSlot(slot) ? 1 : 0));
  }, finalization.finalReviewRound);
  return {
    reviewKind: "final-review",
    authorizationId: finalization.authorizationId,
    planPath: finalization.planPath,
    planFingerprint: binding.planFingerprint,
    finalizationAttemptId: finalization.finalizationAttemptId,
    finalReviewRound,
  };
}

function currentLifecycleCorrelation(
  parentSessionId: string,
  state: ProjectedState,
  authorizations: readonly ApprovedPlanBinding[],
  correlation: ReviewCorrelation,
): boolean {
  const binding = activeBinding(correlation, authorizations, parentSessionId);
  if (binding === undefined) return false;
  if (correlation.reviewKind === "task-review") {
    const current = currentTaskReviewCorrelation(parentSessionId, state, correlation.taskExecutionRef);
    return current !== undefined && sameReviewCorrelation(current, correlation);
  }
  const current = currentFinalReviewCorrelation(parentSessionId, state, binding);
  return current !== undefined && sameReviewCorrelation(current, correlation);
}

function staleSlotsFor(
  parentSessionId: string,
  state: ProjectedState,
  authorizations: readonly ApprovedPlanBinding[],
): readonly ReviewDispatchSlot[] {
  return state.reviewDispatchSlots.filter(
    (slot) =>
      slot.key.parentSessionId === parentSessionId &&
      (slot.state === "pending" || slot.state === "claimed") &&
      !currentLifecycleCorrelation(parentSessionId, state, authorizations, slot.key.correlation),
  );
}

function nextReviewRetryCorrelation(correlation: ReviewCorrelation): ReviewCorrelation {
  return correlation.reviewKind === "task-review"
    ? { ...correlation, reviewRound: correlation.reviewRound + 1 }
    : { ...correlation, finalReviewRound: correlation.finalReviewRound + 1 };
}

function retryable(record: PersistedLogRecord): record is ReviewDispatchTransitionRecord {
  return (
    isReviewDispatchTransition(record) &&
    record.from === "claimed" &&
    record.to === "terminal" &&
    (record.terminalReason === "review_execution_failed" || record.terminalReason === "lost_conclusive")
  );
}

function candidatesForParent(
  parentSessionId: string,
  records: readonly PersistedLogRecord[],
  authorizations: readonly ApprovedPlanBinding[],
): readonly { readonly correlation: ReviewCorrelation; readonly category: "sp-review" | "sp-final-review"; readonly source: PersistedLogRecord }[] {
  const ordered = orderEventsForProjection(records);
  const state = project(ordered, new Date(0).toISOString());
  const candidates: {
    correlation: ReviewCorrelation;
    category: "sp-review" | "sp-final-review";
    source: PersistedLogRecord;
  }[] = [];
  for (const record of ordered) {
    if (retryable(record) && record.parentSessionId === parentSessionId) {
      const correlation = nextReviewRetryCorrelation(record.correlation);
      if (currentLifecycleCorrelation(parentSessionId, state, authorizations, correlation)) {
        candidates.push({ correlation, category: record.expectedCategory, source: record });
      }
    }
  }
  for (const record of ordered) {
    if (
      isTaskLifecycleTransition(record) &&
      record.parentSessionId === parentSessionId &&
      record.to === "review_pending"
    ) {
      const correlation = currentTaskReviewCorrelation(parentSessionId, state, record.taskExecutionRef);
      if (
        correlation !== undefined &&
        activeBinding(correlation, authorizations, parentSessionId) !== undefined
      ) {
        candidates.push({ correlation, category: "sp-review", source: record });
      }
    } else if (
      isPlanFinalizationTransition(record) &&
      record.parentSessionId === parentSessionId &&
      record.to === "final_review_pending"
    ) {
      const binding = authorizations.find(
        (candidate) =>
          candidate.authorizationId === record.authorizationId &&
          candidate.status === "active" &&
          candidate.sessionId === parentSessionId,
      );
      const correlation =
        binding?.status === "active"
          ? currentFinalReviewCorrelation(parentSessionId, state, binding)
          : undefined;
      if (
        correlation !== undefined &&
        correlation.finalizationAttemptId === record.finalizationAttemptId &&
        correlation.finalReviewRound >= record.finalReviewRound
      ) {
        candidates.push({
          correlation,
          category: "sp-final-review",
          source: record,
        });
      }
    }
  }
  return candidates;
}

export function createReviewDispatchState(dependencies: ReviewDispatchDependencies) {
  const now = dependencies.now ?? (() => new Date().toISOString());
  const envelope = (record: Pick<PersistedEnvelope, "agentId" | "sessionId" | "writerId">) => ({
    agentId: record.agentId,
    sessionId: record.sessionId,
    writerId: record.writerId,
  });
  const recordAdvisorySafely = async (advisory: string, cause?: unknown): Promise<void> => {
    try {
      await dependencies.recordAdvisory(advisory, cause);
    } catch {
      return;
    }
  };
  const appendTerminal = async (
    slot: ReviewDispatchSlot,
    reason: "cancelled" | "artifact_reservation_unusable" | "review_execution_failed" | "lost_conclusive",
  ) => {
    if (slot.state === "terminal") return { kind: "failed" as const };
    return dependencies.appendReviewDispatchTransition({
      schemaVersion: 1,
      timestamp: now(),
      ...envelope(slot),
      recordType: "observation",
      kind: "review_dispatch_transition",
      transitionId: dependencies.generateId(),
      parentSessionId: slot.key.parentSessionId,
      correlation: slot.key.correlation,
      expectedCategory: slot.expectedCategory,
      from: slot.state,
      to: "terminal",
      ...(slot.callId === undefined ? {} : { callId: slot.callId }),
      terminalReason: reason,
    });
  };
  const cancelWithin = async (parentSessionId: string, authorizationId: string): Promise<void> => {
    const slots = projectReviewDispatchSlots(await dependencies.readDurableRecords()).filter(
      (slot) =>
        slot.key.parentSessionId === parentSessionId &&
        authorizationIdFor(slot.key.correlation) === authorizationId &&
        (slot.state === "pending" || slot.state === "claimed"),
    );
    if (slots.length > 1) {
      await recordAdvisorySafely("review_dispatch_integrity_violation");
      return;
    }
    for (const slot of slots) await appendTerminal(slot, "cancelled");
  };
  const unreadable = async (parentSessionId: string, cause: unknown): Promise<void> => {
    try {
      await dependencies.recordAdvisory("review_authorization_unreadable", cause);
    } catch {
      return;
    } finally {
      try {
        const ids = new Set(
          projectReviewDispatchSlots(await dependencies.readDurableRecords())
            .filter(
              (slot) =>
                slot.key.parentSessionId === parentSessionId &&
                (slot.state === "pending" || slot.state === "claimed"),
            )
            .map((slot) => authorizationIdFor(slot.key.correlation)),
        );
        for (const id of ids) await cancelWithin(parentSessionId, id);
      } catch {
        // best-effort cancellation convergence; ignore failures
      }
    }
  };
  const offerWithin = async (parentSessionId: string): Promise<ReviewOfferOutcome> => {
    let authorizations: readonly ApprovedPlanBinding[];
    try {
      authorizations = await dependencies.readDurableAuthorizations();
    } catch (cause) {
      await unreadable(parentSessionId, cause);
      return { kind: "blocked" };
    }
    const records = await dependencies.readDurableRecords();
    const state = project(records, new Date(0).toISOString());
    for (const slot of staleSlotsFor(parentSessionId, state, authorizations)) {
      await appendTerminal(slot, "cancelled");
    }
    const latestRecords = await dependencies.readDurableRecords();
    let latestAuthorizations: readonly ApprovedPlanBinding[];
    try {
      latestAuthorizations = await dependencies.readDurableAuthorizations();
    } catch (cause) {
      await unreadable(parentSessionId, cause);
      return { kind: "blocked" };
    }
    const latestState = project(latestRecords, new Date(0).toISOString());
    const latestSlots = latestState.reviewDispatchSlots;
    const outstanding = latestSlots.filter(
      (slot) =>
        slot.key.parentSessionId === parentSessionId &&
        (slot.state === "pending" || slot.state === "claimed") &&
        currentLifecycleCorrelation(parentSessionId, latestState, latestAuthorizations, slot.key.correlation),
    );
    if (outstanding.length > 1) {
      await dependencies.recordAdvisory("review_dispatch_integrity_violation");
      return { kind: "blocked" };
    }
    if (outstanding.length === 1) return { kind: "deferred" };
    const candidate = candidatesForParent(parentSessionId, latestRecords, latestAuthorizations).find(
      (item) =>
        !latestSlots.some((slot) =>
          sameReviewCorrelation(slot.key.correlation, item.correlation),
        ),
    );
    if (candidate === undefined) return { kind: "none" };
    if (!(await isCurrentActiveAuthorization(candidate.correlation, dependencies.findAuthorizationById))) {
      return { kind: "blocked" };
    }
    const appended = await dependencies.appendReviewDispatchTransition({
      schemaVersion: 1,
      timestamp: now(),
      ...envelope(candidate.source),
      recordType: "observation",
      kind: "review_dispatch_transition",
      transitionId: dependencies.generateId(),
      parentSessionId,
      correlation: candidate.correlation,
      expectedCategory: candidate.category,
      from: null,
      to: "pending",
    });
    if (appended.kind !== "committed") return { kind: "blocked" };
    if (!(await isCurrentActiveAuthorization(candidate.correlation, dependencies.findAuthorizationById))) {
      await cancelWithin(parentSessionId, authorizationIdFor(candidate.correlation));
      return { kind: "blocked" };
    }
    await dependencies.injectReviewRequiredDirective({
      parentSessionId,
      directive: { kind: "review_required", correlation: candidate.correlation },
    });
    return { kind: "offered", correlation: candidate.correlation };
  };
  const offerNextMandatoryReview = (parentSessionId: string) =>
    dependencies.withAuthorizationReviewBoundary(parentSessionId, () => offerWithin(parentSessionId));
  const claimReviewDispatch = (input: ClaimInput): Promise<ClaimReviewDispatchOutcome> =>
    dependencies.withAuthorizationReviewBoundary(input.parentSessionId, async () => {
      let authorizations: readonly ApprovedPlanBinding[];
      try {
        authorizations = await dependencies.readDurableAuthorizations();
      } catch (cause) {
        await unreadable(input.parentSessionId, cause);
        return { kind: "blocked", advisory: "review_authorization_unreadable" };
      }
      const records = await dependencies.readDurableRecords();
      const projected = project(records, new Date(0).toISOString());
      for (const slot of staleSlotsFor(input.parentSessionId, projected, authorizations)) {
        await appendTerminal(slot, "cancelled");
      }
      const latestRecords = await dependencies.readDurableRecords();
      const latestProjected = project(latestRecords, new Date(0).toISOString());
      const outstanding = latestProjected.reviewDispatchSlots.filter(
        (slot) =>
          slot.key.parentSessionId === input.parentSessionId &&
          (slot.state === "pending" || slot.state === "claimed") &&
          currentLifecycleCorrelation(
            input.parentSessionId,
            latestProjected,
            authorizations,
            slot.key.correlation,
          ),
      );
      if (outstanding.length > 1) {
        await dependencies.recordAdvisory("review_dispatch_integrity_violation");
        return { kind: "blocked", advisory: "review_dispatch_integrity_violation" };
      }
      const pending = outstanding.filter(
        (slot) => slot.state === "pending" && slot.expectedCategory === input.expectedCategory,
      );
      if (pending.length !== 1 || pending[0] === undefined) {
        return { kind: "blocked", advisory: "review_claim_unavailable" };
      }
      const slot = pending[0];
      if (!(await isCurrentActiveAuthorization(slot.key.correlation, dependencies.findAuthorizationById))) {
        await cancelWithin(input.parentSessionId, authorizationIdFor(slot.key.correlation));
        return { kind: "blocked", advisory: "review_authorization_terminal" };
      }
      const reservation = await dependencies.reserveReviewArtifact();
      const claimed = await dependencies.appendReviewDispatchTransition({
        schemaVersion: 1,
        timestamp: now(),
        agentId: input.agentId,
        sessionId: input.sessionId,
        writerId: input.writerId,
        recordType: "observation",
        kind: "review_dispatch_transition",
        transitionId: dependencies.generateId(),
        parentSessionId: input.parentSessionId,
        correlation: slot.key.correlation,
        expectedCategory: input.expectedCategory,
        from: "pending",
        to: "claimed",
        callId: input.callId,
        artifactReservation: reservation,
      });
      if (claimed.kind !== "committed") {
        if (reservation.status === "usable") {
          try {
            await dependencies.cleanupReviewArtifactReservation(reservation);
          } catch (cause) {
            await recordAdvisorySafely("review_artifact_reservation_cleanup_failed", cause);
          }
        }
        return { kind: "blocked", advisory: "review_claim_commit_failed" };
      }
      const binding: ReviewTaskCallBinding = {
        purpose: slot.key.correlation.reviewKind === "task-review" ? "task_review" : "final_review",
        parentSessionId: input.parentSessionId,
        callId: input.callId,
        correlation: slot.key.correlation,
        expectedCategory: input.expectedCategory,
        artifactReservation: reservation,
      };
      if (reservation.status === "unusable") {
        const claimedSlot = projectReviewDispatchSlots(await dependencies.readDurableRecords()).find(
          (candidate) =>
            candidate.state === "claimed" &&
            candidate.callId === input.callId &&
            sameReviewCorrelation(candidate.key.correlation, slot.key.correlation),
        );
        if (claimedSlot !== undefined) await appendTerminal(claimedSlot, "artifact_reservation_unusable");
        return {
          kind: "claimed_unusable",
          taskCallBinding: binding,
          artifactPathOmitted: true,
          advisory: "artifact_reservation_unusable",
        };
      }
      return { kind: "claimed", taskCallBinding: binding };
    });
  const terminalizeReviewFailure = (
    claim: ClaimedReviewDispatch,
    reason: "review_execution_failed" | "lost_conclusive",
  ): Promise<ReviewFailureOutcome> =>
    dependencies.withAuthorizationReviewBoundary(claim.parentSessionId, async () => {
      const slot = projectReviewDispatchSlots(await dependencies.readDurableRecords()).find(
        (candidate) =>
          candidate.state === "claimed" &&
          candidate.key.parentSessionId === claim.parentSessionId &&
          candidate.callId === claim.callId &&
          candidate.expectedCategory === claim.expectedCategory &&
          sameReviewCorrelation(candidate.key.correlation, claim.correlation),
      );
      if (slot === undefined) return { kind: "blocked" };
      if (!(await isCurrentActiveAuthorization(slot.key.correlation, dependencies.findAuthorizationById))) {
        await cancelWithin(claim.parentSessionId, authorizationIdFor(slot.key.correlation));
        return { kind: "blocked" };
      }
      const terminal = await appendTerminal(slot, reason);
      if (terminal.kind !== "committed") return { kind: "blocked" };
      const offered = await offerWithin(claim.parentSessionId);
      return offered.kind === "offered"
        ? { kind: "retried", correlation: offered.correlation }
        : { kind: "blocked" };
    });
  const validateQueuedReviewDirectiveWithinParentSessionClaim = async (
    delivery: ReviewDirectiveDelivery,
  ): Promise<"inject" | "discard" | "retain"> => {
    try {
      const authorizations = await dependencies.readDurableAuthorizations();
      const state = project(await dependencies.readDurableRecords(), new Date(0).toISOString());
      const slots = state.reviewDispatchSlots.filter(
        (slot) =>
          slot.state === "pending" &&
          slot.key.parentSessionId === delivery.parentSessionId &&
          sameReviewCorrelation(slot.key.correlation, delivery.directive.correlation),
      );
      if (slots.length !== 1) return "discard";
      if (
        !currentLifecycleCorrelation(
          delivery.parentSessionId,
          state,
          authorizations,
          delivery.directive.correlation,
        )
      ) {
        return "discard";
      }
      return (await isCurrentActiveAuthorization(
        delivery.directive.correlation,
        dependencies.findAuthorizationById,
      ))
        ? "inject"
        : "discard";
    } catch (cause) {
      await recordAdvisorySafely("review_directive_delivery_unreadable", cause);
      return "retain";
    }
  };
  const recoverReviewDispatchesAfterRestart = async (): Promise<void> => {
    try {
      await dependencies.hydrateAuthorizationsBeforeReviewRecovery();
      const records = await dependencies.readDurableRecords();
      const slots = projectReviewDispatchSlots(records);
      const authorizations = await dependencies.readDurableAuthorizations();
      const state = project(records, new Date(0).toISOString());
      for (const slot of slots) {
        if (slot.state === "pending") {
          await dependencies.withAuthorizationReviewBoundary(slot.key.parentSessionId, async () => {
            const current = currentLifecycleCorrelation(
              slot.key.parentSessionId,
              state,
              authorizations,
              slot.key.correlation,
            );
            const active = await isCurrentActiveAuthorization(
              slot.key.correlation,
              dependencies.findAuthorizationById,
            );
            if (!current || !active) {
              await appendTerminal(slot, "cancelled");
            } else {
              await dependencies.injectReviewRequiredDirective({
                parentSessionId: slot.key.parentSessionId,
                directive: { kind: "review_required", correlation: slot.key.correlation },
              });
            }
          });
        } else if (slot.state === "claimed") {
          await dependencies.withAuthorizationReviewBoundary(slot.key.parentSessionId, async () => {
            const active = await isCurrentActiveAuthorization(
              slot.key.correlation,
              dependencies.findAuthorizationById,
            );
            if (!active) {
              await appendTerminal(slot, "cancelled");
            } else if (slot.artifactReservation?.status === "unusable") {
              await appendTerminal(slot, "artifact_reservation_unusable");
            }
          });
        }
      }
      const latestAuthorizations = await dependencies.readDurableAuthorizations();
      const parents = new Set<string>();
      for (const record of records) {
        if (
          isTaskLifecycleTransition(record) ||
          isPlanFinalizationTransition(record) ||
          isReviewDispatchTransition(record)
        ) {
          parents.add(record.parentSessionId);
        }
      }
      for (const parent of parents) {
        if (candidatesForParent(parent, records, latestAuthorizations).length > 0) {
          await offerNextMandatoryReview(parent);
        }
      }
    } catch (cause) {
      await dependencies.recordAdvisory("review_dispatch_recovery_failed", cause);
    }
  };
  return {
    claimReviewDispatch,
    offerNextMandatoryReview,
    offerNextMandatoryReviewWithinParentSessionClaim: offerWithin,
    withReviewDispatchParentSessionClaim: dependencies.withAuthorizationReviewBoundary,
    terminalizeReviewFailure,
    cancelReviewDispatchesForTerminalAuthorization: (parentSessionId: string, authorizationId: string) =>
      dependencies.withAuthorizationReviewBoundary(parentSessionId, () =>
        cancelWithin(parentSessionId, authorizationId),
      ),
    cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim: cancelWithin,
    validateQueuedReviewDirectiveWithinParentSessionClaim,
    recoverReviewDispatchesAfterRestart,
  };
}
