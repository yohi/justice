<!-- markdownlint-disable-file -->
<!-- Generated transcript-style doc; markdownlint is intentionally disabled for this file. -->
# you asked

message time: 2026-06-12 14:48:50

現在、[OpenCode](https://github.com/anomalyco/opencode)と[oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent)、[superpowers](https://github.com/obra/superpowers)のTDD駆動開発をベースとした開発手法を下記のように回している。

1. `superpowers/brainstorming`で設計書を作成する
2. PRを作成し、CodeRabbitおよびGreptileでレビューを回し、承認されるまで修正
3. `実装計画作成プロンプト`で、実装計画の作成を行う
4. PRを作成してレビュー（2と同様）
5. `実装用プロンプト`でPhase単位で実装させる
6. Task単位でPRを作成してレビュー（2と同様）
7. `乖離確認用プロンプト`で設計書および実装計画書と実装の間に乖離がないか確認して、乖離が見つかった場合は修正対応
8. PRを作成してレビュー（2と同様）
9. 5から8までを全Phase繰り返す

# 実装計画作成プロンプト
```
<role>
    あなたは経験豊富なシニア・テックリードであり、複雑なシステム設計を具体的かつ安全な実装計画に落とし込むエキスパートです。開発環境の `superpowers/using-git-worktrees` および `superpowers/writing-plans` スキルに精通しています。
</role>

<context>
    以下のファイルパスで指定される設計書（superpowers/brainstormingスキルで作成）を読み込み、それを元に実装計画を作成してください。
    <design_document>
         [設計書のファイルパス]
    </design_document>
</context>

<git_workflow_strategy>
    本プロジェクトでは、コードの安全性とレビューの効率化を両立するため、以下の厳密なGitブランチ運用ルールに従います。
    https://different-sunday-448.notion.site/AI-Native-Stacked-PR-Workflow-3611669a4c16802eb032eb4ab05a8adb
    このURLは必ず作業計画にGitブランチ運用フロートして記載してください
</git_workflow_strategy>

<instructions>
    提供された設計書とGit運用ルールに基づき、実装計画を作成してください。以下のステップに従って思考し、計画を構築します。

    1. 初期セットアップ（Phase 0）の定義:
        - プロジェクトにCI/CD（GitHub Actions）およびDevcontainerの設定が存在しない場合、必ずPhase 0として構築タスクを組み込んでください。
        - CI/CD要件: `master` ブランチを対象としたテスト実行のトリガーを設定し、ランナーには `ubuntu-slim` を指定すること。
        - 開発環境要件: `devcontainer.json` および `Dockerfile` を作成すること。

    2. 設計書の分析とPhaseの定義:
        - 設計書を読み解き、独立して結合テストやマージが可能な論理的区切り（Phase）に分割してください。

    3. Taskの分割と依存関係の整理:
        - 各Phaseを適切な粒度のTaskに分割してください。
        - 各Taskについて、上記の【派生元の判断ルール】を適用し、「Baseから派生する」か「直前Taskから派生する」かを明記してください。
    
    4. 作業記録
		    - タスクが完了したら、作成した実装計画にチェックを付与する

    5. PR戦略のアクション明記:
        - 各Taskの実装手順の最後には必ず「Phase Baseに向けたDraft PRを作成する」アクションを含めてください。
</instructions>

<constraints>
    - **Devcontainerの強制**: すべてのテスト実行および静的解析は、ローカル環境ではなく**必ずDevcontainer環境内で実行させる**よう、各タスクの確認手順に明記してください。
    - **出力フォーマットの委譲**: Markdownの構造や見出しは、`superpowers/writing-plans` スキルが想定する標準フォーマットおよびベストプラクティスに完全に準拠して出力してください。
</constraints>

<thinking_process>
    最終的な計画を出力する前に、`<thinking>` タグ内で以下の思考プロセスを実行してください。
    1. Phase 0にCI/CD設定（`master` トリガー、`ubuntu-slim`）とDevcontainer構築が含まれているか。
    2. テストと静的解析がDevcontainer内で実行される手順になっているか。
    3. 洗い出したTaskがレビュー可能なサイズに分割されているか。
    4. 各Taskのブランチ派生元（Baseか直前Taskか）が「単体で完結するか否か」のルールに基づいて正しく判定・記載されているか。
    5. すべてのTaskおよびPhaseの完了時にDraft PRの作成が含まれているか。
</thinking_process>
```

# 実装用プロンプト
```
superpowersのスキルを使って

[実装計画書のファイルパス]

計画に則って実装してください。

その際に
- 記載しているGitブランチ運用フローを**絶対に遵守すること**
- masterブランチへのcommit, pushは行わないこと
- 作成したPRのマージは**禁止**
- 完了したタスクは随時チェックを入れてください
```

# 乖離確認用プロント
```

設計書および計画書と現在の実装コードの間に乖離や漏れがないか、以下の【検証ステップ】に沿って厳密に確認・報告してください。
「実装されているように見える」という表層的なキーワード検索（grep）だけで満足せず、必ずデータフローの繋がりを確認してください。

設計書: [設計書のファイルパス]
計画書: [実装計画書のファイルパス]


【検証ステップ】
1. 設計の要所抽出
指定された設計書の中で、本機能における「特例ルール」「既存ロジックとの分岐条件」「新しく追加された専用関数」を3つ程度リストアップしてください。

2. コールスタックのトレース（エンドツーエンド確認）
起点のAPI/バッチが呼び出されてからレスポンスを返す（またはDB保存・ファイル出力する）までの関数の呼び出し経路（コールスタック）をコードから読み解き、順序立てて書き出してください。

3. 依存関係の論理チェック
「ステップ1」で抽出した専用関数やルールが、「ステップ2」のコールスタック上の適切な場所で**確実に発火しているか**を確認してください
。
- 該当の処理を通らないルート（if文の漏れ、別の汎用関数で上書きされている等）は存在しませんか？
- コードのどこで（ファイル名と行数付近）、その要件が担保されていますか？

4. 結論
上記を踏まえ、設計と実装に乖離・漏れ・誤用がある場合は、該当箇所と修正方針を具体的に指摘してください。問題がない場合も「なぜ問題がないと言い切れるのか」をデータフローを根拠に説明してください。
```

--


しかし「PhaseやTask毎ののテストはpassしても最終成果物にバグがあったり想定した通りに動かない」と言う問題を抱えている。

また、oh-my-openagentとsuperpowersを繋ぐ自作プラグイン[justice](https://github.com/yohi/justice)を使っているものの、この自作プラグインがうまく機能しているとは言い難い。

そこで、justiceの改良と共に下記の考え方を取り入れてより精度の高い開発サイクルを回すためのフローを確立し、AgentSkillなどを使ってClaudeCodeやCodex,OpenCodeといったAIエージェント用のエコシステムを開発したい。

- https://zenn.dev/nka21/articles/claude-code-multi-agent-reviewer

- https://qiita.com/kenimo49/items/9cc37acb549111fbf908

- https://qiita.com/akira_papa_AI/items/d6d1acde70b47f712282

- https://qiita.com/akira_papa_AI/items/89ccccaf66faf74e9c5f

---

# chatgpt response

現状フローはかなり良いですが、問題は「局所テスト・局所レビューは強いが、成果物全体の要求充足を検証する責務が弱い」点に見えます。参照先と各ツールの前提を確認した上で、justice改良案を含むエコシステム設計に落とします。

以下の方針が良いです。  
原因は **TDD不足ではなく、Eval Gate / E2E仕様 / 多視点レビューの統合不足** です。

## Executive Summary

現行フローに追加すべき中核は次の3つです。

1. **実装前に Eval Gate を作る**
   - Acceptance Criteria
   - Negative Criteria
   - E2E確認
   - 人間レビュー観点  
   をTaskごとではなく **Feature / Phase / Task の3階層**で管理する。Eval Gateは「完了条件・失敗条件・確認コマンド・人間レビュー観点」を明示する関門として有効です。([Qiita](https://qiita.com/akira_papa_AI/items/d6d1acde70b47f712282))

2. **Task完了ではなく Feature完了を判定する Final Verifier を置く**
   - Phase単位のpassではなく、最終ユーザー導線・データフロー・副作用・既存仕様破壊を検証する。

3. **レビューを “指摘生成” と “指摘の防御・統合” に分ける**
   - 複数レビュアーが独立レビュー
   - Consolidatorがソースと突き合わせて採用・却下
   - HIGH / MEDIUM / LOW で優先度付け  
   この「広く拾って、厳しく絞る」方式は参照記事の設計と相性が良いです。([Zenn](https://zenn.dev/nka21/articles/claude-code-multi-agent-reviewer))

---

## Architecture

推奨フローはこれです。

```text
0. Feature Brief作成
   ↓
1. superpowers/brainstormingで設計書作成
   ↓
2. Eval Gate作成
   - Feature Eval Gate
   - Phase Eval Gate
   - Task Eval Gate
   ↓
3. 設計PRレビュー
   - CodeRabbit
   - Greptile
   - AI Multi Reviewer
   - Consolidator
   ↓
4. 実装計画作成
   - Phase / Task
   - PR戦略
   - Eval Gate対応表
   ↓
5. 実装計画PRレビュー
   ↓
6. Task実装
   - TDD
   - 仕様化テスト
   - Devcontainer内検証
   ↓
7. Task Gate検証
   ↓
8. Phase Gate検証
   ↓
9. Feature Final Verification
   - E2E
   - データフロー
   - Regression
   - Negative Criteria
   ↓
10. Release Readiness Review
```

ポイントは、**乖離確認を最後にやるだけでは遅い**ことです。  
各Task完了時にTask Gate、Phase完了時にPhase Gate、全体完了時にFeature Gateを通すべきです。

---

## Agent Definitions

### 1. Design Architect

責務:

- 設計書を作る
- 仕様の曖昧さを明文化
- Feature Acceptance Criteriaを抽出
- 既存仕様破壊リスクを列挙

出力:

- design.md
- feature-eval-gate.md

---

### 2. Eval Gate Author

責務:

- 設計書から合格条件を作る
- Task / Phase / Feature単位に分解
- 自動検証と人間判断を分離

出力:

```text
docs/eval-gates/
  feature.md
  phase-01.md
  task-01-01.md
```

必須項目:

```md
# Eval Gate

## Context
## Acceptance Criteria
## Negative Criteria
## Verification Commands
## Required Tests
## Human Review Points
## Evidence Required
```

---

### 3. Implementation Planner

現行の実装計画作成プロンプトに追加すべき責務:

- 各TaskにEval Gateを紐付ける
- Phase完了条件を明記
- Final Verificationタスクを必ず追加
- 仕様化テストが必要な既存挙動を抽出

仕様化テストは、既存コード変更前に「今の振る舞い」を固定して、AI修正による意図しない破壊を検出する安全網になります。([Qiita](https://qiita.com/akira_papa_AI/items/89ccccaf66faf74e9c5f))

---

### 4. Implementer

責務:

- Task単位で実装
- RED → GREEN → REFACTOR
- Verification Commands実行
- Eval Gate充足表を更新
- 完了証跡を残す

禁止:

- Eval Gate未充足で完了扱い
- テストを弱める
- 既存テスト削除
- Negative Criteria違反

---

### 5. Multi Reviewer

構成:

```text
Focus Analyzer
  ↓
Specialized Reviewers x 2〜4
  ↓
Defense / Consolidator
```

レビュアー例:

- Security Reviewer
- Data Flow Reviewer
- Regression Reviewer
- Test Quality Reviewer
- API Contract Reviewer
- UX / Product Behavior Reviewer

複数レビュアーが同じdiff全体を見ることで、ファイル分担では落ちやすいクロスファイル不具合を拾いやすくなります。([Zenn](https://zenn.dev/nka21/articles/claude-code-multi-agent-reviewer))

---

### 6. Final Verifier

現行フローに最も足りないAgentです。

責務:

- 設計書・計画書・Eval Gate・実装を横断確認
- エンドツーエンドのデータフロー確認
- ユーザー導線確認
- Negative Criteria違反確認
- 回帰確認
- 「なぜ問題ないと言えるか」を証跡付きで説明

---

## justice 改良案

justiceは単なる bridge ではなく、**開発サイクルの状態管理・証跡管理・Gate実行器**に寄せるべきです。

### justice v2 の責務

```text
justice
  ├─ skill discovery bridge
  ├─ eval gate registry
  ├─ task state manager
  ├─ verification runner
  ├─ reviewer orchestrator
  ├─ evidence collector
  └─ final report generator
```

### 必須機能

1. **Skill Registry統合**
   - OpenCode / oh-my-openagent / superpowers のskill pathを正規化
   - skillが見えない問題を検出
   - superpowersとoh-my-openagentのskill path衝突を検査  
   oh-my-openagent側でも、superpowers由来のskill pathが見えなくなる問題が報告されています。([GitHub](https://github.com/code-yeongyu/oh-my-openagent/issues/3396?utm_source=chatgpt.com))

2. **Eval Gate管理**
   - `docs/eval-gates/*.md`
   - `justice gates list`
   - `justice gates check task-01`
   - `justice gates status`

3. **Verification Evidence収集**
   - 実行コマンド
   - exit code
   - stdout / stderr
   - 変更ファイル
   - テスト追加有無
   - Eval Gate充足表

4. **Agent Handoff Contract**
   - 次Agentに渡す情報を固定形式化

```json
{
  "task_id": "phase-1-task-2",
  "design_doc": "...",
  "plan_doc": "...",
  "eval_gate": "...",
  "branch": "...",
  "base_branch": "...",
  "verification_commands": [],
  "evidence": [],
  "open_risks": []
}
```

5. **Final Verification Runner**
   - 全Phase完了後に必ず実行
   - E2E / regression / negative criteria / data flowを確認

---

## Prompt Artifacts

### 改良版：実装計画作成プロンプトに追加

```md
追加要件:

設計書から以下を作成してください。

1. Feature Eval Gate
2. Phase Eval Gate
3. Task Eval Gate

各Taskには以下を必ず含めてください。

- 対応するAcceptance Criteria
- 違反してはいけないNegative Criteria
- 追加すべきテスト
- Devcontainer内で実行するVerification Commands
- 人間レビュー観点
- 完了時に残すEvidence

また、全Phase完了後に必ず Final Verification Phase を追加してください。
Final Verificationでは、設計書・計画書・Eval Gate・実装コードを横断し、E2Eデータフローと既存仕様破壊を確認してください。
```

---

### 改良版：実装用プロンプト

```md
superpowersのスキルを使って、以下の実装計画とEval Gateに従って実装してください。

実装計画:
[実装計画書のファイルパス]

Eval Gate:
[Eval Gateのファイルパス]

必須ルール:
- Gitブランチ運用フローを絶対に遵守する
- masterブランチへのcommit / pushは禁止
- PRのマージは禁止
- Devcontainer内でのみテスト・静的解析を実行する
- Acceptance Criteria未充足のまま完了扱いにしない
- Negative Criteriaに違反しない
- テストを通すためだけに仕様を弱めない
- 既存テストを理由なく削除しない

完了時に以下を報告してください。

1. 実装内容
2. 追加・変更したテスト
3. 実行したVerification Commandsと結果
4. Acceptance Criteria充足表
5. Negative Criteria違反がない根拠
6. 残リスク
7. 人間レビュー観点
8. 完了したTaskへのチェック
```

---

### 改良版：乖離確認プロンプト

```md
設計書・計画書・Eval Gate・現在の実装コードの間に乖離がないか確認してください。

設計書: [path]
計画書: [path]
Eval Gate: [path]

確認対象:
1. Acceptance Criteriaが実装で満たされているか
2. Negative Criteriaに違反していないか
3. 設計上の特例ルールが実際のコールスタック上で発火するか
4. 既存仕様を破壊していないか
5. テストが仕様を検証しているか、単に実装詳細をなぞっているだけではないか
6. E2Eのデータフローが成立しているか

出力:
- PASS / WARN / FAIL
- 根拠
- 該当ファイルと行番号付近
- 不足しているテスト
- 修正方針
- 人間が確認すべき点
```

---

## Validation Strategy

最低限この4層にしてください。

```text
Task Validation
  - Unit test
  - Typecheck
  - Lint
  - Task Eval Gate

Phase Validation
  - Integration test
  - Phase Eval Gate
  - API contract / DB / migration確認

Feature Validation
  - E2E
  - Negative Criteria
  - Regression
  - Data flow trace

Release Validation
  - Multi-agent review
  - Consolidator
  - Human review only on flagged points
```

---

## Risks

主なリスクはこの5つです。

1. **Task粒度が細かすぎて全体動作が見えない**
2. **テストが局所仕様だけを確認している**
3. **Acceptance Criteriaが自然言語のまま実装と紐付かない**
4. **レビューAIが指摘を出すだけで、妥当性検証していない**
5. **justiceがskill連携ツールに留まり、状態管理・証跡管理を担っていない**

---

## Recommendations

次にやるべき順番はこれです。

1. `docs/eval-gates/` を導入
2. 実装計画プロンプトに Eval Gate 生成を追加
3. justiceに `gate check` と `evidence collect` を追加
4. Multi Reviewer + Consolidator をPRレビュー前に実行
5. 全Phase完了後の Final Verification Phase を必須化

最重要の変更は、**「テストがpassしたか」ではなく「Eval Gateを証跡付きで満たしたか」を完了条件にすること**です。

---

# you asked

message time: 2026-06-12 14:53:01

oh-my-openagentのマルチエージェント（手足）とsuperpowersのTDD（頭脳）を結合する神経系プラグインとしてのjusticeにプラスアルファする形にしたい。

---

# chatgpt response

了解です。justiceを「単なる連携アダプタ」ではなく、oh-my-openagentの実行系とsuperpowersの思考・TDD系をつなぐ神経系として再定義し、その上に品質保証レイヤーを足す設計にします。

はい。justiceはこう定義するのが良いです。

## justice の位置づけ

```text
superpowers = 頭脳
  - brainstorming
  - writing-plans
  - TDD設計
  - 計画・検証思考

oh-my-openagent = 手足
  - multi-agent実行
  - reviewer
  - implementer
  - specialist agents

justice = 神経系 + 免疫系
  - skill接続
  - 状態管理
  - agent handoff
  - Eval Gate
  - evidence収集
  - 最終検証
```

oh-my-openagentはOpenCode向けのmulti-model agent orchestration harnessとして説明されており、複数agent実行系として使う前提に合っています。([GitHub](https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/guide/overview.md?utm_source=chatgpt.com))  
一方で、oh-my-openagent有効時にsuperpowersのskill解決が壊れる報告もあるため、justiceはまず **skill bridgeの安定化** を担うべきです。([GitHub](https://github.com/code-yeongyu/oh-my-openagent/issues/3396?utm_source=chatgpt.com))

## justice に足すべき機能

### 1. Skill Router

superpowersとoh-my-openagentのskill衝突を吸収します。

```text
justice skill doctor
justice skill list
justice skill resolve brainstorming
justice skill resolve writing-plans
justice skill repair
```

責務:

- superpowers skill pathを検出
- oh-my-openagentのskill registryに注入
- 呼び出し可能性を検査
- prompt-visibleだがcallableでない状態を検出

---

### 2. Mission State

設計、計画、実装、レビュー、検証の状態をjusticeが持ちます。

```text
.justice/
  mission.json
  gates/
  evidence/
  handoffs/
  reports/
```

`mission.json`:

```json
{
  "design_doc": "docs/design.md",
  "plan_doc": "docs/implementation-plan.md",
  "current_phase": "phase-1",
  "current_task": "task-1-2",
  "branch_policy": "stacked-pr",
  "required_gates": ["task", "phase", "feature"]
}
```

---

### 3. Eval Gate

「テストpass」ではなく「仕様充足」を完了条件にします。

```text
justice gate create --from design.md
justice gate check task-1-2
justice gate check phase-1
justice gate check feature
```

Gateには必ず含めます。

```md
## Acceptance Criteria
## Negative Criteria
## Required Tests
## Verification Commands
## Data Flow Checkpoints
## Human Review Points
## Evidence Required
```

---

### 4. Agent Handoff

superpowersの頭脳出力を、oh-my-openagentの手足に渡す標準形式です。

```text
justice handoff create --task task-1-2
justice handoff run --agent implementer
justice handoff review --agent data-flow-reviewer
```

handoff:

```json
{
  "role": "implementer",
  "task_id": "phase-1-task-2",
  "design_doc": "docs/design.md",
  "plan_doc": "docs/implementation-plan.md",
  "eval_gate": ".justice/gates/task-1-2.md",
  "branch": "feature/phase-1/task-2",
  "base_branch": "feature/phase-1/base",
  "must_not": [
    "commit to master",
    "merge PR",
    "weaken tests"
  ],
  "done_when": [
    "tests pass in devcontainer",
    "eval gate passes",
    "evidence collected"
  ]
}
```

---

### 5. Evidence Collector

各Agentの作業結果を証跡化します。

```text
justice evidence collect
justice evidence status
justice evidence report
```

収集対象:

- 実行コマンド
- exit code
- test結果
- lint結果
- 変更ファイル
- PR URL
- Gate判定
- reviewer指摘
- 未解決リスク

---

### 6. Final Verifier

最終成果物のバグを減らす本丸です。

```text
justice verify final
```

確認内容:

- 設計書との一致
- 実装計画との一致
- Feature Eval Gate充足
- E2Eデータフロー
- Negative Criteria違反
- 既存仕様破壊
- テストが仕様を検証しているか

---

## 推奨コマンドフロー

```bash
justice doctor

justice mission init \
  --design docs/design.md \
  --branch-policy stacked-pr

justice gate create --from docs/design.md

justice plan create \
  --skill superpowers/writing-plans

justice handoff create --phase phase-1 --task task-1

justice run implementer --task task-1

justice gate check --task task-1

justice review multi --task task-1

justice evidence collect --task task-1

justice verify phase --phase phase-1

justice verify final
```

## justice の本質

justiceは **AI agentを増やすプラグイン** ではなく、以下を保証するプラグインにするべきです。

```text
正しいskillが呼べる
正しいagentに渡る
正しいbranchで作業する
正しいGateで止まる
正しい証跡が残る
正しい粒度でレビューされる
最後にFeature全体で検証される
```

つまり、

```text
oh-my-openagent = 並列実行能力
superpowers = 思考能力
justice = 制御・伝達・検証能力
```

この分離が一番強いです。

---

# you asked

message time: 2026-06-12 14:55:14

お互いのプラグインをなるべく最大限に活かしたい

---

# chatgpt response

その場合、justiceは **置き換え役ではなく、両者の能力を損なわず接続する薄い制御層** にするべきです。

## 基本方針

```text
superpowers
= 思考・設計・TDD・計画作成の標準系

oh-my-openagent
= 複数Agent実行・レビュー・専門家分業の標準系

justice
= 両者を接続し、成果物・状態・検証結果を同期する神経系
```

justiceがやってはいけないことは、superpowersやoh-my-openagentの既存責務を奪うことです。

---

## 推奨アーキテクチャ

```text
[superpowers]
  brainstorming
  writing-plans
  TDD workflow
  ↓
[justice]
  mission state
  handoff contract
  gate registry
  evidence registry
  skill router
  ↓
[oh-my-openagent]
  implementer agents
  reviewer agents
  specialist agents
  multi-agent orchestration
  ↓
[justice]
  evidence collection
  gate check
  final verification trigger
  ↓
[superpowers]
  plan update
  learning / reflection
```

重要なのは **双方向接続** です。

- superpowers → oh-my-openagent  
  設計・計画・TDDルールを実行Agentへ渡す

- oh-my-openagent → superpowers  
  実装結果・レビュー結果・失敗原因を計画や検証に戻す

---

## justice に持たせるべき最小コア

### 1. Skill Router

superpowersのskillをoh-my-openagent実行中でも安定して呼べるようにする。

```bash
justice skill doctor
justice skill list
justice skill resolve superpowers/brainstorming
justice skill resolve superpowers/writing-plans
```

---

### 2. Mission Context

全Agentが同じ前提を見るための共有状態。

```json
{
  "project": "example",
  "design_doc": "docs/design.md",
  "plan_doc": "docs/implementation-plan.md",
  "branch_policy": "stacked-pr",
  "current_phase": "phase-1",
  "current_task": "task-1-2",
  "superpowers_skills": [
    "superpowers/brainstorming",
    "superpowers/writing-plans",
    "superpowers/using-git-worktrees"
  ],
  "openagent_roles": [
    "implementer",
    "reviewer",
    "data-flow-reviewer",
    "test-reviewer",
    "security-reviewer"
  ]
}
```

---

### 3. Handoff Contract

superpowersの成果物を、oh-my-openagentのAgentに渡す標準形式。

```md
# Agent Handoff

## Mission
## Design Source
## Implementation Plan Source
## Current Phase
## Current Task
## Branch Rule
## Required Skill
## Acceptance Criteria
## Negative Criteria
## Verification Commands
## Evidence Required
## Stop Conditions
```

---

### 4. Eval Gate

「作業したか」ではなく「仕様を満たしたか」を判定する。

```bash
justice gate check --task task-1-2
justice gate check --phase phase-1
justice gate check --feature
```

---

### 5. Evidence Registry

oh-my-openagentの各Agent実行結果をjusticeが回収する。

```text
.justice/evidence/
  task-1-2/
    implementation.md
    test-result.md
    review-result.md
    gate-result.md
```

---

## 役割分担

| 領域 | 主担当 | justiceの役割 |
|---|---|---|
| 設計 | superpowers | 設計書パスと決定事項を記録 |
| 実装計画 | superpowers | Task / Gate / Branchと紐付け |
| 実装 | oh-my-openagent | Handoffを渡す |
| 並列レビュー | oh-my-openagent | 結果を統合・証跡化 |
| TDD | superpowers | 実装AgentにTDD制約を注入 |
| PR運用 | 既存Git flow | 違反検出 |
| 乖離確認 | justice + reviewer agents | Gate化して継続実行 |
| 最終検証 | justice | Feature全体を判定 |

---

## 改良後フロー

```text
1. justice mission init
2. superpowers/brainstorming で設計
3. justice gate create
4. PRレビュー
5. superpowers/writing-plans で実装計画
6. justice handoff create
7. oh-my-openagentでTask実装
8. justice evidence collect
9. justice gate check task
10. oh-my-openagentでmulti-agent review
11. justice gate check phase
12. 全Phase後 justice verify final
13. superpowersで振り返り・計画更新
```

---

## 一番重要な設計原則

justiceは **司令塔** ではなく **神経系** です。

```text
司令塔にすると:
- justiceが重くなる
- 既存pluginの価値を奪う
- promptやworkflowが重複する

神経系にすると:
- superpowersの思考力を活かせる
- oh-my-openagentの実行力を活かせる
- justiceは接続・同期・検証に集中できる
```

## 結論

justiceに追加すべきプラスアルファはこれです。

```text
Skill Router
Mission State
Agent Handoff
Eval Gate
Evidence Registry
Final Verification
```

これだけで、両プラグインの強みを潰さずに、最終成果物の品質をかなり上げられます。

---

# you asked

message time: 2026-06-12 15:52:36

justice改修用の要件定義を作成して下さい

---

# chatgpt response

これは既に要件定義を書くのに十分な情報があります。

むしろ今の段階ではプロンプト改善よりも、

> justiceを「superpowersとoh-my-openagentを接続する神経系プラグイン」として再設計する

ための要件定義書を先に固めるべきです。

以下はそのまま `docs/designs/justice-v2.md` として使えるレベルで作成します。

---

# justice v2 要件定義書

## 概要

justiceは、superpowersとoh-my-openagentを接続し、AI Agentによるソフトウェア開発プロセス全体の整合性・追跡性・品質保証を実現する神経系プラグインである。

justice自身は設計や実装を行わない。

責務は以下に限定する。

- Skill連携
- Agent間の状態共有
- Handoff管理
- Evidence収集
- Eval Gate管理
- 最終検証

---

# 背景

現行フローでは以下の問題が存在する。

## 問題1

Task単位のTDDは成功するが、

- Feature全体で破綻
- E2Eで不整合
- 設計との乖離

が発生する。

---

## 問題2

superpowersとoh-my-openagentの責務境界が曖昧。

結果として

- Skill解決失敗
- Context断絶
- Agent間情報ロス

が発生する。

---

## 問題3

PRレビューは行われているが、

レビュー結果が

- 設計
- 実装計画
- 実装

に体系的に反映されない。

---

# 目的

justiceは以下を実現する。

## Goal 1

superpowersの思考能力を最大活用する。

---

## Goal 2

oh-my-openagentのマルチエージェント能力を最大活用する。

---

## Goal 3

Agent間の情報伝達を標準化する。

---

## Goal 4

Feature単位で品質保証できる仕組みを作る。

---

# システムアーキテクチャ

```text
┌────────────────────┐
│   superpowers      │
│                    │
│ brainstorming      │
│ writing-plans      │
│ TDD workflows      │
└─────────┬──────────┘
          │
          │
          ▼
┌────────────────────┐
│      justice       │
│                    │
│ Skill Router       │
│ Mission State      │
│ Handoff Manager    │
│ Gate Manager       │
│ Evidence Registry  │
│ Verification Hub   │
└─────────┬──────────┘
          │
          │
          ▼
┌────────────────────┐
│ oh-my-openagent    │
│                    │
│ Implementer        │
│ Reviewer           │
│ Architect          │
│ Security           │
│ QA                 │
└────────────────────┘
```

---

# 機能要件

# FR-001 Skill Router

## 目的

superpowers Skillをoh-my-openagent環境でも安定利用可能にする。

## 必須機能

### skill list

```bash
justice skill list
```

登録済Skill一覧取得

---

### skill doctor

```bash
justice skill doctor
```

診断項目

- Skill存在確認
- 読込可否
- 競合確認
- パス不整合確認

---

### skill resolve

```bash
justice skill resolve brainstorming
```

解決結果出力

---

# FR-002 Mission State

## 目的

Agent間で共有される状態管理

## 保存場所

```text
.justice/mission.json
```

## 管理項目

```json
{
  "design_doc": "",
  "implementation_plan": "",
  "current_phase": "",
  "current_task": "",
  "branch_policy": "",
  "open_prs": []
}
```

---

# FR-003 Handoff Manager

## 目的

Agent間引継ぎ標準化

---

### handoff create

```bash
justice handoff create
```

生成

```json
{
  "task_id": "",
  "phase_id": "",
  "design_doc": "",
  "plan_doc": "",
  "eval_gate": "",
  "required_skills": []
}
```

---

### handoff validate

```bash
justice handoff validate
```

必須項目確認

---

# FR-004 Eval Gate Manager

## 目的

テストPassではなく仕様充足を確認する。

---

### gate create

```bash
justice gate create
```

生成対象

- Feature
- Phase
- Task

---

### gate check

```bash
justice gate check
```

判定

```text
PASS
WARN
FAIL
```

---

Gate定義

```md
Acceptance Criteria
Negative Criteria
Verification Commands
Required Tests
Evidence Required
Review Points
```

---

# FR-005 Evidence Registry

## 目的

Agent作業証跡収集

---

保存先

```text
.justice/evidence
```

---

収集対象

### テスト結果

```json
{
  "command": "",
  "exit_code": 0
}
```

---

### レビュー結果

```json
{
  "reviewer": "",
  "severity": ""
}
```

---

### 実装結果

変更ファイル一覧

---

# FR-006 Multi-Agent Review Hub

## 目的

oh-my-openagentレビュアー統合

---

対象Agent

```text
security-reviewer
test-reviewer
architecture-reviewer
dataflow-reviewer
```

---

出力

```json
{
  "issues": [],
  "accepted": [],
  "rejected": []
}
```

---

# FR-007 Final Verification

最重要機能

---

目的

Feature単位品質保証

---

検証項目

## 設計整合性

設計書との一致

---

## 計画整合性

実装計画との一致

---

## Eval Gate

Feature Gate充足

---

## E2E

データフロー確認

---

## Regression

既存仕様破壊確認

---

## Negative Criteria

違反確認

---

結果

```text
PASS
WARN
FAIL
```

---

# 非機能要件

## NFR-001

CLI応答

5秒以内

---

## NFR-002

Gateチェック

30秒以内

---

## NFR-003

Mission State破損時

自動バックアップ復元

---

## NFR-004

すべての操作を監査ログへ出力

---

# ディレクトリ構成

```text
.justice/
├── mission.json
├── gates/
│   ├── feature/
│   ├── phase/
│   └── task/
├── handoffs/
├── evidence/
├── reviews/
├── reports/
└── logs/
```

---

# Phase計画

## Phase 1

Core Foundation

- Mission State
- Skill Router
- Handoff Manager

---

## Phase 2

Quality Layer

- Gate Manager
- Evidence Registry

---

## Phase 3

Review Layer

- Multi-Agent Review Hub

---

## Phase 4

Verification Layer

- Final Verification

---

# 成功指標

## KPI-1

Skill解決失敗率

```text
< 1%
```

---

## KPI-2

Agent Handoff失敗率

```text
< 3%
```

---

## KPI-3

Feature完成後に発見される設計乖離

```text
50%以上削減
```

---

## KPI-4

Feature完成後の不具合検出率

```text
30%以上改善
```

---

私ならさらにこの上位に **「Justice Protocol (JP)」** を定義します。

つまり justice を単なるCLIではなく、

```text
Justice Protocol
├─ Mission
├─ Gate
├─ Handoff
├─ Evidence
├─ Review
└─ Verification
```

というAIエージェント共通プロトコルとして設計し、superpowers・oh-my-openagent・Claude Code・Codex・OpenCodeが同じ状態ファイルを読む構造にします。

そうすると justice が単なるプラグインではなく、AI Native開発環境の標準神経系になります。

---

# you asked

message time: 2026-06-12 16:10:01

oh-my-openagent自体がOpenCodeを前提にしているのでターゲットはOpenCodeプラグインで構わない。
opencodeプラグインについてWEB検索した上で要件定義を再生成して

---

# chatgpt response

OpenCodeのプラグイン仕様を確認した上で考えると、前回の要件定義は少し間違っています。

最大の誤りは、

> justiceを独立したCLIツールとして設計していたこと

です。

OpenCodeは現在、

- Pluginシステム
- Event Hook
- Command拡張
- Agent拡張

を持っています。PluginはOpenCode内部イベントにフックする形で動作し、コマンド追加や振る舞い変更も可能です。([OpenCode](https://opencode.ai/docs/plugins/?utm_source=chatgpt.com))

また ecosystem 上では oh-my-openagent 自体も

> OpenCodeプラグイン

として位置付けられています。([OpenCode](https://opencode.ai/docs/ecosystem/?utm_source=chatgpt.com))

したがって justice は

```text
OpenCode
 ├─ oh-my-openagent
 ├─ superpowers
 └─ justice
```

ではなく、

```text
OpenCode
 ├─ oh-my-openagent
 │   ├─ Implementer
 │   ├─ Reviewer
 │   ├─ Specialist Agents
 │   └─ Skills
 │
 ├─ superpowers
 │   ├─ brainstorming
 │   ├─ writing-plans
 │   └─ TDD workflows
 │
 └─ justice
      ├─ Event Orchestrator
      ├─ State Synchronizer
      ├─ Gate Engine
      ├─ Evidence Engine
      └─ Verification Engine
```

の方が正しいです。

justiceは「第三のAgent」ではなく、

**OpenCodeイベントレイヤーに常駐する制御プラグイン**

として設計すべきです。

---

# justice v2 再定義

## システム目的

justiceは、

- superpowers
- oh-my-openagent
- OpenCode Core

の間で発生するイベントを監視し、

- 状態管理
- 品質管理
- 引継ぎ管理
- 検証管理

を行うOpenCode Pluginである。

---

# アーキテクチャ

```text
OpenCode Runtime
│
├── Core Events
│
├── oh-my-openagent
│     ├── Implementer
│     ├── Reviewer
│     └── Specialists
│
├── superpowers
│     ├── brainstorming
│     ├── writing-plans
│     └── TDD
│
└── justice
      ├── Event Listener
      ├── Mission Manager
      ├── Gate Engine
      ├── Evidence Engine
      ├── Review Aggregator
      └── Final Verifier
```

---

# justice の責務

## 責務1

Mission状態管理

---

OpenCodeセッション単位で

```json
{
  "design_doc": "",
  "plan_doc": "",
  "phase": "",
  "task": "",
  "branch": "",
  "pr": ""
}
```

を保持する。

---

## 責務2

superpowers成果物追跡

検出対象

```text
design.md
implementation-plan.md
adr/*
```

変更時にMission更新。

---

## 責務3

oh-my-openagent実行追跡

対象

```text
Implementer
Reviewer
Security Reviewer
QA Reviewer
```

Agent実行結果を記録。

---

# 機能要件

## FR-001 Mission Manager

### コマンド

```text
/justice-init
```

生成

```text
.justice/
```

---

### 保存

```text
.justice/mission.json
```

---

管理内容

- 現在Phase
- 現在Task
- PR状態
- Gate状態

---

## FR-002 Skill Awareness

justiceはSkillを実装しない。

代わりに

現在利用可能な

- superpowers Skill
- oh-my-openagent Agent

を収集する。

---

取得例

```json
{
  "skills": [
    "superpowers/brainstorming",
    "superpowers/writing-plans"
  ],
  "agents": [
    "implementer",
    "reviewer"
  ]
}
```

---

理由

責務重複回避。

---

## FR-003 Handoff Tracking

justiceはAgent引継ぎを監視する。

---

生成物

```text
.justice/handoffs/
```

---

例

```json
{
  "from": "planner",
  "to": "implementer",
  "task": "phase1-task2"
}
```

---

## FR-004 Evidence Engine

OpenCodeイベントを監視。

収集対象

- テスト結果
- lint結果
- review結果
- PR URL
- commit

---

保存

```text
.justice/evidence/
```

---

## FR-005 Gate Engine

最重要。

---

Task完了時

```text
Task Gate
```

実施。

---

Phase完了時

```text
Phase Gate
```

実施。

---

Feature完了時

```text
Feature Gate
```

実施。

---

判定

```text
PASS
WARN
FAIL
```

---

## FR-006 Review Aggregator

oh-my-openagentの複数レビュー結果統合。

---

入力

```text
Security Review
Architecture Review
Dataflow Review
Test Review
```

---

出力

```json
{
  "critical": [],
  "major": [],
  "minor": []
}
```

---

## FR-007 Final Verifier

justice最大の機能。

---

トリガー

Feature完了

または

```text
/justice-verify
```

---

検証対象

### 設計

設計書との差異

### 計画

実装計画との差異

### TDD

不足テスト

### E2E

データフロー

### Regression

既存機能破壊

### Review

未解決指摘

---

出力

```text
Release Ready
Not Ready
```

---

# OpenCode Plugin要件

OpenCode Pluginとして実装する以上、

justiceはCLI主体ではなく

## Custom Commands

```text
/justice-init
/justice-status
/justice-gate
/justice-review
/justice-verify
```

として利用可能にする。OpenCodeはMarkdownベースのカスタムコマンド定義をサポートしています。([anomalyco-opencode.mintlify.app](https://anomalyco-opencode.mintlify.app/commands?utm_source=chatgpt.com))

---

## Plugin Hook

### 利用可能なフック

```text
tool.execute.before
tool.execute.after
chat.message
chat.params
experimental.session.compacting
experimental.text.complete
```

OpenCodeプラグインはイベントフック型で拡張する前提です。旧来の `Session Start` / `Agent Start` / `Agent Complete` / `Git Commit` / `PR Create` / `Session End` は列挙しません。([OpenCode](https://opencode.ai/docs/plugins/?utm_source=chatgpt.com))

---

# justice がやらないこと

重要です。

やらないことを明確にします。

## やらない

設計生成

→ superpowers

---

実装

→ oh-my-openagent

---

レビュー

→ oh-my-openagent

---

TDD

→ superpowers

---

Git運用

→ superpowers

---

# 成功指標

### KPI1

Feature完成後の設計乖離

50%以上削減

### KPI2

Feature完成後の不具合

30%以上削減

### KPI3

Agent間コンテキスト欠落

80%以上削減

### KPI4

レビュー指摘の取りこぼし

50%以上削減

---

私ならさらに v2 の次として、

**justiceを「OpenCode向け開発OS」ではなく「OpenCode向け品質カーネル(Quality Kernel)」として位置付けます。**

つまり、

```text
oh-my-openagent = 実行層
superpowers = 思考層
justice = 品質保証層
```

に限定すると責務が極めて綺麗になり、将来的にoh-my-openagentやsuperpowersが更新されても追従しやすくなります。

---

# you asked

message time: 2026-06-12 16:19:38

その「v2の次」をroadmapとして要件定義に組み込んで。

---

# chatgpt response

それなら要件定義を **「Justice v2（実装対象）」と「Justice v3（ロードマップ）」を明確に分離** しておくべきです。

理由は単純で、今の段階で v3 まで実装要件に入れるとスコープが肥大化します。しかし設計としては最初から v3 を見据えておかないと、v2 完成後に全面リファクタリングが発生します。

私なら以下のように定義します。

---

# Justice プロジェクトビジョン

## 長期ビジョン

JusticeはOpenCode上で動作するAI Agent開発向け品質保証プラットフォームである。

Justice自身は設計・実装・レビューを行わない。

以下を保証する。

- Agent間の状態整合性
- 品質ゲート管理
- 証跡管理
- 最終成果物検証

---

## レイヤー構造

```text
┌───────────────────────┐
│      OpenCode         │
└──────────┬────────────┘

           │

┌──────────▼────────────┐
│   oh-my-openagent     │
│     実行レイヤー       │
└──────────┬────────────┘

           │

┌──────────▼────────────┐
│     superpowers       │
│      思考レイヤー      │
└──────────┬────────────┘

           │

┌──────────▼────────────┐
│       Justice         │
│      品質レイヤー      │
└───────────────────────┘
```

---

# Justice v2

## 位置付け

Quality Coordination Layer

品質保証のための神経系。

---

## 実装対象

### Mission Manager

```text
.justice/mission.json
```

管理

- phase
- task
- branch
- PR
- gate status

---

### Skill Awareness

収集のみ。

- superpowers skills
- oh-my-openagent agents

---

### Handoff Tracking

```text
.justice/handoffs
```

Agent引継ぎ追跡。

---

### Evidence Engine

```text
.justice/evidence
```

証跡管理。

---

### Gate Engine

管理対象

```text
Task Gate
Phase Gate
Feature Gate
```

---

### Review Aggregator

統合対象

```text
Security
Architecture
Test
Dataflow
```

---

### Final Verifier

確認対象

```text
設計
計画
実装
レビュー
E2E
Regression
```

---

# Justice v3 Roadmap

## 位置付け

Quality Kernel

JusticeをOpenCode品質カーネルへ進化させる。

---

# Goal

現状

```text
Agent
 ↓
Task
 ↓
PR
 ↓
Review
```

から

```text
Requirement
 ↓
Design
 ↓
Plan
 ↓
Task
 ↓
PR
 ↓
Review
 ↓
Release
```

全体をトレーサブルにする。

---

# V3-01 Requirement Graph Engine

目的

設計以前の要求を管理する。

---

管理対象

```text
Business Requirement
Feature Requirement
Non Functional Requirement
Acceptance Criteria
```

---

出力

```text
.justice/requirements
```

---

例

```yaml
REQ-001:
  title: OAuth Login
  acceptance:
    - Google Login Success
    - Session Persistence
```

---

# V3-02 Traceability Engine

目的

要求からコードまで追跡。

---

追跡対象

```text
Requirement
 ↓
Design
 ↓
Plan
 ↓
Task
 ↓
PR
 ↓
Commit
 ↓
Test
```

---

成果物

```text
.justice/traceability
```

---

例

```text
REQ-001

 ├─ design.md#section3
 ├─ phase1-task2
 ├─ PR-14
 ├─ commit abc123
 └─ login.test.ts
```

---

# V3-03 Coverage Analyzer

目的

実装カバレッジではなく

要求カバレッジを確認。

---

確認

```text
Requirement Coverage
Design Coverage
Plan Coverage
Test Coverage
```

---

出力

```text
Coverage: 92%

Missing:
REQ-007
REQ-014
```

---

# V3-04 Review Memory

目的

過去レビュー知識蓄積。

---

保存

```text
.justice/review-memory
```

---

内容

```text
Recurring Bug
Architecture Smell
Security Findings
```

---

利用

次回レビュー時に参照。

---

# V3-05 Failure Intelligence

目的

失敗学習。

---

収集

```text
Production Bug
Review Miss
Gate Miss
Regression
```

---

分析

```text
なぜ漏れたか
どのGateで防げたか
```

---

出力

改善提案。

---

# V3-06 Adaptive Gate

目的

静的Gateから動的Gateへ。

---

例

現状

```text
Task
 ↓
Phase
 ↓
Feature
```

固定。

---

将来

AIが判断。

```text
この変更は

認証
DB
課金

へ影響する

→ Security Gate追加
→ Migration Gate追加
```

---

# V3-07 Release Readiness Score

目的

リリース判断支援。

---

入力

```text
Gate
Coverage
Review
Evidence
Regression
```

---

出力

```text
Release Score

92 / 100

Ready
```

---

# V3-08 Multi-Project Knowledge Base

目的

プロジェクト横断学習。

---

保存

```text
成功パターン
失敗パターン
レビュー知識
```

---

利用

新規開発時。

---

# V3 成功指標

## KPI-1

要求→実装の追跡率

```text
100%
```

---

## KPI-2

設計乖離

```text
70%以上削減
```

---

## KPI-3

本番不具合

```text
50%以上削減
```

---

## KPI-4

レビュー漏れ

```text
70%以上削減
```

---

# 実装優先順位

### v2.0

Core Foundation

```text
Mission
Handoff
Evidence
Gate
Verifier
```

---

### v2.5

Quality Expansion

```text
Review Aggregator
E2E Verification
Regression Verification
```

---

### v3.0

Quality Kernel

```text
Requirement Graph
Traceability
Coverage
Release Score
```

---

### v3.5

Self-Improving Quality System

```text
Review Memory
Failure Intelligence
Adaptive Gate
Knowledge Base
```

この構成にすると、v2は「今抱えている問題（Taskは通るがFeatureが壊れる）」を解決し、v3では「なぜ壊れたのかを学習して次回以降の品質を上げる」段階へ進化できます。つまり v2 は神経系、v3 は免疫系＋学習機構です。

---

# you asked

message time: 2026-06-12 22:16:28

下記は要件定義のレビュー指摘です。まずその指摘内容の妥当性を評価してください。

ご提示いただいた「Justice v2 / v3」の要件定義の分離案、および「v2は神経系、v3は免疫系＋学習機構」というコンセプトは、AI駆動開発のアーキテクチャ進化において非常に的確で優れた視点です。

AI駆動開発に精通したエンジニアの視点から、添付のリポジトリの現状（特に `SPEC.md` や `2026-04-26-justice-expansion-design.md`）と照らし合わせて、ご提案のレビューと今後の統合に向けたフィードバックを行います。

### 1. 全体コンセプトへの評価：極めて妥当

現状のJusticeは「プランファイルと実行エンジンのギャップを埋めるフック層」として機能していますが、タスク単体は成功しても全体統合で壊れる（Featureが壊れる）という課題を抱えやすい状態です。
ご提案のレイヤー構造において、Justiceを単なる「実行の橋渡し」から「品質レイヤー（Quality Layer）」へ明確に位置付け直した点は、アーキテクチャの責務分離として非常に理にかなっています。スコープの肥大化を防ぐためにv2とv3を明確に分けるアプローチも、開発フェーズの管理上必須と言えます。

### 2. Justice v2（神経系・品質ゲート）のレビュー

v2の目標である「Quality Coordination Layer」として、各種Gate（Task/Phase/Feature）や証跡管理（Evidence Engine）を導入する設計は、現状のJusticeに最も欠けているピースを埋めるものです。

* **現状とのギャップと適合性**:
* 現在のJusticeは `PlanParser` や `TaskFeedback` フックを用いて `plan.md` のタスク完了を検知していますが、それは単に「タスクが終わったか」を見ており、「品質基準を満たしているか（Gate）」の検証が弱いです。
* v2の構想を組み込む場合、既存の `PostToolUse` イベントを拡張し、単一タスクの完了時に「Task Gate」を、複数タスク完了時に「Phase Gate」をトリガーする設計が考えられます。
* **懸念点・助言**: `Mission Manager` による `.justice/mission.json` の導入は強力ですが、現在の `plan.md` ベースの宣言的アプローチ（Superpowersの思想） と二重管理になるリスクがあります。`plan.md` をそのままミッションの「マニフェスト」として扱い、ステータスやGateの通過履歴のみを別ファイルで管理する形にすると、既存エコシステムと綺麗に統合できます。



### 3. Justice v3（免疫系・学習機構）のレビュー

v3の「Quality Kernel」構想は、要求からリリースまでの完全なトレーサビリティと、失敗からの自己学習をAIに自律的に行わせるという、まさに次世代のAI開発プラットフォームの姿です。

* **既存実装（拡張設計）との驚くべきシンクロ**:
* 実は、ご提案のv3の要素のいくつかは、添付の最新拡張設計（`2026-04-26-justice-expansion-design.md`）や既存仕様に既に「種」として存在しています。
* **V3-04 Review Memory / V3-05 Failure Intelligence**: 現在の仕様でも、`ReviewRejectionDetector` がPrometheus（レビュアー）の却下を検知し、`LearningExtractor` がエラー原因から学習草案（`failure_gotcha` など）を抽出する仕組みがあります。
* **V3-08 Multi-Project Knowledge Base**: `TieredWisdomStore` によって、プロジェクトローカル（`.justice/wisdom.json`）とグローバル（`~/.justice/wisdom.json`）の2層で知見を共有・蓄積する設計が既に拡張案として進められています。


* **助言**:
* 既存の `WisdomStore`（知恵の蓄積）や `TelemetryStore`（分析） の基盤をそのまま v3 の `Review Memory` や `Failure Intelligence` の土台として活用できます。
* 一方で、「V3-01 Requirement Graph」や「V3-02 Traceability」は全く新しい概念です。これを実現するためには、上流（Superpowersの思考レイヤー）が要求仕様（Requirement）を構造化して出力するスキルの実装も併せて必要になります。



### 総評とネクストアクション

ご提案の要件定義は、Justiceのロードマップとして**現在の拡張設計（v2026.04.26）のさらに先を見据えた完璧なブループリント**です。

リポジトリの改修方針として、以下のように既存の設計書をアップデートすることをお勧めします。

1. **現在の拡張設計（Phase 1~4）の再配置**: `2026-04-26-justice-expansion-design.md` で定義されている「Wisdomのグローバル化」や「Telemetry（分析）」は、ご提案のロードマップにおける **「v3への準備段階（v2.5）」** または **「v3の一部機能の先行実装」** として位置付け直すのが綺麗です。
2. **v2の最優先実装**: ご提案の通り、まずは既存の「タスク委譲（Delegation Bridge）」の次に、v2のコアである **Gate Engine（特にTask GateとPhase Gate）** の実装要件を最優先の機能要件として定義書に組み込むべきです。これにより、「動くが壊れる」問題への即効性のある対処が可能になります。

---

# chatgpt response

レビュー文はかなり具体的ですが、リポジトリ内の `SPEC.md` や拡張設計への言及は、こちらで確認しないと事実性を断定できません。まず公開情報ベースで確認し、妥当性・過剰主張・要修正点に分けて評価します。

評価: **概ね妥当。ただし一部は事実確認不能または過剰表現です。**

## 妥当な指摘

レビューの中核は正しいです。

- Justiceは既に「Superpowersとoh-my-openagentを繋ぐ神経系プラグイン」と明記されています。([GitHub](https://github.com/yohi/justice))
- 現行仕様は `plan.md` を解析し、未完了Taskを検出し、`task()` へ委譲し、結果で `plan.md` を更新する構造です。つまり現状は **Task委譲・フィードバック中心** です。([GitHub](https://github.com/yohi/justice/blob/master/SPEC.md))
- `Gate` という概念は現行 `SPEC.md` 上では見当たらないため、「品質基準を満たしているかの検証が弱い」という指摘は妥当です。([GitHub](https://github.com/yohi/justice/blob/master/SPEC.md))
- `PostToolUse` を拡張してTask完了後のGateを起動する案は、既存仕様が `PostToolUse` でフィードバック処理・レビュー却下検知をしているため自然です。([GitHub](https://github.com/yohi/justice/blob/master/SPEC.md))

## 特に重要な指摘

**`.justice/mission.json` と `plan.md` の二重管理リスク** はかなり重要です。

ここはレビュー指摘に同意します。  
JusticeはSuperpowersの `plan.md` を主マニフェストとして扱い、`mission.json` は派生状態だけに限定すべきです。

推奨:

```text
plan.md = Source of Truth
.justice/state.json = 実行状態・Gate履歴・証跡への参照
.justice/evidence/ = 実行証跡
.justice/gates/ = 品質条件
```

## 一部注意が必要な指摘

`ReviewRejectionDetector` と `LearningExtractor` が既にある、という指摘は確認できます。`ReviewRejectionDetector` はPrometheusレビュー却下を検出し、`LearningExtractor` もexportされています。([GitHub](https://github.com/yohi/justice/blob/master/SPEC.md))

`TieredWisdomStore` も確認できます。ローカル/グローバルの2層Wisdom、秘密情報検出、ローカル優先取得が仕様化されています。([GitHub](https://github.com/yohi/justice/blob/master/SPEC.md))

ただし、`TelemetryStore` は公開 `SPEC.md` では見つかりませんでした。([GitHub](https://github.com/yohi/justice/blob/master/SPEC.md))  
また、`2026-04-26-justice-expansion-design.md` は公開 `docs/plans` 一覧では確認できませんでした。見えているのは `2026-03-25-*` の2ファイルのみです。([GitHub](https://github.com/yohi/justice/tree/master/docs/plans))

なので、このレビューのうち以下は **保留** です。

- `2026-04-26-justice-expansion-design.md` に基づく主張
- `TelemetryStore` の存在
- 「完璧なブループリント」という評価

## 結論

このレビューは **方向性レビューとしては採用してよい** です。

ただし要件定義へ反映する際は、次のように補正すべきです。

```text
採用:
- v2/v3分離
- v2最優先は Gate Engine
- plan.mdをSource of Truthにする
- WisdomStore / TieredWisdomStoreをv3基盤として再利用

保留:
- TelemetryStore前提
- 2026-04-26設計書前提
- mission.jsonを主状態にする設計

修正:
- mission.jsonではなく state.json / gate-status.json 的な派生状態にする
```

一番価値ある指摘は、**「plan.mdをミッションのマニフェストとして扱え」** です。これは必ず要件定義に反映すべきです。

---

# you asked

message time: 2026-06-12 22:17:56

反映させた要件定義資料を再生成して

---

# chatgpt response

# Justice v2/v3 要件定義書（改訂版）

## Executive Summary

JusticeはOpenCode上で動作する品質保証プラグインである。

Justice自身は以下を行わない。

- 設計生成
- 実装
- レビュー
- TDD実施

これらは既存エコシステムへ委譲する。

```text
superpowers
→ 思考・設計・TDD

oh-my-openagent
→ 実装・レビュー・マルチエージェント実行

justice
→ 品質保証・状態追跡・検証
```

Justiceの役割は、

> 「Taskは成功したがFeatureが失敗した」

というAI開発で最も頻発する問題を防ぐことである。

---

# 背景

現状のJusticeは、

- Plan Parser
- Task Delegation
- Task Feedback
- Wisdom

を中心に構成されている。

しかし品質保証は主に以下に依存している。

```text
Unit Test
PR Review
CodeRabbit
Greptile
```

その結果、

```text
Task単位
→ 正しい

Phase単位
→ 正しい

Feature全体
→ 壊れている
```

が発生する。

---

# 設計原則

## Principle 1

plan.mdを唯一の真実源(Source of Truth)とする

Justiceは計画を管理しない。

計画はSuperpowersが管理する。

---

### Source of Truth

```text
plan.md
design.md
adr/*
```

---

### Justiceが保持するもの

```text
.justice/
```

配下の

- 状態
- 証跡
- Gate結果

のみ。

---

## Principle 2

責務を奪わない

Justiceは既存Pluginを置き換えない。

---

| 領域 | 担当 |
|--------|--------|
| 設計 | superpowers |
| 実装計画 | superpowers |
| TDD | superpowers |
| 実装 | oh-my-openagent |
| レビュー | oh-my-openagent |
| 品質保証 | justice |

---

## Principle 3

TaskではなくFeature品質を保証する

Justiceの最終責務は

```text
Task Success
≠
Feature Success
```

を検出することである。

---

# アーキテクチャ

```text
OpenCode
│
├── superpowers
│      ├─ brainstorming
│      ├─ writing-plans
│      └─ TDD
│
├── oh-my-openagent
│      ├─ Implementer
│      ├─ Reviewer
│      ├─ Security
│      └─ QA
│
└── justice
       ├─ State Layer
       ├─ Gate Layer
       ├─ Evidence Layer
       ├─ Review Layer
       └─ Verification Layer
```

---

# Justice v2

## 目的

Quality Coordination Layer

品質保証の神経系を実現する。

---

# FR-001 State Layer

## 目的

現在状態の追跡

---

保存先

```text
.justice/state.json
```

※ plan.mdは参照のみ

---

管理対象

```json
{
  "current_phase": "",
  "current_task": "",
  "current_branch": "",
  "active_prs": [],
  "gate_status": {}
}
```

---

## 非目的

以下は保持しない。

```text
設計内容
実装計画
タスク定義
```

---

# FR-002 Skill Awareness

## 目的

利用可能資産の把握

---

収集対象

### superpowers

```text
brainstorming
writing-plans
using-git-worktrees
```

---

### oh-my-openagent

```text
implementer
reviewer
security-reviewer
qa-reviewer
```

---

## 役割

監視のみ

実行しない

---

# FR-003 Handoff Tracking

## 目的

Agent間引継ぎ追跡

---

保存先

```text
.justice/handoffs
```

---

記録

```json
{
  "from": "",
  "to": "",
  "task": "",
  "timestamp": ""
}
```

---

# FR-004 Evidence Engine

## 目的

証跡収集と信頼境界の記録

---

### 保存先

```text
.justice/evidence
```

---

### 証跡スキーマ

```json
{
  "evidence_id": "",
  "source_class": "tool_output",
  "provenance": "observed",
  "observed_by": "",
  "observed_at": "",
  "tool_call_id": "",
  "command": "",
  "exit_code": 0,
  "stdout": "",
  "stderr": "",
  "interpretation": {
    "outcome": "pass",
    "basis": "parsed_output"
  }
}
```

---

### 信頼境界

- `observed` / `derived` のみ PASS 判定に使用する
- `declared` / `manual` / `unknown` は Justice 自身が観測していないため PASS にしない
- Agent の自己申告値と Justice の観測値は別フィールドで保持する

---

# FR-005 Gate Engine

## v2最優先機能

---

目的

テストPassではなく品質を確認する。

---

## Gate種類

### Task Gate

確認

```text
Acceptance Criteria
Required Tests
Evidence
Review
```

---

### Phase Gate

確認

```text
Integration
Cross Task Consistency
Review Resolution
```

---

### Feature Gate

確認

```text
Design Consistency
Plan Consistency
E2E
Regression
Negative Criteria
```

---

## 判定モデル

```text
PASS / WARN / FAIL
```

### Advisory ルール

- PASS: 要件を満たした証跡として記録する
- WARN: 警告として記録し、後続のレビューや人間確認に回す
- FAIL: 失敗として記録するが、Feature 実行は停止せず advisory として扱う

---

## 実装方針

既存PostToolUseフックを拡張して実装する。判定・警告・証跡化は advisory として扱い、FAIL でも Feature 実行は止めない。

---

# FR-006 Review Aggregator

## 目的

レビュー統合

---

入力

```text
Security Review
Architecture Review
Dataflow Review
Test Review
```

---

出力

```json
{
  "critical": [],
  "major": [],
  "minor": [],
  "resolved": [],
  "open": []
}
```

---

# FR-007 Final Verifier

## v2の最終機能

---

目的

Feature品質保証

---

確認対象

### 設計

```text
design.md
```

---

### 計画

```text
plan.md
```

---

### 実装

コードベース

---

### E2E

データフロー

---

### Regression

既存仕様

---

### 未解決レビュー

Open Issues

---

結果

```text
Release Ready
Not Ready
```

---

# OpenCode Commands

```text
/justice-status
/justice-gate
/justice-review
/justice-verify
```

---

# OpenCode Hooks

```text
tool.execute.before
tool.execute.after
chat.message
chat.params
experimental.session.compacting
experimental.text.complete
```

OpenCode で実際に使えるフック名のみを列挙し、`SessionStart` / `AgentStart` / `AgentComplete` / `GitCommit` / `PRCreate` / `SessionEnd` のような旧来の擬似名は使わない。

---

# v2 成功指標

## KPI-1

Feature完成後の設計乖離

```text
50%以上削減
```

---

## KPI-2

Feature完成後の不具合

```text
30%以上削減
```

---

## KPI-3

Agent間コンテキスト欠落

```text
80%以上削減
```

---

# Justice v2.5

## 位置付け

v3準備フェーズ

---

既存Wisdom系を統合

---

## Wisdom統合

既存

```text
WisdomStore
TieredWisdomStore
```

を標準化

---

## Learning統合

既存

```text
ReviewRejectionDetector
LearningExtractor
```

を標準化

---

成果物

```text
.justice/wisdom
```

---

# Justice v3

## 位置付け

Quality Kernel

---

目的

品質保証を学習可能システムへ進化させる

---

# V3-01 Requirement Graph Engine

## 新規機能

---

管理

```text
Business Requirement
Feature Requirement
NFR
Acceptance Criteria
```

---

保存

```text
.justice/requirements
```

---

例

```yaml
REQ-001:
  title: OAuth Login
  acceptance:
    - Google Login Success
    - Session Persistence
```

---

# V3-02 Traceability Engine

## 新規機能

---

追跡

```text
Requirement
↓
Design
↓
Plan
↓
Task
↓
PR
↓
Commit
↓
Test
```

---

出力

```text
.justice/traceability
```

---

# V3-03 Coverage Analyzer

## 新規機能

コードカバレッジではなく

要求カバレッジを測定

---

確認

```text
Requirement Coverage
Design Coverage
Plan Coverage
Test Coverage
```

---

# V3-04 Review Memory

## v2.5基盤活用

利用

```text
WisdomStore
TieredWisdomStore
```

---

管理

```text
Recurring Bug
Architecture Smell
Security Findings
```

---

# V3-05 Failure Intelligence

## v2.5基盤活用

利用

```text
ReviewRejectionDetector
LearningExtractor
```

---

分析

```text
なぜ漏れたか
どのGateで防げたか
```

---

# V3-06 Adaptive Gate

## 新規機能

AIがGateを動的生成

---

例

```text
認証変更
↓
Security Gate追加

DB変更
↓
Migration Gate追加

決済変更
↓
Payment Gate追加
```

---

# V3-07 Release Readiness Score

入力

```text
Gate
Coverage
Review
Evidence
Regression
```

---

出力

```text
Release Score
0-100
```

---

# V3-08 Multi-Project Knowledge Base

## v2.5基盤拡張

共有対象

```text
成功パターン
失敗パターン
レビュー知識
```

---

保存

```text
Project Local
Global
```

---

# 実装優先順位

## Phase A

Justice v2

```text
State Layer
Evidence Engine
Gate Engine
Final Verifier
```

---

## Phase B

Justice v2.5

```text
Wisdom統合
Learning統合
```

---

## Phase C

Justice v3

```text
Requirement Graph
Traceability
Coverage
Release Score
```

---

## Phase D

Justice v3.5

```text
Adaptive Gate
Failure Intelligence高度化
Knowledge Federation
```

# 最終ゴール

Justiceは開発エージェントではない。

Justiceは、

```text
superpowers = 頭脳
oh-my-openagent = 手足
justice = 神経系
```

から、

```text
superpowers = 頭脳
oh-my-openagent = 手足
justice = 神経系 + 免疫系
```

へ進化する。

その最終目的は、

**「Task成功」ではなく「Feature成功」を保証する品質カーネルになること**である。

---

# you asked

message time: 2026-06-16 14:23:51

Justice v2/v3 要件定義レビュー（統合版）
結論（Verdict）
狙っている問題（"Task成功 ≠ Feature成功" の検出）は正しい。3システムの責務分離も健全。 しかし要件書は、現 Justice アーキテクチャの観測不足から 3件の致命的な前提誤りを含み、このままでは v2 Phase A が着工段階で破綻します。最大の矛盾は「fail-open な観測プラグインが品質ゲートを強制する」という構造的不整合で、これは哲学レベルの選択を迫る問題です。
評価できる点（先に正当に）
- 問題設定が的確: Unit/PR/CodeRabbit が Task/Phase 単位で緑でも Feature が壊れる、という観察は AI 開発の核心的失敗パターンを突いている。
- 責務非侵食（P2）の思想: superpowers=設計/TDD、OmO=実装/レビュー、justice=QA という分離は、既存エコシステムとの共存設計として正しい。
- 既存資産の再利用: v2.5/v3 が WisdomStore/TieredWisdomStore/ReviewRejectionDetector/LearningExtractor を土台にする方針は妥当。
FATAL（着工前に必須解決）3件
FATAL-1: 要求フックの大半が存在しない（裏取り済み）
@opencode-ai/plugin の型定義 (file:///home/y_ohi/program/private/justice/node_modules/@opencode-ai/plugin/dist/index.d.ts#L170-L313)を実地確認した結果:
要件書の主張フック	実在
SessionStart / SessionEnd	❌ 存在しない
AgentStart / AgentComplete	❌ 存在しない
GitCommit / PRCreate	❌ 存在しない（Git/GitHub は OpenCode 外）
PostToolUse	△ tool.execute.after として実在するが、現 adapter は task のみ転送 (file:///home/y_ohi/program/private/justice/src/runtime/opencode-adapter.ts#L248)
→ FR-003 (Handoff)、FR-004 (Evidence: git/exit_code)、FR-005 (Gate: "PostToolUse 拡張") の前提が全崩壊。実在するのは event / chat.message / tool.execute.before|after / command.execute.before / permission.ask / compaction 系のみ。
FATAL-2: ゲートを強制する手段がない（ただし重要な留保あり）
Justice 内部の HookResponse は proceed | skip | inject のみで block/abort が無い（SPEC.md L155 (file:///home/y_ohi/program/private/justice/SPEC.md#L155)）。Gate が FAIL を返してもワークフローを止められない。さらに Fail-Open + Gate-Closed は論理矛盾（ゲートロジックが例外→fail-open でゲート自動通過＝無価値）。
［私の裏取りによる留保］ OpenCode API には唯一の強制プリミティブ permission.ask（deny 返却可） が実在します。しかしこれは、
1. 現 adapter が未配線、
2. deny = fail-closed で原則と衝突、
3. ツール呼び出し粒度でしか発火せず「Feature 完成」イベントが無い → Feature Gate / Phase Gate の強制は粒度的に原理不可能。
→ つまり「強制ゲート」はプラグイン層では Feature 単位で実現できない。結果的に「Gate = Advisor（説得器）」への再定義が唯一現実的、と裏取りが補強します。
FATAL-3: Evidence の信頼モデルが自己申告問題を解いていない
動機は「エージェントの自己報告を信じない」こと。なのに FR-004 は {command, exit_code} をエージェント報告から収集する。エージェントが exit_code:0 と偽れば PASS が記録される。監視対象と同一ソースから証拠を取る限り信頼問題は解けない。 「誰が独立してテスト/E2E を実行するか」が完全に未定義。
MAJOR 設計緊張点と推奨解決策
#	緊張点	推奨解決
T-1	Fail-Open vs Gate-Closed	Gate を Quality Persuader に再定義。FAIL は inject で強警告＋バナー（既存の Atlas/Prometheus 誘導と同型）。KPI を「防止率」→「検出率＋早期警告率」へ
T-2	P1(plan.md=SoT) vs V3-01(要件をjusticeが著作)	V3-01 をリンカーに限定。要件本体は superpowers ドメイン、justice は ID↔task/PR/commit の紐付けのみ .justice/traceability/ に保持
T-3	Pure Core vs V3-06(AI動的ゲート生成)	ゲートは静的宣言(YAML/JSON)。AI は候補提案のみ、人間が .justice/gates/ にコミット→決定論的に評価
T-4	FR-001 State Layer のドリフト	state.json を追記型ジャーナルへ。branch/PR はキャッシュせず git/外部から live クエリ（justice は観察者であり状態所有者でない）
T-5	Evidence の構造的不完全性	「観測境界」を明示し、境界外は manual annotation 設計に含める。completeness を主張せず coverage を明示
FR/V3 別 実現可能性判定（統合）
ID	判定	要点
FR-001 State	△ 条件付き	ジャーナル設計なら可。複製キャッシュは不可
FR-002 Skill Awareness	○（低価値）	既知パス read で可
FR-003 Handoff	△ 条件付き	Agent系フック無し→task() Pre/Post から近似
FR-004 Evidence	✕ 仕様通り不可	git証拠不可。bash/test 観測には adapter のスコープ拡張必須
FR-005 Gate	✕ 仕様通り不可	Phase/Feature Gate 強制は不可。Task Advisory Gate なら△
FR-006 Review Aggregator	○	ReviewRejectionDetector の自然な拡張
FR-007 Final Verifier	△	Checklist Injector として可。独立実行は不可
V3-01 Requirement Graph	✕→△	linker 縮小なら可。著作は P1 矛盾
V3-02 Traceability	△	Task→Req は可。Task→PR は観測ギャップ
V3-03 Coverage	△	要求/計画 coverage 可。test coverage 不可
V3-04 Review Memory	○	WisdomStore 拡張
V3-05 Failure Intelligence	○	既存抽出器の拡張
V3-06 Adaptive Gate	✕→△	静的ルール化すれば可
V3-07 Release Score	△	観測ギャップで必ず不完全。明示すれば可
V3-08 Multi-Project KB	○	TieredWisdomStore 直接拡張
要件書に欠落しているもの
1. 強制モデル未定義 — FAIL 時に何が起きるか、エージェントが無視したらどうなるか（核心が空白）
2. 独立検証の実行主体未定義 — E2E/regression を誰が実際に走らせるか（OmO委譲/CI/人間チェックポイント）
3. 並行書き込み安全性に無言 — Team Mode は1ワークツリーで並列エージェント。saveAtomic(temp+rename) は単一プロセス保証のみ。state/handoffs/evidence は last-write-wins で破損リスク → JSONL 追記 or ロック戦略が必要
4. スキーマ・バージョニング戦略なし（新 .justice/ 群の v2→v3 互換）
5. NFR 欠如 — 全ツール監視のレイテンシ予算、evidence の容量上限・保持期間
6. セキュリティ — evidence にシークレット混入（SecretPatternDetector 適用拡張）、V3-01 YAML の injection 面、state.json 改ざん耐性
7. コマンド登録機構未確認 — /justice-* は command.execute.before(傍受) と tool(カスタムツール) は実在するが、登録方式の明確化が必要
推奨リーンパス（8→4フェーズへ圧縮）
- Phase 0（前提解消・1日以内）: 利用可能フック確定（済）／Advisor vs Enforcer の決定／観測スコープ拡張方針＋レイテンシ計測
- Phase 1（v2.0スリム・1〜2週）: adapter の task フィルタ拡張で bash/test 観測 ＋ state.json ジャーナル ＋ Task-level Advisory Gate のみ ＋ Review Aggregator
- Phase 2（v2.5・1〜2週）: Handoff(task Pre/Post 由来) ＋ Evidence(出力パース) ＋ Final Verifier(Checklist Injector)
- Phase 3（v3 Core・3週〜）: Traceability(linkerのみ) ＋ Review Memory/Failure Intelligence ＋ Release Score(不完全明示)
- Drop/Defer: V3-01(superpowers ドメインへ) / V3-06(静的化まで保留) / V3-08(既存拡張で吸収)
補足（軽微）
要件書および SPEC.md L9 (file:///home/y_ohi/program/private/justice/SPEC.md#L9) の外部リンクが誤り: github.com/oh-my-openagent/superpowers → 正しくは obra/superpowers、github.com/oh-my-openagent → code-yeongyu/oh-my-openagent（前回確認済み）。
最重要の意思決定（ここが分岐点）
このレビューで最も決定的なのは次の一点です。先送りすると設計全体が不確定なままになります。
Justice の Gate は「Advisor（説得器）」か「Enforcer（強制器）」か。
- Advisor → fail-open プラグインのまま実現可能。本レビューの推奨。「強制」ではなく「検出＋強い誘導」。
- Enforcer → プラグイン層では Feature 単位の強制は原理不可能。OmO の task dispatch 層への統合（＝プラグインを超える）が必要。
どちらを採るかをお決めいただければ、それに沿って要件書の修正案（または Phase 0/1 の実装計画）を具体化します。

---

# chatgpt response

これは非常にレベルの高いレビューです。

結論から言うと、

> **90%は採用すべきです。**
> **ただし、「JusticeはAdvisorしかなれない」という結論だけはまだ早い**と思います。

以下、AI Agentアーキテクチャ設計の観点から評価します。

---

# 総合評価

|項目|評価|
|----|----|
|OpenCode Plugin理解|★★★★★|
|現Justice理解|★★★★★|
|責務分離|★★★★★|
|要件定義レビュー|★★★★★|
|ロードマップ評価|★★★★★|
|AI Agent設計|★★★★☆|

非常に良いレビューです。

ただし最後だけ少し意見が違います。

---

# FATAL-1

> OpenCode Hookが存在しない

## 100%採用

これは完全に採用です。

これはレビューではなく

**事実**

だからです。

要件定義では

```
SessionStart
SessionEnd
GitCommit
PRCreate
```

などを書いていましたが、

これはOpenCode Plugin APIに存在しないなら削除しなければいけません。

ここは修正必須です。

---

# FATAL-2

これが一番重要です。

レビューは

> GateはAdvisorであるべき

と言っています。

私は

**現状のOpenCode Plugin APIではそうなる**

には賛成です。

しかし

> Justiceの設計思想としてAdvisor

には反対です。

ここは区別すべきです。

---

Justiceには

**Concept**

と

**Implementation**

があります。

Conceptは

```
Justice
=
Quality Kernel
```

です。

一方

OpenCode Pluginでは

```
Advisor
```

しか実装できない。

つまり

```
Concept

Justice
=
Enforcer capable

↓

Current implementation

OpenCode Plugin
=
Advisor
```

です。

つまり

```
v2

Advisor

↓

将来

OpenCode API拡張

↓

Enforcer
```

というRoadmapにすべきです。

レビューでは

「Advisorしかない」

と言っていますが、

それは

**現状の実装制約**

であって

**プロダクト思想**

ではありません。

ここは修正します。

---

# FATAL-3

これも100%採用。

Evidence問題です。

これは私も前回少し気になっていました。

今の要件では

```
Agent

↓

exit_code

↓

Justice
```

になっています。

つまり

Agentが嘘を付けます。

これはEvidenceではありません。

本当に欲しいのは

```
Justice

↓

bash tool

↓

stdout

↓

Justice
```

です。

つまり

Justice自身が観測したものだけをEvidenceにします。

ここはかなり重要。

---

# T-1

Fail Open

vs

Gate

これも賛成です。

ただし

名前だけ変えたい。

レビューでは

```
Quality Persuader
```

となっています。

私は

```
Quality Advisor
```

では弱いと思います。

Justiceの立場は

```
Quality Arbiter
```

が近い。

つまり

```
判定する

止めない
```

です。

停止はしない。

でも

判定はJustice。

---

# T-2

これも賛成。

Requirementは

Justiceが持つべきではない。

これはSuperpowers。

Justiceは

```
REQ-001

↓

Task

↓

PR

↓

Review
```

だけ管理。

これで責務が綺麗になります。

---

# T-3

Adaptive Gate

これも100%賛成。

AIがGateを生成すると

決定論が失われます。

私は

```
AI

↓

Proposal

↓

Human

↓

gate.yaml
```

が正しいと思います。

---

# T-4

state.json

これも賛成。

Justiceは

状態管理ではなく

**イベントログ**

であるべき。

つまり

```
state.json
```

より

```
events.jsonl
```

の方が設計が綺麗です。

例えば

```
Task Started

↓

Task Finished

↓

Review Requested

↓

Review Finished

↓

Gate PASS
```

これなら

いつでもState再構築できます。

イベントソーシングになります。

私はこちらを推します。

---

# T-5

Evidence

これも100%賛成。

Justiceは

「全部見える」

ではなく

```
Observation Boundary
```

を持つべき。

つまり

```
Observed

Not Observed

Declared

Unknown
```

を区別します。

これはかなり良い指摘。

---

# 一番重要

レビューでは

```
Justice

↓

Observer
```

になっています。

私は

ここだけ違います。

Justiceは

Observerではありません。

---

Justiceは

```
Observer

+

Coordinator

+

Quality Arbiter
```

です。

つまり

```
State

Evidence

Review

Gate

Verification
```

を統括します。

だから

Observerより一段責務が広い。

---

# 私ならRoadmapをこう直す

```
Justice v2

Quality Coordinator

Advisor implementation

↓

Justice v2.5

Evidence Engine

Event Store

↓

Justice v3

Quality Kernel

↓

Justice v4

Policy Engine

↓

Justice v5

Quality Operating System
```

つまり

最終目標は

Advisorではなく

Policy Engine。

---

# このレビューで唯一反対する点

ここだけ。

レビューでは

```
Justice

=

Observer
```

寄りになっています。

私は違います。

Justiceは

```
Quality Coordination Layer
```

です。

だから

```
State

Gate

Evidence

Verification

Review aggregation
```

は持ちます。

---

# 最終評価

私はこのレビューを **A+（95/100）** と評価します。

**採用すべき点（約95%）**
- OpenCode Plugin APIに存在しないフックを削除する
- `plan.md` を唯一のSource of Truthとする
- Gateは現状では強制できないことを要件に明記する
- Evidenceは「自己申告」ではなく「Justiceが直接観測した事実」と「宣言情報」を区別する
- `Requirement Graph` はJusticeではなくSuperpowers側の責務とし、Justiceはトレーサビリティのみ担当する
- `Adaptive Gate` はAIによる提案→人間承認→静的ルール化に変更する
- イベントジャーナル（JSONL）ベースへの移行を検討する
- NFR（並行性・スキーマ・保持期間・セキュリティ）を追加する

**私が修正したい点（約5%）**
- Justiceの長期ビジョンは「Advisor」ではなく**Quality Coordination Layer**として維持する。
- **v2実装ではAdvisorとして振る舞う**が、それはOpenCodeプラグインAPIの制約による実装形態であり、プロダクト全体の設計思想ではないことを要件定義に明記する。

この修正により、**短期の実装可能性と長期のアーキテクチャビジョンを両立**できる要件定義になります。
