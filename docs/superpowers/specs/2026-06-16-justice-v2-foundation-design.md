# Justice v2.0 Foundation 設計書 — Quality Control Plane（Phase 0 + v2.0）

## 0. メタ情報

| 項目 | 値 |
|------|----|
| 作成日 | 2026-06-16 |
| ステータス | Design（Accepted・実装計画化待ち） |
| 対象スライス | **Phase 0 + v2.0 基盤**（憲章 §14 Phase 1 の FR スコープに準拠。ただし FR-004 の `exit_code` は OpenCode binding 制約により直接 observed ではなく `derived` outcome へ縮退・§12 限界-2/D5） |
| 起点 | `@yohi/justice` v2.3.0（Phase 9 完了・563 tests passing） |
| 上位文書 | [Architecture Charter v3.0](../../2026-06-16-justice-v2-v3-requirements.md)（Accepted / Frozen） |
| 関連スキル | `superpowers/brainstorming`（本書作成）→ `superpowers/writing-plans`（次工程） |
| 後続スライス | v2.5（Handoff / Final Verifier / L1 deny / DEBT-001 カットオーバー）, v3（Traceability / L2 CI-PR） |

> 本書は憲章（Charter）を **単一実装スライスへ具体化**した設計である。憲章の Design Invariants（INV-001〜009）・Quality Protocol・ADR-0007 は変更不可の前提として継承する。

---

## 1. このスライスの目的

AI 開発で頻発する **Task Success ≠ Feature Success** を検出する Quality Control Plane の **基盤層**を確立する。具体的には、Justice が「観測した事実（Evidence）」と「下した判定（Verdict）」をイベントとして記録し、状態をそこから投影（projection）する背骨を、**既存の plan-bridge / task-feedback / wisdom 機能を壊さずに加算**する。

v2.0 は **L0 Advisory のみ**（強制せず、警告・バナー・チェックリスト提示に留める）。判定権限（Verdict authority）は Justice が保持し（INV-003）、強制機構（Enforcement）は v2.5 以降で段階強化する（INV-007）。

---

## 2. ブレストで確定した設計判断（Decision Log）

