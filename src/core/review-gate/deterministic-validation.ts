/**
 * Registered deterministic validation for the Review Gate (DVF1).
 *
 * Deterministic validators are Justice-owned, code-defined checks whose
 * findings never originate from a model: severity, owner scope, violation
 * type, governing reference, and violated contract come exclusively from the
 * registered rule descriptor. The module owns three concerns:
 *
 * 1. Registry — validators are registered with a descriptor plus, for
 *    `IN_PROCESS` execution, the runner that produces semantic results.
 *    `ISOLATED_PROCESS` descriptors remain representable without a runner and
 *    yield only unavailable evidence until a sandbox contract exists; that
 *    path never fabricates PASS/FAIL/INDETERMINATE semantic evidence.
 * 2. Scheduling and caching — a validation attempt is keyed by validator
 *    identity, contract/result schema versions, stage, declared input
 *    digests, and the executable/runtime binding. Exact semantic evidence
 *    (PASS, FAIL, INDETERMINATE) is reusable; execution failures and
 *    unavailable evidence are never cached. Re-dispatching the same logical
 *    validation operation under a changed execution environment fails closed
 *    with `VALIDATION_ENVIRONMENT_CHANGED_DURING_ATTEMPT`.
 * 3. DVF1 bridge — executed evidence becomes finding observations. Failures
 *    at `PRECONDITION` stages (e.g. BASELINE_ADMISSION) create no finding;
 *    failures at `FINDING` stages create at most one observation per
 *    `(validationEventId, ruleId)`.
 *
 * Pure core: no I/O and no host imports beyond `node:crypto` (via
 * `./identity.js`). Every returned payload is a frozen snapshot and every
 * contract violation throws before any payload is produced.
 */

import type { ArtifactDigest } from "./types.js";
import {
  canonicalizeArtifactPath,
  computeArtifactDigest,
  computeCanonicalJsonFingerprint,
  isValidArtifactPath,
} from "./identity.js";
import type { FindingOwnerScope, ReviewPhase } from "./lineage.js";

/** Stages at which deterministic validators can be mandatory. */
const VALIDATION_STAGES = [
  "BASELINE_ADMISSION",
  "POST_REMEDIATION_SELF_REVIEW",
  "PRE_CLEAR",
] as const;
export type ValidationStage = (typeof VALIDATION_STAGES)[number];

/** Kinds of input a validator can declare and consume. */
const VALIDATION_INPUT_KINDS = [
  "DESIGN_ARTIFACT",
  "PLAN_ARTIFACT",
  "REQUIREMENTS_ARTIFACT",
  "APPROVAL_BINDING",
  "PINNED_INPUT_DIGESTS",
] as const;
export type ValidationInputKind = (typeof VALIDATION_INPUT_KINDS)[number];

export type DeterministicFindingSeverity = "critical" | "major" | "minor";

export type DeterministicOutcome = "PASS" | "FAIL" | "INDETERMINATE";

/**
 * Failure-treatment policy per stage: `PRECONDITION` failures block the
 * stage without producing review findings; `FINDING` failures surface as
 * DVF1 finding observations.
 */
export type StageFailurePolicy = "PRECONDITION" | "FINDING";

/** Justice-authored contract of one deterministic rule. */
export type DeterministicValidationRuleDescriptor = Readonly<{
  readonly ruleId: string;
  readonly severity: DeterministicFindingSeverity;
  readonly ownerScope: FindingOwnerScope;
  readonly violationType: string;
  readonly governingReference: string;
  readonly violatedContract: string;
}>;

/** Static, code-defined description of a deterministic validator. */
export type DeterministicValidatorDescriptor = Readonly<{
  readonly validatorId: string;
  readonly validatorContractVersion: number;
  readonly resultSchemaVersion: number;
  readonly applicablePhases: readonly ReviewPhase[];
  readonly executionKind: "IN_PROCESS" | "ISOLATED_PROCESS";
  readonly declaredInputs: readonly ValidationInputKind[];
  readonly mandatoryStages: readonly ValidationStage[];
  readonly stageFailurePolicy: Readonly<Record<ValidationStage, StageFailurePolicy>>;
  readonly rules: readonly DeterministicValidationRuleDescriptor[];
}>;

/**
 * A bound input value: `digest` carries the input content digest (or the
 * canonical fingerprint of a structured input); `entries` carries structured
 * key/value payload (e.g. pinned path→digest maps).
 */
export type ValidationInputValue = Readonly<{
  readonly digest: string;
  readonly entries: Readonly<Record<string, string>>;
}>;

