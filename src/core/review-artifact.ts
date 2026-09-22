import { randomUUID } from "node:crypto";
import { authorizationIdFor, isCurrentActiveAuthorization } from "./acceptance-decision";
import {
  projectDelegatedExecutionBindings,
  projectObservedReviewExecution,
} from "./v2/state-projection";
import {
  projectReviewDispatchSlots,
  projectTaskCallBindings,
  type ReviewDispatchSlot,
} from "./review-dispatch-state";
import { hashString } from "./v2/hash";
import type {
  DelegatedExecutionBinding,
  ObservationAgentId,
  ObservedReviewExecutionV1,
  ReviewArtifactFailureReason,
  ReviewArtifactV1,
  ReviewCompletionStaging,
  ReviewCorrelation,
  ReviewTaskCallBinding,
  ReviewWorkerResultV1,
} from "./types";
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

function isFinding(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.itemKey === "string" &&
    typeof value.summary === "string" &&
    typeof value.location === "string" &&
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
    findings: Object.freeze(value.findings.map((finding) => ({ ...finding }))) as ReviewWorkerResultV1["findings"],
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
  readonly appendReviewDispatchTransition: (input: PendingReviewDispatchTransitionRecord) => Promise<{ readonly kind: "committed"; readonly record: ReviewDispatchTransitionRecord } | { readonly kind: "failed" }>;
  readonly readAndAssembleMatchingArtifact: (postToolUse: MatchingReviewParentPostToolUse, binding: ReviewTaskCallBinding, delegatedBinding: DelegatedExecutionBinding, correlation: ReviewCorrelation, observedExecution: ObservedReviewExecutionV1) => Promise<ReviewCompletionStaging | ReviewArtifactReadFailure>;
  readonly recordAdvisory: (advisory: string, cause?: unknown) => Promise<void>;
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

export function createReviewCompletionDomain(dependencies: ReviewCompletionDependencies) {
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
      const assembled = await dependencies.readAndAssembleMatchingArtifact(input.postToolUse, binding, delegated, slot.key.correlation, observed);
      if ("reason" in assembled) {
        const failure = await dependencies.appendReviewArtifactFailureStaging({ ...envelope(input), kind: "review_artifact_failure_staged", parentSessionId: input.parentSessionId, callId: input.callId, correlation: slot.key.correlation, terminalReason: assembled.reason });
        if (failure.kind !== "committed") return { kind: "blocked" };
        const terminal = await dependencies.appendReviewDispatchTransition({ ...envelope(input), kind: "review_dispatch_transition", transitionId: randomUUID(), parentSessionId: input.parentSessionId, correlation: slot.key.correlation, expectedCategory: slot.expectedCategory, from: "claimed", to: "terminal", callId: input.callId, terminalReason: assembled.reason });
        return terminal.kind === "committed" ? { kind: "blocked" as const } : { kind: "blocked" as const };
      }
      const staged = await dependencies.appendReviewCompletionStaging({ ...envelope(input), kind: "review_completion_staged", parentSessionId: input.parentSessionId, staging: assembled });
      if (staged.kind !== "committed") return { kind: "blocked" as const };
      const terminal = await dependencies.appendReviewDispatchTransition({ ...envelope(input), kind: "review_dispatch_transition", transitionId: randomUUID(), parentSessionId: input.parentSessionId, correlation: slot.key.correlation, expectedCategory: slot.expectedCategory, from: "claimed", to: "terminal", callId: input.callId, terminalReason: assembled.reviewArtifact.complete ? (assembled.reviewArtifact.findings.length === 0 ? "completed" : "completed_with_findings") : "review_incomplete", artifactConsumption: assembled.artifactConsumption, reviewArtifact: assembled.reviewArtifact });
      if (terminal.kind !== "committed") return { kind: "blocked" };
      await dependencies.dispatch.offerNextMandatoryReviewWithinParentSessionClaim(input.parentSessionId);
      return { kind: "terminalized" };
    }).catch(async (error: unknown) => {
      await dependencies.recordAdvisory("review_completion_failed", error);
      return { kind: "blocked" };
    });

  const recoverStagedReviewCompletionsAfterRestart = async (): Promise<void> => {
    try {
      const records = await dependencies.readDurableRecords();
      const pending = records.filter(
        (record): record is PersistedReviewArtifactReadAttemptRecord =>
          record.recordType === "observation" &&
          "kind" in record &&
          record.kind === "review_artifact_read_started",
      );
      for (const attempt of pending) {
        const hasTerminal = projectReviewDispatchSlots(await dependencies.readDurableRecords()).some(
          (slot) =>
            slot.key.parentSessionId === attempt.parentSessionId &&
            slot.callId === attempt.callId &&
            slot.state === "terminal",
        );
        if (!hasTerminal) {
          await dependencies.recordAdvisory("review_artifact_read_recovery_pending");
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
        if (findMatchingTerminalForStaging(records, staging) !== undefined) {
          return { kind: "terminalized" };
        }
        const slot = claimedSlot(records, staging.parentSessionId, staging.staging.callId);
        if (slot === undefined) return { kind: "stale" };
        const terminal = await dependencies.appendReviewDispatchTransition({
          schemaVersion: 1,
          timestamp: new Date().toISOString(),
          agentId: staging.agentId,
          sessionId: staging.sessionId,
          writerId: staging.writerId,
          recordType: "observation",
          kind: "review_dispatch_transition",
          transitionId: randomUUID(),
          parentSessionId: staging.parentSessionId,
          correlation: staging.staging.correlation,
          expectedCategory: slot.expectedCategory,
          from: "claimed",
          to: "terminal",
          callId: staging.staging.callId,
          terminalReason: staging.staging.reviewArtifact.complete
            ? staging.staging.reviewArtifact.findings.length === 0
              ? "completed"
              : "completed_with_findings"
            : "review_incomplete",
          artifactConsumption: staging.staging.artifactConsumption,
          reviewArtifact: staging.staging.reviewArtifact,
        });
        if (terminal.kind !== "committed") return { kind: "blocked" };
        await dependencies.dispatch.offerNextMandatoryReviewWithinParentSessionClaim(
          staging.parentSessionId,
        );
        return { kind: "terminalized" };
      },
    ).catch(async (error: unknown): Promise<ReviewCompletionOutcome> => {
      await dependencies.recordAdvisory("review_staged_completion_recovery_failed", error);
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

  return {
    consumeReviewCompletion,
    recoverPendingReviewCompletionsForBinding,
    recoverStagedReviewCompletion,
    recoverStagedReviewCompletionsAfterRestart,
    findMatchingTerminalForStaging,
  };
}

export type { ReviewArtifactCleanupRecord, PendingReviewArtifactCleanupRecord, PersistedReviewArtifactCleanupRecord };
