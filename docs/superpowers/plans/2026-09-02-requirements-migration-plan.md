# REQUIREMENTS 文書統合実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一時的な `REQUIREMENTS*` 文書の内容を正式な仕様・保守文書へ統合し、元ファイルを削除する。

**Architecture:** 現行実装の契約は `SPEC.md` を正とし、未実装要求は将来要求として明示する。upstream compatibility audit は `docs/agents/upstream-drift.md` に集約し、README は保守文書への導線だけを持つ。

**Tech Stack:** Markdown、Bun、Vitest、TypeScript、ESLint

## Global Constraints

- 現行実装と未実装の将来要求を同じ契約として記載しない。
- upstream の互換性はコード・テスト・ドキュメントを根拠に判定する。
- 既存のプロジェクト文書構造とリンクを維持する。
- 完了前に `bun run test`、`bun run typecheck`、`bun run lint`、`bun run build` を実行する。Devcontainer 内での実行を完了条件とし、Devcontainer が利用できない場合のホスト実行はフォールバック証跡として記録するが、Devcontainer の完了条件を満たしたものとは扱わない。

---

### Task 1: 要件の正式文書への統合

**Files:**
- Modify: `SPEC.md`
- Modify: `docs/agents/upstream-drift.md`
- Modify: `README.md`
- Create: `docs/superpowers/specs/2026-09-02-requirements-migration-design.md`

**Interfaces:**
- `SPEC.md` は現行仕様と将来要求の状態を表す。
- `docs/agents/upstream-drift.md` は upstream audit の対象と再検証手順を表す。
- `README.md` は保守文書へリンクする。

- [x] **Step 1: 現行仕様と要求の差分を分類する**

`REQUIREMENTS_2026-08-29.md` の routing 契約は現行 `SPEC.md` と重複するものとして扱い、FR-601〜FR-604 は現行 one-shot arm と異なる将来要求として分類する。`REQUIREMENTS_2026-08-19.md` は upstream audit の保守手順として分類する。

- [x] **Step 2: 正式文書へ転記する**

`SPEC.md` §15.13 に責務境界と FR-601〜FR-604 の保留状態を記録する。`docs/agents/upstream-drift.md` に対象 branch、歴史的 baseline、監査範囲、再検証手順を記録する。`README.md` のドキュメント一覧に保守文書へのリンクを追加する。

- [x] **Step 3: 一時文書を削除する**

次の2ファイルを削除する。

```text
REQUIREMENTS_2026-08-19.md
REQUIREMENTS_2026-08-29.md
```

### Task 2: 文書整合性とプロジェクト検証

**Files:**
- Verify: `SPEC.md`
- Verify: `README.md`
- Verify: `docs/agents/upstream-drift.md`
- Verify: `docs/superpowers/specs/2026-09-02-requirements-migration-design.md`

**Interfaces:**
- 削除済み `REQUIREMENTS*` へのリンクや、現行仕様と矛盾する plan-scoped authorization の記述を残さない。
- Devcontainer 内の Bun コマンドを完了条件とする。Devcontainer が利用できなかった場合は、ホスト実行の結果と理由を記録し、Devcontainer 完了条件を未達として残す。

- [x] **Step 1: プレースホルダーと残存参照を確認する**

`TBD`、未完了の `TODO`、削除済み要件ファイルへの不要なリンクを検索し、将来要求を保留として明示した箇所だけを許容する。

- [x] **Step 2: 開発コマンドを実行する（ホスト・フォールバック）**

```bash
bun run test
bun run typecheck
bun run lint
bun run build
```

実行環境: ホスト。Devcontainer が利用できなかったため、4コマンドをホスト上で実行した。

- [x] **Step 3: 検証結果を報告する**

実行済みの4コマンドはすべてホスト上で終了コード0で完了した。テストは143ファイル・1714件、lintは0 errors（既存warning 97件）だった。`REQUIREMENTS*` の glob は空である。Devcontainer が利用できなかったため、Devcontainer 内検証の完了条件は未達であり、ホスト結果を代替合格とは扱わない。

各コマンドの終了結果と、`REQUIREMENTS*` が存在しないことを確認する。Devcontainer 内で4コマンドを再実行するまで、プロジェクト検証の完了条件は満たされない。
