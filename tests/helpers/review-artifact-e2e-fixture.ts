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
import type { EvaluateRulesInput } from "../../src/core/acceptance-decision";
import { createReviewDispatchState } from "../../src/core/review-dispatch-state";
import type { ReviewCompletionInput } from "../../src/core/review-artifact";
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
import type {
  AcceptanceDecision,
  GateDecision,
  PendingDecisionRecord,
} from "../../src/core/v2/decision-model";
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
  /** Appends a durable decision record (used to seed historic/conflicting decisions). */
  readonly appendPendingDecision: (input: PendingDecisionRecord) => Promise<number>;
  readonly agentId: ObservationAgentId;
  readonly writerId: string;
  /** Deterministic PASS rule evaluator spy wired into the real Gate evaluator. */
  readonly evaluateRules: ReturnType<typeof vi.fn<(input: EvaluateRulesInput) => Promise<unknown>>>;
  /** Invalidates the seeded Authorization in the real AuthorizationStore (no boundary acquisition). */
  readonly revokeAuthorization: () => Promise<void>;
  /** Real review dispatch state machine sharing the fixture's log, store, and boundary. */
  readonly reviewDispatch: ReturnType<typeof createReviewDispatchState>;
  readonly injectReviewRequiredDirective: ReturnType<typeof vi.fn>;
  /** Spy over the real within-boundary Gate evaluator (results carry the advisory). */
  readonly gateEvaluation: ReturnType<
    typeof vi.fn<
      ReturnType<typeof createGatePendingAttemptEvaluator>["evaluateGatePendingAttemptWithinAuthorizationReviewBoundary"]
    >
  >;
  /** Consumes a review completion through the real completion domain with explicit input. */
  readonly consumeWith: (input: ReviewCompletionInput) => Promise<ReviewCompletionOutcome>;
  /** S3-b: the real completion domain (restart recovery entries). */
  readonly completion: ReturnType<typeof createReviewCompletionDomain>;
  /** S3-b: `sp-review` for the task scope, `sp-final-review` for the plan scope. */
  readonly expectedCategory: "sp-review" | "sp-final-review";
  /**
   * S3-b: injects a Lifecycle append fault. `fail` reports a failed append; `lose`
   * reports `committed` without persisting the record (readback cannot see it).
   */
  readonly setLifecycleAppendFault: (fault: LifecycleAppendFault) => void;
  /** S3-b: makes the next `claimed -> terminal` dispatch append report `failed`. */
  readonly failNextTerminalAppend: () => void;
  /** S3-b: spy for the Plan `complete` Authorization release side effect. */
  readonly releaseCompletedAuthorization: ReturnType<
    typeof vi.fn<(parentSessionId: string, authorizationId: string) => Promise<void>>
  >;
  /** S3-b: a complete review worker result carrying one finding. */
  readonly findingsReviewWorkerJson: string;
};

