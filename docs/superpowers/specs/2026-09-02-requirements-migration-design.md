# REQUIREMENTS 文書の統合設計

## 目的

ルート直下の一時的な `REQUIREMENTS*` 文書を削除し、内容を正式な仕様書または保守文書へ統合する。現行実装と未実装の将来要求を混同しない。

## 転記先

- `SPEC.md`: 現行の責務境界と、未実装であることを明示した将来要求。
- `docs/agents/upstream-drift.md`: upstream compatibility audit の対象、基準リビジョン、再検証手順。
- `README.md`: 利用者が確認できる保守文書へのリンクのみ。

## 扱い

- `REQUIREMENTS_2026-08-29.md` の routing、category-first、model/provider independence は既存仕様と重複するため、既存の `SPEC.md` を正とする。
- plan-scoped authorization（FR-601〜FR-604）は現行の one-shot arm と異なるため、将来要求として `SPEC.md` に分離して記録する。
- `REQUIREMENTS_2026-08-19.md` の upstream 追従・E2E・再検証要件は保守手順として `docs/agents/upstream-drift.md` に統合する。
- 転記後、2つの `REQUIREMENTS*` ファイルを削除する。

## 完了条件

- 要件の現行/将来の区別が文書上明確である。
- upstream の監査範囲と再検証手順が残っている。
- `REQUIREMENTS_2026-08-19.md` と `REQUIREMENTS_2026-08-29.md` が存在しない。
- Markdown の構文・リンク・既存の仕様記述に矛盾がない。
