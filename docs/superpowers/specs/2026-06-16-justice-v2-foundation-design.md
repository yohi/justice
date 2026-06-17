# Justice v2.0 Foundation 設計書 — Quality Control Plane（Phase 0 + v2.0）

## 0. メタ情報

| 項目 | 値 |
|------|----|
| 作成日 | 2026-06-16 |
| ステータス | Design（Accepted・実装計画化待ち） |
| 対象スライス | **Phase 0 + v2.0 基盤**（憲章 §14 Phase 1 の FR スコープに部分準拠。ただし一部は意図的に部分縮退/deferred: ①FR-004 の `exit_code` は OpenCode binding 制約により直接 observed ではなく `derived` outcome へ縮退・§12 限界-2/D5、②FR-002 の OmO agents awareness は v2.5 FR-003 Handoff へ deferred・D37/D43、③FR-005 の Acceptance Criteria は v2.5+ Feature Gate へ deferred・D35/D43、④Artifact の `authorship` は v2.0 で保持せず `authority` のみ＝憲章 §8.3 属性体系の明示的縮退・v2.5 FR-003 Handoff で拡張・**CODEOWNERS 追認対象（D63/D58/§13）**・D54/D17改訂） |
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
| D2 | v2.0 の FR スコープ | 憲章 §14 Phase 1 の FR 優先順位に**準拠**（FR-001/004/005/006 + FR-002 partial + 観測拡張）。**部分縮退を明示**: FR-002 は skill 観測のみ（agents awareness は v2.5・D37）、FR-004 は exit_code を `derived` 縮退（D5）、FR-005 は Acceptance Criteria を deferred（D35）。FR-003 Handoff・FR-007 Final Verifier は v2.5 | 憲章の実装優先順位と整合。「厳密準拠」ではなく明示した部分縮退付き準拠（D43） |
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
| D14 | レコード間参照の同一性 | `evidenceRefs` / `derivedFrom` を **`{shardId, sequence, evidenceId}` 複合参照**化（shardId=`{agentId, sessionId, writerId}`・D39）。`sequence` 単体は shard（writer segment）内一意のみ。`evidenceId` で record 内の特定 Evidence/claim/item を一意化（D31 で改訂） | shard 横断マージ時の参照曖昧性とレコード内多根拠の曖昧性を排除（レビュー指摘 R1 / 第4R 指摘3） |
| D15 | ReflectionEvent のスキーマ化 | **`ObservationRecord{kind:"reflection"}`** を追加し payload を定義。憲章の3レコード型（Observation/Decision/Learning）は維持 | DEBT-001 seam の直列化先を確定（レビュー指摘 R2） |
| D16 | Message 観測経路 | assistant 自己申告の本文は **`message.part.updated`（TextPart.text）または plugin hook `experimental.text.complete`** から取得（`message.updated`=`EventMessageUpdated` は `info:Message` のみで本文を持たず role/finish の lifecycle 用、`chat.message` は `UserMessage`=ユーザー入力で assistant 申告源ではない）→ `ObservationRecord{kind:"message"}` → `declared` Evidence のフロー（§4.2/§5.2/§6.1.1・D41） | declared の生成元と具体 event payload mapping を確定（レビュー指摘 R3 / 本レビュー指摘5） |
| D17 | Artifact メタデータ | Artifact（`gate.yaml` / Review Summary）に **`authority`** を付与（Evidence の provenance と対比）。**v2.0 は `authorship` を保持しない（D54 で改訂）**＝authorship は from→to を持つ Handoff（v2.5・FR-003）導入時に拡張 | 憲章 §8.3 の属性体系（authorship/authority）と整合。v2.0 の authorship 省略は §0 逸脱リスト・D54 に明示（レビュー指摘 R4／本レビュー指摘3） |
| D18 | shard 横断 replay の全順序化 | projection マージのソート鍵を `timestamp` → `shardId` → `sequence` の**全順序**にする（shardId=`{agentId, sessionId, writerId}`・D39）。`sequence` は shard（writer segment）内一意のため shardId で衝突を排除（D30/D39 で shardId 化） | 同 timestamp/同 sequence の shard 横断衝突で順序が未定義になる穴を解消（2026-06-16 レビュー第2R 指摘1・INV-009/FF-004） |
| D19 | retention は archive 限定 | v2.0 は rotation=archive（移送）のみ。物理 prune（削除）は canonical snapshot/checkpoint イベント定義後（v2.5+）に解禁 | 「event log が常に権威・常に再構築可能」(§9.4) との矛盾を解消（2026-06-16 レビュー第2R 指摘2） |
| D20 | Task Gate の Evidence 保証範囲 | 評価対象を親セッション観測 + task PostToolUse 出力からの **`declared`（PASS 非算入）** に限定と明記（D29→D62 で改訂: task サマリ由来は transcript 含有でも `declared` 据置・PASS 算入は v2.5 Handoff 相関後）。サブエージェント内 `observed` の厳密相関は v2.5 Handoff。委譲時 WARN 優勢を KPI/DoD に明記 | gate が subagent 実行結果をほぼ拾えず常時 WARN 化する懸念に対応（2026-06-16 レビュー第2R 指摘3） |
| D21 | ObservationRecord の union 化 | `kind` ごとの discriminated union として tool_executed/message/skill_invoked/review_observed/session_error/reflection の各 payload の必須/任意項目を定義 | payload 未定義による実装者依存を排除（2026-06-16 レビュー第2R 指摘4） |
| D22 | UI 名表記の統一 | §7.5 見出しを `justice_*` read-only custom tool に改称。`/justice-*` slash 表記は stretch alias に限定 | 章見出しの表記混在による誤解を解消（2026-06-16 レビュー第2R 指摘5） |
| D23 | 並行 append のイベント消失 | 同一 shard への append を Runtime の **per-shard async write queue で直列化**し sequence 採番もキュー内で実施。temp+rename の read-modify-write 競合を構造的に排除。**shard 鍵を `{agentId, sessionId, writerId}`（per-writer segment）に固定し「1 物理ファイル=1 writer」を構造保証**（writerId は Runtime が plugin インスタンス起動時に採番する一意 id）。複数プロセスが同一ファイルを書く経路を排除（D30/D39 で正式採用） | 「単一ファイル並行 append 禁止」の**強制機構**が未定義だった穴を解消（2026-06-16 レビュー第3R 指摘1・INV-008） |
| D24 | declared の gate 充足不算入 | 既定 gate の**充足（PASS）に算入する provenance を `observed`/`derived` に限定**。declared は「申告あり・観測なし」の WARN 材料に限定（自己申告 "tests pass" 単独で PASS させない）。FF-008 で固定 | declared が L0 gate を PASS させ警告を抑制し得る穴を解消（2026-06-16 レビュー第3R 指摘2・INV-004） |
| D25 | message/session_error の保存前 redaction | `message` の `textSnippet`・`declaredClaims`・`session_error.message` も append 前に **SecretPatternDetector 走査・redact ＋ truncation** を必須化（§6.1.1・§9.4・D34） | チャット/エラー本文の secrets・絶対パス・肥大化を永続化前に遮断（2026-06-16 レビュー第3R 指摘3・NFR security） |
| D26 | DecisionRecord の per-rule 化 | DecisionRecord/Verdict を **`ruleResults[]{ ruleId, verdict, reason, evidenceRefs[] }`** 化。全体 status は最悪値合成、各 rule の根拠を保持 | 複数 gate 同時 WARN/FAIL 時に単数 ruleId/reason が情報を落とす穴を解消（2026-06-16 レビュー第3R 指摘4） |
| D27 | projection マージの2段階化 | **shard 内＝`sequence` 優先 → shard 間＝`timestamp`→`shardId`→`sequence`** の2段階マージ（shardId=`{agentId, sessionId, writerId}`・D39）。timestamp 逆転下でも shard 内因果順を保持 | 全順序化が shard 内 causal order を壊し得る穴を解消（決定性と因果整合は別目的・2026-06-16 レビュー第3R 指摘5・INV-009/FF-004） |
| D28 | read-only のスコープ明記 | §7.5 に「read-only は workspace/code/commands に対するもので `.justice/state.json` 内部キャッシュ書込は許容」と明記 | read-only 表記とキャッシュ書込の表現衝突（誤読）を解消（2026-06-16 レビュー第3R 指摘6・INV-002/§5.6） |
| D29 | task サマリ由来 Evidence の provenance（D62 で例外撤回） | task PostToolUse 出力（サブエージェント結果サマリ）から抽出した合否主張は **`declared`** として扱い、gate 充足（PASS）には**算入しない**。**transcript を含んでも `declared` 据置とし `derived` 昇格しない**（D62: 親セッションは子の実コマンドを直接観測せず、サマリ内 transcript は自己申告経由で偽装に弱いため）。`derived` は常に **observed 起源**に限定（憲章 derived 定義と整合）。**サブエージェント結果の PASS 算入は v2.5 Handoff 相関後** | declared を `derived` に偽装して PASS 充足を迂回できる穴を解消。§5.8/§10.2 KPI の内部矛盾も解消（2026-06-16 レビュー第4R 指摘1／本レビュー Finding 1・INV-004/AX-002） |
| D30 | shard 鍵のプロセス境界 | shard 鍵を **`{agentId, sessionId, writerId}` に固定**（physical: `events/<agentId>/<sessionId>/<writerId>.jsonl`・D39）。in-process queue は単一プロセス内直列化にしか効かないため、shard を **writer（=プロセスインスタンス）単位の segment に分離**し、別プロセスは別ファイルを書く。read 側は全 segment を merge（FF-004 不変）。これにより「同一 session を単一プロセスが扱う」前提に依存しない | 単純 `{agentId, sessionId}` 鍵では複数プロセスが同一ファイルへ並行 append しイベント消失する穴を構造的に解消（2026-06-16 レビュー第4R 指摘2 / 本レビュー指摘4・INV-008/NFR 並行性） |
| D31 | レコード内多根拠の一意参照 | `evidenceRefs` / `derivedFrom` を **`{shardId, sequence, evidenceId}`**（直列化形 `{agentId, sessionId, writerId, sequence, evidenceId}`・D39）とし、record 内の特定 Evidence/claim/item を一意特定。review items は `itemKey`、message claims は `claimIndex`、tool_executed は単一 evidence の固定 id | `{agentId, sequence}` では review `items[]` / message `declaredClaims[]` のどれが判定根拠か復元できない穴を解消（2026-06-16 レビュー第4R 指摘3・Traceability 前提） |
| D32 | review 解決規則の厳格化 | `resolved` は (a) 明示的解決マーカー、(b) **同一レビュースコープの完全スナップショット**での不在、(c) 人間承認 artifact のいずれかでのみ成立。単なる item 消失（範囲差・検出漏れ・出力形式変化）では `open` 据置。`review_observed` に `reviewScope` を付与しスコープ一致を判定 | 消失=resolved により未解決 major/critical が誤って解決扱いになる穴を解消。FR-006 は集約のみ要求（2026-06-16 レビュー第4R 指摘4・AX-001/002） |
| D33 | rotation 後の sequence 採番 | sequence 初回復元を当該 shard（writer segment）の **active + archive 双方の最大 sequence** から行う（writer state の monotonic counter も可）。`{shardId, sequence}` の一意性を rotation 跨ぎで保証 | active のみ参照だと rotation 後に sequence が reset し archive と衝突、参照鍵の一意性と replay 決定性が壊れる穴を解消（2026-06-16 レビュー第4R 指摘5・INV-008/INV-009/FF-004） |
| D34 | message 本文の非永続化 | `message` レコードは本文全文を保持せず **`textHash`（必須）＋ `textSnippet`（任意・最小）＋ `declaredClaims`** のみ保存。redaction も snippet に適用 | FR-001 非目的「設計内容・実装計画・タスク定義は保持しない」への抵触経路を遮断（レビュー指摘 ISS-002・INV-001/INV-008） |
| D35 | Acceptance Criteria の v2.0 扱い | Task Gate の **Acceptance Criteria は v2.0 では観測・判定の対象外（deferred）**。固定語彙（§7.2）は Required Tests/Evidence/Review のみ対応。AC は plan.md 由来の feature 級基準で外部 SoT（INV-008）に属するため v2.5+（Feature Gate）で扱う | §6.2 の AC 評価宣言と §7.2 固定語彙の AC 機構欠如という内部不整合を解消（レビュー指摘 ISS-001・FR-005） |
| D36 | retention NFR の v2.0 充足範囲 | v2.0 は rotation（サイズ/年齢→archive 移送）を定義するが、**「無限増大を防ぐ」総量上限は archive 単独では未達のため deferred と明示**。物理 prune は canonical snapshot/checkpoint 定義後（v2.5+）に解禁 | 憲章 §13 NFR「無限増大を防ぐ」の未達の明示化（レビュー指摘 ISS-003） |
| D37 | FR-002 の v2.0 スコープ | v2.0 は **skill awareness（SkillInvoked 観測）に限定**。OmO agents awareness（どの agent が起動したか）は **FR-003 Handoff（v2.5）へ縮退** | FR-002「superpowers skills / OmO agents 把握」のうち agents 側スコープを明確化（レビュー指摘 ISS-004） |
| D38 | system shard の物理パス統一 | 予約 shard `{system, system}` の物理パスを **`events/system/system/<writerId>.jsonl`** とし、他 shard の `events/<agentId>/<sessionId>/<writerId>.jsonl` 導出規則と一致（特例排除・D39） | shardId→物理パス導出の例外を排除（レビュー指摘 ISS-005・D30/D39 と整合） |
| D39 | per-writer segment の正式採用 | shardId を **`{agentId, sessionId, writerId}`** に再定義し物理レイアウトを **`events/<agentId>/<sessionId>/<writerId>.jsonl`** とする。`writerId` は Runtime が plugin インスタンス起動時に採番する一意 id（衝突回避目的・Core 決定論には不参加）。sequence は writer segment 内単調増加、global key=`{shardId, sequence}`、参照=`{agentId, sessionId, writerId, sequence, evidenceId}`。read は全 segment を merge | 旧 `{agentId, sessionId}` 鍵は「同一 session=単一プロセス」前提に依存し複数プロセス並行 append でイベント消失する穴があった。前提を排除し「1 ファイル=1 writer」を構造保証（本レビュー指摘4・INV-008/NFR 並行性） |
| D40 | archive の物理レイアウト分離と走査規則 | rotation 退避先を **`events/` の外（`.justice/archive/events/<agentId>/<sessionId>/<writerId>.jsonl`）** に固定し live shard 名前空間（`events/<agentId>/...`）と物理分離。`agentId="archive"` 衝突と readAll 誤走査を排除。**readAll は active（`.justice/events/**`）＋ archive（`.justice/archive/events/**`）双方を列挙してマージ**し replay 可能性（FF-004）を保つと明文化 | 旧 `events/archive/` は agentId 階層と同位で衝突・誤走査の恐れがあり走査規則も未定義だった（本レビュー指摘3・INV-008/FF-004・D38 の特例排除方針と整合） |
| D41 | assistant 自己申告の event mapping 確定 | declared 経路の入力源を確定: 本文は **`message.part.updated`（`EventMessagePartUpdated`→`TextPart.text`）** または plugin hook **`experimental.text.complete`（`{messageID, partID}→{text}`）** から取得し、`message.updated`（`EventMessageUpdated.properties.info: Message`）は role/finish の lifecycle 確認に用いる。**`chat.message` は `UserMessage`（ユーザー入力）であり assistant 申告源には使わない** | `@opencode-ai/plugin` 型定義上 `chat.message`=UserMessage・`AssistantMessage` に本文フィールド無し（本文は Part 側）であり、`chat.message`/`message.updated` 等価扱いは declared 経路を空振りさせる（本レビュー指摘5） |
| D42 | sequence 採番と参照生成の時間差解決 | `sequence` は append queue 内採番のため抽出時点で未確定。(a) **同一レコード内 self-ref**（interpretation→自レコードの observed evidence 等）は `sequence` を**省略可とし `evidenceId` のみで自レコード相対参照**、(b) **クロスレコード参照**（先行 observed への `derivedFrom`/`evidenceRefs`）は projection で採番済みの `{shardId, sequence, evidenceId}` を解決して埋める。Core は採番に関与せず projection 済み Evidence のみ参照 | 参照鍵が `sequence` を要求する一方 sequence は I/O 側採番のため、純粋 Core が抽出時に参照を作れない矛盾を解消（本レビュー指摘6・INV-009/Traceability 前提） |
| D43 | v2.0 スコープ表現の精緻化と UI 表記残件 | D2 の「厳密準拠」を**明示的部分縮退付き準拠**へ緩和し、メタ情報（§0）逸脱リストに FR-002-agents（→v2.5・D37）と FR-005-AC（→v2.5・D35）を `exit_code`（D5）と並記。§11 トレーサビリティ表の `/justice-*` 表記を `justice_*` custom tool（D13/D22）へ統一 | 詳細スコープ表（§10.1）は分割済みだがサマリ見出しが完成度を過大表示し、UI 名統一後も一部 `/justice-*` が残存（本レビュー指摘1/2/7） |
| D44 | §3 Phase 0 表の Message 観測主軸を確定版へ修正 | §3 能力表（event hook 行）の「v2.0 は message.updated 主軸」を **`message.part.updated`/`experimental.text.complete`（assistant 本文源）＋ `message.updated`（role/finish lifecycle）＋ session.error ＋ tool.execute** へ修正し D16/D41 の確定 binding と一致させる。憲章 §9 OpenCode Hooks の `message.updated`/`chat.message` 列挙との差分は **Phase 0 実測（§3・`@opencode-ai/plugin` 型定義調査）に基づく binding correction** であり、**INV/ADR/Quality Protocol 自体は不変更だが Requirement レベルの hook リスト訂正を含むため、「§16.3 対象外」とは自己認定せず D58 のとおり CODEOWNERS 追認対象とする（§4.5 と同じ扱い）** | §3 サマリが D16/D41 確定前の旧表記のまま残り、declared の本文取得源（`message.part.updated`/`experimental.text.complete`）を欠いて実装者のフック配線を誤認させ得た（本レビュー指摘2） |
| D45 | `/justice-*` slash alias の実現可能性を未確定化 | §7.7 の「inject で**提供可能**」を訂正。`command.execute.before` は**登録/短絡(cancel) API は無いが `output.parts`(Part[]) 注入面は持つ**（`tool.execute.before` の `output.args` と同型）。よって正確には「読取専用」ではなく**「注入面あり・反映は未実証」**。反映可否の実証までは実現可能性を未確定とし、既定は `justice_*` custom tool 名のみ（slash 登録 API は無い） | §3 の「読取専用」表記（「登録・短絡不可の受信」の意）が型定義（`output:{parts:Part[]}` の注入面あり）と不一致だった。slash alias は元来 stretch（D13/D22）で設計根幹は不変。注入面の存在と反映未実証を正確化（本レビュー指摘 I2） |
| D46 | FF-008 の位置づけ明確化（slice-local） | FF-008 を **v2.0 slice-local fitness check（既存 INV-004 の検証強化）** と明記。憲章 §16.1 の凍結 FF 一覧（FF-001〜007）の改訂ではなく、新規 INV/ADR/Quality Protocol 変更を伴わないため §16.3 ガバナンス（2 approvals/CODEOWNERS）対象外（D58 で FF-008 は slice-local fitness として「対象外で据置」と明記。CODEOWNERS 追認対象の §4.5/D44/D5 とは区別される）。憲章正本へ昇格させる場合は §16.3 手続きを経る | 凍結憲章は FF-001〜007 のみ。設計が「§16.1」見出し下で FF-008 を追加し DoD で必須化していたが、憲章拡張か slice-local かが曖昧だった（本レビュー指摘4） |
| D47 | L0 advisory の PostToolUse 注入 surface（保証=notifier・output.output は要実証） | `tool.execute.after` は注入専用フィールド（parts/context）を持たず `output:{title,output,metadata}` のみ、かつ現 adapter は PostToolUse 戻り値を破棄する。advisory surface を**保証度で2段に分けて定義**: **(保証) (2) `JusticeNotifier`（`client.app.log`）でバナー送出**＝型上確実なチャネル。**(best-effort・要実証) (1) Runtime が可変 `output.output` 末尾へ `formatBanner` を追記**＝モデル文脈/ユーザー表示への反映は型定義に保証明記が無く Phase 0 スパイク（§3）で実証するまで断定しない（D45 の「未確認は未確認」基準を水平適用）。(3) on-demand `justice_gate` 表示。Core は `HookResponse{action:"inject"}` を返し adapter（拡張）が (1)(2) に適用（PreToolUse の prompt mutation と対称だが、Pre=実行前 args 消費が自明なのに対し Post=実行後 output の文脈反映は別問題） | `tool.execute.after`=`{title,output,metadata}`・PostToolUse 戻り値破棄（`onToolExecuteAfter`）・`output:{readonly output}` の readonly 撤廃と戻り値捕捉が (1) の前提。`experimental.session.compacting` と異なり反映明記の JSDoc が無い。中核 advisory の保証は notifier、output.output は実証後に確定（本レビュー指摘 C1・D45 と同基準） |
| D48 | 全ツール観測 hook からの agentId 取得経路 | `tool.execute.before/after` の input は `{tool,sessionID,callID,args}` で agent を持たないため、Runtime が `chat.message`（`agent?`）/`chat.params`（`agent`）観測で `sessionID→agentId` マップを構築し tool 観測時に sessionID で解決。未解決時は予約 shard `{system,system}`（D38）または `agentId:"unknown"` へフォールバック。OpenCode agent 名（自由文字列）→ Justice `AgentId`（atlas/hephaestus/sisyphus/prometheus）の写像を Core に定義し未知は `unknown` | tool hook に agent 不在（`@opencode-ai/plugin` 型定義）。agentId 必須 shard（D39）・persona isolation・Evidence 帰属が実装者依存になる穴。`chat.*` に agent が実在し解決可能（本レビュー指摘2・FR-001） |
| D49 | tool Evidence rawOutput の kind 別保存ポリシー | D34（message 本文非永続化）と同原則を tool Evidence に適用。`test`/`build`/`lint`/`command`（コマンド実行系）は `rawOutput` を redact+truncation して保存（合否観測に必要）。`read`/検索/ファイル本文系ツール出力は **rawOutput 全文を保存せず** `rawOutputHash`（必須）＋最小 snippet＋kind 分類のみ（plan/design/code 本文の複製を遮断） | read/bash(cat)/grep 出力に plan/design/code 本文が混入し `.justice/events` が外部 SoT の複製になる（FR-001 非目的・INV-008）。redaction+truncation は secrets/path 向けでコンテンツ境界を守れず、D34 と非対称だった穴を解消（本レビュー指摘3） |
| D50 | `justice_gate` の dry-run 化（DecisionRecord 非生成） | `justice_gate` は **dry-run 表示のみ**で DecisionRecord を **append しない**。正式な DecisionRecord は hook 起点の gate 評価（trigger=`task_complete`/`tool_observed`・§6.2）のみが生成。justice_gate は現 projection/Evidence への評価結果表示に留め canonical log・replay・KPI を変えない | §7.5 read-only 注記は state.json キャッシュ書込のみ許容と述べ DecisionRecord 追記を沈黙。照会が判定ログを変えれば read-only・replay・verdict 分布 KPI を汚す（本レビュー指摘4・INV-002） |
| D51 | ReflectionEvent `planRef` の path 化 | `planRef` を `{ path, taskId }` に改め `path` は **workspace 相対パス必須・絶対パス禁止**（グローバル No Absolute Paths 準拠）。値は `PlanBridge`/`TaskFeedbackHandler` の `setActivePlan(sessionId, planPath)` 追跡済み実 path を記録し "plan.md" 固定を廃止 | 本プロジェクトは `docs/superpowers/specs/*.md` 等 複数 plan/design を持ち basename 固定では v2.5 で所有者が更新対象を復元不能（本レビュー指摘5・No Absolute Paths） |
| D52 | tool Evidence 保存ポリシーの schema 化（D49 の正規化） | D49 の保存方針を **`toolOutputClass`（`"command_exec"` / `"file_content"`）軸**（`kind` と直交）として §5.3 に追加。`rawOutput`（command_exec・redact+truncation 保存）と **`rawOutputHash`（必須）＋`rawOutputSnippet`（任意・最小・redact後）**（file_content）を discriminated union で排他化。分類器（§5.3）に read/grep/glob/cat 等→`file_content` 分岐を追加 | D49 の決定が §5.3 スキーマへ未伝播で、`kind` enum・分類器に file-content 軸も `rawOutputHash`/`rawOutputSnippet` フィールドも無く、read 出力が rawOutput 全文保存され plan/design/code 本文を複製する（FR-001 非目的・本レビュー指摘1・INV-008） |
| D53 | assistant 本文の role 相関モデル | 本文（part・role 無し）と role（`message.updated`）を結合する一時 projection **`messageRoleBuffer: {sessionId, messageID} → { role, partIDs[], finalized }`**（複合鍵・TTL 既定 10 分・LRU 上限は D65）を observation-handler に定義。part 先行（到着順逆転）時は pending 保留→後続 `message.updated` で role 解決後に評価、role≠assistant は破棄、`finalized`/TTL で GC。declaredClaims 抽出は role=assistant 確定 part のみ（§6.1.1） | 本文と role が別イベントのため相関機構なしでは role=assistant 強制が不能でユーザー入力を declared 誤抽出し得た（本レビュー指摘2・FR-004/INV-004） |
| D54 | Review Summary Artifact の正本・authorship 確定 | Review Summary は **projection-derived Artifact**（正本=`review_observed` レコード→review-aggregator→`state.json` projection→`justice_review` on-demand 表示・別ファイル永続なし・§5.7）。**v2.0 は Artifact に `authority` のみ保持し `authorship` は持たない**（観測集約に作成者契約概念が無い・from→to を持つ Handoff の v2.5 で拡張） | Review Summary の具体表現が state.json projection のみで正本/永続/authorship が曖昧だった（本レビュー指摘3・憲章 §8.3/FR-006） |
| D55 | writerId の採番方式・文字種 | writerId を **`"w-" + crypto.randomUUID()`** で Runtime が plugin インスタンス起動時に採番。**文字種 `[A-Za-z0-9-]` に制限**（ファイル名 `<writerId>.jsonl`＋参照鍵 `{…,writerId,…}` 安全性・パストラバーサル防止）、予約語 `system`（D38）と区別、衝突確率は無視可能だが万一の既存ファイル衝突時は再採番（§5.1/§9.4） | 「1 物理ファイル=1 writer」構造保証が writerId 一意性に依存する一方、採番方式/衝突/文字種が未定義だった（本レビュー指摘4・INV-008/NFR 並行性） |
| D56 | ObservationAgentId 型の定義 | Observation の `agentId` 値域を **`ObservationAgentId = AgentId / "system" / "unknown"`**（AgentId=atlas/hephaestus/sisyphus/prometheus）として Core に定義（`system`=予約 shard・D38、`unknown`=agent 解決不能）。**persona isolation / wisdom routing には `AgentId`（4 persona）のみ流し `system`/`unknown` は流さない**（wisdom namespace 非汚染）（§5.1） | envelope の agentId が system/unknown を含むが既存 AgentId（4 persona・wisdom 用）型と同名で型が曖昧だった（本レビュー指摘5・persona isolation） |
| D57 | review severity の決定論的導出 | severity は **語彙ベースの決定論的分類器**（凍結 RegExp・critical>major>minor 順位評価・一致無しは既定 minor）で導出し、現 `ReviewRejectionSignal`={matched,excerpts,summary} に新規付与（§7.6）。`itemKey`=severity＋正規化要約＋location の決定的合成で同一論点を安定化（D32 の前提）。AI 動的生成はしない（§11 V3-06） | 現検出器に severity 分類が無く（`review-rejection-detector.ts`）、`review_observed.items[].severity` 必須・itemKey 導出（D31）・解決規則（D32）が severity 依存のため、導出アルゴリズム未定義だと itemKey 不安定化→解決判定が破綻する（本レビュー指摘 I1・FR-006） |
| D58 | Phase 0 由来の憲章訂正を CODEOWNERS 追認へ（D63 で authorship 追加） | hook リスト訂正（D44）・FR-001 保存パス詳細化（§4.5）・FR-004 exit_code の `derived` 縮退（D5/限界-2）**＋ Artifact authorship 非保持（§8.3 属性体系の縮退・D54/D63）**は **Requirement レベルの実質変更/訂正/縮退**を含むため、設計側の「§16.3 対象外」自己認定を撤回し、**1 本の ADR にまとめ CODEOWNERS 追認**を得る（軽量可）。FR-002-agents/FR-005-AC は憲章 §14 Phase 計画に沿う FR 単位の後送りのため追認不要、FF-008（D46）は slice-local fitness のため対象外で据置 | 凍結憲章（§16.3）の整合性。設計が逸脱を「互換的詳細化＝対象外」と自己認定し続けると凍結が形骸化する。各論の技術判断は妥当だが、対象外判断自体を憲章オーナーが追認する形にする（本レビュー指摘 I3／Finding 2・§16.3） |
| D59 | Evidence の源泉判別（sourceClass union） | Evidence を **`sourceClass`（`"tool_output"` / `"declared_claim"`）の discriminated union**化。`tool_output`（ツール実行/ファイル本文の観測系）のみ `toolOutputClass`（`command_exec` / `file_content`・D52）＋ `rawOutput` / `rawOutputHash` / `rawOutputSnippet` を持つ。`declared_claim`（message 由来＋ task サマリ由来の自己申告）は `toolOutputClass` / `rawOutput*` を**持たず**、`declaredFrom`（`message` / `task_summary`）＋ `claim{claimKind, outcome}` ＋任意 `claimRef` を持つ（provenance は必ず `declared`・PASS 非算入・D24/D29/FF-008） | §5.3 が `toolOutputClass` を必須化し rawOutput/rawOutputHash union を前提するため、message（§5.2(b)）/ task サマリ（§5.8）由来の declared Evidence が無理な `toolOutputClass` 付与や空 `rawOutputHash` を強制され provenance/gate の型安全性が崩れる穴を解消（本レビュー指摘1・INV-004/FF-008） |
| D60 | bash 経由ファイル本文出力の分類（Finding 3） | `toolOutputClass` 判定を toolName 単独から **args.command 解析併用**へ拡張。bash 系ツール（`bash`/`shell` 等）の args.command を解析し、**ファイル本文出力コマンド（凍結語彙: `cat`/`head`/`tail`/`less`/`more`/`nl`/`tac`/`sed` の印字/`awk` の印字/`grep`・`rg`・`ag` のファイル対象/`xxd`/`od`/`hexdump`/`strings` 等）**を検出した場合 `file_content`（rawOutputHash＋最小 snippet のみ・本文非保存）へ分類。test/build/lint 等の合否観測系は `command_exec` 維持。**判定不能（混在パイプ・未知コマンド）かつ rawOutput がしきい値超過時は保守的に file_content 相当（rawOutputHash＋truncated snippet）へフォールバック**し plan/design/code 本文の全文複製を構造遮断。語彙・判定は純粋関数（FF-002） | D49/D52 の分類が toolName 依存で、bash 経由の `cat`/`sed`/`awk`/`head`/`tail`/`rg` が `command_exec` 扱いとなり rawOutput 全文保存される抜け道（FR-001 非目的・INV-008）。D49 根拠が挙げた「bash(cat)」脅威を分類規則へ反映。truncation はサイズのみで本文境界を守れないため命令語彙＋保守フォールバックで遮断（本レビュー Finding 3） |
| D61 | Evidence command/args の保存前 redaction（Finding 4） | append 前 redaction 対象に **Evidence `command` および保持する tool args 由来メタデータ**を追加（D25 を拡張）。`SecretPatternDetector` 走査＋**絶対パス redaction**（グローバル No Absolute Paths）＋ token 付き URL/環境変数値の遮断を §6.1/§9.4 に明記。redaction 後のみ永続化 | 旧 redaction 列挙が rawOutput/message snippet/session_error に偏り、`command`（§5.3）に secret/絶対パス/token URL/環境変数値が混入し永続化され得た（憲章 §13 NFR security「evidence 内のシークレット走査」・グローバル Credential Protection・本レビュー Finding 4） |
| D62 | task サマリ由来は transcript 含有でも declared 据置（Finding 1・D29 改訂） | D29 の「raw transcript 含有・観測可能時のみ `derived` 昇格」例外を**撤回**。task PostToolUse 出力サマリ由来の合否主張は **transcript を含んでも `declared` 据置（PASS 非算入）**。理由: 親セッションは子（サブエージェント）の実コマンドを `tool.execute.after` で直接観測しておらず、サマリ内 transcript は自己申告チャネル経由で偽装・要約漏れ・整形改変に弱く、憲章 §8.2 observed 定義（直接観測）と D29 自身の「derived は observed 起源限定」を満たさないため。**サブエージェント実行結果の PASS 算入は v2.5 Handoff（FR-003）相関確立後に限定** | 再パース可能性を observed 起源と誤認し、declared を `derived` に偽装して PASS 充足を迂回する穴（D29 が塞いだ穴の変種）を再開していた。AX-002/INV-004 の趣旨を堅持（本レビュー Finding 1） |
| D63 | authorship 縮退も CODEOWNERS 追認対象へ（Finding 2） | D54 の **Artifact authorship 非保持（憲章 §8.3 属性体系の明示的縮退）**を D58 の CODEOWNERS 追認 ADR に**追加**（§13 着手前提にも反映）。FR-002-agents/FR-005-AC の deferred が「憲章 §14 Phase 計画に沿う FR 単位の後送り＝追認不要」なのに対し、authorship は **v2.0 で実体化する Artifact（`gate.yaml`/Review Summary）の属性体系を縮退**させる requirement-level 逸脱のため D58 と同じ軽量追認に載せる | 設計が「明示的縮退」と自認しつつ追認対象から外すのは D58 自身の「逸脱の自己認定が凍結を形骸化させる」戒めに反する。逸脱種別（FR 後送り vs 属性縮退）を区別して統制（本レビュー Finding 2・§16.3） |
| D64 | PostToolUse 三者合流時の payload マージ規則（Finding 5） | observation-handler の L0 advisory は **injectedContext（`mergePostToolUseResponses` で区切り線連結）＋ notifier（保証・D47）**で射出し、構造的 `modifiedPayload` は**使わない**。`output.output` 末尾追記（best-effort・D47）は adapter が**複数ハンドラの追記を決定論的ハンドラ順に連結**して適用（置換でなく追記のため衝突しない）。複数ハンドラが `modifiedPayload` を返す異常系は現実装の「a 優先」を踏襲しつつ衝突を log 警告（v2.0 は observation-handler が modifiedPayload 不使用のため未発生） | 現 `mergePostToolUseResponses`（`src/core/justice-plugin.ts`）は inject 連結のみ定義し `modifiedPayload` は片方優先で他方が黙って破棄される。plan-bridge/task-feedback と observation-handler の三者合流で payload mutation を取りこぼす穴（本レビュー Finding 5） |
| D65 | messageRoleBuffer の鍵/TTL 確定（追加指摘4・D53 改訂） | `messageRoleBuffer` の鍵を **`{sessionId, messageID}` 複合鍵**に確定（messageID の全セッション一意性に依存せず session 終了 GC を容易化）。**TTL 既定=10 分無更新（設定可）**、`session.error`/セッション終了で即時 GC、`finalized` 後は次 projection flush で除去。**上限件数（LRU・既定 1000）**でバッファ肥大を防止 | D53 が鍵=messageID 単体・TTL=「N 分」プレースホルダのままで、跨セッション衝突耐性と GC 条件/上限が未確定だった（本レビュー追加指摘4・NFR メモリ/並行性） |
| D66 | `review_open_items` の scope-aware 化（本レビュー Finding 1） | `review_open_items` gate を **scope 絞り込み**化する。(a) `state.json` の `reviewSummary` に **`byScope: {<reviewScope>: {critical,major,minor,resolved,open}}`** を追加（§5.6・グローバル集約は後方互換で併存）、(b) `GateContext` に **`reviewScope[]`（当該 task 窓内で観測した `review_observed.reviewScope` 集合・§5.8 で taskId 刻印済み）** を追加（§7.3）、(c) `review_open_items` は **`ctx.reviewScope[]` に一致する `byScope[scope].open` のみ**を参照し、別 task/別レビュー範囲の open を verdict に混入させない（§7.2/§7.6）。該当 scope に open 無し＝条件成立で PASS（レビュー未観測を FAIL にしない） | `reviewScope` が §7.6/D32 の**解決規則のみ**に使われ gate 評価（§7.2/§7.3）に scope 絞り込みが無く、`reviewSummary`（§5.6）がグローバル単一集約のため、別 task/別スコープの open が現 Task Gate を WARN/FAIL させ §5.8 の per-task 原則を破る穴（本レビュー Finding 1・FR-006/INV-009） |
| D67 | declared 抽出のストリーミング確定・partID 上書き・dedup（本レビュー Finding 2） | message からの `declaredClaims` 抽出を **テキスト確定後のみ**に限定。(a) `messageRoleBuffer` に **`parts: Map<partID,{text,finalized}>`** を追加し、`message.part.updated` 受信時は当該 partID の text を**最新値で上書き**（中間ストリーミングは buffer 更新のみで抽出しない）、(b) 抽出契機は **`experimental.text.complete` または message.updated の finish 確定**で part を finalized 化した後とし、**finalized かつ role=assistant の part 本文からのみ**抽出（§6.1.1）、(c) 同一 `(messageID,partID)` からの再生成 claim は既存を**置換（dedup）**し、否定・修正された陳腐化主張（"tests pass"→後に fail）を残さない | §6.1.1 の抽出が **role でのみゲート**され text finalization でゲートされず、`finalized` が GC 用途（§6.1.1）に留まり buffer が partID 単位 latest-text を持たないため、ストリーミング途中の合否主張が確定・残存し得た穴（本レビュー Finding 2）。declared は PASS 非算入（D24/D29/FF-008）で gate 誤 PASS の実害は無いが監査ノイズ/誤 WARN を防ぐ（severity 実質 Medium） |
| D68 | `tool_observed` trigger × taskId 不在時の評価規則（本レビュー Finding 3） | `gateType:"task"` の gate は **`ctx.taskId` 不在時は評価を skip**（DecisionRecord 非生成・PROCEED・§6.2/§7.3）。`trigger: tool_observed` が **task 窓外（taskId 未刻印）の観測で発火しても task gate は起動せず**観測記録のみ行う。task 窓内（taskId あり）の tool_observed のみ評価対象。v2.0 は gateType=task のみ（§5.4）で global/session gate が無いため、taskId 不在 tool_observed は gate 評価しない | trigger 語彙が `task_complete | tool_observed`（§6.2・gate.yaml）を許す一方 `task gate では taskId 必須`（§7.3/§5.8）で、窓外 `tool_observed` 発火時の skip/WARN/global 扱いが未定義で実装分岐し得た穴（本レビュー Finding 3） |
| D69 | `sessionId` 等パスセグメントの safe-segment エンコード（本レビュー Finding 4） | 物理パス `events/<agentId>/<sessionId>/<writerId>.jsonl`（§4.5/§5.1）のうち**外部由来 `sessionId` を Runtime が FileWriter 直前に safe-segment へエンコード**: 許容 `[A-Za-z0-9_-]`・それ以外を `_` 置換・`.`/`..`/空文字は予約語へ・長さ上限 truncation・パストラバーサル防止。`agentId`（enum・D56）/`writerId`（`[A-Za-z0-9-]`・D55）は既に安全。**論理鍵 `shardId={agentId,sessionId,writerId}` と参照鍵には生 `sessionId` を保持**し、エンコードは物理ファイル名生成にのみ適用（衝突回避が要る場合は短ハッシュ接尾辞）。§9.4 NFR security に統合 | パス3セグメントの安全性定義が `writerId`（D55）/`agentId`（D56）のみで、外部由来 `sessionId`（§5.1 `ses_...`）の文字種・エンコード・パストラバーサル防止が未定義だった穴（本レビュー Finding 4・NFR security・グローバル No Absolute Paths/パストラバーサル防止） |

