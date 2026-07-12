import { describe, expect, it } from "vitest";
import { toEvidenceArray } from "../../../src/core/v2/evidence-list";
import type { DeclaredClaimEvidence, Evidence } from "../../../src/core/v2/observation-model";

describe("toEvidenceArray", () => {
  it("returns an empty array for undefined", () => {
    expect(toEvidenceArray(undefined)).toEqual([]);
  });

  it("wraps a single Evidence in an array", () => {
    const evidence: DeclaredClaimEvidence = {
      evidenceId: "e-1",
      kind: "test",
      sourceClass: "declared_claim",
      provenance: "declared",
      declaredFrom: "message",
      claim: { claimKind: "test", outcome: "pass" },
    };
    expect(toEvidenceArray(evidence)).toEqual([evidence]);
  });

  it("passes an existing evidence array through unchanged", () => {
    const evidenceArray: readonly Evidence[] = [
      {
        evidenceId: "e-2",
        kind: "build",
        sourceClass: "declared_claim",
        provenance: "declared",
        declaredFrom: "task_summary",
        claim: { claimKind: "build", outcome: "fail" },
      },
    ];
    expect(toEvidenceArray(evidenceArray)).toBe(evidenceArray);
  });
});
