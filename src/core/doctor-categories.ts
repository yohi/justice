import type { SpCategory, ControllerAgent, ControllerPinnedCommand } from "./types";
import { PINNED_COMMAND_WORKFLOW_MAP, WORKFLOW_DESIRED_CONTROLLERS } from "./workflow-router";

export const ALL_SP_CATEGORIES: readonly SpCategory[] = [
  "sp-mechanical",
  "sp-implementation",
  "sp-integration",
  "sp-review",
  "sp-final-review",
  "sp-deep",
  "sp-architecture",
] as const;

export type SpCategoryPresenceResult = {
  readonly missing: readonly SpCategory[];
  readonly ok: boolean;
};

export function checkSpCategoryPresence(
  categoryNames: readonly string[],
): SpCategoryPresenceResult {
  const available = new Set(categoryNames);
  const missing = ALL_SP_CATEGORIES.filter((category) => !available.has(category));
  return { missing, ok: missing.length === 0 };
}

/** doctor が要求する pinned command と desired controller の期待（4件のみ・exact 一致）。 */
export type DoctorControllerCommandExpectation = {
  readonly pinnedCommand: ControllerPinnedCommand;
  readonly desiredController: ControllerAgent;
};

/**
 * controller-routing の SSOT（PINNED_COMMAND_WORKFLOW_MAP / WORKFLOW_DESIRED_CONTROLLERS）から
 * 導出される doctor の要求期待。ローカルに期待値を複製しない。
 */
export const DOCTOR_CONTROLLER_COMMAND_EXPECTATIONS: readonly DoctorControllerCommandExpectation[] =
  Array.from(PINNED_COMMAND_WORKFLOW_MAP.entries(), ([pinnedCommand, workflow]) => {
    const desiredController = WORKFLOW_DESIRED_CONTROLLERS.get(workflow);
    if (desiredController === undefined) {
      throw new Error(`No desired controller for workflow: ${workflow}`);
    }
    return { pinnedCommand, desiredController };
  });

/**
 * 4件の pinned command の修復テンプレート行（exact 4件のみ）。
 * コマンド本文・provider option・認証情報などは含まない（agent 割当のみ）。
 */
export function formatControllerRemediationLines(): readonly string[] {
  return DOCTOR_CONTROLLER_COMMAND_EXPECTATIONS.map(
    ({ pinnedCommand, desiredController }) =>
      `    "${pinnedCommand}": { "agent": "${desiredController}" }`,
  );
}