/**
 * Executable/runtime binding of a validation attempt. Any change produces a
 * different validation cache key, and a changed binding on an already-pinned
 * logical validation operation fails the attempt closed.
 */
export type ExecutionEnvironmentBinding = Readonly<{
  readonly runtimeId: string;
  readonly runtimeVersion: string;
  readonly executableDigest: string;
}>;

/** Inputs bound to one validation attempt. */
export type ValidationInputBinding = Readonly<{
  readonly validatorId: string;
  readonly validatorContractVersion: number;
  readonly resultSchemaVersion: number;
  readonly stage: ValidationStage;
  readonly declaredInputs: Readonly<Partial<Record<ValidationInputKind, ValidationInputValue>>>;
  readonly executionEnvironment: ExecutionEnvironmentBinding;
}>;

/** One mandatory validation dispatch requested by the review coordinator. */
export type MandatoryValidationDispatch = Readonly<{
  readonly validatorId: string;
  readonly stage: ValidationStage;
  readonly phase: ReviewPhase;
  readonly logicalOperationId: string;
  readonly binding: ValidationInputBinding;
}>;

/**
 * Rule-level observation emitted by an in-process runner. The schema carries
 * no severity, owner scope, violation type, governing reference, or violated
 * contract: those are descriptor-owned and merged at bridge time. `relation`
 * is permitted only on FAIL outcomes and only as `EXISTING | NEW`.
 */
export type DeterministicRuleOutcome = Readonly<{
  readonly ruleId: string;
  readonly outcome: DeterministicOutcome;
  readonly relation?: "EXISTING" | "NEW";
  readonly detailDigest: ArtifactDigest;
}>;

/** Result contract an in-process runner must satisfy exactly. */
export type DeterministicValidatorResult = Readonly<{
  readonly result: DeterministicOutcome;
  readonly ruleOutcomes: readonly DeterministicRuleOutcome[];
}>;

/**
 * Inputs a runner receives: exactly the descriptor's declared inputs. The
 * scheduler strips every other input kind before invocation, so undeclared
 * input use is impossible through the runner interface.
 */
export type DeterministicRunnerInput = Readonly<
  Partial<Record<ValidationInputKind, ValidationInputValue>>
>;

export type InProcessValidator = (
  inputs: DeterministicRunnerInput,
) => DeterministicValidatorResult;

export type RegisteredValidator = Readonly<{
  readonly descriptor: DeterministicValidatorDescriptor;
  readonly runner: InProcessValidator | null;
}>;

/** Registry of deterministic validators keyed by validator id. */
export class DeterministicValidatorRegistry {
  private readonly validators = new Map<string, RegisteredValidator>();

  register(
    descriptor: DeterministicValidatorDescriptor,
    runner: InProcessValidator | null,
  ): void {
    assertValidDescriptor(descriptor);
    if (this.validators.has(descriptor.validatorId)) {
      throw new Error("deterministic_validation_validator_already_registered");
    }
    if (descriptor.executionKind === "IN_PROCESS" && runner === null) {
      throw new Error("deterministic_validation_in_process_runner_required");
    }
    if (descriptor.executionKind === "ISOLATED_PROCESS" && runner !== null) {
      throw new Error("deterministic_validation_sandbox_runner_not_permitted");
    }
    this.validators.set(descriptor.validatorId, {
      descriptor: freezeDescriptor(descriptor),
      runner,
    });
  }

  resolve(validatorId: string): RegisteredValidator | undefined {
    return this.validators.get(validatorId);
  }
}

/** Evidence produced by one executed (or unexecutable) validation dispatch. */
export type ValidationEvidence = Readonly<{
  readonly cacheKey: string;
  readonly validatorId: string;
  readonly stage: ValidationStage;
  readonly logicalOperationId: string;
  readonly kind: "semantic" | "unavailable" | "execution_failure";
  /** Set only for semantic evidence; unavailable/execution failures never fabricate a result. */
  readonly result: DeterministicOutcome | null;
  readonly ruleOutcomes: readonly DeterministicRuleOutcome[];
  readonly reasonCode: string | null;
  readonly provenance: "observed";
  readonly observedAt: string;
}>;

/** Reusable deterministic validation state held by the review coordinator. */
export type DeterministicValidationState = Readonly<{
  readonly cachedEvidence: ReadonlyMap<string, ValidationEvidence>;
  readonly attemptEnvironments: ReadonlyMap<string, string>;
}>;