| # | 論点 | 決定 | 根拠 |
|---|---|---|---|
| D1 | 新 spine と既存コードの統合 | **加算シャドウ**。新 spine を並走追加し `ReflectionEvent` も発行するが、plan.md 書込は温存（dual）。完全カットオーバーは v2.5 | 既存 563 テストへの破壊最小・最短で出荷。INV-005 違反は DEBT-001 として明示存続 |
| D2 | v2.0 の FR スコープ | **憲章 §14 Phase 1 に厳密準拠**。FR-001/002/004/005/006 + 観測拡張。FR-003 Handoff・FR-007 Final Verifier は v2.5 | 憲章の実装優先順位と整合 |
| D3 | 実装アプローチ | **Approach A（直交観測レイヤー）**。専用観測ハンドラを `mergePostToolUseResponses` で既存ハンドラと合流、全ツール観測 | Pure-Core 厳守・既存無改変・v2.5 移行容易 |
| D4 | `/justice-*` 登録方式 | **カスタム tool として実装**（`tool` hook） | OpenCode に slash command 登録 API が無い（Phase 0 確定） |
| D5 | Evidence の exit_code | **`observed` ではなく `derived`**（output パース or `metadata.error`） | `tool.execute.after` に exit_code/stderr フィールドが無い（Phase 0 確定） |
| D6 | 既定 gate の厳しさ | **WARN 始まり trust-first**。`.justice/gate.yaml` で fail へ引上げ可 | 過剰警告回避。L0 では FAIL も非ブロッキング |
| D7 | FF-005（plan.md 非著作） | **新 spine 限定 + DEBT-001 allowlist**。v2.5 で allowlist を空にして全域アサート | 加算シャドウとの構造的衝突を整合。新規違反はブロック |
| D8 | Task Gate の Evidence 範囲 | **同一セッションの task 窓**（task PreToolUse callId 開始〜PostToolUse 完了）に `taskId` を刻印し一致 Evidence のみ評価。サブエージェント横断は v2.5 | 窓外の無関係 pass の誤採用を防ぐ（Finding 1） |
| D9 | provenance モデル | Evidence.provenance を **observed/declared/derived/unknown の4値**で一貫化。interpretation は常に derived。declared は記録するが L0 限定 | スキーマと FF-007・KPI の齟齬解消（Finding 2） |
| D10 | FR-002 検出 | skill_invoked は **tool 観測から derive**（toolName==="skill" / task の load_skills） | 専用 hook 不在（Finding 3） |
| D11 | Review 入力/解決 | review_observed は task/レビュー出力を ReviewRejectionDetector で処理して生成。item キーで latest-review-wins、open/resolved 判定 | FR-006 の入力源と解決規則を明確化（Finding 4） |
| D12 | state.json 永続化 | FileWriter atomic + fail-open + log 権威（破損→再構築） | AGENTS.md の I/O 方針準拠（Finding 5） |
| D13 | UI 名 | v2.0 は custom tool 名のみ。slash 互換エイリアスは任意（stretch） | 後続計画の混乱回避（Finding 6） |
| D14 | レコード間参照の同一性 | `evidenceRefs` / `derivedFrom` を **`{shardId, sequence, evidenceId}` 複合参照**化（shardId=`{agentId, sessionId}`）。`sequence` 単体は shard 内一意のみ。`evidenceId` で record 内の特定 Evidence/claim/item を一意化（D31 で改訂） | shard 横断マージ時の参照曖昧性とレコード内多根拠の曖昧性を排除（レビュー指摘 R1 / 第4R 指摘3） |
| D15 | ReflectionEvent のスキーマ化 | **`ObservationRecord{kind:"reflection"}`** を追加し payload を定義。憲章の3レコード型（Observation/Decision/Learning）は維持 | DEBT-001 seam の直列化先を確定（レビュー指摘 R2） |
| D16 | Message 観測経路 | `message.updated`/`chat.message` → `ObservationRecord{kind:"message"}` → `declared` Evidence のフローを明文化 | declared の生成元を確定（レビュー指摘 R3） |
| D17 | Artifact メタデータ | Artifact（`gate.yaml` / Review Summary）に **authorship/authority** を付与（Evidence の provenance と対比） | 憲章 §8.3 と整合（レビュー指摘 R4） |
| D18 | shard 横断 replay の全順序化 | projection マージのソート鍵を `timestamp` → `shardId` → `sequence` の**全順序**にする（shardId=`{agentId, sessionId}`）。`sequence` は shard 内一意のため shardId で衝突を排除（D30 で shardId 化） | 同 timestamp/同 sequence の shard 横断衝突で順序が未定義になる穴を解消（2026-06-16 レビュー第2R 指摘1・INV-009/FF-004） |
| D19 | retention は archive 限定 | v2.0 は rotation=archive（移送）のみ。物理 prune（削除）は canonical snapshot/checkpoint イベント定義後（v2.5+）に解禁 | 「event log が常に権威・常に再構築可能」(§9.4) との矛盾を解消（2026-06-16 レビュー第2R 指摘2） |
| D20 | Task Gate の Evidence 保証範囲 | 評価対象を親セッション観測 + task PostToolUse 出力からの **`declared`（PASS 非算入）** に限定と明記（D29 で改訂: 旧 `derived` は raw transcript 観測時のみ）。サブエージェント内 `observed` の厳密相関は v2.5 Handoff。委譲時 WARN 優勢を KPI/DoD に明記 | gate が subagent 実行結果をほぼ拾えず常時 WARN 化する懸念に対応（2026-06-16 レビュー第2R 指摘3） |
| D21 | ObservationRecord の union 化 | `kind` ごとの discriminated union として tool_executed/message/skill_invoked/review_observed/session_error/reflection の各 payload の必須/任意項目を定義 | payload 未定義による実装者依存を排除（2026-06-16 レビュー第2R 指摘4） |
| D22 | UI 名表記の統一 | §7.5 見出しを `justice_*` read-only custom tool に改称。`/justice-*` slash 表記は stretch alias に限定 | 章見出しの表記混在による誤解を解消（2026-06-16 レビュー第2R 指摘5） |
| D23 | 並行 append のイベント消失 | 同一 shard への append を Runtime の **per-shard async write queue で直列化**し sequence 採番もキュー内で実施。temp+rename の read-modify-write 競合を構造的に排除。**shard 鍵は `{agentId, sessionId}` に固定**し 1 プロセス=1 writer を保証（D30 でプロセス境界対応） | 「単一ファイル並行 append 禁止」の**強制機構**が未定義だった穴を解消（2026-06-16 レビュー第3R 指摘1・INV-008） |
| D24 | declared の gate 充足不算入 | 既定 gate の**充足（PASS）に算入する provenance を `observed`/`derived` に限定**。declared は「申告あり・観測なし」の WARN 材料に限定（自己申告 "tests pass" 単独で PASS させない）。FF-008 で固定 | declared が L0 gate を PASS させ警告を抑制し得る穴を解消（2026-06-16 レビュー第3R 指摘2・INV-004） |
| D25 | message/session_error の保存前 redaction | `message` 本文・`declaredClaims`・`session_error.message` も append 前に **SecretPatternDetector 走査・redact ＋ truncation** を必須化（§6.1.1・§9.4） | チャット/エラー本文の secrets・絶対パス・肥大化を永続化前に遮断（2026-06-16 レビュー第3R 指摘3・NFR security） |
| D26 | DecisionRecord の per-rule 化 | DecisionRecord/Verdict を **`ruleResults[]{ ruleId, verdict, reason, evidenceRefs[] }`** 化。全体 status は最悪値合成、各 rule の根拠を保持 | 複数 gate 同時 WARN/FAIL 時に単数 ruleId/reason が情報を落とす穴を解消（2026-06-16 レビュー第3R 指摘4） |
| D27 | projection マージの2段階化 | **shard 内＝`sequence` 優先 → shard 間＝`timestamp`→`shardId`→`sequence`** の2段階マージ（shardId=`{agentId, sessionId}`）。timestamp 逆転下でも shard 内因果順を保持 | 全順序化が shard 内 causal order を壊し得る穴を解消（決定性と因果整合は別目的・2026-06-16 レビュー第3R 指摘5・INV-009/FF-004） |
| D28 | read-only のスコープ明記 | §7.5 に「read-only は workspace/code/commands に対するもので `.justice/state.json` 内部キャッシュ書込は許容」と明記 | read-only 表記とキャッシュ書込の表現衝突（誤読）を解消（2026-06-16 レビュー第3R 指摘6・INV-002/§5.6） |
| D29 | task サマリ由来 Evidence の provenance | task PostToolUse 出力（サブエージェント結果サマリ）から抽出した合否主張は **`declared`** として扱い、gate 充足（PASS）には**算入しない**。raw コマンド transcript が出力に含まれ観測可能な場合のみ `derived` 昇格を許可。`derived` は常に **observed 起源**に限定（憲章 derived 定義と整合） | declared を `derived` に偽装して PASS 充足を迂回できる穴を解消。§5.8/§10.2 KPI の内部矛盾も解消（2026-06-16 レビュー第4R 指摘1・INV-004/AX-002） |
| D30 | shard 鍵のプロセス境界 | shard 鍵を **`{agentId, sessionId}` に固定**（physical: `events/<agentId>/<sessionId>.jsonl`）。in-process queue は単一プロセス内直列化にしか効かないため、shard をプロセス=writer 単位に分離し別プロセスが同一ファイルを書かない設計とする。read 側は全 shard を merge。さらなる堅牢化は `{agentId, sessionId, processId}` / per-writer segment | per-agentId 単独鍵では複数セッション/プロセスが同一ファイルへ並行 append しイベント消失する穴を解消（2026-06-16 レビュー第4R 指摘2・INV-008/NFR 並行性） |
| D31 | レコード内多根拠の一意参照 | `evidenceRefs` / `derivedFrom` を **`{shardId, sequence, evidenceId}`** とし、record 内の特定 Evidence/claim/item を一意特定。review items は `itemKey`、message claims は `claimIndex`、tool_executed は単一 evidence の固定 id | `{agentId, sequence}` では review `items[]` / message `declaredClaims[]` のどれが判定根拠か復元できない穴を解消（2026-06-16 レビュー第4R 指摘3・Traceability 前提） |
| D32 | review 解決規則の厳格化 | `resolved` は (a) 明示的解決マーカー、(b) **同一レビュースコープの完全スナップショット**での不在、(c) 人間承認 artifact のいずれかでのみ成立。単なる item 消失（範囲差・検出漏れ・出力形式変化）では `open` 据置。`review_observed` に `reviewScope` を付与しスコープ一致を判定 | 消失=resolved により未解決 major/critical が誤って解決扱いになる穴を解消。FR-006 は集約のみ要求（2026-06-16 レビュー第4R 指摘4・AX-001/002） |
| D33 | rotation 後の sequence 採番 | sequence 初回復元を当該 shard の **active + archive 双方の最大 sequence** から行う（writer state の monotonic counter も可）。`{shardId, sequence}` の一意性を rotation 跨ぎで保証 | active のみ参照だと rotation 後に sequence が reset し archive と衝突、参照鍵の一意性と replay 決定性が壊れる穴を解消（2026-06-16 レビュー第4R 指摘5・INV-008/INV-009/FF-004） |

---

## 3. Phase 0 解決（FATAL ブロッカー）

`@opencode-ai/plugin` v1.14.21 の型定義調査により確定（出所: `node_modules/@opencode-ai/plugin/dist/index.d.ts` L171–313）。

| 項目 | 結果 | 設計への反映 |
|---|---|---|
| スラッシュコマンド登録 | ❌ 登録 API 無し。`command.execute.before` は読取専用傍受（登録・短絡 不可） | `/justice-*` を `tool` hook でカスタム tool 化（D4） |
| 全ツール観測 | ✅ `tool.execute.before/after` は全ツールで発火 | 観測拡張（task 限定撤廃）成立 |
| exit_code / stderr | ❌ `tool.execute.after` は `{title, output, metadata}` のみ。exit_code 無し・stderr は output に統合 | Evidence の合否は `derived`（D5）。`metadata.error===true` を補助シグナルに使用 |
| permission.ask | ✅ `"deny"/"allow"/"ask"` 返却可 | L1 enforcement 経路は実在（v2.5 で使用） |
| event hook | ✅ 33 種（message.updated / session.error / file.edited / vcs.branch.updated 等） | v2.0 は message.updated / session.error + tool.execute を主軸。残りは v2.5+ |

