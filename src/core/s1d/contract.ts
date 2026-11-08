import type { LoaderResult } from "../s1a/contract.js";
import type { BinderResult, ProvenanceClass } from "../s1b/contract.js";
import type { S1cResult } from "../s1c/contract.js";

export type StageSkipReason =
  | "EVIDENCE_SOURCE_UNAVAILABLE"
  | "CHANGESET_SOURCE_UNAVAILABLE"
  | "PLAN_SNAPSHOT_UNAVAILABLE"
  | "PREREQUISITE_UNAVAILABLE"
  | "INPUT_SOURCE_UNAVAILABLE";

export type Stage<T> =
  | Readonly<{ state: "EVALUATED"; result: T }>
  | Readonly<{ state: "NOT_EVALUATED"; reason: StageSkipReason }>;

export type InputIssue = Readonly<{
  source: "evidence" | "changeset";
  code: "INPUT_READ_FAILED" | "INPUT_TOO_LARGE" | "INPUT_UTF8_INVALID" | "INPUT_JSON_INVALID";
}>;

export type EvidenceProvenanceClaim = Readonly<{
  evidenceId: string;
  issuerId: string;
  originId: string;
  provenanceClass: ProvenanceClass;
}>;

export type ProvenanceProjection =
  | Readonly<{
      state: "CLAIMS_AVAILABLE";
      validation: "ALL_EVIDENCE_REFS_STRUCTURALLY_VALID";
      verification: "NOT_VERIFIED";
      claims: readonly EvidenceProvenanceClaim[];
    }>
  | Readonly<{
      state: "WITHHELD";
      reason: "EVIDENCE_SOURCE_UNAVAILABLE" | "EVIDENCE_SET_INVALID" | "BINDING_NOT_AVAILABLE" | "BINDING_INCONSISTENT";
      claims: readonly [];
    }>;

export type ScopeFallback =
  | Readonly<{
      state: "EVALUATED";
      provenance: "S1C_EXISTING_SCOPE_PRIMITIVES";
      candidateScopeComparison: "WITHIN_CANDIDATE_SCOPE" | "OUTSIDE_CANDIDATE_SCOPE";
      outsidePaths: readonly string[];
      formalVerdictAvailable: false;
      limitation: "NO_FORMAL_S1C_RESULT";
    }>
  | Readonly<{
      state: "NOT_EVALUATED";
      reason: "PREREQUISITE_UNAVAILABLE" | "PLAN_SNAPSHOT_UNAVAILABLE" | "SCOPE_POLICY_UNDEFINED" | "SCOPE_POLICY_INVALID" | "SCOPE_POLICY_REFERENCE_MISMATCH" | "CHANGESET_INVALID" | "CHANGESET_UNAVAILABLE";
    }>;

export type S1dReportV1 = Readonly<{
  schemaVersion: "justice-s1d-report-v1";
  operation: "diagnose";
  readOnly: true;
  stages: Readonly<{
    s1a: Stage<LoaderResult>;
    s1b: Stage<BinderResult>;
    s1c: Stage<S1cResult>;
  }>;
  inputIssues: readonly InputIssue[];
  provenance: ProvenanceProjection;
  scopeFallback?: ScopeFallback;
  limitations: readonly string[];
}>;

export type S1dFatalErrorV1 = Readonly<{
  schemaVersion: "justice-s1d-error-v1";
  operation: "diagnose";
  status: "ERROR";
  error: Readonly<{
    category: "CLI_USAGE" | "INTERNAL_FAILURE";
    code: "CLI_ARGUMENT_INVALID" | "UNEXPECTED_INTERNAL_ERROR";
  }>;
}>;