/**
 * Shared empty state. Safe to reuse: scheduling and commits copy-on-write and
 * never mutate the maps of an existing state.
 */
export const emptyDeterministicValidationState: DeterministicValidationState =
  Object.freeze({
    cachedEvidence: new Map<string, ValidationEvidence>(),
    attemptEnvironments: new Map<string, string>(),
  });

export type ValidationRequirement = Readonly<{
  readonly validatorId: string;
  readonly stage: ValidationStage;
  readonly cacheKey: string;
  readonly disposition: "reuse_evidence" | "dispatch";
  readonly dispatch: MandatoryValidationDispatch | null;
  readonly evidence: ValidationEvidence | null;
}>;

export type MandatoryValidationSchedule = Readonly<{
  readonly requirements: readonly ValidationRequirement[];
  readonly nextState: DeterministicValidationState;
}>;

/**
 * SHA-256 cache key of a validation attempt. Covers validator identity,
 * contract and result schema versions, stage, declared input digests, and the
 * executable/runtime binding. The logical operation id is deliberately not
 * part of the key: identical inputs under identical environments hit the
 * cache regardless of which logical operation requests them.
 */
export function computeValidationCacheKey(binding: ValidationInputBinding): string {
  const declaredInputs = VALIDATION_INPUT_KINDS.flatMap((kind) => {
    // Key originates from the frozen VALIDATION_INPUT_KINDS union.
    // eslint-disable-next-line security/detect-object-injection
    const value = binding.declaredInputs[kind];
    if (!value) return [];
    return [
      {
        kind,
        digest: value.digest,
        entries: sortedEntries(value.entries),
      },
    ];
  });
  return computeCanonicalJsonFingerprint({
    validatorId: binding.validatorId,
    validatorContractVersion: binding.validatorContractVersion,
    resultSchemaVersion: binding.resultSchemaVersion,
    stage: binding.stage,
    declaredInputs,
    executionEnvironment: binding.executionEnvironment,
  });
}

/**
 * Resolve every dispatch into a reuse-or-dispatch requirement. Pins each
 * logical validation operation to its execution environment: re-dispatching
 * a pinned operation under a changed environment fails closed with
 * `VALIDATION_ENVIRONMENT_CHANGED_DURING_ATTEMPT`.
 */
export function scheduleMandatoryValidations(
  registry: DeterministicValidatorRegistry,
  dispatches: readonly MandatoryValidationDispatch[],
  state: DeterministicValidationState,
): MandatoryValidationSchedule {
  const requirements: ValidationRequirement[] = [];
  const attemptEnvironments = new Map(state.attemptEnvironments);
  for (const dispatch of dispatches) {
    const registered = registry.resolve(dispatch.validatorId);
    if (!registered) {
      throw new Error("deterministic_validation_validator_unregistered");
    }
    const descriptor = registered.descriptor;
    if (
      dispatch.binding.validatorId !== dispatch.validatorId ||
      dispatch.binding.stage !== dispatch.stage
    ) {
      throw new Error("deterministic_validation_dispatch_binding_mismatch");
    }
    if (
      !descriptor.mandatoryStages.includes(dispatch.stage) ||
      !descriptor.applicablePhases.includes(dispatch.phase)
    ) {
      throw new Error("deterministic_validation_not_mandatory_for_stage_or_phase");
    }
    const environmentFingerprint = computeCanonicalJsonFingerprint(
      dispatch.binding.executionEnvironment,
    );
    const pinned = attemptEnvironments.get(dispatch.logicalOperationId);
    if (pinned !== undefined && pinned !== environmentFingerprint) {
      throw new Error("VALIDATION_ENVIRONMENT_CHANGED_DURING_ATTEMPT");
    }
    attemptEnvironments.set(dispatch.logicalOperationId, environmentFingerprint);

    const cacheKey = computeValidationCacheKey(dispatch.binding);
    const cached = state.cachedEvidence.get(cacheKey);
    if (cached && cached.kind === "semantic") {
      requirements.push(
        Object.freeze({
          validatorId: dispatch.validatorId,
          stage: dispatch.stage,
          cacheKey,
          disposition: "reuse_evidence" as const,
          dispatch: null,
          evidence: cached,
        }),
      );
      continue;
    }
    requirements.push(
      Object.freeze({
        validatorId: dispatch.validatorId,
        stage: dispatch.stage,
        cacheKey,
        disposition: "dispatch" as const,
        dispatch,
        evidence: null,
      }),
    );
  }
  return Object.freeze({
    requirements: Object.freeze(requirements),
    nextState: Object.freeze({
      cachedEvidence: state.cachedEvidence,
      attemptEnvironments,
    }),
  });
}