**Phase 0 で残る唯一の実測スパイク**: 観測拡張（全ツール `tool.execute.after`）の **レイテンシ計測**。実装初手で計測し予算（目標例: 観測オーバーヘッド p95 < 数 ms / tool 呼び出し）を満たすか検証。未達時は非同期キュー + flush を検討。

---

## 4. アーキテクチャ（層モデルとモジュール構成）

憲章 §6 の3層モデル（Core=純粋 / Hook=捕捉・調整・enforcement 発火 / Runtime=実 I/O）に Approach A を加算する。

### 4.1 新規 Core（純粋・I/O なし・ユニットテスト 100% 目標）

| モジュール | 責務 | 対応 FR / INV |
|---|---|---|
| `event-model.ts`（or `types.ts` 拡張） | `ObservationRecord` / `DecisionRecord` / `LearningRecord`(v3 予約) の判別共用体 + `schemaVersion` | FR-001, §8.1 |
| `state-projection.ts` | 純粋 fold `(events) => ProjectedState`。同一入力→同一 state | FR-001, INV-008/009, FF-004 |
| `evidence-engine.ts` | observation → `Evidence{kind,command,rawOutput,provenance,interpretation?}` 抽出 + provenance 付与 | FR-004, INV-004, FF-007 |
| `rule-evaluation-engine.ts` | 純粋 `(gates, evidence, ctx) => Verdict`。副作用なし | FR-005, INV-009, FF-002/003 |
| `gate-definition.ts` | gate.yaml スキーマ型 + 厳密バリデーション | FR-005, NFR(security) |
| `review-aggregator.ts` | 既存 `ReviewRejectionDetector` 拡張。Artifact `{critical,major,minor,resolved,open}` 出力 | FR-006 |

### 4.2 新規 Hook（調整・enforcement 発火のみ／ロジックは Core 委譲）

| モジュール | 責務 |
|---|---|
| `observation-handler.ts` | 全ツールの Pre/PostToolUse ＋ **Message（`message.updated`/`chat.message`）** を観測 → Observation 生成 → gate 評価 → L0 advisory `inject`。既存ハンドラと `mergePostToolUseResponses` で合流 |

### 4.3 新規 Runtime（実 I/O）

| モジュール | 責務 |
|---|---|
| `observation-log-store.ts` | `.justice/events/<agentId>/<sessionId>.jsonl`（shard 鍵=`{agentId, sessionId}`・§9.4/D30）への atomic 追記（temp+rename）+ 全 shard 読取マージ。**同一 shard への append は per-shard async write queue で直列化**（read-modify-write 競合とイベント消失を防止・§9.4 並行性）。sequence は直列化キュー内でインメモリ管理（初回は当該 shard の **active + archive 双方の最大 sequence** から復元・rotation 跨ぎ衝突を防止・D33） |
| `gate-loader.ts` | `.justice/gate.yaml` 読込・パース（+ 組込デフォルト）→ 純粋 engine へ data 注入 |
| `justice-tools.ts` | `justice_status` / `justice_gate` / `justice_review` の tool 定義（read-only） |
| `opencode-adapter.ts`（既存拡張） | `tool !== "task"` フィルタ撤廃 + 新観測イベント送出。`tool` hook 配線 |

### 4.4 配線（`justice-plugin.ts` 拡張）

`handleEvent` の `PreToolUse`/`PostToolUse` 経路で:
- **observation-handler を常に呼ぶ（全ツール）**
- **plan-bridge / task-feedback は `payload.toolName==="task"` のときだけ呼ぶ（ガード追加）** → 既存ハンドラ内部は無改変、現挙動を完全保存

### 4.5 `.justice/` レイアウト

```text
.justice/
  events/<agentId>/<sessionId>.jsonl   # 追記専用 Observation+Decision ログ（shard 鍵={agentId, sessionId}・1 writer/shard）
  events/system.jsonl                 # 予約 shard: shardId={agentId:"system", sessionId:"system"}（session 非依存のシステムイベント。順序キーは他 shard 同様 timestamp→shardId→sequence）
  events/archive/          # retention rotation 退避先
  gate.yaml                # 人間が承認した静的ルール（+ 組込デフォルト）
  state.json               # projection キャッシュ（再構築可能・SoT ではない）
  wisdom.json              # 既存（不変）
```

> **憲章保存先パスとの関係（互換的詳細化）**: 憲章 FR-001/§8.1 の保存先 `.justice/events/<agentId>.jsonl` を上位概念とし、本設計はその互換的詳細化として agentId 配下に sessionId shard を置く（`events/<agentId>/<sessionId>.jsonl`）。これは並行 append 競合・イベント消失の回避（D30・INV-008・§9.4 並行性）のための実装詳細であり、憲章の INV / ADR / Quality Protocol を変更しない（凍結ガバナンス §16.3 の対象外）。読取時は全 shard をマージするため projection 再構築可能性（FF-004）は保たれる。

---

## 5. データモデル / イベントスキーマ

### 5.1 共通エンベロープ（全レコード）

```jsonc
{
  "schemaVersion": 1,
  "sequence": 42,               // shard 内 単調増加（shard 鍵=shardId={agentId, sessionId}・グローバル一意キーは {shardId, sequence}＝{agentId, sessionId, sequence}）
  "timestamp": "2026-06-16T07:00:00.000Z",
  "agentId": "hephaestus",
  "sessionId": "ses_...",
  "taskId": "task-3",           // task 窓内の観測に刻印（無ければ省略・§5.8）
  "recordType": "observation" | "decision" | "learning"
}
```

読取時の projection 再構築は **2段階マージ**で行う（§6.3）: ① **shard 内**は `sequence` 昇順で整列（shard 内因果順＝単調増加の sequence を最優先。時計ずれや timestamp 逆転があっても shard 内の因果順を壊さない）、② **shard 間**は整列済みの各 shard を `timestamp` → `shardId` → `sequence` でマージ（shardId=`{agentId, sessionId}`。同 timestamp の shard 横断衝突は二次キー `shardId`・三次キー `sequence` で一意化）。これにより決定性（FF-004）と shard 内因果整合を両立する（INV-009）。

> **レコード参照の同一性とソート順序**: `sequence` は **shard（=shardId=`{agentId, sessionId}`）内**単調増加であり shard 横断では一意でない。よってレコード間参照（`evidenceRefs` / `derivedFrom`）は **`{shardId, sequence, evidenceId}` 複合参照**を用い、複数シャードをマージした後も根拠 Evidence を曖昧さなく解決する（`evidenceId` は record 内の特定 Evidence/claim/item を一意化・§5.3 / §5.4 / D31）。**projection マージは「① shard 内＝`sequence` 優先 → ② shard 間＝`timestamp`→`shardId`→`sequence`」の2段階**とし、shard 内の因果順（sequence）を timestamp 逆転から保護しつつ、shard 横断の衝突時も replay を決定論化する（§6.3 / FF-004）。全順序化（決定性）と shard 内因果整合は別目的であり、2段階マージで同時に満たす。
>
> **参照のレコード表現（型の正本）**: 上記の複合参照は記録上 **`{agentId, sessionId, sequence, evidenceId}` の展開形**で直列化する（§5.3 `derivedFrom` / §5.4 `evidenceRefs` の JSON 例と一致）。`shardId` は `{agentId, sessionId}` の別称であって独立フィールドとしては直列化しない（L140 の等価関係 `{shardId, sequence}`＝`{agentId, sessionId, sequence}`）。実装の参照型はこの4要素オブジェクトを単一の正本とし、D14/D31 の `{shardId, …}` 表記はこの展開形を指す。

