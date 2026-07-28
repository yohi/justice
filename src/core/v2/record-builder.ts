import type {
  Evidence,
  PendingEnvelope,
  PendingObservationRecord,
  ResolutionMarker,
  ReviewItem,
  ToolOutputEvidence,
  WorkflowBootstrapAudit,
  WorkflowBootstrapRecordKind,
} from "./observation-model";
import type { WorkflowBootstrapPhase, WorkflowStartRequest } from "../types";
import type { DeclaredClaim } from "./declared-claim-extractor";
import type { DetectedSkillInvocation } from "./skill-invoked-detector";
import { hashString } from "./hash";
import { extractEvidenceFromTool } from "./evidence-engine";
import {
  redactAbsolutePaths,
  redactForPersistence,
  redactMessageSnippet,
  sliceCodeUnitsSafe,
} from "./redaction";

export type MessageRecordInput = {
  readonly envelope: Omit<
    PendingObservationRecord,
    | "kind"
    | "messageID"
    | "partID"
    | "role"
    | "textHash"
    | "textSnippet"
    | "declaredClaims"
    | "evidence"
    | "finalized"
  >;
  readonly messageID: string;
  readonly partID?: string;
  readonly text: string;
  readonly claims: readonly DeclaredClaim[];
};

export function buildMessageRecord(input: MessageRecordInput): PendingObservationRecord {
  const evidence = input.claims.map((claim) => ({
    evidenceId: claim.evidenceId,
    kind: claim.claimKind,
    sourceClass: "declared_claim" as const,
    provenance: "declared" as const,
    declaredFrom: "message" as const,
    claim: { claimKind: claim.claimKind, outcome: claim.outcome },
  }));

  return {
    ...input.envelope,
    kind: "message",
    messageID: input.messageID,
    ...(input.partID === undefined ? {} : { partID: input.partID }),
    role: "assistant",
    textHash: hashString(input.text),
    textSnippet: sliceCodeUnitsSafe(redactMessageSnippet(input.text), 200),
    declaredClaims: input.claims,
    evidence,
    finalized: true,
  };
}

export type SessionErrorRecordInput = {
  readonly envelope: PendingEnvelope;
  readonly errorKind?: string;
  readonly message: string;
};

export function buildSessionErrorRecord(input: SessionErrorRecordInput): PendingObservationRecord {
  return {
    ...input.envelope,
    recordType: "observation",
    kind: "session_error",
    errorKind: input.errorKind ?? "unknown",
    message: redactForPersistence(redactAbsolutePaths(input.message)),
  };
}

export type ToolExecutedRecordInput = {
  readonly envelope: PendingEnvelope;
  readonly toolName: string;
  readonly toolInput: unknown;
  readonly toolOutput: {
    readonly output?: string;
    readonly metadata?: { readonly error?: boolean };
  };
  readonly callId: string;
  readonly summaryClaims?: readonly DeclaredClaim[];
};

export type BuiltToolExecutedRecord = PendingEnvelope & {
  readonly recordType: "observation";
  readonly kind: "tool_executed";
  readonly toolName: string;
  readonly callId: string;
  readonly evidence: readonly Evidence[];
};

export type SkillInvokedRecordInput = {
  readonly envelope: PendingEnvelope;
  readonly invocation: DetectedSkillInvocation;
};

export function buildSkillInvokedRecord(input: SkillInvokedRecordInput): PendingObservationRecord {
  return {
    ...input.envelope,
    recordType: "observation",
    kind: "skill_invoked",
    skillName: input.invocation.skillName,
    source: input.invocation.source,
    ...(input.invocation.callId === undefined ? {} : { callId: input.invocation.callId }),
  };
}

export function buildReviewObservedRecord(
  envelope: PendingEnvelope,
  reviewScope: string,
  items: readonly ReviewItem[],
  isCompleteSnapshot = false,
): PendingObservationRecord {
  const redactedItems = items.map((item) => ({
    ...item,
    summary: redactForPersistence(redactAbsolutePaths(item.summary)),
    location: redactForPersistence(redactAbsolutePaths(item.location)),
  }));
  return {
    ...envelope,
    recordType: "observation",
    kind: "review_observed",
    reviewScope,
    isCompleteSnapshot,
    items: redactedItems,
  };
}

