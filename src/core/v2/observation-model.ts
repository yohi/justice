// src/core/v2/observation-model.ts
import type { ObservationAgentId, EvidenceRef } from "../types";
// type-only mutual import with decision-model — safe: the cycle is erased at emit. Do NOT change to a value import.
import type { PendingDecisionRecord, DecisionRecord } from "./decision-model";

export type PendingEnvelope = {
  readonly schemaVersion: 1;
  readonly timestamp: string;
  readonly agentId: ObservationAgentId;
  readonly sessionId: string;
  readonly writerId: string;
  readonly taskId?: string;
  readonly recordType: "observation" | "decision" | "learning";
};

export type PersistedEnvelope = PendingEnvelope & {
  readonly sequence: number;
};

// Evidence discriminated union (Task 1.3). Replaces the Task 1.1 stub.
export type Evidence = ToolOutputEvidence | DeclaredClaimEvidence;

export type ToolOutputEvidence = CommandExecEvidence | FileContentEvidence;

export type CommandExecEvidence = {
  readonly evidenceId: string;
  readonly kind: "test" | "build" | "lint" | "command" | "generic";
  readonly sourceClass: "tool_output";
  readonly provenance: "observed" | "derived" | "unknown";
  readonly toolOutputClass: "command_exec";
  readonly command: string;
  readonly rawOutput: string;
  readonly interpretation?: Interpretation;
};

export type FileContentEvidence = {
  readonly evidenceId: string;
  readonly kind: "test" | "build" | "lint" | "command" | "generic";
  readonly sourceClass: "tool_output";
  readonly provenance: "observed" | "derived" | "unknown";
  readonly toolOutputClass: "file_content";
  readonly command?: string;
  readonly rawOutput?: never; // rawOutput must not be stored in file_content
  readonly rawOutputHash: string; // required
  readonly rawOutputSnippet?: string; // optional
  readonly interpretation?: Interpretation;
};

export type Interpretation = {
  readonly outcome: "pass" | "fail" | "unknown";
  readonly basis: "parsed_output" | "metadata_error";
  readonly provenance: "derived";
  readonly derivedFrom: readonly EvidenceRef[]; // cross-record references use FullEvidenceRef; self-reference within the same record uses SelfEvidenceRef (evidenceId only)
};

export type DeclaredClaimEvidence = {
  readonly evidenceId: string;
  readonly kind: "test" | "build" | "lint" | "generic";
  readonly sourceClass: "declared_claim";
  readonly provenance: "declared";
  readonly declaredFrom: "message" | "task_summary";
  readonly claim: { readonly claimKind: string; readonly outcome: "pass" | "fail" | "unknown" };
  readonly claimRef?: EvidenceRef & { readonly claimIndex: number };
};

export type ToolExecutedRecord = {
  readonly kind: "tool_executed";
  readonly toolName: string;
  readonly callId: string;
  readonly evidence: Evidence;
};

// MessageRecord stub. Refined in Task 3.1 to include declaredClaims and finalized field.
export type MessageRecord = {
  readonly kind: "message";
  readonly messageID: string;
  readonly role: "assistant" | "user";
  readonly textHash: string;
  readonly textSnippet?: string;
  readonly finalized: boolean;
};

export type SkillInvokedRecord = { readonly kind: "skill_invoked"; /* refined in Task 4.3 */ };
export type SessionErrorRecord = { readonly kind: "session_error"; /* refined in Task 4.4 */ };
export type ReflectionRecord = { readonly kind: "reflection"; /* refined in Task 4.4 */ };


export type ReviewItem = {
  readonly itemKey: string;
  readonly evidenceId: string;
  readonly severity: "critical" | "major" | "minor";
  readonly summary: string;
  readonly location: string;
  readonly status: "open" | "resolved";
};

export type ResolutionMarker = {
  readonly itemKey: string;
  readonly resolution: "explicit_marker" | "snapshot_absence" | "human_artifact";
  readonly artifactRef?: string;
};

export type ReviewObservedRecord = {
  readonly kind: "review_observed";
  readonly reviewScope: string;
  readonly isCompleteSnapshot?: boolean;
  readonly items: readonly ReviewItem[];
  readonly resolutionMarker?: readonly ResolutionMarker[];
};

export type PendingObservationRecord =
  | (PendingEnvelope & { readonly recordType: "observation" } & ToolExecutedRecord)
  | (PendingEnvelope & { readonly recordType: "observation" } & MessageRecord)
  | (PendingEnvelope & { readonly recordType: "observation" } & SkillInvokedRecord)
  | (PendingEnvelope & { readonly recordType: "observation" } & ReviewObservedRecord)
  | (PendingEnvelope & { readonly recordType: "observation" } & SessionErrorRecord)
  | (PendingEnvelope & { readonly recordType: "observation" } & ReflectionRecord);

export type ObservationRecord = PendingObservationRecord & { readonly sequence: number };
export type PendingLogRecord = PendingObservationRecord | PendingDecisionRecord;
export type PersistedLogRecord = ObservationRecord | DecisionRecord;