### 5.2 ObservationRecord（観測した事実）

```jsonc
// ObservationRecord = 共通エンベロープ（§5.1）+ kind ごと payload の discriminated union（判別子 = kind）
// kind ∈ "tool_executed" | "message" | "skill_invoked" | "review_observed" | "session_error" | "reflection"

// (a) tool_executed — 全ツール実行の観測
{ "...envelope":"...", "recordType":"observation", "kind":"tool_executed",
  "toolName":"bash",           // 必須
  "callId":"call_...",         // 必須
  "evidence":{ /* §5.3 */ } }  // 必須: observed Evidence(+interpretation?)

// (b) message — エージェント発話（declared 経路・§6.1.1）
{ "...envelope":"...", "recordType":"observation", "kind":"message",
  "role":"assistant",          // 必須: 発話主体
  "text":"...",                // 必須: 本文（redact＋truncation 後・§6.1.1/§9.4）
  "declaredClaims":[           // 任意(0..n): 抽出した自己申告
    { "claimKind":"test"|"build"|"lint"|"generic", "outcome":"pass"|"fail"|"unknown" } ],
  "evidence":{ /* §5.3, provenance:"declared" */ } }  // declaredClaims 存在時のみ付与

// (c) skill_invoked — tool 観測から derive（FR-002）
{ "...envelope":"...", "recordType":"observation", "kind":"skill_invoked",
  "skillName":"test-driven-development",      // 必須
  "source":"skill_tool"|"task_load_skills",   // 必須: 検出元
  "callId":"call_..." }                       // 任意

// (d) review_observed — レビュー出力検出（FR-006・§7.6）
{ "...envelope":"...", "recordType":"observation", "kind":"review_observed",
  "reviewScope":"...",                        // 必須: レビュー範囲識別子（解決判定のスコープ一致用・§7.6/D32）
  "items":[                                   // 必須(0..n): ReviewRejectionDetector 出力
    { "itemKey":"...",                        // 必須: severity＋要約/該当箇所から決定的に導出（record 内一意・参照鍵・§7.6/D31）
      "severity":"critical"|"major"|"minor", "summary":"...",
      "location":"...", "status":"open"|"resolved" } ] }

// (e) session_error — event(session.error) 由来（§6.1.1）
{ "...envelope":"...", "recordType":"observation", "kind":"session_error",
  "errorKind":"...",           // 必須: 分類（ErrorClassifier）
  "message":"..." }            // 必須: 本文（redact＋truncation 後・§6.1.1/§9.4）

// (f) reflection — DEBT-001 seam。payload は下記 §5.2 後段の jsonc で定義
```

- **skill_invoked の検出（FR-002・Finding 3）**: 専用 hook は無いため tool 観測から derive — `tool.execute.before` の `toolName==="skill"` および `task` ツールの `load_skills` 引数から `{ kind:"skill_invoked", skillName }` を生成。テスト対象は検出ロジック（純粋）。

- **ReflectionEvent の記録（DEBT-001 seam・§8.2）**: task-feedback の ✅付与 / loop-handler の error-note 追記と **同じ契機** で `ObservationRecord{ kind:"reflection" }` を発行する。憲章 §8.1 の3レコード型（Observation/Decision/Learning）を維持するため **新 recordType は追加せず Observation の一種** として扱う（観測事実＝「task 完了/エラーを検知した」＋ 所有者向けの plan 反映意図を payload に保持）。所有者（agent/superpowers）が消費して plan.md を更新する（v2.5 目標）。構築ロジックは Core 純粋関数。

```jsonc
{
  "...envelope": "...", "recordType": "observation", "kind": "reflection",
  "reflection": {
    "trigger": "task_succeeded" | "task_error",        // 発行契機
    "planRef": { "file": "plan.md", "taskId": "task-3" },
    "intent": "check_complete" | "append_error_note",  // 所有者が反映すべき plan 変更
    "note": "..."                                       // error-note 本文（任意）
  }
}
```

### 5.3 Evidence（生の観測信号 ＋ provenance）

```jsonc
{
  "evidenceId": "ev-1",                        // 必須: record 内で一意（参照鍵 {shardId, sequence, evidenceId} の末尾・§5.4/D31）
  "kind": "test" | "build" | "lint" | "command" | "generic",
  "command": "bun run test",
  "rawOutput": "...stdout(+stderr統合)...",
  "provenance": "observed" | "declared" | "derived" | "unknown",
  "interpretation": {                          // 省略可。存在時は常に derived
    "outcome": "pass" | "fail" | "unknown",
    "basis": "parsed_output" | "metadata_error",
    "provenance": "derived",
    "derivedFrom": [{ "agentId": "hephaestus", "sessionId": "ses_...", "sequence": 40, "evidenceId": "ev-0" }]   // 元 observed Evidence の複合参照（{shardId, sequence, evidenceId}・shard 横断一意・D31）
  }
}
```

- **provenance 4値の生成経路（Finding 2 対応）**:
  - `observed`: tool.execute.after の生 `rawOutput`/`metadata` を直接観測
  - `derived`: **observed から**導出した解釈（`interpretation` 自身、または observed を集計した派生 Evidence）。**起源は必ず observed**（declared を起源とする派生は `derived` にしない・D29）
  - `declared`: エージェントの自己申告（message 観測由来、**および task PostToolUse 出力サマリ由来**の合否主張。観測裏付けの無い主張・§5.8/D29）
  - `unknown`: 出所不明
- `exit_code` は独立フィールドを持たず `interpretation.outcome` に集約（API に無く derived 確定）。
- **declared は v2.0 でも記録**するが **gate の充足（PASS）判定には算入しない**。既定 gate（`evidence_outcome` / `evidence_present`）が充足と判定できる Evidence は **`observed` / `derived` のみ**で、declared は「自己申告あり・観測裏付け無し」の **WARN 材料**に限定する（declared な "tests pass" だけで required-tests を PASS させない。観測が無ければ `onMissingEvidence` 経路で WARN・FF-008）。**task サマリ由来の合否主張も declared 扱いで PASS 非算入**（raw transcript が出力に含まれ観測できる場合のみ `derived` 昇格可・§5.8/D29）。L1+ deny に使えるのも `observed`/`derived` のみ（FF-007）。KPI provenance 分布は4値を集計。
- **kind 分類**: evidence-engine が `command` パターンで決定論的に判定（test/spec→test, build/compile/tsc→build, lint/eslint→lint, 他→command/generic）。純粋関数（FF-002）。

### 5.4 DecisionRecord（Justice の判定 = Verdict）

