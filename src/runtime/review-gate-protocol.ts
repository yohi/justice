/**
 * Task 12 Phase A — shared Review Gate protocol descriptor (runtime seam).
 *
 * Combines the Task 10 static prompt contract digests with the Task 8
 * deterministic validator semantic contracts into one versioned protocol
 * descriptor per PF1 (§8 of the Review Gate Convergence design): the three
 * protocol fingerprints commit every semantic dependency able to change a
 * phase's CLEAR result:
 *
 * - designProtocolFingerprint = sha256(canonicalJson(design fingerprint payload))
 * - planProtocolFingerprint   = sha256(canonicalJson(plan fingerprint payload))
 * - reviewProtocolFingerprint = sha256(canonicalJson(whole-descriptor payload))
 *
 * Shared semantics (cross-phase policies and the deterministic validation
 * contract) are explicitly represented inside every affected phase
 * fingerprint payload. Runtime/storage identity never enters the payloads
 * (§8.4 exclusions).
 *
 * Pure assembly over core contracts: no I/O, no host imports.
 */

import {
  computeReviewGatePromptContractDigests,
} from "../core/review-gate/agent-protocol";
import {
  DESIGN_REQUIREMENTS_REFERENCE_CONSISTENCY_V1,
  REVIEW_INPUT_BINDING_INTEGRITY_V1,
} from "../core/review-gate/deterministic-validation";
import { computeCanonicalJsonFingerprint } from "../core/review-gate/identity";
import {
  MAX_DESIGN_REMEDIATION_ROUNDS,
  MAX_PLAN_REMEDIATION_ROUNDS,
} from "../core/review-gate-types";

/**
 * One phase's prompt-contract slice. All `*ContractVersion` /
 * policy-version fields start at integer `1` and are typed as literals so a
 * future bump is a deliberate type change.
 */
export type ReviewProtocolPhaseDescriptorV1 = Readonly<{
  readonly phasePolicyVersion: 1;
  readonly reviewerPromptContractDigest: string;
  readonly validatorPromptContractDigest: string;
  readonly remediatorPromptContractDigest: string;
  readonly selfReviewPromptContractDigest: string;
}>;

export type ReviewCrossPhasePoliciesV1 = Readonly<{
  readonly controllerRelayContractVersion: 1;
  readonly maxDesignRemediationRounds: typeof MAX_DESIGN_REMEDIATION_ROUNDS;
  readonly maxPlanRemediationRounds: typeof MAX_PLAN_REMEDIATION_ROUNDS;
  readonly sharedFindingValidatorContractVersion: 1;
  readonly sharedSeverityPolicyVersion: 1;
  readonly sharedResolutionPolicyVersion: 1;
  readonly sharedLineagePolicyVersion: 1;
  readonly sharedConvergencePolicyVersion: 1;
}>;

export type ReviewProtocolDescriptorV1 = Readonly<{
  readonly descriptorVersion: 1;
  readonly crossPhase: ReviewCrossPhasePoliciesV1;
  readonly designPhase: ReviewProtocolPhaseDescriptorV1;
  readonly planPhase: ReviewProtocolPhaseDescriptorV1;
}>;

export type ReviewGateProtocolDescriptor = Readonly<{
  readonly descriptor: ReviewProtocolDescriptorV1;
  readonly reviewProtocolFingerprint: string;
  readonly designProtocolFingerprint: string;
  readonly planProtocolFingerprint: string;
}>;

/**
 * Build the deterministic descriptor and its three protocol fingerprints.
 * Deterministic across processes: pure functions of static core contracts
 * (`node:crypto` digests over frozen inputs). Inconsistent shared semantics
 * fail closed with `review_protocol_descriptor_invalid`.
 */