---

## 3. Phase 0 解決（FATAL ブロッカー）

`@opencode-ai/plugin` v1.14.21 の型定義調査により確定（出所: `node_modules/@opencode-ai/plugin/dist/index.d.ts` L171–313）。

| 項目 | 結果 | 設計への反映 |
|---|---|---|
| スラッシュコマンド登録 | ❌ コマンド登録・短絡(cancel) API 無し。ただし `command.execute.before` は `output.parts`(Part[]) **注入面を持つ**（`tool.execute.before` の `output.args` と同型・**反映は未実証**）＝「読取専用」ではない | `/justice-*` を `tool` hook でカスタム tool 化（D4）。slash alias は反映実証後に判断（D45） |
| 全ツール観測 | ✅ `tool.execute.before/after` は全ツールで発火 | 観測拡張（task 限定撤廃）成立 |
| exit_code / stderr | ❌ `tool.execute.after` は `{title, output, metadata}` のみ。exit_code 無し・stderr は output に統合 | Evidence の合否は `derived`（D5）。`metadata.error===true` を補助シグナルに使用 |
| permission.ask | ✅ `"deny"/"allow"/"ask"` 返却可 | L1 enforcement 経路は実在（v2.5 で使用） |
| event hook | ✅ 32 種（`@opencode-ai/sdk` v1.14.21 `Event` union 実数・SDK 版で増減。message.updated / message.part.updated / session.error / file.edited / vcs.branch.updated 等） | v2.0 は **message.part.updated / experimental.text.complete（assistant 本文源）＋ message.updated（role/finish lifecycle）＋ session.error ＋ tool.execute** を主軸（D16/D41/D44）。`chat.message`=UserMessage は申告源に使わない。残りは v2.5+ |