```jsonc
{
  "...envelope": "...", "recordType": "decision",
  "gateType": "task",                       // v2.0 は task のみ
  "verdict": "PASS" | "WARN" | "FAIL",     // 複数 gate 評価時は最悪値合成（FAIL > WARN > PASS）
  "reachableEnforcementLevel": "L1",        // §7.2 由来（task=L1 まで）
  "appliedEnforcementLevel": "L0",          // v2.0 は常に L0
  "ruleResults": [                          // 評価した各 rule の per-rule 結果（複数 gate 同時 WARN/FAIL でも情報を落とさない）
    { "ruleId": "required-tests", "verdict": "FAIL", "reason": "...",
      "evidenceRefs": [{ "agentId": "hephaestus", "sessionId": "ses_...", "sequence": 40, "evidenceId": "ev-1" }] },   // 根拠 Evidence の複合参照（{shardId, sequence, evidenceId}・shard 横断＋record 内一意・D31）
    { "ruleId": "build-green", "verdict": "WARN", "reason": "...",
      "evidenceRefs": [{ "agentId": "hephaestus", "sessionId": "ses_...", "sequence": 41, "evidenceId": "ev-2" }] }
  ]
}
```

### 5.5 LearningRecord — v3 予約

`recordType: "learning"` の枠だけ確保。実装は v3 Failure Intelligence（V3-05）。

### 5.6 projection（`state.json`・読取モデル・SoT ではない）

```jsonc
{
  "schemaVersion": 1, "rebuiltAt": "...",
  "tasks": { "task-3": { "status": "...", "lastVerdict": "PASS" } },
  "reviewSummary": { "authority": "observed_review_output", "critical": [], "major": [], "minor": [], "resolved": [], "open": [] }
  // current_branch / active_prs はキャッシュせず git/外部へ live クエリ（FR-001）
}
```

### 5.7 Artifact スコープ（§8.3）

| Artifact | v2.0 | 備考 |
|---|---|---|
| Gate Definition（`gate.yaml`） | ✅ | FR-005 |
| Review Summary | ✅ | FR-006・review-aggregator 出力 |
| Handoff | ⏸ v2.5 | FR-003 |
| Release Report | ⏸ v2.5 | FR-007 Final Verifier |

> **Artifact メタデータ（憲章 §8.3 準拠）**: Artifact は Evidence の `provenance` ではなく **`authorship`（誰が作成した契約・定義か）/ `authority`（どの権威に基づくか）** を持つ。v2.0 の各 Artifact は最低限 `authority` を保持する — **Gate Definition（`gate.yaml`）= `human_approved`**（人間が承認・コミット）、**Review Summary = `observed_review_output`**（観測されたレビュー出力の集約）。Evidence と Artifact の属性系を混同しない。

### 5.8 Task 相関と Evidence 窓（Finding 1 対応）

- 共通エンベロープに任意の `taskId` を追加。observation-handler は **task tool の PreToolUse(callId) で「アクティブ task」を開始**し、同一セッションの後続観測に `taskId` を刻印、task PostToolUse で窓を閉じる。
- **Task Gate は `GateContext.taskId` 一致の Evidence のみ評価**（窓外の無関係 pass を拾わない）。task gate では `taskId` 必須。
- サブエージェント（`task()` の子）の tool 実行は別セッション/シャードに記録され `taskId` 相関が付かない。ただし **task tool 自身の PostToolUse 出力（サブエージェントの結果サマリ）は親セッションの task 窓内で観測される**ため、evidence-engine（純粋）でそこから合否主張を抽出し当該 `taskId` に帰属させる。**この主張は申告由来のため provenance=`declared`（PASS 非算入）**とする（サマリは自己申告であり observed ではない・D29/§7.3）。例外として、出力に実コマンドの raw transcript が含まれ Justice が直接再パースできる場合に限り `derived` 昇格を許可する。
- **Task Gate の保証範囲（明示）**: v2.0 で PASS 充足に使えるのは (1) 親セッション内で直接観測した `observed`/`derived` のみ。(2) task 出力サマリ由来は `declared`（PASS 非算入・raw transcript 観測時のみ `derived`・D29）。サブエージェント shard 内で完結した `observed` Evidence との厳密相関は best-effort（マージ可能範囲）で、完全相関は v2.5 Handoff（FR-003）依存。**よって委譲主体のワークフローでは Required Tests が `onMissingEvidence` 経路に入り WARN 優勢になる**（L0 advisory・非ブロッキング・§10.2 KPI と整合）。
- 窓判定・刻印は決定論的（純粋）に保つ（FF-002/004）。

---

## 6. データフロー

### 6.1 観測キャプチャ（全ツール実行ごと）

```text
OpenCode: tool.execute.after 発火（全ツール）
  → opencode-adapter.onToolExecuteAfter（tool!=="task" フィルタ撤廃）
  → JusticePlugin.handleEvent({ type:"PostToolUse" })
  → observation-handler.handlePostToolUse():
       1. evidence-engine: {output, metadata} → Evidence(observed) + interpretation(derived)
       2. SecretPatternDetector で rawOutput を走査・redact（§9 security）
       3. ObservationRecord 構築
       4. observation-log-store.append(shard={agentId, sessionId}, record)   ← Runtime I/O
       5. gate トリガ該当なら → 評価フロー（§6.2）
  → HookResponse 返却（proceed / WARN・FAIL なら inject）
  → mergePostToolUseResponses で plan-bridge / task-feedback と合流
```

### 6.1.1 Message 観測と declared Evidence（FR-004・declared 経路）

```text
OpenCode: event(message.updated) / chat.message 発火
  → opencode-adapter が JusticePlugin.handleEvent({ type:"Message" }) へ送出
  → observation-handler.handleMessage():
       1. メッセージ本文から合否主張（"tests pass" 等の自己申告）を抽出
       2. ObservationRecord{ kind:"message" } を構築
       3. 合否主張があれば Evidence{ provenance:"declared" } を付与（観測裏付け無し）
       4. SecretPatternDetector で text / declaredClaims を走査・redact ＋ サイズ truncation（§9.4 security）
       5. observation-log-store.append(shard={agentId, sessionId}, record)   ← Runtime I/O
  → declared は L0 advisory 入力限定（L1+ deny には不使用・FF-007）
```

- `declared` Evidence の**主な**生成経路はこの Message 観測である（tool 観測由来は observed/derived）。**加えて、task PostToolUse 出力サマリ（サブエージェント結果サマリ）由来の合否主張も `declared` として生成する（§5.8/§6.5/D29）。** 抽出ロジック（メッセージ／サマリ → 合否主張）は Core 純粋関数（FF-002）。
- `session_error`（`kind:"session_error"`）も同様に `event(session.error)` 経由で取り込む。**`message` フィールドは append 前に上記 message と同一の SecretPatternDetector 走査・redact ＋ truncation を通す**。

### 6.2 Gate 評価（v2.0 は Task Gate のみ）

```text
gate.yaml の rule が trigger 条件を宣言（task_complete / tool_observed）
観測が trigger 一致
  → rule-evaluation-engine.evaluate(gates, evidence, ctx)   ← 純粋関数（INV-009）
       戻り値 Verdict{ status, reachableLevel, ruleResults[]{ ruleId, verdict, reason, evidenceRefs[] } }
  → DecisionRecord 構築 → shard へ append
  → verdict ∈ {WARN, FAIL} かつ appliedLevel==L0:
       → formatBanner + チェックリストを inject（advisory）
  → それ以外は proceed
```

