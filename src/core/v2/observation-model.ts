// src/core/v2/observation-model.ts
import type { ObservationAgentId } from "../types";
// type-only mutual import with decision-model — safe: the cycle is erased at emit. Do NOT change to a value import.
import type { PendingDecisionRecord, DecisionRecord } from "./decision-model";

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

// Minimal Evidence stub refined into a discriminated union in Task 1.2.
export type Evidence = {
  readonly evidenceId: string;
  readonly kind: string;
  readonly sourceClass: string;
  readonly provenance: string;
  readonly toolOutputClass?: string;
  readonly command?: string;
  readonly rawOutput?: string;
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
  readonly resolutionMarkers?: readonly ResolutionMarker[];
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
