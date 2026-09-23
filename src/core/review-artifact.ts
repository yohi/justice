import { randomUUID } from "node:crypto";
import {
  authorizationIdFor,
  findCurrentAcceptanceDecision,
  findCurrentGateDecision,
  isCurrentActiveAuthorization,
} from "./acceptance-decision";
import {
  project,
  projectDelegatedExecutionBindings,
  projectObservedReviewExecution,
  taskLifecycleKey,
} from "./v2/state-projection";
import {
  projectReviewDispatchSlots,
  projectTaskCallBindings,
  type ReviewDispatchSlot,
} from "./review-dispatch-state";
import { hashString } from "./v2/hash";
import { orderEventsForProjection } from "./v2/integrity";
import type {
  DelegatedExecutionBinding,
  ObservationAgentId,
  ObservedReviewExecutionV1,
  ReviewArtifactFailureReason,
  ReviewArtifactFindingV1,
  ReviewArtifactV1,
  ReviewArtifactCleanupStatus,
  ReviewArtifactReservation,
  ReviewCompletionStaging,
  ReviewCorrelation,
  ReviewTaskCallBinding,
  ReviewWorkerResultV1,
} from "./types";
import type { GatePendingAttemptContext } from "./v2/gate-context";
import type { TaskLifecycleTransitionInput, PlanFinalizationTransitionInput } from "./task-lifecycle";
import type {
  PendingEnvelope,
  PendingReviewArtifactCleanupRecord,
  PendingReviewArtifactFailureStagingRecord,
  PendingReviewArtifactReadAttemptRecord,
  PendingReviewCompletionStagingRecord,
  PendingReviewDispatchTransitionRecord,
  PendingReviewPostToolUseRecord,
  PersistedLogRecord,
  PersistedReviewCompletionStagingRecord,
  PersistedReviewArtifactCleanupRecord,
  PersistedReviewArtifactFailureStagingRecord,
  PersistedReviewArtifactReadAttemptRecord,
  ReviewArtifactCleanupRecord,
  ReviewDispatchTransitionRecord,
} from "./v2/observation-model";

export type ReviewCompletionOutcome =
  | { readonly kind: "terminalized" }
  | { readonly kind: "awaiting_child_binding" }
  | { readonly kind: "blocked" }
  | { readonly kind: "stale" };

export type MatchingReviewParentPostToolUse = {
  readonly type: "PostToolUse";
  readonly sessionId: string;
  readonly callId: string;
};

export type ReviewCompletionInput = {
  readonly parentSessionId: string;
  readonly callId: string;
  readonly postToolUse: MatchingReviewParentPostToolUse;
  readonly observedExecution?: ObservedReviewExecutionV1;
  readonly agentId: ObservationAgentId;
  readonly writerId: string;
};

export type ReviewArtifactReadFailure = {
  readonly kind: "failure";
  readonly reason: ReviewArtifactFailureReason;
};

export type ReviewCompletionClassification =
  | { readonly kind: "completed"; readonly artifact: ReviewArtifactV1 }
  | { readonly kind: "completed_with_findings"; readonly artifact: ReviewArtifactV1 }
  | { readonly kind: "review_incomplete"; readonly artifact: ReviewArtifactV1 };

export function classifyReviewCompletion(
  result: ReviewWorkerResultV1,
): ReviewCompletionClassification {
  const artifact = result as ReviewArtifactV1;
  if (!result.complete) return { kind: "review_incomplete", artifact };
  return result.findings.length === 0
    ? { kind: "completed", artifact }
    : { kind: "completed_with_findings", artifact };
}