Task Gate は「Acceptance Criteria / Required Tests / Evidence / Review」(FR-005) を、**§5.8 の task 窓で `taskId` 刻印された Evidence のみ**に対し task 完了時に評価する（無関係 Evidence を除外）。

### 6.3 projection 再構築（読取時）

```text
トリガ: justice_status tool / 評価が横断状態を要する時
  → observation-log-store.readAll(shards)             ← Runtime I/O
  → state-projection.project(events): 純粋 fold
       ① shard 内を sequence 昇順で整列（因果順保持）→ ② shard 間を (timestamp, shardId, sequence) でマージ（shardId={agentId, sessionId}）→ ProjectedState（決定論的・FF-004）
  → state.json にキャッシュ
  → current_branch / active_prs は別途 live クエリ
```

### 6.4 Fail-Open 境界（INV-006）

```text
observation-handler は全ロジックを try/catch:
  (A) Infra 失敗（append/read 例外・評価クラッシュ） → log + PROCEED（決して止めない）
  (B) 正常な FAIL verdict                            → L0 advisory inject（v2.0 は非ブロッキング）
adapter 層も既に全メソッド try/catch 済み。
```

v2.0 では (A)(B) いずれも非ブロッキング。差が効くのは L1 deny が入る v2.5 以降。

### 6.5 v2.0 の既知の限界

- **サブエージェント横断 Evidence 相関**: `task()` が産むサブエージェントの tool 実行は別 shard（別 sessionId）へ記録される。projection の全シャードマージで best-effort に拾うほか、**補完として task PostToolUse 出力から合否主張を `declared` Evidence として生成**して親 `taskId` に帰属させる（§5.8/D29。PASS 非算入。raw transcript 観測時のみ `derived`）。親タスク↔サブエージェントの厳密な紐付けは Handoff 追跡（FR-003, v2.5）に依存。v2.0 の Task Gate は主に同一セッション観測 + マージ可能範囲で評価。

---

## 7. Rule Evaluation Engine と gate.yaml

### 7.1 gate.yaml スキーマ（人間が承認・コミットする静的定義）

```yaml
schemaVersion: 1
authority: human_approved        # Artifact authority（§5.7・人間が承認した契約）
gates:
  - id: required-tests
    description: "タスク完了前にテストが pass していること"
    gateType: task                 # v2.0 は task のみ
    trigger: { on: task_complete }  # task_complete | tool_observed
    check:
      type: evidence_outcome        # 組込チェック型（固定語彙）
      evidenceKind: test            # test | build | lint
      requireOutcome: pass
    onViolation: warn               # PASS|WARN|FAIL（違反時の verdict）
    onMissingEvidence: warn         # 該当 Evidence 未観測時
    enabled: true
  - id: build-green
    gateType: task
    trigger: { on: task_complete }
    check: { type: evidence_outcome, evidenceKind: build, requireOutcome: pass }
    onViolation: warn
    onMissingEvidence: warn
```

### 7.2 組込チェック型の固定語彙（v2.0・AI 動的生成は禁止 §11 V3-06）

| type | 意味 |
|---|---|
| `evidence_outcome` | 指定 kind の Evidence が指定 outcome で存在するか |
| `evidence_present` | 指定 kind の Evidence が1件以上あるか |
| `review_open_items` | Review Summary に指定 severity 以上の open 項目が無いか |

新チェック型の追加は「AI 提案 → 人間承認 → gate.yaml + engine にコード追加」。Engine は語彙を決定論的に評価するのみ。

### 7.3 Engine の契約（純粋・決定論的）

```typescript
// 純粋関数: I/O なし・時計なし・乱数なし
evaluate(gates: GateRule[], evidence: Evidence[], ctx: GateContext): Verdict
// 1. ctx.trigger に一致する gate を抽出
// 2. 各 gate の check を evidence 上で評価
// 3. gate ごとに per-rule verdict を算出 → 全体 status は最悪値合成（FAIL > WARN > PASS）
// 4. 各 rule の { ruleId, verdict, reason, evidenceRefs[] } を ruleResults[] に保持（合成で per-rule 情報を落とさない）
```

- INV-009 / FF-002: 同一 `(gates, evidence, ctx)` → 同一 `Verdict`。
- FF-003: 副作用ゼロ（I/O 不在をテストでアサート）。
- **GateContext** は観測の文脈 `{ trigger, taskId, agentId, sessionId }` を持つ（**task gate では `taskId` 必須**・§5.8）。I/O・時計・乱数は含めない（決定論のため）。
- **provenance ゲーティング（L0 充足条件・FF-008）**: `evidence_outcome` / `evidence_present` の**充足（PASS）判定に算入する Evidence は `observed` / `derived` のみ**。**ただし `derived` は起源が observed のものに限る**（task サマリ等 declared を起源とする派生は `declared` 扱いで PASS 非算入・§5.8/D29）。`declared`（自己申告）は充足に算入せず、当該 kind に observed/derived が無ければ `onMissingEvidence`（既定 WARN）として扱い、declared のみ存在する場合は「申告あり・観測なし」を WARN reason に明示する。L0 でも適用（観測のみが PASS を生む）。

### 7.4 組込デフォルト ＋ 上書き precedence ＋ trust モデル

- 組込デフォルト gate を同梱し、`.justice/gate.yaml` 無しでも動作（out-of-box）。
- `.justice/gate.yaml` があれば **同一 id を上書き / 新規追加 / `enabled:false` で無効化**。
- **trust-first**: デフォルトは `onViolation: warn`。信頼を積んでから `fail` へ引上げ。L0 では FAIL も非ブロッキング（強バナー化のみ）。

### 7.5 `justice_*` read-only custom tool（INV-002）

| tool 名 | 責務 | v2.0 |
|---|---|---|
| `justice_status` | projection を読み現在状態を報告 | ✅ |
| `justice_gate` | 現 Evidence に対し gate 評価を実行し verdict 表示 | ✅ |
| `justice_review` | Review Summary Artifact を表示 | ✅ |
| `justice_verify` | Final Verifier（Release Report） | ⏸ v2.5（FR-007） |

> **「read-only」のスコープ**: ここでの read-only は **workspace / コード / コマンド実行に対する** read-only（INV-002＝「コードを書かない・実行しない」）を指す。projection 読取に伴う `.justice/state.json` への**内部キャッシュ書込は許容**される（state.json は再構築可能な非 SoT キャッシュ・§5.6、書込失敗は fail-open・§9.4）。

### 7.6 Review Aggregator の入力源と解決規則（Finding 4 対応）

