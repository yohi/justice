<!-- markdownlint-disable MD013 -->

# Automated Workflow Directives Design

## Goal

`/justice-start` 後の設計、計画、レビュー、実装に必要な定型指示をJusticeが自動注入し、利用者にPR説明文やレビュー依頼文を都度入力させない。Superpowersの正規スキルを「頭脳」、oh-my-openagentの `task()` とAgent Routerを「手足」として再利用し、Justiceは両者を接続する「神経系」に徹する。

## Scope

Justiceは次のローカルな事実に対してのみディレクティブを生成する。

- `/justice-start` が判定した `design_required`、`plan_required`、`plan_ready`
- `task()` に委譲される実装作業
- 観測されたレビュー出力の指摘有無と完全スナップショット
- 各stageで推奨または必須となるSuperpowersスキルと、OmOへ渡す `loadSkills`

ディレクティブは、設計・計画PR、AIレビュー、レビュー修正、実装PRの標準手順をエージェントに指示する。

## Non-Goals

以下は現在のJusticeの観測境界外であり、この変更では実装しない。

- PRの作成、レビュー要求、承認、マージの実行
- GitHubのPR番号、branch、review thread、check run、merge状態の推測
- 人間の承認やマージをAIレビュー結果から推測すること
- 特定レビュー製品をcore contractへ組み込むこと
- 新しいJustice公開ツールまたはスラッシュコマンドの追加
- directiveやassistantの自己申告をGate PASS evidenceに昇格すること

## Architecture

`src/core/workflow-directives.ts` に副作用のないstage policyを置く。policyは自然言語だけでなく、`stage`、`requiredSkills`、`nextAction`、`authority` を持つ `WorkflowDirective` を返す。自然言語への整形は同じpure core内のformatterが担い、テストは文面ではなく構造化フィールドを検証する。

`PlanBridge` はブートストラップ時に推奨スキルを提示し、`task()` のPreToolUse時に `test-driven-development` と `verification-before-completion` を既存の `loadSkills` へ重複なく追加する。Justice自身はスキルや `task()` を起動せず、OmOの既存TaskPackagerとAgent Routerに実行を委ねる。

レビューは製品名ではなく、既存のreview tool出力または信頼済みtyped review artifactを正規化した「レビュー能力」として扱う。特定製品向けadapterは将来ランタイム境界へ追加できるが、core policyやGateの前提にはしない。

既存の `HookResponse` 注入経路と `mergePostToolUseResponses()` を使い、directiveはL0 advisoryとして既存のGate助言と共存させる。directiveはObservation LogやEvidenceに追加しない。

同じreview tool callの再配送で同じdirectiveを重複注入しないよう、`ObservationHandler` はsession単位のMap内で、`callId`、レビュー結果hash、完全スナップショットフラグから決定的なtuple keyを作る。修正版レビューは結果hashが異なるため、新しい観測として扱う。重複抑止状態はセッション破棄時にMapごと解放する。

## Ecosystem Contract

- Superpowersが所有するもの: 設計、計画、TDD、完了前検証、レビュー依頼・受領の手順。
- oh-my-openagentが所有するもの: `task()`、サブエージェント選択、category routing、並列実行、tool execution。
- Justiceが所有するもの: artifact状態判定、stage-to-skill policy、コンテキスト注入、イベント観測、Evidence、Gate、次の行動のadvisory。
- JusticeはSuperpowersの手順を独自プロンプトとして再実装せず、正規スキル名を構造的に参照する。
- JusticeはOmOの実行機能を複製せず、既存 `task()` payloadを拡張して渡す。

## Lifecycle Semantics

`plan_ready` は「計画ファイルが読める」というartifact readinessだけを意味し、人間承認やマージを意味しない。別のmachine-readableな `directiveStage: "plan_review_required"` を保持する。

現行APIでは外部PRの承認・マージを観測できないため、`task()` 呼び出し時のauthorityは `external_unverified` とする。実装directiveは承認済みと断定せず、「外部で人間承認・マージを確認できた場合のみ続行する」と案内する。将来v2.5のHandoff/typed human artifact導入時に `implementation_authorized` を追加できる境界を残す。

## Flow

1. `/justice-start` が設計または計画不足を検出した場合、`brainstorming` または `writing-plans` と成果物条件を内部指示として注入する。
2. 計画が読める場合、`directiveStage: "plan_review_required"` とレビュー依頼の正規スキルを提示し、利用可能なAIレビュー能力を使った後に人間承認・マージを待つよう注入する。Justiceは外部PR状態を検出しない。
3. エージェントが明示的に `task()` を呼ぶと、既存スキルを保持したまま `test-driven-development` と `verification-before-completion` を `loadSkills` に追加し、OmOへ委譲する。外部承認を確認できない場合は続行しないようadvisoryを加える。
4. 観測されたレビューに未解決指摘があれば `receiving-code-review` を使った修正と再レビューを促す。完全な指摘なしスナップショットなら既存の人間承認フローへ進むよう促す。いずれも承認・マージ済みとは断定しない。

## Error Handling And Trust

フォーマット、レビュー検出、ログ書き込み、通知のどれかに失敗しても、フックは例外を送出せず `PROCEED` に縮退する。`declared` evidence、directive本文、workflow audit、未検証metadataはGate PASSの根拠にしない。

`/justice-start` のgoalは非信頼ユーザー入力としてJSON文字列化してsynthetic directive内に表示し、改行や `[JUSTICE: ...]` markerを指示境界として解釈させない。自動追加するスキル名は固定allowlistに限定し、goal、plan、レビュー本文からスキル名を生成しない。

## Testing

- Pure policy: 各stageの `requiredSkills`、`nextAction`、`authority` とexhaustive matching
- Formatter: 安定markerと非信頼goalの境界化。自然言語本文そのものは固定しない
- PlanBridge: bootstrap guidance、`directiveStage`、既存スキルを保持した `loadSkills` 統合、既存active plan契約
- ObservationHandler: findings、complete clean snapshot、結果hashを含む重複PostToolUse、fail-open
- Integration: synthetic command partが既存の1件契約を守り、OmO task payloadが正規Superpowersスキルを受け取ること
