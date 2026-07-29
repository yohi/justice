# TDD Develop Flow — Refined Future Note

この文書は、リポジトリ直下の [`tdd-develop-flow.md`](../../tdd-develop-flow.md) に書かれている開発フローを、README の Future に載せる前提で少し整理したものです。実装済みの仕様書ではなく、将来の品質改善ロードマップです。

## 1. 現在の開発フロー

現状は、次の prompt-free・レビュー製品非依存の流れで開発を回す。

1. 利用者が `/justice-start` に目標と設計・計画の成果物パスを渡す
2. Justice の synthetic directive に従い、`brainstorming` と `writing-plans` で設計・計画を準備する
3. `plan_ready` では成果物の読み取り準備ができたものとして、設計・計画だけの PR と利用可能な AI レビューを進める。これは実装認可ではない
4. エージェントが既存の権限で PR・レビュー機能を実行し、指摘を修正して同じレビューを再実行する
5. 人間が設計・計画を明示的に承認してマージする
6. 外部での承認・マージ確認後にエージェントが `task()` へ委譲し、Justice がプランコンテキスト、実装用 `loadSkills`、実装 PR・レビュー指示を追加する
7. Task 単位の実装 PR でも利用可能な AI レビューを行い、必要なら修正して再レビューする
8. 人間が実装 PR の承認・マージを判断し、全 Phase で繰り返す

利用者は PR 作成やレビュー依頼の定型プロンプトをコピーしたり入力したりしない。Justice 自身は PR を作成せず、レビューを承認せず、PR をマージせず、それらの状態を推測しない。

## 2. うまくいっている点

- 設計 → 計画 → 実装 → レビューの分割が明確
- Phase / Task で小さく進められる
- Devcontainer 前提で検証条件を揃えやすい
- `justice` によるブリッジと学習の余地がある

## 3. 今の問題意識

最大の課題は、**Task や Phase のテストが通っても、最終成果物や Feature 全体が壊れる** こと。

具体的には次の不足がある。

- 局所テストはあるが、Feature 全体の完了条件が弱い
- `乖離確認` が最後にしか効かず、手戻りが大きい
- レビュー指摘が知識として蓄積されにくい
- `justice` が「橋渡し」以上の役割を十分に担えていない

## 4. 将来の改善方針

### 4.1 Feature-level の Final Verification

Task 成功と Feature 成功を分けて扱う。

- Task Gate: その Task の完了条件
- Phase Gate: Phase 間の整合性
- Feature Gate: E2E、回帰、データフロー、負の条件まで含めた最終判定

### 4.2 Eval Gate の導入

実装前に、以下を明文化する。

- Acceptance Criteria
- Negative Criteria
- Verification Commands
- Required Tests
- Human Review Points
- Evidence Required

### 4.3 justice の役割強化

justice は実装や設計を奪うのではなく、次を担う。

- 状態共有
- 引継ぎ管理
- 証跡収集
- Advisory 判定・警告・証跡化
- レビュー集約
- 最終検証の呼び出し

## 5. Roadmap の見え方

- **v2**: Quality Coordination Layer
  - Task / Phase の品質、証跡、レビューを L0 Advisory として扱う
  - prompt-free な段階別 directive を注入する
- **v2.5**: Handoff / Trusted Approval Artifacts
  - サブエージェント実行結果と、外部の人間による承認・マージ成果物を相関する
  - Handoff と信頼済み承認成果物が揃った後にだけ `implementation_authorized` を導出する
- **v2.5+**: Final Verifier / Acceptance Criteria
  - Feature-level Final Verification と Acceptance Criteria 判定は引き続き将来対応とする
- **v3**: Traceability / Coverage
  - 要求から設計・計画・実装・テストまで追跡する
- **v3.5**: Adaptive Gate
  - AI が候補を提案し、人間が承認した静的ルールとしてのみ適用する
  - 自動適用や動的適用はしない

## 6. まだ未解決の前提

- v2 では Gate を強制せず、助言に留める。強制が必要かは将来の Policy Engine で再検討する。
- `plan_ready` / `plan_activated` は成果物準備・監査状態であり、実装認可ではない。
- PR の作成・承認・マージ状態を、どの trusted approval artifact から確定するか。
- どのイベントを実際に観測できるのか
- 証跡を誰がどう集めるのか
- 追記型の状態管理をどう安全に保つか
- 秘密情報を証跡に混ぜない設計をどう保証するか

## 7. まとめ

このフローの本質は、**Task が通ったかではなく Feature が本当に完成したか** を見ることにある。
そのために、README の Future では「将来の品質保証レイヤー」を示し、この文書でその前提と方向性を少し詳しく整理している。