- **入力源**: `review_observed` 観測は、task/レビュー系ツールの PostToolUse 出力を既存 `ReviewRejectionDetector` で処理して生成（tool 出力 → 検出 → `ObservationRecord{ kind:"review_observed", reviewScope, items[] }`）。各 item は `itemKey`（severity ＋ 要約/該当箇所から決定的に導出）を持つ。
- **解決規則（D32・消失≠解決）**: `itemKey` ごとに集約する。`resolved` への遷移は次のいずれかでのみ成立する — (a) item に**明示的解決マーカー**がある、(b) **同一 `reviewScope` の完全スナップショット**な後続レビューで当該 item が不在、(c) **人間承認 artifact** が解決を示す。**単なる item 消失（レビュー範囲差・検出器の漏れ・出力形式変化）では `resolved` にせず `open` を据え置く**（未解決 major/critical の取りこぼしを防ぐ）。`reviewScope` が一致しない後続レビューは当該スコープ外 item の状態を変更しない。
- **集約のみ（FR-006 準拠）**: Justice はレビューを行わず集約のみ。解決判定は AX-001/002（証拠なき消失を解決と前提しない）に従う。
- `review_open_items` gate はこの `open` 集合を参照。

### 7.7 ユーザー露出インターフェース名（Finding 6 対応）

v2.0 は **custom tool 名（`justice_status` 等）で提供**。`/justice-*` slash 体験は `command.execute.before` 傍受で tool 出力を inject する **互換エイリアスとして提供可能だが v2.0 では任意（stretch）**、既定は tool 名のみ（slash 登録 API は無い・§3）。

---

## 8. Hook/Runtime 統合と DEBT-001 seam

### 8.1 観測拡張（task 限定フィルタ撤廃）＋ 安全な routing

```text
adapter: onToolExecuteBefore/After の `if (tool!=="task") return;` を撤廃 → 全ツール送出
JusticePlugin.handleEvent（Pre/PostToolUse）:
  - observation-handler を常に呼ぶ（全ツール）
  - plan-bridge / task-feedback は payload.toolName==="task" のときだけ呼ぶ ← ガード追加
```

既存ハンドラの内部は一切変更しない。「task のときだけ呼ぶ」ガードで現挙動を完全保存（563 テスト不変）。

### 8.2 INV-005 / DEBT-001 — ReflectionEvent seam（加算シャドウ）

```text
v2.0:  task-feedback の ✅付与 / loop-handler の error-note 追記は【温存】（dual）
       ＋ 同じ契機で ReflectionEvent（ObservationRecord kind:"reflection"・§5.2）を Observation Log に【発行】
目標(v2.5): plan.md 書込を撤去 → 所有者(agent/superpowers)が ReflectionEvent を消費して更新
```

- ReflectionEvent の構築ロジックは Core（純粋）、Hook はそれを呼ぶだけ（AGENTS.md 準拠）。
- v2.0 では plan.md 書込を残すので **DEBT-001 は付録 D 通り「High・未解消」のまま明示**。seam だけ先に作る。

---

## 9. テスト戦略・Architecture Fitness Functions・NFR

### 9.1 Architecture Fitness Functions（§16.1・CI required check）

| FF | 検証 | INV | v2.0 実装方法 |
|---|---|---|---|
| FF-001 | Core が `@opencode-ai/*` を import しない | INV-002 | dependency-cruiser + `tests/arch/core-no-opencode-imports.test.ts` |
| FF-002 | Core 決定論 | INV-009 | 反復評価の等価性 `tests/core/rule-engine-determinism.test.ts` |
| FF-003 | Rule Engine 副作用なし | INV-009 | I/O 不在アサート（純粋関数テスト） |
| FF-004 | Observation Log が同一 projection に replay | INV-008 | `tests/core/observation-log-replay.test.ts` |
| FF-005 | 新 spine は plan.md に書かない（+ DEBT-001 allowlist） | INV-005 | `tests/arch/no-planmd-write.test.ts`（allowlist: task-feedback / loop-handler / PlanParser） |
| FF-006 | 全 hook が注入障害下でも有効 HookResponse | INV-006 | fault-injection `tests/hooks/fail-open.test.ts` |
| FF-007 | L1+ deny の Evidence provenance ∈ {observed,derived} | INV-004 | provenance ゲーティングの単体テスト（先行実装・enforcement は v2.5） |
| FF-008 | L0 gate 充足（PASS）に算入する Evidence provenance ∈ {observed,derived}（declared／task サマリ由来は不算入・`derived` は observed 起源限定・WARN 材料） | INV-004 | provenance ゲーティングの単体テスト `tests/core/gate-provenance-gating.test.ts` |

**FF-005 の扱い（D7）**: v2.0 は「新 spine モジュールは plan.md に書かない」をアサートし、既知の DEBT-001 書込箇所（`task-feedback` ✅付与 / `loop-handler` error-note / `PlanParser.updateCheckbox`・`appendErrorNote`）を明示的 allowlist 例外として記録。新規違反はブロックしつつ、v2.5 で allowlist を空にして全域アサートへ移行。

### 9.2 Invariant ↔ FF ↔ Test マトリクス（§16.2）

| Invariant | Fitness Function | Test（target path） |
|---|---|---|
| INV-002 | FF-001 | `tests/arch/core-no-opencode-imports.test.ts` |
| INV-009 | FF-002, FF-003 | `tests/core/rule-engine-determinism.test.ts` |
| INV-008 | FF-004 | `tests/core/observation-log-replay.test.ts` |
| INV-005 | FF-005 | `tests/arch/no-planmd-write.test.ts` |
| INV-006 | FF-006 | `tests/hooks/fail-open.test.ts` |
| INV-004 | FF-007, FF-008 | `tests/core/evidence-provenance.test.ts` / `tests/core/gate-provenance-gating.test.ts` |

### 9.3 Core 単体テスト（100% 目標）

新 Core 全モジュールを純粋関数としてモックデータで全網羅。既存 `createMockFileReader/Writer`（`tests/helpers/mock-file-system.ts`）/ `createMockNotifier`（`tests/helpers/mock-notifier.ts`）を使用、**ディスク非接触**。private 検証は `unknown` 経由キャスト（AGENTS.md）。

### 9.4 NFR

| 領域 | v2.0 方針 |
|---|---|
| 並行性 | **shard 鍵=`{agentId, sessionId}`**（physical: `events/<agentId>/<sessionId>.jsonl`・D30）の JSONL シャード・全 shard 読取マージ。**同一 shard への並行 append は Runtime の per-shard async write queue（直列化キュー）で直列化**し sequence 採番もキュー内で実施（temp+rename は全置換型のため read-modify-write 競合でイベントを失う）。**ただし in-process queue はプロセス内直列化にしか効かない**ため、shard を `{agentId, sessionId}`=1 writer 単位に分離し、**複数セッション/プロセスが同一ファイルへ並行 append しない**設計で「単一ファイル並行 append 禁止」（憲章 NFR）を構造的に満たす。1 セッションが複数プロセスに跨る場合は `{agentId, sessionId, processId}` / per-writer segment へ細分化（read 側 merge で吸収） |
| スキーマ versioning | 全 `.justice/` に `schemaVersion`・`WisdomPersistence` 同様の移行戦略 |
| 保持期間 | シャードのサイズ/年齢ベース rotation → `.justice/events/archive/`（**v2.0 は archive=移送のみ／物理 prune（削除）はしない**）。replay は active＋archive を読むため再構築可能性を損なわない。**rotation 後の sequence 採番は active のみでなく当該 shard の active+archive 双方の最大 sequence から継続**し（D33）、`{shardId, sequence}` の一意性と replay 決定性（FF-004）を rotation 跨ぎで保証。旧 event の物理 prune は、replay 起点となる **canonical snapshot/checkpoint イベントを定義した後に解禁**（v2.5+）。これにより同表「projection 永続化」行の「event log が常に権威・state.json を信用しない」と矛盾しない |
| セキュリティ | **永続化前 redaction（必須）**: `.justice/events` への append 前に (1) Evidence `rawOutput`（stdout/stderr 統合）、(2) `message` 本文・`declaredClaims`、(3) `session_error.message` を**すべて `SecretPatternDetector` で走査・redact**（チャット本文・エラー文は secrets / 絶対パス / ユーザー入力が混入しやすい）。併せて各テキストに**サイズ上限を設け truncation**（肥大化・ログ汚染防止）。gate.yaml injection 検証。projection は常に再構築可能（state.json を信用しない＝改ざん耐性） |
| 性能 | tool.execute.after レイテンシ予算（§3）・実装初手で実測 |
| 信頼性 | 不変条件 (A) infra-error→fail-open を回帰テストで固定（FF-006）。L1+ 拡大は trust 蓄積後 |
| projection 永続化 | state.json は FileWriter で atomic 書込（temp+rename）・fail-open（失敗→log＋キャッシュ skip）。**event log が常に権威**（state.json 欠損/破損/schema 不一致→log から再構築。state.json を log に優先しない） |