/**
 * Execute one dispatch against its registered validator. Produces semantic
 * evidence on a schema-valid runner result; every other outcome degrades to
 * unavailable or execution-failure evidence with no fabricated semantic
 * result, which `commitValidationEvidence` then refuses to cache.
 */
export function executeValidationDispatch(
  registry: DeterministicValidatorRegistry,
  dispatch: MandatoryValidationDispatch,
  now: string,
): ValidationEvidence {
  const registered = registry.resolve(dispatch.validatorId);
  if (!registered) {
    throw new Error("deterministic_validation_validator_unregistered");
  }
  const { descriptor, runner } = registered;
  const base = {
    cacheKey: computeValidationCacheKey(dispatch.binding),
    validatorId: dispatch.validatorId,
    stage: dispatch.stage,
    logicalOperationId: dispatch.logicalOperationId,
    provenance: "observed" as const,
    observedAt: now,
  };

  if (descriptor.executionKind === "ISOLATED_PROCESS" || runner === null) {
    return Object.freeze({
      ...base,
      kind: "unavailable" as const,
      result: null,
      ruleOutcomes: Object.freeze([]) as readonly DeterministicRuleOutcome[],
      reasonCode: "deterministic_validation_sandbox_unavailable",
    });
  }

  const runnerInputs: Record<ValidationInputKind, ValidationInputValue> = {} as Record<
    ValidationInputKind,
    ValidationInputValue
  >;
  for (const kind of descriptor.declaredInputs) {
    // Key originates from the descriptor's frozen ValidationInputKind union.
    // eslint-disable-next-line security/detect-object-injection
    const value = dispatch.binding.declaredInputs[kind];
    if (!value) {
      return executionFailureEvidence(base, "deterministic_validation_missing_declared_input");
    }
    // Key originates from the descriptor's frozen ValidationInputKind union.
    // eslint-disable-next-line security/detect-object-injection
    runnerInputs[kind] = value;
  }

  let rawResult: unknown;
  try {
    rawResult = runner(Object.freeze(runnerInputs));
  } catch {
    return executionFailureEvidence(base, "deterministic_validation_runner_threw");
  }
  const validated = validateRunnerResult(descriptor, rawResult);
  if (validated === null) {
    return executionFailureEvidence(base, "deterministic_validation_result_schema_invalid");
  }
  return Object.freeze({
    ...base,
    kind: "semantic" as const,
    result: validated.result,
    ruleOutcomes: validated.ruleOutcomes,
    reasonCode: null,
  });
}

/**
 * Fold executed evidence into the reusable state. Only semantic evidence
 * (exact PASS/FAIL/INDETERMINATE results) enters the cache; unavailable and
 * execution-failure evidence is never cached.
 */
export function commitValidationEvidence(
  state: DeterministicValidationState,
  evidence: ValidationEvidence,
): DeterministicValidationState {
  if (evidence.kind !== "semantic") {
    return state;
  }
  const cachedEvidence = new Map(state.cachedEvidence);
  cachedEvidence.set(evidence.cacheKey, evidence);
  return Object.freeze({
    cachedEvidence,
    attemptEnvironments: state.attemptEnvironments,
  });
}

export type DeterministicFindingObservation = Readonly<{
  readonly validationEventId: string;
  readonly ruleId: string;
  readonly severity: DeterministicFindingSeverity;
  readonly ownerScope: FindingOwnerScope;
  readonly violationType: string;
  readonly governingReference: string;
  readonly violatedContract: string;
  readonly relation: "EXISTING" | "NEW";
  readonly detailDigest: ArtifactDigest;
}>;

/** DVF1 (Deterministic Validation Findings, schema 1) observed payload. */
export type DeterministicFindingsObservedPayload = Readonly<{
  readonly schemaVersion: 1;
  readonly validationEventId: string;
  readonly findings: readonly DeterministicFindingObservation[];
}>;

export type DeterministicFindingsBridgeInput = Readonly<{
  readonly validationEventId: string;
  readonly evidences: readonly ValidationEvidence[];
  readonly registry: DeterministicValidatorRegistry;
}>;

/**
 * DVF1 bridge: turn executed deterministic evidence into finding
 * observations. Every finding field comes from the registered rule
 * descriptor — never from the runner or a model. Failures at PRECONDITION
 * stages create no finding. Unavailable/execution-failure evidence at a
 * FINDING stage maps to a single `DETERMINISTIC_VALIDATION_FAILED`
 * observation. Observations dedupe by `(validationEventId, ruleId)`.
 */
