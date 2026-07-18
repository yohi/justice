// src/runtime/validation.ts
import type { PersistedLogRecord } from "../core/v2/observation-model";
import { shardKeyOf } from "../core/v2/shard-layout";
import { isValidSkillInvokedRecord } from "./skill-invoked-record-validator";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isOneOf(value: unknown, options: readonly string[]): boolean {
  return typeof value === "string" && options.includes(value);
}

function isValidEvidence(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (typeof value.evidenceId !== "string") return false;
  if (value.sourceClass === "tool_output") {
    if (
      !isOneOf(value.kind, ["test", "build", "lint", "command", "generic"]) ||
      !isOneOf(value.provenance, ["observed", "derived", "unknown"])
    ) {
      return false;
    }
    if (value.interpretation !== undefined && !isObject(value.interpretation)) {
      return false;
    }
    if (value.toolOutputClass === "command_exec") {
      return typeof value.command === "string" && typeof value.rawOutput === "string";
    }
    if (value.toolOutputClass === "file_content") {
      return (
        typeof value.rawOutputHash === "string" &&
        (value.command === undefined || typeof value.command === "string") &&
        (value.rawOutputSnippet === undefined || typeof value.rawOutputSnippet === "string")
      );
    }
    return false;
  }
  if (value.sourceClass === "declared_claim") {
    if (
      !isOneOf(value.kind, ["test", "build", "lint", "generic"]) ||
      value.provenance !== "declared" ||
      !isOneOf(value.declaredFrom, ["message", "task_summary"]) ||
      !isObject(value.claim) ||
      typeof value.claim.claimKind !== "string" ||
      !isOneOf(value.claim.outcome, ["pass", "fail", "unknown"])
    ) {
      return false;
    }
    if (value.claimRef !== undefined && !isObject(value.claimRef)) {
      return false;
    }
    return true;
  }
  return false;
}