**Phase 0 で残る実測スパイク（2 件・実装初手で実施）**:
1. **観測拡張レイテンシ計測**: 全ツール `tool.execute.after` 観測のオーバーヘッド（目標例: p95 < 数 ms / tool 呼び出し）。未達時は非同期キュー + flush を検討。
2. **L0 advisory 表示面の実証（C1 対応）**: `tool.execute.after` の可変 `output.output` 末尾追記が**モデル推論文脈／ユーザー表示に反映されるか**を実機確認。型定義（`@opencode-ai/plugin` v1.14.21 `tool.execute.after`）には反映を保証する JSDoc が無く、`experimental.session.compacting` のような明記も無いため未実証（D47）。反映不可なら**保証チャネルは notifier（`client.app.log`）**とし `output.output` 追記を best-effort と確定する。

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
| `review-aggregator.ts` | 既存 `ReviewRejectionDetector` 拡張。**現 `ReviewRejectionSignal`={matched,excerpts,summary} に severity 分類（critical/major/minor）を新規追加（D57）**。Artifact `{critical,major,minor,resolved,open}` 出力 | FR-006 |

### 4.2 新規 Hook（調整・enforcement 発火のみ／ロジックは Core 委譲）

| モジュール | 責務 |
|---|---|
| `observation-handler.ts` | 全ツールの Pre/PostToolUse ＋ **Message（assistant 本文は `message.part.updated`/`experimental.text.complete`、`message.updated` は role/finish lifecycle・§6.1.1/D41）** を観測 → Observation 生成 → gate 評価 → L0 advisory surface 出力（`output.output` 追記＋notifier・D47）。既存ハンドラと `mergePostToolUseResponses` で合流 |