function sameReviewCorrelation(left: ReviewCorrelation, right: ReviewCorrelation): boolean {
  if (left.reviewKind !== right.reviewKind) return false;
  if (left.reviewKind === "task-review" && right.reviewKind === "task-review") {
    return (
      left.reviewRound === right.reviewRound &&
      left.taskExecutionRef.authorizationId === right.taskExecutionRef.authorizationId &&
      left.taskExecutionRef.taskId === right.taskExecutionRef.taskId &&
      left.taskExecutionRef.attemptId === right.taskExecutionRef.attemptId
    );
  }
  if (left.reviewKind !== "final-review" || right.reviewKind !== "final-review") return false;
  return (
    left.planPath === right.planPath &&
    left.authorizationId === right.authorizationId &&
    left.planFingerprint.algorithm === right.planFingerprint.algorithm &&
    left.planFingerprint.value === right.planFingerprint.value &&
    left.finalizationAttemptId === right.finalizationAttemptId &&
    left.finalReviewRound === right.finalReviewRound
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFinding(value: unknown): value is ReviewArtifactFindingV1 {
  if (!isRecord(value)) return false;
  return (
    typeof value.itemKey === "string" && value.itemKey.length > 0 &&
    typeof value.summary === "string" && value.summary.length > 0 &&
    typeof value.location === "string" && value.location.length > 0 &&
    (value.severity === "critical" || value.severity === "major" || value.severity === "minor")
  );
}

export function parseReviewWorkerResult(value: unknown): ReviewWorkerResultV1 | undefined {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.complete !== "boolean") {
    return undefined;
  }
  if (!Array.isArray(value.findings) || !value.findings.every(isFinding)) return undefined;
  return {
    schemaVersion: 1,
    complete: value.complete,
    findings: Object.freeze(
      value.findings.map((finding) => ({
        itemKey: finding.itemKey,
        severity: finding.severity,
        summary: finding.summary,
        location: finding.location,
      })),
    ),
  };
}

export function assembleReviewCompletionStaging(
  postToolUse: MatchingReviewParentPostToolUse,
  binding: ReviewTaskCallBinding,
  delegatedBinding: DelegatedExecutionBinding,
  correlation: ReviewCorrelation,
  observedExecution: ObservedReviewExecutionV1,
  content: string,
): ReviewCompletionStaging | ReviewArtifactReadFailure {
  if (!sameReviewCorrelation(binding.correlation, correlation)) return { kind: "failure", reason: "artifact_schema_invalid" };
  if (postToolUse.sessionId !== binding.parentSessionId || postToolUse.callId !== binding.callId) {
    return { kind: "failure", reason: "artifact_schema_invalid" };
  }
  if (delegatedBinding.childSessionId !== observedExecution.childSessionId) {
    return { kind: "failure", reason: "artifact_schema_invalid" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    return { kind: "failure", reason: "artifact_json_invalid" };
  }
  const worker = parseReviewWorkerResult(parsed);
  if (worker === undefined || binding.expectedCategory !== (correlation.reviewKind === "task-review" ? "sp-review" : "sp-final-review")) {
    return { kind: "failure", reason: "artifact_schema_invalid" };
  }
  const reviewArtifact: ReviewArtifactV1 = {
    ...worker,
    reviewKind: correlation.reviewKind,
    reviewSource: binding.expectedCategory,
    correlation,
    observedExecution,
  };
  return {
    callId: binding.callId,
    correlation,
    artifactConsumption: { artifactId: binding.artifactReservation.status === "usable" ? binding.artifactReservation.artifactId : "", digest: hashString(content) },
    reviewArtifact,
    observedExecution,
  };
}

type ClaimedSlot = ReviewDispatchSlot & { readonly state: "claimed"; readonly callId: string };

export type ReviewCompletionDependencies = {
  readonly readDurableRecords: () => Promise<readonly PersistedLogRecord[]>;
  readonly findAuthorizationById: (authorizationId: string) => Promise<import("./plan-authorization").ApprovedPlanBinding | null>;
  readonly appendReviewCompletionStaging: (input: PendingReviewCompletionStagingRecord) => Promise<{ readonly kind: "committed"; readonly record: PendingReviewCompletionStagingRecord & { readonly sequence: number } } | { readonly kind: "failed" }>;
  readonly appendReviewArtifactReadAttempt: (input: PendingReviewArtifactReadAttemptRecord) => Promise<{ readonly kind: "committed"; readonly record: PersistedReviewArtifactReadAttemptRecord } | { readonly kind: "failed" }>;
  readonly appendReviewArtifactFailureStaging: (input: PendingReviewArtifactFailureStagingRecord) => Promise<{ readonly kind: "committed"; readonly record: PersistedReviewArtifactFailureStagingRecord } | { readonly kind: "failed" }>;
  readonly appendReviewPostToolUsePending: (input: PendingReviewPostToolUseRecord) => Promise<{ readonly kind: "committed" } | { readonly kind: "failed" }>;
  readonly appendReviewObserved: (input: PendingEnvelope & { readonly recordType: "observation"; readonly kind: "review_observed"; readonly reviewScope: string; readonly isCompleteSnapshot: boolean; readonly correlation?: ReviewCorrelation; readonly items: readonly { readonly itemKey: string; readonly evidenceId: string; readonly severity: "critical" | "major" | "minor"; readonly summary: string; readonly location: string; readonly status: "open" }[] }) => Promise<{ readonly kind: "committed" } | { readonly kind: "failed" }>;

  readonly appendReviewArtifactCleanupRecord: (input: PendingReviewArtifactCleanupRecord) => Promise<{ readonly kind: "committed"; readonly record: PersistedReviewArtifactCleanupRecord } | { readonly kind: "failed" }>;
  readonly appendReviewDispatchTransition: (input: PendingReviewDispatchTransitionRecord) => Promise<{ readonly kind: "committed"; readonly record: ReviewDispatchTransitionRecord } | { readonly kind: "failed" }>;
  readonly readAndAssembleMatchingArtifact: (postToolUse: MatchingReviewParentPostToolUse, binding: ReviewTaskCallBinding, delegatedBinding: DelegatedExecutionBinding, correlation: ReviewCorrelation, observedExecution: ObservedReviewExecutionV1) => Promise<ReviewCompletionStaging | ReviewArtifactReadFailure>;
  readonly recordAdvisory: (advisory: string, cause?: unknown) => Promise<void>;
  readonly cleanupArtifact: (reservation: Extract<ReviewArtifactReservation, { readonly status: "usable" }>) => Promise<ReviewArtifactCleanupStatus>;
  readonly evaluateGatePendingAttemptWithinAuthorizationReviewBoundary: (context: GatePendingAttemptContext) => Promise<{ readonly kind: "not_applicable" } | { readonly kind: "decided"; readonly decision: unknown } | { readonly kind: "blocked"; readonly advisory: string }>;
  readonly appendTaskLifecycleTransition: (input: TaskLifecycleTransitionInput) => Promise<{ readonly kind: "committed" | "failed" }>;
  readonly appendPlanFinalizationTransition: (input: PlanFinalizationTransitionInput) => Promise<{ readonly kind: "committed" | "failed" }>;
  readonly dispatch: {
    readonly withReviewDispatchParentSessionClaim: <T>(parentSessionId: string, operation: () => Promise<T>) => Promise<T>;
    readonly offerNextMandatoryReviewWithinParentSessionClaim: (parentSessionId: string) => Promise<unknown>;
    readonly cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim: (parentSessionId: string, authorizationId: string) => Promise<void>;
  };
};

function envelope(input: ReviewCompletionInput): Pick<PendingEnvelope, "schemaVersion" | "timestamp" | "agentId" | "sessionId" | "writerId"> & { readonly recordType: "observation" } {
  return { schemaVersion: 1, timestamp: new Date().toISOString(), agentId: input.agentId, sessionId: input.parentSessionId, writerId: input.writerId, recordType: "observation" };
}

function claimedSlot(records: readonly PersistedLogRecord[], parentSessionId: string, callId: string): ClaimedSlot | undefined {
  return projectReviewDispatchSlots(records).find((slot): slot is ClaimedSlot => slot.state === "claimed" && slot.key.parentSessionId === parentSessionId && slot.callId === callId);
}

function purposeForCorrelation(
  correlation: ReviewCorrelation,
): "task_review" | "final_review" {
  return correlation.reviewKind === "task-review" ? "task_review" : "final_review";
}

/**
 * True when the binding's purpose, correlation, and reservation identity all
 * agree with the durable staging (N1: every present field must be compared
 * before terminalizing from restart recovery).
 */
function stagingMatchesSlot(
  records: readonly PersistedLogRecord[],
  staging: PersistedReviewCompletionStagingRecord,
  slot: ClaimedSlot,
): boolean {
  if (!sameReviewCorrelation(slot.key.correlation, staging.staging.correlation)) return false;
  const binding = projectTaskCallBindings(records).find(
    (candidate): candidate is ReviewTaskCallBinding =>
      candidate.purpose !== "implementation" &&
      candidate.parentSessionId === staging.parentSessionId &&
      candidate.callId === staging.staging.callId &&
      sameReviewCorrelation(candidate.correlation, staging.staging.correlation),
  );
  if (binding === undefined) return false;
  if (binding.purpose !== purposeForCorrelation(staging.staging.correlation)) return false;
  return (
    binding.artifactReservation.status === "usable" &&
    binding.artifactReservation.artifactId === staging.staging.artifactConsumption.artifactId
  );
}

/**
 * Restart-recovery identity check (N1): the observed child binding recorded in
 * the durable staging must still match the CURRENT durable child binding for
 * the same parent/call, and the purpose must agree with the correlation.
 */
function stagingMatchesCurrentIdentity(
  records: readonly PersistedLogRecord[],
  staging: PersistedReviewCompletionStagingRecord,
): boolean {
  const delegated = projectDelegatedExecutionBindings(records).find(
    (candidate) =>
      candidate.parentSessionId === staging.parentSessionId &&
      candidate.parentCallId === staging.staging.callId &&
      sameReviewCorrelation(candidate.correlation, staging.staging.correlation),
  );
  if (delegated === undefined) return false;
  if (delegated.childSessionId !== staging.staging.observedExecution.childSessionId) return false;
  return stagingMatchesSlotWithCurrentBinding(records, staging);
}

function stagingMatchesSlotWithCurrentBinding(
  records: readonly PersistedLogRecord[],
  staging: PersistedReviewCompletionStagingRecord,
): boolean {
  const binding = projectTaskCallBindings(records).find(
    (candidate): candidate is ReviewTaskCallBinding =>
      candidate.purpose !== "implementation" &&
      candidate.parentSessionId === staging.parentSessionId &&
      candidate.callId === staging.staging.callId &&
      sameReviewCorrelation(candidate.correlation, staging.staging.correlation),
  );
  if (binding === undefined) return false;
  return (
    binding.purpose === purposeForCorrelation(staging.staging.correlation) &&
    binding.artifactReservation.status === "usable" &&
    binding.artifactReservation.artifactId === staging.staging.artifactConsumption.artifactId
  );
}

/**
 * Resolves the usable artifact reservation for a terminal from the durable
 * claimed transition matching the terminal's identity; used so cleanup never
 * trusts a stale reservation reference.
 */
function usableReservationForTerminal(
  records: readonly PersistedLogRecord[],
  terminal: ReviewDispatchTransitionRecord,
): Extract<ReviewArtifactReservation, { readonly status: "usable" }> | undefined {
  if (!("callId" in terminal) || terminal.callId === undefined) return undefined;
  const claimed = records.find(
    (record): record is ReviewDispatchTransitionRecord & {
      readonly from: "pending";
      readonly to: "claimed";
      readonly callId: string;
      readonly artifactReservation: ReviewArtifactReservation;
    } =>
      record.recordType === "observation" &&
      record.kind === "review_dispatch_transition" &&
      record.from === "pending" &&
      record.to === "claimed" &&
      record.parentSessionId === terminal.parentSessionId &&
      record.callId === terminal.callId &&
      sameReviewCorrelation(record.correlation, terminal.correlation),
  );
  return claimed?.artifactReservation.status === "usable" ? claimed.artifactReservation : undefined;
}

export function createReviewCompletionDomain(dependencies: ReviewCompletionDependencies) {
  const terminalReasonFor = (artifact: ReviewArtifactV1): "completed" | "completed_with_findings" | "review_incomplete" =>
    !artifact.complete
      ? "review_incomplete"
      : artifact.findings.length === 0
        ? "completed"
        : "completed_with_findings";

  const terminalFor = (
    staging: PersistedReviewCompletionStagingRecord,
    slot: ClaimedSlot,
  ): PendingReviewDispatchTransitionRecord => ({
    ...envelope({
      parentSessionId: staging.parentSessionId,
      callId: staging.staging.callId,
      postToolUse: { type: "PostToolUse", sessionId: staging.parentSessionId, callId: staging.staging.callId },
      agentId: staging.agentId,
      writerId: staging.writerId,
    }),
    kind: "review_dispatch_transition",
    transitionId: randomUUID(),
    parentSessionId: staging.parentSessionId,
    correlation: staging.staging.correlation,
    expectedCategory: slot.expectedCategory,
    from: "claimed",
    to: "terminal",
    callId: staging.staging.callId,
    terminalReason: terminalReasonFor(staging.staging.reviewArtifact),
    artifactConsumption: staging.staging.artifactConsumption,
    reviewArtifact: staging.staging.reviewArtifact,
  });

  const appendReviewObserved = async (
    staging: PersistedReviewCompletionStagingRecord,
  ): Promise<boolean> => {
    const artifact = staging.staging.reviewArtifact;
    const taskId =
      artifact.correlation.reviewKind === "task-review"
        ? artifact.correlation.taskExecutionRef.taskId
        : undefined;
    const existing = (await dependencies.readDurableRecords()).some(
      (record) =>
        record.recordType === "observation" &&
        record.kind === "review_observed" &&
        record.sessionId === staging.parentSessionId &&
        (taskId === undefined ? record.reviewScope === "final" : record.taskId === taskId) &&
        // Deduplicate per review attempt, not per task: a later review round
        // for the same task must append its new findings (N3).
        record.correlation !== undefined &&
        sameReviewCorrelation(record.correlation, artifact.correlation),
    );
    if (existing) return true;
    const items = artifact.findings.map((finding) => ({
      ...finding,
      evidenceId: finding.itemKey,
      status: "open" as const,
    }));
    return (
      await dependencies.appendReviewObserved({
        ...envelope({
          parentSessionId: staging.parentSessionId,
          callId: staging.staging.callId,
          postToolUse: { type: "PostToolUse", sessionId: staging.parentSessionId, callId: staging.staging.callId },
          agentId: staging.agentId,
          writerId: staging.writerId,
        }),
        ...(taskId === undefined ? {} : { taskId }),
        kind: "review_observed",
        reviewScope: taskId === undefined ? "final" : `task:${taskId}`,
        isCompleteSnapshot: artifact.complete,
        correlation: artifact.correlation,
        items,
      })
    ).kind === "committed";
  };

  const cleanupState = (
    records: readonly PersistedLogRecord[],
    identity: { readonly parentSessionId: string; readonly callId: string; readonly correlation: ReviewCorrelation; readonly artifactId: string },
  ): "not_started" | "outcome_uncertain" | ReviewArtifactCleanupStatus => {
    const latest = orderEventsForProjection(records)
      .filter(
        (record): record is PersistedReviewArtifactCleanupRecord =>
          record.recordType === "observation" &&
          record.kind === "review_artifact_cleanup" &&
          record.parentSessionId === identity.parentSessionId &&
          record.callId === identity.callId &&
          record.artifactId === identity.artifactId &&
          sameReviewCorrelation(record.correlation, identity.correlation),
      )
      .at(-1);
    if (latest === undefined) return "not_started";
    return latest.phase === "started" ? "outcome_uncertain" : latest.status;
  };

  const clean = async (
    terminal: ReviewDispatchTransitionRecord,
    reservation: Extract<ReviewArtifactReservation, { readonly status: "usable" }>,
  ): Promise<void> => {
    if (!("callId" in terminal) || terminal.callId === undefined) return;
    const callId = terminal.callId;
    const identity = {
      parentSessionId: terminal.parentSessionId,
      callId,
      correlation: terminal.correlation,
      artifactId: reservation.artifactId,
    };
    const current = cleanupState(await dependencies.readDurableRecords(), identity);
    if (current === "outcome_uncertain") {
      await dependencies.recordAdvisory("review_artifact_cleanup_outcome_uncertain");
      return;
    }
    if (current !== "not_started" && current !== "cleanup_incomplete") return;
    const started = await dependencies.appendReviewArtifactCleanupRecord({
      ...envelope({
        parentSessionId: terminal.parentSessionId,
        callId,
        postToolUse: { type: "PostToolUse", sessionId: terminal.parentSessionId, callId },
        agentId: terminal.agentId,
        writerId: terminal.writerId,
      }),
      kind: "review_artifact_cleanup",
      ...identity,
      phase: "started",
    });
    if (started.kind !== "committed") {
      await dependencies.recordAdvisory("review_artifact_cleanup_start_append_failed");
      return;
    }
    let status: ReviewArtifactCleanupStatus;
    try {
      status = await dependencies.cleanupArtifact(reservation);
    } catch (error: unknown) {
      status = "cleanup_incomplete";
      await dependencies.recordAdvisory("review_artifact_cleanup_failed", error);
    }
    const finished = await dependencies.appendReviewArtifactCleanupRecord({
      ...envelope({
        parentSessionId: terminal.parentSessionId,
        callId,
        postToolUse: { type: "PostToolUse", sessionId: terminal.parentSessionId, callId },
        agentId: terminal.agentId,
        writerId: terminal.writerId,
      }),
      kind: "review_artifact_cleanup",
      ...identity,
      phase: "finished",
      status,
    });
    if (finished.kind !== "committed") {
      await dependencies.recordAdvisory("review_artifact_cleanup_outcome_uncertain");
    } else if (status === "replacement_retained") {
      await dependencies.recordAdvisory("review_artifact_identity_mismatch");
    } else if (status === "quarantine_retained") {
      await dependencies.recordAdvisory("review_artifact_cleanup_retained");
    } else if (status === "cleanup_incomplete") {
      await dependencies.recordAdvisory("review_artifact_cleanup_incomplete");
    }
  };

  const ensureTerminalReviewOutcomeApplied = async (
    terminal: ReviewDispatchTransitionRecord,
  ): Promise<ReviewCompletionOutcome> => {
    if (!("terminalReason" in terminal)) return { kind: "stale" };
    if (!(await isCurrentActiveAuthorization(terminal.correlation, dependencies.findAuthorizationById))) {
      return { kind: "blocked" };
    }
    if (terminal.terminalReason !== "completed") {
      if (terminal.terminalReason === "completed_with_findings") {
        const lifecycle = project(await dependencies.readDurableRecords(), new Date().toISOString()).lifecycle;
        const task = terminal.correlation.reviewKind === "task-review";
        let pending: boolean;
        if (terminal.correlation.reviewKind === "task-review") {
          pending = lifecycle.taskStates.get(
              taskLifecycleKey(terminal.parentSessionId, terminal.correlation.taskExecutionRef),
            ) === "review_pending";
        } else {
          const correlation = terminal.correlation;
          pending = Array.from(lifecycle.finalization.values()).some(
            (finalization) =>
              finalization.parentSessionId === terminal.parentSessionId &&
              finalization.authorizationId === correlation.authorizationId &&
              finalization.planPath === correlation.planPath &&
              finalization.finalizationAttemptId === correlation.finalizationAttemptId &&
              finalization.finalReviewRound === correlation.finalReviewRound &&
              finalization.state === "final_review_pending",
          );
        }
        if (!pending) return { kind: "terminalized" };
        const result = task
          ? await dependencies.appendTaskLifecycleTransition({ parentSessionId: terminal.parentSessionId, taskExecutionRef: terminal.correlation.taskExecutionRef, from: "review_pending", to: "rework_required" })
          : await dependencies.appendPlanFinalizationTransition({ parentSessionId: terminal.parentSessionId, authorizationId: terminal.correlation.authorizationId, planPath: terminal.correlation.planPath, finalizationAttemptId: terminal.correlation.finalizationAttemptId, finalReviewRound: terminal.correlation.finalReviewRound, from: "final_review_pending", to: "final_rework_required" });
        if (result.kind !== "committed") return { kind: "blocked" };
        return { kind: "terminalized" };
      }
      return { kind: "blocked" };
    }
    const records = await dependencies.readDurableRecords();
    const lifecycle = project(records, new Date().toISOString()).lifecycle;
    const task = terminal.correlation.reviewKind === "task-review";
    const pending = task
      ? lifecycle.taskStates.get(
          taskLifecycleKey(terminal.parentSessionId, terminal.correlation.taskExecutionRef),
        ) === "review_pending"
      : Array.from(lifecycle.finalization.values()).some(
          (finalization) => finalization.state === "final_review_pending",
        );
    if (pending) {
      const transition = task
        ? await dependencies.appendTaskLifecycleTransition({ parentSessionId: terminal.parentSessionId, taskExecutionRef: terminal.correlation.taskExecutionRef, from: "review_pending", to: "gate_pending" })
        : await dependencies.appendPlanFinalizationTransition({ parentSessionId: terminal.parentSessionId, authorizationId: terminal.correlation.authorizationId, planPath: terminal.correlation.planPath, finalizationAttemptId: terminal.correlation.finalizationAttemptId, finalReviewRound: terminal.correlation.finalReviewRound, from: "final_review_pending", to: "final_gate_pending" });
      if (transition.kind !== "committed") return { kind: "blocked" };
    }
    const context: GatePendingAttemptContext = task
      ? { scope: "task", trigger: "task_complete", parentSessionId: terminal.parentSessionId, taskExecutionRef: terminal.correlation.taskExecutionRef, agentId: terminal.agentId, sessionId: terminal.sessionId, writerId: terminal.writerId }
      : { scope: "plan", trigger: "final_review_complete", parentSessionId: terminal.parentSessionId, authorizationId: terminal.correlation.authorizationId, planPath: terminal.correlation.planPath, finalizationAttemptId: terminal.correlation.finalizationAttemptId, finalReviewRound: terminal.correlation.finalReviewRound, agentId: terminal.agentId, sessionId: terminal.sessionId, writerId: terminal.writerId };
    const gate = await dependencies.evaluateGatePendingAttemptWithinAuthorizationReviewBoundary(context);
    if (gate.kind === "blocked") return { kind: "blocked" };
    const current = await dependencies.readDurableRecords();
    return findCurrentGateDecision(current, terminal.correlation).kind === "found" &&
      findCurrentAcceptanceDecision(current, terminal.correlation).kind === "found"
      ? { kind: "terminalized" }
      : { kind: "stale" };
  };

  const consumeReviewCompletion = async (input: ReviewCompletionInput): Promise<ReviewCompletionOutcome> =>
    dependencies.dispatch.withReviewDispatchParentSessionClaim(input.parentSessionId, async (): Promise<ReviewCompletionOutcome> => {
      const records = await dependencies.readDurableRecords();
      const slot = claimedSlot(records, input.parentSessionId, input.callId);
      if (slot === undefined || input.postToolUse.sessionId !== input.parentSessionId || input.postToolUse.callId !== input.callId) return { kind: "stale" as const };
      const binding = projectTaskCallBindings(records).find((candidate): candidate is ReviewTaskCallBinding => candidate.purpose !== "implementation" && candidate.parentSessionId === input.parentSessionId && candidate.callId === input.callId && sameReviewCorrelation(candidate.correlation, slot.key.correlation));
      if (binding === undefined || binding.artifactReservation.status !== "usable") return { kind: "blocked" as const };
      if (!(await isCurrentActiveAuthorization(slot.key.correlation, dependencies.findAuthorizationById))) {
        await dependencies.dispatch.cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim(input.parentSessionId, authorizationIdFor(slot.key.correlation));
        return { kind: "blocked" as const };
      }
      const delegated = projectDelegatedExecutionBindings(records).find((candidate) => candidate.parentSessionId === input.parentSessionId && candidate.parentCallId === input.callId && sameReviewCorrelation(candidate.correlation, slot.key.correlation));
      if (delegated === undefined) {
        await dependencies.appendReviewPostToolUsePending({ ...envelope(input), kind: "review_post_tooluse_pending", parentSessionId: input.parentSessionId, callId: input.callId, purpose: binding.purpose, trustedCorrelation: slot.key.correlation });
        return { kind: "awaiting_child_binding" as const };
      }
      const observed = input.observedExecution ?? projectObservedReviewExecution(records, delegated);
      if (observed === undefined) return { kind: "stale" as const };
      const attempt = await dependencies.appendReviewArtifactReadAttempt({ ...envelope(input), kind: "review_artifact_read_started", parentSessionId: input.parentSessionId, callId: input.callId, correlation: slot.key.correlation, artifactId: binding.artifactReservation.artifactId, artifactPath: binding.artifactReservation.artifactPath });
      if (attempt.kind !== "committed") return { kind: "blocked" as const };
      // A reader throw must not escape to the outer fail-open catch (N1/§4.8.1):
      // convert it to a durable artifact_read_failed staging + terminal through
      // the already-committed read-attempt marker, without rereading.
      let assembled: import("./types").ReviewCompletionStaging | ReviewArtifactReadFailure;
      try {
        assembled = await dependencies.readAndAssembleMatchingArtifact(
          input.postToolUse,
          binding,
          delegated,
          slot.key.correlation,
          observed,
        );
      } catch (error: unknown) {
        await dependencies.recordAdvisory("review_artifact_read_unhandled", error);
        assembled = { kind: "failure", reason: "artifact_read_failed" };
      }
      if ("reason" in assembled) {
        const failure = await dependencies.appendReviewArtifactFailureStaging({ ...envelope(input), kind: "review_artifact_failure_staged", parentSessionId: input.parentSessionId, callId: input.callId, correlation: slot.key.correlation, terminalReason: assembled.reason });
        if (failure.kind !== "committed") return { kind: "blocked" };
        const terminal = await dependencies.appendReviewDispatchTransition({ ...envelope(input), kind: "review_dispatch_transition", transitionId: randomUUID(), parentSessionId: input.parentSessionId, correlation: slot.key.correlation, expectedCategory: slot.expectedCategory, from: "claimed", to: "terminal", callId: input.callId, terminalReason: assembled.reason });
        if (terminal.kind === "committed") {
          await clean(terminal.record, binding.artifactReservation);
          await dependencies.dispatch.offerNextMandatoryReviewWithinParentSessionClaim(
            input.parentSessionId,
          );
        }
        return { kind: "blocked" as const };
      }
      const staged = await dependencies.appendReviewCompletionStaging({ ...envelope(input), kind: "review_completion_staged", parentSessionId: input.parentSessionId, staging: assembled });
      if (staged.kind !== "committed") return { kind: "blocked" as const };
      const terminal = await dependencies.appendReviewDispatchTransition(terminalFor(staged.record, slot));
      if (terminal.kind !== "committed") return { kind: "blocked" };
      if (!(await appendReviewObserved(staged.record))) return { kind: "blocked" };
      const outcome = await ensureTerminalReviewOutcomeApplied(terminal.record);
      await clean(terminal.record, binding.artifactReservation);
      await dependencies.dispatch.offerNextMandatoryReviewWithinParentSessionClaim(input.parentSessionId);
      return outcome;
    }).catch(async (error: unknown) => {
      await dependencies.recordAdvisory("review_completion_failed", error);
      return { kind: "blocked" };
    });

  const recoverStagedReviewCompletionsAfterRestart = async (): Promise<void> => {
    try {
      const records = await dependencies.readDurableRecords();
      const staged = records.filter(
        (record): record is PersistedReviewCompletionStagingRecord =>
          record.recordType === "observation" &&
          record.kind === "review_completion_staged",
      );
      for (const completion of staged) {
        await recoverStagedReviewCompletion(completion);
      }
      const failureStagings = records.filter(
        (record): record is PersistedReviewArtifactFailureStagingRecord =>
          record.recordType === "observation" &&
          record.kind === "review_artifact_failure_staged",
      );
      for (const failureStaging of failureStagings) {
        try {
          await recoverStagedArtifactFailure(failureStaging);
        } catch (error: unknown) {
          await dependencies.recordAdvisory("review_artifact_failure_recovery_failed", error);
        }
      }
      const pendingPostToolUse = records.filter(
        (record): record is import("./v2/observation-model").PersistedReviewPostToolUseRecord =>
          record.recordType === "observation" &&
          record.kind === "review_post_tooluse_pending",
      );
      for (const pending of pendingPostToolUse) {
        await recoverPendingReviewCompletionsForBinding(
          pending.parentSessionId,
          pending.callId,
        );
      }
      const pending = records.filter(
        (record): record is PersistedReviewArtifactReadAttemptRecord =>
          record.recordType === "observation" &&
          "kind" in record &&
          record.kind === "review_artifact_read_started",
      );
      for (const attempt of pending) {
        const current = await dependencies.readDurableRecords();
        const hasTerminal = projectReviewDispatchSlots(current).some(
          (slot) =>
            slot.key.parentSessionId === attempt.parentSessionId &&
            slot.callId === attempt.callId &&
            slot.state === "terminal",
        );
        if (!hasTerminal) {
          const slot = claimedSlot(current, attempt.parentSessionId, attempt.callId);
          if (slot?.artifactReservation?.status !== "usable") {
            await dependencies.recordAdvisory("review_artifact_read_recovery_pending");
            continue;
          }
          const failure = await dependencies.appendReviewArtifactFailureStaging({
            schemaVersion: 1,
            timestamp: new Date().toISOString(),
            agentId: attempt.agentId,
            sessionId: attempt.sessionId,
            writerId: attempt.writerId,
            recordType: "observation",
            kind: "review_artifact_failure_staged",
            parentSessionId: attempt.parentSessionId,
            callId: attempt.callId,
            correlation: attempt.correlation,
            terminalReason: "artifact_read_failed",
          });
          if (failure.kind !== "committed") continue;
          const terminal = await dependencies.appendReviewDispatchTransition({
            schemaVersion: 1,
            timestamp: new Date().toISOString(),
            agentId: attempt.agentId,
            sessionId: attempt.sessionId,
            writerId: attempt.writerId,
            recordType: "observation",
            kind: "review_dispatch_transition",
            transitionId: randomUUID(),
            parentSessionId: attempt.parentSessionId,
            correlation: attempt.correlation,
            expectedCategory: slot.expectedCategory,
            from: "claimed",
            to: "terminal",
            callId: attempt.callId,
            terminalReason: "artifact_read_failed",
          });
          if (terminal.kind !== "committed") continue;
          await clean(terminal.record, slot.artifactReservation);
          await dependencies.dispatch.offerNextMandatoryReviewWithinParentSessionClaim(
            attempt.parentSessionId,
          );
        }
      }
    } catch (error: unknown) {
      await dependencies.recordAdvisory("review_staged_completion_recovery_failed", error);
    }
  };

  const findMatchingTerminalForStaging = (
    records: readonly PersistedLogRecord[],
    staging: PersistedReviewCompletionStagingRecord,
  ): ReviewDispatchTransitionRecord | undefined =>
    records.find(
      (record): record is ReviewDispatchTransitionRecord =>
        record.recordType === "observation" &&
        record.kind === "review_dispatch_transition" &&
        record.to === "terminal" &&
        record.parentSessionId === staging.parentSessionId &&
        record.callId === staging.staging.callId &&
        sameReviewCorrelation(record.correlation, staging.staging.correlation),
    );

  const recoverStagedReviewCompletion = async (
    staging: PersistedReviewCompletionStagingRecord,
  ): Promise<ReviewCompletionOutcome> =>
    dependencies.dispatch.withReviewDispatchParentSessionClaim(
      staging.parentSessionId,
      async (): Promise<ReviewCompletionOutcome> => {
        const records = await dependencies.readDurableRecords();
        const existingTerminal = findMatchingTerminalForStaging(records, staging);
        if (existingTerminal !== undefined) {
          // Identity must be re-validated against the CURRENT projection before
          // replaying review_observed or terminal outcomes from durable staging (N1).
          if (!stagingMatchesCurrentIdentity(records, staging)) {
            await dependencies.recordAdvisory("review_staged_completion_identity_mismatch");
            return { kind: "stale" };
          }
          // Authorization must be active BEFORE any terminalization replay (N1).
          if (!(await isCurrentActiveAuthorization(staging.staging.correlation, dependencies.findAuthorizationById))) {
            await dependencies.recordAdvisory("review_staged_completion_authorization_inactive");
            return { kind: "blocked" };
          }
          if (!(await appendReviewObserved(staging))) return { kind: "blocked" };
          const outcome = await ensureTerminalReviewOutcomeApplied(existingTerminal);
          const current = await dependencies.readDurableRecords();
          const reservation = usableReservationForTerminal(current, existingTerminal);
          if (reservation !== undefined) {
            await clean(existingTerminal, reservation);
          }
          return outcome;
        }
        const slot = claimedSlot(records, staging.parentSessionId, staging.staging.callId);
        if (slot === undefined || !stagingMatchesSlot(records, staging, slot)) {
          if (slot !== undefined) {
            await dependencies.recordAdvisory("review_staged_completion_identity_mismatch");
          }
          return { kind: "stale" };
        }
        // Authorization must still be active BEFORE appending the terminal (N1).
        if (!(await isCurrentActiveAuthorization(slot.key.correlation, dependencies.findAuthorizationById))) {
          await dependencies.recordAdvisory("review_staged_completion_authorization_inactive");
          return { kind: "blocked" };
        }
        const terminal = await dependencies.appendReviewDispatchTransition(terminalFor(staging, slot));
        if (terminal.kind !== "committed") return { kind: "blocked" };
        if (!(await appendReviewObserved(staging))) return { kind: "blocked" };
        const outcome = await ensureTerminalReviewOutcomeApplied(terminal.record);
        if (slot.artifactReservation?.status === "usable") {
          await clean(terminal.record, slot.artifactReservation);
        }
        await dependencies.dispatch.offerNextMandatoryReviewWithinParentSessionClaim(
          staging.parentSessionId,
        );
        return outcome;
      },
    ).catch(async (error: unknown): Promise<ReviewCompletionOutcome> => {
      await dependencies.recordAdvisory("review_staged_completion_recovery_failed", error);
      return { kind: "blocked" };
    });

  const findMatchingArtifactFailureTerminal = (
    records: readonly PersistedLogRecord[],
    staged: PersistedReviewArtifactFailureStagingRecord,
  ): ReviewDispatchTransitionRecord | undefined =>
    records.find(
      (record): record is ReviewDispatchTransitionRecord =>
        record.recordType === "observation" &&
        record.kind === "review_dispatch_transition" &&
        record.to === "terminal" &&
        record.parentSessionId === staged.parentSessionId &&
        record.callId === staged.callId &&
        sameReviewCorrelation(record.correlation, staged.correlation) &&
        record.terminalReason === staged.terminalReason,
    );

  /**
   * Recovers a durable `review_artifact_failure_staged` record that was left
   * without its matching terminal transition (e.g. a crash between the two
   * appends). Converts the staging to the terminal `artifact_*` reason WITHOUT
   * rereading the artifact; identity and active Authorization are validated
   * first and any mismatch leaves durable state untouched (N1).
   */
  const recoverStagedArtifactFailure = async (
    staged: PersistedReviewArtifactFailureStagingRecord,
  ): Promise<ReviewCompletionOutcome> =>
    dependencies.dispatch.withReviewDispatchParentSessionClaim(
      staged.parentSessionId,
      async (): Promise<ReviewCompletionOutcome> => {
        const records = await dependencies.readDurableRecords();
        const existingTerminal = findMatchingArtifactFailureTerminal(records, staged);
        if (existingTerminal !== undefined) {
          const reservation = usableReservationForTerminal(records, existingTerminal);
          if (reservation !== undefined) {
            await clean(existingTerminal, reservation);
          }
          return { kind: "blocked" };
        }
        const slot = projectReviewDispatchSlots(records).find(
          (candidate): candidate is ClaimedSlot =>
            candidate.state === "claimed" &&
            candidate.key.parentSessionId === staged.parentSessionId &&
            candidate.callId === staged.callId &&
            sameReviewCorrelation(candidate.key.correlation, staged.correlation),
        );
        if (slot === undefined) return { kind: "stale" };
        const binding = projectTaskCallBindings(records).find(
          (candidate): candidate is ReviewTaskCallBinding =>
            candidate.purpose !== "implementation" &&
            candidate.parentSessionId === staged.parentSessionId &&
            candidate.callId === staged.callId &&
            sameReviewCorrelation(candidate.correlation, staged.correlation),
        );
        if (binding === undefined || binding.purpose !== purposeForCorrelation(staged.correlation)) {
          await dependencies.recordAdvisory("review_staged_failure_identity_mismatch");
          return { kind: "stale" };
        }
        if (!(await isCurrentActiveAuthorization(staged.correlation, dependencies.findAuthorizationById))) {
          await dependencies.recordAdvisory("review_staged_failure_authorization_inactive");
          return { kind: "blocked" };
        }
        const terminal = await dependencies.appendReviewDispatchTransition({
          schemaVersion: 1,
          timestamp: new Date().toISOString(),
          agentId: staged.agentId,
          sessionId: staged.sessionId,
          writerId: staged.writerId,
          recordType: "observation",
          kind: "review_dispatch_transition",
          transitionId: randomUUID(),
          parentSessionId: staged.parentSessionId,
          correlation: staged.correlation,
          expectedCategory: slot.expectedCategory,
          from: "claimed",
          to: "terminal",
          callId: staged.callId,
          terminalReason: staged.terminalReason,
        });
        if (terminal.kind !== "committed") return { kind: "blocked" };
        if (binding.artifactReservation.status === "usable") {
          await clean(terminal.record, binding.artifactReservation);
        }
        await dependencies.dispatch.offerNextMandatoryReviewWithinParentSessionClaim(
          staged.parentSessionId,
        );
        return { kind: "blocked" };
      },
    ).catch(async (error: unknown): Promise<ReviewCompletionOutcome> => {
      await dependencies.recordAdvisory("review_artifact_failure_recovery_failed", error);
      return { kind: "blocked" };
    });

  const recoverPendingReviewCompletionsForBinding = async (
    parentSessionId: string,
    callId: string,
  ): Promise<void> => {
    const records = await dependencies.readDurableRecords();
    const marker = records.find(
      (record): record is import("./v2/observation-model").PersistedReviewPostToolUseRecord =>
        record.recordType === "observation" &&
        "kind" in record &&
        record.kind === "review_post_tooluse_pending" &&
        record.parentSessionId === parentSessionId &&
        record.callId === callId,
    );
    if (marker === undefined) return;
    const delegated = projectDelegatedExecutionBindings(records).find(
      (binding) => binding.parentSessionId === parentSessionId && binding.parentCallId === callId,
    );
    const observedExecution =
      delegated === undefined ? undefined : projectObservedReviewExecution(records, delegated);
    if (observedExecution === undefined) return;
    await consumeReviewCompletion({
      parentSessionId,
      callId,
      postToolUse: { type: "PostToolUse", sessionId: parentSessionId, callId },
      observedExecution,
      agentId: marker.agentId,
      writerId: marker.writerId,
    });
  };

  const ensureConsumedReviewArtifactCleaned = async (
    staged: PersistedReviewCompletionStagingRecord,
    terminal: ReviewDispatchTransitionRecord,
  ): Promise<void> => {
    // Only clean when the terminal actually matches this staging (N1 identity).
    const matching = findMatchingTerminalForStaging(
      await dependencies.readDurableRecords(),
      staged,
    );
    if (matching === undefined || matching.transitionId !== terminal.transitionId) return;
    if (!("terminalReason" in matching)) return;
    if (matching.terminalReason !== "completed" && matching.terminalReason !== "completed_with_findings" && matching.terminalReason !== "review_incomplete") {
      return;
    }
    const records = await dependencies.readDurableRecords();
    const reservation = usableReservationForTerminal(records, terminal);
    if (reservation === undefined) {
      await dependencies.recordAdvisory("review_artifact_cleanup_reservation_missing");
      return;
    }
    await clean(terminal, reservation);
  };

  const ensureFailedReviewArtifactCleaned = async (
    terminal: ReviewDispatchTransitionRecord,
  ): Promise<void> => {
    if (!("terminalReason" in terminal)) return;
    const reason = terminal.terminalReason;
    if (
      reason !== "cancelled" &&
      reason !== "artifact_missing" &&
      reason !== "artifact_read_failed" &&
      reason !== "artifact_json_invalid" &&
      reason !== "artifact_schema_invalid"
    ) {
      return;
    }
    const records = await dependencies.readDurableRecords();
    const reservation = usableReservationForTerminal(records, terminal);
    if (reservation === undefined) {
      await dependencies.recordAdvisory("review_artifact_cleanup_reservation_missing");
      return;
    }
    await clean(terminal, reservation);
  };

  return {
    consumeReviewCompletion,
    recoverPendingReviewCompletionsForBinding,
    recoverStagedReviewCompletion,
    recoverStagedArtifactFailure,
    recoverStagedReviewCompletionsAfterRestart,
    ensureConsumedReviewArtifactCleaned,
    ensureFailedReviewArtifactCleaned,
    findMatchingTerminalForStaging,
  };
}

export type { ReviewArtifactCleanupRecord, PendingReviewArtifactCleanupRecord, PersistedReviewArtifactCleanupRecord };
