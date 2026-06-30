// src/core/v2/decision-model.ts
import type { PendingEnvelope, PersistedEnvelope } from "./observation-model";
import type { FullEvidenceRef } from "../types";

export type RuleResult = {
  readonly ruleId: string;
  readonly verdict: "PASS" | "WARN" | "FAIL";
  readonly reason?: string;
  readonly evidenceRefs: readonly FullEvidenceRef[];
};

export type DecisionPayload = {
  readonly recordType: "decision";
  readonly gateType: "task";
  readonly verdict: "PASS" | "WARN" | "FAIL";
  readonly reachableEnforcementLevel: "L1";
  readonly appliedEnforcementLevel: "L0";
  readonly ruleResults: readonly RuleResult[];
};

export type PendingDecisionRecord = PendingEnvelope & DecisionPayload;
export type DecisionRecord = PersistedEnvelope & DecisionPayload;