### 4.3 新規 Runtime（実 I/O）

| モジュール | 責務 |
|---|---|
| `observation-log-store.ts` | `.justice/events/<agentId>/<sessionId>/<writerId>.jsonl`（shard 鍵=`{agentId, sessionId, writerId}`・per-writer segment・§9.4/D30/D39）への atomic 追記（temp+rename）+ active＋archive 全 segment 読取マージ（D40）。**同一 shard への append は per-shard async write queue で直列化**（read-modify-write 競合とイベント消失を防止・§9.4 並行性）。sequence は直列化キュー内でインメモリ管理（初回は当該 shard の **active + archive 双方の最大 sequence** から復元・rotation 跨ぎ衝突を防止・D33） |
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
  events/<agentId>/<sessionId>/<writerId>.jsonl   # 追記専用 Observation+Decision ログ（shard 鍵={agentId, sessionId, writerId}・1 物理ファイル=1 writer・D39）
  events/system/system/<writerId>.jsonl          # 予約 shard: shardId={agentId:"system", sessionId:"system", writerId}（他 shard と同一のパス導出規則・特例排除・D38。順序キーは timestamp→shardId→sequence）
  archive/events/<agentId>/<sessionId>/<writerId>.jsonl   # retention rotation 退避先（live shard 名前空間と物理分離・readAll は active(events/**)＋archive(archive/events/**) を列挙・D40）
  gate.yaml                # 人間が承認した静的ルール（+ 組込デフォルト）
  state.json               # projection キャッシュ（再構築可能・SoT ではない）
  wisdom.json              # 既存（不変）
