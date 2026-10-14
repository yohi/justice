import { describe, expect, it } from "vitest";
import {
  planNonConvergenceReentry,
  type VerifiedReentryInput,
} from "../../../src/core/review-gate/reentry.js";
import type { VerifiedNC1EligibleChangeV1 } from "../../../src/core/review-gate/admission.js";

/**
 * PLAN-012: `planNonConvergenceReentry` is the NC1-only Two-Key planner. Its
 * decision union is exactly `STAY_SUSPENDED | REENTER_SAME_GENERATION | BLOCK`
 * — it can never produce `RESTORE_DOWNSTREAM_FIRST`, `prepare_restore`,
 * `REQUIREMENTS_REOPEN_REQUIRED` or `DESIGN_REOPEN_REQUIRED`.
 */

const gateId = "gate-1";
const generationId = "gen-1";
const epochId = "epoch-1";
const nc1StopEventId = "nc1-stop-1";
const frontier = "frontier-1";

function artifactChange(
  overrides: Partial<VerifiedNC1EligibleChangeV1> = {},
): VerifiedNC1EligibleChangeV1 {
  return {
    gateId,
    generationId,
    phase: "design",
    nc1StopEventId,
    beforeContextDigest: "ctx-before",
    afterContextDigest: "ctx-after",
    changeObservedEventId: "design-change-observed-1",
    observationOperationId: "op-obs-1",
    witnessFrontierAtObservation: frontier,
    kind: "artifact",
    artifactKind: "design",
    beforeArtifactDigest: "design-before",
    afterArtifactDigest: "design-after",
    committedGitOid: "c2".repeat(20),
    verifiedGitParentOid: "c1".repeat(20),
    beforeGitBlobOid: "b1".repeat(20),
    afterGitBlobOid: "b2".repeat(20),
    verifiedTargetClean: true,
    ...overrides,
  };
}

function protocolChange(
  overrides: Partial<VerifiedNC1EligibleChangeV1> = {},
): VerifiedNC1EligibleChangeV1 {
  return {
    gateId,
    generationId,
    phase: "design",
    nc1StopEventId,
    beforeContextDigest: "ctx-before",
    afterContextDigest: "ctx-after",
    changeObservedEventId: "protocol-change-observed-1",
    observationOperationId: "op-obs-1",
    witnessFrontierAtObservation: frontier,
    kind: "protocol",
    protocolPhase: "design",
    beforePhaseFingerprint: "design-proto-v1",
    afterPhaseFingerprint: "design-proto-v2",
    beforeDescriptorDigest: "descriptor-v1",
    afterDescriptorDigest: "descriptor-v2",
    protocolSchemaVersion: "1",
    beforeReleaseId: "release-1",
    afterReleaseId: "release-2",
    verifiedPublisherIdentityDigest: "publisher-1",
    authenticatedImmutableReleaseProvenanceDigest: "provenance-1",
    protectedProtocolRegistryFrontierHash: "registry-head-2",
    relevantStaticPromptAndPolicyDigest: "policy-2",
    progressInvalidatedEventId: "progress-invalidated-1",
    ...overrides,
  };
}

function reentryInput(
  overrides: {
    gateId?: string;
    generationId?: string;
    epochId?: string;
    phase?: "design" | "plan";
    remainingRounds?: number;
    nc1EvidenceEventId?: string;
    verifiedChange?: VerifiedNC1EligibleChangeV1 | null;
    validation?: VerifiedReentryInput["validation"];
  },
): VerifiedReentryInput {
  return {
    gateId,
    generationId,
    epochId,
    phase: "design",
    remainingRounds: 2,
    nc1EvidenceEventId: nc1StopEventId,
    verifiedChange: artifactChange(),
    validation: {
      outcome: "MATERIAL_PROGRESS",
      validationEventId: "reentry-validation-1",
      boundNc1EvidenceEventId: nc1StopEventId,
      boundChangeProofEventId: "design-change-observed-1",
    },
    ...overrides,
  };
}