export function bridgeDeterministicFindings(
  input: DeterministicFindingsBridgeInput,
): DeterministicFindingsObservedPayload {
  const deduped = new Map<string, DeterministicFindingObservation>();
  for (const evidence of input.evidences) {
    const registered = input.registry.resolve(evidence.validatorId);
    if (!registered) {
      throw new Error("deterministic_validation_bridge_unregistered_validator");
    }
    const descriptor = registered.descriptor;
    const policy = descriptor.stageFailurePolicy[evidence.stage];
    if (policy !== "FINDING") {
      continue;
    }
    for (const observation of observationsForEvidence(evidence, descriptor, input.validationEventId)) {
      // Both key parts originate from frozen internal payloads.
      // eslint-disable-next-line security/detect-object-injection
      const key = `${observation.validationEventId}\0${observation.ruleId}`;
      if (!deduped.has(key)) {
        deduped.set(key, observation);
      }
    }
  }
  return Object.freeze({
    schemaVersion: 1 as const,
    validationEventId: input.validationEventId,
    findings: Object.freeze([...deduped.values()]),
  });
}

function observationsForEvidence(
  evidence: ValidationEvidence,
  descriptor: DeterministicValidatorDescriptor,
  validationEventId: string,
): readonly DeterministicFindingObservation[] {
  const observations: DeterministicFindingObservation[] = [];
  if (evidence.kind === "semantic") {
    for (const outcome of evidence.ruleOutcomes) {
      if (outcome.outcome !== "FAIL") {
        continue;
      }
      const rule = descriptor.rules.find((candidate) => candidate.ruleId === outcome.ruleId);
      if (!rule) {
        throw new Error("deterministic_validation_bridge_unknown_rule");
      }
      if (outcome.relation !== "EXISTING" && outcome.relation !== "NEW") {
        throw new Error("deterministic_validation_bridge_invalid_relation");
      }
      observations.push(
        Object.freeze({
          validationEventId,
          ruleId: rule.ruleId,
          severity: rule.severity,
          ownerScope: rule.ownerScope,
          violationType: rule.violationType,
          governingReference: rule.governingReference,
          violatedContract: rule.violatedContract,
          relation: outcome.relation,
          detailDigest: outcome.detailDigest,
        }),
      );
    }
    return observations;
  }
  if (evidence.kind === "unavailable" || evidence.kind === "execution_failure") {
    const rule = descriptor.rules[0];
    if (!rule) {
      throw new Error("deterministic_validation_bridge_unruled_validator");
    }
    observations.push(
      Object.freeze({
        validationEventId,
        ruleId: rule.ruleId,
        severity: rule.severity,
        ownerScope: rule.ownerScope,
        violationType: "DETERMINISTIC_VALIDATION_FAILED",
        governingReference: rule.governingReference,
        violatedContract: rule.violatedContract,
        relation: "NEW",
        detailDigest: digestDetail(evidence.reasonCode ?? "deterministic_validation_failed"),
      }),
    );
  }
  return observations;
}

// ---------------------------------------------------------------------------
// v4 production validators
// ---------------------------------------------------------------------------

const REVIEW_INPUT_BINDING_INTEGRITY_RULE: DeterministicValidationRuleDescriptor =
  Object.freeze({
    ruleId: "review-input-binding-reconstruction",
    severity: "critical",
    ownerScope: "requirements",
    violationType: "REVIEW_INPUT_BINDING_INTEGRITY_VIOLATION",
    governingReference: "review-gate/dvf1#baseline-admission",
    violatedContract: "review-input-binding-integrity-v1/reconstruction",
  });

/**
 * BASELINE_ADMISSION precondition validator: verifies that the pinned
 * artifact paths/digests and the approved Design binding can be reconstructed
 * against each other before any review work is admitted.
 */