```

> **憲章保存先パスとの関係（互換的詳細化＋D58 追認）**: 憲章 FR-001/§8.1 の保存先 `.justice/events/<agentId>.jsonl` を上位概念とし、本設計はその互換的詳細化として agentId 配下に sessionId/writerId の階層を置く（`events/<agentId>/<sessionId>/<writerId>.jsonl`・shard 鍵=`{agentId, sessionId, writerId}`・D39）。これは並行 append 競合・イベント消失の構造的回避（D30/D39・INV-008・§9.4 並行性）のための実装詳細であり、憲章の INV / ADR / Quality Protocol 自体は変更しない。ただし FR-001 保存先パスの詳細化は Requirement レベルの実質的詳細化を含むため、**「§16.3 凍結ガバナンスの対象外」とは自己認定せず、D58 のとおり 1 本の ADR にまとめ CODEOWNERS 追認を得る**（軽量追認・§13 次工程 I3/D58）。読取時は active＋archive の全 segment をマージするため projection 再構築可能性（FF-004）は保たれる。

> **パスセグメントの安全性（D69・本レビュー Finding 4）**: 物理パス `events/<agentId>/<sessionId>/<writerId>.jsonl` の各セグメントは、`agentId`（enum・D56）/`writerId`（`[A-Za-z0-9-]`・D55）が安全な一方、**外部由来の `sessionId` は Runtime が FileWriter 直前に safe-segment へエンコード**する（許容 `[A-Za-z0-9_-]`・それ以外を `_` 置換・`.`/`..`/空文字は予約語へ・長さ上限 truncation・パストラバーサル防止）。論理鍵 `shardId={agentId,sessionId,writerId}` と参照鍵には**生 `sessionId`** を保持し、エンコードは物理ファイル名生成にのみ適用（OpenCode の `ses_*` は通常無変換だが防御的に常時適用・衝突回避が要る場合は短ハッシュ接尾辞）。§9.4 NFR security と整合。

---

## 5. データモデル / イベントスキーマ

### 5.1 共通エンベロープ（全レコード）

```jsonc
{
  "schemaVersion": 1,
  "sequence": 42,               // shard 内 単調増加（shard 鍵=shardId={agentId, sessionId, writerId}・グローバル一意キーは {shardId, sequence}＝{agentId, sessionId, writerId, sequence}・D39）
  "timestamp": "2026-06-16T07:00:00.000Z",
  "agentId": "hephaestus",            // 値域 ObservationAgentId=AgentId("atlas"|"hephaestus"|"sisyphus"|"prometheus")|"system"|"unknown"（D56）。取得: chat.message(agent?)/chat.params(agent) で sessionID→agentId 解決・未解決は system/unknown・OpenCode agent 名→AgentId 写像（D48）。persona isolation/wisdom routing には AgentId(4 persona) のみ流す（system/unknown 非流入・D56）
  "sessionId": "ses_...",       // 物理パスセグメント化時は safe-segment エンコード（[A-Za-z0-9_-] 以外を置換・"."/".."/空を予約置換・パストラバーサル防止・D69）。論理鍵 shardId/参照には生値を保持
  "writerId": "w-3f2a9c4e",     // 必須: writer segment 識別子（Runtime が "w-"+crypto.randomUUID() で採番・文字種 [A-Za-z0-9-]・予約語 system と区別・shardId={agentId, sessionId, writerId} の3要素目・§9.4/D39/D55）
  "taskId": "task-3",           // task 窓内の観測に刻印（無ければ省略・§5.8）
  "recordType": "observation" | "decision" | "learning"
}
```

読取時の projection 再構築は **2段階マージ**で行う（§6.3）: ① **shard 内**は `sequence` 昇順で整列（shard 内因果順＝単調増加の sequence を最優先。時計ずれや timestamp 逆転があっても shard 内の因果順を壊さない）、② **shard 間**は整列済みの各 shard を `timestamp` → `shardId` → `sequence` でマージ（shardId=`{agentId, sessionId, writerId}`・D39。同 timestamp の shard 横断衝突は二次キー `shardId`・三次キー `sequence` で一意化）。これにより決定性（FF-004）と shard 内因果整合を両立する（INV-009）。

> **レコード参照の同一性とソート順序**: `sequence` は **shard（=shardId=`{agentId, sessionId, writerId}`）内**単調増加であり shard 横断では一意でない。よってレコード間参照（`evidenceRefs` / `derivedFrom`）は **`{shardId, sequence, evidenceId}` 複合参照**を用い、複数シャードをマージした後も根拠 Evidence を曖昧さなく解決する（`evidenceId` は record 内の特定 Evidence/claim/item を一意化・§5.3 / §5.4 / D31）。**projection マージは「① shard 内＝`sequence` 優先 → ② shard 間＝`timestamp`→`shardId`→`sequence`」の2段階**とし、shard 内の因果順（sequence）を timestamp 逆転から保護しつつ、shard 横断の衝突時も replay を決定論化する（§6.3 / FF-004）。全順序化（決定性）と shard 内因果整合は別目的であり、2段階マージで同時に満たす。
>
> **参照のレコード表現（型の正本）**: 上記の複合参照は記録上 **`{agentId, sessionId, writerId, sequence, evidenceId}` の展開形**で直列化する（§5.3 `derivedFrom` / §5.4 `evidenceRefs` の JSON 例と一致・D39）。`shardId` は `{agentId, sessionId, writerId}` の別称であって独立フィールドとしては直列化しない（§5.1 エンベロープの等価関係 `{shardId, sequence}`＝`{agentId, sessionId, writerId, sequence}`）。実装の参照型はこの5要素オブジェクトを単一の正本とし、D14/D31 の `{shardId, …}` 表記はこの展開形を指す。**同一レコード内 self-ref**（interpretation→自レコードの observed evidence 等）は `writerId`/`sequence` を省略し `evidenceId` のみで自レコードを相対参照、**クロスレコード参照**は projection で採番済みの値を解決して埋める（sequence は append queue 採番のため抽出時点では未確定・D42）。

### 5.2 ObservationRecord（観測した事実）

```jsonc
// ObservationRecord = 共通エンベロープ（§5.1）+ kind ごと payload の discriminated union（判別子 = kind）
// kind ∈ "tool_executed" | "message" | "skill_invoked" | "review_observed" | "session_error" | "reflection"

// (a) tool_executed — 全ツール実行の観測
{ "...envelope":"...", "recordType":"observation", "kind":"tool_executed",
  "toolName":"bash",           // 必須
  "callId":"call_...",         // 必須
  "evidence":{ /* §5.3 */ } }  // 必須: observed Evidence(+interpretation?)

