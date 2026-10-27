import type { AdmissionDecision } from "../core/review-gate/admission";
import {
  buildSemanticContextCompatibilityProof,
  createDefaultDeterministicValidatorRegistry,
  encodeSemanticCompatibilityValidatorInput,
  evaluateSemanticContextCompatibility,
  SEMANTIC_CONTEXT_COMPATIBILITY_V1,
  type VerifiedCompatibilityValidationInputV1,
} from "../core/review-gate/deterministic-validation";
import {
  diffRequirementsSectionInventories,
  buildRequirementsSectionInventory,
  REQUIREMENTS_HEADING_ANCHOR_VERSION,
  RequirementsSectionInventoryError,
  type VerifiedSectionInventory,
} from "../core/review-gate/requirements-section-inventory";
import { planSemanticContextTransition, type SemanticContextTransitionDecision } from "../core/review-gate/cycle-evidence";
import {
  planNonConvergenceReentry,
  type VerifiedReentryInput,
  type ReentryDecision,
} from "../core/review-gate/reentry";
import type {
  SemanticContextInputsV1,
  VerifiedSemanticContextTransitionInput,
} from "../core/review-gate/types";
import type {
  AdmissionOwnedWitness,
  ReviewGateAdmissionExecutionResult,
  ReviewGateAdmissionObservation,
} from "./review-gate-admission-context";

type AdmissionDecisionKind = AdmissionDecision["kind"];

export type ReviewGateAdmissionHandlers = {
  readonly [K in AdmissionDecisionKind]: (
    decision: Extract<AdmissionDecision, { readonly kind: K }>,
    observation: ReviewGateAdmissionObservation | null,
    owned: AdmissionOwnedWitness,
  ) => Promise<ReviewGateAdmissionExecutionResult>;
};

type ReviewGateAdmissionInput = Readonly<{
  readonly decision: AdmissionDecision;
  readonly observation: ReviewGateAdmissionObservation | null;
  readonly owned: AdmissionOwnedWitness;
}>;

export type VerifiedSemanticContextTransitionResult = Readonly<{
  readonly kind: "verified";
  readonly input: VerifiedSemanticContextTransitionInput;
  readonly decision: Exclude<SemanticContextTransitionDecision, { readonly kind: "BLOCK" }>;
}> | Readonly<{ readonly kind: "BLOCK"; readonly reason: string }>;

export type VerifiedAdmissionNC1ReentryResult =
  | Readonly<{
      readonly kind: "REENTER_SAME_GENERATION";
      readonly gateId: string;
      readonly generationId: string;
      readonly epochId: string;
      readonly validationEventId: string;
      readonly input: VerifiedReentryInput;
    }>
  | Readonly<{
      readonly kind: "STAY_SUSPENDED";
      readonly gateId: string;
      readonly generationId: string;
    }>
  | Readonly<{ readonly kind: "BLOCK"; readonly reason: string }>;

export function planAdmissionNC1Reentry(
  decision: Extract<AdmissionDecision, { readonly kind: "REENTRY_CANDIDATE" }>,
  observation: ReviewGateAdmissionObservation | null,
): VerifiedAdmissionNC1ReentryResult {
  const evidence = observation?.nc1Evidence;
  const snapshot = observation?.snapshot;
  const change = evidence?.change;
  if (
    evidence === null ||
    evidence === undefined ||
    snapshot === undefined ||
    change === null ||
    change === undefined ||
    snapshot.nc1Evidence !== evidence ||
    evidence.stop.stopEventId !== decision.nc1StopEventId ||
    evidence.stop.epochId.length === 0 ||
    evidence.stop.phase !== change.phase ||
    evidence.stop.stopEventId !== change.nc1StopEventId ||
    change.gateId !== decision.gateId ||
    change.generationId !== decision.generationId ||
    change.changeObservedEventId !== decision.changeObservedEventId ||
    evidence.stop.stopEventId !== decision.nc1EvidenceEventId ||
    evidence.frontierHash !== decision.witnessFrontierHash ||
    snapshot.verifiedFrontierHash !== decision.witnessFrontierHash ||
    change.witnessFrontierAtObservation !== decision.witnessFrontierHash
  ) {
    return Object.freeze({ kind: "BLOCK", reason: "nc1_admission_evidence_binding_mismatch" });
  }

  const input: VerifiedReentryInput = Object.freeze({
    gateId: decision.gateId,
    generationId: decision.generationId,
    epochId: evidence.stop.epochId,
    phase: evidence.stop.phase,
    remainingRounds: evidence.stop.remainingRounds,
    nc1EvidenceEventId: evidence.stop.stopEventId,
    verifiedChange: change,
    validation: evidence.validationOutcome,
  });
  const planned: ReentryDecision = planNonConvergenceReentry(input);
  switch (planned) {
    case "BLOCK":
      return Object.freeze({ kind: "BLOCK", reason: "nc1_reentry_core_blocked" });
    case "STAY_SUSPENDED":
      return Object.freeze({
        kind: "STAY_SUSPENDED",
        gateId: decision.gateId,
        generationId: decision.generationId,
      });
    case "REENTER_SAME_GENERATION": {
      const validation = input.validation;
      if (validation === null) {
        return Object.freeze({ kind: "BLOCK", reason: "nc1_reentry_validation_missing" });
      }
      return Object.freeze({
        kind: "REENTER_SAME_GENERATION",
        gateId: decision.gateId,
        generationId: decision.generationId,
        epochId: input.epochId,
        validationEventId: validation.validationEventId,
        input,
      });
    }
    default:
      return assertNever(planned);
  }
}

