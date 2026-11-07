import { beforeAll, describe, expect, it } from "vitest";
import { loadS1aArtifacts } from "../../../src/core/s1a/loader.js";
import type { BinderInput, EvidenceRefV1 } from "../../../src/core/s1b/contract.js";
import { bindEvidence } from "../../../src/core/s1b/binder.js";
import { s1aFixture } from "../../helpers/s1a-fixtures.js";
import { cloneS1bFixture, s1bFixture } from "../../helpers/s1b-fixtures.js";

describe("S1-b evidence binding acceptance", () => {
  let fixture: Awaited<ReturnType<typeof s1bFixture>>;
  let notReadyBaseline: Awaited<ReturnType<typeof loadS1aArtifacts>>;

  beforeAll(async () => {
    fixture = await s1bFixture();
    const sourceFixture = s1aFixture();
    notReadyBaseline = await loadS1aArtifacts(
      { ...sourceFixture.input, expectedManifestSha256: "0".repeat(64) },
      sourceFixture.source,
    );
  });

  it("uses the actual ready S1-a Loader result as its baseline", async () => {
    const result = bindEvidence(fixture.input);

    expect(fixture.baseline.identityCandidateReady).toBe(true);
    expect(result.evaluationStatus).toBe("EVALUATED");
    expect(result.bindingResults.map((binding) => binding.bindingStatus)).toEqual(["MATCH", "MATCH"]);
    expect(result.bindingResults.map((binding) => binding.reasonCodes)).toEqual([[], []]);
    expect(result.coverageAssessmentStatus).toBe("ASSESSABLE");
    expect(result.coverageResults.map((coverage) => coverage.coverageStatus)).toEqual([
      "MATCHED_REF_PRESENT",
      "MATCHED_REF_PRESENT",
    ]);
    expect(result.bindingResults.map((binding) => [binding.authenticityStatus, binding.executionVerificationStatus])).toEqual([
      ["NOT_VERIFIED", "NOT_VERIFIED"],
      ["NOT_VERIFIED", "NOT_VERIFIED"],
    ]);
  });

  it("clones a fixture before varying a negative-case evidence reference", () => {
    const changed = cloneS1bFixture(fixture, { evidenceRefs: [] });

    expect(fixture.evidenceRefs).toHaveLength(2);
    expect(changed.evidenceRefs).toHaveLength(0);
    expect(changed.baseline).toBe(fixture.baseline);
  });

  const alterRef = (
    index: number,
    change: (ref: EvidenceRefV1) => EvidenceRefV1,
  ): readonly EvidenceRefV1[] => fixture.evidenceRefs.map((ref: EvidenceRefV1, refIndex: number) => refIndex === index ? change(ref) : ref);

  const cases: readonly Readonly<{
    name: string;
    input: (fixture: Awaited<ReturnType<typeof s1bFixture>>) => BinderInput;
    evaluation: "EVALUATED" | "BASELINE_UNKNOWN" | "INPUT_REJECTED";
    bindings: readonly (readonly ["MATCH" | "MISMATCH" | "UNKNOWN", readonly string[]])[];
    coverageAssessment: "ASSESSABLE" | "UNKNOWN";
    coverage: readonly string[];
    rejection?: string;
  }>[] = [
    { name: "matching Task, revision, scope and AC", input: (value) => value.input, evaluation: "EVALUATED", bindings: [["MATCH", []], ["MATCH", []]], coverageAssessment: "ASSESSABLE", coverage: ["MATCHED_REF_PRESENT", "MATCHED_REF_PRESENT"] },
    { name: "wrong Task", input: (value) => cloneS1bFixture(value, { evidenceRefs: alterRef(0, ({ acRef: _acRef, ...ref }) => ({ ...ref, taskRef: { ...ref.taskRef, artifactId: "task-other" } })) }).input, evaluation: "EVALUATED", bindings: [["MISMATCH", ["TASK_NOT_SELECTED"]], ["MATCH", []]], coverageAssessment: "ASSESSABLE", coverage: ["MISSING_EVIDENCE", "MATCHED_REF_PRESENT"] },
    { name: "stale Task revision", input: (value) => cloneS1bFixture(value, { evidenceRefs: alterRef(0, (ref) => ({ ...ref, taskRef: { ...ref.taskRef, revision: "R2" } })) }).input, evaluation: "EVALUATED", bindings: [["MISMATCH", ["TASK_REVISION_MISMATCH"]], ["MATCH", []]], coverageAssessment: "ASSESSABLE", coverage: ["MISSING_EVIDENCE", "MATCHED_REF_PRESENT"] },
    { name: "wrong scope", input: (value) => cloneS1bFixture(value, { evidenceRefs: alterRef(0, (ref) => ({ ...ref, scopeKey: "scope-other" })) }).input, evaluation: "EVALUATED", bindings: [["MISMATCH", ["SCOPE_MISMATCH"]], ["MATCH", []]], coverageAssessment: "ASSESSABLE", coverage: ["MISSING_EVIDENCE", "MATCHED_REF_PRESENT"] },
    { name: "multiple independent discrepancies retain prescribed reason order", input: (value) => cloneS1bFixture(value, { evidenceRefs: alterRef(0, (ref) => ({ ...ref, taskRef: { ...ref.taskRef, revision: "R2" }, scopeKey: "scope-other", acRef: { artifactId: "ac-1", revision: "R2" } })) }).input, evaluation: "EVALUATED", bindings: [["MISMATCH", ["TASK_REVISION_MISMATCH", "SCOPE_MISMATCH", "AC_REVISION_MISMATCH"]], ["MATCH", []]], coverageAssessment: "ASSESSABLE", coverage: ["MISSING_EVIDENCE", "MATCHED_REF_PRESENT"] },
    { name: "nonselected AC does not imply task mismatch", input: (value) => cloneS1bFixture(value, { evidenceRefs: alterRef(0, (ref) => ({ ...ref, acRef: { artifactId: "ac-other", revision: "R1" } })) }).input, evaluation: "EVALUATED", bindings: [["MISMATCH", ["AC_NOT_SELECTED"]], ["MATCH", []]], coverageAssessment: "ASSESSABLE", coverage: ["MISSING_EVIDENCE", "MATCHED_REF_PRESENT"] },
    { name: "selected AC with another declared Task exposes parent mismatch", input: (value) => cloneS1bFixture(value, { evidenceRefs: alterRef(0, (ref) => ({ ...ref, taskRef: { artifactId: "task-other", revision: "R1" } })) }).input, evaluation: "EVALUATED", bindings: [["MISMATCH", ["TASK_NOT_SELECTED", "AC_TASK_MISMATCH"]], ["MATCH", []]], coverageAssessment: "ASSESSABLE", coverage: ["MISSING_EVIDENCE", "MATCHED_REF_PRESENT"] },
    { name: "stale selected AC revision", input: (value) => cloneS1bFixture(value, { evidenceRefs: alterRef(0, (ref) => ref.acRef ? ({ ...ref, acRef: { ...ref.acRef, revision: "R2" } }) : ref) }).input, evaluation: "EVALUATED", bindings: [["MISMATCH", ["AC_REVISION_MISMATCH"]], ["MATCH", []]], coverageAssessment: "ASSESSABLE", coverage: ["MISSING_EVIDENCE", "MATCHED_REF_PRESENT"] },
    { name: "task-level evidence has no AC reference", input: (value) => cloneS1bFixture(value, { evidenceRefs: alterRef(0, ({ acRef: _acRef, ...ref }) => ref) }).input, evaluation: "EVALUATED", bindings: [["MATCH", []], ["MATCH", []]], coverageAssessment: "ASSESSABLE", coverage: ["MISSING_EVIDENCE", "MATCHED_REF_PRESENT"] },
    { name: "missing evidence leaves the uncovered AC explicitly missing", input: (value) => cloneS1bFixture(value, { evidenceRefs: [value.evidenceRefs[0]] }).input, evaluation: "EVALUATED", bindings: [["MATCH", []]], coverageAssessment: "ASSESSABLE", coverage: ["MATCHED_REF_PRESENT", "MISSING_EVIDENCE"] },
    { name: "empty evidence set yields missing coverage", input: (value) => cloneS1bFixture(value, { evidenceRefs: [] }).input, evaluation: "EVALUATED", bindings: [], coverageAssessment: "ASSESSABLE", coverage: ["MISSING_EVIDENCE", "MISSING_EVIDENCE"] },
    { name: "unverified origin, issuer and content digest stay NOT_VERIFIED", input: (value) => cloneS1bFixture(value, { evidenceRefs: alterRef(0, (ref) => ({ ...ref, issuerId: "external-issuer", originId: "external-origin", provenanceClass: "UNVERIFIED_EXTERNAL", contentDigest: { algorithm: "sha256", hex: "a".repeat(64) } })) }).input, evaluation: "EVALUATED", bindings: [["MATCH", []], ["MATCH", []]], coverageAssessment: "ASSESSABLE", coverage: ["MATCHED_REF_PRESENT", "MATCHED_REF_PRESENT"] },
    { name: "mixed valid and malformed refs reject all bindings", input: (value) => ({ ...value.input, evidenceRefs: [...value.evidenceRefs, { ...value.evidenceRefs[0], evidenceId: "bad", unexpected: true }] }), evaluation: "INPUT_REJECTED", bindings: [], coverageAssessment: "UNKNOWN", coverage: ["UNKNOWN", "UNKNOWN"], rejection: "EVIDENCE_FIELD_INVALID" },
    { name: "duplicate evidence IDs reject all bindings", input: (value) => ({ ...value.input, evidenceRefs: [value.evidenceRefs[0], value.evidenceRefs[0]] }), evaluation: "INPUT_REJECTED", bindings: [], coverageAssessment: "UNKNOWN", coverage: ["UNKNOWN", "UNKNOWN"], rejection: "DUPLICATE_EVIDENCE_ID" },
    { name: "unsafe identifier rejects all bindings", input: (value) => ({ ...value.input, evidenceRefs: [{ ...value.evidenceRefs[0], evidenceId: "../unsafe" }] }), evaluation: "INPUT_REJECTED", bindings: [], coverageAssessment: "UNKNOWN", coverage: ["UNKNOWN", "UNKNOWN"], rejection: "UNSAFE_IDENTIFIER" },
    { name: "128 refs accepted", input: (value) => ({ ...value.input, evidenceRefs: Array.from({ length: 128 }, (_, index) => ({ ...value.evidenceRefs[0], evidenceId: `evidence-${index}` })) }), evaluation: "EVALUATED", bindings: Array.from({ length: 128 }, () => ["MATCH", []] as const), coverageAssessment: "ASSESSABLE", coverage: ["MATCHED_REF_PRESENT", "MISSING_EVIDENCE"] },
    { name: "129 refs rejected", input: (value) => ({ ...value.input, evidenceRefs: Array.from({ length: 129 }, (_, index) => ({ ...value.evidenceRefs[0], evidenceId: `evidence-${index}` })) }), evaluation: "INPUT_REJECTED", bindings: [], coverageAssessment: "UNKNOWN", coverage: ["UNKNOWN", "UNKNOWN"], rejection: "EVIDENCE_LIMIT_EXCEEDED" },
    { name: "not-ready S1-a baseline yields UNKNOWN without missing evidence", input: (value) => ({ ...value.input, baseline: notReadyBaseline }), evaluation: "BASELINE_UNKNOWN", bindings: [["UNKNOWN", ["BASELINE_NOT_READY"]], ["UNKNOWN", ["BASELINE_NOT_READY"]]], coverageAssessment: "UNKNOWN", coverage: [] },
    { name: "rejected input with ready baseline has zero bindings and unknown AC coverage", input: (value) => ({ ...value.input, evidenceRefs: [{ ...value.evidenceRefs[0], evidenceId: "../bad" }] }), evaluation: "INPUT_REJECTED", bindings: [], coverageAssessment: "UNKNOWN", coverage: ["UNKNOWN", "UNKNOWN"], rejection: "UNSAFE_IDENTIFIER" },
    { name: "forged baseline rejects without assuming its AC set", input: (value) => ({ ...value.input, baseline: { ...value.baseline, identityCandidateReady: false } }), evaluation: "INPUT_REJECTED", bindings: [], coverageAssessment: "UNKNOWN", coverage: [], rejection: "BASELINE_SHAPE_INVALID" },
  ];

  it.each(cases)("$name", ({ input: makeInput, evaluation, bindings, coverageAssessment, coverage, rejection }) => {
    const result = bindEvidence(makeInput(fixture));
    expect(result.evaluationStatus).toBe(evaluation);
    expect(result.bindingResults.map((binding) => [binding.bindingStatus, binding.reasonCodes])).toEqual(bindings);
    expect(result.coverageAssessmentStatus).toBe(coverageAssessment);
    expect(result.coverageResults.map((item) => item.coverageStatus)).toEqual(coverage);
    expect(result.rejectionReasonCode).toBe(rejection);
    expect(result.bindingResults.map((binding) => [binding.authenticityStatus, binding.executionVerificationStatus])).toEqual(
      result.bindingResults.map(() => ["NOT_VERIFIED", "NOT_VERIFIED"]),
    );
    expect(result.authenticityStatus).toBe("NOT_VERIFIED");
    expect(result.executionVerificationStatus).toBe("NOT_VERIFIED");
  });

  it.each([
    { name: "PASS remains a declaration", change: (ref: EvidenceRefV1): EvidenceRefV1 => ({ ...ref, reportedOutcome: "PASS" }), outcome: "PASS", state: "EXECUTED" },
    { name: "FAIL remains a declaration", change: (ref: EvidenceRefV1): EvidenceRefV1 => ({ ...ref, reportedOutcome: "FAIL" }), outcome: "FAIL", state: "EXECUTED" },
    { name: "omitted outcome remains omitted", change: (ref: EvidenceRefV1): EvidenceRefV1 => {
      const { reportedOutcome: _reportedOutcome, ...withoutOutcome } = ref;
      void _reportedOutcome;
      return withoutOutcome;
    }, outcome: undefined, state: "EXECUTED" },
    { name: "NOT_EXECUTED remains a declaration", change: (ref: EvidenceRefV1): EvidenceRefV1 => ({ ...ref, reportedExecutionState: "NOT_EXECUTED" }), outcome: "PASS", state: "NOT_EXECUTED" },
    { name: "EXECUTED remains a declaration", change: (ref: EvidenceRefV1): EvidenceRefV1 => ({ ...ref, reportedExecutionState: "EXECUTED" }), outcome: "PASS", state: "EXECUTED" },
  ])("$name", ({ change, outcome, state }) => {
    const input = cloneS1bFixture(fixture, { evidenceRefs: alterRef(0, change) }).input;
    const result = bindEvidence(input);
    const firstBinding = result.bindingResults[0];

    expect(result.evaluationStatus).toBe("EVALUATED");
    expect(firstBinding?.bindingStatus).toBe("MATCH");
    expect(firstBinding?.reasonCodes).toEqual([]);
    expect(result.coverageAssessmentStatus).toBe("ASSESSABLE");
    expect(result.coverageResults).toHaveLength(2);
    expect(result.coverageResults.map((coverage) => coverage.coverageStatus)).toEqual([
      "MATCHED_REF_PRESENT",
      "MATCHED_REF_PRESENT",
    ]);
    expect(result.bindingResults[0]?.reportedOutcome).toBe(outcome);
    expect(result.bindingResults[0]?.reportedExecutionState).toBe(state);
    expect(result.bindingResults[0]?.authenticityStatus).toBe("NOT_VERIFIED");
    expect(result.bindingResults[0]?.executionVerificationStatus).toBe("NOT_VERIFIED");
    // A reported FAIL is still only a declaration; matching references stay MATCH and unverified.
  });
});
