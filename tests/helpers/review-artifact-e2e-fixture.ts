/* eslint-disable security/detect-object-injection -- Test helper intentionally indexes fixture-backed maps by dynamic path. */
import { vi } from "vitest";
import { AuthorizationStore, createAuthorizationReviewBoundary } from "../../src/core/plan-authorization";
import { buildCanonicalSnapshot, computePlanFingerprint } from "../../src/core/plan-fingerprint";
import { PlanParser } from "../../src/core/plan-parser";
import {
  createReviewCompletionDomain,
  assembleReviewCompletionStaging,
} from "../../src/core/review-artifact";
import type { ReviewCompletionOutcome } from "../../src/core/review-artifact";
import { createGatePendingAttemptEvaluator } from "../../src/core/acceptance-decision";
import { ObservationLogStore } from "../../src/runtime/observation-log-store";
import { createMockFileSystem, createMockReservedReviewArtifactIo } from "./mock-file-system";
import type { MockFileSystem } from "./mock-file-system";
import type {
  ObservedReviewExecutionV1,
  ObservationAgentId,
  ReviewArtifactInodeIdentity,
  ReviewArtifactReservation,
  ReviewCorrelation,
  ShardId,
  TaskExecutionRef,
} from "../../src/core/types";
import type {
  PersistedEnvelope,
  PersistedLogRecord,
  PendingEnvelope,
} from "../../src/core/v2/observation-model";
import type { AcceptanceDecision, GateDecision } from "../../src/core/v2/decision-model";
import type { TaskProgressState } from "../../src/core/task-lifecycle";

export type UsableReviewArtifactReservation = Extract<
  ReviewArtifactReservation,
  { readonly status: "usable" }
>;

export type CompletionFixtureMode =
  | "claimed"
  | "claimed_without_child_binding"
  | "claimed_with_failed_read_attempt"
  | "terminalized";

export type ReviewArtifactCompletionFixture = {
  readonly files: MockFileSystem;
  readonly authorizationId: string;
  readonly parentSessionId: string;
  readonly childSessionId: string;
  readonly callId: string;
  readonly reservation: UsableReviewArtifactReservation;
  readonly correlation: ReviewCorrelation;
  readonly observedExecution: ObservedReviewExecutionV1;
  readonly validReviewWorkerJson: string;
  readonly writeReservedArtifact: ReturnType<typeof vi.fn>;
  readonly readReservedArtifact: ReturnType<typeof vi.fn>;
  readonly genericArtifactRead: ReturnType<typeof vi.fn>;
  readonly parseAndAssemble: ReturnType<typeof vi.fn>;
  readonly recordAdvisory: ReturnType<typeof vi.fn>;
  readonly unlinkArtifactPath: ReturnType<typeof vi.fn>;
  readonly consume: () => Promise<ReviewCompletionOutcome>;
  readonly replaceArtifactWithDifferentInode: (content: string) => Promise<void>;
  readonly failNextLeaseDelete: () => void;
  readonly artifactExists: () => Promise<boolean>;
  readonly leaseExists: () => Promise<boolean>;
  readonly ensureCleanup: () => Promise<void>;
  readonly readReplacementArtifact: () => Promise<string>;
  readonly durableFailureStaging: () => Promise<
    | Extract<PersistedLogRecord, { readonly kind: "review_artifact_failure_staged" }>
    | undefined
  >;
  readonly durableCleanupRecords: () => Promise<
    readonly Extract<PersistedLogRecord, { readonly kind: "review_artifact_cleanup" }>[]
  >;
  readonly durableGateDecisions: () => Promise<readonly GateDecision[]>;
  readonly durableAcceptanceDecisions: () => Promise<readonly AcceptanceDecision[]>;
  readonly durableRecords: () => Promise<readonly PersistedLogRecord[]>;
  readonly appendPendingRecord: <T extends PendingEnvelope & { readonly recordType: "observation" }>(
    input: T,
  ) => Promise<T & { readonly sequence: number }>;
};

export type ReviewCompletionDependenciesForTest = Parameters<
  typeof createReviewCompletionDomain
