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
  type VerifiedUpstreamReopenContextV1,
} from "../core/review-gate/orchestrator";
import { projectReviewGate } from "../core/review-gate/projection";
import type {
  ReviewGateProjection,
  ReviewTargetWorkspaceState,
  ScopeEnrollmentV1,
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
import type {
  DurableReviewGateEventStore,
  ReviewGateDispatchRecordV1,
  ReviewGateEventStore,
  ReviewGateV2Journal,
} from "./review-gate-event-store";
import type { ReviewGateRecoveryStore } from "./review-gate-recovery-store";
import type {
  ReviewGateWitnessPublicationSeamV1,
} from "./review-gate-witness-contracts";
import {
  encodeReviewGateEventRecord,
  validateReviewGateEventRecord,
  type VerifiedReviewGateEvent,
} from "../core/review-gate/event-schema";
import {
  acquireGateLockChain,
  type ReviewGateLockHandle,
  type ReviewGateLockManager,
} from "./review-gate-lock-manager";
import type { ReviewGateProtocolDescriptor } from "./review-gate-protocol";
import {
  ScopeAdmissionBlocked,
  type ReviewGateScopeAdmission,
} from "./review-gate-scope-admission";
import type { AdmissionDecision } from "../core/review-gate/admission";
import type {
  AdmissionOwnedWitness,
  AdmittedMembershipAuthorizationPayload,
  ReviewGateAdmissionExecutionResult,
  ReviewGateAdmissionObservation,
} from "./review-gate-admission-context";
import {
  applyReviewGateAdmissionDecision,
  type ReviewGateAdmissionHandlers,
} from "./review-gate-admission-executor";

/**
 * Task 3 — bounded wait for a scope admission lease under contention.
 * A short admission transaction frees the lock quickly; an actively
 * reviewing session holds it longer, so the wait stays bounded and
 * fail-closed, never bypassing admission.
 */
const ADMISSION_LEASE_WAIT_ATTEMPTS = 5;
const ADMISSION_LEASE_WAIT_MS = 50;
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


/**
 * Task 17 — caller-owned routing decision for one Review Gate execution step.
 * The caller (host adapter / plan bridge) owns the routing decision; the
 * coordinator never plans one itself and only validates and executes the
 * caller-provided decision against a durably prepared operation.
 */
export type CallerRoutingDecisionV1 = Readonly<{
  readonly kind: "execute_operation" | "block" | "await_evidence";
  readonly operationId: string | null;
  readonly reason: string | null;
}>;

/** Typed result of one caller-owned routing decision handled by the coordinator. */
export type CallerRoutingDecisionOutcomeV1 = Readonly<{
  readonly kind: "executed" | "blocked" | "awaited";
  readonly operationId: string | null;
  readonly guidance: string | null;
}>;

/**
 * Durable prepared-operation record published to the recovery store by
 * `prepareCallerOperation` and re-read/validated before every caller-owned
 * execution. Content-addressed: identical records collapse idempotently.
 */
export type PreparedReviewGateOperationRecordV1 = Readonly<{
  readonly recordKind: "review_gate_prepared_operation";
  readonly schemaVersion: 1;
  readonly gateId: string;
  readonly operationId: string;
  readonly operation: ReviewGateNextOperation;
}>;

/** Handle returned by `prepareCallerOperation` for the caller's routing decision. */
export type PreparedCallerOperationHandleV1 = Readonly<{
  readonly operationId: string;
  readonly preparedRecoveryDigest: string;
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
  /**
   * Task 4d — authority store surface required to stage and commit admitted
   * generation publications. When `scopeAdmission` is provided this must also
   * expose `prepareAdmittedGenerationPublication`; otherwise the coordinator
   * operates on the legacy `ReviewGateEventStore` surface only.
   */
  readonly eventStore: ReviewGateEventStore & Partial<DurableReviewGateEventStore>;
  readonly lockManager: ReviewGateLockManager;
  readonly protocol: ReviewGateProtocolDescriptor;
  readonly workspaceReader: ReviewGateWorkspaceReader;
  /** Root directory of the workspace; used by scope admission for git inspection. */
  readonly workspaceRoot?: string | null;
  /** Stable identity of the workspace; forwarded to scope admission. */
  readonly workspaceIdentity?: string | null;
  readonly mutationSubstrate?: ReviewGateMutationSubstrate | null;
  readonly inspectTargets: (
    paths: readonly string[],
  ) => Promise<ReadonlyMap<string, ReviewTargetWorkspaceState>>;
  readonly now?: () => string;
  readonly newId?: () => string;
  readonly newWriterId?: () => string;
  readonly scopeAdmission?: ReviewGateScopeAdmission | null;
  /**
   * Task 17 — durable custody for prepared caller-owned operations. `null`
   * selects caller-routing-unavailable mode: `execute_operation` decisions
   * fail closed while `block`/`await_evidence` decisions still work.
   */
  readonly recoveryStore?: ReviewGateRecoveryStore | null;
  /**
   * Task 18 — witness publication seam for durable V2 journal appends. The
   * coordinator invokes it after every V2 journal append to produce and send
   * a `PreparedWitnessPublicationV1` to the witness service. `null` (default)
   * selects durable local journal custody without witness registration.
   */
  readonly witnessPublicationSeam?: ReviewGateWitnessPublicationSeamV1 | null;
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
  
  /**
   * Task 17 — register a caller-provided planned operation as a durable
   * prepared record in the recovery store, without mutating Review Gate state.
   */
  readonly prepareCallerOperation: (
    sessionId: string,
    operation: ReviewGateNextOperation,
  ) => Promise<PreparedCallerOperationHandleV1>;
  /**
   * Task 17 — execute the caller-owned routing decision. The coordinator
   * never plans itself: `execute_operation` is validated against the durable
   * prepared record, then executed and witnessed; `block` records the
   * caller's reason as a durable stop event; `await_evidence` returns without
   * mutating state.
   */
  readonly executeNextOperation: (
    sessionId: string,
    decision: CallerRoutingDecisionV1,
  ) => Promise<CallerRoutingDecisionOutcomeV1>;
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

// ---------------------------------------------------------------------------
// Task 17 — caller-owned routing constants and prepared-record codec
// ---------------------------------------------------------------------------

/** Distinguishing record kind claimed by prepared-operation recovery records. */
const PREPARED_OPERATION_RECORD_KIND = "review_gate_prepared_operation" as const;
const EXECUTED_OPERATION_RECORD_KIND = "review_gate_executed_operation" as const;

/** All operation kinds the gate planner can produce. */
const REVIEW_GATE_OPERATION_KINDS: ReadonlySet<string> = new Set<string>([
  "dispatch_reviewer",
  "dispatch_finding_validator",
  "commit_finding_reconciliation",
  "dispatch_lineage_revalidation",
  "start_remediation",
  "recover_remediation",
  "dispatch_self_review",
  "prepare_restore",
  "recover_restore",
  "prepare_commit",
  "recover_commit",
  "commit_resolutions",
  "append_reopen",
  "run_pre_clear_validation",
  "append_design_clear",
  "append_plan_clear",
  "validate_non_convergence_reentry",
  "suspended",
  "completed",
]);

/**
 * Terminal routing states, not operations: under caller-owned routing the
 * caller expresses them with a `block`/`await_evidence` decision instead of
 * preparing the terminal plan, so the coordinator never executes them.
 */
const NON_PREPARABLE_OPERATION_KINDS: ReadonlySet<string> = new Set<string>([
  "suspended",
  "completed",
]);

/** Drive-loop sentinel: the operation executed in place and the loop continues. */
const DRIVE_CONTINUE: unique symbol = Symbol("review_gate_drive_continue");

const isPlainObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

/**
 * Strictly decode one recovery-store object as a prepared-operation record.
 * `null` marks an unrelated recovery record (Task 10 commit/restore records
 * share the content-addressed namespace and are skipped); a record that
 * claims the prepared-operation contract but violates its shape fails closed.
 */
function parsePreparedOperationRecord(
  bytes: Buffer,
): PreparedReviewGateOperationRecordV1 | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch (err: unknown) {
    if (err instanceof SyntaxError) return null;
    throw err;
  }
  if (!isPlainObjectRecord(parsed) || parsed.recordKind !== PREPARED_OPERATION_RECORD_KIND) {
    return null;
  }
  const { schemaVersion, gateId, operationId, operation } = parsed;
  const operationKind = isPlainObjectRecord(operation) ? operation.kind : undefined;
  if (
    schemaVersion !== 1 ||
    !isNonEmptyString(gateId) ||
    !isNonEmptyString(operationId) ||
    !isPlainObjectRecord(operation) ||
    !isNonEmptyString(operationKind) ||
    !REVIEW_GATE_OPERATION_KINDS.has(operationKind) ||
    NON_PREPARABLE_OPERATION_KINDS.has(operationKind)
  ) {
    throw new Error("review_gate_prepared_operation_corrupt");
  }
  return Object.freeze({
    recordKind: PREPARED_OPERATION_RECORD_KIND,
    schemaVersion: 1,
    gateId,
    operationId,
    operation: operation as unknown as ReviewGateNextOperation,
  });
}


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
  readonly verifiedUpstreamReopen?: VerifiedUpstreamReopenContextV1;
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
  const workspaceRoot = options.workspaceRoot ?? null;
  const workspaceIdentity = options.workspaceIdentity ?? null;
  const scopeAdmission = options.scopeAdmission ?? null;
  const mutation = options.mutationSubstrate ?? null;
  const inspectTargets = options.inspectTargets;
  const now = options.now ?? ((): string => new Date().toISOString());
  const randomId = options.newId ?? ((): string => globalThis.crypto.randomUUID());
  const newId = randomId;
  const newWriterId = options.newWriterId ?? (() => eventStore.writerId ?? `rgw-${randomId()}`);
  /** Task 17 — durable custody for prepared caller-owned operations. */
  const recovery = options.recoveryStore ?? null;
  /**
   * Task 18 — witness publication seam. After each durable V2 journal append
   * the seam produces the `PreparedWitnessPublicationV1` and submits it to
   * the witness service; `null` keeps local-durable custody only.
   */
  const witnessSeam = options.witnessPublicationSeam ?? null;
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

  const buildApprovalBinding = async (
    session: MutableSessionState,
    projection: ReviewGateProjection,
  ): Promise<ReviewApprovalBindingV1> => {
    const gateCreated = requireGateCreated(session.gateId);
    return Object.freeze({
      reviewScopeId: gateCreated.payload.reviewScopeId,
      gateId: projection.gateId,
      designArtifact: {
        ...gateCreated.payload.designArtifact,
        digest: session.designDigest as ArtifactDigest,
      },
      planArtifact: {
        ...gateCreated.payload.planArtifact,
        digest: session.planDigest as ArtifactDigest,
      },
      requirementsResolution: {
        ...gateCreated.payload.requirementsResolution,
        ...(gateCreated.payload.requirementsResolution.source === "auto_design_reference"
          ? { canonicalPath: session.designPath, digest: session.designDigest as ArtifactDigest }
          : {}),
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
      verifiedUpstreamReopen?: VerifiedUpstreamReopenContextV1;
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
    if (session.verifiedUpstreamReopen !== undefined) {
      context.verifiedUpstreamReopen = session.verifiedUpstreamReopen;
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
  // Task 18 — durable V2 journal custody and witness publication
  // ---------------------------------------------------------------------------

  /**
   * Deterministic authority pointer for a lineage whose prior committed
   * resolution exists only in the legacy V1 journal (no V1 event id). Same
   * identity rule as the projection's SYNTHETIC_V1_REQUIREMENTS_AUTHORITY.
   */
  const SYNTHETIC_V1_LINEAGE_RESOLUTION_EVENT_ID = "synthetic-v1-lineage-resolution";

  type V2EventDraft = Readonly<{
    readonly eventType: string;
    readonly payload: Record<string, unknown>;
  }>;

  /** Dispatch role for one packet operation; null = no schema-safe V2 event. */
  const dispatchRoleForPacket = (
    operation: string,
  ): "reviewer" | "finding_validator" | "self_review" | "lineage_revalidation" | "non_convergence_reentry" | null => {
    switch (operation) {
      case "review_candidates": return "reviewer";
      case "finding_validation": return "finding_validator";
      case "self_review": return "self_review";
      case "lineage_revalidation": return "lineage_revalidation";
      case "non_convergence_reentry": return "non_convergence_reentry";
      default: return null;
    }
  };

  /**
   * Task 18 — intent publication is bounded to the judgment-dispatch kind
   * preparations: they carry the phase and a schema-representable role.
   * Remediation preparations are skipped (the payload schema demands a
   * non-null protected lease proof digest exactly for the remediator role)
   * and non-dispatch preparations carry no phase.
   */
  const prepareIntentRole = (kind: string):
    "reviewer" | "finding_validator" | "self_review" | "lineage_revalidation" | "non_convergence_reentry" | null => {
    switch (kind) {
      case "dispatch_reviewer": return "reviewer";
      case "dispatch_finding_validator": return "finding_validator";
      case "dispatch_self_review": return "self_review";
      case "dispatch_lineage_revalidation": return "lineage_revalidation";
      case "validate_non_convergence_reentry": return "non_convergence_reentry";
      default: return null;
    }
  };

  const prepareIntentPhase = (operation: ReviewGateNextOperation): ReviewGatePhase | null => {
    switch (operation.kind) {
      case "dispatch_reviewer":
      case "dispatch_finding_validator":
      case "start_remediation":
      case "recover_remediation":
      case "dispatch_self_review":
      case "append_reopen":
      case "run_pre_clear_validation":
      case "validate_non_convergence_reentry":
        return operation.phase;
      default:
        return null;
    }
  };

  /**
   * Append one chained V2 batch to the gate's durable V2 journal and, when a
   * witness publication seam is configured, hand the exact publication input
   * to it. The journal is the durable anchor: appends happen first, the seam
   * call is evidence authority and fails closed with a typed reason while the
   * appended journal bytes stay durable for recovery.
   *
   * `buildDrafts` receives the journal state observed BEFORE the append so
   * payloads can pin `expectedWitnessFrontier` to the preimage frontier; the
   * first event's parentEventId anchors to the journal tail (or the gate id
   * when the journal is empty).
   */
  const appendV2JournalEvents = async (
    session: MutableSessionState,
    operationId: string,
    buildDrafts: (journal: ReviewGateV2Journal) => readonly V2EventDraft[],
  ): Promise<void> => {
    const journal = await eventStore.readV2Journal(session.gateId);
    const drafts = buildDrafts(journal);
    if (drafts.length === 0) return;
    await appendV2JournalBatch(session, operationId, drafts, journal.frontierHash);
  };

  const appendV2JournalBatch = async (
    session: MutableSessionState,
    operationId: string,
    drafts: readonly V2EventDraft[],
    preImageFrontierHash: string,
  ): Promise<void> => {
    if (drafts.length === 0) return;
    const journal = await eventStore.readV2Journal(session.gateId);
    if (journal.frontierHash !== preImageFrontierHash) {
      throw new Error("review_gate_v2_journal_frontier_conflict");
    }
    const anchorParentEventId = journal.tailEventId ?? session.gateId;
    const events: VerifiedReviewGateEvent[] = [];
    let parentEventId = anchorParentEventId;
    for (const draft of drafts) {
      const eventId = newId();
      const record = validateReviewGateEventRecord(
        structuredClone({
          schemaVersion: 2,
          eventId,
          parentEventId,
          emittedAt: now(),
          gateId: session.gateId,
          epochId: session.epochId,
          generationId: session.gateId,
          writerId: session.writerId,
          eventType: draft.eventType,
          payload: draft.payload,
        }),
      );
      if (!("schemaVersion" in record) || record.schemaVersion !== 2) {
        throw new Error("review_gate_event_v2_required");
      }
      events.push(record);
      parentEventId = eventId;
    }
    const canonicalBatchBytes = Buffer.from(
      `${events.map(encodeReviewGateEventRecord).join("\n")}\n`,
      "utf8",
    );
    await eventStore.appendV2Events(session.gateId, events);
    if (witnessSeam === null) return;
    const nextJournal = await eventStore.readV2Journal(session.gateId);
    try {
      await witnessSeam.prepareAndPublish(Object.freeze({
        gateId: session.gateId,
        writerId: session.writerId,
        operationId,
        canonicalEventBytes: canonicalBatchBytes,
        baseFrontierHash: preImageFrontierHash,
        newFrontierHash: nextJournal.frontierHash,
        newTailLength: canonicalBatchBytes.length,
        newTailDigest: computeArtifactDigest(canonicalBatchBytes),
        appendedEventCount: events.length,
      }));
    } catch (error: unknown) {
      throw new Error(
        `review_gate_witness_publication_failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    }
  };

  /**
   * One schema-bounded `EXTERNAL_OPERATION_DISPATCHED` record for the
   * execution of a prepared caller-owned dispatch operation. Remediation
   * dispatches are skipped: the payload schema requires a non-null protected
   * lease proof digest exactly for the remediator role, and the coordinator
   * does not hold a writer lease at dispatch time.
   */
  const buildDispatchedDraftForExecution = (
    session: MutableSessionState,
    packet: ReviewGateOperationPacketV1,
    expectedWitnessFrontier: string,
  ): V2EventDraft | null => {
    const role = dispatchRoleForPacket(packet.operation);
    if (role === null) return null;
    const artifacts = artifactRefsFor(session, packet.phase);
    const candidateOrTargetSetDigest = computeCanonicalJsonFingerprint({
      operation: packet.operation,
      phase: packet.phase,
      artifacts,
    });
    const inputBindingDigest = computeCanonicalJsonFingerprint({
      operationId: packet.operationId,
      phase: packet.phase,
      artifacts,
      freshContext: packet.freshContext,
      staticPromptContractKey: packet.staticPromptContractKey,
      dispatchSerial: packet.dispatchSerial,
    });
    return {
      eventType: "EXTERNAL_OPERATION_DISPATCHED",
      payload: {
        eventType: "EXTERNAL_OPERATION_DISPATCHED",
        gateId: session.gateId,
        generationId: session.gateId,
        epochId: session.epochId,
        operationId: packet.operationId,
        dispatchAttemptId: newId(),
        phase: packet.phase,
        role,
        candidateOrTargetSetDigest,
        inputBindingDigest,
        protocolFingerprint: protocol.reviewProtocolFingerprint,
        expectedWitnessFrontier,
        protectedLeaseProofDigest: null,
      },
    };
  };

  /**
   * V2 resolution drafts for one reconciled finding batch: exactly one
   * `FINDING_VALIDATION_COMPLETED` per already-resolved claim and one
   * `LINEAGE_REGRESSED` per regression, both chained from the journal tail.
   * Findings are deduplicated first-wins like the reconciler; the batch has
   * already passed `reconcileFindingBatch` when this composes.
   */
  const buildResolutionDraftsForBatch = (
    session: MutableSessionState,
    projection: ReviewGateProjection,
    operationId: string,
    findings: readonly ValidatedFinding[],
    expectedWitnessFrontier: string,
  ): readonly V2EventDraft[] => {
    const deduped: ValidatedFinding[] = [];
    const seen = new Set<string>();
    for (const finding of findings) {
      if (seen.has(finding.candidateId)) continue;
      seen.add(finding.candidateId);
      deduped.push(finding);
    }
    const pinnedBaselineDigest =
      projection.phase === "design" ? session.designDigest : session.planDigest;
    const drafts: V2EventDraft[] = [];
    for (const finding of deduped) {
      const lineageId = finding.existingLineageId;
      if (lineageId === null || !projection.findings.has(lineageId)) continue;
      if (finding.status === "existing_resolved") {
        drafts.push({
          eventType: "FINDING_VALIDATION_COMPLETED",
          payload: {
            eventType: "FINDING_VALIDATION_COMPLETED",
            operationId,
            validationEventId: newId(),
            disposition: "ALREADY_RESOLVED",
            relation: "EXISTING",
            lineageId,
            priorCommittedResolutionEventId: SYNTHETIC_V1_LINEAGE_RESOLUTION_EVENT_ID,
            pinnedBaselineDigest,
            semanticContextFingerprint: projection.phaseReviewContextIdentity,
            validatedAbsenceProofDigest: finding.basisDigest,
            witnessedFrontierHash: expectedWitnessFrontier,
          },
        });
        continue;
      }
      if (finding.status === "existing_regressed") {
        drafts.push({
          eventType: "LINEAGE_REGRESSED",
          payload: {
            eventType: "LINEAGE_REGRESSED",
            operationId,
            validationEventId: newId(),
            lineageId,
            priorCommittedResolutionEventId: SYNTHETIC_V1_LINEAGE_RESOLUTION_EVENT_ID,
            pinnedBaselineDigest,
            semanticContextFingerprint: projection.phaseReviewContextIdentity,
            validatedPresenceProofDigest: finding.basisDigest,
            witnessedFrontierHash: expectedWitnessFrontier,
          },
        });
      }
    }
    return drafts;
  };

  // ---------------------------------------------------------------------------
  // The drive loop: plan → side effect → reproject → next
  // ---------------------------------------------------------------------------

  /**
   * Execute exactly one planned Review Gate operation.
   *
   * Shared execute path for both the legacy drive loop and the Task 17
   * caller-owned routing seam: `DRIVE_CONTINUE` means the operation executed
   * in place (evidence cleared or a transition appended) and the loop should
   * reproject and plan again; a `HookResponse` ends the step (a dispatch was
   * injected, or the gate suspended/completed).
   */
  const executeOperation = async (
    session: MutableSessionState,
    projection: ReviewGateProjection,
    op: ReviewGateNextOperation,
  ): Promise<HookResponse | null | typeof DRIVE_CONTINUE> => {
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
        return DRIVE_CONTINUE;
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
        return DRIVE_CONTINUE;
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
        return DRIVE_CONTINUE;
      }
      case "commit_resolutions": {
        session.resolutionsCommitted = Object.freeze({ lineageIds: [...op.lineageIds] });
        // The commit evidence is consumed by this step; keeping it would
        // re-plan commit_resolutions forever (drive_iteration_exhausted).
        session.commitCompleted = null;
        return DRIVE_CONTINUE;
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
        return DRIVE_CONTINUE;
      }
      case "append_reopen": {
        await appendEvents(session, [
          {
            eventType: "REOPEN_REQUIRED",
            payload: { phase: op.phase, lineageIds: [...op.lineageIds] },
          },
        ]);
        return DRIVE_CONTINUE;
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
        return DRIVE_CONTINUE;
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
        return DRIVE_CONTINUE;
      }
      case "append_plan_clear": {
        const [designBytes, planBytes] = await Promise.all([
          reader.readWorkspaceFile(session.designPath),
          reader.readWorkspaceFile(session.planPath),
        ]);
        if (designBytes === null || planBytes === null) {
          return suspendAndBlock(
            session,
            "reviewed_artifact_unreadable",
            "the reviewed Design or Plan is unreadable; the Review Gate cannot clear safely.",
          );
        }
        if (
          computeArtifactDigest(designBytes) !== session.designDigest ||
          computeArtifactDigest(planBytes) !== session.planDigest
        ) {
          return suspendAndBlock(
            session,
            "reviewed_artifact_digest_mismatch",
            "the Design or Plan changed after review; rerun /justice-review-gate.",
          );
        }
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
        return DRIVE_CONTINUE;
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
  };

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
      const step = await executeOperation(session, projection, op);
      if (step !== DRIVE_CONTINUE) return step;
    }
    return suspendAndBlock(
      session,
      "drive_iteration_exhausted",
      "the Review Gate loop did not converge within the bounded iteration budget.",
    );
  };

  // ---------------------------------------------------------------------------
  // Task 17 — caller-owned routing (prepared operations + caller decisions)
  // ---------------------------------------------------------------------------

  /**
   * Resolve the durable prepared operation for one caller-owned decision from
   * the recovery store. Records are matched against the session's gate:
   *
   * - exactly one record matching `(gateId, operationId)` is returned,
   * - `"mismatch"` when prepared records exist for the gate but none carries
   *   the caller's operation id,
   * - `"missing"` when the gate has no prepared records at all,
   * - `"ambiguous"` when two records claim the same `(gateId, operationId)`.
   *
   * A record that claims the prepared-operation contract but violates its
   * shape throws (`review_gate_prepared_operation_corrupt`); unrelated
   * recovery records are skipped.
   */
  const readPreparedOperation = async (
    session: MutableSessionState,
    operationId: string,
  ): Promise<
    PreparedReviewGateOperationRecordV1 | "missing" | "mismatch" | "ambiguous"
  > => {
    if (recovery === null) return "missing";
    const digests = await recovery.list();
    let sameGateRecords = 0;
    let found: PreparedReviewGateOperationRecordV1 | null = null;
    for (const digest of digests) {
      const bytes = await recovery.read(digest);
      if (bytes === null) continue;
      const record = parsePreparedOperationRecord(bytes);
      if (record === null || record.gateId !== session.gateId) continue;
      sameGateRecords += 1;
      if (record.operationId !== operationId) continue;
      if (found !== null) return "ambiguous";
      found = record;
    }
    if (found !== null) return found;
    return sameGateRecords > 0 ? "mismatch" : "missing";
  };

  /**
   * Task 17 — register a caller-provided planned operation as a durable
   * prepared record. The coordinator does NOT plan: the caller owns the
   * routing decision end-to-end and the coordinator only validates the
   * operation shape, mints the logical operation id and publishes the
   * content-addressed record without touching Review Gate state.
   */
  const prepareCallerOperation = async (
    sessionId: string,
    operation: ReviewGateNextOperation,
  ): Promise<PreparedCallerOperationHandleV1> => {
    const session = sessions.get(sessionId);
    if (session === undefined) throw new Error("review_gate_session_not_active");
    if (recovery === null) throw new Error("review_gate_recovery_store_unavailable");
    if (
      !REVIEW_GATE_OPERATION_KINDS.has(operation.kind) ||
      NON_PREPARABLE_OPERATION_KINDS.has(operation.kind)
    ) {
      throw new Error(`review_gate_operation_not_preparable: ${String(operation.kind)}`);
    }
    const operationId = newId();
    const record: PreparedReviewGateOperationRecordV1 = Object.freeze({
      recordKind: PREPARED_OPERATION_RECORD_KIND,
      schemaVersion: 1,
      gateId: session.gateId,
      operationId,
      operation,
    });
    const bytes = Buffer.from(JSON.stringify(record), "utf8");
    const digest = computeArtifactDigest(bytes);
    await recovery.publish(digest, bytes);
    // Task 18 — prepared operation record publication: the bounded V2
    // dispatch-intent publication carries the content-addressed record digest
    // as its input binding. REVIEW_OPERATION_PREPARED does not exist in the
    // schema and event types must not be invented; the EXISTING
    // EXTERNAL_OPERATION_DISPATCHED intent family is the Task 18 producer of
    // the durable prepared-intent evidence. Preparations whose kind carries
    // no phase or no schema-representable role publish no intent event.
    const intentPhase = prepareIntentPhase(operation);
    const intentRole = prepareIntentRole(operation.kind);
    if (intentPhase === null || intentRole === null) {
      return Object.freeze({ operationId, preparedRecoveryDigest: digest });
    }
    await appendV2JournalEvents(session, operationId, (journal) => {
      const artifacts = artifactRefsFor(session, intentPhase);
      return [
        {
          eventType: "EXTERNAL_OPERATION_DISPATCHED",
          payload: {
            eventType: "EXTERNAL_OPERATION_DISPATCHED",
            gateId: session.gateId,
            generationId: session.gateId,
            epochId: session.epochId,
            operationId,
            dispatchAttemptId: newId(),
            phase: intentPhase,
            role: intentRole,
            candidateOrTargetSetDigest: computeCanonicalJsonFingerprint({
              operationKind: operation.kind,
              artifacts,
            }),
            inputBindingDigest: digest,
            protocolFingerprint: protocol.reviewProtocolFingerprint,
            expectedWitnessFrontier: journal.frontierHash,
            protectedLeaseProofDigest: null,
          },
        },
      ];
    });
    return Object.freeze({ operationId, preparedRecoveryDigest: digest });
  };

  const preparedDecisionOutcome = (
    kind: CallerRoutingDecisionOutcomeV1["kind"],
    operationId: string | null,
    guidance: string | null,
  ): CallerRoutingDecisionOutcomeV1 =>
    Object.freeze({ kind, operationId, guidance });

  /**
   * Task 17 — execute the caller-owned routing decision for the session's
   * active gate. For `execute_operation` it fetches the durable prepared
   * operation from the recovery store, verifies the caller's operation id
   * and the current planner result against it, records execution once, then
   * executes the one step and witnesses the result; for `block` it records the
   * caller's reason as a durable stop event; for `await_evidence` it returns
   * without mutating any state.
   */
  const executeNextOperation = async (
    sessionId: string,
    decision: CallerRoutingDecisionV1,
  ): Promise<CallerRoutingDecisionOutcomeV1> => {
    const session = sessions.get(sessionId);
    if (session === undefined) {
      return preparedDecisionOutcome(
        "blocked",
        decision.operationId,
        "review_gate_session_not_active",
      );
    }
    if (decision.kind === "await_evidence") {
      // The caller waits for durable evidence: return without appending an
      // event, clearing session state or revalidating anything.
      return preparedDecisionOutcome(
        "awaited",
        decision.operationId,
        decision.reason ?? null,
      );
    }
    if (decision.kind === "block") {
      const reason = decision.reason;
      if (reason === null || reason.trim().length === 0) {
        return preparedDecisionOutcome(
          "blocked",
          decision.operationId,
          "review_gate_block_reason_required",
        );
      }
      // Fail-closed stop with an EXISTING durable event type. The
      // coordinator's journal is the legacy Review Gate event stream, which
      // carries no REVIEW_COMMIT_FAILED event; the caller's reason is
      // recorded on EXECUTION_SUSPENDED instead of inventing an event type.
      const projection = await loadProjection(session.gateId);
      if (projection.status === "completed" || projection.status === "suspended") {
        return preparedDecisionOutcome(
          "blocked",
          decision.operationId,
          `review_gate_already_${projection.status}`,
        );
      }
      const response = await suspendAndBlock(
        session,
        reason,
        `the caller blocked the Review Gate (${reason}); the Gate is suspended.`,
      );
      return preparedDecisionOutcome(
        "blocked",
        decision.operationId,
        response.action === "inject" ? response.injectedContext : reason,
      );
    }
    // execute_operation
    const operationId = decision.operationId;
    if (operationId === null || operationId.trim().length === 0) {
      return preparedDecisionOutcome(
        "blocked",
        operationId,
        "review_gate_operation_id_required",
      );
    }
    if (recovery === null) {
      return preparedDecisionOutcome(
        "blocked",
        operationId,
        "review_gate_recovery_store_unavailable",
      );
    }
    let prepared: PreparedReviewGateOperationRecordV1;
    try {
      const fetched = await readPreparedOperation(session, operationId);
      if (fetched === "missing" || fetched === "mismatch" || fetched === "ambiguous") {
        let guidance: string;
        if (fetched === "missing") {
          guidance = "review_gate_prepared_operation_unavailable";
        } else if (fetched === "mismatch") {
          guidance = "review_gate_prepared_operation_mismatch";
        } else {
          guidance = "review_gate_prepared_operation_ambiguous";
        }
        return preparedDecisionOutcome(
          "blocked",
          operationId,
          guidance,
        );
      }
      prepared = fetched;
    } catch (err: unknown) {
      return preparedDecisionOutcome(
        "blocked",
        operationId,
        `review_gate_prepared_operation_unreadable: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    // The caller's operation id must exactly match the durable prepared record.
    if (prepared.operationId !== operationId || prepared.gateId !== session.gateId) {
      return preparedDecisionOutcome(
        "blocked",
        operationId,
        "review_gate_prepared_operation_mismatch",
      );
    }
    const projection = await loadProjection(session.gateId);
    let planned: ReviewGateNextOperation;
    try {
      const context = await buildContext(session, projection);
      planned = planReviewGateNextOperation(projection, context);
    } catch (err: unknown) {
      return preparedDecisionOutcome(
        "blocked",
        operationId,
        `review_gate_replanning_failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (
      computeCanonicalJsonFingerprint(planned) !==
      computeCanonicalJsonFingerprint(prepared.operation)
    ) {
      return preparedDecisionOutcome(
        "blocked",
        operationId,
        "review_gate_prepared_operation_mismatch",
      );
    }
    const executedRecord = Object.freeze({
      recordKind: EXECUTED_OPERATION_RECORD_KIND,
      schemaVersion: 1,
      gateId: session.gateId,
      operationId,
    });
    const executedBytes = Buffer.from(JSON.stringify(executedRecord), "utf8");
    const executedDigest = computeArtifactDigest(executedBytes);
    try {
      const publication = await recovery.publish(executedDigest, executedBytes);
      if (publication === "exists") {
        return preparedDecisionOutcome(
          "blocked",
          operationId,
          "review_gate_operation_already_executed",
        );
      }
    } catch (err: unknown) {
      return preparedDecisionOutcome(
        "blocked",
        operationId,
        `review_gate_operation_execution_record_failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    try {
      const step = await executeOperation(session, projection, planned);
      // Task 18 — V2 evidence append after a successful execute_operation,
      // based on the executed operation kind. The legacy outcome above is
      // already durable; a V2 journal/witness failure after it fails closed
      // with a typed blocked guidance instead of silently dropping evidence.
      const executedDispatchPacket =
        step !== DRIVE_CONTINUE && step !== null && step.action === "inject" && session.pending !== null
          ? session.pending.packet
          : null;
      if (executedDispatchPacket !== null) {
        const dispatchDraftContext = executedDispatchPacket;
        await appendV2JournalEvents(session, operationId, (journal) => [
          buildDispatchedDraftForExecution(session, dispatchDraftContext, journal.frontierHash),
        ].filter((draft): draft is V2EventDraft => draft !== null));
      } else if (
        step === DRIVE_CONTINUE && planned.kind === "commit_finding_reconciliation"
      ) {
        const batch = planned.batch;
        await appendV2JournalEvents(session, operationId, (journal) =>
          buildResolutionDraftsForBatch(session, projection, operationId, batch.findings, journal.frontierHash),
        );
      }
      if (step === DRIVE_CONTINUE || step === null) {
        return preparedDecisionOutcome("executed", operationId, null);
      }
      return preparedDecisionOutcome(
        "executed",
        operationId,
        step.action === "inject" ? step.injectedContext : null,
      );
    } catch (err: unknown) {
      return preparedDecisionOutcome(
        "blocked",
        operationId,
        `review_gate_operation_execution_failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  };

  // ---------------------------------------------------------------------------
  // startOrResume
  // ---------------------------------------------------------------------------

  const driveReviewGateAdmission = async (
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

    const runLegacyMissingAdmissionFallback = async (): Promise<ReviewGateCommandResult> => {
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

    if (scopeAdmission === null || workspaceRoot === null || workspaceIdentity === null) {
      return runLegacyMissingAdmissionFallback();
    }

    /**
     * Task 4d — durable V2 Gate creation under the admission lease. The witness
     * owns the scope/Gate locks, so the publication is prepared and committed
     * before the lease returns; the outer driver then resumes the new Gate.
     */
    const applyAdmittedCreation = async (
      decision: Extract<
        AdmissionDecision,
        { kind: "CREATE_GENESIS" | "CREATE_SUCCESSOR" }
      >,
      observation: ReviewGateAdmissionObservation | null,
      owned: AdmissionOwnedWitness,
    ): Promise<ReviewGateAdmissionExecutionResult> => {
      if (observation === null) {
        throw new Error("review_gate_admitted_creation_observation_missing");
      }
      if (eventStore.prepareAdmittedGenerationPublication === undefined) {
        throw new Error("review_gate_admitted_generation_store_surface_missing");
      }

      const installation = await owned.readInstallation();
      const frontier = await owned.readVerifiedFrontier();
      const scopeId = decision.scopeId;
      const gateId = newId() as GateId;
      const writerId = newWriterId() as WriterId;
      const operationId = newId();
      const generationId = newId();
      const epochId = installation.epoch as EpochId;
      const eventId = newId();
      const parentEventId = newId();

      const designArtifact = observation.snapshot.current.design;
      const planArtifact = observation.snapshot.current.plan;
      const requirementsResolution = observation.requirementsResolution;

      const pathPairDigest = computeCanonicalJsonFingerprint({
        canonicalDesignPath: designArtifact.canonicalPath,
        canonicalPlanPath: planArtifact.canonicalPath,
      });

      let scopeEnrollment: ScopeEnrollmentV1;
      let supersedesGateId: string | null;

      if (decision.kind === "CREATE_GENESIS") {
        const authority = await owned.readFirstEnrollmentAuthority();
        if (authority === null) {
          throw new Error("review_gate_admitted_creation_first_enrollment_missing");
        }
        supersedesGateId = null;
        scopeEnrollment = {
          scopeId,
          workflowContinuityId: newId(),
          canonicalDesignPath: designArtifact.canonicalPath,
          canonicalPlanPath: planArtifact.canonicalPath,
          pathPairDigest,
          provenance: {
            kind: "verified_genesis",
            evidenceDigest: computeCanonicalJsonFingerprint(authority),
            priorScopeId: null,
            priorGateId: null,
          },
          gateMembership: [],
        };
      } else {
        const predecessor = observation.snapshot.currentTips.find(
          (tip) =>
            tip.status === "completed" &&
            tip.scopeId === decision.predecessorScopeId &&
            tip.gateId === decision.predecessorGateId &&
            tip.completedApproval.approvalEventId === decision.predecessorApprovalEventId,
        );
        if (predecessor === undefined || predecessor.status !== "completed") {
          throw new Error("review_gate_admitted_creation_predecessor_missing");
        }
        supersedesGateId = decision.predecessorGateId;
        const provisionalEnrollment: ScopeEnrollmentV1 = {
          scopeId,
          workflowContinuityId: newId(),
          canonicalDesignPath: designArtifact.canonicalPath,
          canonicalPlanPath: planArtifact.canonicalPath,
          pathPairDigest,
          provenance: {
            kind: "verified_completed_successor",
            evidenceDigest: "", // computed below after the scope is fully formed
            priorScopeId: decision.predecessorScopeId,
            priorGateId: decision.predecessorGateId,
          },
          gateMembership: [],
        };
        const evidenceDigest = computeCanonicalJsonFingerprint({
          installationId: installation.installationId,
          operationId,
          expectedWorkspaceFrontier: frontier.globalFrontierHash,
          scope: {
            ...provisionalEnrollment,
            provenance: {
              kind: "verified_completed_successor",
              evidenceDigest: "",
              priorScopeId: decision.predecessorScopeId,
              priorGateId: decision.predecessorGateId,
            },
          },
        });
        scopeEnrollment = {
          ...provisionalEnrollment,
          provenance: {
            ...provisionalEnrollment.provenance,
            evidenceDigest,
          },
        };
      }

      const scopeEnrollmentWithGate: ScopeEnrollmentV1 = {
        ...scopeEnrollment,
        gateMembership: [
          ...scopeEnrollment.gateMembership,
          {
            gateId,
            generationId,
            supersedesGateId,
            admissionEventId: eventId,
            writerIds: [writerId],
          },
        ],
      };

      const gateEvent = validateReviewGateEventRecord({
        schemaVersion: 2,
        eventId,
        parentEventId,
        emittedAt: now(),
        gateId,
        epochId,
        generationId,
        writerId,
        eventType: "GATE_CREATED",
        payload: {
          reviewScopeId: scopeId,
          supersedesGateId,
          requirementsResolution,
          designArtifact,
          planArtifact,
          reviewProtocolFingerprint: observation.snapshot.current.globalProtocolFingerprint,
          designProtocolFingerprint: observation.snapshot.current.designProtocolFingerprint,
          planProtocolFingerprint: observation.snapshot.current.planProtocolFingerprint,
        },
      });

      const writerHeadHash = computeArtifactDigest(
        Buffer.from(`${encodeReviewGateEventRecord(gateEvent)}\n`),
      );

      const membershipPayload: AdmittedMembershipAuthorizationPayload = {
        installationId: installation.installationId,
        workspaceIdentity: frontier.workspaceIdentity,
        operationId,
        expectedWorkspaceFrontier: frontier.globalFrontierHash,
        scope: scopeEnrollmentWithGate,
      };

      const membership = {
        gateId,
        generationId,
        operationId,
        writerId,
        writerHead: { sequence: 1, hash: writerHeadHash },
        supersedesGateId,
        authorization: {
          ...membershipPayload,
          signature: await owned.signAdmittedMembership(membershipPayload),
        },
      };

      const publication = await eventStore.prepareAdmittedGenerationPublication(
        {
          scopeId,
          gateId,
          writerId,
          operationId,
          canonicalEvents: [gateEvent],
          decision,
          observation,
          membership,
        },
        owned,
      );

      const commitResult = await owned.commitPreparedPublicationCAS({
        publicationId: publication.publicationId,
        expectedGlobalFrontier: publication.expectedGlobalFrontier,
        expectedWriterHash: publication.expectedWriterHash,
      });

      if (commitResult !== "advanced" && commitResult !== "already_committed") {
        throw new Error("review_gate_admitted_creation_commit_blocked");
      }

      await eventStore.writeScopeIndex(scopeId, gateId);

      return Object.freeze({ kind: "MUTABLE_APPLICATION_YIELDED" });
    };

    // Admission authority spans decision application: the callback returns the
    // internal execution result while the lease is held, and only the outer
    // driver converts RESULT/BLOCK to the public command result.
    const applyDecision = async (): Promise<ReviewGateAdmissionExecutionResult> =>
      scopeAdmission.withAdmissionLease(
        {
          workspaceRoot,
          workspaceIdentity,
          designPath,
          planPath,
          explicitRequirementsPath: request.requirementsPath,
          protocol,
        },
        (decision, observation, owned) => {
          const blockUnsupported = (reason: string): ReviewGateAdmissionExecutionResult =>
            Object.freeze({
              kind: "BLOCK",
              reason,
              result: blockedResult(
                designPath,
                planPath,
                `[JUSTICE: REVIEW GATE BLOCKED] ${reason}`,
              ),
            });
          const applyCreation = (
            admittedDecision: Extract<AdmissionDecision, { kind: "CREATE_GENESIS" | "CREATE_SUCCESSOR" }>,
          ): Promise<ReviewGateAdmissionExecutionResult> =>
            applyAdmittedCreation(admittedDecision, observation, owned);
          const findAdmittedTip = (
            gateId: string,
            generationId: string,
          ) => observation?.snapshot.currentTips.find(
            (tip) =>
              tip.status !== "completed" &&
              tip.gateId === gateId &&
              tip.generationId === generationId,
          );
          const matchingPrecedence = (
            gateId: string,
            generationId: string,
            witnessFrontierHash: string,
          ) => {
            const snapshot = observation?.snapshot;
            const precedence = snapshot?.precedence;
            return snapshot !== undefined &&
              precedence !== null &&
              precedence !== undefined &&
              snapshot.verifiedFrontierHash === witnessFrontierHash &&
              precedence.gateId === gateId &&
              precedence.generationId === generationId &&
              precedence.witnessFrontierHash === witnessFrontierHash
              ? precedence
              : null;
          };
          const handlers: ReviewGateAdmissionHandlers = {
            BLOCK: (admittedDecision) => Promise.resolve(Object.freeze({
              kind: "BLOCK",
              reason: admittedDecision.reason,
              result: blockedResult(
                request.designPath,
                planPath,
                `[JUSTICE: REVIEW GATE BLOCKED] Scope admission blocked: ${admittedDecision.detail}`,
              ),
            })),
            REUSE_COMPLETED: (admittedDecision) => {
              const previous = dropSession(sessionId);
              if (previous !== undefined) releaseHandles(previous);
              return Promise.resolve(Object.freeze({
                kind: "RESULT",
                result: Object.freeze({
                  dispatched: false,
                  gateId: admittedDecision.gateId as GateId,
                  guidance: [
                    "---",
                    "[JUSTICE: REVIEW GATE CLEAR]",
                    "",
                    "An exactly matching completed Review Gate was reused read-only (verified by scope admission). Implementation authorization still requires the explicit user command:",
                    `/justice-implement --plan ${planPath} --approved`,
                    "---",
                  ].join("\n"),
                  designPath,
                  planPath,
                  designDigest,
                  planDigest,
                  lockPhase: "awaiting_implementation_authorization",
                  completedReuse: true,
                }),
              }));
            },
            CREATE_GENESIS: (admittedDecision) => applyCreation(admittedDecision),
            CREATE_SUCCESSOR: (admittedDecision) => applyCreation(admittedDecision),
            RESUME: (admittedDecision) => Promise.resolve(Object.freeze({
              kind: "RESUME_ADMITTED",
              gateId: admittedDecision.gateId,
            })),
            STAY_SUSPENDED: () => Promise.resolve(blockUnsupported("The admitted Gate is suspended and cannot be resumed by this request.")),
            REVALIDATE_OR_BLOCK: (admittedDecision) => {
              const snapshot = observation?.snapshot;
              if (snapshot === undefined) {
                return Promise.resolve(blockUnsupported("Same-generation revalidation observation is unavailable."));
              }
              const tip = findAdmittedTip(admittedDecision.gateId, admittedDecision.generationId);
              if (
                tip === undefined ||
                tip.status === "completed" ||
                !admittedDecision.predecessorProofRefs.includes(tip.lastVerifiedBinding.admission.gateCreatedEventId) ||
                !admittedDecision.predecessorProofRefs.includes(tip.lastVerifiedBinding.effective.authorityEventId)
              ) {
                return Promise.resolve(blockUnsupported("Same-generation invalidation lacks matching authenticated predecessor proofs."));
              }
              owned.assertOwnedScope(snapshot.scopeId);
              owned.assertOwnedGate(admittedDecision.gateId);
              return Promise.resolve(Object.freeze({
                kind: "RESUME_ADMITTED",
                gateId: admittedDecision.gateId,
              }));
            },
            UPSTREAM_PRECEDENCE_REQUIRED: (admittedDecision) => {
              const precedence = matchingPrecedence(
                admittedDecision.gateId,
                admittedDecision.generationId,
                admittedDecision.witnessFrontierHash,
              );
              const tip = findAdmittedTip(admittedDecision.gateId, admittedDecision.generationId);
              const blocker = precedence?.currentUpstreamBlockers.find((candidate) =>
                admittedDecision.blockers.some((expected) =>
                  expected.lineageId === candidate.lineageId &&
                  expected.findingEventId === candidate.findingEventId &&
                  expected.currentStatusEventId === candidate.currentStatusEventId &&
                  expected.committedAuthorityEventId === candidate.committedAuthorityEventId &&
                  expected.owner === candidate.owner,
                ),
              );
              const completeBlockerSet = precedence !== null &&
                precedence.currentUpstreamBlockers.length === admittedDecision.blockers.length &&
                admittedDecision.blockers.every((expected) =>
                  precedence.currentUpstreamBlockers.some((current) =>
                    current.lineageId === expected.lineageId &&
                    current.findingEventId === expected.findingEventId &&
                    current.currentStatusEventId === expected.currentStatusEventId &&
                    current.committedAuthorityEventId === expected.committedAuthorityEventId &&
                    current.owner === expected.owner,
                  ),
                );
              if (precedence === null || tip === undefined || blocker === undefined || !completeBlockerSet) {
                return Promise.resolve(blockUnsupported("Upstream precedence proof is stale or does not match the admitted tip."));
              }
              const scopeId = observation?.snapshot.scopeId;
              if (scopeId === undefined) {
                return Promise.resolve(blockUnsupported("Upstream precedence observation is unavailable."));
              }
              if (precedence.phase !== "design") {
                return Promise.resolve(blockUnsupported("Plan-phase upstream reopen lacks the exact downstream restore provenance required by Core."));
              }
              owned.assertOwnedScope(scopeId);
              owned.assertOwnedGate(admittedDecision.gateId);
              const verifiedUpstreamReopen: VerifiedUpstreamReopenContextV1 = Object.freeze({
                gateId: admittedDecision.gateId,
                generationId: admittedDecision.generationId,
                currentPhase: precedence.phase,
                upstreamBlocker: Object.freeze({
                  lineageId: blocker.lineageId,
                  findingEventId: blocker.findingEventId,
                  currentOwner: blocker.owner,
                  committedAuthorityEventId: blocker.committedAuthorityEventId,
                }),
                downstream: null,
                restoreCompletion: null,
                verifiedFrontierHash: admittedDecision.witnessFrontierHash,
              });
              return Promise.resolve(Object.freeze({
                kind: "RESUME_ADMITTED",
                gateId: admittedDecision.gateId,
                verifiedUpstreamReopen,
              }));
            },
            STALE_LINEAGE_REVALIDATION_REQUIRED: (admittedDecision) => {
              const precedence = matchingPrecedence(
                admittedDecision.gateId,
                admittedDecision.generationId,
                admittedDecision.witnessFrontierHash,
              );
              const tip = findAdmittedTip(admittedDecision.gateId, admittedDecision.generationId);
              const pendingMatches = precedence !== null &&
                precedence.pendingStaleLineages.length === admittedDecision.pending.length &&
                admittedDecision.pending.every((expected) =>
                  precedence.pendingStaleLineages.some((current) =>
                    current.lineageId === expected.lineageId &&
                    current.staleEvidenceEventId === expected.staleEvidenceEventId &&
                    current.requiredRevalidationRuleId === expected.requiredRevalidationRuleId,
                  ),
                );
              if (!pendingMatches || tip === undefined) {
                return Promise.resolve(blockUnsupported("Stale-lineage evidence is missing or no longer matches the admitted tip."));
              }
              const scopeId = observation?.snapshot.scopeId;
              if (scopeId === undefined) {
                return Promise.resolve(blockUnsupported("Stale-lineage observation is unavailable."));
              }
              owned.assertOwnedScope(scopeId);
              owned.assertOwnedGate(admittedDecision.gateId);
              return Promise.resolve(Object.freeze({
                kind: "RESUME_ADMITTED",
                gateId: admittedDecision.gateId,
              }));
            },
            INSPECT_NC1_ELIGIBLE_CHANGE: () => Promise.resolve(blockUnsupported("NC1 eligibility inspection is not an execution authorization.")),
            REENTRY_CANDIDATE: () => Promise.resolve(blockUnsupported("NC1 reentry requires a separately admitted validation operation.")),
          };
          return applyReviewGateAdmissionDecision({ decision, observation, owned }, handlers);
        },
      );

    // Contention waits for the lease (bounded); it never skips admission.
    let execution: ReviewGateAdmissionExecutionResult | null = null;
    let resumeDecisionNeedsRevalidation = false;
    for (let attempt = 0; attempt < ADMISSION_LEASE_WAIT_ATTEMPTS; attempt += 1) {
      try {
        execution = await applyDecision();
      } catch (err) {
        if (
          err instanceof ScopeAdmissionBlocked &&
          err.code === "scope_lease_occupied" &&
          attempt + 1 < ADMISSION_LEASE_WAIT_ATTEMPTS
        ) {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, ADMISSION_LEASE_WAIT_MS);
          });
          continue;
        }
        if (err instanceof ScopeAdmissionBlocked) {
          return blockedResult(
            designPath,
            planPath,
            `[JUSTICE: REVIEW GATE BLOCKED] Scope admission failed closed (${err.code}); resolve the admission issue before retrying.`,
          );
        }
        throw err;
      }
      if (execution?.kind === "MUTABLE_APPLICATION_YIELDED") {
        execution = null;
        continue;
      }
      if (execution?.kind === "RESUME_ADMITTED" && !resumeDecisionNeedsRevalidation) {
        resumeDecisionNeedsRevalidation = true;
        execution = null;
        continue;
      }
      break;
    }
    if (execution === null) {
      return blockedResult(
        designPath,
        planPath,
        "[JUSTICE: REVIEW GATE BLOCKED] The scope admission lease stayed occupied; retry after the active gate releases it.",
      );
    }
    if (execution.kind === "RESULT" || execution.kind === "BLOCK") {
      return execution.result;
    }
    if (execution.kind === "RESUME_ADMITTED") {
      return resumeExistingGate(
        sessionId,
        execution.gateId as GateId,
        reviewScopeId,
        designPath,
        planPath,
        designDigest,
        planDigest,
        execution.verifiedUpstreamReopen,
      );
    }
    if (execution.kind === "HANDOFF_PENDING" || execution.kind === "TERMINAL_INTENT_PREPARED_UNPUBLISHED") {
      return blockedResult(
        designPath,
        planPath,
        "[JUSTICE: REVIEW GATE BLOCKED] Admission produced an authenticated continuation that this coordinator cannot complete.",
      );
    }
    if (execution.kind === "MUTABLE_APPLICATION_YIELDED") {
      return blockedResult(designPath, planPath, "[JUSTICE: REVIEW GATE BLOCKED] Mutable admission continuation is unavailable.");
    }
    throw new Error("review_gate_admission_execution_unsupported");
  };

  const resumeExistingGate = async (
    sessionId: string,
    gateId: GateId,
    reviewScopeId: ReviewScopeId,
    designPath: string,
    planPath: string,
    designDigest: string,
    planDigest: string,
    verifiedUpstreamReopen?: VerifiedUpstreamReopenContextV1,
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

    const projection = await loadProjection(gateId);
    if (projection.status === "completed") {
      chain.scopeLock.release();
      chain.gateLock.release();
      return blockedResult(
        designPath,
        planPath,
        "[JUSTICE: REVIEW GATE BLOCKED] The Gate completed before its admitted resume acquired the local locks.",
      );
    }

    const writerId = newWriterId() as WriterId;
    const epochId = projection.epoch.epochId as EpochId;
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
      ...(verifiedUpstreamReopen === undefined ? {} : { verifiedUpstreamReopen }),
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
    startOrResume: driveReviewGateAdmission,
    preToolUse,
    postToolUse,
    classifyToolUse,
    releaseSession,
    prepareCallerOperation,
    executeNextOperation,
  });
}
