// src/core/v2/observation-model.ts
import type {
  EvidenceRef,
  ObservationAgentId,
  WorkflowBootstrapPhase,
  WorkflowStartSource,
} from "../types";
// type-only mutual import with decision-model — safe: the cycle is erased at emit. Do NOT change to a value import.
import type { PendingDecisionRecord, DecisionRecord } from "./decision-model";
import type { DeclaredClaim } from "./declared-claim-extractor";
import type { WorkflowDirectiveStage } from "../workflow-directives";

export type PendingEnvelope = {
  readonly schemaVersion: 1;
  readonly timestamp: string;
  readonly agentId: ObservationAgentId;
  readonly sessionId: string;
  readonly writerId: string;
  readonly taskId?: string;
  // "learning" is a reserved recordType slot: the 3-record-type charter (design §8.1) keeps the
  // enum stable, but no PendingLearningRecord variant exists yet — implementation is deferred to
  // v3 Failure Intelligence (V3-05). Do NOT remove; projection guards reject unknown recordTypes.
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
  readonly basis: "parsed_output" | "metadata_error" | "unparsed";
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
  readonly evidence: Evidence | readonly Evidence[];
};

// MessageRecord (refined in Task 3.1): carries lightweight declared claims and their
// 1:1 evidence for a finalized ASSISTANT message. role is fixed to "assistant" (D22).
// declaredClaims/evidence are REQUIRED (parse-don't-validate): a MessageRecord always
// carries its claim/evidence lists; a producer supplies [] when there are none (D59/D70).
export type MessageRecord = {
  readonly kind: "message";
  readonly messageID: string;
  readonly partID?: string;
  readonly role: "assistant"; // fixed per D22
  readonly textHash: string; // required per D34
  readonly textSnippet?: string;
  readonly declaredClaims: readonly DeclaredClaim[]; // D70: lightweight declared list
  readonly evidence: readonly DeclaredClaimEvidence[]; // 1 claim = 1 Evidence per D59/D70
  readonly finalized: boolean;
};

export type SkillInvokedRecord = {
  readonly kind: "skill_invoked";
  readonly skillName: string;
  readonly source: "skill_tool" | "task_load_skills";
  readonly callId?: string;
};
export type SessionErrorRecord = {
  readonly kind: "session_error";
  readonly errorKind: string;
  readonly message: string;
};
export type ReflectionRecord = {
  readonly kind: "reflection";
  readonly reflection: {
    readonly trigger: "task_succeeded" | "task_error";
    readonly planRef: { readonly path: string; readonly taskId: string };
    readonly intent: "check_complete" | "append_error_note";
    readonly note?: string;
  };
};

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
  readonly resolutionMarkers?: readonly ResolutionMarker[];
};

/**
 * Audit payload shared by every `workflow_*` bootstrap record below.
 *
 * `goalHash`/`goalSnippet` mirror MessageRecord's D34 treatment: the goal text is
 * never persisted verbatim — only a deterministic hash plus a redacted, truncated
 * snippet. `designPath`/`planPath` are omitted (not null) when the request carries
 * none, so the persisted JSON stays sparse.
 */
export type WorkflowBootstrapAudit = {
  readonly phase: WorkflowBootstrapPhase;
  readonly directiveStage?: WorkflowDirectiveStage;
  readonly source: WorkflowStartSource;
  readonly goalHash: string;
  readonly goalSnippet: string;
  readonly designPath?: string;
  readonly planPath?: string;
};

// Workflow bootstrap lifecycle records. These are NON-AUTHORITATIVE audit records:
// they carry no Evidence at all, so they can never be counted toward a Gate PASS
// (FF-008 holds trivially — there is nothing for `rule-evaluation-engine` to read).
// `state-projection` skips them explicitly so they neither open a projected task nor
// contribute evidence; `workflow-bootstrap-projection` exposes them as a separate
// read-only audit stream.
export type WorkflowStartedRecord = {
  readonly kind: "workflow_started";
  readonly workflow: WorkflowBootstrapAudit;
};

export type DesignRequestedRecord = {
  readonly kind: "design_requested";
  readonly workflow: WorkflowBootstrapAudit;
};

export type PlanRequestedRecord = {
  readonly kind: "plan_requested";
  readonly workflow: WorkflowBootstrapAudit;
};

/**
 * A readable plan selected for future task context. This does not mean the
 * plan was reviewed, authorized, approved, or merged.
 */
export type PlanActivatedRecord = {
  readonly kind: "plan_activated";
  readonly workflow: WorkflowBootstrapAudit;
};

export type WorkflowBootstrapRecord =
  | WorkflowStartedRecord
  | DesignRequestedRecord
  | PlanRequestedRecord
  | PlanActivatedRecord;

export type WorkflowBootstrapRecordKind = WorkflowBootstrapRecord["kind"];

export type PendingObservationRecord =
  | (PendingEnvelope & { readonly recordType: "observation" } & ToolExecutedRecord)
  | (PendingEnvelope & { readonly recordType: "observation" } & MessageRecord)
  | (PendingEnvelope & { readonly recordType: "observation" } & SkillInvokedRecord)
  | (PendingEnvelope & { readonly recordType: "observation" } & ReviewObservedRecord)
  | (PendingEnvelope & { readonly recordType: "observation" } & SessionErrorRecord)
  | (PendingEnvelope & { readonly recordType: "observation" } & ReflectionRecord)
  | (PendingEnvelope & { readonly recordType: "observation" } & WorkflowStartedRecord)
  | (PendingEnvelope & { readonly recordType: "observation" } & DesignRequestedRecord)
  | (PendingEnvelope & { readonly recordType: "observation" } & PlanRequestedRecord)
  | (PendingEnvelope & { readonly recordType: "observation" } & PlanActivatedRecord);

export type ObservationRecord = PendingObservationRecord & { readonly sequence: number };
export type PendingLogRecord = PendingObservationRecord | PendingDecisionRecord;
export type PersistedLogRecord = ObservationRecord | DecisionRecord;