export const REVIEW_INPUT_BINDING_INTEGRITY_V1: DeterministicValidatorDescriptor =
  Object.freeze({
    validatorId: "review-input-binding-integrity-v1",
    validatorContractVersion: 1,
    resultSchemaVersion: 1,
    applicablePhases: Object.freeze(["design", "plan"] as const),
    executionKind: "IN_PROCESS" as const,
    declaredInputs: Object.freeze([
      "PINNED_INPUT_DIGESTS",
      "APPROVAL_BINDING",
      "DESIGN_ARTIFACT",
      "PLAN_ARTIFACT",
    ] as const),
    mandatoryStages: Object.freeze(["BASELINE_ADMISSION"] as const),
    stageFailurePolicy: Object.freeze({
      BASELINE_ADMISSION: "PRECONDITION" as const,
      POST_REMEDIATION_SELF_REVIEW: "PRECONDITION" as const,
      PRE_CLEAR: "PRECONDITION" as const,
    }),
    rules: Object.freeze([REVIEW_INPUT_BINDING_INTEGRITY_RULE]),
  });

const DESIGN_REQUIREMENTS_REFERENCE_RULE: DeterministicValidationRuleDescriptor =
  Object.freeze({
    ruleId: "design-requirements-reference-mismatch",
    severity: "major",
    ownerScope: "design",
    violationType: "DESIGN_REQUIREMENTS_REFERENCE_MISMATCH",
    governingReference: "review-gate/dvf1#design-requirements-reference",
    violatedContract: "design-requirements-reference-consistency-v1/reference-binding",
  });

/**
 * Design finding validator: fails when the Design-declared Requirements
 * reference differs from the bound Requirements path.
 */
export const DESIGN_REQUIREMENTS_REFERENCE_CONSISTENCY_V1: DeterministicValidatorDescriptor =
  Object.freeze({
    validatorId: "design-requirements-reference-consistency-v1",
    validatorContractVersion: 1,
    resultSchemaVersion: 1,
    applicablePhases: Object.freeze(["design"] as const),
    executionKind: "IN_PROCESS" as const,
    declaredInputs: Object.freeze(["DESIGN_ARTIFACT", "REQUIREMENTS_ARTIFACT"] as const),
    mandatoryStages: Object.freeze(["POST_REMEDIATION_SELF_REVIEW", "PRE_CLEAR"] as const),
    stageFailurePolicy: Object.freeze({
      BASELINE_ADMISSION: "PRECONDITION" as const,
      POST_REMEDIATION_SELF_REVIEW: "FINDING" as const,
      PRE_CLEAR: "FINDING" as const,
    }),
    rules: Object.freeze([DESIGN_REQUIREMENTS_REFERENCE_RULE]),
  });

function runReviewInputBindingIntegrity(
  inputs: DeterministicRunnerInput,
): DeterministicValidatorResult {
  const ruleId = REVIEW_INPUT_BINDING_INTEGRITY_RULE.ruleId;
  const pinned = inputs.PINNED_INPUT_DIGESTS;
  const approval = inputs.APPROVAL_BINDING;
  const design = inputs.DESIGN_ARTIFACT;
  const plan = inputs.PLAN_ARTIFACT;
  const detail = digestDetail(`${ruleId}/reconstruction`);
  if (!pinned || !approval || !design || !plan) {
    return freezeResult("INDETERMINATE", [
      { ruleId, outcome: "INDETERMINATE", detailDigest: detail },
    ]);
  }
  const designPath = approval.entries.designArtifactPath ?? "";
  const designDigest = approval.entries.designArtifactDigest ?? "";
  const planPath = approval.entries.planArtifactPath ?? "";
  const planDigest = approval.entries.planArtifactDigest ?? "";
  // Pinned lookups read frozen binding-relative entries; values are compared
  // against digest strings, so non-string prototype keys can never match.
  // eslint-disable-next-line security/detect-object-injection
  const pinnedDesignDigest = pinned.entries[designPath];
  // eslint-disable-next-line security/detect-object-injection
  const pinnedPlanDigest = pinned.entries[planPath];
  const reconstructs =
    isValidArtifactPath(designPath) &&
    isValidArtifactPath(planPath) &&
    pinnedDesignDigest !== undefined &&
    pinnedDesignDigest === designDigest &&
    pinnedPlanDigest !== undefined &&
    pinnedPlanDigest === planDigest &&
    design.digest === designDigest &&
    plan.digest === planDigest;
  return reconstructs
    ? freezeResult("PASS", [{ ruleId, outcome: "PASS", detailDigest: detail }])
    : freezeResult("FAIL", [
        {
          ruleId,
          outcome: "FAIL",
          relation: "NEW",
          detailDigest: digestDetail(
            `${ruleId}/unreconstructable\0${designPath}\0${planPath}`,
          ),
        },
      ]);
}