// (b) message — エージェント発話（declared 経路・本文源は message.part.updated/experimental.text.complete・§6.1.1/D41）
{ "...envelope":"...", "recordType":"observation", "kind":"message",
  "role":"assistant",          // 必須: 発話主体
  "textHash":"sha256:...",     // 必須: 本文のハッシュ（全文は保持しない・FR-001 非目的・§6.1.1/§9.4・D34）
  "textSnippet":"...",         // 任意: declaredClaims 文脈の最小スニペット（redact＋truncation 後）
  "declaredClaims":[           // 任意(0..n): 抽出した自己申告
    { "claimKind":"test"|"build"|"lint"|"generic", "outcome":"pass"|"fail"|"unknown" } ],
  "evidence":{ /* §5.3, sourceClass:"declared_claim", provenance:"declared", declaredFrom:"message" */ } }  // declaredClaims 存在時のみ付与（D59）

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
    "planRef": { "path": "docs/superpowers/specs/<plan>.md", "taskId": "task-3" },  // path=workspace 相対・絶対禁止・PlanBridge/TaskFeedback 追跡値・D51
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
  "sourceClass": "tool_output" | "declared_claim",     // 必須: Evidence 源泉の判別子（discriminated union の判別子・D59・本レビュー指摘1）
  "provenance": "observed" | "declared" | "derived" | "unknown",

  // ══ (A) sourceClass:"tool_output" — ツール実行/ファイル本文の観測（provenance: observed/derived）。下記フィールドは tool_output 時のみ ══
  "toolOutputClass": "command_exec" | "file_content",  // tool_output 時のみ必須: 保存ポリシー判別子（kind と直交・D49/D52）
  "command": "bun run test",                   // command_exec 系で有効（file_content では省略可）
  // ── 出力保存は toolOutputClass による discriminated union（D49/D52・FR-001 非目的「本文を保持しない」）──
  //   command_exec（bash/test/build/lint 等の合否観測系。bash は args.command がファイル本文出力でない場合・D60）→ "rawOutput" を保存（redact+truncation・§9.4）
  //   file_content（read/grep/glob＋bash 経由のファイル本文出力コマンド cat/sed/awk/head/tail/rg 等・D60）→ "rawOutput" を持たず "rawOutputHash"(必須)＋"rawOutputSnippet"(任意・最小・redact後) のみ（plan/design/code 本文の複製を遮断）
  "rawOutput": "...stdout(+stderr統合)...",     // tool_output && command_exec のみ
  "rawOutputHash": "sha256:...",               // tool_output && file_content のみ（必須）
  "rawOutputSnippet": "...",                   // tool_output && file_content のみ（任意・最小・redact後）

  // ══ (B) sourceClass:"declared_claim" — message/task サマリ由来の自己申告（provenance は必ず "declared"）。toolOutputClass/rawOutput* は持たない（D59・本レビュー指摘1）══
  "declaredFrom": "message" | "task_summary",  // declared_claim 時のみ必須: 申告の出所（§5.2(b)/§5.8/D29）
  "claim": { "claimKind": "test" | "build" | "lint" | "generic", "outcome": "pass" | "fail" | "unknown" },  // declared_claim 時のみ必須: 抽出した合否主張
  "claimRef": { "agentId": "...", "sessionId": "...", "writerId": "...", "sequence": 0, "evidenceId": "...", "claimIndex": 0 },  // 任意: 申告元 message.declaredClaims[claimIndex] / task サマリへの複合参照（§5.2(b)/D31・監査用。declared は PASS 非算入）

  // ══ interpretation は tool_output(observed) からの派生時のみ。declared_claim は interpretation を持たない（derived 起源は observed 限定・D29）══
  "interpretation": {                          // 省略可。存在時は常に derived（起源は observed の tool_output のみ）
    "outcome": "pass" | "fail" | "unknown",
    "basis": "parsed_output" | "metadata_error",
    "provenance": "derived",
    "derivedFrom": [{ "agentId": "hephaestus", "sessionId": "ses_...", "writerId": "w-...", "sequence": 40, "evidenceId": "ev-0" }]   // 元 observed Evidence の複合参照（{shardId,sequence,evidenceId}・shardId={agentId,sessionId,writerId}・shard 横断一意・D31/D39。同一レコード内 self-ref は writerId/sequence を省略し evidenceId のみ・D42）
  }
}
```

- **provenance 4値の生成経路（Finding 2 対応）**:
  - `observed`: tool.execute.after の生 `rawOutput`/`metadata` を直接観測
  - `derived`: **observed から**導出した解釈（`interpretation` 自身、または observed を集計した派生 Evidence）。**起源は必ず observed**（declared を起源とする派生は `derived` にしない・D29）
  - `declared`: エージェントの自己申告（message 観測由来、**および task PostToolUse 出力サマリ由来**の合否主張。観測裏付けの無い主張・§5.8/D29）
  - `unknown`: 出所不明
- `exit_code` は独立フィールドを持たず `interpretation.outcome` に集約（API に無く derived 確定）。
- **declared は v2.0 でも記録**するが **gate の充足（PASS）判定には算入しない**。既定 gate（`evidence_outcome` / `evidence_present`）が充足と判定できる Evidence は **`observed` / `derived` のみ**で、declared は「自己申告あり・観測裏付け無し」の **WARN 材料**に限定する（declared な "tests pass" だけで required-tests を PASS させない。観測が無ければ `onMissingEvidence` 経路で WARN・FF-008）。**task サマリ由来の合否主張も declared 扱いで PASS 非算入**（transcript 含有でも `derived` 昇格しない・PASS 算入は v2.5 Handoff 相関後・§5.8/D29/D62）。L1+ deny に使えるのも `observed`/`derived` のみ（FF-007）。KPI provenance 分布は4値を集計。
- **sourceClass / kind / toolOutputClass 分類**: evidence-engine が決定論的に判定。**sourceClass**: tool 観測（`tool.execute.after`）由来→`tool_output`、message/task サマリ由来の自己申告→`declared_claim`（D59）。**kind**: test/spec→test, build/compile/tsc→build, lint/eslint→lint, 他のコマンド実行→command/generic。**toolOutputClass**（`tool_output` 時のみ）: bash/test/build/lint 等のコマンド実行系→`command_exec`（rawOutput 保存）。**ただし bash 系は args.command を解析し、ファイル本文出力コマンド（cat/head/tail/sed・awk の印字/grep・rg・ag/xxd/od 等）または判定不能かつ過大出力の場合は `file_content` へ分類**（D60）。read/grep/glob 等のファイル本文・検索系→`file_content`（rawOutputHash＋snippet のみ・本文非保存・D49/D52/D60）。`declared_claim` は toolOutputClass/rawOutput* を持たない。いずれも純粋関数（FF-002）。
- **INV-004 の字義整合（M4）**: 憲章 INV-004「observed/derived しか Evidence にしない」と本設計が `provenance:"declared"` を**記録**することの見かけの差は、**「declared の記録 ≠ 権威 Evidence 扱い」**で解消する。declared は監査可視性のため記録するが、gate 充足（PASS）・L1+ deny の**権威 Evidence には算入しない**（観測のみが PASS を生む・D24/D29/FF-007/FF-008）。憲章 §8.2 も declared を provenance 値として定義しており、本設計は用途を制限しているため整合する。

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
      "evidenceRefs": [{ "agentId": "hephaestus", "sessionId": "ses_...", "writerId": "w-...", "sequence": 40, "evidenceId": "ev-1" }] },   // 根拠 Evidence の複合参照（{shardId,sequence,evidenceId}・shardId={agentId,sessionId,writerId}・shard 横断＋record 内一意・D31/D39）
    { "ruleId": "build-green", "verdict": "WARN", "reason": "...",
      "evidenceRefs": [{ "agentId": "hephaestus", "sessionId": "ses_...", "writerId": "w-...", "sequence": 41, "evidenceId": "ev-2" }] }
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
  "reviewSummary": {            // グローバル集約（後方互換・全 scope 横断表示）
    "authority": "observed_review_output", "critical": [], "major": [], "minor": [], "resolved": [], "open": [],
    "byScope": { /* "<reviewScope>": { "critical":[],"major":[],"minor":[],"resolved":[],"open":[] } — review_open_items gate はこの scope 別 open を参照・D66 */ }
  }
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

> **Artifact メタデータ（憲章 §8.3 準拠）**: Artifact は Evidence の `provenance` ではなく **`authorship`（誰が作成した契約・定義か）/ `authority`（どの権威に基づくか）** を持つ。**v2.0 は各 Artifact に `authority` のみを保持し `authorship` は保持しない（D54）** — 観測集約には「作成者の契約」概念が無く、`gate.yaml` も人間コミットで作成者が自明なため。`authorship` は from→to の作成者契約が必須となる Handoff（v2.5・FR-003）導入時に拡張する。具体値: **Gate Definition（`gate.yaml`）= `authority:"human_approved"`**（人間が承認・コミット）、**Review Summary = `authority:"observed_review_output"`**（観測されたレビュー出力の集約）。Evidence と Artifact の属性系を混同しない。
> なお、v2.0 の `authorship` 非保持は憲章 §8.3 属性体系の**明示的縮退**であり、§0 逸脱リスト（④）・D54・D17（改訂）に逸脱として記録する。**FR-002/FR-005 の deferred（FR 単位の後送り）とは異なり、v2.0 で実体化する Artifact の属性体系縮退であるため D58 と同じ CODEOWNERS 追認に載せる（D63・§13）**（本レビュー指摘3／Finding 2）。
>
> **Review Summary の正本と永続化（D54）**: Review Summary は **projection-derived Artifact** である — 正本は Observation Log の `review_observed` レコード（§5.2(d)）であり、review-aggregator（§7.6）がそれを集約した結果を `state.json` projection（§5.6・再構築可能な非 SoT キャッシュ）に保持し、`justice_review`（§7.5）が on-demand で表示する。**別ファイル（例 `.justice/artifacts/`）へは永続化しない**（event log が常に権威・§9.4）。`gate.yaml`（人間が著作する実ファイル Artifact）との非対称は、この「派生 vs 著作」の違いに由来する。

### 5.8 Task 相関と Evidence 窓（Finding 1 対応）

- 共通エンベロープに任意の `taskId` を追加。observation-handler は **task tool の PreToolUse(callId) で「アクティブ task」を開始**し、同一セッションの後続観測に `taskId` を刻印、task PostToolUse で窓を閉じる。
- **Task Gate は `GateContext.taskId` 一致の Evidence のみ評価**（窓外の無関係 pass を拾わない）。task gate では `taskId` 必須。
- サブエージェント（`task()` の子）の tool 実行は別セッション/シャードに記録され `taskId` 相関が付かない。ただし **task tool 自身の PostToolUse 出力（サブエージェントの結果サマリ）は親セッションの task 窓内で観測される**ため、evidence-engine（純粋）でそこから合否主張を抽出し当該 `taskId` に帰属させる。**この主張は申告由来のため provenance=`declared`（PASS 非算入）**とする（サマリは自己申告であり observed ではない・D29/§7.3）。**transcript が含まれても `declared` 据置とし `derived` 昇格しない**（親セッションは子の実コマンドを `tool.execute.after` で直接観測しておらず、サマリ内 transcript は自己申告経由で偽装・要約漏れ・整形改変に弱いため・D62）。サブエージェント結果の PASS 算入は v2.5 Handoff（FR-003）相関確立後に限定する。
- **Task Gate の保証範囲（明示）**: v2.0 で PASS 充足に使えるのは (1) 親セッション内で直接観測した `observed`/`derived` のみ。(2) task 出力サマリ由来は `declared`（PASS 非算入・transcript 含有でも `derived` 昇格しない・D29/D62）。サブエージェント shard 内で完結した `observed` Evidence との厳密相関は best-effort（マージ可能範囲）で、完全相関は v2.5 Handoff（FR-003）依存。**よって委譲主体のワークフローでは Required Tests が `onMissingEvidence` 経路に入り WARN 優勢になる**（L0 advisory・非ブロッキング・§10.2 KPI と整合）。
- 窓判定・刻印は決定論的（純粋）に保つ（FF-002/004）。
- **agent 解決前の観測と shard 配置（D48・M3）**: `chat.message`（`agent?` は任意）/`chat.params` による `sessionID→agentId` 解決が確立する前に到着した冒頭ツール観測は `unknown`/`system` shard（D38/D56）へ落ち、解決後の観測と別 shard に分かれ得る。projection は全 shard をマージするため replay は無害（FF-004）。`taskId` 窓相関は `sessionId`＋task callId を鍵とし agentId に依存しないため、shard が分かれても窓相関自体は壊れず、帰属 agentId のみ後続解決に従う。

---

## 6. データフロー

### 6.1 観測キャプチャ（全ツール実行ごと）

```text
OpenCode: tool.execute.after 発火（全ツール）
  → opencode-adapter.onToolExecuteAfter（tool!=="task" フィルタ撤廃）
  → JusticePlugin.handleEvent({ type:"PostToolUse" })
  → observation-handler.handlePostToolUse():
       1. evidence-engine: {output, metadata} → Evidence(observed) + interpretation(derived)
       2. SecretPatternDetector で rawOutput **および command／args** を走査・redact＋絶対パス redaction（§9 security・D61）
       3. ObservationRecord 構築
       4. observation-log-store.append(shard={agentId, sessionId, writerId}, record)   ← Runtime I/O
       5. gate トリガ該当なら → 評価フロー（§6.2）
  → HookResponse 返却（proceed / WARN・FAIL なら injectedContext。observation-handler は modifiedPayload を使わず injectedContext＋notifier で射出・D64）
  → mergePostToolUseResponses で plan-bridge / task-feedback と合流（injectedContext は区切り線で連結、output.output 追記は adapter がハンドラ順に連結・D64）
```

### 6.1.1 Message 観測と declared Evidence（FR-004・declared 経路）

```text
OpenCode: event(message.part.updated=TextPart.text) / plugin hook experimental.text.complete 発火（message.updated は role/finish の lifecycle・chat.message=UserMessage は assistant 申告源ではない・D41）
  → opencode-adapter が JusticePlugin.handleEvent({ type:"Message" }) へ送出
  → observation-handler.handleMessage():
       0. role 相関（D53）: messageRoleBuffer（{sessionId,messageID} → { role, parts: Map<partID,{text,finalized}>, finalized }）を更新。message.updated で role/finalized を確定、part（{messageID,partID,text}）受信時は messageID で role を解決し **parts[partID].text を最新値で上書き**（同一 partID の更新を集約・D67）。role 未確定（到着順逆転）なら pending 保留→後続 message.updated で解決、role≠assistant 確定なら破棄（ユーザー入力の declared 誤抽出を防止）
       1. **テキスト確定後のみ抽出（D67）**: `experimental.text.complete`（{messageID,partID}→{text}）または message.updated の finish 確定で part を finalized 化し、**finalized かつ role=assistant の part 本文からのみ**合否主張（"tests pass" 等の自己申告）を抽出して declaredClaims を生成（`message.part.updated` の中間ストリーミング本文では抽出しない）。同一 `(messageID,partID)` からの再生成 claim は既存 declaredClaims を**置換（dedup）**し、否定・修正された陳腐化主張を残さない
       2. ObservationRecord{ kind:"message" } を構築（本文全文は保持せず textHash＋最小 textSnippet のみ・FR-001 非目的・D34）
       3. 合否主張があれば Evidence{ provenance:"declared" } を付与（観測裏付け無し）
       4. SecretPatternDetector で textSnippet / declaredClaims を走査・redact ＋ サイズ truncation（§9.4 security）
       5. observation-log-store.append(shard={agentId, sessionId, writerId}, record)   ← Runtime I/O
  → declared は L0 advisory 入力限定（L1+ deny には不使用・FF-007）
  → messageRoleBuffer（鍵={sessionId, messageID}・D65）は finalized 後 or TTL（既定: セッション終了 / 10 分無更新）or LRU 上限（既定 1000）で GC（メモリ肥大防止・D53/D65）
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
       → formatBanner + チェックリストを advisory surface へ出力（`tool.execute.after` の可変 `output.output` 末尾追記＋notifier・adapter が HookResponse を適用・D47。三者合流時の payload マージ規則は D64）
  → それ以外は proceed
