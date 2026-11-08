import type { LoaderResult } from "../s1a/contract.js";
import type {
  BindingReasonCode,
  EvidenceRefV1,
  ReportedExecutionState,
  ReportedOutcome,
} from "../s1b/contract.js";

export const MAX_PLAN_BYTES = 8_388_608;

export type CandidateScopeComparison =
  | "WITHIN_CANDIDATE_SCOPE"
  | "OUTSIDE_CANDIDATE_SCOPE"
  | "UNKNOWN";
export type DeviationVerdict = "NO_DEVIATION_DETECTED" | "DEVIATION_DETECTED" | "UNKNOWN";
export type DiagnosticCode =
  | "S1C_INPUT_INVALID"
  | "S1A_BASELINE_INVALID"
  | "S1A_BASELINE_NOT_READY"
  | "PLAN_BYTES_INVALID"
  | "PLAN_IDENTITY_MISMATCH"
  | "SCOPE_POLICY_UNDEFINED"
  | "SCOPE_POLICY_INVALID"
  | "SCOPE_POLICY_REFERENCE_MISMATCH"
  | "CHANGESET_UNAVAILABLE"
  | "CHANGESET_INVALID"
  | "OUTSIDE_CANDIDATE_SCOPE"
  | "S1B_INPUT_REJECTED"
  | "S1B_BASELINE_UNKNOWN"
  | "S1B_BINDING_MISMATCH"
  | "AC_EVIDENCE_REF_MISSING"
  | "OWNER_AUTHORITY_NOT_VERIFIED";

export type S1cDiagnostic = Readonly<
  | { code: "S1B_BINDING_MISMATCH"; evidenceId: string; bindingReasonCodes: readonly BindingReasonCode[] }
  | { code: "OUTSIDE_CANDIDATE_SCOPE"; path: string }
  | { code: "AC_EVIDENCE_REF_MISSING"; acId: string }
  | { code: Exclude<DiagnosticCode, "S1B_BINDING_MISMATCH" | "OUTSIDE_CANDIDATE_SCOPE" | "AC_EVIDENCE_REF_MISSING"> }
>;

export const S1C_LIMITATIONS = Object.freeze([
  "OWNER_APPROVAL_NOT_PROVEN",
  "SUPERSESSION_NOT_CHECKED",
  "CHANGESET_COMPLETENESS_NOT_VERIFIED",
  "EVIDENCE_AUTHENTICITY_NOT_VERIFIED",
  "HOST_EXECUTION_NOT_VERIFIED",
] as const);

export type ChangedPath = Readonly<
  | { kind: "ADD" | "MODIFY" | "DELETE"; path: string }
  | { kind: "RENAME"; oldPath: string; newPath: string }
>;
export type ChangeSet = Readonly<
  | { availability: "UNAVAILABLE" }
  | { availability: "PRESENT"; changes: readonly ChangedPath[] }
>;
export type TaskScopePolicy = Readonly<{
  schemaVersion: "justice-s1c-task-scope-v1";
  planRef: Readonly<{ artifactId: string; revision: string }>;
  taskRef: Readonly<{ artifactId: string; revision: string }>;
  scopeKey: string;
  allowedPaths: readonly string[];
}>;

export type S1cInput = Readonly<{
  schemaVersion: "justice-s1c-input-v1";
  baseline: LoaderResult;
  planBytes: Uint8Array;
  changeSet: ChangeSet;
  evidenceRefs: readonly EvidenceRefV1[];
}>;
export type S1cResult = Readonly<{
  schemaVersion: "justice-s1c-result-v1";
  formalVerdict: DeviationVerdict;
  candidateScopeComparison: CandidateScopeComparison;
  ownerAuthorityVerification: "NOT_VERIFIED_BY_S1C";
  reportedEvidenceClaims: readonly Readonly<{
    evidenceId: string;
    reportedOutcome?: ReportedOutcome;
    reportedExecutionState: ReportedExecutionState;
  }> [];
  diagnostics: readonly S1cDiagnostic[];
  limitations: typeof S1C_LIMITATIONS;
}>;
