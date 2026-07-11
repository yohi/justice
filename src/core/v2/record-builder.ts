import type { PendingObservationRecord } from "./observation-model";
import type { DeclaredClaim } from "./declared-claim-extractor";
import { hashString } from "./hash";
import { redactMessageSnippet, sliceCodeUnitsSafe } from "./redaction";

export type MessageRecordInput = {
  readonly envelope: Omit<PendingObservationRecord, "kind" | "messageID" | "role" | "textHash" | "textSnippet" | "declaredClaims" | "evidence" | "finalized">;
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