```

Task Gate は FR-005 の確認項目のうち **Required Tests / Evidence / Review** を、**§5.8 の task 窓で `taskId` 刻印された Evidence のみ**に対し task 完了時に評価する（無関係 Evidence を除外）。**Acceptance Criteria は v2.0 では観測・判定の対象外（deferred・§7.2/§10.1/D35）** — AC は plan.md 由来の feature 級受入基準で外部 SoT（INV-008）に属し、組込語彙（§7.2）では表現しないため v2.5+（Feature Gate）で扱う。

### 6.3 projection 再構築（読取時）

```text
トリガ: justice_status tool / 評価が横断状態を要する時
  → observation-log-store.readAll(active + archive の全 segment)   ← Runtime I/O（D40）
  → state-projection.project(events): 純粋 fold
       ① shard 内を sequence 昇順で整列（因果順保持）→ ② shard 間を (timestamp, shardId, sequence) でマージ（shardId={agentId, sessionId, writerId}・D39）→ ProjectedState（決定論的・FF-004）
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

- **サブエージェント横断 Evidence 相関**: `task()` が産むサブエージェントの tool 実行は別 shard（別 sessionId）へ記録される。projection の全シャードマージで best-effort に拾うほか、**補完として task PostToolUse 出力から合否主張を `declared` Evidence として生成**して親 `taskId` に帰属させる（§5.8/D29/D62。PASS 非算入・transcript 含有でも `derived` 昇格しない）。親タスク↔サブエージェントの厳密な紐付けは Handoff 追跡（FR-003, v2.5）に依存。v2.0 の Task Gate は主に同一セッション観測 + マージ可能範囲で評価。

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
| `review_open_items` | **`ctx.reviewScope[]` に一致する** Review Summary の open 項目（指定 severity 以上）が無いか（別 task/別スコープの open を混入させない・§7.3/§7.6/D66） |

新チェック型の追加は「AI 提案 → 人間承認 → gate.yaml + engine にコード追加」。Engine は語彙を決定論的に評価するのみ。

> **Acceptance Criteria の扱い（D35・ISS-001）**: 上記固定語彙は FR-005 の **Required Tests**（`evidence_outcome` / `evidence_present`）と **Review**（`review_open_items`）に対応する。**Acceptance Criteria を表現するチェック型は v2.0 では定義しない（deferred・§10.1）**。AC は plan.md/design.md 由来の feature 級受入条件で外部 SoT（INV-008）に属し、観測・判定には plan.md AC のパースまたは Feature Gate（v2.5+・憲章 §7.2 到達 level）が必要なため、本スライスの Task Gate では扱わない。

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
- **GateContext** は観測の文脈 `{ trigger, taskId, agentId, sessionId, reviewScope[] }` を持つ（**task gate では `taskId` 必須**・§5.8、`reviewScope[]`=当該 task 窓内で観測した `review_observed.reviewScope` 集合・D66）。I/O・時計・乱数は含めない（決定論のため）。
- **`gateType:"task"` かつ `ctx.taskId` 不在時は評価を skip**（DecisionRecord 非生成・PROCEED・D68）。`trigger: tool_observed` が task 窓外（taskId 未刻印）の観測で発火しても task gate は起動せず観測記録のみ行う。v2.0 は gateType=task のみ（§5.4）で global/session gate が無いため、taskId 不在 tool_observed は gate 評価対象外。
- **provenance ゲーティング（L0 充足条件・FF-008）**: `evidence_outcome` / `evidence_present` の**充足（PASS）判定に算入する Evidence は `observed` / `derived` のみ**。**ただし `derived` は起源が observed のものに限る**（task サマリ等 declared を起源とする派生は `declared` 扱いで PASS 非算入・§5.8/D29）。`declared`（自己申告）は充足に算入せず、当該 kind に observed/derived が無ければ `onMissingEvidence`（既定 WARN）として扱い、declared のみ存在する場合は「申告あり・観測なし」を WARN reason に明示する。L0 でも適用（観測のみが PASS を生む）。

### 7.4 組込デフォルト ＋ 上書き precedence ＋ trust モデル

- 組込デフォルト gate を同梱し、`.justice/gate.yaml` 無しでも動作（out-of-box）。
- `.justice/gate.yaml` があれば **同一 id を上書き / 新規追加 / `enabled:false` で無効化**。
- **trust-first**: デフォルトは `onViolation: warn`。信頼を積んでから `fail` へ引上げ。L0 では FAIL も非ブロッキング（強バナー化のみ）。

### 7.5 `justice_*` read-only custom tool（INV-002）

| tool 名 | 責務 | v2.0 |
|---|---|---|
| `justice_status` | projection を読み現在状態を報告 | ✅ |
| `justice_gate` | 現 Evidence に対し gate 評価を実行し verdict 表示（**dry-run・DecisionRecord 非生成**・D50） | ✅ |
| `justice_review` | Review Summary Artifact を表示 | ✅ |
| `justice_verify` | Final Verifier（Release Report） | ⏸ v2.5（FR-007） |

> **「read-only」のスコープ**: ここでの read-only は **workspace / コード / コマンド実行に対する** read-only（INV-002＝「コードを書かない・実行しない」）を指す。projection 読取に伴う `.justice/state.json` への**内部キャッシュ書込は許容**される（state.json は再構築可能な非 SoT キャッシュ・§5.6、書込失敗は fail-open・§9.4）。
> **`justice_gate` の非変更性（D50）**: `justice_gate` は dry-run 表示のみで **DecisionRecord を append しない**。正式な DecisionRecord は hook 起点の gate 評価（trigger=`task_complete`/`tool_observed`・§6.2）のみが生成し、照会は canonical log・replay・KPI を変化させない。

### 7.6 Review Aggregator の入力源と解決規則（Finding 4 対応）

- **入力源**: `review_observed` 観測は、task/レビュー系ツールの PostToolUse 出力を既存 `ReviewRejectionDetector` で処理して生成（tool 出力 → 検出 → `ObservationRecord{ kind:"review_observed", reviewScope, items[] }`）。各 item は `itemKey`（severity ＋ 要約/該当箇所から決定的に導出）を持つ。
- **severity の決定論的導出（D57・I1 対応）**: 現 `ReviewRejectionSignal`={matched,excerpts,summary} に severity が無いため、review-aggregator 拡張が**語彙ベースの決定論的分類器**で severity を新規付与する。凍結 RegExp 語彙（`review-rejection-patterns.ts` と同方式）で critical（例: `security|vulnerability|data ?loss|破壊的|重大`）> major（例: `must fix|required|bug|regression|要修正|不具合`）> minor（例: `nit|suggestion|optional|style|軽微|提案`）を順位評価し、最初に一致した最上位を採る（一致無しは保守的に minor）。AI 動的生成はしない（§11 V3-06）。`itemKey` は `severity` ＋ 正規化要約（小文字化・空白畳み込み・先頭 N 文字）＋ `location` から決定的に合成し、同一論点で itemKey が安定する（D32 解決判定の前提）。分類器・itemKey 合成は純粋関数（FF-002）。
- **解決規則（D32・消失≠解決）**: `itemKey` ごとに集約する。`resolved` への遷移は次のいずれかでのみ成立する — (a) item に**明示的解決マーカー**がある、(b) **同一 `reviewScope` の完全スナップショット**な後続レビューで当該 item が不在、(c) **人間承認 artifact** が解決を示す。**単なる item 消失（レビュー範囲差・検出器の漏れ・出力形式変化）では `resolved` にせず `open` を据え置く**（未解決 major/critical の取りこぼしを防ぐ）。`reviewScope` が一致しない後続レビューは当該スコープ外 item の状態を変更しない。
- **集約のみ（FR-006 準拠）**: Justice はレビューを行わず集約のみ。解決判定は AX-001/002（証拠なき消失を解決と前提しない）に従う。
- `review_open_items` gate は **`GateContext.reviewScope[]`（task 窓内で観測した reviewScope 集合）に一致する `open` 集合のみ**を参照する（`reviewSummary.byScope[scope].open`・§5.6/§7.3/D66）。スコープ不一致の open（別 task/別レビュー範囲）は現 Task Gate の verdict に影響させない。該当スコープに open が無ければ条件成立で PASS（レビュー未観測を FAIL にしない）。

### 7.7 ユーザー露出インターフェース名（Finding 6 対応）

v2.0 は **custom tool 名（`justice_status` 等）で提供**。`/justice-*` slash 体験は `command.execute.before` の `output.parts` 注入面を使う互換エイリアスとして提供できる**可能性はあるが、§3/D45 のとおり同フックは登録・短絡(cancel) API を持たず `output.parts` の反映も未実証のため、v2.0 では実現可能性を未確定（実証待ち）とし、既定は `justice_*` custom tool 名のみとする**（slash 登録 API は無い・§3・D45）。

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
| FF-005 | 新 spine は plan.md に書かない（+ DEBT-001 allowlist） | INV-005 | `tests/arch/no-planmd-write.test.ts`（allowlist は実 `writeFile` 呼出箇所=`task-feedback.ts`/`loop-handler.ts`。`PlanParser` は純粋関数で I/O せず対象外・M2） |
| FF-006 | 全 hook が注入障害下でも有効 HookResponse | INV-006 | fault-injection `tests/hooks/fail-open.test.ts` |
| FF-007 | L1+ deny の Evidence provenance ∈ {observed,derived} | INV-004 | provenance ゲーティングの単体テスト（先行実装・enforcement は v2.5） |
| FF-008 | L0 gate 充足（PASS）に算入する Evidence provenance ∈ {observed,derived}（declared／task サマリ由来は不算入・`derived` は observed 起源限定・WARN 材料） | INV-004 | provenance ゲーティングの単体テスト `tests/core/gate-provenance-gating.test.ts` |

**FF-005 の扱い（D7・M2 精緻化）**: 「新 spine は plan.md に書かない」をアサートする。**実ディスク書込は `this.fileWriter.writeFile()` 呼出箇所**＝`src/hooks/task-feedback.ts`（成功時✅: `updateCheckbox` 適用後の writeFile）と `src/hooks/loop-handler.ts`（error-note: `appendErrorNote` 適用後の writeFile）に限られ、**allowlist はこの writeFile 呼出箇所を対象**とする。`PlanParser.updateCheckbox`/`appendErrorNote` は文字列を返す純粋関数で I/O せず書込元ではない（allowlist 対象は「pure 変換」ではなく「I/O 実行点」）。新規違反はブロックし、v2.5 で allowlist を空にして全域アサートへ移行。

