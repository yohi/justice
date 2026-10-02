export type WorkflowDirectiveStage =
  | "design_required"
  | "plan_required"
  | "plan_review_required"
  | "review_remediation"
  | "review_clear"
  | "implementation"
  | "implementation_unauthorized"
  | "implementation_arm"
  | "implementation_arm_required";

export interface WorkflowDirectiveInput {
  readonly stage: WorkflowDirectiveStage;
  readonly goal?: string;
  readonly designPath?: string | null;
  readonly planPath?: string | null;
}

export type CanonicalWorkflowSkill =
  | "brainstorming"
  | "writing-plans"
  | "subagent-driven-development"
  | "test-driven-development"
  | "verification-before-completion"
  | "requesting-code-review"
  | "receiving-code-review";

export type WorkflowNextAction =
  | "invoke_skill"
  | "run_review_gate"
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
    "`brainstorming` を使い、要件、境界、テスト方針、未確定事項を設計してください。`/justice-start` のフローでは bounded 判定でもチャット内だけで設計を終えず、承認済み Design をファイルに保存して利用者の確認を得てください。\nReview Gate 前の調査には `explore` / `librarian` への読み取り専用 task() 委譲を使えます。これらの task() では読み取り専用の調査に限定し、実装やファイル変更を行いません。Design の確認後は `writing-plans` を使って Implementation Plan を作成してください。Design と Plan が揃ったら、実行方式を選ばせず、両方のパスを示して利用者に `/justice-review-gate --design <designPath> --plan <planPath>` の実行を案内してください。Review Gate が実行されるまで実装スキル、実装 task()、実装コードの変更に進んではいけません。",
  plan_required:
    "`writing-plans` を使い、設計を検証可能なタスク、依存関係、完了条件に分解してください。計画ファイルを保存したら、Design と Plan のパスを示し、利用者に `/justice-review-gate --design <designPath> --plan <planPath>` の実行を案内してください。\n実行方式を選ばせたり、実装スキルを起動したり、実装 task() を開始したりしてはいけません。利用者が Review Gate を実行するまで停止してください。",
  plan_review_required:
    "Design と Implementation Plan の Review Gate を開始するには、利用者が `/justice-review-gate --design <designPath> --plan <planPath>` を実行してください。\nこの段階から `requesting-code-review` / `code-review` Skill、CodeRabbit CLI、`justice_review` を直接 Review Gate executor として起動しません。\nGate が `review_clear` になり、人間による明示的な承認とマージが確認されるまで実装 task() を開始しません。",
  review_remediation:
    "`receiving-code-review` を使ってレビュー指摘を検討してください。修正時は、このGateが対象にしたDesign / Implementation Planだけを編集できます。Justiceが提示する対象パス以外を変更してはいけません。\n指摘の解決に `justice_review resolve` や `/justice-review-gate --resolve` は使いません。これはファイル修正の承認を求める場面でもありません。提示されたDesign / Planを修正した後、同じ2つのパスで `/justice-review-gate --design <designPath> --plan <planPath>` を再実行してください。",
  review_clear:
    "[JUSTICE: STOP AFTER REVIEW; WAIT FOR USER]\nReview Gate は指摘なしで完了しましたが、これ自体は実装承認ではありません。一般的な実装開始の確認を重ねず、Justiceが提示する対象計画書付きの `/justice-implement --plan <planPath> --approved` を利用者に案内してください。このコマンドによる承認が完了するまでは、実装スキルの読み込み、計画の実行用確認、worktree/workspace の作成、task() の呼び出し、ファイル変更を行ってはいけません。",
  implementation:
    "実装対象の設計・計画を確認し、変更を最小限にして検証を実行してください。\nJusticeは外部での承認やマージ状態を検証できません。実行は、外部の人間による承認・マージ完了の確認後にのみ継続してください。\n実装PRでは、計画との差分、テスト、退行リスクをAIレビューし、人間の承認を待ってください。",
  implementation_unauthorized:
    "この実装タスクは、まだ外部で人間による承認・マージが確認されていません。\nJusticeはPR作成、承認、マージを観測できないため、実行を物理的に停止することはできません。\nタスクを実行する前に、設計・計画PRがレビューされ、人間による明示的な承認とマージが完了していることを確認してください。\n確認が取れない場合は、この task() をキャンセルし、計画の承認・マージを先に進めてください。",
  implementation_arm:
    "承認済み計画の実装を開始するには Superpowers の `subagent-driven-development` を使ってください。\nJustice は外部の承認・マージ状態を検証できません。実行は人間による明示的な承認・マージ確認後にのみ継続してください。",
  implementation_arm_required:
    "実装委譲を開始するには `/justice-implement --plan <planPath> --approved` を実行してください。\nJustice は外部の承認・マージを観測できないため、実装タスクの task() を強化する前に明示的な開始合図を必要としています。",
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
        requiredSkills: [],
        nextAction: "run_review_gate",
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
    case "implementation_arm":
      return {
        stage: input.stage,
        marker: "[JUSTICE: IMPLEMENTATION ARMED]",
        requiredSkills: ["subagent-driven-development"],
        nextAction: "invoke_skill",
        authority: "external_unverified",
        guidance: GUIDANCE.implementation_arm,
      };
    case "implementation_arm_required":
      return {
        stage: input.stage,
        marker: "[JUSTICE: IMPLEMENTATION ARM REQUIRED]",
        requiredSkills: [],
        nextAction: "await_human_approval",
        authority: "external_unverified",
        guidance: GUIDANCE.implementation_arm_required,
      };
    default:
      return assertNever(input.stage);
  }
}

export function formatWorkflowDirective(input: WorkflowDirectiveInput): string {
  const directive = resolveWorkflowDirective(input);
  const requiredSkillsMarker =
    directive.requiredSkills.length === 0
      ? ""
      : `\n[JUSTICE: REQUIRED SKILLS: ${directive.requiredSkills.join(", ")}]`;
  return `${directive.marker}${requiredSkillsMarker}\n${directive.guidance}`;
}

export function assertNever(value: never): never {
  throw new Error(`Unsupported workflow directive stage: ${value}`);
}
