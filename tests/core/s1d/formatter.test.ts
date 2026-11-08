import { describe, expect, it } from "vitest";
import type { S1dFatalErrorV1, S1dReportV1 } from "../../../src/core/s1d/contract.js";
import { formatFatal, formatJson, formatText } from "../../../src/core/s1d/formatter.js";

const emptyReport: S1dReportV1 = {
  schemaVersion: "justice-s1d-report-v1",
  operation: "diagnose",
  readOnly: true,
  stages: {
    s1a: { state: "NOT_EVALUATED", reason: "INPUT_SOURCE_UNAVAILABLE" },
    s1b: { state: "NOT_EVALUATED", reason: "EVIDENCE_SOURCE_UNAVAILABLE" },
    s1c: { state: "NOT_EVALUATED", reason: "PREREQUISITE_UNAVAILABLE" },
  },
  inputIssues: [],
  provenance: { state: "WITHHELD", reason: "EVIDENCE_SOURCE_UNAVAILABLE", claims: [] },
  limitations: ["OWNER_AUTHORITY_NOT_PROVEN"],
};

describe("S1-d formatter", () => {
  it("textAndJsonRepeatByteIdentically", () => {
    const json = formatJson(emptyReport);
    const text = formatText(emptyReport);

    expect(formatJson(emptyReport)).toBe(json);
    expect(formatText(emptyReport)).toBe(text);
    expect(JSON.parse(json)).toEqual(emptyReport);
    expect(json.endsWith("\n") && !json.endsWith("\n\n")).toBe(true);
    expect(text.endsWith("\n") && !text.endsWith("\n\n")).toBe(true);
  });

  it("preservesCanonicalJsonFieldOrderAndOptionalFallback", () => {
    const omitted = JSON.parse(formatJson(emptyReport));
    const supplied = JSON.parse(formatJson({
      ...emptyReport,
      scopeFallback: { state: "NOT_EVALUATED", reason: "PREREQUISITE_UNAVAILABLE" },
    }));

    expect(Object.keys(omitted)).toEqual([
      "schemaVersion", "operation", "readOnly", "stages", "inputIssues", "provenance", "limitations",
    ]);
    expect(Object.hasOwn(omitted, "scopeFallback")).toBe(false);
    expect(Object.keys(supplied)).toEqual([
      "schemaVersion", "operation", "readOnly", "stages", "inputIssues", "provenance", "scopeFallback", "limitations",
    ]);
    expect(supplied["scopeFallback"]).toEqual({ state: "NOT_EVALUATED", reason: "PREREQUISITE_UNAVAILABLE" });
  });

  it("rendersUnknownWithoutPromotingToPass", () => {
    const report: S1dReportV1 = {
      ...emptyReport,
      stages: {
        ...emptyReport.stages,
        s1c: { state: "EVALUATED", result: {
          schemaVersion: "justice-s1c-result-v1",
          formalVerdict: "UNKNOWN",
          candidateScopeComparison: "UNKNOWN",
          ownerAuthorityVerification: "NOT_VERIFIED_BY_S1C",
          reportedEvidenceClaims: [],
          diagnostics: [],
          limitations: ["OWNER_APPROVAL_NOT_PROVEN", "SUPERSESSION_NOT_CHECKED", "CHANGESET_COMPLETENESS_NOT_VERIFIED", "EVIDENCE_AUTHENTICITY_NOT_VERIFIED", "HOST_EXECUTION_NOT_VERIFIED"],
        } },
      },
      scopeFallback: { state: "NOT_EVALUATED", reason: "PREREQUISITE_UNAVAILABLE" },
    };

    const text = formatText(report);
    expect(text).toContain("Formal verdict: UNKNOWN");
    expect(text).toContain("Formal verdict: NOT_EVALUATED");
    expect(text).not.toContain("formalVerdict: UNKNOWN");
    expect(text).not.toContain("PASS");
  });

  it("rendersProvenanceAsUnverifiedDeclaration", () => {
    const report: S1dReportV1 = {
      ...emptyReport,
      provenance: {
        state: "CLAIMS_AVAILABLE",
        validation: "ALL_EVIDENCE_REFS_STRUCTURALLY_VALID",
        verification: "NOT_VERIFIED",
        claims: [{ evidenceId: "evidence-1", issuerId: "issuer-1", originId: "origin-1", provenanceClass: "SELF_DECLARED" }],
      },
    };
    const json = formatJson(report);
    const text = formatText(report);

    for (const value of ["evidence-1", "issuer-1", "origin-1", "SELF_DECLARED", "NOT_VERIFIED"]) {
      expect(json).toContain(value);
      expect(text).toContain(value);
    }
    const withheld = formatText({ ...report, provenance: { state: "WITHHELD", reason: "BINDING_INCONSISTENT", claims: [] } });
    expect(withheld).toContain("Evidence source claims: WITHHELD (BINDING_INCONSISTENT)");
    expect(withheld).not.toContain("evidence-1");
    expect(withheld).not.toContain("issuer-1");
  });

  it("rendersLevelAInputIssuesInSourceOrderWithoutInventingIssues", () => {
    const report: S1dReportV1 = {
      ...emptyReport,
      inputIssues: [
        { source: "evidence", code: "INPUT_UTF8_INVALID" },
        { source: "changeset", code: "INPUT_JSON_INVALID" },
      ],
    };

    const text = formatText(report);
    const evidenceIssue = text.indexOf("Input issue: evidence INPUT_UTF8_INVALID");
    const changesetIssue = text.indexOf("Input issue: changeset INPUT_JSON_INVALID");
    expect(evidenceIssue).toBeGreaterThanOrEqual(0);
    expect(changesetIssue).toBeGreaterThan(evidenceIssue);
    expect(formatText(emptyReport)).not.toContain("Input issue:");
  });

  it("rendersS1bRejectionBindingReasonsAndReportedClaimsAsUnverified", () => {
    const report: S1dReportV1 = {
      ...emptyReport,
      stages: {
        ...emptyReport.stages,
        s1b: { state: "EVALUATED", result: {
          schemaVersion: "justice-s1b-result-v1",
          evaluationStatus: "INPUT_REJECTED",
          rejectionReasonCode: "DUPLICATE_EVIDENCE_ID",
          bindingResults: [{
            evidenceId: "evidence-001",
            bindingStatus: "MISMATCH",
            reasonCodes: ["TASK_REVISION_MISMATCH"],
            reportedExecutionState: "EXECUTED",
            reportedOutcome: "PASS",
            authenticityStatus: "NOT_VERIFIED",
            executionVerificationStatus: "NOT_VERIFIED",
          }],
          coverageResults: [],
          coverageAssessmentStatus: "UNKNOWN",
          authenticityStatus: "NOT_VERIFIED",
          executionVerificationStatus: "NOT_VERIFIED",
          limitations: ["OWNER_APPROVAL_NOT_PROVEN", "EVIDENCE_AUTHENTICITY_NOT_VERIFIED", "HOST_EXECUTION_NOT_VERIFIED"],
        } },
      },
    };

    const text = formatText(report);
    expect(text).toContain("rejection reason: DUPLICATE_EVIDENCE_ID");
    expect(text).toContain("evidence evidence-001: MISMATCH\n    binding reasons: TASK_REVISION_MISMATCH");
    expect(text).toContain("reported execution (unverified claim): EXECUTED");
    expect(text).toContain("reported outcome (unverified claim): PASS");
    expect(text).toContain("authenticity: NOT_VERIFIED");
    expect(text).toContain("execution verification: NOT_VERIFIED");
    expect(text).not.toContain("verified PASS");
  });

  it("rendersS1cBindingReasonCodesBesideTheirEvidenceId", () => {
    const report: S1dReportV1 = {
      ...emptyReport,
      stages: {
        ...emptyReport.stages,
        s1c: { state: "EVALUATED", result: {
          schemaVersion: "justice-s1c-result-v1",
          formalVerdict: "UNKNOWN",
          candidateScopeComparison: "UNKNOWN",
          ownerAuthorityVerification: "NOT_VERIFIED_BY_S1C",
          reportedEvidenceClaims: [{
            evidenceId: "evidence-001",
            reportedExecutionState: "UNKNOWN",
            reportedOutcome: "PASS",
          }],
          diagnostics: [{
            code: "S1B_BINDING_MISMATCH",
            evidenceId: "evidence-001",
            bindingReasonCodes: ["TASK_REVISION_MISMATCH"],
          }],
          limitations: ["OWNER_APPROVAL_NOT_PROVEN", "SUPERSESSION_NOT_CHECKED", "CHANGESET_COMPLETENESS_NOT_VERIFIED", "EVIDENCE_AUTHENTICITY_NOT_VERIFIED", "HOST_EXECUTION_NOT_VERIFIED"],
        } },
      },
    };

    const text = formatText(report);
    expect(text).toContain("Finding: S1B_BINDING_MISMATCH evidence-001 (TASK_REVISION_MISMATCH)");
    expect(text).toContain("reported evidence evidence-001 (unverified claim): execution=UNKNOWN; outcome=PASS");
    expect(text).toContain("Formal verdict: UNKNOWN");
  });

  it("escapesControlCharactersAndDoesNotLeakHostPath", () => {
    const report: S1dReportV1 = {
      ...emptyReport,
      stages: {
        ...emptyReport.stages,
        s1c: { state: "EVALUATED", result: {
          schemaVersion: "justice-s1c-result-v1",
          formalVerdict: "UNKNOWN",
          candidateScopeComparison: "OUTSIDE_CANDIDATE_SCOPE",
          ownerAuthorityVerification: "NOT_VERIFIED_BY_S1C",
          reportedEvidenceClaims: [],
          diagnostics: [
            { code: "OUTSIDE_CANDIDATE_SCOPE", path: "src/ok.ts\n/home/private/secret.ts" },
            { code: "OUTSIDE_CANDIDATE_SCOPE", path: "src/x.ts\t/etc/passwd" },
            { code: "OUTSIDE_CANDIDATE_SCOPE", path: "path:/home/x" },
            { code: "OUTSIDE_CANDIDATE_SCOPE", path: "[/home/x]" },
          ],
          limitations: ["OWNER_APPROVAL_NOT_PROVEN", "SUPERSESSION_NOT_CHECKED", "CHANGESET_COMPLETENESS_NOT_VERIFIED", "EVIDENCE_AUTHENTICITY_NOT_VERIFIED", "HOST_EXECUTION_NOT_VERIFIED"],
        } },
      },
    };
    const text = formatText(report);

    expect(text.split("\n").some((line) => line.startsWith("S1-a: PASS"))).toBe(false);
    expect(text).not.toContain("/home/private");
    expect(text).not.toContain("/etc/passwd");
    expect(text).not.toContain("/home/x");
    expect(text).not.toContain("stack");
    expect(text).toContain("\\u000a");
  });

  it("fatalJsonExactEnvelope", () => {
    const usage: S1dFatalErrorV1 = {
      schemaVersion: "justice-s1d-error-v1", operation: "diagnose", status: "ERROR",
      error: { category: "CLI_USAGE", code: "CLI_ARGUMENT_INVALID" },
    };
    const internal: S1dFatalErrorV1 = {
      schemaVersion: "justice-s1d-error-v1", operation: "diagnose", status: "ERROR",
      error: { category: "INTERNAL_FAILURE", code: "UNEXPECTED_INTERNAL_ERROR" },
    };

    expect(formatFatal(usage, "json")).toBe('{"schemaVersion":"justice-s1d-error-v1","operation":"diagnose","status":"ERROR","error":{"category":"CLI_USAGE","code":"CLI_ARGUMENT_INVALID"}}\n');
    expect(formatFatal(internal, "json")).toBe('{"schemaVersion":"justice-s1d-error-v1","operation":"diagnose","status":"ERROR","error":{"category":"INTERNAL_FAILURE","code":"UNEXPECTED_INTERNAL_ERROR"}}\n');
    expect(formatFatal(internal, "text").split("\n")).toHaveLength(2);
    expect(formatFatal(internal, "text")).not.toContain("UNEXPECTED_INTERNAL_ERROR");
  });
});
