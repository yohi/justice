// src/core/v2/decision-model.ts
import type { PendingEnvelope, PersistedEnvelope } from "./observation-model";
import type { EvidenceRef, TaskExecutionRef } from "../types";
type FinalizationAttemptId = string;

/**
 * Task-gate verdict literals. Single source of truth so projection can narrow
 * `ProjectedTask.status`/`lastVerdict` to these exact values (plus sentinels).
 */
export type Verdict = "PASS" | "WARN" | "FAIL";

export type RuleResult = {
  readonly ruleId: string;
  readonly verdict: Verdict;
  readonly reason: string;
  readonly evidenceRefs: readonly EvidenceRef[];
};

type GateDecisionFields = {
  readonly verdict: Verdict;
  readonly reachableEnforcementLevel: "L1";
  readonly appliedEnforcementLevel: "L0";
  readonly ruleResults: readonly RuleResult[];
};

export type TaskGateDecisionPayload = GateDecisionFields & {
  readonly recordType: "decision";
  readonly gateType: "task";
  readonly taskId: string;
  readonly taskExecutionRef: TaskExecutionRef;
};

export type LegacyTaskGateDecisionPayload = GateDecisionFields & {
  readonly recordType: "decision";
  readonly gateType: "task";
  readonly taskId: string;
  readonly taskExecutionRef?: undefined;
};

export type PlanGateDecisionPayload = GateDecisionFields & {
  readonly recordType: "decision";
  readonly gateType: "plan";
  readonly authorizationId: string;
  readonly planPath: string;
  readonly planPathDigest?: string;
  readonly finalizationAttemptId: FinalizationAttemptId;
  readonly finalReviewRound: number;
};

export type TaskAcceptanceDecisionPayload = {
  readonly recordType: "decision";
  readonly kind: "task-acceptance";
  readonly taskId: string;
  readonly taskExecutionRef: TaskExecutionRef;
  readonly verdict: "accepted" | "rework-required" | "blocked";
};

export type PlanAcceptanceDecisionPayload = {
  readonly recordType: "decision";
  readonly kind: "plan-acceptance";
  readonly authorizationId: string;
  readonly planPath: string;
  readonly planPathDigest?: string;
  readonly finalizationAttemptId: FinalizationAttemptId;
  readonly finalReviewRound: number;
  readonly verdict: "complete" | "rework-required" | "blocked";
};

export type DecisionPayload =
  | LegacyTaskGateDecisionPayload
  | TaskGateDecisionPayload
  | PlanGateDecisionPayload
  | TaskAcceptanceDecisionPayload
  | PlanAcceptanceDecisionPayload;
export type GateDecisionPayload = TaskGateDecisionPayload | PlanGateDecisionPayload;
export type AcceptanceDecisionPayload =
  | TaskAcceptanceDecisionPayload
  | PlanAcceptanceDecisionPayload;
export type PendingDecisionRecord = PendingEnvelope & DecisionPayload;
export type DecisionRecord = PersistedEnvelope & DecisionPayload;
export type TaskGateDecision = PersistedEnvelope & TaskGateDecisionPayload;
export type LegacyTaskGateDecision = PersistedEnvelope & LegacyTaskGateDecisionPayload;
export type PlanGateDecision = PersistedEnvelope & PlanGateDecisionPayload;
export type TaskAcceptanceDecision = PersistedEnvelope & TaskAcceptanceDecisionPayload;
export type PlanAcceptanceDecision = PersistedEnvelope & PlanAcceptanceDecisionPayload;
export type GateDecision = TaskGateDecision | PlanGateDecision;
export type AcceptanceDecision = TaskAcceptanceDecision | PlanAcceptanceDecision;
