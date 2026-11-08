import { describe, expect, it } from "vitest";
import { loadS1aArtifacts } from "../../../src/core/s1a/loader.js";
import type { BinderResult, EvidenceRefV1 } from "../../../src/core/s1b/contract.js";
import { bindEvidence } from "../../../src/core/s1b/binder.js";
import type { S1cResult } from "../../../src/core/s1c/contract.js";
import type { Stage, S1dReportV1 } from "../../../src/core/s1d/contract.js";
import { assembleReport, projectProvenance } from "../../../src/core/s1d/report.js";
import { s1aFixture } from "../../helpers/s1a-fixtures.js";

function evidence(evidenceId: string, overrides: Partial<EvidenceRefV1> = {}): EvidenceRefV1 {
  return {
    evidenceId,
    type: "test",
    taskRef: { artifactId: "task-1", revision: "R1" },
    scopeKey: "scope-1",
    issuerId: `issuer-${evidenceId}`,
    originId: `origin-${evidenceId}`,
    provenanceClass: "SELF_DECLARED",
    reportedExecutionState: "EXECUTED",
    ...overrides,
  };
}

async function bound(refs: readonly EvidenceRefV1[]): Promise<BinderResult> {
  const fixture = s1aFixture();
  const baseline = await loadS1aArtifacts(fixture.input, fixture.source);
  return bindEvidence({ schemaVersion: "justice-s1b-input-v1", baseline, evidenceRefs: refs });
}

async function baselineUnknown(refs: readonly EvidenceRefV1[]): Promise<BinderResult> {
  const fixture = s1aFixture();
  const baseline = await loadS1aArtifacts(fixture.input, {
    ...fixture.source,
    async readArtifact() { throw Error("unavailable"); },
  });
  return bindEvidence({ schemaVersion: "justice-s1b-input-v1", baseline, evidenceRefs: refs });
}

function emptyStages(): S1dReportV1["stages"] {
  return {
    s1a: { state: "NOT_EVALUATED", reason: "INPUT_SOURCE_UNAVAILABLE" },
    s1b: { state: "NOT_EVALUATED", reason: "EVIDENCE_SOURCE_UNAVAILABLE" },
    s1c: { state: "NOT_EVALUATED", reason: "PREREQUISITE_UNAVAILABLE" },
  };
}

describe("S1-d report projection", () => {
  it("projectsOnlyCompletelyValidEvidenceClaims", async () => {
    const refs = [
      evidence("z-evidence", { issuerId: "issuer-z", originId: "origin-z", provenanceClass: "UNVERIFIED_EXTERNAL" }),
      evidence("a-evidence", { issuerId: "issuer-a", originId: "origin-a", provenanceClass: "FIXTURE_OBSERVATION" }),
    ];
    const binder = await bound(refs);
    const projection = projectProvenance({ state: "PARSED", value: refs }, { state: "EVALUATED", result: binder });

    expect(projection).toEqual({
      state: "CLAIMS_AVAILABLE",
      validation: "ALL_EVIDENCE_REFS_STRUCTURALLY_VALID",
      verification: "NOT_VERIFIED",
      claims: [
        { evidenceId: "a-evidence", issuerId: "issuer-a", originId: "origin-a", provenanceClass: "FIXTURE_OBSERVATION" },
        { evidenceId: "z-evidence", issuerId: "issuer-z", originId: "origin-z", provenanceClass: "UNVERIFIED_EXTERNAL" },
      ],
    });
    expect(projection.claims.map((claim) => claim.evidenceId)).toEqual(binder.bindingResults.map((binding) => binding.evidenceId));
  });

  it("withholdsAllClaimsForOneInvalidRef", async () => {
    const valid = evidence("valid", { issuerId: "secret-issuer" });
    const invalid = { ...evidence("invalid"), issuerId: "bad issuer" };
    const projection = projectProvenance({ state: "PARSED", value: [valid, invalid] }, { state: "EVALUATED", result: await bound([valid]) });

    expect(projection).toEqual({ state: "WITHHELD", reason: "EVIDENCE_SET_INVALID", claims: [] });
    expect(JSON.stringify(projection)).not.toContain("secret-issuer");
  });

  it("withholdsMismatchedBindingIds", async () => {
    const refs = [evidence("expected")];
    const binder = await bound(refs);
    const inconsistent = { ...binder, bindingResults: [] };
    const projection = projectProvenance({ state: "PARSED", value: refs }, { state: "EVALUATED", result: inconsistent });

    expect(projection).toEqual({ state: "WITHHELD", reason: "BINDING_INCONSISTENT", claims: [] });
  });

  it("retainsEmptyValidSetAndNotReadyBaseline", async () => {
    const empty = projectProvenance({ state: "PARSED", value: [] }, { state: "EVALUATED", result: await bound([]) });
    const refs = [evidence("declared")];
    const notReady = await baselineUnknown(refs);
    const unknownProjection = projectProvenance({ state: "PARSED", value: refs }, { state: "EVALUATED", result: notReady });

    expect(empty).toMatchObject({ state: "CLAIMS_AVAILABLE", claims: [] });
    expect(notReady.evaluationStatus).toBe("BASELINE_UNKNOWN");
    expect(unknownProjection).toMatchObject({ state: "CLAIMS_AVAILABLE", verification: "NOT_VERIFIED", claims: [{ evidenceId: "declared" }] });
  });

  it("unionsLimitationsAndPreservesCore", async () => {
    const s1b: Stage<BinderResult> = { state: "EVALUATED", result: await bound([]) };
    const coreResult: S1cResult = {
      schemaVersion: "justice-s1c-result-v1", formalVerdict: "UNKNOWN", candidateScopeComparison: "UNKNOWN",
      ownerAuthorityVerification: "NOT_VERIFIED_BY_S1C", reportedEvidenceClaims: [], diagnostics: [],
      limitations: ["OWNER_APPROVAL_NOT_PROVEN", "SUPERSESSION_NOT_CHECKED", "CHANGESET_COMPLETENESS_NOT_VERIFIED", "EVIDENCE_AUTHENTICITY_NOT_VERIFIED", "HOST_EXECUTION_NOT_VERIFIED"],
    };
    const s1c: Stage<S1cResult> = { state: "EVALUATED", result: coreResult };
    const fixture = s1aFixture();
    const baseline = await loadS1aArtifacts(fixture.input, fixture.source);
    const s1a = { state: "EVALUATED", result: { ...baseline, limitations: ["Z_LIMITATION", ...baseline.limitations, "Z_LIMITATION"] } } as const;
    const coreSnapshot = JSON.stringify({ s1a, s1b, s1c });
    const report = assembleReport({
      stages: { ...emptyStages(), s1a, s1b, s1c }, inputIssues: [],
      provenance: { state: "WITHHELD", reason: "EVIDENCE_SOURCE_UNAVAILABLE", claims: [] },
    });

    expect(report.limitations).toEqual([...new Set(report.limitations)].sort());
    expect(report.limitations).toContain("Z_LIMITATION");
    expect(report).not.toHaveProperty("scopeFallback");
    expect(JSON.stringify({ s1a: report.stages.s1a, s1b: report.stages.s1b, s1c: report.stages.s1c })).toBe(coreSnapshot);
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.limitations)).toBe(true);
    expect(Object.isFrozen(report.provenance)).toBe(true);
  });
});