export function createReviewGateProtocolDescriptor(): ReviewGateProtocolDescriptor {
  const promptDigests = computeReviewGatePromptContractDigests();
  const semanticContractDigest = computeDeterministicValidationSemanticContractDigest();

  const crossPhase: ReviewCrossPhasePoliciesV1 = Object.freeze({
    controllerRelayContractVersion: 1,
    maxDesignRemediationRounds: MAX_DESIGN_REMEDIATION_ROUNDS,
    maxPlanRemediationRounds: MAX_PLAN_REMEDIATION_ROUNDS,
    sharedFindingValidatorContractVersion: 1,
    sharedSeverityPolicyVersion: 1,
    sharedResolutionPolicyVersion: 1,
    sharedLineagePolicyVersion: 1,
    sharedConvergencePolicyVersion: 1,
  });

  const designPhase: ReviewProtocolPhaseDescriptorV1 = Object.freeze({
    phasePolicyVersion: 1,
    reviewerPromptContractDigest: promptDigests.designReviewer,
    validatorPromptContractDigest: promptDigests.findingValidator,
    remediatorPromptContractDigest: promptDigests.remediator,
    selfReviewPromptContractDigest: promptDigests.selfReview,
  });

  const planPhase: ReviewProtocolPhaseDescriptorV1 = Object.freeze({
    phasePolicyVersion: 1,
    reviewerPromptContractDigest: promptDigests.planReviewer,
    validatorPromptContractDigest: promptDigests.findingValidator,
    remediatorPromptContractDigest: promptDigests.remediator,
    selfReviewPromptContractDigest: promptDigests.selfReview,
  });

  const descriptor: ReviewProtocolDescriptorV1 = Object.freeze({
    descriptorVersion: 1,
    crossPhase,
    designPhase,
    planPhase,
  });

  assertDescriptorConsistency(descriptor, semanticContractDigest);

  // Shared semantics are explicitly represented inside every affected phase
  // fingerprint payload (PF1 §8).
  const designPhaseWithSemantic: ReviewProtocolPhaseDescriptorV1WithSemantic = Object.freeze({
    ...designPhase,
    deterministicValidationSemanticContract: semanticContractDigest,
  });
  const planPhaseWithSemantic: ReviewProtocolPhaseDescriptorV1WithSemantic = Object.freeze({
    ...planPhase,
    deterministicValidationSemanticContract: semanticContractDigest,
  });

  const designProtocolFingerprint = computeCanonicalJsonFingerprint({
    descriptorVersion: descriptor.descriptorVersion,
    phase: "design",
    crossPhase,
    ...designPhaseWithSemantic,
  });
  const planProtocolFingerprint = computeCanonicalJsonFingerprint({
    descriptorVersion: descriptor.descriptorVersion,
    phase: "plan",
    crossPhase,
    ...planPhaseWithSemantic,
  });
  const reviewProtocolFingerprint = computeCanonicalJsonFingerprint({
    descriptorVersion: descriptor.descriptorVersion,
    crossPhase,
    designPhase: designPhaseWithSemantic,
    planPhase: planPhaseWithSemantic,
  });

  return Object.freeze({
    descriptor,
    reviewProtocolFingerprint,
    designProtocolFingerprint,
    planProtocolFingerprint,
  });
}

type ReviewProtocolPhaseDescriptorV1WithSemantic = ReviewProtocolPhaseDescriptorV1 &
  Readonly<{ readonly deterministicValidationSemanticContract: string }>;

/**
 * Task 8 semantic contract digest: the registered production validator
 * descriptors commit their validator id, contract version, result schema
 * version, applicable phases, mandatory stages, stage failure policy, and
 * rule semantics (PF1 §8.4). Runner/sandbox implementation details never
 * enter the digest.
 */
function computeDeterministicValidationSemanticContractDigest(): string {
  return computeCanonicalJsonFingerprint({
    validators: [
      REVIEW_INPUT_BINDING_INTEGRITY_V1,
      DESIGN_REQUIREMENTS_REFERENCE_CONSISTENCY_V1,
    ],
  });
}

function assertDescriptorConsistency(
  descriptor: ReviewProtocolDescriptorV1,
  semanticContractDigest: string,
): void {
  if (
    descriptor.descriptorVersion !== 1 ||
    descriptor.crossPhase.controllerRelayContractVersion !== 1 ||
    descriptor.crossPhase.sharedFindingValidatorContractVersion !== 1 ||
    descriptor.crossPhase.sharedSeverityPolicyVersion !== 1 ||
    descriptor.crossPhase.sharedResolutionPolicyVersion !== 1 ||
    descriptor.crossPhase.sharedLineagePolicyVersion !== 1 ||
    descriptor.crossPhase.sharedConvergencePolicyVersion !== 1 ||
    descriptor.crossPhase.maxDesignRemediationRounds !== MAX_DESIGN_REMEDIATION_ROUNDS ||
    descriptor.crossPhase.maxPlanRemediationRounds !== MAX_PLAN_REMEDIATION_ROUNDS ||
    descriptor.designPhase.phasePolicyVersion !== 1 ||
    descriptor.planPhase.phasePolicyVersion !== 1 ||
    semanticContractDigest.length !== 64 ||
    !/^[0-9a-f]{64}$/u.test(semanticContractDigest)
  ) {
    throw new Error("review_protocol_descriptor_invalid");
  }
  for (const phase of [descriptor.designPhase, descriptor.planPhase]) {
    for (const digest of [
      phase.reviewerPromptContractDigest,
      phase.validatorPromptContractDigest,
      phase.remediatorPromptContractDigest,
      phase.selfReviewPromptContractDigest,
    ]) {
      if (!/^[0-9a-f]{64}$/u.test(digest)) {
        throw new Error("review_protocol_descriptor_invalid");
      }
    }
  }
}