export type LifecycleAppendFault = (transition: {
  readonly from: string;
  readonly to: string;
}) => "fail" | "lose" | undefined;

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
  options: { readonly scope?: "task" | "plan" } = {},
): Promise<ReviewArtifactCompletionFixture> {
  const planScope = options.scope === "plan";
  const expectedCategory = planScope ? ("sp-final-review" as const) : ("sp-review" as const);
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
  const finalizationAttemptId = "finalization-review-artifact";
  const correlation: ReviewCorrelation = planScope
    ? {
        reviewKind: "final-review",
        planPath,
        authorizationId: authorization.authorizationId,
        planFingerprint: authorization.planFingerprint,
        finalizationAttemptId,
        finalReviewRound: 1,
      }
    : {
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
    expectedCategory,
    from: null,
    to: "pending",
  });
  await appendPendingRecord({
    ...envelope(),
    kind: "review_dispatch_transition",
    transitionId: "review-artifact-claimed",
    parentSessionId,
    correlation,
    expectedCategory,
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
        category: expectedCategory,
      },
      binding: {
        relationId: "review-artifact-execution",
        parentSessionId,
        parentCallId: callId,
        childSessionId,
        scope:
          correlation.reviewKind === "final-review"
            ? {
                kind: "finalization",
                planPath: correlation.planPath,
                authorizationId: correlation.authorizationId,
                planFingerprint: correlation.planFingerprint,
                finalizationAttemptId: correlation.finalizationAttemptId,
                finalReviewRound: correlation.finalReviewRound,
              }
            : {
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
  if (planScope) {
    // S3-b: seed the Finalization lifecycle into `final_review_pending`.
    for (const [from, to] of [
      ["tasks_pending", "all_tasks_accepted"],
      ["all_tasks_accepted", "final_review_pending"],
    ] as const) {
      await appendPendingRecord({
        ...envelope(),
        kind: "plan_finalization_transition",
        parentSessionId,
        authorizationId: authorization.authorizationId,
        planPath,
        finalizationAttemptId,
        finalReviewRound: 1,
        from,
        to,
      });
    }
  } else {
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
  }
  let lifecycleAppendFault: LifecycleAppendFault = () => undefined;
  let failTerminalAppend = false;

  // Resolve through the real AuthorizationStore so a durable revocation is observed.
  const findAuthorizationById: ReviewCompletionDependenciesForTest["findAuthorizationById"] = (
    id,
  ) => seedAuthorizationStore.findByAuthorizationId(id);
  const appendReviewDispatchTransition: ReviewCompletionDependenciesForTest["appendReviewDispatchTransition"] =
    async (input) => {
      if (failTerminalAppend && input.to === "terminal") {
        failTerminalAppend = false;
        return { kind: "failed" as const };
      }
      return { kind: "committed" as const, record: await appendPendingRecord(input) };
    };
  const appendTaskLifecycleTransition: ReviewCompletionDependenciesForTest["appendTaskLifecycleTransition"] =
    async (input) => {
      const fault = lifecycleAppendFault(input);
      if (fault === "fail") return { kind: "failed" as const };
      if (fault === "lose") return { kind: "committed" as const };
      await appendPendingRecord({ ...envelope(), kind: "task_lifecycle_transition", ...input });
      return { kind: "committed" as const };
    };
  const appendPlanFinalizationTransition: ReviewCompletionDependenciesForTest["appendPlanFinalizationTransition"] =
    async (input) => {
      const fault = lifecycleAppendFault(input);
      if (fault === "fail") return { kind: "failed" as const };
      if (fault === "lose") return { kind: "committed" as const };
      await appendPendingRecord({ ...envelope(), kind: "plan_finalization_transition", ...input });
      return { kind: "committed" as const };
    };
  const evaluateRules = vi.fn(async ({ context }: EvaluateRulesInput): Promise<unknown> =>
    context.scope === "task"
      ? {
          recordType: "decision" as const,
          gateType: "task" as const,
          taskId: context.taskExecutionRef.taskId,
          taskExecutionRef: context.taskExecutionRef,
          reviewRound: context.reviewRound,
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
        });
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
    evaluateRules: (input) =>
      evaluateRules(input) as ReturnType<
        Parameters<typeof createGatePendingAttemptEvaluator>[0]["evaluateRules"]
      >,
    recordAdvisory: async (advisory) => {
      await recordAdvisory(advisory);
    },
  });
  // Spy over the real Gate evaluator so tests can pin its blocked advisory.
  const gateEvaluation = vi.fn(gateEvaluator.evaluateGatePendingAttemptWithinAuthorizationReviewBoundary);
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
  const releaseCompletedAuthorization = vi.fn(
    async (_parentSessionId: string, _authorizationId: string): Promise<void> => undefined,
  );
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
    evaluateGatePendingAttemptWithinAuthorizationReviewBoundary: gateEvaluation,
    appendTaskLifecycleTransition,
    appendPlanFinalizationTransition,
    releaseCompletedAuthorization,
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
  let reservationCounter = 1;
  const injectReviewRequiredDirective = vi.fn(async (): Promise<void> => undefined);
  const reviewDispatch = createReviewDispatchState({
    readDurableRecords: () => logStore.readAll(),
    readDurableAuthorizations: () => seedAuthorizationStore.hydrate(),
    findAuthorizationById,
    appendReviewDispatchTransition,
    reserveReviewArtifact: async () => {
      reservationCounter += 1;
      const id = `review-artifact-${reservationCounter}`;
      const nextArtifactPath = `.justice/reviews/${id}.json`;
      const nextLeasePath = `.justice/reviews/.leases/${id}.json.lease`;
      const identity: ReviewArtifactInodeIdentity = { device: "mock-device", inode: id };
      files.writtenFiles[nextArtifactPath] = "";
      files.writtenFiles[nextLeasePath] = "";
      baseArtifactIo.reviewArtifactIdentities.set(nextArtifactPath, identity);
      baseArtifactIo.reviewArtifactIdentities.set(nextLeasePath, identity);
      return {
        status: "usable" as const,
        artifactId: id,
        artifactPath: nextArtifactPath,
        leasePath: nextLeasePath,
        artifactIdentity: identity,
      };
    },
    cleanupReviewArtifactReservation: async (usable) => {
      await baseArtifactIo.cleanup(usable);
    },
    injectReviewRequiredDirective,
    withAuthorizationReviewBoundary: boundary.withParentSession,
    hydrateAuthorizationsBeforeReviewRecovery: () => seedAuthorizationStore.hydrate(),
    recordAdvisory,
    generateId: () => `dispatch-${reservationCounter}-${Math.random().toString(36).slice(2)}`,
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
      reviewKind: correlation.reviewKind,
      reviewSource: expectedCategory,
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
      expectedCategory,
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
    appendPendingDecision: (input) => logStore.append(shard, input),
    agentId,
    writerId,
    evaluateRules,
    revokeAuthorization: async (): Promise<void> => {
      const result = await seedAuthorizationStore.invalidateForFingerprintWithinAuthorizationReviewBoundary(
        parentSessionId,
        authorization.authorizationId,
        { ...authorization.planFingerprint, value: `${authorization.planFingerprint.value}-revoked` },
        "2026-09-05T00:00:01.000Z",
      );
      if (result.kind !== "saved") {
        throw new Error(`completion fixture could not revoke Authorization: ${result.kind}`);
      }
    },
    reviewDispatch,
    injectReviewRequiredDirective,
    gateEvaluation,
    consumeWith: (input) => completion.consumeReviewCompletion(input),
    completion,
    expectedCategory,
    setLifecycleAppendFault: (fault) => {
      lifecycleAppendFault = fault;
    },
    failNextTerminalAppend: () => {
      failTerminalAppend = true;
    },
    releaseCompletedAuthorization,
    findingsReviewWorkerJson: JSON.stringify({
      schemaVersion: 1,
      complete: true,
      findings: [
        { itemKey: "finding-1", severity: "major", summary: "summary", location: "src/file.ts" },
      ],
    }),
  };
}