**FF-008 の扱い（D46）**: FF-008 は本 v2.0 スライスが追加する **slice-local fitness check**（既存 INV-004 の検証強化）であり、憲章 §16.1 の凍結 FF 一覧（FF-001〜007）の改訂ではない。新規 INV/ADR/Quality Protocol の変更を伴わないため §16.3 ガバナンス（2 approvals / CODEOWNERS）の対象外（D58 が FF-008 を slice-local fitness として「対象外で据置」と明記。Requirement レベルの訂正を含み CODEOWNERS 追認対象となる §4.5（FR-001 保存パス）/D44（hook リスト）/D5（exit_code）とは区別される）。将来 FF-008 を憲章正本へ昇格させる場合は §16.3 手続きを経る。

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

### 9.3.1 Runtime 統合テスト（I4 対応・最高リスク経路）

Core 純粋テスト（§9.3）では捕捉できない **Runtime/状態ロジック**に明示的な統合テスト target を設ける（モック FileReader/Writer ＋ 制御可能クロック/採番で決定化）:

| 対象 | 検証内容 | 根拠 | Test（target path） |
|---|---|---|---|
| per-shard 直列化キュー | 同一 shard への並行 append が read-modify-write 競合なくイベントを失わず順次採番される | D23/§9.4 | `tests/runtime/observation-log-queue.test.ts` |
| writerId 衝突再採番 | 既存ファイル衝突時に `"w-"+crypto.randomUUID()` を再採番し「1 ファイル=1 writer」を保つ | D55 | `tests/runtime/writer-id-collision.test.ts` |
| rotation 跨ぎ sequence | active+archive 双方の最大 sequence から継続し `{shardId, sequence}` 一意性と replay 決定性を rotation 跨ぎで保つ | D33 | `tests/runtime/rotation-sequence-continuity.test.ts` |
| messageRoleBuffer 相関/GC | part 先行（到着順逆転）→後続 role 解決、role≠assistant 破棄、finalized/TTL で GC | D53/§6.1.1 | `tests/hooks/message-role-buffer.test.ts` |

### 9.4 NFR

| 領域 | v2.0 方針 |
|---|---|
| 並行性 | **shard 鍵=`{agentId, sessionId, writerId}`（per-writer segment）**（physical: `events/<agentId>/<sessionId>/<writerId>.jsonl`・D30/D39）の JSONL シャード・active＋archive 全 segment 読取マージ（D40）。**同一 shard への並行 append は Runtime の per-shard async write queue（直列化キュー）で直列化**し sequence 採番もキュー内で実施（temp+rename は全置換型のため read-modify-write 競合でイベントを失う）。**`writerId` を Runtime が plugin インスタンス起動時に `"w-"+crypto.randomUUID()` で採番（文字種 `[A-Za-z0-9-]`・予約語 `system` と区別・衝突確率は無視可能で万一の既存ファイル衝突時は再採番・D55）し「1 物理ファイル=1 writer」を構造保証**するため、in-process queue の直列化が常に有効で、複数プロセス/セッションが同一ファイルへ並行 append する経路自体が存在しない（「単一ファイル並行 append 禁止」=憲章 NFR を構造的に充足）。これにより「同一 session=単一プロセス」前提に依存せず、read 側は全 writer segment を merge（FF-004 不変） |
| スキーマ versioning | 全 `.justice/` に `schemaVersion`・`WisdomPersistence` 同様の移行戦略 |
| 保持期間 | シャードのサイズ/年齢ベース rotation → `.justice/archive/events/<agentId>/<sessionId>/<writerId>.jsonl`（live shard 名前空間と物理分離・D40。**v2.0 は archive=移送のみ／物理 prune（削除）はしない**）。**憲章 NFR「無限増大を防ぐ」の総量上限は archive 単独では未達のため v2.0 では deferred と明記する（D36・§12 限界-4）**: rotation は active シャードのサイズ/年齢を抑制するが総量（active+archive）は単調増加し、物理削減は下記 prune 解禁後（v2.5+）。replay は active＋archive を読むため再構築可能性を損なわない。**rotation 後の sequence 採番は active のみでなく当該 shard（writer segment）の active+archive 双方の最大 sequence から継続**し（D33）、`{shardId, sequence}` の一意性と replay 決定性（FF-004）を rotation 跨ぎで保証。旧 event の物理 prune は、replay 起点となる **canonical snapshot/checkpoint イベントを定義した後に解禁**（v2.5+）。これにより同表「projection 永続化」行の「event log が常に権威・state.json を信用しない」と矛盾しない |
| セキュリティ | **永続化前 redaction（必須）**: `.justice/events` への append 前に (0) Evidence `command` および保持する args 由来メタデータ（**secrets / 絶対パス / token 付き URL / 環境変数値が混入しやすい**・D61）、(1) Evidence `rawOutput`（stdout/stderr 統合・**kind 別保存ポリシー D49＋bash args.command 解析 D60**: `test`/`build`/`lint`/`command` 系は redact+truncation して保存、`read`/検索/**bash 経由のファイル本文出力コマンド（cat/sed/awk/head/tail/rg 等）/判定不能かつ過大出力**は rawOutput 全文を保存せず `rawOutputHash`＋最小 snippet＋分類のみ＝plan/design/code 本文の複製を遮断・FR-001 非目的）、(2) `message` の `textSnippet`・`declaredClaims`（**本文全文は永続化しない**・FR-001 非目的・D34）、(3) `session_error.message` を**すべて `SecretPatternDetector` で走査・redact＋絶対パス redaction**（チャット本文・エラー文・コマンドは secrets / 絶対パス / ユーザー入力が混入しやすい）。併せて各テキストに**サイズ上限を設け truncation**（肥大化・ログ汚染防止）。gate.yaml injection 検証。projection は常に再構築可能（state.json を信用しない＝改ざん耐性） |
| 性能 | tool.execute.after レイテンシ予算（§3）・実装初手で実測 |
| 信頼性 | 不変条件 (A) infra-error→fail-open を回帰テストで固定（FF-006）。L1+ 拡大は trust 蓄積後 |
| projection 永続化 | state.json は FileWriter で atomic 書込（temp+rename）・fail-open（失敗→log＋キャッシュ skip）。**event log が常に権威**（state.json 欠損/破損/schema 不一致→log から再構築。state.json を log に優先しない） |

---

## 10. スコープ・KPI・実装順序・DoD

### 10.1 v2.0 スコープ（in / deferred）

| in-scope（Phase 0 + v2.0） | deferred（v2.5+） |
|---|---|
| FR-001 Observation Log + projection | FR-003 Handoff Artifact |
| FR-002 Skill Awareness（v2.0 は skill 観測のみ・SkillInvoked） | FR-007 Final Verifier / `justice_verify`・OmO agents awareness は FR-003 Handoff（v2.5）へ（D37） |
| FR-004 Evidence Engine（observed/derived） | L1 permission deny |
| FR-005 L0 Task Gate / Rule Engine（Required Tests/Evidence/Review・WARN 既定） | DEBT-001 完全カットオーバー |
| FR-006 Review Aggregator | サブエージェント Evidence 相関 |
| 観測拡張（全ツール）・`justice_status/gate/review` | 豊富な event タップ（file.edited 等） |
| FF-001〜004,006〜008 + FF-005(新 spine 限定) | Phase/Feature Gate, L2 CI/PR, Acceptance Criteria 観測・判定(FR-005・D35) |

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
- **Runtime 統合テスト（I4・§9.3.1）green**: per-shard 直列化キュー（D23）・writerId 衝突再採番（D55）・rotation 跨ぎ sequence 継続/一意性（D33）・messageRoleBuffer 相関/role 破棄/GC（D53）の4点を統合テストで固定。
- **C1 前提充足**: Phase 0 で L0 advisory 表示面を実証し（`output.output` 反映可否を確定）、D47 を best-effort（output.output）＋保証チャネル（notifier）で確定済み。未実証のまま L0 出荷価値を断定しない。

---

## 11. Invariant トレーサビリティ

| INV | 本設計での担保 |
|---|---|
| INV-001（設計を生成しない） | Justice は plan/design を著作しない。観測と判定のみ |
| INV-002（コードを書かない・実行しない） | `justice_*` は read-only custom tool（§7.5/D13/D22）。Core は OpenCode 非依存（FF-001） |
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
| 限界-4 | 憲章 NFR「無限増大を防ぐ」を v2.0 で完全充足しない（archive 移送のみ・物理削除なし） | rotation で active を抑制しつつ総量上限は未達。canonical snapshot/checkpoint 定義後（v2.5+）に物理 prune を解禁し充足（D36・§9.4 保持期間） |

---

## 13. 次工程

本設計を `superpowers/writing-plans` で実装計画へ展開する（§10.3 の実装順序を分解し、各ステップに検証チェックポイントを付与）。

> **writing-plans 着手前の必須前提（本レビュー対応）**:
> 1. **C1**: §3 Phase 0 スパイクに追加した「L0 advisory 表示面の実証」を完了し、`output.output` 反映可否を確定する（反映不可なら notifier を保証チャネルとして D47 を確定）。
> 2. **I3/D58/D63**: Phase 0 由来の憲章訂正（hook リスト=D44・FR-001 保存パス=§4.5・FR-004 exit_code=D5/限界-2）**＋ Artifact authorship 非保持（§8.3 属性縮退・D54/D63）**を D58 のとおり 1 本の ADR にまとめ CODEOWNERS 追認へ回す（設計側の「§16.3 対象外」自己認定を撤回）。
> 3. **I1/D57**: severity 決定論的分類器（§7.6）と itemKey 安定性テストを計画に含める。
> 4. **I4**: §9.3.1 の Runtime 統合テスト4点を実装順序（§10.3）と DoD に組み込む。
> 5. **本レビュー Finding 1〜5／追加4 反映（D60〜D65）**: bash 経由ファイル本文の `file_content` 分類（D60）・Evidence command/args の redaction（D61）・task サマリ transcript の `declared` 据置（D62）・authorship 縮退の CODEOWNERS 追認（D63）・PostToolUse payload マージ規則（D64）・messageRoleBuffer 鍵/TTL 確定（D65）を本設計に反映済み。実装計画では D60 分類器の語彙テスト・D61 redaction テスト・D64 マージ規則テストを §9.3/§9.3.1 と DoD に組み込む。
> 6. **本レビュー（追補 R）Finding 1〜4 反映（D66〜D69）**: `review_open_items` の scope-aware 化（D66・§5.6/§7.2/§7.3/§7.6）・declared 抽出のテキスト確定/partID 上書き/dedup（D67・§6.1.1）・`tool_observed` × taskId 不在時 skip（D68・§6.2/§7.3）・`sessionId` 等パスセグメントの safe-segment エンコード（D69・§4.5/§5.1/§9.4）を本設計に反映済み。実装計画では D66 scope 投影テスト・D67 ストリーミング確定/dedup テスト・D68 taskId 不在 skip テスト・D69 sanitize/衝突回避テストを §9.3/§9.3.1 と DoD に組み込む。
