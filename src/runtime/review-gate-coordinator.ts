/**
 * Review Gate coordinator (convergence Task 12 Phase B).
 *
 * Runtime seam that turns the pure `planReviewGateNextOperation` planner into
 * a durable, event-sourced execution loop:
 *
 * 1. append the required intent/evidence event (or durable dispatch record),
 * 2. gather only the typed evidence the operation needs,
 * 3. execute the one permitted side effect (dispatch a worker packet, append
 *    events, commit/restore through the mutation substrate),
 * 4. strict-parse the worker result,
 * 5. append typed completion/mutation events,
 * 6. reproject,
 * 7. derive the next operation.
 *
 * No in-memory retry state survives a session: durable Gate state comes from
 * the event projection plus the durable dispatch ledger; session maps retain
 * transient call/lock handles only. When the mutation substrate is
 * unavailable the coordinator operates in mutation-unavailable mode: side
 * effects that would mutate the workspace append a typed
 * `EXECUTION_SUSPENDED` event and return blocked guidance instead of falling
 * back to unsafe mutation.
 */

import type {
  ArtifactDigest,
  EpochId,
  GateId,
  LineageId,
  RemediationRound,
  ReviewApprovalBindingV1,
  ReviewArtifactBinding,
  ReviewGateEvent,
  ReviewGatePhase,
  ReviewScopeId,
  WriterId,
} from "../core/review-gate-types";
import type { HookEvent, HookResponse } from "../core/types";
import type { ReviewGateRequest } from "../core/review-gate-command";
import {
  PACKET_PAYLOAD_MARKER,
  parseReviewGateOperationResult,
  buildFindingValidatorOperationPacket,
  buildLineageRevalidationOperationPacket,
  buildNonConvergenceReentryOperationPacket,
  buildRemediationOperationPacket,
  buildReviewerOperationPacket,
  buildSelfReviewOperationPacket,
  type ReviewCandidateObservationV1,
  type ReviewGateOperationCorrelationSetupV1,
  type ReviewGateOperationPacketV1,
  type ReviewGateResultExpectationV1,
  type ReviewCandidatesResultV1,
  type FindingValidationResultV1,
  type RemediationResultV1,
  type SelfReviewResultV1,
  type LineageRevalidationResultV1,
  type NonConvergenceReentryResultV1,
} from "../core/review-gate/agent-protocol";
import {
  commitLineageRevalidation,
  reconcileFindingBatch,
  type ValidatedFinding,
} from "../core/review-gate/lineage";
import {
  planReviewGateNextOperation,
  type ReviewGateFindingValidationOutcome,
  type ReviewGateInFlightIntent,
  type ReviewGatePlanningArtifacts,
  type ReviewGatePlanningContext,
  type ReviewGateNextOperation,
  type ReviewGateRemediationCompletion,
  type ReviewGateReviewObservation,
  type ReviewGateSelfReviewCompletion,
} from "../core/review-gate/orchestrator";
import { projectReviewGate } from "../core/review-gate/projection";
  import type {
  ReviewGateProjection,
  ReviewTargetWorkspaceState,
} from "../core/review-gate/types";
import {
  createDefaultDeterministicValidatorRegistry,
  emptyDeterministicValidationState,
  executeValidationDispatch,
  type DeterministicValidationState,
  type MandatoryValidationDispatch,
  type ValidationEvidence,
  type ValidationInputKind,
  type ValidationInputValue,
} from "../core/review-gate/deterministic-validation";
import {
  canonicalizeArtifactPath,
  computeArtifactDigest,
  computeCanonicalJsonFingerprint,
  computeReviewScopeId,
} from "../core/review-gate/identity";
import type { ReviewGateDispatchRecordV1, ReviewGateEventStore } from "./review-gate-event-store";
import {
  acquireGateLockChain,
  type ReviewGateLockHandle,
  type ReviewGateLockManager,
} from "./review-gate-lock-manager";
import type { ReviewGateProtocolDescriptor } from "./review-gate-protocol";

export type ReviewGateCoordinatorLockPhase =
  | "reviewing"
  | "remediation"
  | "awaiting_implementation_authorization";

/** Tool-use classification input scoped to the lock-owning root session. */
export type ScopedReviewToolUse = Readonly<{
  readonly toolName: string;
  readonly isPendingReviewGateTask: boolean;
  readonly queryOnly: boolean;
  readonly changedPaths: readonly string[] | null;
}>;

export type ReviewCapabilityDecision =
  | Readonly<{ readonly kind: "allow" }>
  | Readonly<{
      readonly kind: "deny";
      readonly reason: "implementation_not_authorized" | "review_scope_violation";
    }>;

/** Structured result of `startOrResume`, consumed by the PlanBridge seam. */
export type ReviewGateCommandResult = Readonly<{
  readonly dispatched: boolean;
  readonly gateId: string | null;
  readonly guidance: string;
  /** First worker packet prompt when a dispatch was planned immediately. */
  readonly reviewerPrompt?: string;
  readonly designPath: string | null;
  readonly planPath: string | null;
  readonly designDigest: string | null;
  readonly planDigest: string | null;
  readonly lockPhase: ReviewGateCoordinatorLockPhase | null;
  /** True when an exactly-matching completed gate was reused read-only. */
  readonly completedReuse: boolean;
}>;

/** Read-only workspace byte access for artifact admission and digests. */
export interface ReviewGateWorkspaceReader {
  readonly readWorkspaceFile: (path: string) => Promise<Buffer | null>;
}

/**
 * The one permitted coordinator-side mutation substrate (CAP1/GIT1). `null`
 * selects mutation-unavailable mode: start/resume and reviews still work, but
 * commit/restore side effects append `EXECUTION_SUSPENDED` and return blocked
 * guidance instead of mutating.
 */
export interface ReviewGateMutationSubstrate {
  readonly commitArtifact: (
    phase: ReviewGatePhase,
    artifactPath: string,
  ) => Promise<Readonly<{ readonly commitSha: string }>>;
  readonly restoreArtifact: (targetPath: string) => Promise<void>;
}

export interface ReviewGateCoordinatorOptions {
  readonly eventStore: ReviewGateEventStore;
  readonly lockManager: ReviewGateLockManager;
  readonly protocol: ReviewGateProtocolDescriptor;
  readonly workspaceReader: ReviewGateWorkspaceReader;
  readonly mutationSubstrate?: ReviewGateMutationSubstrate | null;
  readonly inspectTargets: (
    paths: readonly string[],
  ) => Promise<ReadonlyMap<string, ReviewTargetWorkspaceState>>;
  readonly now?: () => string;
  readonly newId?: () => string;
  readonly newWriterId?: () => string;
}

export interface ReviewGateCoordinator {
  readonly startOrResume: (
    sessionId: string,
    request: ReviewGateRequest,
  ) => Promise<ReviewGateCommandResult>;
  readonly preToolUse: (
    event: Extract<HookEvent, { readonly type: "PreToolUse" }>,
  ) => Promise<HookResponse | null>;
  readonly postToolUse: (
    event: Extract<HookEvent, { readonly type: "PostToolUse" }>,
  ) => Promise<HookResponse | null>;
  readonly classifyToolUse: (
    rootSessionId: string | null,
    use: ScopedReviewToolUse,
  ) => ReviewCapabilityDecision | undefined;
  readonly releaseSession: (sessionId: string) => void;
}

const REVIEW_ARTIFACT_WRITE_TOOLS: ReadonlySet<string> = new Set([
  "edit",
  "write",
  "filesystem_edit_file",
  "filesystem_write_file",
  "apply_patch",
]);

const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  "read",
  "glob",
  "grep",
  "list",
  "lsp_symbols",
  "lsp_goto_definition",
  "lsp_find_references",
  "lsp_diagnostics",
  "justice_status",
  "skill",
]);

const MAX_DRIVE_ITERATIONS = 64;

/** Transient per-session orchestration state (call/lock handles only). */
interface MutableSessionState {
  readonly sessionId: string;
  readonly gateId: GateId;
  readonly designPath: string;
  readonly planPath: string;
  designDigest: string;
  planDigest: string;
  writerId: WriterId;
  epochId: EpochId;
  lockPhase: ReviewGateCoordinatorLockPhase;
  pending:
    | Readonly<{ readonly packet: ReviewGateOperationPacketV1; readonly callId: string | null }>
    | null;
  inFlight: ReviewGateInFlightIntent | null;
  reviewObserved: ReviewGateReviewObservation | null;
  readonly validatedFindings: ReviewGateFindingValidationOutcome[];
  remediationCompleted: ReviewGateRemediationCompletion | null;
  selfReviewPassed: ReviewGateSelfReviewCompletion | null;
  commitCompleted: Readonly<{ readonly phase: ReviewGatePhase; readonly artifactPath: string }> | null;
  resolutionsCommitted: Readonly<{ readonly lineageIds: readonly LineageId[] }> | null;
  preClearObserved: Readonly<{
    readonly validationEventId: string;
    readonly evidences: readonly ValidationEvidence[];
  }> | null;
  materialProgressObserved: boolean;
  workspaceStates: ReadonlyMap<string, ReviewTargetWorkspaceState>;
  validationState: DeterministicValidationState;
  reviewAttemptId: string | null;
  readonly scopeLock: ReviewGateLockHandle;
  readonly gateLock: ReviewGateLockHandle;
}