export function buildReviewResolutionRecord(
  envelope: PendingEnvelope,
  reviewScope: string,
  itemKeys: readonly string[],
  artifactRef: string,
): PendingObservationRecord {
  const redactedArtifactRef = redactForPersistence(redactAbsolutePaths(artifactRef));
  const resolutionMarkers: readonly ResolutionMarker[] = itemKeys.map((itemKey) => ({
    itemKey,
    resolution: "human_artifact",
    artifactRef: redactedArtifactRef,
  }));
  return {
    ...envelope,
    recordType: "observation",
    kind: "review_observed",
    reviewScope,
    items: [],
    resolutionMarkers,
  };
}

/**
 * Phase → lifecycle record kind. The phase is the single source of truth at the
 * call site, so a transition can never be logged under a mismatching kind. An
 * out-of-contract phase throws so the caller's fail-open boundary degrades
 * instead of persisting a record with an unknown kind.
 */
function phaseRecordKind(phase: WorkflowBootstrapPhase): WorkflowBootstrapRecordKind {
  switch (phase) {
    case "design_required":
      return "design_requested";
    case "plan_required":
      return "plan_requested";
    case "plan_ready":
      return "plan_activated";
    default:
      throw new TypeError(`Unknown workflow bootstrap phase: ${String(phase)}`);
  }
}

export type WorkflowBootstrapRecordInput = {
  readonly envelope: PendingEnvelope;
  readonly request: WorkflowStartRequest;
  readonly phase: WorkflowBootstrapPhase;
};

function buildWorkflowBootstrapAudit(input: WorkflowBootstrapRecordInput): WorkflowBootstrapAudit {
  const { request } = input;
  return {
    phase: input.phase,
    source: request.source,
    goalHash: hashString(request.goal),
    goalSnippet: sliceCodeUnitsSafe(redactMessageSnippet(request.goal), 200),
    ...(request.designPath === null
      ? {}
      : { designPath: redactForPersistence(redactAbsolutePaths(request.designPath)) }),
    ...(request.planPath === null
      ? {}
      : { planPath: redactForPersistence(redactAbsolutePaths(request.planPath)) }),
  };
}

/**
 * `workflow_started`: the bootstrap request itself, recorded with the phase it
 * resolved to. Audit-only — carries no Evidence, so it is invisible to Gate
 * evaluation (FF-008).
 */
export function buildWorkflowStartedRecord(
  input: WorkflowBootstrapRecordInput,
): PendingObservationRecord {
  return {
    ...input.envelope,
    recordType: "observation",
    kind: "workflow_started",
    workflow: buildWorkflowBootstrapAudit(input),
  };
}

/**
 * The lifecycle transition matching `input.phase`: `design_requested`,
 * `plan_requested`, or `plan_activated`. Audit-only, like `workflow_started`.
 */
export function buildWorkflowPhaseRecord(
  input: WorkflowBootstrapRecordInput,
): PendingObservationRecord {
  return {
    ...input.envelope,
    recordType: "observation",
    kind: phaseRecordKind(input.phase),
    workflow: buildWorkflowBootstrapAudit(input),
  };
}

function extractCommandArgs(toolInput: unknown): { readonly command?: string } | undefined {
  if (typeof toolInput !== "object" || toolInput === null || !("command" in toolInput)) {
    return undefined;
  }
  return typeof toolInput.command === "string" ? { command: toolInput.command } : undefined;
}

function redactToolEvidence(evidence: ToolOutputEvidence): ToolOutputEvidence {
  if (evidence.toolOutputClass === "command_exec") {
    return {
      ...evidence,
      command: redactForPersistence(redactAbsolutePaths(evidence.command)),
      // rawOutput is already redacted by extractEvidenceFromTool
    };
  }
  return {
    ...evidence,
    ...(evidence.command === undefined
      ? {}
      : { command: redactForPersistence(redactAbsolutePaths(evidence.command)) }),
    // rawOutputSnippet is already redacted by extractEvidenceFromTool
  };
}

export function buildToolExecutedRecord(input: ToolExecutedRecordInput): BuiltToolExecutedRecord {
  const observed = redactToolEvidence(
    extractEvidenceFromTool(
      input.toolName,
      extractCommandArgs(input.toolInput),
      input.toolOutput,
      input.callId,
    ),
  );
  const declared: readonly Evidence[] = (input.summaryClaims ?? []).map((claim) => ({
    evidenceId: claim.evidenceId,
    kind: claim.claimKind,
    sourceClass: "declared_claim",
    provenance: "declared",
    declaredFrom: "task_summary",
    claim: { claimKind: claim.claimKind, outcome: claim.outcome },
  }));

  return {
    ...input.envelope,
    recordType: "observation",
    kind: "tool_executed",
    toolName: input.toolName,
    callId: input.callId,
    evidence: [observed, ...declared],
  };
}
