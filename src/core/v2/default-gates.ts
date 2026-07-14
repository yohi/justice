import type { GateRule } from "./gate-definition";

/**
 * Justice v2 の組み込みデフォルト gate 群。
 *
 * `.justice/gate.yaml` が存在しない場合、または解析に失敗した場合の
 * フォールバックとして使用される。いずれも `onViolation` / `onMissingEvidence`
 * は `warn` に設定されており、初期状態では助言的（advisory）に振る舞う。
 */
export const DEFAULT_GATES: readonly GateRule[] = [
  {
    id: "required-tests",
    description: "タスク完了前にテストが pass していること",
    gateType: "task",
    trigger: { on: "task_complete" },
    check: { type: "evidence_outcome", evidenceKind: "test", requireOutcome: "pass" },
    onViolation: "warn",
    onMissingEvidence: "warn",
    enabled: true,
  },
  {
    id: "build-green",
    description: "タスク完了前にビルドが pass していること",
    gateType: "task",
    trigger: { on: "task_complete" },
    check: { type: "evidence_outcome", evidenceKind: "build", requireOutcome: "pass" },
    onViolation: "warn",
    onMissingEvidence: "warn",
    enabled: true,
  },
  {
    id: "review-clean",
    description: "未解決レビュー指摘（minimumSeverity 以上）が無いこと",
    gateType: "task",
    trigger: { on: "task_complete" },
    check: { type: "review_open_items", minimumSeverity: "major" },
    onViolation: "warn",
    onMissingEvidence: "warn",
    enabled: true,
  },
];