export type VerifiedSemanticContextTransitionPlanningInput = Readonly<{
  readonly oldInputs: SemanticContextInputsV1;
  readonly newInputs: SemanticContextInputsV1;
  readonly oldSourceText: string;
  readonly newSourceText: string;
  readonly oldAuthorityEventId: string;
  readonly newAuthorityEventId: string;
  readonly triggeringAuthorityEventId: string;
  readonly verifiedFrontierHash: string;
  readonly roundCountersBefore: Readonly<{ readonly design: number; readonly plan: number }>;
  readonly roundCountersAfter: Readonly<{ readonly design: number; readonly plan: number }>;
  readonly operationId: string;
  readonly validationEventId: string;
  readonly executableDigest: string;
  readonly registeredPolicyDigest: string;
  readonly governingReferenceSectionKeys: readonly string[];
}>;

export function planVerifiedSemanticContextTransition(
  input: VerifiedSemanticContextTransitionPlanningInput,
): VerifiedSemanticContextTransitionResult {
  if (
    input.oldAuthorityEventId.length === 0 ||
    input.newAuthorityEventId.length === 0 ||
    input.triggeringAuthorityEventId.length === 0 ||
    input.verifiedFrontierHash.length === 0 ||
    input.operationId.length === 0 ||
    input.validationEventId.length === 0 ||
    input.executableDigest.length === 0 ||
    input.oldInputs.requirements.authorityEventId !== input.oldAuthorityEventId ||
    input.newInputs.requirements.authorityEventId !== input.newAuthorityEventId
  ) {
    return Object.freeze({ kind: "BLOCK", reason: "semantic_context_transition_binding_incomplete" });
  }

  let oldInventory: VerifiedSectionInventory;
  let newInventory: VerifiedSectionInventory;
  try {
    oldInventory = buildRequirementsSectionInventory(
      Buffer.from(input.oldSourceText, "utf8"),
      input.oldInputs.requirements.gitBlobOid,
      REQUIREMENTS_HEADING_ANCHOR_VERSION,
    );
    newInventory = buildRequirementsSectionInventory(
      Buffer.from(input.newSourceText, "utf8"),
      input.newInputs.requirements.gitBlobOid,
      REQUIREMENTS_HEADING_ANCHOR_VERSION,
    );
  } catch (error: unknown) {
    if (error instanceof RequirementsSectionInventoryError) {
      return Object.freeze({ kind: "BLOCK", reason: "semantic_compatibility_inventory_invalid" });
    }
    throw error;
  }
  const diff = diffRequirementsSectionInventories(oldInventory, newInventory);
  const validationInput: VerifiedCompatibilityValidationInputV1 = Object.freeze({
    old: oldInventory,
    new: newInventory,
    diff,
    governingReferenceSectionKeys: Object.freeze([...input.governingReferenceSectionKeys]),
    oldAuthorityEventId: input.oldAuthorityEventId,
    newAuthorityEventId: input.newAuthorityEventId,
    triggerEventId: input.triggeringAuthorityEventId,
    registeredPolicyDigest: input.registeredPolicyDigest,
    contextInputs: Object.freeze({
      old: input.oldInputs,
      new: input.newInputs,
      triggeringAuthorityEventId: input.triggeringAuthorityEventId,
      verifiedFrontierHash: input.verifiedFrontierHash,
    }),
  });

  const registry = createDefaultDeterministicValidatorRegistry();
  const validator = registry.resolve(SEMANTIC_CONTEXT_COMPATIBILITY_V1.validatorId);
  if (validator?.runner === null || validator === undefined) {
    return Object.freeze({ kind: "BLOCK", reason: "semantic_context_compatibility_validator_unavailable" });
  }
  const runnerInput = {
    oldSourceText: input.oldSourceText,
    newSourceText: input.newSourceText,
    oldGitBlobOid: input.oldInputs.requirements.gitBlobOid,
    newGitBlobOid: input.newInputs.requirements.gitBlobOid,
    oldFullDocumentDigest: oldInventory.inventory.normalizedDocumentDigest,
    newFullDocumentDigest: newInventory.inventory.normalizedDocumentDigest,
    governingReferenceSectionKeys: input.governingReferenceSectionKeys,
    oldAuthorityEventId: input.oldAuthorityEventId,
    newAuthorityEventId: input.newAuthorityEventId,
    triggerEventId: input.triggeringAuthorityEventId,
    registeredPolicyDigest: input.registeredPolicyDigest,
    verifiedFrontierHash: input.verifiedFrontierHash,
    oldContextInputs: input.oldInputs,
    newContextInputs: input.newInputs,
  };
  const validation = validator.runner({
    SEMANTIC_COMPATIBILITY_INPUTS: encodeSemanticCompatibilityValidatorInput(runnerInput),
  });
  if (validation.result === "INDETERMINATE") {
    return Object.freeze({ kind: "BLOCK", reason: "semantic_compatibility_indeterminate" });
  }

  const classification = evaluateSemanticContextCompatibility(validationInput);
  if (
    classification.result === "INDETERMINATE" ||
    (validation.result === "PASS") !== (classification.result === "EQUIVALENT")
  ) {
    return Object.freeze({ kind: "BLOCK", reason: "semantic_compatibility_indeterminate" });
  }

  const proof = buildSemanticContextCompatibilityProof({
    input: validationInput,
    classification,
    validationEventId: input.validationEventId,
    executableDigest: input.executableDigest,
  });
  const transitionInput: VerifiedSemanticContextTransitionInput = Object.freeze({
    oldInputs: input.oldInputs,
    newInputs: input.newInputs,
    proof,
    triggeringAuthorityEventId: input.triggeringAuthorityEventId,
    verifiedHistoryFrontier: input.verifiedFrontierHash,
    roundCountersBefore: input.roundCountersBefore,
    roundCountersAfter: input.roundCountersAfter,
    operationId: input.operationId,
  });
  const decision = planSemanticContextTransition(transitionInput);
  if (decision.kind === "BLOCK") {
    return Object.freeze({ kind: "BLOCK", reason: decision.reason });
  }
  return Object.freeze({ kind: "verified", input: transitionInput, decision });
}