function runDesignRequirementsReferenceConsistency(
  inputs: DeterministicRunnerInput,
): DeterministicValidatorResult {
  const ruleId = DESIGN_REQUIREMENTS_REFERENCE_RULE.ruleId;
  const design = inputs.DESIGN_ARTIFACT;
  const requirements = inputs.REQUIREMENTS_ARTIFACT;
  const detail = digestDetail(`${ruleId}/reference-binding`);
  if (!design || !requirements) {
    return freezeResult("INDETERMINATE", [
      { ruleId, outcome: "INDETERMINATE", detailDigest: detail },
    ]);
  }
  const declaredReference = design.entries.requirementsReference ?? "";
  const boundPath = requirements.entries.path ?? "";
  const canonicalDeclared = canonicalizeArtifactPath(declaredReference) ?? "";
  const canonicalBound = canonicalizeArtifactPath(boundPath) ?? "";
  if (canonicalDeclared === "" || canonicalBound === "") {
    return freezeResult("INDETERMINATE", [
      { ruleId, outcome: "INDETERMINATE", detailDigest: detail },
    ]);
  }
  return canonicalDeclared === canonicalBound
    ? freezeResult("PASS", [{ ruleId, outcome: "PASS", detailDigest: detail }])
    : freezeResult("FAIL", [
        {
          ruleId,
          outcome: "FAIL",
          relation: "NEW",
          detailDigest: digestDetail(
            `${ruleId}/mismatch\0${canonicalDeclared}\0${canonicalBound}`,
          ),
        },
      ]);
}

/** Registry pre-populated with the two v4 in-process validators. */
export function createDefaultDeterministicValidatorRegistry(): DeterministicValidatorRegistry {
  const registry = new DeterministicValidatorRegistry();
  registry.register(
    REVIEW_INPUT_BINDING_INTEGRITY_V1,
    runReviewInputBindingIntegrity,
  );
  registry.register(
    DESIGN_REQUIREMENTS_REFERENCE_CONSISTENCY_V1,
    runDesignRequirementsReferenceConsistency,
  );
  return registry;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const textEncoder = new TextEncoder();

function digestDetail(text: string): ArtifactDigest {
  return computeArtifactDigest(textEncoder.encode(text));
}

function freezeResult(
  result: DeterministicOutcome,
  ruleOutcomes: readonly DeterministicRuleOutcome[],
): DeterministicValidatorResult {
  return Object.freeze({
    result,
    ruleOutcomes: Object.freeze(ruleOutcomes.map((outcome) => Object.freeze(outcome))),
  });
}

function executionFailureEvidence(
  base: {
    readonly cacheKey: string;
    readonly validatorId: string;
    readonly stage: ValidationStage;
    readonly logicalOperationId: string;
    readonly provenance: "observed";
    readonly observedAt: string;
  },
  reasonCode: string,
): ValidationEvidence {
  return Object.freeze({
    ...base,
    kind: "execution_failure" as const,
    result: null,
    ruleOutcomes: Object.freeze([]) as readonly DeterministicRuleOutcome[],
    reasonCode,
  });
}

function validateRunnerResult(
  descriptor: DeterministicValidatorDescriptor,
  raw: unknown,
): DeterministicValidatorResult | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  if (!hasOnlyKeys(record, ["result", "ruleOutcomes"])) return null;
  const overall = record.result;
  if (overall !== "PASS" && overall !== "FAIL" && overall !== "INDETERMINATE") {
    return null;
  }
  const rawOutcomes = record.ruleOutcomes;
  if (!Array.isArray(rawOutcomes)) return null;
  if (rawOutcomes.length !== descriptor.rules.length) return null;
  const seenRuleIds = new Set<string>();
  const outcomes: DeterministicRuleOutcome[] = [];
  let derived: DeterministicOutcome = "PASS";
  for (const rawOutcome of rawOutcomes) {
    if (typeof rawOutcome !== "object" || rawOutcome === null) return null;
    const outcomeRecord = rawOutcome as Record<string, unknown>;
    if (
      !hasOnlyKeys(outcomeRecord, ["ruleId", "outcome", "relation", "detailDigest"])
    ) {
      return null;
    }
    const ruleId = outcomeRecord.ruleId;
    if (typeof ruleId !== "string") return null;
    const declared = descriptor.rules.find((rule) => rule.ruleId === ruleId);
    if (!declared || seenRuleIds.has(ruleId)) return null;
    seenRuleIds.add(ruleId);
    const outcome = outcomeRecord.outcome;
    if (outcome !== "PASS" && outcome !== "FAIL" && outcome !== "INDETERMINATE") {
      return null;
    }
    const relation = outcomeRecord.relation;
    if (outcome === "FAIL") {
      // The finding-validator result schema permits semantic EXISTING | NEW
      // relation only; anything else (including INVALID or severity injections)
      // is schema-invalid.
      if (relation !== "EXISTING" && relation !== "NEW") return null;
    } else if (relation !== undefined) {
      return null;
    }
    const rawDetailDigest = outcomeRecord.detailDigest;
    if (typeof rawDetailDigest !== "string" || !/^[0-9a-f]{64}$/.test(rawDetailDigest)) {
      return null;
    }
    // Schema-validated above; the brand records the trusted digest contract.
    const detailDigest = rawDetailDigest as ArtifactDigest;
    derived = worstOutcome(derived, outcome);
    outcomes.push(
      outcome === "FAIL"
        ? Object.freeze({
            ruleId,
            outcome,
            relation,
            detailDigest,
          })
        : Object.freeze({ ruleId, outcome, detailDigest }),
    );
  }
  if (derived !== overall) return null;
  return Object.freeze({
    result: overall,
    ruleOutcomes: Object.freeze(outcomes),
  });
}

