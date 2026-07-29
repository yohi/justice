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

export type CanonicalWorkflowSkill =
  | "brainstorming"
  | "writing-plans"
  | "test-driven-development"
  | "verification-before-completion"
  | "requesting-code-review"
  | "receiving-code-review";

export type WorkflowNextAction =
  | "invoke_skill"
  | "request_review"
  | "await_human_approval"
  | "delegate_task";

export type WorkflowAuthority = "artifact_ready" | "external_unverified";

export interface WorkflowDirective {
  readonly stage: WorkflowDirectiveStage;
  readonly marker: string;
  readonly requiredSkills: readonly CanonicalWorkflowSkill[];
  readonly nextAction: WorkflowNextAction;
  readonly authority: WorkflowAuthority;
  readonly guidance: string;
}

const GUIDANCE = {
  design_required:
    "`brainstorming` を使い、要件、境界、テスト方針、未確定事項を設計してください。\n設計が承認されるまで実装コードを変更しません。",
  plan_required:
    "`writing-plans` を使い、設計を検証可能なタスク、依存関係、完了条件に分解してください。\n計画が承認されるまで実装コードを変更しません。",
  plan_review_required:
    "設計・計画だけを含むPRを利用可能な連携で準備し、AIレビューを依頼してください。\n指摘は修正して同じレビューを再実行し、人間による明示的な承認とマージを待ってください。\nJusticeはPR作成、承認、マージを観測できません。確認されるまで task() を呼びません。",
  review_remediation:
    "未解決のレビュー指摘を修正し、同じレビューを再実行してください。\n`justice_review` の解決記録は、人間が承認した項目だけに使用してください。",
  review_clear:
    "レビュー指摘がない完全スナップショットを観測しました。既存の承認フローに進んでください。\nこの結果から、PR作成、人間の承認、またはマージ済みとは推測しません。",
  implementation:
    "実装対象の設計・計画を確認し、変更を最小限にして検証を実行してください。\nJusticeは外部での承認やマージ状態を検証できません。実行は、外部の人間による承認・マージ完了の確認後にのみ継続してください。\n実装PRでは、計画との差分、テスト、退行リスクをAIレビューし、人間の承認を待ってください。",
  implementation_unauthorized:
    "この実装タスクは、まだ外部で人間による承認・マージが確認されていません。\nJusticeはPR作成、承認、マージを観測できないため、実行を物理的に停止することはできません。\nタスクを実行する前に、設計・計画PRがレビューされ、人間による明示的な承認とマージが完了していることを確認してください。\n確認が取れない場合は、この task() をキャンセルし、計画の承認・マージを先に進めてください。",
} as const satisfies Readonly<Record<WorkflowDirectiveStage, string>>;

export function resolveWorkflowDirective(input: WorkflowDirectiveInput): WorkflowDirective {
  switch (input.stage) {
    case "design_required":
      return {
        stage: input.stage,
        marker: "[JUSTICE: DESIGN REQUIRED]",
        requiredSkills: ["brainstorming"],
        nextAction: "invoke_skill",
        authority: "artifact_ready",
        guidance: GUIDANCE.design_required,
      };
    case "plan_required":
      return {
        stage: input.stage,
        marker: "[JUSTICE: PLAN REQUIRED]",
        requiredSkills: ["writing-plans"],
        nextAction: "invoke_skill",
        authority: "artifact_ready",
        guidance: GUIDANCE.plan_required,
      };
    case "plan_review_required":
      return {
        stage: input.stage,
        marker: "[JUSTICE: PLAN REVIEW REQUIRED]",
        requiredSkills: ["requesting-code-review"],
        nextAction: "request_review",
        authority: "artifact_ready",
        guidance: GUIDANCE.plan_review_required,
      };
    case "review_remediation":
      return {
        stage: input.stage,
        marker: "[JUSTICE: REVIEW REMEDIATION]",
        requiredSkills: ["receiving-code-review"],
        nextAction: "invoke_skill",
        authority: "artifact_ready",
        guidance: GUIDANCE.review_remediation,
      };
    case "review_clear":
      return {
        stage: input.stage,
        marker: "[JUSTICE: REVIEW CLEAR]",
        requiredSkills: [],
        nextAction: "await_human_approval",
        authority: "external_unverified",
        guidance: GUIDANCE.review_clear,
      };
    case "implementation":
      return {
        stage: input.stage,
        marker: "[JUSTICE: IMPLEMENTATION]",
        requiredSkills: ["test-driven-development", "verification-before-completion"],
        nextAction: "delegate_task",
        authority: "external_unverified",
        guidance: GUIDANCE.implementation,
      };
    case "implementation_unauthorized":
      return {
        stage: input.stage,
        marker: "[JUSTICE: IMPLEMENTATION UNAUTHORIZED]",
        requiredSkills: [],
        nextAction: "await_human_approval",
        authority: "external_unverified",
        guidance: GUIDANCE.implementation_unauthorized,
      };
    default:
      return assertNever(input.stage);
  }
}

export function formatWorkflowDirective(input: WorkflowDirectiveInput): string {
  const directive = resolveWorkflowDirective(input);
  return `${directive.marker}\n${directive.guidance}`;
}

export function assertNever(value: never): never {
  throw new Error(`Unsupported workflow directive stage: ${value}`);
}
