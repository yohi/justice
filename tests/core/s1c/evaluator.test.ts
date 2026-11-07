import { describe, expect, it } from "vitest";
import { evaluateS1c } from "../../../src/core/s1c/evaluator.js";
import { S1C_LIMITATIONS, type S1cInput } from "../../../src/core/s1c/contract.js";
import { jsonBytes, s1aFixture, sha256 } from "../../helpers/s1a-fixtures.js";
import { loadS1aArtifacts } from "../../../src/core/s1a/loader.js";

const planText = [
  "## Justice S1-c Task Scope Policies",
  "<!-- justice:s1c-task-scope:begin -->",
  JSON.stringify({ schemaVersion: "justice-s1c-task-scope-v1", planRef: { artifactId: "plan-1", revision: "R1" }, taskRef: { artifactId: "task-1", revision: "R1" }, scopeKey: "scope-1", allowedPaths: ["src/**"] }),
  "<!-- justice:s1c-task-scope:end -->",
].join("\n");

async function input(changes: unknown = { availability: "PRESENT", changes: [{ kind: "ADD", path: "src/a.ts" }] }, refs: unknown[] = []) {
  const base = s1aFixture();
  const bytes = new TextEncoder().encode(planText);
  const manifest = { ...base.manifest, artifacts: base.manifest.artifacts.map((ref) => ref.artifactId === "plan-1" ? { ...ref, digest: { algorithm: "sha256" as const, hex: sha256(bytes) } } : ref) };
  const source = {
    async readInputFile(path: string) { return path === "manifest" ? jsonBytes(manifest) : jsonBytes(base.intent); },
    async readArtifact(_root: string, path: string) { return path === "plan-1.md" ? bytes : base.files[path] ?? new Uint8Array(); },
  };
  const baseline = await loadS1aArtifacts({ ...base.input, expectedManifestSha256: sha256(jsonBytes(manifest)) }, source);
  return { schemaVersion: "justice-s1c-input-v1", baseline, planBytes: bytes, changeSet: changes, evidenceRefs: refs } as unknown as S1cInput;
}