export function createReviewGateCoordinator(
  options: ReviewGateCoordinatorOptions,
): ReviewGateCoordinator {
  const eventStore = options.eventStore;
  const lockManager = options.lockManager;
  const protocol = options.protocol;
  const reader = options.workspaceReader;
  const mutation = options.mutationSubstrate ?? null;
  const inspectTargets = options.inspectTargets;
  const now = options.now ?? ((): string => new Date().toISOString());
  const randomId = options.newId ?? ((): string => globalThis.crypto.randomUUID());
  const newId = randomId;
  const newWriterId = options.newWriterId ?? ((): string => `rgw-${randomId()}`);

  /** sessionId → transient session state (call/lock handles only). */
  const sessions = new Map<string, MutableSessionState>();
  /** gateId → GATE_CREATED event cache for binding reconstruction. */
  const gateCreatedCache = new Map<
    GateId,
    Extract<ReviewGateEvent, { eventType: "GATE_CREATED" }>
  >();
  /** gateId\0operationId → physical dispatch serial. */
  const dispatchSerials = new Map<string, number>();

  const dropSession = (sessionId: string): MutableSessionState | undefined => {
    const state = sessions.get(sessionId);
    if (state === undefined) return undefined;
    sessions.delete(sessionId);
    return state;
  };

  const releaseHandles = (state: MutableSessionState): void => {
    state.scopeLock.release();
    state.gateLock.release();
  };

  const registerSession = (state: MutableSessionState): void => {
    sessions.set(state.sessionId, state);
  };

  const blockedResult = (
    designPath: string,
    planPath: string | null,
    guidance: string,
  ): ReviewGateCommandResult =>
    Object.freeze({
      dispatched: false,
      gateId: null,
      guidance,
      designPath,
      planPath,
      designDigest: null,
      planDigest: null,
      lockPhase: null,
      completedReuse: false,
    });

  const blockedInjection = (message: string): HookResponse => ({
    action: "inject",
    injectedContext: `[JUSTICE: REVIEW GATE BLOCKED] ${message}`,
  });

  const appendEvents = async (
    session: MutableSessionState,
    events: readonly Readonly<{
      readonly eventType: ReviewGateEvent["eventType"];
      readonly payload: object;
    }>[],
  ): Promise<void> => {
    if (events.length === 0) return;
    const stamped = events.map(
      (partial) =>
        ({
          eventType: partial.eventType,
          gateId: session.gateId,
          writerId: session.writerId,
          epochId: session.epochId,
          emittedAt: now(),
          payload: partial.payload,
        }) as ReviewGateEvent,
    );
    await eventStore.appendEvents(session.gateId, stamped);
  };

  const recordDispatch = async (
    session: MutableSessionState,
    packet: ReviewGateOperationPacketV1,
  ): Promise<void> => {
    const record: ReviewGateDispatchRecordV1 = {
      dispatchId: newId(),
      operationId: packet.operationId,
      operation: packet.operation,
      phase: packet.phase,
      dispatchedAt: now(),
      completedAt: null,
    };
    await eventStore.recordDispatch(session.gateId, record);
  };

  const loadProjection = async (gateId: GateId): Promise<ReviewGateProjection> => {
    const events = await eventStore.readEvents(gateId);
    const projection = projectReviewGate(events);
    const first = events[0];
    if (first !== undefined && first.eventType === "GATE_CREATED") {
      gateCreatedCache.set(gateId, first);
    }
    return projection;
  };

  const requireGateCreated = (
    gateId: GateId,
  ): Extract<ReviewGateEvent, { eventType: "GATE_CREATED" }> => {
    const cached = gateCreatedCache.get(gateId);
    if (cached === undefined) throw new Error("review_gate_gate_created_unavailable");
    return cached;
  };

  const recordCurrentArtifactBindings = async (
    session: MutableSessionState,
    phase: ReviewGatePhase,
    artifactPath: string,
  ): Promise<void> => {
    const [events, bytes] = await Promise.all([
      eventStore.readEvents(session.gateId),
      reader.readWorkspaceFile(artifactPath),
    ]);
    if (bytes === null) throw new Error("review_gate_committed_artifact_unreadable");
    const initial = requireGateCreated(session.gateId).payload;
    const latest = events
      .filter((event) => event.eventType === "ARTIFACT_BINDINGS_UPDATED")
      .at(-1);
    const designArtifact = latest?.eventType === "ARTIFACT_BINDINGS_UPDATED"
      ? latest.payload.designArtifact
      : initial.designArtifact;
    const planArtifact = latest?.eventType === "ARTIFACT_BINDINGS_UPDATED"
      ? latest.payload.planArtifact
      : initial.planArtifact;
    const updatedArtifact = {
      canonicalPath: artifactPath,
      digest: computeArtifactDigest(bytes),
      gitMode: "100644" as const,
    };
    if (phase === "design") session.designDigest = updatedArtifact.digest;
    else session.planDigest = updatedArtifact.digest;
    await appendEvents(session, [{
      eventType: "ARTIFACT_BINDINGS_UPDATED",
      payload: phase === "design"
        ? { designArtifact: updatedArtifact, planArtifact }
        : { designArtifact, planArtifact: updatedArtifact },
    }]);
  };

  const phaseArtifactBinding = (
    session: MutableSessionState,
    phase: ReviewGatePhase,
  ): ReviewArtifactBinding =>
    phase === "design"
      ? {
          canonicalPath: session.designPath,
          digest: session.designDigest as ArtifactDigest,
          gitMode: "100644",
        }
      : {
          canonicalPath: session.planPath,
          digest: session.planDigest as ArtifactDigest,
          gitMode: "100644",
        };

  const artifactRefsFor = (
    session: MutableSessionState,
    phase: ReviewGatePhase,
  ): readonly {
    readonly role: "requirements" | "design" | "plan";
    readonly canonicalPath: string;
    readonly digest: string;
  }[] => {
    const design = {
      role: "design" as const,
      canonicalPath: session.designPath,
      digest: session.designDigest,
    };
    const plan = {
      role: "plan" as const,
      canonicalPath: session.planPath,
      digest: session.planDigest,
    };
    // Design-phase operations pin Requirements + Design; the auto design
    // reference resolves the Requirements artifact to the Design file itself.
    const requirements = {
      role: "requirements" as const,
      canonicalPath: session.designPath,
      digest: session.designDigest,
    };
    return phase === "design" ? [requirements, design] : [design, plan];
  };

  const dispatchSerial = (session: MutableSessionState, operationId: string): number => {
    const key = `${session.gateId}\0${operationId}`;
    const existing = dispatchSerials.get(key);
    const next = existing === undefined ? 1 : existing + 1;
    dispatchSerials.set(key, next);
    return next;
  };

  const correlationFor = (
    session: MutableSessionState,
    args: Readonly<{
      readonly operationId: string;
      readonly phase: ReviewGatePhase;
      readonly reviewAttemptId: string | null;
      readonly remediationRound: RemediationRound | null;
    }>,
  ): ReviewGateOperationCorrelationSetupV1 =>
    Object.freeze({
      operationId: args.operationId,
      gateId: session.gateId,
      phase: args.phase,
      reviewAttemptId: args.reviewAttemptId,
      remediationRound: args.remediationRound,
      dispatchSerial: dispatchSerial(session, args.operationId),
    });

  const currentDigestOf = async (canonicalPath: string, fallback: string): Promise<string> => {
    // The completed binding is constructed from artifact identities reread
    // while the Gate lock is held (design spec §G1); remediated artifacts
    // must pin their committed post-image, not the admission digest. An
    // unreadable artifact keeps the durable genesis digest — the exact
    // current-match approval lookup then fails closed instead of guessing.
    const bytes = await reader.readWorkspaceFile(canonicalPath);
    if (bytes === null) return fallback;
    return computeArtifactDigest(bytes);
  };

  const buildApprovalBinding = async (
    session: MutableSessionState,
    projection: ReviewGateProjection,
  ): Promise<ReviewApprovalBindingV1> => {
    const gateCreated = requireGateCreated(session.gateId);
    const designDigest = await currentDigestOf(
      session.designPath,
      gateCreated.payload.designArtifact.digest,
    );
    const planDigest = await currentDigestOf(
      session.planPath,
      gateCreated.payload.planArtifact.digest,
    );
    const requirementsDigest = await currentDigestOf(
      gateCreated.payload.requirementsResolution.canonicalPath,
      gateCreated.payload.requirementsResolution.digest,
    );
    return Object.freeze({
      reviewScopeId: gateCreated.payload.reviewScopeId,
      gateId: projection.gateId,
      designArtifact: {
        ...gateCreated.payload.designArtifact,
        digest: designDigest as ArtifactDigest,
      },
      planArtifact: {
        ...gateCreated.payload.planArtifact,
        digest: planDigest as ArtifactDigest,
      },
      requirementsResolution: {
        ...gateCreated.payload.requirementsResolution,
        ...(gateCreated.payload.requirementsResolution.source === "auto_design_reference"
          ? { canonicalPath: session.designPath }
          : {}),
        digest: requirementsDigest as ArtifactDigest,
      },
      reviewProtocolFingerprint: protocol.reviewProtocolFingerprint,
      designProtocolFingerprint: protocol.designProtocolFingerprint,
      planProtocolFingerprint: protocol.planProtocolFingerprint,
      approvedAt: now(),
    });
  };

  const preClearDispatches = (
    session: MutableSessionState,
    projection: ReviewGateProjection,
  ): readonly MandatoryValidationDispatch[] => {
    const registry = createDefaultDeterministicValidatorRegistry();
    const gateCreated = requireGateCreated(session.gateId);
    const dispatches: MandatoryValidationDispatch[] = [];
    for (const validatorId of [
      "review-input-binding-integrity-v1",
      "design-requirements-reference-consistency-v1",
    ] as const) {
      const registered = registry.resolve(validatorId);
      if (registered === undefined) continue;
      if (!registered.descriptor.mandatoryStages.includes("PRE_CLEAR")) continue;
      if (!registered.descriptor.applicablePhases.includes(projection.phase)) continue;
      const pinnedInputDigests = {
        [session.designPath]: session.designDigest,
        [session.planPath]: session.planDigest,
      };
      const approvalBinding = {
        designArtifactPath: session.designPath,
        designArtifactDigest: session.designDigest,
        planArtifactPath: session.planPath,
        planArtifactDigest: session.planDigest,
      };
      const declaredInputs: Partial<Record<ValidationInputKind, ValidationInputValue>> =
        validatorId === "review-input-binding-integrity-v1"
          ? {
              PINNED_INPUT_DIGESTS: {
                digest: computeCanonicalJsonFingerprint(pinnedInputDigests),
                entries: pinnedInputDigests,
              },
              APPROVAL_BINDING: {
                digest: computeCanonicalJsonFingerprint(approvalBinding),
                entries: approvalBinding,
              },
              DESIGN_ARTIFACT: {
                digest: session.designDigest,
                entries: {},
              },
              PLAN_ARTIFACT: {
                digest: session.planDigest,
                entries: {},
              },
            }
          : {
            DESIGN_ARTIFACT: {
              digest: session.designDigest,
              entries: {
                requirementsReference: gateCreated.payload.requirementsResolution.canonicalPath,
              },
            },
            REQUIREMENTS_ARTIFACT: {
              digest: gateCreated.payload.requirementsResolution.digest,
              entries: { path: gateCreated.payload.requirementsResolution.canonicalPath },
            },
          };
      dispatches.push({
        validatorId,
        stage: "PRE_CLEAR",
        phase: projection.phase,
        logicalOperationId: newId(),
        binding: {
          validatorId,
          validatorContractVersion: registered.descriptor.validatorContractVersion,
          resultSchemaVersion: registered.descriptor.resultSchemaVersion,
          stage: "PRE_CLEAR",
          declaredInputs,
          executionEnvironment: {
            runtimeId: "justice-review-gate-coordinator",
            runtimeVersion: "1",
            executableDigest: protocol.reviewProtocolFingerprint,
          },
        },
      });
    }
    return dispatches;
  };

  const buildContext = async (
    session: MutableSessionState,
    projection: ReviewGateProjection,
  ): Promise<ReviewGatePlanningContext> => {
    const artifacts: ReviewGatePlanningArtifacts = Object.freeze({
      design: phaseArtifactBinding(session, "design"),
      plan: phaseArtifactBinding(session, "plan"),
    });
    const context: {
      readonly artifacts: ReviewGatePlanningArtifacts;
      inFlight?: ReviewGateInFlightIntent;
      reviewObserved?: ReviewGateReviewObservation;
      validatedFindings?: ReadonlyArray<ReviewGateFindingValidationOutcome>;
      remediationCompleted?: ReviewGateRemediationCompletion;
      selfReviewPassed?: ReviewGateSelfReviewCompletion;
      commitCompleted?: Readonly<{
        readonly phase: ReviewGatePhase;
        readonly artifactPath: string;
      }>;
      resolutionsCommitted?: Readonly<{ readonly lineageIds: readonly LineageId[] }>;
      readonly materialProgressObserved?: boolean;
      readonly workspaceStates?: ReadonlyMap<string, ReviewTargetWorkspaceState>;
      preClearValidation?: {
        readonly registry: ReturnType<typeof createDefaultDeterministicValidatorRegistry>;
        readonly state: DeterministicValidationState;
        readonly dispatches: readonly MandatoryValidationDispatch[];
      };
      preClearValidationObserved?: Readonly<{
        readonly validationEventId: string;
        readonly registry: ReturnType<typeof createDefaultDeterministicValidatorRegistry>;
        readonly evidences: readonly ValidationEvidence[];
      }>;
      readonly designClearFingerprint?: string;
      readonly preparedApprovalBinding?: ReviewApprovalBindingV1;
    } = {
      artifacts,
      workspaceStates: session.workspaceStates,
      materialProgressObserved: session.materialProgressObserved || undefined,
      designClearFingerprint: protocol.designProtocolFingerprint,
      preparedApprovalBinding: await buildApprovalBinding(session, projection),
    };
    if (session.inFlight !== null) context.inFlight = session.inFlight;
    if (session.reviewObserved !== null) context.reviewObserved = session.reviewObserved;
    if (session.validatedFindings.length > 0) {
      context.validatedFindings = [...session.validatedFindings];
    }
    if (session.remediationCompleted !== null) {
      context.remediationCompleted = session.remediationCompleted;
    }
    if (session.selfReviewPassed !== null) context.selfReviewPassed = session.selfReviewPassed;
    if (session.commitCompleted !== null) context.commitCompleted = session.commitCompleted;
    if (session.resolutionsCommitted !== null) {
      context.resolutionsCommitted = session.resolutionsCommitted;
    }
    if (session.preClearObserved !== null) {
      context.preClearValidationObserved = {
        validationEventId: session.preClearObserved.validationEventId,
        registry: createDefaultDeterministicValidatorRegistry(),
        evidences: session.preClearObserved.evidences,
      };
    } else {
      context.preClearValidation = {
        registry: createDefaultDeterministicValidatorRegistry(),
        state: session.validationState,
        dispatches: preClearDispatches(session, projection),
      };
    }
    return Object.freeze(context) as ReviewGatePlanningContext;
  };

  const buildPacketForOperation = (
    session: MutableSessionState,
    projection: ReviewGateProjection,
    op: ReviewGateNextOperation,
  ): ReviewGateOperationPacketV1 => {
    switch (op.kind) {
      case "dispatch_reviewer": {
        // AIM1: the coordinator mints identities. A redispatch keeps the
        // live attempt id; a restart lost it with the process, so the
        // redispatched reviewer operation mints a fresh attempt id while
        // continuing the identical durable logical dispatch.
        if (op.redispatchedOperationId === undefined || session.reviewAttemptId === null) {
          session.reviewAttemptId = newId();
        }
        return buildReviewerOperationPacket({
          correlation: correlationFor(session, {
            operationId: op.redispatchedOperationId ?? newId(),
            phase: op.phase,
            reviewAttemptId: session.reviewAttemptId,
            remediationRound: null,
          }),
          artifactRefs: artifactRefsFor(session, op.phase),
        });
      }
      case "dispatch_finding_validator":
        return buildFindingValidatorOperationPacket({
          correlation: correlationFor(session, {
            operationId: op.redispatchedOperationId ?? newId(),
            phase: op.phase,
            reviewAttemptId: session.reviewAttemptId,
            remediationRound: null,
          }),
          candidate: op.candidate,
          artifactRefs: artifactRefsFor(session, op.phase),
          opaqueExistingLineageRefs: [...projection.currentRemediableBlockers],
        });
      case "dispatch_self_review":
        return buildSelfReviewOperationPacket({
          correlation: correlationFor(session, {
            operationId: op.redispatchedOperationId ?? newId(),
            phase: op.phase,
            reviewAttemptId: null,
            remediationRound: op.round,
          }),
          targetLineageRefs: [...op.lineageIds],
          existingLineageCandidateRefs: [...projection.currentRemediableBlockers],
          artifactRefs: artifactRefsFor(session, op.phase),
        });
      case "dispatch_lineage_revalidation":
        return buildLineageRevalidationOperationPacket({
          correlation: correlationFor(session, {
            operationId: op.redispatchedOperationId ?? newId(),
            phase: projection.phase,
            reviewAttemptId: null,
            remediationRound: null,
          }),
          lineageId: op.lineageId,
          artifactRefs: artifactRefsFor(session, projection.phase),
        });
      case "validate_non_convergence_reentry":
        return buildNonConvergenceReentryOperationPacket({
          correlation: correlationFor(session, {
            operationId: op.redispatchedOperationId ?? newId(),
            phase: op.phase,
            reviewAttemptId: null,
            remediationRound: null,
          }),
          changedArtifacts: artifactRefsFor(session, op.phase),
          blockingLineageRefs: [...projection.currentRemediableBlockers],
        });
      case "start_remediation":
      case "recover_remediation": {
        const binding = phaseArtifactBinding(session, op.phase);
        const targetArtifact = {
          role: op.phase,
          canonicalPath: binding.canonicalPath,
          digest: binding.digest,
        } as const;
        const authorityArtifacts =
          op.phase === "design"
            ? [
                {
                  role: "requirements" as const,
                  canonicalPath: session.designPath,
                  digest: session.designDigest,
                },
              ]
            : [
                {
                  role: "design" as const,
                  canonicalPath: session.designPath,
                  digest: session.designDigest,
                },
              ];
        return buildRemediationOperationPacket({
          correlation: correlationFor(session, {
            operationId: newId(),
            phase: op.phase,
            reviewAttemptId: null,
            remediationRound: op.round,
          }),
          authorityArtifacts,
          targetArtifact,
        });
      }
      default:
        throw new Error(`review_gate_operation_not_dispatchable: ${op.kind}`);
    }
  };

  const injectPacket = (
    session: MutableSessionState,
    packet: ReviewGateOperationPacketV1,
  ): HookResponse => {
    session.pending = Object.freeze({ packet, callId: null });
    session.inFlight = intentForPacket(session, packet);
    return {
      action: "inject",
      injectedContext: packet.workerPrompt,
      modifiedPayload: {
        args: {
          subagent_type: packet.workerAgent,
          description: `Justice Gate operation ${packet.operationId}`,
          prompt: packet.workerPrompt,
          load_skills: [],
          run_in_background: false,
        },
      },
    };
  };

  const intentForPacket = (
    session: MutableSessionState,
    packet: ReviewGateOperationPacketV1,
  ): ReviewGateInFlightIntent => {
    switch (packet.operation) {
      case "review_candidates":
        return Object.freeze({
          kind: "external_operation_dispatched",
          operation: "reviewer",
          phase: packet.phase,
          operationId: packet.operationId,
        });
      case "finding_validation":
        return Object.freeze({
          kind: "external_operation_dispatched",
          operation: "finding_validator",
          phase: packet.phase,
          operationId: packet.operationId,
        });
      case "self_review":
        return Object.freeze({
          kind: "external_operation_dispatched",
          operation: "self_review",
          phase: packet.phase,
          operationId: packet.operationId,
        });
      case "lineage_revalidation":
        return Object.freeze({
          kind: "external_operation_dispatched",
          operation: "lineage_revalidation",
          phase: packet.phase,
          operationId: packet.operationId,
        });
      case "non_convergence_reentry":
        return Object.freeze({
          kind: "external_operation_dispatched",
          operation: "non_convergence_reentry",
          phase: packet.phase,
          operationId: packet.operationId,
        });
      case "remediation":
        return Object.freeze({
          kind: "remediation_started",
          phase: packet.phase,
          round: packet.remediationRound ?? { phase: packet.phase, ordinal: 1 },
          lineageIds: [...(session.remediationCompleted?.lineageIds ?? [])],
          worktreeMatchesPreImage: true,
        });
      case "cross_generation_reconciliation":
        throw new Error(
          "review_gate_operation_not_dispatchable: cross_generation_reconciliation",
        );
    }
  };

  const suspendAndBlock = async (
    session: MutableSessionState,
    reason: string,
    message: string,
  ): Promise<HookResponse> => {
    await appendEvents(session, [{ eventType: "EXECUTION_SUSPENDED", payload: { reason } }]);
    session.lockPhase = "remediation";
    session.pending = null;
    session.inFlight = null;
    return blockedInjection(message);
  };

  const withWorkspaceState = (
    states: ReadonlyMap<string, ReviewTargetWorkspaceState>,
    path: string,
    state: ReviewTargetWorkspaceState,
  ): ReadonlyMap<string, ReviewTargetWorkspaceState> => {
    const next = new Map(states);
    next.set(path, state);
    return next;
  };

  // ---------------------------------------------------------------------------
  // The drive loop: plan → side effect → reproject → next
  // ---------------------------------------------------------------------------

  const drive = async (session: MutableSessionState): Promise<HookResponse | null> => {
    for (let iteration = 0; iteration < MAX_DRIVE_ITERATIONS; iteration += 1) {
      const projection = await loadProjection(session.gateId);
      const context = await buildContext(session, projection);
      let op: ReviewGateNextOperation;
      try {
        op = planReviewGateNextOperation(projection, context);
      } catch (err) {
        return blockedInjection(
          `the gate planner rejected the current state: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      switch (op.kind) {
        case "dispatch_reviewer":
        case "dispatch_finding_validator":
        case "dispatch_self_review":
        case "dispatch_lineage_revalidation":
        case "validate_non_convergence_reentry": {
          // The fresh review dispatch consumes the resolution-commit evidence;
          // keeping it would re-plan dispatch_reviewer forever.
          if (op.kind === "dispatch_reviewer" && session.resolutionsCommitted !== null) {
            session.resolutionsCommitted = null;
          }
          const packet = buildPacketForOperation(session, projection, op);
          // A redispatch continues the already-durable logical dispatch;
          // re-recording it with fresh envelope fields would conflict instead
          // of resuming the crashed attempt exactly once.
        if (op.redispatchedOperationId === undefined) {
            await recordDispatch(session, packet);
          }
          return injectPacket(session, packet);
        }
        case "start_remediation":
        case "recover_remediation": {
          session.remediationCompleted = null;
          session.selfReviewPassed = null;
          session.commitCompleted = null;
          session.resolutionsCommitted = null;
          const packet = buildPacketForOperation(session, projection, op);
          await recordDispatch(session, packet);
          const response = injectPacket(session, packet);
          // The round's target lineages come from the planned operation;
          // default packet-derived intents carry none.
          session.inFlight = Object.freeze({
            kind: "remediation_started",
            phase: op.phase,
            round: op.round,
            lineageIds: [...op.lineageIds],
            worktreeMatchesPreImage: true,
          });
          session.lockPhase = "remediation";
          return response;
        }
        case "commit_finding_reconciliation": {
          let payload: ReturnType<typeof reconcileFindingBatch>;
          try {
            payload = reconcileFindingBatch(projection, op.batch);
          } catch (error: unknown) {
            const reason = error instanceof Error ? error.message : String(error);
            return suspendAndBlock(
              session,
              reason === "validator_result_conflict" ? "VALIDATOR_RESULT_CONFLICT" : "FINDING_RECONCILIATION_FAILED",
              "the validated finding batch conflicts with tracked lineage state; the Gate is suspended.",
            );
          }
          await appendEvents(
            session,
            payload.events.map((event) => ({
              eventType: event.eventType,
              payload: event.payload,
            })),
          );
          session.reviewObserved = null;
          session.validatedFindings.length = 0;
          session.preClearObserved = null;
          continue;
        }
        case "prepare_commit": {
          if (mutation === null) {
            return suspendAndBlock(
              session,
              "mutation_unavailable",
              "the native mutation substrate is unavailable; the reviewed artifact cannot be committed safely. Restore the mutation substrate and rerun /justice-review-gate.",
            );
          }
          try {
            await mutation.commitArtifact(op.phase, op.artifactPath);
          } catch (err) {
            return suspendAndBlock(
              session,
              "commit_failed",
              `the exact-artifact commit failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
          await recordCurrentArtifactBindings(session, op.phase, op.artifactPath);
          session.commitCompleted = Object.freeze({
            phase: op.phase,
            artifactPath: op.artifactPath,
          });
          session.selfReviewPassed = null;
          session.workspaceStates = withWorkspaceState(
            session.workspaceStates,
            op.artifactPath,
            "clean_committed",
          );
          continue;
        }
        case "recover_commit": {
          if (mutation === null) {
            return suspendAndBlock(
              session,
              "mutation_unavailable",
              "the native mutation substrate is unavailable; commit recovery is not possible.",
            );
          }
          try {
            await mutation.commitArtifact(op.phase, op.artifactPath);
          } catch (err) {
            return suspendAndBlock(
              session,
              "commit_failed",
              `the exact-artifact commit recovery failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
          await recordCurrentArtifactBindings(session, op.phase, op.artifactPath);
          session.commitCompleted = Object.freeze({
            phase: op.phase,
            artifactPath: op.artifactPath,
          });
          continue;
        }
        case "commit_resolutions": {
          session.resolutionsCommitted = Object.freeze({ lineageIds: [...op.lineageIds] });
          // The commit evidence is consumed by this step; keeping it would
          // re-plan commit_resolutions forever (drive_iteration_exhausted).
          session.commitCompleted = null;
          continue;
        }
        case "prepare_restore":
        case "recover_restore": {
          if (mutation === null) {
            return suspendAndBlock(
              session,
              "mutation_unavailable",
              "the native mutation substrate is unavailable; the drifted artifact cannot be restored safely.",
            );
          }
          try {
            await mutation.restoreArtifact(op.targetPath);
          } catch (err) {
            return suspendAndBlock(
              session,
              "restore_failed",
              `the exact-artifact restore failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
          session.workspaceStates = withWorkspaceState(
            session.workspaceStates,
            op.targetPath,
            "clean_committed",
          );
          session.inFlight = null;
          continue;
        }
        case "append_reopen": {
          await appendEvents(session, [
            {
              eventType: "REOPEN_REQUIRED",
              payload: { phase: op.phase, lineageIds: [...op.lineageIds] },
            },
          ]);
          continue;
        }
        case "run_pre_clear_validation": {
          const registry = createDefaultDeterministicValidatorRegistry();
          const evidences: ValidationEvidence[] = [];
          let validationState: DeterministicValidationState = session.validationState;
          for (const requirement of op.schedule.requirements) {
            if (requirement.disposition === "reuse_evidence" && requirement.evidence !== null) {
              evidences.push(requirement.evidence);
              continue;
            }
            if (requirement.dispatch === null) continue;
            const evidence = executeValidationDispatch(registry, requirement.dispatch, now());
            evidences.push(evidence);
            validationState = {
              cachedEvidence: new Map([
                ...validationState.cachedEvidence,
                [evidence.cacheKey, evidence],
              ]),
              attemptEnvironments: validationState.attemptEnvironments,
            };
          }
          session.preClearObserved = Object.freeze({
            validationEventId: newId(),
            evidences: Object.freeze(evidences),
          });
          session.validationState = validationState;
          continue;
        }
        case "append_design_clear": {
          await appendEvents(session, [
            {
              eventType: "DESIGN_CLEAR",
              payload: { designProtocolFingerprint: op.designProtocolFingerprint },
            },
          ]);
          session.preClearObserved = null;
          session.reviewObserved = null;
          session.validatedFindings.length = 0;
          continue;
        }
        case "append_plan_clear": {
          // The PLAN_CLEAR milestone plus the terminal completed binding: the
          // reducer only reaches status "completed" on COMPLETED_APPROVAL_BINDING.
          await appendEvents(session, [
            {
              eventType: "PLAN_CLEAR",
              payload: { completedApprovalBinding: op.approvalBinding },
            },
            {
              eventType: "COMPLETED_APPROVAL_BINDING",
              payload: { approvalBinding: op.approvalBinding },
            },
          ]);
          continue;
        }
        case "suspended": {
          if (projection.status !== "suspended") {
            if (op.reason === "review_non_convergent" && op.nonConvergent !== undefined) {
              await appendEvents(session, [
                {
                  eventType: "REVIEW_NON_CONVERGENT",
                  payload: {
                    phase: op.nonConvergent.phase,
                    lineageIds: [...op.nonConvergent.lineageIds],
                  },
                },
              ]);
            } else if (op.reason === "round_limit_exhausted") {
              await appendEvents(session, [
                {
                  eventType: "ROUND_LIMIT_EXHAUSTED",
                  payload: {
                    phase: projection.phase,
                    roundLimit:
                      projection.phase === "design"
                        ? projection.designRemediationRounds.length
                        : projection.planRemediationRounds.length,
                  },
                },
              ]);
            } else if (op.reason === "execution_suspended") {
              await appendEvents(session, [
                {
                  eventType: "EXECUTION_SUSPENDED",
                  payload: { reason: op.detail ?? "execution_suspended" },
                },
              ]);
            }
          }
          session.lockPhase = "remediation";
          return blockedInjection(
            `the Review Gate is suspended (${op.reason}); address the blocking condition and rerun /justice-review-gate.`,
          );
        }
        case "completed": {
          session.lockPhase = "awaiting_implementation_authorization";
          session.pending = null;
          session.inFlight = null;
          return {
            action: "inject",
            injectedContext: [
              "---",
              "[JUSTICE: REVIEW GATE CLEAR]",
              "",
              "The Review Gate completed with an approval binding. Implementation authorization still requires the explicit user command:",
              `/justice-implement --plan ${session.planPath} --approved`,
              "---",
            ].join("\n"),
          };
        }
      }
    }
    return suspendAndBlock(
      session,
      "drive_iteration_exhausted",
      "the Review Gate loop did not converge within the bounded iteration budget.",
    );
  };

  // ---------------------------------------------------------------------------
  // startOrResume
  // ---------------------------------------------------------------------------

  const startOrResume = async (
    sessionId: string,
    request: ReviewGateRequest,
  ): Promise<ReviewGateCommandResult> => {
    const designPath = canonicalizeArtifactPath(request.designPath);
    const planPath = canonicalizeArtifactPath(request.planPath);
    if (designPath === null || planPath === null) {
      return blockedResult(
        request.designPath,
        planPath,
        "[JUSTICE: REVIEW GATE BLOCKED] Design/Plan paths are not safe relative artifact paths; fix the paths and rerun /justice-review-gate.",
      );
    }

    const designBytes = await reader.readWorkspaceFile(designPath);
    const planBytes = await reader.readWorkspaceFile(planPath);
    if (designBytes === null || planBytes === null) {
      const missing = [
        designBytes === null ? "Design" : null,
        planBytes === null ? "Implementation Plan" : null,
      ]
        .filter((name): name is string => name !== null)
        .join(", ");
      return blockedResult(
        request.designPath,
        planPath,
        `[JUSTICE: REVIEW GATE BLOCKED] Unreadable artifacts: ${missing}. Fix the artifact paths/readability and rerun /justice-review-gate. Do not start implementation.`,
      );
    }
    const designDigest = computeArtifactDigest(designBytes);
    const planDigest = computeArtifactDigest(planBytes);
    const reviewScopeId: ReviewScopeId = computeReviewScopeId(designPath, planPath);

    const existingGateIdRaw = await eventStore.readScopeIndex(reviewScopeId);
    if (existingGateIdRaw !== null) {
      const existingGateId = existingGateIdRaw as GateId;
      const projection = await loadProjection(existingGateId);
      const gateCreated = requireGateCreated(existingGateId);
      const latestBindingEvent = (await eventStore.readEvents(existingGateId))
        .filter((event) => event.eventType === "ARTIFACT_BINDINGS_UPDATED")
        .at(-1);
      const latestDesignArtifact =
        latestBindingEvent?.eventType === "ARTIFACT_BINDINGS_UPDATED"
          ? latestBindingEvent.payload.designArtifact
          : gateCreated.payload.designArtifact;
      const latestPlanArtifact =
        latestBindingEvent?.eventType === "ARTIFACT_BINDINGS_UPDATED"
          ? latestBindingEvent.payload.planArtifact
          : gateCreated.payload.planArtifact;
      const expectedDesignArtifact =
        projection.status === "completed"
          ? projection.approvalBinding?.designArtifact
          : latestDesignArtifact;
      const expectedPlanArtifact =
        projection.status === "completed"
          ? projection.approvalBinding?.planArtifact
          : latestPlanArtifact;
      const bindingsMatch =
        expectedDesignArtifact !== undefined &&
        expectedPlanArtifact !== undefined &&
        expectedDesignArtifact.digest === designDigest &&
        expectedPlanArtifact.digest === planDigest &&
        expectedDesignArtifact.canonicalPath === designPath &&
        expectedPlanArtifact.canonicalPath === planPath;

      if (projection.status === "completed" && bindingsMatch) {
        // Exact completed binding: read-only reuse — no lock acquisition, no
        // writer allocation, no append.
        const previous = dropSession(sessionId);
        if (previous !== undefined) releaseHandles(previous);
        return Object.freeze({
          dispatched: false,
          gateId: existingGateId,
          guidance: [
            "---",
            "[JUSTICE: REVIEW GATE CLEAR]",
            "",
            "An exactly matching completed Review Gate was reused read-only. Implementation authorization still requires the explicit user command:",
            `/justice-implement --plan ${planPath} --approved`,
            "---",
          ].join("\n"),
          designPath,
          planPath,
          designDigest,
          planDigest,
          lockPhase: "awaiting_implementation_authorization",
          completedReuse: true,
        });
      }
      if (projection.status !== "completed" && bindingsMatch) {
        return resumeExistingGate(
          sessionId,
          existingGateId,
          reviewScopeId,
          designPath,
          planPath,
          designDigest,
          planDigest,
        );
      }
    }

    return createNewGate(
      sessionId,
      reviewScopeId,
      designPath,
      planPath,
      designDigest,
      planDigest,
    );
  };

  const resumeExistingGate = async (
    sessionId: string,
    gateId: GateId,
    reviewScopeId: ReviewScopeId,
    designPath: string,
    planPath: string,
    designDigest: string,
    planDigest: string,
  ): Promise<ReviewGateCommandResult> => {
    const previous = dropSession(sessionId);
    if (previous !== undefined) releaseHandles(previous);

    const chain = await acquireGateLockChain(lockManager, reviewScopeId, gateId);
    if (chain.kind === "occupied") {
      return Object.freeze({
        dispatched: false,
        gateId,
        guidance:
          "[JUSTICE: REVIEW GATE BLOCKED] The Gate or scope lock is held by another orchestration; retry after it is released.",
        designPath,
        planPath,
        designDigest,
        planDigest,
        lockPhase: "remediation",
        completedReuse: false,
      });
    }

    // Fresh writer shard + new epoch for the resumed orchestration.
    const writerId = newWriterId() as WriterId;
    const epochId = newId() as EpochId;
    const session: MutableSessionState = {
      sessionId,
      gateId,
      designPath,
      planPath,
      designDigest,
      planDigest,
      writerId,
      epochId,
      lockPhase: "reviewing",
      pending: null,
      inFlight: null,
      reviewObserved: null,
      validatedFindings: [],
      remediationCompleted: null,
      selfReviewPassed: null,
      commitCompleted: null,
      resolutionsCommitted: null,
      preClearObserved: null,
      materialProgressObserved: false,
      workspaceStates: await inspectTargets([designPath, planPath]),
      validationState: emptyDeterministicValidationState,
      reviewAttemptId: null,
      scopeLock: chain.scopeLock,
      gateLock: chain.gateLock,
    };
    registerSession(session);

    await eventStore.appendEvents(gateId, [
      {
        eventType: "ORCHESTRATION_RESUMED",
        gateId,
        writerId,
        epochId,
        emittedAt: now(),
        payload: { resumedAt: now() },
      } as ReviewGateEvent,
    ]);

    // Crash-window recovery: an uncompleted durable dispatch re-enters the
    // loop as an in-flight intent with the identical logical operation id.
    session.inFlight = await reconstructInFlight(session);

    const response = await drive(session);
    return commandResultFromResponse(session, response);
  };

  const reconstructInFlight = async (
    session: MutableSessionState,
  ): Promise<ReviewGateInFlightIntent | null> => {
    const dispatches = await eventStore.listDispatches(session.gateId);
    const uncompleted = dispatches.filter((record) => record.completedAt === null);
    const latest = uncompleted.at(-1);
    if (latest === undefined) return null;
    const phase = latest.phase;
    switch (latest.operation) {
      case "review_candidates":
        return Object.freeze({
          kind: "external_operation_dispatched",
          operation: "reviewer",
          phase,
          operationId: latest.operationId,
        });
      case "self_review": {
        const projection = await loadProjection(session.gateId);
        const rounds =
          phase === "design"
            ? projection.designRemediationRounds
            : projection.planRemediationRounds;
        const last = rounds.at(-1);
        if (last === undefined) return null;
        return Object.freeze({
          kind: "external_operation_dispatched",
          operation: "self_review",
          phase,
          operationId: latest.operationId,
          round: last,
          lineageIds: [...projection.pendingRevalidationBlockers],
        });
      }
      case "lineage_revalidation": {
        const projection = await loadProjection(session.gateId);
        const lineageId = projection.pendingRevalidationBlockers[0];
        if (lineageId === undefined) return null;
        return Object.freeze({
          kind: "external_operation_dispatched",
          operation: "lineage_revalidation",
          phase,
          operationId: latest.operationId,
          lineageId,
        });
      }
      case "non_convergence_reentry":
        return Object.freeze({
          kind: "external_operation_dispatched",
          operation: "non_convergence_reentry",
          phase,
          operationId: latest.operationId,
        });
      case "finding_validation":
      case "cross_generation_reconciliation":
      case "remediation":
        // The candidate/target evidence is not reconstructable from the
        // durable dispatch record alone; suspend instead of guessing.
        await eventStore.markDispatchCompleted(session.gateId, latest.operationId);
        await appendEvents(session, [
          {
            eventType: "EXECUTION_SUSPENDED",
            payload: { reason: "REDISPATCH_EVIDENCE_UNAVAILABLE" },
          },
        ]);
        return null;
    }
  };

  const createNewGate = async (
    sessionId: string,
    reviewScopeId: ReviewScopeId,
    designPath: string,
    planPath: string,
    designDigest: string,
    planDigest: string,
  ): Promise<ReviewGateCommandResult> => {
    // RR1 + target-clean admission BEFORE GATE_CREATED.
    let workspaceStates: ReadonlyMap<string, ReviewTargetWorkspaceState>;
    try {
      workspaceStates = await inspectTargets([designPath, planPath]);
    } catch {
      return blockedResult(
        designPath,
        planPath,
        "[JUSTICE: REVIEW GATE BLOCKED] The Design and Implementation Plan targets could not be inspected; retry after workspace inspection is available.",
      );
    }
    const designState = workspaceStates.get(designPath);
    if (designState === undefined) {
      return blockedResult(
        designPath,
        planPath,
        "[JUSTICE: REVIEW GATE BLOCKED] The Design target could not be verified; retry after workspace inspection is available.",
      );
    }
    if (designState !== "clean_committed") {
      return blockedResult(
        designPath,
        planPath,
        `[JUSTICE: REVIEW GATE BLOCKED] The Design target is not clean/committed (${designState}); commit or restore it before starting the Review Gate.`,
      );
    }
    const planState = workspaceStates.get(planPath);
    if (planState === undefined) {
      return blockedResult(
        designPath,
        planPath,
        "[JUSTICE: REVIEW GATE BLOCKED] The Implementation Plan target could not be verified; retry after workspace inspection is available.",
      );
    }
    if (planState !== "clean_committed") {
      return blockedResult(
        designPath,
        planPath,
        `[JUSTICE: REVIEW GATE BLOCKED] The Implementation Plan target is not clean/committed (${planState}); commit or restore it before starting the Review Gate.`,
      );
    }

    const gateId = newId() as GateId;
    const previous = dropSession(sessionId);
    if (previous !== undefined) releaseHandles(previous);
    const chain = await acquireGateLockChain(lockManager, reviewScopeId, gateId);
    if (chain.kind === "occupied") {
      return Object.freeze({
        dispatched: false,
        gateId: null,
        guidance:
          "[JUSTICE: REVIEW GATE BLOCKED] The scope lock is held by another orchestration; retry after it is released.",
        designPath,
        planPath,
        designDigest,
        planDigest,
        lockPhase: "remediation",
        completedReuse: false,
      });
    }

    const writerId = newWriterId() as WriterId;
    const epochId = newId() as EpochId;
    const gateCreated: ReviewGateEvent = {
      eventType: "GATE_CREATED",
      gateId,
      writerId,
      epochId,
      emittedAt: now(),
      payload: {
        reviewScopeId,
        designArtifact: {
          canonicalPath: designPath,
          digest: designDigest,
          gitMode: "100644",
        },
        planArtifact: { canonicalPath: planPath, digest: planDigest, gitMode: "100644" },
        requirementsResolution: {
          source: "auto_design_reference",
          canonicalPath: designPath,
          digest: designDigest,
        },
        reviewProtocolFingerprint: protocol.reviewProtocolFingerprint,
      },
    } as ReviewGateEvent;
    gateCreatedCache.set(
      gateId,
      gateCreated as Extract<ReviewGateEvent, { eventType: "GATE_CREATED" }>,
    );

    const session: MutableSessionState = {
      sessionId,
      gateId,
      designPath,
      planPath,
      designDigest,
      planDigest,
      writerId,
      epochId,
      lockPhase: "reviewing",
      pending: null,
      inFlight: null,
      reviewObserved: null,
      validatedFindings: [],
      remediationCompleted: null,
      selfReviewPassed: null,
      commitCompleted: null,
      resolutionsCommitted: null,
      preClearObserved: null,
      materialProgressObserved: false,
      workspaceStates,
      validationState: emptyDeterministicValidationState,
      reviewAttemptId: null,
      scopeLock: chain.scopeLock,
      gateLock: chain.gateLock,
    };
    registerSession(session);

    await eventStore.appendEvents(gateId, [gateCreated]);
    await eventStore.writeScopeIndex(reviewScopeId, gateId);

    const response = await drive(session);
    return commandResultFromResponse(session, response);
  };

  const commandResultFromResponse = (
    session: MutableSessionState,
    response: HookResponse | null,
  ): ReviewGateCommandResult => {
    const firstPacket = session.pending?.packet;
    const dispatched = firstPacket !== undefined && firstPacket.operation === "review_candidates";
    return Object.freeze({
      dispatched,
      gateId: session.gateId,
      guidance:
        response?.action === "inject"
          ? response.injectedContext
          : "[JUSTICE: REVIEW GATE BLOCKED] The Review Gate could not plan a first operation.",
      ...(dispatched && firstPacket !== undefined
        ? { reviewerPrompt: firstPacket.workerPrompt }
        : {}),
      designPath: session.designPath,
      planPath: session.planPath,
      designDigest: session.designDigest,
      planDigest: session.planDigest,
      lockPhase: session.lockPhase,
      completedReuse: false,
    });
  };

  // ---------------------------------------------------------------------------
  // PreToolUse: bind the worker call to the durable operation id
  // ---------------------------------------------------------------------------

  const preToolUse = async (
    event: Extract<HookEvent, { readonly type: "PreToolUse" }>,
  ): Promise<HookResponse | null> => {
    if (event.payload.toolName !== "task") return null;
    const prompt = event.payload.toolInput.prompt;
    if (typeof prompt !== "string" || !prompt.includes(PACKET_PAYLOAD_MARKER)) return null;

    // Bind by the exact pending packet prompt (strictest correlation): the
    // packet payload is worker data; the packet envelope carries the durable
    // operation id and stays in the coordinator's session state.
    const candidates = [...sessions.values()].filter(
      (state) =>
        state.pending !== null &&
        state.pending.packet.workerPrompt === prompt &&
        state.pending.callId === null,
    );
    if (candidates.length !== 1) {
      return blockedInjection(
        candidates.length === 0
          ? "no pending operation packet matches this claimed prompt."
          : "the operation is claimed ambiguously; the Gate is blocked.",
      );
    }
    const session = candidates[0];
    if (session === undefined) {
      return blockedInjection("no pending operation packet matches this claimed prompt.");
    }
    const pending = session.pending;
    if (pending === null) {
      return blockedInjection("no pending operation packet matches this claimed prompt.");
    }
    if (event.callId === undefined || event.callId.trim().length === 0) {
      return blockedInjection(
        "callId missing; the worker call cannot be bound to the durable dispatch.",
      );
    }

    session.pending = Object.freeze({ packet: pending.packet, callId: event.callId });
    return {
      action: "inject",
      injectedContext: `[JUSTICE: REVIEW GATE OPERATION CLAIMED] ${pending.packet.operationId}`,
      modifiedPayload: {
        args: {
          subagent_type: pending.packet.workerAgent,
          description: `Justice Gate operation ${pending.packet.operationId}`,
          prompt: pending.packet.workerPrompt,
          load_skills: [],
          run_in_background: false,
        },
      },
    };
  };

  // ---------------------------------------------------------------------------
  // PostToolUse: strict-parse, append completion events, reproject, re-drive
  // ---------------------------------------------------------------------------

  const postToolUse = async (
    event: Extract<HookEvent, { readonly type: "PostToolUse" }>,
  ): Promise<HookResponse | null> => {
    if (event.payload.toolName !== "task") return null;
    const callId = event.callId;
    if (callId === undefined) return null;

    const session = [...sessions.values()].find(
      (state) => state.pending !== null && state.pending.callId === callId,
    );
    if (session === undefined || session.pending === null) return null;

    const packet = session.pending.packet;
    const intent = session.inFlight;

    if (event.payload.error === true) {
      await eventStore.markDispatchCompleted(session.gateId, packet.operationId);
      return suspendAndBlock(
        session,
        "WORKER_EXECUTION_FAILED",
        `the ${packet.operation} worker execution failed after the durable dispatch; the Gate is suspended with a typed EXECUTION_SUSPENDED reason.`,
      );
    }

    const raw = event.payload.toolResult;
    if (typeof raw !== "string") {
      return blockedInjection("worker returned no string result; the Gate remains blocked.");
    }
    const expectation: ReviewGateResultExpectationV1 = {
      operationId: packet.operationId,
      gateId: packet.gateId,
      phase: packet.phase,
      ...(packet.reviewAttemptId !== null ? { reviewAttemptId: packet.reviewAttemptId } : {}),
      ...(packet.remediationRound !== null ? { remediationRound: packet.remediationRound } : {}),
    };
    const outcome = parseReviewGateOperationResult(packet.operation, raw, expectation);
    await eventStore.markDispatchCompleted(session.gateId, packet.operationId);

    switch (outcome.kind) {
      case "malformed":
        return suspendAndBlock(
          session,
          "WORKER_RESULT_MALFORMED",
          `the ${packet.operation} result failed strict parsing (${outcome.reason}); the Gate is suspended.`,
        );
      case "stale":
        return suspendAndBlock(
          session,
          "WORKER_RESULT_STALE",
          `the ${packet.operation} result correlation mismatched on ${outcome.field}; the Gate is suspended.`,
        );
      case "conflict":
        return suspendAndBlock(
          session,
          "SELF_REVIEW_RESULT_CONFLICT",
          "the self-review result was self-contradictory; the Gate is suspended.",
        );
      case "accepted":
        break;
    }

    const result = outcome.result;
    session.pending = null;
    session.inFlight = null;

    switch (packet.operation) {
      case "review_candidates": {
        const reviewResult = result as ReviewCandidatesResultV1;
        session.reviewObserved = Object.freeze({
          phase: packet.phase,
          candidates: reviewResult.candidates,
        });
        break;
      }
      case "finding_validation": {
        const findingResult = result as FindingValidationResultV1;
        if (
          findingResult.decision === "INVALID" ||
          findingResult.decision === "ADVISORY" ||
          findingResult.decision === "ALREADY_RESOLVED"
        ) {
          break;
        }
        const validated = validatedFindingFromResult(findingResult);
        session.validatedFindings.push(
          Object.freeze({
            candidate: requireCandidate(session, findingResult.candidateId),
            validated,
          }),
        );
        break;
      }
      case "remediation": {
        const remediationResult = result as RemediationResultV1;
        const round = packet.remediationRound ?? { phase: packet.phase, ordinal: 1 };
        if (remediationResult.outcome === "NO_CHANGE") {
          return suspendAndBlock(
            session,
            "REMEDIATION_NO_PROGRESS",
            "the remediation worker made no observable content change; the Gate remains blocked.",
          );
        }
        const lineageIds = remediationLineageIds(session, intent);
        const projection = await loadProjection(session.gateId);
        if (lineageIds.some((lineageId) => !projection.findings.has(lineageId))) {
          return suspendAndBlock(session, "UNKNOWN_REMEDIATION_LINEAGE", "remediation referenced an unknown lineage.");
        }
        const artifactPath = packet.phase === "design" ? session.designPath : session.planPath;
        const artifactBytes = await reader.readWorkspaceFile(artifactPath);
        if (artifactBytes === null) {
          return suspendAndBlock(
            session,
            "REMEDIATED_ARTIFACT_UNREADABLE",
            "the remediated artifact could not be reread; the Gate remains blocked.",
          );
        }
        const artifactDigest = computeArtifactDigest(artifactBytes);
        if (packet.phase === "design") session.designDigest = artifactDigest;
        else session.planDigest = artifactDigest;
        await appendEvents(
          session,
          lineageIds.map((lineageId) => ({
            eventType: "FINDING_REMEDIATED" as const,
            payload: {
              lineageId,
              findingId: (() => {
                const finding = projection.findings.get(lineageId);
                if (finding === undefined) throw new Error("review_gate_unknown_lineage");
                return finding.findingId;
              })(),
              remediationRound: round,
            },
          })),
        );
        session.remediationCompleted = Object.freeze({
          round,
          lineageIds: Object.freeze([...lineageIds]),
        });
        break;
      }
      case "self_review": {
        const selfReviewResult = result as SelfReviewResultV1;
        const unresolved = selfReviewResult.targetLineageChecks.filter(
          (check) => check.result !== "RESOLVED",
        );
        if (unresolved.length > 0) {
          return suspendAndBlock(
            session,
            "SELF_REVIEW_INCOMPLETE",
            `the self-review reported unresolved targets (${unresolved
              .map((check) => check.lineageId)
              .join(", ")}); the Gate remains blocked.`,
          );
        }
        const round = packet.remediationRound ?? { phase: packet.phase, ordinal: 1 };
        const lineageIds = remediationLineageIds(session, intent);
        const projection = await loadProjection(session.gateId);
        if (lineageIds.some((lineageId) => !projection.findings.has(lineageId))) {
          return suspendAndBlock(session, "UNKNOWN_SELF_REVIEW_LINEAGE", "self-review referenced an unknown lineage.");
        }
        await appendEvents(
          session,
          lineageIds.map((lineageId) => ({
            eventType: "FINDING_SELF_REVIEWED" as const,
            payload: {
              lineageId,
              findingId: (() => {
                const finding = projection.findings.get(lineageId);
                if (finding === undefined) throw new Error("review_gate_unknown_lineage");
                return finding.findingId;
              })(),
              remediationRound: round,
            },
          })),
        );
        session.selfReviewPassed = Object.freeze({
          round,
          lineageIds: Object.freeze([...lineageIds]),
        });
        session.remediationCompleted = null;
        break;
      }
      case "lineage_revalidation": {
        const revalidationResult = result as LineageRevalidationResultV1;
        if (revalidationResult.result === "INDETERMINATE") {
          return suspendAndBlock(
            session,
            "REVALIDATION_INDETERMINATE",
            "the lineage revalidation was indeterminate; the Gate remains blocked.",
          );
        }
        if (revalidationResult.result === "STILL_PRESENT") {
          return suspendAndBlock(
            session,
            "REVALIDATION_STILL_PRESENT",
            "the lineage revalidation found the defect still present; the Gate remains blocked.",
          );
        }
        const projection = await loadProjection(session.gateId);
        const payload = commitLineageRevalidation(projection, {
          lineageId: revalidationResult.lineageId as LineageId,
          result: "resolved",
          verifiedCommitBinding: phaseArtifactBinding(session, projection.phase),
        });
        await appendEvents(
          session,
          payload.events.map((event) => ({ eventType: event.eventType, payload: event.payload })),
        );
        break;
      }
      case "non_convergence_reentry": {
        const reentryResult = result as NonConvergenceReentryResultV1;
        switch (reentryResult.outcome) {
          case "MATERIAL_PROGRESS":
            session.materialProgressObserved = true;
            break;
          case "DESIGN_REOPEN_REQUIRED":
          case "REQUIREMENTS_REOPEN_REQUIRED": {
            if (reentryResult.lineageId === undefined) {
              return suspendAndBlock(
                session,
                "REENTRY_LINEAGE_MISSING",
                "the reentry reopen outcome carried no lineage id.",
              );
            }
            const projection = await loadProjection(session.gateId);
            const finding = projection.findings.get(reentryResult.lineageId as LineageId);
            if (finding === undefined) {
              return suspendAndBlock(
                session,
                "REENTRY_UNKNOWN_LINEAGE",
                "the reentry reopen outcome referenced an unknown lineage.",
              );
            }
            await appendEvents(session, [
              {
                eventType: "FINDING_REOPENED",
                payload: {
                  lineageId: reentryResult.lineageId as LineageId,
                  findingId: finding.findingId,
                  reopenedBy: session.epochId,
                },
              },
            ]);
            break;
          }
          case "NO_MATERIAL_PROGRESS":
            session.materialProgressObserved = false;
            break;
        }
        break;
      }
      case "cross_generation_reconciliation":
        return suspendAndBlock(
          session,
          "UNSUPPORTED_OPERATION",
          "cross-generation reconciliation is not reachable in this generation.",
        );
    }

    return drive(session);
  };

  const requireCandidate = (
    session: MutableSessionState,
    candidateId: string,
  ): ReviewCandidateObservationV1 => {
    const observed = session.reviewObserved;
    if (observed !== null) {
      const candidate = observed.candidates.find((item) => item.candidateId === candidateId);
      if (candidate !== undefined) return candidate;
    }
    throw new Error("review_gate_candidate_missing_for_validation");
  };

  const remediationLineageIds = (
    session: MutableSessionState,
    intent: ReviewGateInFlightIntent | null,
  ): readonly LineageId[] => {
    if (intent !== null && intent.kind === "remediation_started" && intent.lineageIds.length > 0) {
      return intent.lineageIds;
    }
    const remediated = session.remediationCompleted?.lineageIds ?? [];
    if (remediated.length > 0) return remediated;
    throw new Error("review_gate_remediation_lineage_missing");
  };

  const validatedFindingFromResult = (result: {
    readonly candidateId: string;
    readonly severity: "blocking" | "minor" | undefined;
    readonly observedPhase: "requirements" | "design" | "plan";
    readonly semanticBasis:
      | Readonly<{
          readonly violationType: string;
          readonly governingReference: string;
          readonly semanticLocation: string;
          readonly violatedContract: string;
          readonly ownerScope: "requirements" | "design" | "plan";
        }>
      | undefined;
    readonly relation: "EXISTING" | "NEW" | "NONE";
    readonly existingLineageRef: string | undefined;
  }): ValidatedFinding => {
    const ownerScope =
      result.semanticBasis?.ownerScope ??
      (result.observedPhase === "requirements" ? "requirements" : result.observedPhase);
    const severity = result.severity === "minor" ? "minor" : "blocking";
    const basisDigest =
      result.semanticBasis !== undefined
        ? (computeCanonicalJsonFingerprint(result.semanticBasis) as ArtifactDigest)
        : (computeCanonicalJsonFingerprint({ candidateId: result.candidateId }) as ArtifactDigest);
    const existingLineageId =
      result.relation === "EXISTING" && result.existingLineageRef !== undefined
        ? (result.existingLineageRef as LineageId)
        : null;
    return Object.freeze({
      candidateId: result.candidateId,
      existingLineageId,
      basisDigest,
      ownerScope,
      observedPhase: (result.observedPhase === "requirements" ? "design" : result.observedPhase) as "design" | "plan",
      status: result.relation === "EXISTING" ? "existing_valid" : "new",
      severity,
      descriptionDigest: basisDigest as ArtifactDigest,
    });
  };

  // ---------------------------------------------------------------------------
  // classifyToolUse: the implementation-authorization lock
  // ---------------------------------------------------------------------------

  const classifyToolUse = (
    rootSessionId: string | null,
    use: ScopedReviewToolUse,
  ): ReviewCapabilityDecision | undefined => {
    const state =
      rootSessionId === null ? sessions.values().next().value : sessions.get(rootSessionId);
    if (state === undefined) return undefined;

    const isReadOnlyReviewQuery =
      READ_ONLY_TOOLS.has(use.toolName) || (use.toolName === "justice_review" && use.queryOnly);
    if (rootSessionId !== state.sessionId) {
      return isReadOnlyReviewQuery
        ? { kind: "allow" }
        : { kind: "deny", reason: "implementation_not_authorized" };
    }
    if (use.toolName === "task") {
      return use.isPendingReviewGateTask
        ? { kind: "allow" }
        : { kind: "deny", reason: "implementation_not_authorized" };
    }
    if (READ_ONLY_TOOLS.has(use.toolName)) return { kind: "allow" };
    if (use.toolName === "justice_review") {
      return use.queryOnly
        ? { kind: "allow" }
        : { kind: "deny", reason: "implementation_not_authorized" };
    }
    if (REVIEW_ARTIFACT_WRITE_TOOLS.has(use.toolName)) {
      if (state.lockPhase !== "remediation") {
        return { kind: "deny", reason: "implementation_not_authorized" };
      }
      if (use.changedPaths === null || use.changedPaths.length === 0) {
        return { kind: "deny", reason: "review_scope_violation" };
      }
      return use.changedPaths.every((path) => path === state.designPath || path === state.planPath)
        ? { kind: "allow" }
        : { kind: "deny", reason: "review_scope_violation" };
    }
    return { kind: "deny", reason: "implementation_not_authorized" };
  };

  const releaseSession = (sessionId: string): void => {
    const state = dropSession(sessionId);
    if (state === undefined) return;
    releaseHandles(state);
  };

  return Object.freeze({
    startOrResume,
    preToolUse,
    postToolUse,
    classifyToolUse,
    releaseSession,
  });
}
