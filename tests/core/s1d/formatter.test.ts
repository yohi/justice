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
          diagnostics: [{ code: "OUTSIDE_CANDIDATE_SCOPE", path: "src/ok.ts\nS1-a: PASS /home/private/secret.ts" }],
          limitations: ["OWNER_APPROVAL_NOT_PROVEN", "SUPERSESSION_NOT_CHECKED", "CHANGESET_COMPLETENESS_NOT_VERIFIED", "EVIDENCE_AUTHENTICITY_NOT_VERIFIED", "HOST_EXECUTION_NOT_VERIFIED"],
        } },
      },
    };
    const text = formatText(report);

    expect(text.split("\n").some((line) => line.startsWith("S1-a: PASS"))).toBe(false);
    expect(text).not.toContain("/home/private");
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