---

## 10. スコープ・KPI・実装順序・DoD

### 10.1 v2.0 スコープ（in / deferred）

| in-scope（Phase 0 + v2.0） | deferred（v2.5+） |
|---|---|
| FR-001 Observation Log + projection | FR-003 Handoff Artifact |
| FR-002 Skill Awareness（軽量・SkillInvoked 観測） | FR-007 Final Verifier / `justice_verify` |
| FR-004 Evidence Engine（observed/derived） | L1 permission deny |
| FR-005 L0 Task Gate / Rule Engine（WARN 既定） | DEBT-001 完全カットオーバー |
| FR-006 Review Aggregator | サブエージェント Evidence 相関 |
| 観測拡張（全ツール）・`justice_status/gate/review` | 豊富な event タップ（file.edited 等） |
| FF-001〜004,006〜008 + FF-005(新 spine 限定) | Phase/Feature Gate, L2 CI/PR |

### 10.2 KPI（v2.0 は基盤層・先行指標）

憲章 §9 の KPI-1（設計乖離=Feature Gate 由来）・KPI-3（Handoff 連続性）は v2.5+ コンポーネント依存で v2.0 では測れない。v2.0 は以下の先行指標を定義:
- 観測カバレッジ率（tool 実行のうちイベント化された割合）
- Task Gate verdict 分布（PASS/WARN/FAIL）と provenance 分布（observed/declared/derived/unknown の4値）。**委譲主体のワークフローでは、サブエージェント内テストの `observed` が親 taskId に相関せず、task サマリ由来は `declared`（PASS 非算入）に留まるため WARN（onMissingEvidence）が優勢になる前提**で解釈する（§5.8/D29 と整合。厳密相関は v2.5 Handoff 後）。
- replay 決定性（FF-004 pass）

憲章 KPI は v2.5/v3 で Handoff/Feature Gate が載った時点で測定可能化。

### 10.3 実装順序（依存考慮）

```text
Phase 0(de-risk): 観測拡張レイテンシ実測 / tool hook 登録の動作確認 / ReflectionEvent seam 確定
Phase 1(build):
  1. Core types + event-model + Evidence/provenance
  2. observation-log-store + state-projection + FF-004 replay test
  3. observation-handler + adapter拡張 + routing ガード
  4. rule-evaluation-engine + gate-definition + gate-loader + 既定gate(WARN)
  5. review-aggregator（既存拡張）
  6. justice-tools(status/gate/review)
  7. ReflectionEvent seam
  8. FF/arch テスト + NFR(secret-scan, retention)
```

### 10.4 Definition of Done（v2.0）

- in-scope FR を **L0 で全実装**／FF-001〜008（FF-005 は新 spine 限定）**CI pass**
- 新 Core **100% 単体テスト**／既存 **563 テスト不変（回帰なし）**
- `bun run typecheck` / `bun run lint` / `bun run build` green
- DEBT-001 は **High・未解消として明示**（seam のみ作成）
- Task Gate の Evidence 保証範囲（親セッション観測の `observed`/`derived` + task 出力サマリ由来は `declared`（PASS 非算入）・§5.8/D29）を仕様として明記済み。サブエージェント内 `observed` の厳密相関は **v2.5 Handoff スコープ**で本 DoD 対象外。

---

## 11. Invariant トレーサビリティ

| INV | 本設計での担保 |
|---|---|
| INV-001（設計を生成しない） | Justice は plan/design を著作しない。観測と判定のみ |
| INV-002（コードを書かない・実行しない） | `/justice-*` は read-only tool。Core は OpenCode 非依存（FF-001） |
| INV-003（Verdict authority 保持） | rule-evaluation-engine が Verdict を産出 |
| INV-004（observed/derived のみ Evidence） | Evidence に provenance 必須。declared（message 由来＋**task サマリ由来**）は記録のみで **gate 充足に不算入**、`derived` は **observed 起源に限定**（観測のみが PASS を生む・§5.8/D29）。L0 充足ゲーティング=FF-008／L1+ deny ゲーティング=FF-007 |
| INV-005（plan.md 非著作） | 新 spine は書込まない（FF-005 新 spine 限定）。DEBT-001 は v2.5 で解消 |
| INV-006（Fail-Open(A) 不破） | observation-handler / adapter の try/catch（FF-006） |
| INV-007（Enforcement pluggable） | v2.0 は L0 固定。appliedEnforcementLevel フィールドで段階強化に備える |
| INV-008（SoT は外部） | state.json は projection（再構築可能）。plan/design は著作しない |
| INV-009（決定論） | state-projection / rule-evaluation-engine は純粋関数（FF-002/003/004） |

---

## 12. 既知の負債・未解決事項

| ID | 内容 | 扱い |
|---|---|---|
| DEBT-001 | Justice が plan.md を直接書込（task-feedback / loop-handler / PlanParser） | v2.0 で seam（ReflectionEvent）のみ作成。完全カットオーバーは v2.5。FF-005 allowlist で明示 |
| 限界-1 | サブエージェント横断 Evidence 相関が best-effort | 厳密な紐付けは v2.5 Handoff（FR-003）で解消 |
| 限界-2 | exit_code を直接観測できない（憲章 FR-004/§8.2 は `exit_code` を observed フィールドとして要求） | `tool.execute.after` に exit_code/stderr フィールドが無い（§3/D5）ため独立フィールドを持たず `interpretation.outcome`（provenance=`derived`）で代替し、stderr は `rawOutput` へ統合。FR-004 の「観測境界外は completeness を主張しない（INV-004）」に沿う既知の限界。上流 API 拡張要望を記録 |
| 限界-3 | 憲章 KPI-1/3 は v2.0 で未測定 | v2.0 先行指標で代替。v2.5/v3 で測定可能化 |

---

## 13. 次工程

本設計を `superpowers/writing-plans` で実装計画へ展開する（§10.3 の実装順序を分解し、各ステップに検証チェックポイントを付与）。
