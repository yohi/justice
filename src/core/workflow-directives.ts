export type WorkflowDirectiveStage =
  | "design_required"
  | "plan_required"
  | "plan_review_required"
  | "review_remediation"
  | "review_clear"
  | "implementation"
  | "implementation_unauthorized";

export interface WorkflowDirectiveInput {
  readonly stage: WorkflowDirectiveStage;
  readonly goal?: string;
  readonly designPath?: string | null;
  readonly planPath?: string | null;
}

export function formatWorkflowDirective(input: WorkflowDirectiveInput): string {
  switch (input.stage) {
    case "design_required":
      return [
        "[JUSTICE: DESIGN REQUIRED]",
        "`brainstorming` を使い、要件、境界、テスト方針、未確定事項を設計してください。",
        "設計が承認されるまで実装コードを変更しません。",
      ].join("\n");
    case "plan_required":
      return [
        "[JUSTICE: PLAN REQUIRED]",
        "`writing-plans` を使い、設計を検証可能なタスク、依存関係、完了条件に分解してください。",
        "計画が承認されるまで実装コードを変更しません。",
      ].join("\n");
    case "plan_review_required":
      return [
        "[JUSTICE: PLAN REVIEW REQUIRED]",
        "設計・計画だけを含むPRを利用可能な連携で準備し、AIレビューを依頼してください。",
        "指摘は修正して同じレビューを再実行し、人間による明示的な承認とマージを待ってください。",
        "JusticeはPR作成、承認、マージを観測できません。確認されるまで task() を呼びません。",
      ].join("\n");
    case "review_remediation":
      return [
        "[JUSTICE: REVIEW REMEDIATION]",
        "未解決のレビュー指摘を修正し、同じレビューを再実行してください。",
        "`justice_review` の解決記録は、人間が承認した項目だけに使用してください。",
      ].join("\n");
    case "review_clear":
      return [
        "[JUSTICE: REVIEW CLEAR]",
        "レビュー指摘がない完全スナップショットを観測しました。既存の承認フローに進んでください。",
        "この結果から、PR作成、人間の承認、またはマージ済みとは推測しません。",
      ].join("\n");
    case "implementation":
      return [
        "[JUSTICE: IMPLEMENTATION]",
        "外部で承認が確認できた設計・計画に従い、変更を最小限にして検証を実行してください。",
        "Justiceは外部での承認やマージ状態を検証できません。実装は、外部で承認が確認できた場合にのみ進めてください。",
        "実装PRでは、計画との差分、テスト、退行リスクをAIレビューし、人間の承認を待ってください。",
      ].join("\n");
    case "implementation_unauthorized":
      return [
        "[JUSTICE: IMPLEMENTATION UNAUTHORIZED]",
        "この実装タスクは、まだ外部で人間による承認・マージが確認されていません。",
        "JusticeはPR作成、承認、マージを観測できないため、実行を物理的に停止することはできません。",
        "タスクを実行する前に、設計・計画PRがレビューされ、人間による明示的な承認とマージが完了していることを確認してください。",
        "確認が取れない場合は、この task() をキャンセルし、計画の承認・マージを先に進めてください。",
      ].join("\n");
    default:
      return assertNever(input.stage);
  }
}

export function assertNever(value: never): never {
  throw new Error(`Unsupported workflow directive stage: ${value}`);
}
