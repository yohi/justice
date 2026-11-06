import type { LoaderResult } from "../s1a/contract.js";

export type IdentityRef = Readonly<{ artifactId: string; revision: string }>;
export type EvidenceType = "test" | "build" | "lint" | "artifact" | "review" | "other";
export type ProvenanceClass = "SELF_DECLARED" | "FIXTURE_OBSERVATION" | "UNVERIFIED_EXTERNAL";
export type ReportedExecutionState = "EXECUTED" | "NOT_EXECUTED" | "UNKNOWN";
export type ReportedOutcome = "PASS" | "FAIL" | "UNKNOWN";
export type EvidenceRefV1 = Readonly<{
  evidenceId: string;
  type: EvidenceType;
  taskRef: IdentityRef;
  scopeKey: string;
  acRef?: IdentityRef;
  issuerId: string;
  originId: string;
  provenanceClass: ProvenanceClass;
  reportedExecutionState: ReportedExecutionState;
  reportedOutcome?: ReportedOutcome;
  contentDigest?: Readonly<{ algorithm: "sha256"; hex: string }>;
}>;
export type BinderInput = Readonly<{
  schemaVersion: "justice-s1b-input-v1";
  baseline: LoaderResult;
  evidenceRefs: readonly EvidenceRefV1[];
}>;
export type EvaluationStatus = "EVALUATED" | "BASELINE_UNKNOWN" | "INPUT_REJECTED";
export type BindingStatus = "MATCH" | "MISMATCH" | "UNKNOWN";
export type BindingReasonCode =
  | "BASELINE_NOT_READY"
  | "TASK_NOT_SELECTED"
  | "TASK_REVISION_MISMATCH"
  | "SCOPE_MISMATCH"
  | "AC_NOT_SELECTED"
  | "AC_REVISION_MISMATCH"
  | "AC_TASK_MISMATCH";
export type CoverageStatus = "MATCHED_REF_PRESENT" | "MISSING_EVIDENCE" | "UNKNOWN";
export type CoverageAssessmentStatus = "ASSESSABLE" | "UNKNOWN";
export type InputRejectionReason =
  | "INPUT_SCHEMA_INVALID"
  | "BASELINE_SHAPE_INVALID"
  | "EVIDENCE_LIMIT_EXCEEDED"
  | "EVIDENCE_FIELD_INVALID"
  | "UNSAFE_IDENTIFIER"
  | "DUPLICATE_EVIDENCE_ID";
export type AuthenticityStatus = "NOT_VERIFIED";
export type ExecutionVerificationStatus = "NOT_VERIFIED";
export type BindingResult = Readonly<{
  evidenceId: string;
  bindingStatus: BindingStatus;
  reasonCodes: readonly BindingReasonCode[];
  reportedExecutionState: ReportedExecutionState;
  reportedOutcome?: ReportedOutcome;
  authenticityStatus: AuthenticityStatus;
  executionVerificationStatus: ExecutionVerificationStatus;
}>;
export type CoverageResult = Readonly<{
  acRef: IdentityRef;
  coverageStatus: CoverageStatus;
  matchingEvidenceIds: readonly string[];
}>;
export type BinderResult = Readonly<{
  schemaVersion: "justice-s1b-result-v1";
  evaluationStatus: EvaluationStatus;
  bindingResults: readonly BindingResult[];
  coverageResults: readonly CoverageResult[];
  coverageAssessmentStatus: CoverageAssessmentStatus;
  rejectionReasonCode?: InputRejectionReason;
  authenticityStatus: AuthenticityStatus;
  executionVerificationStatus: ExecutionVerificationStatus;
  limitations: readonly ["OWNER_APPROVAL_NOT_PROVEN", "EVIDENCE_AUTHENTICITY_NOT_VERIFIED", "HOST_EXECUTION_NOT_VERIFIED"];
}>;
export type BaselineInspection =
  | Readonly<{ status: "READY"; baseline: LoaderResult }>
  | Readonly<{ status: "NOT_READY"; baseline: LoaderResult }>
  | Readonly<{ status: "MALFORMED" }>;
