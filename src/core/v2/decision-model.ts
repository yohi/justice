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

/** F-003: new Task Gate decisions carry the proven Task Review round. */
export type TaskGateDecisionPayload = GateDecisionFields & {
  readonly recordType: "decision";
  readonly gateType: "task";
  readonly taskId: string;
  readonly taskExecutionRef: TaskExecutionRef;
  readonly reviewRound: number;
};

/**
 * Read-only compatibility shape for pre-F-003 Task Gate decisions that carry a
 * TaskExecutionRef but no review round. Never a current-round GateDecision.
 */
export type HistoricalTaskGateDecisionPayload = GateDecisionFields & {
  readonly recordType: "decision";
  readonly gateType: "task";
  readonly taskId: string;
  readonly taskExecutionRef: TaskExecutionRef;
  readonly reviewRound?: undefined;
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

type TaskAcceptanceVerdict = "accepted" | "rework-required" | "blocked";

/** F-003: new Task Acceptance decisions carry the proven Task Review round. */
export type TaskAcceptanceDecisionPayload = {
  readonly recordType: "decision";
  readonly kind: "task-acceptance";
  readonly taskId: string;
  readonly taskExecutionRef: TaskExecutionRef;
  readonly reviewRound: number;
  readonly verdict: TaskAcceptanceVerdict;
};

/** Read-only compatibility shape for pre-F-003 roundless Task Acceptance decisions. */
export type HistoricalTaskAcceptanceDecisionPayload = {
  readonly recordType: "decision";
  readonly kind: "task-acceptance";
  readonly taskId: string;
  readonly taskExecutionRef: TaskExecutionRef;
  readonly reviewRound?: undefined;
  readonly verdict: TaskAcceptanceVerdict;
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
  | HistoricalTaskGateDecisionPayload
  | HistoricalTaskAcceptanceDecisionPayload
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
export type HistoricalTaskGateDecision = PersistedEnvelope & HistoricalTaskGateDecisionPayload;
export type HistoricalTaskAcceptanceDecision = PersistedEnvelope &
  HistoricalTaskAcceptanceDecisionPayload;
export type PlanGateDecision = PersistedEnvelope & PlanGateDecisionPayload;
export type TaskAcceptanceDecision = PersistedEnvelope & TaskAcceptanceDecisionPayload;
export type PlanAcceptanceDecision = PersistedEnvelope & PlanAcceptanceDecisionPayload;
/** Current-round decisions only; historical/legacy shapes are excluded from lookup. */
export type GateDecision = TaskGateDecision | PlanGateDecision;
export type AcceptanceDecision = TaskAcceptanceDecision | PlanAcceptanceDecision;
