import type {
  Evidence,
  PendingEnvelope,
  PendingObservationRecord,
  ToolOutputEvidence,
} from "./observation-model";
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
    | "role"
    | "textHash"
    | "textSnippet"
    | "declaredClaims"
    | "evidence"
    | "finalized"
  >;
  readonly messageID: string;
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
