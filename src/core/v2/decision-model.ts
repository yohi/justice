// src/core/v2/decision-model.ts
import type { PendingEnvelope, PersistedEnvelope } from "./observation-model";
import type { FullEvidenceRef } from "../types";

/**
 * Task-gate verdict literals. Single source of truth so projection can narrow
 * `ProjectedTask.status`/`lastVerdict` to these exact values (plus sentinels).
 */
export type Verdict = "PASS" | "WARN" | "FAIL";

export type RuleResult = {
  readonly ruleId: string;
  readonly verdict: Verdict;
  readonly reason: string;
  readonly evidenceRefs: readonly FullEvidenceRef[];
};

export type DecisionPayload = {
  readonly recordType: "decision";
  readonly gateType: "task";
  readonly verdict: Verdict;
  // Intentional single-literal invariant (INV-007, design §7.2): the v2.0 task gate is always
  // L0-applied / L1-reachable. Deliberately NOT a union — projection validation asserts these
  // exact values; widen to "L0" | "L1" | "L2" only when L2/L3 enforcement actually lands.
  readonly reachableEnforcementLevel: "L1";
  readonly appliedEnforcementLevel: "L0";
  readonly ruleResults: readonly RuleResult[];
};

export type PendingDecisionRecord = PendingEnvelope & DecisionPayload;
export type DecisionRecord = PersistedEnvelope & DecisionPayload;
