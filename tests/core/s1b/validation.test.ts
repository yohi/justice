import { describe, expect, it } from "vitest";
import { inspectEvidenceRefs, primaryRejectionReason } from "../../../src/core/s1b/validation.js";

const validRef = (evidenceId = "evidence-1"): Record<string, unknown> => ({
  evidenceId,
  type: "test",
  taskRef: { artifactId: "task-1", revision: "rev-1" },
  scopeKey: "scope-1",
  issuerId: "issuer-1",
  originId: "origin-1",
  provenanceClass: "FIXTURE_OBSERVATION",
  reportedExecutionState: "EXECUTED",
});

describe("inspectEvidenceRefs", () => {
  it("accepts valid evidence and the optional outcome claim", () => {
    const result = inspectEvidenceRefs([{ ...validRef(), reportedOutcome: "PASS" }]);
    expect(result).toEqual({ issueCodes: [], refs: [{ ...validRef(), reportedOutcome: "PASS" }] });
  });

  it("rejects unknown nested fields and null optional fields without exposing invalid values", () => {
    const attack = "do-not-echo";
    const result = inspectEvidenceRefs([{ ...validRef(), reportedOutcome: null, taskRef: { artifactId: "task-1", revision: "rev-1", [attack]: attack } }]);
    expect(result.issueCodes).toContain("EVIDENCE_FIELD_INVALID");
    expect(result.refs).toBeNull();
    expect(JSON.stringify(result.issueCodes)).not.toContain(attack);
  });

  it("rejects a missing or non-array collection with a fixed schema diagnostic", () => {
    expect(inspectEvidenceRefs(undefined)).toEqual({ issueCodes: ["INPUT_SCHEMA_INVALID"], refs: null });
    expect(inspectEvidenceRefs({ evidenceRefs: [] })).toEqual({ issueCodes: ["INPUT_SCHEMA_INVALID"], refs: null });
  });

  it("rejects unsafe identifiers and malformed digests", () => {
    const result = inspectEvidenceRefs([{ ...validRef("a".repeat(65)), contentDigest: { algorithm: "sha256", hex: "A".repeat(64) } }]);
    expect(result.issueCodes).toContain("UNSAFE_IDENTIFIER");
    expect(result.issueCodes).toContain("EVIDENCE_FIELD_INVALID");
    expect(result.refs).toBeNull();
  });

  it("accepts 128 refs and rejects 129 refs before cloning them", () => {
    const accepted = inspectEvidenceRefs(Array.from({ length: 128 }, (_, index) => validRef(`e-${index}`)));
    expect(accepted.refs).toHaveLength(128);
    const rejected = inspectEvidenceRefs(new Array(129).fill(validRef()));
    expect(rejected.issueCodes).toContain("EVIDENCE_LIMIT_EXCEEDED");
    expect(rejected.refs).toBeNull();
  });

  it("rejects duplicate ids even when another ref is malformed", () => {
    const result = inspectEvidenceRefs([validRef("same"), { ...validRef("same"), type: "bogus" }]);
    expect(result.issueCodes).toContain("DUPLICATE_EVIDENCE_ID");
    expect(result.issueCodes).toContain("EVIDENCE_FIELD_INVALID");
    expect(result.refs).toBeNull();
  });

  it("uses rejection priority independently of evidence order", () => {
    const codes = inspectEvidenceRefs([validRef("same"), { ...validRef("same"), type: "bogus" }]).issueCodes;
    expect(primaryRejectionReason(codes)).toBe("EVIDENCE_FIELD_INVALID");
    expect(primaryRejectionReason([...codes].reverse())).toBe("EVIDENCE_FIELD_INVALID");
  });
});
