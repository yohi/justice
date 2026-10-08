import { describe, expect, it } from "vitest";
import {
  MAX_DESIGN_REMEDIATION_ROUNDS,
  MAX_PLAN_REMEDIATION_ROUNDS,
} from "../../src/core/review-gate-types";
import { computeReviewGatePromptContractDigests } from "../../src/core/review-gate/agent-protocol";
import { createReviewGateProtocolDescriptor } from "../../src/runtime/review-gate-protocol";

describe("createReviewGateProtocolDescriptor (Task 12 Phase A)", () => {
  it("builds the v1 descriptor with the exact cross-phase policy versions", () => {
    const result = createReviewGateProtocolDescriptor();

    expect(result.descriptor.descriptorVersion).toBe(1);
    expect(result.descriptor.crossPhase).toEqual({
      controllerRelayContractVersion: 1,
      maxDesignRemediationRounds: 5,
      maxPlanRemediationRounds: 3,
      sharedFindingValidatorContractVersion: 1,
      sharedSeverityPolicyVersion: 1,
      sharedResolutionPolicyVersion: 1,
      sharedLineagePolicyVersion: 1,
      sharedConvergencePolicyVersion: 1,
    });
  });

  it("pins the round ceilings to the pure-core Review Gate constants", () => {
    const result = createReviewGateProtocolDescriptor();

    expect(result.descriptor.crossPhase.maxDesignRemediationRounds).toBe(
      MAX_DESIGN_REMEDIATION_ROUNDS,
    );
    expect(result.descriptor.crossPhase.maxPlanRemediationRounds).toBe(
      MAX_PLAN_REMEDIATION_ROUNDS,
    );
  });

  it("combines Task 10 prompt contract digests into both phase slices", () => {
    const result = createReviewGateProtocolDescriptor();
    const digests = computeReviewGatePromptContractDigests();

    expect(result.descriptor.designPhase).toEqual({
      phasePolicyVersion: 1,
      reviewerPromptContractDigest: digests.designReviewer,
      validatorPromptContractDigest: digests.findingValidator,
      remediatorPromptContractDigest: digests.remediator,
      selfReviewPromptContractDigest: digests.selfReview,
    });
    expect(result.descriptor.planPhase).toEqual({
      phasePolicyVersion: 1,
      reviewerPromptContractDigest: digests.planReviewer,
      validatorPromptContractDigest: digests.findingValidator,
      remediatorPromptContractDigest: digests.remediator,
      selfReviewPromptContractDigest: digests.selfReview,
    });
  });

  it("is deterministic across invocations", () => {
    const a = createReviewGateProtocolDescriptor();
    const b = createReviewGateProtocolDescriptor();

    expect(b).toEqual(a);
  });

  it("returns 64-hex sha256 fingerprints that are mutually distinct", () => {
    const result = createReviewGateProtocolDescriptor();

    expect(result.reviewProtocolFingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.designProtocolFingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.planProtocolFingerprint).toMatch(/^[0-9a-f]{64}$/u);

    expect(result.designProtocolFingerprint).not.toBe(result.planProtocolFingerprint);
    expect(result.reviewProtocolFingerprint).not.toBe(result.designProtocolFingerprint);
    expect(result.reviewProtocolFingerprint).not.toBe(result.planProtocolFingerprint);
  });

  it("changes the phase fingerprint through the Task 10 prompt digest, not through storage identity", () => {
    // The design and plan slices differ only by their static reviewer prompt
    // digest; every shared semantic (validator contracts, policies) is
    // identical. Distinct fingerprints must therefore come from review
    // semantics, never from runtime or storage details (PF1 §8.4).
    const result = createReviewGateProtocolDescriptor();
    const digests = computeReviewGatePromptContractDigests();

    expect(digests.designReviewer).not.toBe(digests.planReviewer);
    expect(result.descriptor.designPhase.reviewerPromptContractDigest).toBe(
      digests.designReviewer,
    );
    expect(result.descriptor.planPhase.reviewerPromptContractDigest).toBe(
      digests.planReviewer,
    );
  });

  it("returns deeply frozen immutable state", () => {
    const result = createReviewGateProtocolDescriptor();

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.descriptor)).toBe(true);
    expect(Object.isFrozen(result.descriptor.crossPhase)).toBe(true);
    expect(Object.isFrozen(result.descriptor.designPhase)).toBe(true);
    expect(Object.isFrozen(result.descriptor.planPhase)).toBe(true);
  });
});