>[0];

export function reviewCompletionDependenciesSummary(): typeof createReviewCompletionDomain {
  return createReviewCompletionDomain;
}

export function assembleStagingForTest(): typeof assembleReviewCompletionStaging {
  return assembleReviewCompletionStaging;
}

/**
 * Shared Task 3.6 completion fixture. It constructs the real
 * `createReviewCompletionDomain` and the real Task 3.2 within-boundary Gate
 * evaluator. The only test doubles are the injected filesystem capability,
 * durable append ports, advisory spy, and the rule evaluator's deterministic
 * PASS result. It never calls the ordinary `FileReader.readFile` for a
 * reserved artifact.
 */
export async function arrangeReviewArtifactCompletionFixture(
  mode: CompletionFixtureMode,
): Promise<ReviewArtifactCompletionFixture> {
  const files = createMockFileSystem();
  const parentSessionId = "parent-review-artifact";
  const childSessionId = "child-review-artifact";
  const callId = "review-artifact-call";
  const writerId = "w-review-artifact";
  const agentId: ObservationAgentId = "atlas";
  const planPath = "docs/review-artifact.md";
  const planContent = "## Task 1: review artifact\n- [ ] implementation\n";
  const shard: ShardId = { agentId, sessionId: parentSessionId, writerId };
  const logStore = new ObservationLogStore(files, files, writerId);
  const boundary = createAuthorizationReviewBoundary();
  const seedAuthorizationStore = new AuthorizationStore(files, files, boundary);
  const approvedTaskIds = new PlanParser().parse(planContent).map((task) => task.id);
  await files.writeFile(planPath, planContent);
  const authorization = await seedAuthorizationStore.approve({
    sessionId: parentSessionId,
    planPath,
    canonicalSnapshot: buildCanonicalSnapshot(planContent, approvedTaskIds),
    planFingerprint: computePlanFingerprint(planContent, approvedTaskIds),
    approvedAt: "2026-09-05T00:00:00.000Z",
  });
  if (authorization === null || authorization.status !== "active") {
    throw new Error("completion fixture could not seed an active Authorization");
  }
  const taskExecutionRef: TaskExecutionRef = {
    authorizationId: authorization.authorizationId,
    taskId: "task-1",
    attemptId: "attempt-review-artifact",
  };
  const correlation: ReviewCorrelation = {
    reviewKind: "task-review",
    taskExecutionRef,
    reviewRound: 1,
  };

  const artifactPath = ".justice/reviews/review-artifact.json";
  const leasePath = ".justice/reviews/.leases/review-artifact.json.lease";
  const artifactIdentity: ReviewArtifactInodeIdentity = {
    device: "mock-device",
    inode: "review-artifact-1",
  };
  const reservation: UsableReviewArtifactReservation = {
    status: "usable",
    artifactId: "review-artifact-1",
    artifactPath,
    leasePath,
    artifactIdentity,
  };
  files.writtenFiles[artifactPath] = "";
  files.writtenFiles[leasePath] = "";

  const baseArtifactIo = createMockReservedReviewArtifactIo(files);
  baseArtifactIo.reviewArtifactIdentities.set(artifactPath, artifactIdentity);
  baseArtifactIo.reviewArtifactIdentities.set(leasePath, artifactIdentity);

  const originalDeleteFile = files.deleteFile.bind(files);
  let failLeaseDelete = false;
  const unlinkArtifactPath = vi.fn(async (path: string): Promise<void> => {
    if (failLeaseDelete && path === leasePath) {
      failLeaseDelete = false;
      throw new Error("mock lease unlink failure");
    }
    await originalDeleteFile(path);
  });
  files.deleteFile = unlinkArtifactPath;
  const writeReservedArtifact = vi.fn(baseArtifactIo.writeExisting.bind(baseArtifactIo));
  const readReservedArtifact = vi.fn(baseArtifactIo.readOnce.bind(baseArtifactIo));
  const genericArtifactRead = vi.fn(files.readFile.bind(files));
  const recordAdvisory = vi.fn(
    async (_advisory: string, _cause?: unknown): Promise<void> => undefined,
  );
  const parseAndAssemble = vi.spyOn(
    await import("../../src/core/review-artifact"),
    "assembleReviewCompletionStaging",
  );
  const appendPendingRecord = async <
    T extends PendingEnvelope & { readonly recordType: "observation" },
  >(
    input: T,
  ): Promise<T & { readonly sequence: number }> => {
    const sequence = await logStore.append(shard, input);
    return { ...input, sequence };
  };

  const envelope = () =>
    ({
      schemaVersion: 1 as const,
      timestamp: "2026-09-05T00:00:00.000Z",
      agentId,
      sessionId: parentSessionId,
      writerId,
      recordType: "observation" as const,
    }) satisfies PendingEnvelope;

  await appendPendingRecord({
    ...envelope(),
    kind: "review_dispatch_transition",
    transitionId: "review-artifact-pending",
    parentSessionId,
    correlation,
    expectedCategory: "sp-review",
    from: null,
    to: "pending",
  });
  await appendPendingRecord({
    ...envelope(),
    kind: "review_dispatch_transition",
    transitionId: "review-artifact-claimed",
    parentSessionId,
    correlation,
    expectedCategory: "sp-review",
    from: "pending",
    to: "claimed",
    callId,
    artifactReservation: reservation,
  });
  if (mode !== "claimed_without_child_binding") {
    await appendPendingRecord({
      ...envelope(),
      kind: "delegated_execution_binding",
      relation: {
        kind: "delegated_execution_relation_observed",
        provenance: "observed",
        runtimeEventId: "review-artifact-execution",
        parentSessionId,
        parentCallId: callId,
        childSessionId,
        category: "sp-review",
      },
      binding: {
        relationId: "review-artifact-execution",
        parentSessionId,
        parentCallId: callId,
        childSessionId,
        scope: {
          kind: "task",
          taskExecutionRef,
          reviewRound: 1,
        },
        correlation,
      },
    });
  }

  // Seed the task lifecycle into `review_pending` so the clean-completion path
  // can transition to `gate_pending` and evaluate the real Gate evaluator.
  const lifecycleSteps: readonly [
    "pending" | "authorized" | "in_progress" | "worker_reported" | "evidence_pending",
    TaskProgressState,
  ][] = [
    ["pending", "authorized"],
    ["authorized", "in_progress"],
    ["in_progress", "worker_reported"],
    ["worker_reported", "evidence_pending"],
    ["evidence_pending", "review_pending"],
  ];
  for (const [from, to] of lifecycleSteps) {
    await appendPendingRecord({
      ...envelope(),
      kind: "task_lifecycle_transition",
      parentSessionId,
      taskExecutionRef,
      from,
      to,
    });
  }

  const findAuthorizationById: ReviewCompletionDependenciesForTest["findAuthorizationById"] = (
    id,
  ) => (id === authorization.authorizationId ? Promise.resolve(authorization) : Promise.resolve(null));
  const appendReviewDispatchTransition: ReviewCompletionDependenciesForTest["appendReviewDispatchTransition"] =
    async (input) => ({
      kind: "committed" as const,
      record: await appendPendingRecord(input),
    });
  const appendTaskLifecycleTransition: ReviewCompletionDependenciesForTest["appendTaskLifecycleTransition"] =
    async (input) => {
      await appendPendingRecord({ ...envelope(), kind: "task_lifecycle_transition", ...input });
      return { kind: "committed" as const };
    };
  const appendPlanFinalizationTransition: ReviewCompletionDependenciesForTest["appendPlanFinalizationTransition"] =
    async (input) => {
      await appendPendingRecord({ ...envelope(), kind: "plan_finalization_transition", ...input });
      return { kind: "committed" as const };
    };
  const gateEvaluator = createGatePendingAttemptEvaluator({
    readDurableRecords: () => logStore.readAll(),
    appendDecision: async (input) => {
      await appendPendingRecord(input);
      return { kind: "committed" as const };
    },
    findAuthorizationById,
    withAuthorizationReviewBoundary: boundary.withParentSession,
    appendTaskLifecycleTransition,
    appendPlanFinalizationTransition,
    evaluateRules: async ({ context }) =>
      context.scope === "task"
        ? {
            recordType: "decision" as const,
            gateType: "task" as const,
            taskId: context.taskExecutionRef.taskId,
            taskExecutionRef: context.taskExecutionRef,
            verdict: "PASS" as const,
            reachableEnforcementLevel: "L1" as const,
            appliedEnforcementLevel: "L0" as const,
            ruleResults: [],
          }
        : {
            recordType: "decision" as const,
            gateType: "plan" as const,
            authorizationId: context.authorizationId,
            planPath: context.planPath,
            finalizationAttemptId: context.finalizationAttemptId,
            finalReviewRound: context.finalReviewRound,
            verdict: "PASS" as const,
            reachableEnforcementLevel: "L1" as const,
            appliedEnforcementLevel: "L0" as const,
            ruleResults: [],
          },
    recordAdvisory: async (advisory) => {
      await recordAdvisory(advisory);
    },
  });
  const readAndAssembleMatchingArtifact: ReviewCompletionDependenciesForTest["readAndAssembleMatchingArtifact"] =
    async (postToolUse, binding, delegatedBinding, trustedCorrelation, observedExecution) => {
      const content = await readReservedArtifact(binding.artifactReservation);
      return parseAndAssemble(
        postToolUse,
        binding,
        delegatedBinding,
        trustedCorrelation,
        observedExecution,
        content,
      );
    };
  const cleanupArtifact: ReviewCompletionDependenciesForTest["cleanupArtifact"] = async (
    usableReservation,
  ) => baseArtifactIo.cleanup(usableReservation);
  const completion = createReviewCompletionDomain({
    readDurableRecords: () => logStore.readAll(),
    findAuthorizationById,
    appendReviewCompletionStaging: async (input) => ({
      kind: "committed" as const,
      record: await appendPendingRecord(input),
    }),
    appendReviewArtifactReadAttempt: async (input) => mode === "claimed_with_failed_read_attempt"
      ? { kind: "failed" as const }
      : {
          kind: "committed" as const,
          record: await appendPendingRecord(input),
        },
    appendReviewArtifactFailureStaging: async (input) => ({
      kind: "committed" as const,
      record: await appendPendingRecord(input),
    }),
    appendReviewPostToolUsePending: async (input) => {
      await appendPendingRecord(input);
      return { kind: "committed" as const };
    },
    appendReviewObserved: async (input) => {
      await appendPendingRecord(input);
      return { kind: "committed" as const };
    },
    appendReviewArtifactCleanupRecord: async (input) => ({
      kind: "committed" as const,
      record: await appendPendingRecord(input),
    }),
    appendReviewDispatchTransition,
    readAndAssembleMatchingArtifact,
    cleanupArtifact,
    evaluateGatePendingAttemptWithinAuthorizationReviewBoundary:
      gateEvaluator.evaluateGatePendingAttemptWithinAuthorizationReviewBoundary,
    appendTaskLifecycleTransition,
    appendPlanFinalizationTransition,
    recordAdvisory,
    dispatch: {
      withReviewDispatchParentSessionClaim: boundary.withParentSession,
      offerNextMandatoryReviewWithinParentSessionClaim: vi.fn(async () => ({
        kind: "none" as const,
      })),
      cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim: vi.fn(
        async () => undefined,
      ),
    },
  });
  const validReviewWorkerJson = JSON.stringify({
    schemaVersion: 1,
    complete: true,
    findings: [],
  });
  const observedExecution: ObservedReviewExecutionV1 = {
    schemaVersion: 1,
    provenance: "observed",
    reviewExecutionEventId: "review-artifact-execution",
    parentSessionId,
    callId,
    childSessionId,
    correlation,
  };
  const consume = (): Promise<ReviewCompletionOutcome> =>
    completion.consumeReviewCompletion({
      parentSessionId,
      callId,
      postToolUse: { type: "PostToolUse", sessionId: parentSessionId, callId },
      observedExecution,
      agentId,
      writerId,
    });
  let staged:
    | (PersistedEnvelope & { readonly kind: "review_completion_staged" })
    | undefined;
  let terminal:
    | Extract<PersistedLogRecord, { readonly kind: "review_dispatch_transition" }>
    | undefined;
  if (mode === "terminalized") {
    const reviewArtifact = {
      schemaVersion: 1 as const,
      reviewKind: "task-review" as const,
      reviewSource: "sp-review" as const,
      correlation,
      observedExecution,
      complete: true,
      findings: [],
    };
    const artifactConsumption = {
      artifactId: reservation.artifactId,
      digest: `sha256:${"0".repeat(64)}`,
    };
    staged = await appendPendingRecord({
      ...envelope(),
      kind: "review_completion_staged",
      parentSessionId,
      staging: {
        callId,
        correlation,
        artifactConsumption,
        reviewArtifact,
        observedExecution,
      },
    });
    terminal = await appendPendingRecord({
      ...envelope(),
      kind: "review_dispatch_transition",
      transitionId: "review-artifact-terminal",
      parentSessionId,
      correlation,
      expectedCategory: "sp-review",
      from: "claimed",
      to: "terminal",
      callId,
      artifactConsumption,
      terminalReason: "completed",
      reviewArtifact,
    });
  }

  return {
    files,
    authorizationId: authorization.authorizationId,
    parentSessionId,
    childSessionId,
    callId,
    reservation,
    correlation,
    observedExecution,
    validReviewWorkerJson,
    writeReservedArtifact,
    readReservedArtifact,
    genericArtifactRead,
    parseAndAssemble,
    recordAdvisory,
    unlinkArtifactPath,
    consume,
    replaceArtifactWithDifferentInode: async (content) => {
      files.writtenFiles[reservation.artifactPath] = content;
      baseArtifactIo.reviewArtifactIdentities.set(reservation.artifactPath, {
        device: "mock-device",
        inode: "review-artifact-replacement",
      });
    },
    failNextLeaseDelete: () => {
      failLeaseDelete = true;
    },
    artifactExists: () => files.fileExists(reservation.artifactPath),
    leaseExists: () => files.fileExists(reservation.leasePath),
    ensureCleanup: async () => {
      if (staged === undefined || terminal === undefined) {
        throw new Error("terminalized completion fixture was not initialized");
      }
      const domain = completion as unknown as {
        readonly ensureConsumedReviewArtifactCleaned?: (
          staged: PersistedEnvelope & { readonly kind: "review_completion_staged" },
          terminal: Extract<PersistedLogRecord, { readonly kind: "review_dispatch_transition" }>,
        ) => Promise<void>;
      };
      const ensure = domain.ensureConsumedReviewArtifactCleaned;
      if (ensure === undefined) {
        throw new Error(
          "ensureConsumedReviewArtifactCleaned is not exposed by createReviewCompletionDomain",
        );
      }
      await ensure(staged, terminal);
    },
    readReplacementArtifact: () => files.readFile(reservation.artifactPath),
    durableFailureStaging: async () =>
      (await logStore.readAll()).find(
        (record): record is Extract<
          PersistedLogRecord,
          { readonly kind: "review_artifact_failure_staged" }
        > => record.kind === "review_artifact_failure_staged" && record.callId === callId,
      ),
    durableCleanupRecords: async () =>
      (await logStore.readAll()).filter(
        (record): record is Extract<PersistedLogRecord, { readonly kind: "review_artifact_cleanup" }> =>
          record.kind === "review_artifact_cleanup",
      ),
    durableGateDecisions: async () =>
      (await logStore.readAll()).filter(
        (record): record is GateDecision =>
          record.recordType === "decision" && "gateType" in record && record.gateType === "task",
      ),
    durableAcceptanceDecisions: async () =>
      (await logStore.readAll()).filter(
        (record): record is AcceptanceDecision =>
          record.recordType === "decision" &&
          "kind" in record &&
          (record.kind === "task-acceptance" || record.kind === "plan-acceptance"),
      ),
    durableRecords: () => logStore.readAll(),
    appendPendingRecord,
  };
}