describe("evaluateS1c", () => {
  it("malformedEnvelopeRejectsBothBranches", async () => {
    const value = await input();
    const result = evaluateS1c({ ...value, extra: true } as unknown as S1cInput);
    expect(result.diagnostics.map((item) => item.code)).toEqual(["S1C_INPUT_INVALID", "OWNER_AUTHORITY_NOT_VERIFIED"]);
    expect(result.candidateScopeComparison).toBe("UNKNOWN");
    expect(result.formalVerdict).toBe("UNKNOWN");
    expect(result.reportedEvidenceClaims).toEqual([]);
  });
  it("rejectsUnknownNonEnumerableAndSymbolEnvelopeKeys", async () => {
    const value = await input();
    for (const key of ["approved", Symbol("unexpected")]) {
      const malformed = { ...value } as Record<PropertyKey, unknown>;
      Object.defineProperty(malformed, key, { value: true, enumerable: false });
      const result = evaluateS1c(malformed as unknown as S1cInput);
      expect(result.diagnostics.map((item) => item.code)).toContain("S1C_INPUT_INVALID");
      expect(result.candidateScopeComparison).toBe("UNKNOWN");
      expect(result.formalVerdict).toBe("UNKNOWN");
    }
  });
  it("absentEnvelopeSlotRejectsBothBranches", async () => {
    const value = await input();
    const { evidenceRefs, ...missing } = value;
    void evidenceRefs;
    const result = evaluateS1c(missing as S1cInput);
    expect(result.diagnostics.map((item) => item.code)).toEqual(["S1C_INPUT_INVALID", "OWNER_AUTHORITY_NOT_VERIFIED"]);
    expect(result.formalVerdict).toBe("UNKNOWN");
  });
  it("malformedBaselineRejectsBothBranches", async () => {
    const value = await input();
    const result = evaluateS1c({ ...value, baseline: {} } as unknown as S1cInput);
    expect(result.diagnostics.map((item) => item.code)).toEqual(["S1A_BASELINE_INVALID", "OWNER_AUTHORITY_NOT_VERIFIED"]);
    expect(result.candidateScopeComparison).toBe("UNKNOWN");
    expect(result.formalVerdict).toBe("UNKNOWN");
  });
  it("revokedBaselineProxyBecomesInvalidInsteadOfThrowing", async () => {
    const value = await input();
    const revocable = Proxy.revocable(value.baseline, {});
    revocable.revoke();
    const result = evaluateS1c({ ...value, baseline: revocable.proxy } as S1cInput);
    expect(result.diagnostics.map((item) => item.code)).toEqual(["S1A_BASELINE_INVALID", "OWNER_AUTHORITY_NOT_VERIFIED"]);
  });
  it("nonreadyBaselineRetainsS1bStatus", async () => {
    const value = await input();
    const baseline = { ...value.baseline, identityStatus: "UNKNOWN" as const, identityCandidateReady: false, checks: value.baseline.checks.map((check) => check.outcome === "MATCH" ? { ...check, outcome: "UNKNOWN" as const, category: "CHECK_INCOMPLETE" as const } : check) };
    const result = evaluateS1c({ ...value, baseline });
    expect(result.diagnostics.map((item) => item.code)).toEqual(["S1A_BASELINE_NOT_READY", "S1B_BASELINE_UNKNOWN", "OWNER_AUTHORITY_NOT_VERIFIED"]);
  });
  it("invalidOrOversizePlanBytesDoesNotStopEvidence", async () => {
    const value = await input();
    const result = evaluateS1c({ ...value, planBytes: "bad" } as unknown as S1cInput);
    expect(result.diagnostics.map((item) => item.code)).toContain("PLAN_BYTES_INVALID");
    expect(result.formalVerdict).toBe("UNKNOWN");
    expect(result.candidateScopeComparison).toBe("UNKNOWN");
    expect(result.reportedEvidenceClaims).toEqual([]);
    const oversize = evaluateS1c({ ...value, planBytes: new Uint8Array(8_388_609) });
    expect(oversize.diagnostics.map((item) => item.code)).toEqual(["PLAN_BYTES_INVALID", "AC_EVIDENCE_REF_MISSING", "AC_EVIDENCE_REF_MISSING", "OWNER_AUTHORITY_NOT_VERIFIED"]);
    const atLimit = evaluateS1c({ ...value, planBytes: new Uint8Array(8_388_608) });
    expect(atLimit.diagnostics.map((item) => item.code)).toContain("PLAN_IDENTITY_MISMATCH");
  });
  it("invalidPlanStillInspectsMalformedChangeSet", async () => {
    const value = await input({ availability: "PRESENT", changes: [null] });
    const result = evaluateS1c({ ...value, planBytes: new Uint8Array(8_388_609) });
    expect(result.diagnostics.map((item) => item.code)).toEqual([
      "PLAN_BYTES_INVALID", "CHANGESET_INVALID", "AC_EVIDENCE_REF_MISSING",
      "AC_EVIDENCE_REF_MISSING", "OWNER_AUTHORITY_NOT_VERIFIED",
    ]);
    expect(result.candidateScopeComparison).toBe("UNKNOWN");
    expect(result.ownerAuthorityVerification).toBe("NOT_VERIFIED_BY_S1C");
  });
  it("invalidPlanStillValidatesChangeSetButLeavesComparisonUnknown", async () => {
    const value = await input();
    const result = evaluateS1c({ ...value, planBytes: new TextEncoder().encode("different") });
    expect(result.diagnostics.map((item) => item.code)).toContain("PLAN_IDENTITY_MISMATCH");
    expect(result.candidateScopeComparison).toBe("UNKNOWN");
    expect(result.diagnostics.map((item) => item.code)).not.toContain("CHANGESET_INVALID");
    expect(result.diagnostics.map((item) => item.code)).toContain("OWNER_AUTHORITY_NOT_VERIFIED");
  });
  it("digestMismatchIsObservedNotInputInvalid", async () => {
    const value = await input();
    const result = evaluateS1c({ ...value, planBytes: new TextEncoder().encode("different") });
    expect(result.diagnostics.map((item) => item.code)).toContain("PLAN_IDENTITY_MISMATCH");
  });
  it("evidenceInvalidRetainsCandidateScope", async () => {
    const value = await input();
    const result = evaluateS1c({ ...value, evidenceRefs: [null] } as unknown as S1cInput);
    expect(result.candidateScopeComparison).toBe("WITHIN_CANDIDATE_SCOPE");
    expect(result.diagnostics.map((item) => item.code)).toContain("S1B_INPUT_REJECTED");
    expect(result.reportedEvidenceClaims).toEqual([]);
  });
  it("changeSetInvalidRetainsEvidenceDiagnostics", async () => {
    const value = await input({ availability: "PRESENT", changes: [null] });
    const result = evaluateS1c(value);
    expect(result.candidateScopeComparison).toBe("UNKNOWN");
    expect(result.diagnostics.map((item) => item.code)).toContain("CHANGESET_INVALID");
  });
  it("typedMismatchRetainsS1bReasonOrder", async () => {
    const value = await input();
    const ref = { evidenceId: "ev-1", type: "test", taskRef: { artifactId: "wrong", revision: "R1" }, scopeKey: "wrong", issuerId: "i", originId: "o", provenanceClass: "SELF_DECLARED", reportedExecutionState: "EXECUTED" } as const;
    const result = evaluateS1c({ ...value, evidenceRefs: [ref] });
    expect(result.diagnostics.find((item) => item.code === "S1B_BINDING_MISMATCH")).toMatchObject({ evidenceId: "ev-1", bindingReasonCodes: ["TASK_NOT_SELECTED", "SCOPE_MISMATCH"] });
    expect(result.reportedEvidenceClaims).toEqual([{ evidenceId: "ev-1", reportedExecutionState: "EXECUTED" }]);
  });
  it("changeSetInvalidRetainsRealMismatchAndMissingCoverage", async () => {
    const ref = { evidenceId: "ev-1", type: "test", taskRef: { artifactId: "wrong", revision: "R1" }, scopeKey: "wrong", issuerId: "i", originId: "o", provenanceClass: "SELF_DECLARED", reportedExecutionState: "EXECUTED", reportedOutcome: "PASS" } as const;
    const value = await input({ availability: "PRESENT", changes: [null] }, [ref]);
    const result = evaluateS1c(value);
    expect(result.diagnostics.map((item) => item.code)).toEqual(["CHANGESET_INVALID", "S1B_BINDING_MISMATCH", "AC_EVIDENCE_REF_MISSING", "AC_EVIDENCE_REF_MISSING", "OWNER_AUTHORITY_NOT_VERIFIED"]);
    expect(result.reportedEvidenceClaims).toEqual([{ evidenceId: "ev-1", reportedOutcome: "PASS", reportedExecutionState: "EXECUTED" }]);
  });
  it("stableImmutabilityAndSafeDiagnostics", async () => {
    const value = await input({ availability: "PRESENT", changes: [{ kind: "ADD", path: "../secret" }] });
    const result = evaluateS1c(value);
    expect(Object.isFrozen(result)).toBe(true);
    expect(result.diagnostics.map((item) => item.code)).not.toContain("../secret");
    expect(Object.isFrozen(result.diagnostics)).toBe(true);
    expect(Object.isFrozen(result.reportedEvidenceClaims)).toBe(true);
    expect(value.baseline.identityCandidateReady).toBe(true);
  });
  it("outsidePathsAreDeduplicatedAndSortedAcrossPermutations", async () => {
    const first = await input({ availability: "PRESENT", changes: [{ kind: "ADD", path: "z/out.ts" }, { kind: "ADD", path: "a/out.ts" }, { kind: "MODIFY", path: "z/out.ts" }] });
    const second = await input({ availability: "PRESENT", changes: [{ kind: "MODIFY", path: "z/out.ts" }, { kind: "ADD", path: "a/out.ts" }] });
    const project = (result: ReturnType<typeof evaluateS1c>) => result.diagnostics.filter((item) => item.code === "OUTSIDE_CANDIDATE_SCOPE");
    expect(project(evaluateS1c(first))).toEqual(project(evaluateS1c(second)));
    expect(project(evaluateS1c(first))).toEqual([{ code: "OUTSIDE_CANDIDATE_SCOPE", path: "a/out.ts" }, { code: "OUTSIDE_CANDIDATE_SCOPE", path: "z/out.ts" }]);
  });
  it("limitationsFixedForEveryOutcome", async () => {
    const result = evaluateS1c({} as S1cInput);
    expect(result.limitations).toEqual(S1C_LIMITATIONS);
    expect(Object.isFrozen(result.limitations)).toBe(true);
  });
  it("reportedClaimsAndNestedMismatchReasonsAreFrozen", async () => {
    const ref = { evidenceId: "ev-1", type: "test", taskRef: { artifactId: "wrong", revision: "R1" }, scopeKey: "wrong", issuerId: "i", originId: "o", provenanceClass: "SELF_DECLARED", reportedExecutionState: "EXECUTED", reportedOutcome: "FAIL" } as const;
    const value = await input({ availability: "PRESENT", changes: [{ kind: "ADD", path: "outside.ts" }] }, [ref]);
    const result = evaluateS1c(value);
    const mismatch = result.diagnostics.find((item) => item.code === "S1B_BINDING_MISMATCH");
    expect(mismatch?.code === "S1B_BINDING_MISMATCH" && Object.isFrozen(mismatch.bindingReasonCodes)).toBe(true);
    expect(Object.isFrozen(result.reportedEvidenceClaims[0])).toBe(true);
    expect(result.reportedEvidenceClaims[0]).toEqual({ evidenceId: "ev-1", reportedOutcome: "FAIL", reportedExecutionState: "EXECUTED" });
    expect(value.evidenceRefs[0]).toBe(ref);
  });
});
