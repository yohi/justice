# sp-* category モデル推奨プロファイル設計

## 目的

Justice の `sp-*` custom category を利用する人が、用途と実行頻度に応じた
モデル構成を選べるようにする。モデル選定は README の利用者向け推奨として扱い、
Justice の routing 契約、実装コード、または利用者の設定を変更しない。

## 範囲

- `README.md` に provider 非依存の論理 Reasoning level と、provider 固有値への明示的な mapping を含む推奨 Worker モデルプロファイルを追加する。
- 対象は `sp-mechanical`、`sp-implementation`、`sp-review`、
  `sp-integration`、`sp-final-review` の5カテゴリに限定する。
- モデル名、reasoning level、選択・復旧順、用途を記載する。

次は本変更の対象外とする。

- `SPEC.md` の実装契約の変更。
- Justice の自動 category escalation の実装。
- `omo.jsonc`、モデル catalog、またはモデル接続先の設定。
- LLM 接続先、provider 固有 ID、価格、利用枠、コピー可能な設定例の掲載。

## 推奨プロファイル

README は次のモデル順を非規範的な推奨として示す。

| Category | Primary | Reasoning | 復旧候補 | 用途 |
| --- | --- | --- | --- | --- |
| `sp-mechanical` | DeepSeek V4 Flash | `low` | Qwen 3.8 Flash `low` → GPT-5.6 Luna `low` | 定型的な単一変更 |
| `sp-implementation` | GLM-5.3 Flash | `high` | DeepSeek V4 Pro `high` → GPT-5.6 Luna `max` | 通常のTDD実装 |
| `sp-review` | Qwen 3.8 Flash | `medium` | DeepSeek V4 Flash `max` → GPT-5.6 Luna `max` | task単位のreview |
| `sp-integration` | DeepSeek V4 Pro | `max` | GLM-5.3 `max` → Grok 4.6 `high` | 複数ファイル、統合、複雑なdebugging |
| `sp-final-review` | GPT-5.6 Sol | `max` | GLM-5.3 `max` → Grok 4.6 `xhigh` | planまたはbranch全体の最終review |

高頻度の機械的変更、通常実装、task 単位 review には効率重視のモデルを使い、
低頻度の統合・最終 review でより高い推論予算を使う。標準の `sp-*` chain には
Claude と Kimi K3 を含めない。

## 設定と実行の境界

README の表は人間が読めるモデル名を使い、設定にそのまま貼り付ける短縮 alias や
接続先固有の識別子は載せない。実際の `omo.jsonc` では、各利用者が解決可能な
モデル名または top-level `models` catalog の alias へ対応付ける。

`Reasoning` 列の値は provider 非依存の論理レベルであり、実行時に provider 固有値へ
変換される。現在の推奨対象に対する mapping は次のとおりとする。

| Provider / model | `low` | `medium` | `high` | `xhigh` | `max` | 対応能力の確認 |
| --- | --- | --- | --- | --- | --- | --- |
| DeepSeek | `low` | `high` | `high` | `high` | `max` | 選択モデルの `models` catalog の reasoning capability と provider 仕様を確認 |
| Grok 4.6 | `low` | `medium` | `high` | `xhigh` | 拒否 | 選択モデルの `models` catalog の reasoning capability と provider 仕様を確認 |

DeepSeek は `low` / `high` / `max` に対応し、論理 `medium` と `xhigh` は `high` へ
変換する。Grok 4.6 は `low` / `medium` / `high` / `xhigh` をそのまま扱う。
表にない値、または確認した catalog が選択モデルの能力を示さない値は、プロファイル上は拒否する。
この2つの変換以外の暗黙的な downgrade、別モデルへの自動切替、category escalation は
行わない。対応能力は、調査時点の `models` catalog の capability metadata または
reasoning enum と provider 公式仕様を照合し、確認日・catalog revision・対象モデルを
監査記録へ残して確認する。モデル名だけから対応能力を推測しない。

`models[]` は選択・実行時復旧の順序であり、能力不足を検出して自動的に上位の
カテゴリへ昇格させる機構ではない。現行Justiceは失敗時に advisory と分割提案を
注入するだけで、`sp-implementation` から `sp-integration` への自動再ルーティングは
行わない。統合課題として再試行する場合は、計画を更新して明示的に再委譲する。

## README の配置と検証

`/justice-implement` の説明の直後、Quality Control Plane の前に新しい節を置く。
節には、推奨が強制設定ではないこと、モデルの利用可否と実際の解決は利用者の
`omo.jsonc` に委ねること、上記の category escalation 制約を明記する。推奨の
確認日を記載し、上流のモデル・設定仕様に追従して見直す。

文書変更後は、Markdown の体裁、リンク、既存の `SPEC.md` の category-first
model/provider independence 契約との矛盾がないことを確認する。プロジェクトの
完了条件に従い、`bun run test`、`bun run typecheck`、`bun run lint`、`bun run build` を
実行する。
