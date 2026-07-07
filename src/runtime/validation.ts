// src/runtime/validation.ts
import type { PersistedLogRecord } from "../core/v2/observation-model";

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
    if (
      typeof r.toolName !== "string" ||
      typeof r.callId !== "string" ||
      !isValidEvidence(r.evidence)
    ) {
      throw new Error("Invalid tool_executed record");
    }
  } else if (kind === "message") {
    if (
      typeof r.role !== "string" ||
      typeof r.textHash !== "string" ||
      (r.declaredClaims !== undefined && !Array.isArray(r.declaredClaims))
    ) {
      throw new Error("Invalid message record");
    }
  } else if (kind === "skill_invoked") {
    // SkillInvokedRecord is currently a stub (only `kind`, refined in Task 4.3).
    // No additional fields exist on the type yet, so none are validated here —
    // update this branch in lockstep when the type is finalized.
  } else if (kind === "review_observed") {
    if (typeof r.reviewScope !== "string" || !Array.isArray(r.items)) {
      throw new Error("Invalid review_observed record");
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
  } else if (kind === "session_error") {
    // SessionErrorRecord is currently a stub (only `kind`, refined in Task 4.4).
    // No additional fields exist on the type yet, so none are validated here —
    // update this branch in lockstep when the type is finalized.
  } else if (kind === "reflection") {
    // ReflectionRecord is currently a stub (only `kind`, refined in Task 4.4).
    // No additional fields exist on the type yet, so none are validated here —
    // update this branch in lockstep when the type is finalized.
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
    throw new Error("Invalid record: missing or invalid shard identifier fields");
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
 * Validates per-shard sequence integrity across a merged record set. Duplicate
 * sequence numbers within a shard indicate corruption. Sequences are sorted to
 * normalize traversal-order variations from the readAll merge (D72) before the
 * duplicate check; a monotonicity guard remains as a defensive post-condition.
 */
export function validateShardSequences(records: readonly PersistedLogRecord[]): void {
  const shardGroups = new Map<string, number[]>();
  for (const r of records) {
    const shardKey = JSON.stringify([r.agentId, r.sessionId, r.writerId]);
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
    // NOTE: `seqs` is sorted ascending above, and the duplicate check just passed,
    // so this array is strictly increasing by construction — the `seq < prev`
    // branch below can never trigger today. It is kept as a defensive
    // post-condition in case a future refactor changes how `seqs` is populated
    // before this point (e.g. removing the sort or reordering the dedup check).
    let prev: number | undefined;
    for (const seq of seqs) {
      if (prev !== undefined && seq < prev) {
        throw new Error(
          `Sequence integrity violation on ${shardKey}: sequence inversion detected (non-monotonic)`,
        );
      }
      prev = seq;
    }
  }
}
