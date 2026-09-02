# sp-* category モデル推奨プロファイル実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `README.md` に `sp-*` custom category 向けの非規範的な Worker モデル推奨プロファイルを追加する。

**Architecture:** `/justice-implement` の説明と Quality Control Plane の間に、モデル名・reasoning level・復旧候補・用途を示す表と運用注記を置く。設定の実体は利用者の `omo.jsonc` に残し、Justice の routing 実装・仕様・設定には変更を加えない。

**Tech Stack:** Markdown、Bun、Vitest、TypeScript、ESLint

## Global Constraints

- 変更対象は `README.md` と本計画・設計文書のみとし、`SPEC.md`、ソースコード、`omo.jsonc` は変更しない。
- LLM接続先、固有ID、価格、利用枠、コピー可能なJSONC設定例は掲載しない。
- `models[]` を能力に応じた自動category昇格として説明しない。
- `sp-implementation` から `sp-integration` への再委譲は、計画更新後に明示的に行う必要があると記載する。
- 完了前に devcontainer 内で `bun run test`、`bun run typecheck`、`bun run lint`、`bun run build` を実行する。
- Git commit は、ユーザーから明示依頼があるまで実行しない。

---

### Task 1: READMEへの推奨モデルプロファイル追加

**Files:**

- Modify: `README.md` の `/justice-implement` 節末尾と `## Quality Control Plane (v2.0)` の間
- Verify: `docs/superpowers/specs/2026-09-02-sp-category-model-profile-design.md`

**Interfaces:**

- Consumes: `SpCategory` の5カテゴリと、設計文書で承認済みのモデル順・reasoning level。
- Produces: 利用者が設定を強制されずに選択できる、provider固有情報を含まないREADME節。

- [ ] **Step 1: 既存の挿入位置と設計を再確認する**

`README.md` の `## /justice-implement` 節が終わる位置と、続く `## Quality Control Plane (v2.0)` 見出しを確認する。設計文書の表が `sp-mechanical`、`sp-implementation`、`sp-review`、`sp-integration`、`sp-final-review` の5行を持つことを確認する。

- [ ] **Step 2: 推奨プロファイル節を追加する**

`## Quality Control Plane (v2.0)` の直前に次のMarkdownを追加する。

```markdown
## 推奨 Worker モデルプロファイル

以下は `sp-*` custom category 向けの非規範的な推奨です。実際に利用可能な
モデルの解決と選択は、利用者の `omo.jsonc` に委ねられます。

| Category | Primary | Reasoning | 復旧候補 | 用途 |
| --- | --- | --- | --- | --- |
| `sp-mechanical` | DeepSeek V4 Flash | `low` | Qwen 3.8 Flash `low` → GPT-5.6 Luna `low` | 定型的な単一変更 |
| `sp-implementation` | GLM-5.3 Flash | `high` | DeepSeek V4 Pro `high` → GPT-5.6 Luna `max` | 通常のTDD実装 |
| `sp-review` | Qwen 3.8 Flash | `medium` | DeepSeek V4 Flash `max` → GPT-5.6 Luna `max` | task単位のreview |
| `sp-integration` | DeepSeek V4 Pro | `max` | GLM-5.3 `max` → Grok 4.6 `high` | 複数ファイル、統合、複雑なdebugging |
| `sp-final-review` | GPT-5.6 Sol | `max` | GLM-5.3 `max` → Grok 4.6 `xhigh` | planまたはbranch全体の最終review |

高頻度の機械的変更、通常実装、task単位のreviewには効率重視のモデルを使い、
低頻度の統合・最終reviewでより高い推論予算を使います。標準の `sp-*` chain には
Claude と Kimi K3 を含めません。確認日: 2026-09-02。

> [!NOTE]
> この表は強制設定ではありません。設定時には各モデルを利用可能なモデル名または
> `models` catalog のaliasへ対応付けてください。`models[]` は選択・実行時復旧の順序であり、
> 能力不足を検出して上位categoryへ自動昇格させる機構ではありません。
> `sp-implementation` を `sp-integration` として再実行する場合は、計画を更新して
> 明示的に再委譲してください。
```

- [ ] **Step 3: 文書境界を検証する**

追加した節に接続先、固有ID、価格、利用枠、JSONCコードブロックがないことを確認する。5つの `sp-*` category が一度ずつ表にあり、`models[]` の説明が自動category昇格と区別されていることを確認する。

- [ ] **Step 4: プロジェクト検証を実行する**

devcontainer 内で次を実行し、すべて終了コード0であることを確認する。

```bash
devcontainer exec --workspace-folder . bun run test
devcontainer exec --workspace-folder . bun run typecheck
devcontainer exec --workspace-folder . bun run lint
devcontainer exec --workspace-folder . bun run build
```

Markdownの空白や表の崩れがないことを目視確認する。Git commit はユーザーの明示依頼があるまで作成しない。

### Task 2: 設計・実装結果の照合

**Files:**

- Verify: `README.md`
- Verify: `docs/superpowers/specs/2026-09-02-sp-category-model-profile-design.md`
- Verify: `docs/superpowers/plans/2026-09-02-sp-category-model-profile-plan.md`

**Interfaces:**

- Consumes: Task 1 で追加したREADME節と承認済み設計。
- Produces: 設計と一致し、実装契約を変更しない利用者向け文書。

- [ ] **Step 1: 設計との差異を確認する**

READMEの表について、5カテゴリ、Primary、Reasoning、復旧候補、用途が設計文書の表と一致することを確認する。`SPEC.md`、ソースコード、`omo.jsonc` が変更対象に含まれていないことを確認する。

- [ ] **Step 2: 完了条件を報告する**

追加位置、provider固有情報を含めなかったこと、カテゴリ自動昇格を約束していないこと、実行した検証コマンドと結果を報告する。未実行または失敗した検証があれば成功と表現せず、理由を明記する。
