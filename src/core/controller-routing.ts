// src/core/controller-routing.ts
//
// Controller configuration assurance の純粋な評価ロジック (Task 4.1CA / Design §4.1)。
// runtime state・session/message/event identity・terminal envelope・persistence には一切依存しない。
// 入力は effectiveConfigAvailable と正規化済み DoctorEffectiveCommandDefinition のみであり、
// DoctorCommandDefinitionDiagnostic やローカルスキャン結果は消費しない。

import type { DoctorEffectiveCommandDefinition } from "./doctor-config";
import type {
  ControllerAgent,
  ControllerPinnedCommand,
  ControllerRoutingDecision,
  ControllerWorkflow,
} from "./types";
import { PINNED_COMMAND_WORKFLOW_MAP, WORKFLOW_DESIRED_CONTROLLERS } from "./workflow-router";

/** exact four-command expectation を controller configuration domain から利用できるように再エクスポートする。 */
export { PINNED_COMMAND_WORKFLOW_MAP, resolvePinnedCommandWorkflow } from "./workflow-router";

export type ControllerConfigurationStatus =
  | "configured"
  | "missing"
  | "misconfigured"
  | "unsupported";

/**
 * 評価結果の理由。列挙値のみで構成され、生の設定値（コマンド本文や agent 以外の値）を含まない。
 * `agent_invalid` は「agent が desired controller と exact 一致しない」全てのケース
 * （未認識の custom agent / 認識済みだが不一致な agent の双方）を表す。
 */
export type ControllerConfigurationReason =
  | "command_missing"
  | "invalid_command_definition"
  | "agent_missing"
  | "agent_invalid"
  | "effective_config_unsupported";

/**
 * pinned command の設定状態評価。`configured` は runtime applied の別名ではなく、
 * routingStatus・executionOutcome・actual controller・terminal envelope・
 * session/message/event identity を一切含まない。
 */
export type ControllerConfigurationAssessment = {
  readonly workflow: ControllerWorkflow;
  readonly desiredController: ControllerAgent;
  readonly pinnedCommand: ControllerPinnedCommand;
  readonly configuredController?: string;
  readonly status: ControllerConfigurationStatus;
  readonly reason?: ControllerConfigurationReason;
};

/** 評価への入力。設定状態の識別に必要な純粋ドメイン値のみで構成される。 */
export type ControllerConfigurationAssessmentInput = {
  readonly decision: ControllerRoutingDecision;
  readonly pinnedCommand: ControllerPinnedCommand;
  readonly effectiveDefinition?: DoctorEffectiveCommandDefinition;
  readonly effectiveConfigAvailable: boolean;
};

/**
 * pinned command の controller 設定を評価する純粋関数。
 *
 * 評価順序は固定:
 *   1. effectiveConfigAvailable === false -> unsupported
 *   2. 定義なし                           -> missing
 *   3. kind === "invalid"                 -> misconfigured / invalid_command_definition
 *   4. kind === "valid" かつ agent なし    -> misconfigured / agent_missing
 *   5. agent が desired controller と不一致 -> misconfigured / agent_invalid
 *   6. agent が exact 一致                 -> configured
 *
 * agent の比較は exact equality のみ（trim / 大小文字の正規化 / エイリアスは不採用）。
 */
export function assessControllerConfiguration(
  input: ControllerConfigurationAssessmentInput,
): ControllerConfigurationAssessment {
  const { decision, pinnedCommand, effectiveDefinition, effectiveConfigAvailable } = input;

  const expectedWorkflow = PINNED_COMMAND_WORKFLOW_MAP.get(pinnedCommand);
  if (expectedWorkflow !== decision.workflow) {
    throw new Error(
      `Pinned command ${pinnedCommand} does not correspond to controller workflow ${decision.workflow}`,
    );
  }

  const desiredController = WORKFLOW_DESIRED_CONTROLLERS.get(decision.workflow);
  if (desiredController === undefined || desiredController !== decision.controller) {
    throw new Error(
      `Controller routing decision does not carry the desired controller for workflow ${decision.workflow}`,
    );
  }

  if (!effectiveConfigAvailable) {
    return {
      workflow: decision.workflow,
      desiredController,
      pinnedCommand,
      status: "unsupported",
      reason: "effective_config_unsupported",
    };
  }

  if (effectiveDefinition === undefined) {
    return {
      workflow: decision.workflow,
      desiredController,
      pinnedCommand,
      status: "missing",
      reason: "command_missing",
    };
  }

  if (effectiveDefinition.kind === "invalid") {
    return {
      workflow: decision.workflow,
      desiredController,
      pinnedCommand,
      status: "misconfigured",
      reason: "invalid_command_definition",
    };
  }

  const configuredAgent = effectiveDefinition.agent;
  if (configuredAgent === undefined) {
    return {
      workflow: decision.workflow,
      desiredController,
      pinnedCommand,
      status: "misconfigured",
      reason: "agent_missing",
    };
  }

  if (configuredAgent !== desiredController) {
    return {
      workflow: decision.workflow,
      desiredController,
      pinnedCommand,
      configuredController: configuredAgent,
      status: "misconfigured",
      reason: "agent_invalid",
    };
  }

  return {
    workflow: decision.workflow,
    desiredController,
    pinnedCommand,
    configuredController: configuredAgent,
    status: "configured",
  };
}