describe("planNonConvergenceReentry — NC1 Two-Key authority (PLAN-012)", () => {
  it("reenters the same generation for a verified eligible change with independent MATERIAL_PROGRESS", () => {
    expect(planNonConvergenceReentry(reentryInput({}))).toBe("REENTER_SAME_GENERATION");
  });

  it.each([0, -1])("stays suspended when verified progress has %i remaining rounds", (remainingRounds) => {
    expect(planNonConvergenceReentry(reentryInput({ remainingRounds }))).toBe("STAY_SUSPENDED");
  });

  it("reenters for a plan-phase verified artifact change", () => {
    const planChange = artifactChange({
      phase: "plan",
      artifactKind: "plan",
      changeObservedEventId: "plan-change-observed-1",
    });
    expect(
      planNonConvergenceReentry(
        reentryInput({
          phase: "plan",
          verifiedChange: planChange,
          validation: {
            outcome: "MATERIAL_PROGRESS",
            validationEventId: "reentry-validation-plan-1",
            boundNc1EvidenceEventId: nc1StopEventId,
            boundChangeProofEventId: "plan-change-observed-1",
          },
        }),
      ),
    ).toBe("REENTER_SAME_GENERATION");
  });

  it("reenters for an independently signed protocol release with witnessed progress invalidation", () => {
    // PLAN-014 protocol-only path: no workspace commit or parent is involved.
    const change = protocolChange();
    expect(
      planNonConvergenceReentry(
        reentryInput({
          verifiedChange: change,
          validation: {
            outcome: "MATERIAL_PROGRESS",
            validationEventId: "reentry-validation-proto-1",
            boundNc1EvidenceEventId: nc1StopEventId,
            boundChangeProofEventId: "progress-invalidated-1",
          },
        }),
      ),
    ).toBe("REENTER_SAME_GENERATION");
  });

  it("stays suspended while the reentry validation outcome is still pending", () => {
    expect(
      planNonConvergenceReentry(reentryInput({ validation: null })),
    ).toBe("STAY_SUSPENDED");
  });

  it("stays suspended on NO_MATERIAL_PROGRESS", () => {
    expect(
      planNonConvergenceReentry(
        reentryInput({
          validation: {
            outcome: "NO_MATERIAL_PROGRESS",
            validationEventId: "reentry-validation-2",
            boundNc1EvidenceEventId: nc1StopEventId,
            boundChangeProofEventId: "design-change-observed-1",
          },
        }),
      ),
    ).toBe("STAY_SUSPENDED");
  });

  it("stays suspended on INDETERMINATE validation", () => {
    expect(
      planNonConvergenceReentry(
        reentryInput({
          validation: {
            outcome: "INDETERMINATE",
            validationEventId: "reentry-validation-3",
            boundNc1EvidenceEventId: nc1StopEventId,
            boundChangeProofEventId: "design-change-observed-1",
          },
        }),
      ),
    ).toBe("STAY_SUSPENDED");
  });

  it("stays suspended when the validator outcome requires an upstream Design reopen", () => {
    // Upstream handling is decided by the ordinary orchestrator from an
    // independently projected CURRENT blocker, never by the NC1 planner.
    expect(
      planNonConvergenceReentry(
        reentryInput({
          validation: {
            outcome: "DESIGN_REOPEN_REQUIRED",
            validationEventId: "reentry-validation-4",
            boundNc1EvidenceEventId: nc1StopEventId,
            boundChangeProofEventId: "design-change-observed-1",
          },
        }),
      ),
    ).toBe("STAY_SUSPENDED");
  });

  it("stays suspended when the validator outcome requires an upstream Requirements reopen", () => {
    expect(
      planNonConvergenceReentry(
        reentryInput({
          validation: {
            outcome: "REQUIREMENTS_REOPEN_REQUIRED",
            validationEventId: "reentry-validation-5",
            boundNc1EvidenceEventId: nc1StopEventId,
            boundChangeProofEventId: "design-change-observed-1",
          },
        }),
      ),
    ).toBe("STAY_SUSPENDED");
  });

  it("blocks false model progress claimed without a verified eligible change", () => {
    expect(
      planNonConvergenceReentry(reentryInput({ verifiedChange: null })),
    ).toBe("BLOCK");
  });

  it("blocks when the validation outcome is not bound to the recorded NC1 stop", () => {
    expect(
      planNonConvergenceReentry(
        reentryInput({
          validation: {
            outcome: "MATERIAL_PROGRESS",
            validationEventId: "reentry-validation-6",
            boundNc1EvidenceEventId: "some-other-stop",
            boundChangeProofEventId: "design-change-observed-1",
          },
        }),
      ),
    ).toBe("BLOCK");
  });

  it("blocks when the validation is not bound to the observed change evidence", () => {
    expect(
      planNonConvergenceReentry(
        reentryInput({
          validation: {
            outcome: "MATERIAL_PROGRESS",
            validationEventId: "reentry-validation-7",
            boundNc1EvidenceEventId: nc1StopEventId,
            boundChangeProofEventId: "forged-change-observation",
          },
        }),
      ),
    ).toBe("BLOCK");
  });

  it("blocks when the eligible change records a different gate", () => {
    expect(
      planNonConvergenceReentry(
        reentryInput({ verifiedChange: artifactChange({ gateId: "gate-2" }) }),
      ),
    ).toBe("BLOCK");
  });

  it("blocks when the eligible change records a different generation", () => {
    expect(
      planNonConvergenceReentry(
        reentryInput({ verifiedChange: artifactChange({ generationId: "gen-2" }) }),
      ),
    ).toBe("BLOCK");
  });

  it("blocks when the eligible change phase disagrees with the suspended gate", () => {
    expect(
      planNonConvergenceReentry(
        reentryInput({
          phase: "plan",
          verifiedChange: artifactChange({ phase: "design" }),
        }),
      ),
    ).toBe("BLOCK");
  });

  it("blocks when the eligible change is not bound to the NC1 stop", () => {
    expect(
      planNonConvergenceReentry(
        reentryInput({ verifiedChange: artifactChange({ nc1StopEventId: "forged-stop" }) }),
      ),
    ).toBe("BLOCK");
  });

  it("blocks a plan-artifact change recorded against a design-phase suspension", () => {
    // Phase-eligibility fail-closed check: a plan artifact change cannot
    // license reentry of a design-phase NC1 stop, and vice versa.
    expect(
      planNonConvergenceReentry(
        reentryInput({ verifiedChange: artifactChange({ artifactKind: "plan" }) }),
      ),
    ).toBe("STAY_SUSPENDED");
  });

  it("blocks protocol evidence with unchanged descriptor and fingerprint (provider-only delta)", () => {
    expect(
      planNonConvergenceReentry(
        reentryInput({
          verifiedChange: protocolChange({
            afterDescriptorDigest: "descriptor-v1",
            afterPhaseFingerprint: "design-proto-v1",
          }),
        }),
      ),
    ).toBe("BLOCK");
  });

  it("blocks a protocol change whose release did not advance", () => {
    expect(
      planNonConvergenceReentry(
        reentryInput({
          verifiedChange: protocolChange({ afterReleaseId: "release-1" }),
        }),
      ),
    ).toBe("BLOCK");
  });

  it("blocks protocol validation bound to the wrong progress-invalidation event", () => {
    expect(
      planNonConvergenceReentry(
        reentryInput({
          verifiedChange: protocolChange(),
          validation: {
            outcome: "MATERIAL_PROGRESS",
            validationEventId: "reentry-validation-proto-2",
            boundNc1EvidenceEventId: nc1StopEventId,
            boundChangeProofEventId: "forged-invalidation",
          },
        }),
      ),
    ).toBe("BLOCK");
  });

  it("blocks a phase-ineligible plan-protocol release for a design-phase stop", () => {
    expect(
      planNonConvergenceReentry(
        reentryInput({
          verifiedChange: protocolChange({ protocolPhase: "plan" }),
          validation: {
            outcome: "MATERIAL_PROGRESS",
            validationEventId: "reentry-validation-proto-el-1",
            boundNc1EvidenceEventId: nc1StopEventId,
            boundChangeProofEventId: "progress-invalidated-1",
          },
        }),
      ),
    ).toBe("STAY_SUSPENDED");
  });

  it("rejects malformed input identities instead of guessing", () => {
    expect(
      planNonConvergenceReentry(reentryInput({ gateId: "" })),
    ).toBe("BLOCK");
    expect(
      planNonConvergenceReentry(reentryInput({ nc1EvidenceEventId: "" })),
    ).toBe("BLOCK");
    expect(
      planNonConvergenceReentry(
        reentryInput({
          validation: {
            outcome: "MATERIAL_PROGRESS",
            validationEventId: "",
            boundNc1EvidenceEventId: nc1StopEventId,
            boundChangeProofEventId: "design-change-observed-1",
          },
        }),
      ),
    ).toBe("BLOCK");
  });
});