function validateObservationRecord(r: Record<string, unknown>): void {
  const kind = r.kind;
  if (kind === "tool_executed") {
    const evidence = Array.isArray(r.evidence) ? r.evidence : [r.evidence];
    if (
      typeof r.toolName !== "string" ||
      typeof r.callId !== "string" ||
      evidence.length === 0 ||
      evidence.some((item) => !isValidEvidence(item))
    ) {
      throw new Error("Invalid tool_executed record");
    }
  } else if (kind === "message") {
    const declaredClaims = r.declaredClaims;
    const evidence = r.evidence;
    const mismatched =
      !Array.isArray(declaredClaims) ||
      !Array.isArray(evidence) ||
      declaredClaims.length !== evidence.length;
    if (
      typeof r.messageID !== "string" ||
      r.role !== "assistant" ||
      typeof r.textHash !== "string" ||
      typeof r.finalized !== "boolean" ||
      mismatched
    ) {
      throw new Error("Invalid message record");
    }
    const evidenceArray = evidence;
    const claimsArray = declaredClaims;
    const evidenceIterator = evidenceArray.values();
    for (const claim of claimsArray) {
      const nextEvidence = evidenceIterator.next();
      if (nextEvidence.done) {
        throw new Error("Invalid message record");
      }
      const currentEvidence = nextEvidence.value;
      if (
        !isObject(claim) ||
        typeof claim.evidenceId !== "string" ||
        !isOneOf(claim.claimKind, ["test", "build", "lint", "generic"]) ||
        !isOneOf(claim.outcome, ["pass", "fail", "unknown"]) ||
        !isObject(currentEvidence) ||
        !isValidEvidence(currentEvidence) ||
        (currentEvidence as { sourceClass?: unknown }).sourceClass !== "declared_claim" ||
        (currentEvidence as { declaredFrom?: unknown }).declaredFrom !== "message" ||
        (currentEvidence as { evidenceId?: unknown }).evidenceId !== claim.evidenceId
      ) {
        throw new Error("Invalid message record");
      }
    }
  } else if (kind === "skill_invoked") {
    if (!isValidSkillInvokedRecord(r)) throw new Error("Invalid skill_invoked record");
  } else if (kind === "review_observed") {
    if (
      typeof r.reviewScope !== "string" ||
      !Array.isArray(r.items) ||
      (r.isCompleteSnapshot !== undefined && typeof r.isCompleteSnapshot !== "boolean")
    ) {
      throw new TypeError("Invalid review_observed record");
    }
    for (const item of r.items) {
      if (
        !isObject(item) ||
        typeof item.itemKey !== "string" ||
        typeof item.evidenceId !== "string" ||
        typeof item.summary !== "string" ||
        typeof item.location !== "string" ||
        !isOneOf(item.severity, ["critical", "major", "minor"]) ||
        !isOneOf(item.status, ["open", "resolved"])
      ) {
        throw new Error("Invalid review_observed item");
      }
    }
    if (r.resolutionMarkers !== undefined) {
      if (!Array.isArray(r.resolutionMarkers)) {
        throw new Error("Invalid review_observed resolution marker");
      }
      for (const marker of r.resolutionMarkers) {
        if (
          !isObject(marker) ||
          typeof marker.itemKey !== "string" ||
          !isOneOf(marker.resolution, ["explicit_marker", "snapshot_absence", "human_artifact"]) ||
          (marker.artifactRef !== undefined && typeof marker.artifactRef !== "string")
        ) {
          throw new Error("Invalid review_observed resolution marker");
        }
      }
    }
  } else if (kind === "session_error") {
    if (typeof r.errorKind !== "string" || typeof r.message !== "string") {
      throw new TypeError("Invalid session_error record");
    }
  } else if (kind === "reflection") {
    if (
      !isObject(r.reflection) ||
      !isOneOf(r.reflection.trigger, ["task_succeeded", "task_error"]) ||
      !isObject(r.reflection.planRef) ||
      typeof r.reflection.planRef.path !== "string" ||
      r.reflection.planRef.path.length === 0 ||
      r.reflection.planRef.path.startsWith("/") ||
      r.reflection.planRef.path.startsWith("\\") ||
      /^[A-Za-z]:/u.test(r.reflection.planRef.path) ||
      r.reflection.planRef.path.split(/[\\/]/u).some((seg) => seg === "..") ||
      typeof r.reflection.planRef.taskId !== "string" ||
      !isOneOf(r.reflection.intent, ["check_complete", "append_error_note"]) ||
      (r.reflection.note !== undefined && typeof r.reflection.note !== "string")
    ) {
      throw new Error("Invalid reflection record");
    }
  } else {
    throw new Error(`Invalid record: unknown observation kind: ${String(kind)}`);
  }
}

function validateDecisionRecord(r: Record<string, unknown>): void {
  if (
    r.gateType !== "task" ||
    !isOneOf(r.verdict, ["PASS", "WARN", "FAIL"]) ||
    r.reachableEnforcementLevel !== "L1" ||
    r.appliedEnforcementLevel !== "L0" ||
    !Array.isArray(r.ruleResults)
  ) {
    throw new Error("Invalid decision record");
  }
  for (const ruleResult of r.ruleResults) {
    if (
      !isObject(ruleResult) ||
      typeof ruleResult.ruleId !== "string" ||
      !isOneOf(ruleResult.verdict, ["PASS", "WARN", "FAIL"]) ||
      (ruleResult.reason !== undefined && typeof ruleResult.reason !== "string") ||
      !Array.isArray(ruleResult.evidenceRefs)
    ) {
      throw new Error("Invalid decision ruleResult");
    }
    for (const ref of ruleResult.evidenceRefs) {
      if (
        !isObject(ref) ||
        ref.kind !== "full" ||
        typeof ref.agentId !== "string" ||
        typeof ref.sessionId !== "string" ||
        typeof ref.writerId !== "string" ||
        typeof ref.sequence !== "number" ||
        !Number.isFinite(ref.sequence) ||
        ref.sequence < 0 ||
        typeof ref.evidenceId !== "string"
      ) {
        throw new Error("Invalid decision evidenceRef");
      }
    }
  }
}