function assertNever(value: never): never {
  throw new Error(`review_gate_admission_decision_unhandled: ${JSON.stringify(value)}`);
}

export async function applyReviewGateAdmissionDecision(
  input: ReviewGateAdmissionInput,
  handlers: ReviewGateAdmissionHandlers,
): Promise<ReviewGateAdmissionExecutionResult> {
  const { decision, observation, owned } = input;
  switch (decision.kind) {
    case "BLOCK":
      return handlers.BLOCK(decision, observation, owned);
    case "REUSE_COMPLETED":
      return handlers.REUSE_COMPLETED(decision, observation, owned);
    case "CREATE_GENESIS":
      return handlers.CREATE_GENESIS(decision, observation, owned);
    case "CREATE_SUCCESSOR":
      return handlers.CREATE_SUCCESSOR(decision, observation, owned);
    case "RESUME":
      return handlers.RESUME(decision, observation, owned);
    case "STAY_SUSPENDED":
      return handlers.STAY_SUSPENDED(decision, observation, owned);
    case "REVALIDATE_OR_BLOCK":
      return handlers.REVALIDATE_OR_BLOCK(decision, observation, owned);
    case "UPSTREAM_PRECEDENCE_REQUIRED":
      return handlers.UPSTREAM_PRECEDENCE_REQUIRED(decision, observation, owned);
    case "STALE_LINEAGE_REVALIDATION_REQUIRED":
      return handlers.STALE_LINEAGE_REVALIDATION_REQUIRED(decision, observation, owned);
    case "INSPECT_NC1_ELIGIBLE_CHANGE":
      return handlers.INSPECT_NC1_ELIGIBLE_CHANGE(decision, observation, owned);
    case "REENTRY_CANDIDATE":
      return handlers.REENTRY_CANDIDATE(decision, observation, owned);
    default:
      return assertNever(decision);
  }
}