function worstOutcome(
  left: DeterministicOutcome,
  right: DeterministicOutcome,
): DeterministicOutcome {
  if (left === "FAIL" || right === "FAIL") return "FAIL";
  if (left === "INDETERMINATE" || right === "INDETERMINATE") return "INDETERMINATE";
  return "PASS";
}

function hasOnlyKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return Object.keys(record).every((key) => allowed.includes(key));
}

function sortedEntries(
  entries: Readonly<Record<string, string>>,
): readonly (readonly [string, string])[] {
  return Object.entries(entries).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
}

function assertValidDescriptor(descriptor: DeterministicValidatorDescriptor): void {
  if (typeof descriptor.validatorId !== "string" || descriptor.validatorId.length === 0) {
    throw new Error("deterministic_validation_invalid_descriptor");
  }
  if (
    !Number.isInteger(descriptor.validatorContractVersion) ||
    descriptor.validatorContractVersion <= 0 ||
    !Number.isInteger(descriptor.resultSchemaVersion) ||
    descriptor.resultSchemaVersion <= 0
  ) {
    throw new Error("deterministic_validation_invalid_descriptor");
  }
  if (descriptor.executionKind !== "IN_PROCESS" && descriptor.executionKind !== "ISOLATED_PROCESS") {
    throw new Error("deterministic_validation_invalid_descriptor");
  }
  if (descriptor.applicablePhases.length === 0 || descriptor.mandatoryStages.length === 0) {
    throw new Error("deterministic_validation_invalid_descriptor");
  }
  for (const stage of descriptor.mandatoryStages) {
    if (!VALIDATION_STAGES.includes(stage)) {
      throw new Error("deterministic_validation_invalid_descriptor");
    }
  }
  for (const stage of VALIDATION_STAGES) {
    if (
      // Stage originates from the frozen VALIDATION_STAGES union.
      // eslint-disable-next-line security/detect-object-injection
      descriptor.stageFailurePolicy[stage] !== "PRECONDITION" &&
      // eslint-disable-next-line security/detect-object-injection
      descriptor.stageFailurePolicy[stage] !== "FINDING"
    ) {
      throw new Error("deterministic_validation_invalid_descriptor");
    }
  }
  if (descriptor.rules.length === 0) {
    throw new Error("deterministic_validation_descriptor_requires_rules");
  }
  const seenRuleIds = new Set<string>();
  for (const rule of descriptor.rules) {
    if (
      rule.ruleId.length === 0 ||
      rule.violationType.length === 0 ||
      rule.governingReference.length === 0 ||
      rule.violatedContract.length === 0 ||
      seenRuleIds.has(rule.ruleId)
    ) {
      throw new Error("deterministic_validation_invalid_descriptor");
    }
    seenRuleIds.add(rule.ruleId);
  }
}

function freezeDescriptor(
  descriptor: DeterministicValidatorDescriptor,
): DeterministicValidatorDescriptor {
  return Object.freeze({
    ...descriptor,
    applicablePhases: Object.freeze([...descriptor.applicablePhases]),
    declaredInputs: Object.freeze([...descriptor.declaredInputs]),
    mandatoryStages: Object.freeze([...descriptor.mandatoryStages]),
    stageFailurePolicy: Object.freeze({ ...descriptor.stageFailurePolicy }),
    rules: Object.freeze(
      descriptor.rules.map((rule) => Object.freeze({ ...rule })),
    ),
  });
}