/**
 * Validates a single parsed log record against the v2 schema (schemaVersion 1).
 * Accepts `unknown` (untrusted parsed JSON) and narrows defensively; throws on
 * any structural violation so callers can fail-open per file/line.
 */
export function validateRecordSchema(record: unknown): void {
  if (!isObject(record)) {
    throw new Error("Invalid record: not an object");
  }
  const r = record;
  if (r.schemaVersion !== 1) {
    throw new Error(`Invalid record: unsupported schemaVersion ${String(r.schemaVersion)}`);
  }
  if (typeof r.sequence !== "number" || !Number.isFinite(r.sequence) || r.sequence < 0) {
    throw new Error("Invalid record: sequence must be a non-negative number");
  }
  if (!r.timestamp || typeof r.timestamp !== "string") {
    throw new Error("Invalid record: timestamp must be a string");
  }
  if (
    typeof r.agentId !== "string" ||
    typeof r.sessionId !== "string" ||
    typeof r.writerId !== "string"
  ) {
    throw new TypeError("Invalid record: missing or invalid shard identifier fields");
  }

  if (r.recordType === "observation") {
    validateObservationRecord(r);
  } else if (r.recordType === "decision") {
    validateDecisionRecord(r);
  } else {
    throw new Error(`Invalid record: unknown recordType: ${String(r.recordType)}`);
  }
}

/**
 * Validates sequence order as records physically appear in one JSONL file.
 * Equal values remain the responsibility of the merged duplicate check; this
 * axis detects only a descending transition before traversal order is lost.
 */
export function validatePhysicalFileSequenceOrder(records: readonly PersistedLogRecord[]): void {
  let previousSequence: number | undefined;
  for (const record of records) {
    if (previousSequence !== undefined && record.sequence < previousSequence) {
      throw new Error(
        `Physical sequence order violation: sequence ${record.sequence} follows ${previousSequence}`,
      );
    }
    previousSequence = record.sequence;
  }
}

/**
 * Validates per-shard sequence integrity across a merged record set. Duplicate
 * sequence numbers within a shard indicate corruption. A gap (missing sequence)
 * indicates lost records (e.g. an archive segment that failed to be recovered).
 * Sequences are sorted to normalize traversal-order variations from the readAll
 * merge (D72) before the duplicate/gap checks.
 */
export function validateShardSequences(records: readonly PersistedLogRecord[]): void {
  const shardGroups = new Map<string, number[]>();
  for (const r of records) {
    const shardKey = shardKeyOf(r);
    const group = shardGroups.get(shardKey);
    if (group) {
      group.push(r.sequence);
    } else {
      shardGroups.set(shardKey, [r.sequence]);
    }
  }
  for (const [shardKey, seqs] of shardGroups.entries()) {
    seqs.sort((a, b) => a - b);
    const uniqueSeqs = new Set(seqs);
    if (uniqueSeqs.size !== seqs.length) {
      throw new Error(`Sequence integrity violation on ${shardKey}: duplicate sequence detected`);
    }
    // Gap check: with duplicates already ruled out above, a strictly increasing
    // sequence whose first element is not 1 or whose consecutive elements differ
    // by more than 1 has a missing sequence number (lost record). Detected here
    // rather than recovered — `readAll` logs and continues fail-open.
    if (seqs.length > 0 && seqs[0] !== 1) {
      throw new Error(
        `Sequence integrity violation on ${shardKey}: gap detected (missing sequence before ${seqs[0]})`,
      );
    }
    let prevSeq: number | undefined;
    for (const seq of seqs) {
      if (prevSeq !== undefined && seq - prevSeq > 1) {
        throw new Error(
          `Sequence integrity violation on ${shardKey}: gap detected (missing sequence between ${prevSeq} and ${seq})`,
        );
      }
      prevSeq = seq;
    }
  }
}
