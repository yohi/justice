# TDD Develop Flow — Refined Future Note

この文書は、リポジトリ直下の [`tdd-develop-flow.md`](../../tdd-develop-flow.md) に書かれている開発フローを、README の Future に載せる前提で少し整理したものです。実装済みの仕様書ではなく、将来の品質改善ロードマップです。

## 1. 現在の開発フロー

現状は、次の流れで開発を回している。

1. `superpowers/brainstorming` で設計書を作る
2. 設計 PR を CodeRabbit / Greptile でレビューする
3. `実装計画作成プロンプト` で計画を書く
4. 計画 PR をレビューする
5. `実装用プロンプト` で Phase 単位に実装する
6. Task 単位で PR を切ってレビューする
7. `乖離確認用プロンプト` で設計・計画・実装の差分を確認する
8. 必要なら修正して再レビューする
9. これを全 Phase で繰り返す

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
  - Task / Phase / Feature の品質を揃える
  - 証跡とレビューを扱う
- **v2.5**: Evidence / Wisdom の強化
  - 失敗とレビュー指摘を学習に使う
- **v3**: Traceability / Coverage
  - 要求から設計・計画・実装・テストまで追跡する
- **v3.5**: Adaptive Gate
  - AI が候補を提案し、人間が承認した静的ルールとしてのみ適用する
  - 自動適用や動的適用はしない

## 6. まだ未解決の前提

- v2 では Gate を強制せず、助言に留める。強制が必要かは将来の Policy Engine で再検討する。
- どのイベントを実際に観測できるのか
- 証跡を誰がどう集めるのか
- 追記型の状態管理をどう安全に保つか
- 秘密情報を証跡に混ぜない設計をどう保証するか

## 7. まとめ

このフローの本質は、**Task が通ったかではなく Feature が本当に完成したか** を見ることにある。
そのために、README の Future では「将来の品質保証レイヤー」を示し、この文書でその前提と方向性を少し詳しく整理している。
