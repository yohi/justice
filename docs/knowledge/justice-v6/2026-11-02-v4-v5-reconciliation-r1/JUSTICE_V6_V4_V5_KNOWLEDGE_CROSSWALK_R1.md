# D2 — Justice v6 v4/v5 Knowledge Crosswalk R1

> **Authority:** `READ_ONLY / DOCUMENT_ONLY / ANALYST_CANDIDATE / NOT_OWNER_ADOPTED`. 2026-11-02 JST。v4 STOP、Gate/HOLD、v6要件・方式選定・実装許可を一切変更しない。資料の歴史的Owner採択と、本R1の未採択分析は別。

## 読み方
- v4原本: [V4-R01](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.1/JUSTICE_V4_KNOWLEDGE_EVIDENCE_R0_1_20261101.md), [V4-R03](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.3/JUSTICE_V4_R0_3_SOURCE_INVENTORY.md); v5既存K-ID: [V5-ARCH](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_ARCHITECTURE_AND_V6_MAPPING_R0_2_20261101.md) §2。固定BlobとサイズはD3を参照。
- `対応なし`は今回の固定入力で直接対応が確証されないという意味。未採択 `JV4-K-016–018` と `024–026` はマッピングしない。
- 多対多は意味類似の候補対応であり、同一仕様/同一証明/昇格を意味しない。

## 全件索引

| ID | Claim | v4 IDs | v5 IDs | Classification | Proof |
|---|---|---|---|---|---|
| `JV6-KR-R1-001` | 方法論と実行の非侵襲的分離 | JV4-K-001, JV4-K-014 | JV5-K-001 | `CARRY_FORWARD_PRINCIPLE_CANDIDATE` | `PO-01` |
| `JV6-KR-R1-002` | 原文rawBodyとCaller Intentの損失防止 | JV4-K-002 | JV5-K-002 | `CARRY_FORWARD_PRINCIPLE_CANDIDATE` | `PO-02` |
| `JV6-KR-R1-003` | モデル・Provider選択の所有権 | JV4-K-003, JV4-K-020 | JV5-K-011 | `ADAPT_IMPLEMENTATION_CANDIDATE` | `PO-03` |
| `JV6-KR-R1-004` | Executorの実観測とTool API区別 | JV4-K-004, JV4-K-019 | JV5-K-004, JV5-K-005 | `PROOF_REQUIRED` | `PO-04` |
| `JV6-KR-R1-005` | 承認済Artifact ChainとHuman境界 | JV4-K-005, JV4-K-010 | JV5-K-003 | `CARRY_FORWARD_PRINCIPLE_CANDIDATE` | `PO-05` |
| `JV6-KR-R1-006` | Evidence-based AcceptanceとWorker自己申告 | JV4-K-007 | JV5-K-007 | `CARRY_FORWARD_PRINCIPLE_CANDIDATE` | `PO-06` |
| `JV6-KR-R1-007` | 通常実行継続と保護操作の拒否を分離 | JV4-K-006 | JV5-K-008 | `ADAPT_IMPLEMENTATION_CANDIDATE` | `PO-07` |
| `JV6-KR-R1-008` | Pre-implementation GateとImplementation SDD分離 | JV4-K-005, JV4-K-014 | JV5-K-001, JV5-K-006, JV5-K-010 | `CARRY_FORWARD_PRINCIPLE_CANDIDATE` | `PO-08` |
| `JV6-KR-R1-009` | Review worker dispatchの所有者衝突 | JV4-K-014, JV4-K-021 | JV5-K-001, JV5-K-006 | `CONFLICT_REQUIRES_DECISION` | `PO-09` |
| `JV6-KR-R1-010` | Loop/Pivot/RetryのAdvisoryとExecutive差 | JV4-K-014, JV4-K-021 | JV5-K-001, JV5-K-006, JV5-K-012 | `CONFLICT_REQUIRES_DECISION` | `PO-10` |
| `JV6-KR-R1-011` | V2 Event Storeと完全Semantic Replay | JV4-K-008, JV4-K-009 | JV5-K-009, JV5-K-010 | `PROOF_REQUIRED` | `PO-11` |
| `JV6-KR-R1-012` | Deterministic ProjectionとCAS/Witnessの手段分離 | JV4-K-008, JV4-K-011 | JV5-K-010 | `DO_NOT_PORT_AS_IS_CANDIDATE` | `PO-12` |
| `JV6-KR-R1-013` | Approved D0とdirty D1のArtifact authority | JV4-K-010 | JV5-K-003, JV5-K-010 | `PROOF_REQUIRED` | `PO-13` |
| `JV6-KR-R1-014` | Finding Field Propagationの未知キー | JV4-K-013 | 対応なし | `CARRY_FORWARD_PRINCIPLE_CANDIDATE` | `PO-14` |
| `JV6-KR-R1-015` | TaskFeedbackの親子ToolCall相関 | JV4-K-019 | JV5-K-004 | `PROOF_REQUIRED` | `PO-15` |
| `JV6-KR-R1-016` | AgentRouterは実行エンジンではない | JV4-K-020 | JV5-K-011 | `DO_NOT_PORT_AS_IS_CANDIDATE` | `PO-16` |
| `JV6-KR-R1-017` | WisdomとTiered Storesの費用対価値 | JV4-K-022 | JV5-K-012 | `OPTIONAL_VALUE_UNPROVEN` | `PO-17` |
| `JV6-KR-R1-018` | Telemetryの価値と保持ポリシー | JV4-K-022 | JV5-K-012 | `OPTIONAL_VALUE_UNPROVEN` | `PO-18` |
| `JV6-KR-R1-019` | Compaction context continuityとHost機構 | JV4-K-023 | JV5-K-009 | `ADAPT_IMPLEMENTATION_CANDIDATE` | `PO-19` |
| `JV6-KR-R1-020` | Native-firstはv6既定ではない | JV4-K-015 | JV5-K-011 | `PROOF_REQUIRED` | `PO-20` |
| `JV6-KR-R1-021` | Case A provider stream error後の安全性 | 対応なし | JV5-K-005 | `PROOF_REQUIRED` | `PO-21` |
| `JV6-KR-R1-022` | Unknown-tool synthetic result厳密ID結合 | JV4-K-004, JV4-K-019 | JV5-K-004, JV5-K-005 | `PROOF_REQUIRED` | `PO-22` |
| `JV6-KR-R1-023` | Positive sanitizer removal証明 | JV4-K-013 | JV5-K-005 | `PROOF_REQUIRED` | `PO-23` |
| `JV6-KR-R1-024` | 全56シナリオのE2E Closure | JV4-K-012 | JV5-K-007, JV5-K-011 | `PROOF_REQUIRED` | `PO-24` |
| `JV6-KR-R1-025` | Stale Authorizationとreopen | JV4-K-005, JV4-K-010 | JV5-K-003, JV5-K-010 | `CONFLICT_REQUIRES_DECISION` | `PO-25` |
| `JV6-KR-R1-026` | Recoveryとidempotent external side effects | JV4-K-008, JV4-K-009, JV4-K-023 | JV5-K-009, JV5-K-010 | `ADAPT_IMPLEMENTATION_CANDIDATE` | `PO-26` |
| `JV6-KR-R1-027` | 認証済Protocol Affiliationの信頼境界 | JV4-K-004, JV4-K-007 | JV5-K-005 | `PROOF_REQUIRED` | `PO-27` |
| `JV6-KR-R1-028` | Requirements/Design/Planの静的ID連鎖 | JV4-K-005 | JV5-K-003, JV5-K-007 | `CARRY_FORWARD_PRINCIPLE_CANDIDATE` | `PO-28` |
| `JV6-KR-R1-029` | Evidence・Gate・Owner・Implementationの権限分離 | JV4-K-005, JV4-K-007, JV4-K-012 | JV5-K-003, JV5-K-007, JV5-K-010 | `CARRY_FORWARD_PRINCIPLE_CANDIDATE` | `PO-29` |
| `JV6-KR-R1-030` | Adaptive routingとFallback/Retryの過剰所有 | JV4-K-003, JV4-K-020, JV4-K-021 | JV5-K-011, JV5-K-012 | `OPTIONAL_VALUE_UNPROVEN` | `PO-30` |
| `JV6-KR-R1-031` | Option CでOmO相当Runtimeを内包 | JV4-K-001, JV4-K-020 | JV5-K-001, JV5-K-011 | `CONFLICT_REQUIRES_DECISION` | `PO-31` |
| `JV6-KR-R1-032` | Review Worker/semantic role identityの厳密性 | JV4-K-004, JV4-K-007 | JV5-K-004, JV5-K-006 | `ADAPT_IMPLEMENTATION_CANDIDATE` | `PO-32` |

## 個票：証拠・反証・権限（全32件）

### JV6-KR-R1-001 — 方法論と実行の非侵襲的分離

- **v4 Knowledge IDs:** JV4-K-001, JV4-K-014; **v5 Knowledge IDs:** JV5-K-001
- **Claim:** 方法論と実行の非侵襲的分離
- **v4 Evidence:** V4-R01 §JV4-K-001/014; V4-SPEC §§1–2。固定v4原本: [V4-R01](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.1/JUSTICE_V4_KNOWLEDGE_EVIDENCE_R0_1_20261101.md); [V4-R03](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.3/JUSTICE_V4_R0_3_SOURCE_INVENTORY.md); 仕様: [V4-SPEC](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/SPEC.md)
- **v5 Evidence:** V5-PURPOSE §§1,5; V5-ARCH §2。固定採択v5: [V5-ARCH](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_ARCHITECTURE_AND_V6_MAPPING_R0_2_20261101.md); [V5-LEDGER](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_RESEARCH_EVIDENCE_LEDGER_R0_2_20261101.md)
- **Agreement / Conflict:** 原則一致・実装重複未検証
- **Evidence Strength:** `DOCUMENT_OBSERVED + STATIC_INFERENCE`; **Classification:** `CARRY_FORWARD_PRINCIPLE_CANDIDATE`
- **Counterevidence / Limitations:** v4 Loop/Pivotが進行へ介入し得る
- **v6 Implication (unadopted):** 責務表と非二重Dispatchの入力
- **Proof Obligation:** `PO-01` — 方法論と実行の非侵襲的分離について本R1で新規Host証明なし
- **Authority:** `ANALYST_CANDIDATE / NOT_OWNER_ADOPTED`

### JV6-KR-R1-002 — 原文rawBodyとCaller Intentの損失防止

- **v4 Knowledge IDs:** JV4-K-002; **v5 Knowledge IDs:** JV5-K-002
- **Claim:** 原文rawBodyとCaller Intentの損失防止
- **v4 Evidence:** V4-SPEC §4.1d; V4-R01 K-002。固定v4原本: [V4-R01](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.1/JUSTICE_V4_KNOWLEDGE_EVIDENCE_R0_1_20261101.md); [V4-R03](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.3/JUSTICE_V4_R0_3_SOURCE_INVENTORY.md); 仕様: [V4-SPEC](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/SPEC.md)
- **v5 Evidence:** V5-PURPOSE V5-G-02; V5-ARCH K-002。固定採択v5: [V5-ARCH](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_ARCHITECTURE_AND_V6_MAPPING_R0_2_20261101.md); [V5-LEDGER](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_RESEARCH_EVIDENCE_LEDGER_R0_2_20261101.md)
- **Agreement / Conflict:** 原則一致・Host transport相違
- **Evidence Strength:** `IMPLEMENTATION_REPORTED; HOST_NOT_VERIFIED`; **Classification:** `CARRY_FORWARD_PRINCIPLE_CANDIDATE`
- **Counterevidence / Limitations:** checkbox化・prompt再生成で意味変質
- **v6 Implication (unadopted):** semantic input identity / lossless transport候補
- **Proof Obligation:** `PO-02` — 原文rawBodyとCaller Intentの損失防止について本R1で新規Host証明なし
- **Authority:** `ANALYST_CANDIDATE / NOT_OWNER_ADOPTED`

### JV6-KR-R1-003 — モデル・Provider選択の所有権

- **v4 Knowledge IDs:** JV4-K-003, JV4-K-020; **v5 Knowledge IDs:** JV5-K-011
- **Claim:** モデル・Provider選択の所有権
- **v4 Evidence:** V4-R01 K-003; V4-R03 K-020。固定v4原本: [V4-R01](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.1/JUSTICE_V4_KNOWLEDGE_EVIDENCE_R0_1_20261101.md); [V4-R03](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.3/JUSTICE_V4_R0_3_SOURCE_INVENTORY.md); 仕様: [V4-SPEC](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/SPEC.md)
- **v5 Evidence:** V5-PURPOSE §5; V5-ARCH K-011。固定採択v5: [V5-ARCH](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_ARCHITECTURE_AND_V6_MAPPING_R0_2_20261101.md); [V5-LEDGER](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_RESEARCH_EVIDENCE_LEDGER_R0_2_20261101.md)
- **Agreement / Conflict:** 主旨一致・具体カテゴリ非可搬
- **Evidence Strength:** `CODE_OBSERVED; HOST_NOT_VERIFIED`; **Classification:** `ADAPT_IMPLEMENTATION_CANDIDATE`
- **Counterevidence / Limitations:** OmOカテゴリ・V1 general例外がHost依存
- **v6 Implication (unadopted):** route policyはowner同意を伴うこと
- **Proof Obligation:** `PO-03` — モデル・Provider選択の所有権について本R1で新規Host証明なし
- **Authority:** `ANALYST_CANDIDATE / NOT_OWNER_ADOPTED`

### JV6-KR-R1-004 — Executorの実観測とTool API区別

- **v4 Knowledge IDs:** JV4-K-004, JV4-K-019; **v5 Knowledge IDs:** JV5-K-004, JV5-K-005
- **Claim:** Executorの実観測とTool API区別
- **v4 Evidence:** V4-R01 K-004; V4-R03 K-019。固定v4原本: [V4-R01](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.1/JUSTICE_V4_KNOWLEDGE_EVIDENCE_R0_1_20261101.md); [V4-R03](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.3/JUSTICE_V4_R0_3_SOURCE_INVENTORY.md); 仕様: [V4-SPEC](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/SPEC.md)
- **v5 Evidence:** V5-ARCH K-004/005; V5-LEDGER §7.1。固定採択v5: [V5-ARCH](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_ARCHITECTURE_AND_V6_MAPPING_R0_2_20261101.md); [V5-LEDGER](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_RESEARCH_EVIDENCE_LEDGER_R0_2_20261101.md)
- **Agreement / Conflict:** 一致・実Host実証は不足
- **Evidence Strength:** `REAL_HOST_FAILURE_REPORTED; HOST_NOT_VERIFIED`; **Classification:** `PROOF_REQUIRED`
- **Counterevidence / Limitations:** native subtask≠OmO task; Case A/B
- **v6 Implication (unadopted):** Hostが実際に選んだexecutor証拠
- **Proof Obligation:** `PO-04` — Executorの実観測とTool API区別について本R1で新規Host証明なし
- **Authority:** `ANALYST_CANDIDATE / NOT_OWNER_ADOPTED`

### JV6-KR-R1-005 — 承認済Artifact ChainとHuman境界

- **v4 Knowledge IDs:** JV4-K-005, JV4-K-010; **v5 Knowledge IDs:** JV5-K-003
- **Claim:** 承認済Artifact ChainとHuman境界
- **v4 Evidence:** V4-R01 K-005/010; V4-SPEC §4.1c。固定v4原本: [V4-R01](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.1/JUSTICE_V4_KNOWLEDGE_EVIDENCE_R0_1_20261101.md); [V4-R03](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.3/JUSTICE_V4_R0_3_SOURCE_INVENTORY.md); 仕様: [V4-SPEC](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/SPEC.md)
- **v5 Evidence:** V5-PURPOSE V5-G-03; V5-ARCH K-003。固定採択v5: [V5-ARCH](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_ARCHITECTURE_AND_V6_MAPPING_R0_2_20261101.md); [V5-LEDGER](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_RESEARCH_EVIDENCE_LEDGER_R0_2_20261101.md)
- **Agreement / Conflict:** 原則一致・旧Gate/新Gateは同一でない
- **Evidence Strength:** `DOCUMENT_OBSERVED; HOST_NOT_VERIFIED`; **Classification:** `CARRY_FORWARD_PRINCIPLE_CANDIDATE`
- **Counterevidence / Limitations:** Gate CLEAR≠Human承認; D1 drift
- **v6 Implication (unadopted):** digest/revision/OwnerEvent独立識別
- **Proof Obligation:** `PO-05` — 承認済Artifact ChainとHuman境界について本R1で新規Host証明なし
- **Authority:** `ANALYST_CANDIDATE / NOT_OWNER_ADOPTED`

### JV6-KR-R1-006 — Evidence-based AcceptanceとWorker自己申告

- **v4 Knowledge IDs:** JV4-K-007; **v5 Knowledge IDs:** JV5-K-007
- **Claim:** Evidence-based AcceptanceとWorker自己申告
- **v4 Evidence:** V4-R01 K-007。固定v4原本: [V4-R01](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.1/JUSTICE_V4_KNOWLEDGE_EVIDENCE_R0_1_20261101.md); [V4-R03](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.3/JUSTICE_V4_R0_3_SOURCE_INVENTORY.md); 仕様: [V4-SPEC](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/SPEC.md)
- **v5 Evidence:** V5-PURPOSE V5-G-09; V5-ARCH K-007。固定採択v5: [V5-ARCH](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_ARCHITECTURE_AND_V6_MAPPING_R0_2_20261101.md); [V5-LEDGER](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_RESEARCH_EVIDENCE_LEDGER_R0_2_20261101.md)
- **Agreement / Conflict:** 一致・証拠取得は未閉鎖
- **Evidence Strength:** `IMPLEMENTATION_REPORTED; NOT_VERIFIED`; **Classification:** `CARRY_FORWARD_PRINCIPLE_CANDIDATE`
- **Counterevidence / Limitations:** self-reportと実行/受理混同
- **v6 Implication (unadopted):** Task結合とFinding closureの受理規則
- **Proof Obligation:** `PO-06` — Evidence-based AcceptanceとWorker自己申告について本R1で新規Host証明なし
- **Authority:** `ANALYST_CANDIDATE / NOT_OWNER_ADOPTED`

### JV6-KR-R1-007 — 通常実行継続と保護操作の拒否を分離

- **v4 Knowledge IDs:** JV4-K-006; **v5 Knowledge IDs:** JV5-K-008
- **Claim:** 通常実行継続と保護操作の拒否を分離
- **v4 Evidence:** V4-R01 K-006; PR-343。固定v4原本: [V4-R01](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.1/JUSTICE_V4_KNOWLEDGE_EVIDENCE_R0_1_20261101.md); [V4-R03](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.3/JUSTICE_V4_R0_3_SOURCE_INVENTORY.md); 仕様: [V4-SPEC](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/SPEC.md)
- **v5 Evidence:** V5-ARCH K-008。固定採択v5: [V5-ARCH](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_ARCHITECTURE_AND_V6_MAPPING_R0_2_20261101.md); [V5-LEDGER](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_RESEARCH_EVIDENCE_LEDGER_R0_2_20261101.md)
- **Agreement / Conflict:** 原則一致・operation fence再設計
- **Evidence Strength:** `STATIC_RISK; HOST_NOT_VERIFIED`; **Classification:** `ADAPT_IMPLEMENTATION_CANDIDATE`
- **Counterevidence / Limitations:** command初期化失敗でexpanded parts残存候補
- **v6 Implication (unadopted):** 操作別fail-open/fail-closed契約
- **Proof Obligation:** `PO-07` — 通常実行継続と保護操作の拒否を分離について本R1で新規Host証明なし
- **Authority:** `ANALYST_CANDIDATE / NOT_OWNER_ADOPTED`

### JV6-KR-R1-008 — Pre-implementation GateとImplementation SDD分離

- **v4 Knowledge IDs:** JV4-K-005, JV4-K-014; **v5 Knowledge IDs:** JV5-K-001, JV5-K-006, JV5-K-010
- **Claim:** Pre-implementation GateとImplementation SDD分離
- **v4 Evidence:** V4-R01 K-014; V4-SPEC §4.1c。固定v4原本: [V4-R01](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.1/JUSTICE_V4_KNOWLEDGE_EVIDENCE_R0_1_20261101.md); [V4-R03](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.3/JUSTICE_V4_R0_3_SOURCE_INVENTORY.md); 仕様: [V4-SPEC](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/SPEC.md)
- **v5 Evidence:** V5-ARCH §§3,8.2; ISSUE-297/298。固定採択v5: [V5-ARCH](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_ARCHITECTURE_AND_V6_MAPPING_R0_2_20261101.md); [V5-LEDGER](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_RESEARCH_EVIDENCE_LEDGER_R0_2_20261101.md)
- **Agreement / Conflict:** 原則一致・Gate実装権限は未決
- **Evidence Strength:** `HISTORICAL_CONTRACT + STATIC_INFERENCE`; **Classification:** `CARRY_FORWARD_PRINCIPLE_CANDIDATE`
- **Counterevidence / Limitations:** Justice側のreview dispatchとSuperpowersが衝突し得る
- **v6 Implication (unadopted):** 2本の独立lifecycleと二重起動防止
- **Proof Obligation:** `PO-08` — Pre-implementation GateとImplementation SDD分離について本R1で新規Host証明なし
- **Authority:** `ANALYST_CANDIDATE / NOT_OWNER_ADOPTED`

### JV6-KR-R1-009 — Review worker dispatchの所有者衝突

- **v4 Knowledge IDs:** JV4-K-014, JV4-K-021; **v5 Knowledge IDs:** JV5-K-001, JV5-K-006
- **Claim:** Review worker dispatchの所有者衝突
- **v4 Evidence:** V4-R03 K-021; V4-R01 K-014。固定v4原本: [V4-R01](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.1/JUSTICE_V4_KNOWLEDGE_EVIDENCE_R0_1_20261101.md); [V4-R03](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.3/JUSTICE_V4_R0_3_SOURCE_INVENTORY.md); 仕様: [V4-SPEC](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/SPEC.md)
- **v5 Evidence:** V5-ARCH K-006; V5-PURPOSE §5。固定採択v5: [V5-ARCH](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_ARCHITECTURE_AND_V6_MAPPING_R0_2_20261101.md); [V5-LEDGER](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_RESEARCH_EVIDENCE_LEDGER_R0_2_20261101.md)
- **Agreement / Conflict:** v4の制御候補 vs v5の非所有方針
- **Evidence Strength:** `CODE_OBSERVED + DESIGN_CONFLICT`; **Classification:** `CONFLICT_REQUIRES_DECISION`
- **Counterevidence / Limitations:** 二重review、fix、再reviewスケジューリング
- **v6 Implication (unadopted):** pre-Gateのみの管理境界検討
- **Proof Obligation:** `PO-09` — Review worker dispatchの所有者衝突について本R1で新規Host証明なし
- **Authority:** `ANALYST_CANDIDATE / NOT_OWNER_ADOPTED`

### JV6-KR-R1-010 — Loop/Pivot/RetryのAdvisoryとExecutive差

- **v4 Knowledge IDs:** JV4-K-014, JV4-K-021; **v5 Knowledge IDs:** JV5-K-001, JV5-K-006, JV5-K-012
- **Claim:** Loop/Pivot/RetryのAdvisoryとExecutive差
- **v4 Evidence:** V4-R03 K-021; V4-R02 R1-F-05。固定v4原本: [V4-R01](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.1/JUSTICE_V4_KNOWLEDGE_EVIDENCE_R0_1_20261101.md); [V4-R03](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.3/JUSTICE_V4_R0_3_SOURCE_INVENTORY.md); 仕様: [V4-SPEC](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/SPEC.md)
- **v5 Evidence:** V5-PURPOSE §5; V5-ARCH K-012。固定採択v5: [V5-ARCH](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_ARCHITECTURE_AND_V6_MAPPING_R0_2_20261101.md); [V5-LEDGER](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_RESEARCH_EVIDENCE_LEDGER_R0_2_20261101.md)
- **Agreement / Conflict:** 方向相違・ownership未決
- **Evidence Strength:** `STATIC_INFERENCE; OWNER_OPEN_FINDING`; **Classification:** `CONFLICT_REQUIRES_DECISION`
- **Counterevidence / Limitations:** v4 R1-F-05未解消
- **v6 Implication (unadopted):** 禁止する実行権限と観測だけの境界
- **Proof Obligation:** `PO-10` — Loop/Pivot/RetryのAdvisoryとExecutive差について本R1で新規Host証明なし
- **Authority:** `ANALYST_CANDIDATE / NOT_OWNER_ADOPTED`

### JV6-KR-R1-011 — V2 Event Storeと完全Semantic Replay

- **v4 Knowledge IDs:** JV4-K-008, JV4-K-009; **v5 Knowledge IDs:** JV5-K-009, JV5-K-010
- **Claim:** V2 Event Storeと完全Semantic Replay
- **v4 Evidence:** V4-R01 K-008/009; V4-R02 RG310-05。固定v4原本: [V4-R01](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.1/JUSTICE_V4_KNOWLEDGE_EVIDENCE_R0_1_20261101.md); [V4-R03](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.3/JUSTICE_V4_R0_3_SOURCE_INVENTORY.md); 仕様: [V4-SPEC](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/SPEC.md)
- **v5 Evidence:** V5-ARCH K-009/010; ISSUE-298。固定採択v5: [V5-ARCH](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_ARCHITECTURE_AND_V6_MAPPING_R0_2_20261101.md); [V5-LEDGER](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_RESEARCH_EVIDENCE_LEDGER_R0_2_20261101.md)
- **Agreement / Conflict:** 要求は共通・方式成立未証明
- **Evidence Strength:** `STATIC_GAP_IDENTIFIED; NOT_VERIFIED`; **Classification:** `PROOF_REQUIRED`
- **Counterevidence / Limitations:** RemediationRound[]/FindingState欠落、IDのみ復元
- **v6 Implication (unadopted):** lossless projection and re-entry
- **Proof Obligation:** `PO-11` — V2 Event Storeと完全Semantic Replayについて本R1で新規Host証明なし
- **Authority:** `ANALYST_CANDIDATE / NOT_OWNER_ADOPTED`

### JV6-KR-R1-012 — Deterministic ProjectionとCAS/Witnessの手段分離

- **v4 Knowledge IDs:** JV4-K-008, JV4-K-011; **v5 Knowledge IDs:** JV5-K-010
- **Claim:** Deterministic ProjectionとCAS/Witnessの手段分離
- **v4 Evidence:** V4-R01 K-008/011; PR-341。固定v4原本: [V4-R01](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.1/JUSTICE_V4_KNOWLEDGE_EVIDENCE_R0_1_20261101.md); [V4-R03](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.3/JUSTICE_V4_R0_3_SOURCE_INVENTORY.md); 仕様: [V4-SPEC](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/SPEC.md)
- **v5 Evidence:** V5-ARCH K-010; ISSUE-298。固定採択v5: [V5-ARCH](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_ARCHITECTURE_AND_V6_MAPPING_R0_2_20261101.md); [V5-LEDGER](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_RESEARCH_EVIDENCE_LEDGER_R0_2_20261101.md)
- **Agreement / Conflict:** 保証は近い・方式の必然性なし
- **Evidence Strength:** `PARTIAL_IMPLEMENTATION_REPORTED`; **Classification:** `DO_NOT_PORT_AS_IS_CANDIDATE`
- **Counterevidence / Limitations:** PR-341テスト≠G3、V2 replay欠落
- **v6 Implication (unadopted):** 比較可能な軽量代替の安全証明
- **Proof Obligation:** `PO-12` — Deterministic ProjectionとCAS/Witnessの手段分離について本R1で新規Host証明なし
- **Authority:** `ANALYST_CANDIDATE / NOT_OWNER_ADOPTED`

### JV6-KR-R1-013 — Approved D0とdirty D1のArtifact authority

- **v4 Knowledge IDs:** JV4-K-010; **v5 Knowledge IDs:** JV5-K-003, JV5-K-010
- **Claim:** Approved D0とdirty D1のArtifact authority
- **v4 Evidence:** V4-R01 K-010; PR-341/343。固定v4原本: [V4-R01](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.1/JUSTICE_V4_KNOWLEDGE_EVIDENCE_R0_1_20261101.md); [V4-R03](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.3/JUSTICE_V4_R0_3_SOURCE_INVENTORY.md); 仕様: [V4-SPEC](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/SPEC.md)
- **v5 Evidence:** V5-ARCH K-003/010。固定採択v5: [V5-ARCH](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_ARCHITECTURE_AND_V6_MAPPING_R0_2_20261101.md); [V5-LEDGER](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_RESEARCH_EVIDENCE_LEDGER_R0_2_20261101.md)
- **Agreement / Conflict:** 一致・Host全I/O経路未証明
- **Evidence Strength:** `DESIGN_SUPPORTED; HOST_NOT_VERIFIED`; **Classification:** `PROOF_REQUIRED`
- **Counterevidence / Limitations:** Read/Search/Show/attachmentsへの漏れ
- **v6 Implication (unadopted):** D0バイト不変と全露出面検証
- **Proof Obligation:** `PO-13` — Approved D0とdirty D1のArtifact authorityについて本R1で新規Host証明なし
- **Authority:** `ANALYST_CANDIDATE / NOT_OWNER_ADOPTED`

### JV6-KR-R1-014 — Finding Field Propagationの未知キー

- **v4 Knowledge IDs:** JV4-K-013; **v5 Knowledge IDs:** 対応なし
- **Claim:** Finding Field Propagationの未知キー
- **v4 Evidence:** V4-R01 K-013; V4-R02 R1-F-04。固定v4原本: [V4-R01](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.1/JUSTICE_V4_KNOWLEDGE_EVIDENCE_R0_1_20261101.md); [V4-R03](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.3/JUSTICE_V4_R0_3_SOURCE_INVENTORY.md); 仕様: [V4-SPEC](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/SPEC.md)
- **v5 Evidence:** 対応なし：v5 adopted K固有Finding未特定。固定採択v5: [V5-ARCH](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_ARCHITECTURE_AND_V6_MAPPING_R0_2_20261101.md); [V5-LEDGER](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_RESEARCH_EVIDENCE_LEDGER_R0_2_20261101.md)
- **Agreement / Conflict:** 直接対照なし・横断安全知見
- **Evidence Strength:** `STATIC_RISK; NOT_OBSERVED_EXPLOIT`; **Classification:** `CARRY_FORWARD_PRINCIPLE_CANDIDATE`
- **Counterevidence / Limitations:** {...finding}の未知キー残存; 未修正
- **v6 Implication (unadopted):** allowlist再構築とredactionの検証
- **Proof Obligation:** `PO-14` — Finding Field Propagationの未知キーについて本R1で新規Host証明なし
- **Authority:** `ANALYST_CANDIDATE / NOT_OWNER_ADOPTED`

### JV6-KR-R1-015 — TaskFeedbackの親子ToolCall相関

- **v4 Knowledge IDs:** JV4-K-019; **v5 Knowledge IDs:** JV5-K-004
- **Claim:** TaskFeedbackの親子ToolCall相関
- **v4 Evidence:** V4-R03 K-019; V4-R02 R1-F-06。固定v4原本: [V4-R01](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.1/JUSTICE_V4_KNOWLEDGE_EVIDENCE_R0_1_20261101.md); [V4-R03](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.3/JUSTICE_V4_R0_3_SOURCE_INVENTORY.md); 仕様: [V4-SPEC](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/SPEC.md)
- **v5 Evidence:** V5-ARCH K-004; V5-LEDGER §7.1。固定採択v5: [V5-ARCH](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_ARCHITECTURE_AND_V6_MAPPING_R0_2_20261101.md); [V5-LEDGER](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_RESEARCH_EVIDENCE_LEDGER_R0_2_20261101.md)
- **Agreement / Conflict:** 一致・V2 Host証拠不足
- **Evidence Strength:** `HOST_PROOF_NOT_ESTABLISHED`; **Classification:** `PROOF_REQUIRED`
- **Counterevidence / Limitations:** tool=taskの暗黙前提と未知result
- **v6 Implication (unadopted):** parent/session/call/child/terminal join
- **Proof Obligation:** `PO-15` — TaskFeedbackの親子ToolCall相関について本R1で新規Host証明なし
- **Authority:** `ANALYST_CANDIDATE / NOT_OWNER_ADOPTED`

### JV6-KR-R1-016 — AgentRouterは実行エンジンではない

- **v4 Knowledge IDs:** JV4-K-020; **v5 Knowledge IDs:** JV5-K-011
- **Claim:** AgentRouterは実行エンジンではない
- **v4 Evidence:** V4-R03 K-020。固定v4原本: [V4-R01](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.1/JUSTICE_V4_KNOWLEDGE_EVIDENCE_R0_1_20261101.md); [V4-R03](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.3/JUSTICE_V4_R0_3_SOURCE_INVENTORY.md); 仕様: [V4-SPEC](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/SPEC.md)
- **v5 Evidence:** V5-PURPOSE §5; V5-ARCH K-011。固定採択v5: [V5-ARCH](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_ARCHITECTURE_AND_V6_MAPPING_R0_2_20261101.md); [V5-LEDGER](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_RESEARCH_EVIDENCE_LEDGER_R0_2_20261101.md)
- **Agreement / Conflict:** v4実装の限界とv5方針が一致
- **Evidence Strength:** `SOURCE_INVENTORY; STATIC_INFERENCE`; **Classification:** `DO_NOT_PORT_AS_IS_CANDIDATE`
- **Counterevidence / Limitations:** wrapperの存在はOmO機能充足を示さない
- **v6 Implication (unadopted):** Option Cの能力分解と費用測定
- **Proof Obligation:** `PO-16` — AgentRouterは実行エンジンではないについて本R1で新規Host証明なし
- **Authority:** `ANALYST_CANDIDATE / NOT_OWNER_ADOPTED`

### JV6-KR-R1-017 — WisdomとTiered Storesの費用対価値

- **v4 Knowledge IDs:** JV4-K-022; **v5 Knowledge IDs:** JV5-K-012
- **Claim:** WisdomとTiered Storesの費用対価値
- **v4 Evidence:** V4-R03 K-022。固定v4原本: [V4-R01](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.1/JUSTICE_V4_KNOWLEDGE_EVIDENCE_R0_1_20261101.md); [V4-R03](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.3/JUSTICE_V4_R0_3_SOURCE_INVENTORY.md); 仕様: [V4-SPEC](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/SPEC.md)
- **v5 Evidence:** V5-ARCH K-012。固定採択v5: [V5-ARCH](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_ARCHITECTURE_AND_V6_MAPPING_R0_2_20261101.md); [V5-LEDGER](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_RESEARCH_EVIDENCE_LEDGER_R0_2_20261101.md)
- **Agreement / Conflict:** 双方未証明・義務化できない
- **Evidence Strength:** `CODE_OBSERVED; VALUE_NOT_MEASURED`; **Classification:** `OPTIONAL_VALUE_UNPROVEN`
- **Counterevidence / Limitations:** context污染・retention・secret leakage
- **v6 Implication (unadopted):** 品質改善・プライバシー・コスト比較
- **Proof Obligation:** `PO-17` — WisdomとTiered Storesの費用対価値について本R1で新規Host証明なし
- **Authority:** `ANALYST_CANDIDATE / NOT_OWNER_ADOPTED`

### JV6-KR-R1-018 — Telemetryの価値と保持ポリシー

- **v4 Knowledge IDs:** JV4-K-022; **v5 Knowledge IDs:** JV5-K-012
- **Claim:** Telemetryの価値と保持ポリシー
- **v4 Evidence:** V4-R03 §Source snapshot; K-022。固定v4原本: [V4-R01](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.1/JUSTICE_V4_KNOWLEDGE_EVIDENCE_R0_1_20261101.md); [V4-R03](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.3/JUSTICE_V4_R0_3_SOURCE_INVENTORY.md); 仕様: [V4-SPEC](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/SPEC.md)
- **v5 Evidence:** V5-ARCH K-012。固定採択v5: [V5-ARCH](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_ARCHITECTURE_AND_V6_MAPPING_R0_2_20261101.md); [V5-LEDGER](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_RESEARCH_EVIDENCE_LEDGER_R0_2_20261101.md)
- **Agreement / Conflict:** 双方で価値未実証
- **Evidence Strength:** `CODE_OBSERVED; VALUE_NOT_MEASURED`; **Classification:** `OPTIONAL_VALUE_UNPROVEN`
- **Counterevidence / Limitations:** latency / privacy / storage overhead
- **v6 Implication (unadopted):** 計測しない設計との比較
- **Proof Obligation:** `PO-18` — Telemetryの価値と保持ポリシーについて本R1で新規Host証明なし
- **Authority:** `ANALYST_CANDIDATE / NOT_OWNER_ADOPTED`

### JV6-KR-R1-019 — Compaction context continuityとHost機構

- **v4 Knowledge IDs:** JV4-K-023; **v5 Knowledge IDs:** JV5-K-009
- **Claim:** Compaction context continuityとHost機構
- **v4 Evidence:** V4-R03 K-023。固定v4原本: [V4-R01](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.1/JUSTICE_V4_KNOWLEDGE_EVIDENCE_R0_1_20261101.md); [V4-R03](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.3/JUSTICE_V4_R0_3_SOURCE_INVENTORY.md); 仕様: [V4-SPEC](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/SPEC.md)
- **v5 Evidence:** V5-ARCH K-009。固定採択v5: [V5-ARCH](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_ARCHITECTURE_AND_V6_MAPPING_R0_2_20261101.md); [V5-LEDGER](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_RESEARCH_EVIDENCE_LEDGER_R0_2_20261101.md)
- **Agreement / Conflict:** 目的共通・再注入方式非可搬
- **Evidence Strength:** `CODE_OBSERVED; HOST_NOT_VERIFIED`; **Classification:** `ADAPT_IMPLEMENTATION_CANDIDATE`
- **Counterevidence / Limitations:** 旧Hook保証なし・復元時承認昇格危険
- **v6 Implication (unadopted):** 再圧縮/再起動/断線でidentity保持
- **Proof Obligation:** `PO-19` — Compaction context continuityとHost機構について本R1で新規Host証明なし
- **Authority:** `ANALYST_CANDIDATE / NOT_OWNER_ADOPTED`

### JV6-KR-R1-020 — Native-firstはv6既定ではない

- **v4 Knowledge IDs:** JV4-K-015; **v5 Knowledge IDs:** JV5-K-011
- **Claim:** Native-firstはv6既定ではない
- **v4 Evidence:** V4-R01 K-015; V4-R04 §4。固定v4原本: [V4-R01](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.1/JUSTICE_V4_KNOWLEDGE_EVIDENCE_R0_1_20261101.md); [V4-R03](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.3/JUSTICE_V4_R0_3_SOURCE_INVENTORY.md); 仕様: [V4-SPEC](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/SPEC.md)
- **v5 Evidence:** V5-PURPOSE §4; V5-ARCH §4。固定採択v5: [V5-ARCH](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_ARCHITECTURE_AND_V6_MAPPING_R0_2_20261101.md); [V5-LEDGER](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_RESEARCH_EVIDENCE_LEDGER_R0_2_20261101.md)
- **Agreement / Conflict:** 一致：A/B/C未選定
- **Evidence Strength:** `PRIOR_TEST_REPORTED; NOT_SELECTED`; **Classification:** `PROOF_REQUIRED`
- **Counterevidence / Limitations:** 31/32とCase AからHost一般証明不可
- **v6 Implication (unadopted):** Option A/B/C同一Capability表
- **Proof Obligation:** `PO-20` — Native-firstはv6既定ではないについて本R1で新規Host証明なし
- **Authority:** `ANALYST_CANDIDATE / NOT_OWNER_ADOPTED`

### JV6-KR-R1-021 — Case A provider stream error後の安全性

- **v4 Knowledge IDs:** 対応なし; **v5 Knowledge IDs:** JV5-K-005
- **Claim:** Case A provider stream error後の安全性
- **v4 Evidence:** 対応なし：v4独立Case A固有試験なし。固定v4原本: [V4-R01](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.1/JUSTICE_V4_KNOWLEDGE_EVIDENCE_R0_1_20261101.md); [V4-R03](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.3/JUSTICE_V4_R0_3_SOURCE_INVENTORY.md); 仕様: [V4-SPEC](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/SPEC.md)
- **v5 Evidence:** V5-LEDGER §7.1 RG-310-A-001; V5-R3 §5。固定採択v5: [V5-ARCH](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_ARCHITECTURE_AND_V6_MAPPING_R0_2_20261101.md); [V5-LEDGER](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_RESEARCH_EVIDENCE_LEDGER_R0_2_20261101.md)
- **Agreement / Conflict:** v5固有の未証明を保持
- **Evidence Strength:** `BLOCKED; PRIOR_TEST_REPORTED`; **Classification:** `PROOF_REQUIRED`
- **Counterevidence / Limitations:** 5つのpost-error観測欠落
- **v6 Implication (unadopted):** 実Hostでの拒否・再承認・遅延出力
- **Proof Obligation:** `PO-21` — Case A provider stream error後の安全性について本R1で新規Host証明なし
- **Authority:** `ANALYST_CANDIDATE / NOT_OWNER_ADOPTED`

### JV6-KR-R1-022 — Unknown-tool synthetic result厳密ID結合

- **v4 Knowledge IDs:** JV4-K-004, JV4-K-019; **v5 Knowledge IDs:** JV5-K-004, JV5-K-005
- **Claim:** Unknown-tool synthetic result厳密ID結合
- **v4 Evidence:** V4-R01 K-004; V4-R03 K-019。固定v4原本: [V4-R01](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.1/JUSTICE_V4_KNOWLEDGE_EVIDENCE_R0_1_20261101.md); [V4-R03](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.3/JUSTICE_V4_R0_3_SOURCE_INVENTORY.md); 仕様: [V4-SPEC](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/SPEC.md)
- **v5 Evidence:** V5-LEDGER §7.1 RG-310-B-001; V5-R3 §5。固定採択v5: [V5-ARCH](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_ARCHITECTURE_AND_V6_MAPPING_R0_2_20261101.md); [V5-LEDGER](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_RESEARCH_EVIDENCE_LEDGER_R0_2_20261101.md)
- **Agreement / Conflict:** 共通identity問題・v5に具体的BLOCK
- **Evidence Strength:** `BLOCKED; PRIOR_TEST_REPORTED`; **Classification:** `PROOF_REQUIRED`
- **Counterevidence / Limitations:** callback message.id/post append messageIdともnull
- **v6 Implication (unadopted):** 同一session/callの確実な結合
- **Proof Obligation:** `PO-22` — Unknown-tool synthetic result厳密ID結合について本R1で新規Host証明なし
- **Authority:** `ANALYST_CANDIDATE / NOT_OWNER_ADOPTED`

### JV6-KR-R1-023 — Positive sanitizer removal証明

- **v4 Knowledge IDs:** JV4-K-013; **v5 Knowledge IDs:** JV5-K-005
- **Claim:** Positive sanitizer removal証明
- **v4 Evidence:** V4-R01 K-013（一般的な漏えいリスクのみ）。固定v4原本: [V4-R01](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.1/JUSTICE_V4_KNOWLEDGE_EVIDENCE_R0_1_20261101.md); [V4-R03](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.3/JUSTICE_V4_R0_3_SOURCE_INVENTORY.md); 仕様: [V4-SPEC](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/SPEC.md)
- **v5 Evidence:** V5-LEDGER §7.1 RG-310-B-002; V5-R3 §5。固定採択v5: [V5-ARCH](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_ARCHITECTURE_AND_V6_MAPPING_R0_2_20261101.md); [V5-LEDGER](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_RESEARCH_EVIDENCE_LEDGER_R0_2_20261101.md)
- **Agreement / Conflict:** 関連するが直接同一のFindingではない
- **Evidence Strength:** `NOT_PROVEN; PRIOR_TEST_REPORTED`; **Classification:** `PROOF_REQUIRED`
- **Counterevidence / Limitations:** token未出現/changed=falseは除去証明でない
- **v6 Implication (unadopted):** tokenあり→除去の正の対照
- **Proof Obligation:** `PO-23` — Positive sanitizer removal証明について本R1で新規Host証明なし
- **Authority:** `ANALYST_CANDIDATE / NOT_OWNER_ADOPTED`

### JV6-KR-R1-024 — 全56シナリオのE2E Closure

- **v4 Knowledge IDs:** JV4-K-012; **v5 Knowledge IDs:** JV5-K-007, JV5-K-011
- **Claim:** 全56シナリオのE2E Closure
- **v4 Evidence:** V4-R01 K-012。固定v4原本: [V4-R01](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.1/JUSTICE_V4_KNOWLEDGE_EVIDENCE_R0_1_20261101.md); [V4-R03](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.3/JUSTICE_V4_R0_3_SOURCE_INVENTORY.md); 仕様: [V4-SPEC](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/SPEC.md)
- **v5 Evidence:** V5-CROSSWALK §§5,7; V5-R2 §3。固定採択v5: [V5-ARCH](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_ARCHITECTURE_AND_V6_MAPPING_R0_2_20261101.md); [V5-LEDGER](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_RESEARCH_EVIDENCE_LEDGER_R0_2_20261101.md)
- **Agreement / Conflict:** 証拠階層共通・v5全件未成立
- **Evidence Strength:** `DOCUMENT_OBSERVED; E2E_NOT_ESTABLISHED`; **Classification:** `PROOF_REQUIRED`
- **Counterevidence / Limitations:** unit30/integration15/E2E10/spike1は計画分類
- **v6 Implication (unadopted):** 実HostとE2E closureの識別
- **Proof Obligation:** `PO-24` — 全56シナリオのE2E Closureについて本R1で新規Host証明なし
- **Authority:** `ANALYST_CANDIDATE / NOT_OWNER_ADOPTED`

### JV6-KR-R1-025 — Stale Authorizationとreopen

- **v4 Knowledge IDs:** JV4-K-005, JV4-K-010; **v5 Knowledge IDs:** JV5-K-003, JV5-K-010
- **Claim:** Stale Authorizationとreopen
- **v4 Evidence:** V4-R01 K-005/010; ISSUE-310 DEP-01。固定v4原本: [V4-R01](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.1/JUSTICE_V4_KNOWLEDGE_EVIDENCE_R0_1_20261101.md); [V4-R03](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.3/JUSTICE_V4_R0_3_SOURCE_INVENTORY.md); 仕様: [V4-SPEC](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/SPEC.md)
- **v5 Evidence:** V5-ARCH K-003/010; ISSUE-298。固定採択v5: [V5-ARCH](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_ARCHITECTURE_AND_V6_MAPPING_R0_2_20261101.md); [V5-LEDGER](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_RESEARCH_EVIDENCE_LEDGER_R0_2_20261101.md)
- **Agreement / Conflict:** 要件方向一致・世代継承契約に差異
- **Evidence Strength:** `HISTORICAL_RATIFICATION + STATIC_GAP`; **Classification:** `CONFLICT_REQUIRES_DECISION`
- **Counterevidence / Limitations:** v4 successor fresh review vs #298の限定継承案
- **v6 Implication (unadopted):** change matrixと失効契約再審
- **Proof Obligation:** `PO-25` — Stale Authorizationとreopenについて本R1で新規Host証明なし
- **Authority:** `ANALYST_CANDIDATE / NOT_OWNER_ADOPTED`

### JV6-KR-R1-026 — Recoveryとidempotent external side effects

- **v4 Knowledge IDs:** JV4-K-008, JV4-K-009, JV4-K-023; **v5 Knowledge IDs:** JV5-K-009, JV5-K-010
- **Claim:** Recoveryとidempotent external side effects
- **v4 Evidence:** V4-R01 K-008/009; V4-R03 K-023。固定v4原本: [V4-R01](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.1/JUSTICE_V4_KNOWLEDGE_EVIDENCE_R0_1_20261101.md); [V4-R03](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.3/JUSTICE_V4_R0_3_SOURCE_INVENTORY.md); 仕様: [V4-SPEC](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/SPEC.md)
- **v5 Evidence:** V5-ARCH K-009/010; ISSUE-298。固定採択v5: [V5-ARCH](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_ARCHITECTURE_AND_V6_MAPPING_R0_2_20261101.md); [V5-LEDGER](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_RESEARCH_EVIDENCE_LEDGER_R0_2_20261101.md)
- **Agreement / Conflict:** 目的一致・イベントモデル未証明
- **Evidence Strength:** `STATIC_GAP_IDENTIFIED; NOT_VERIFIED`; **Classification:** `ADAPT_IMPLEMENTATION_CANDIDATE`
- **Counterevidence / Limitations:** event存在≠semantic state復元
- **v6 Implication (unadopted):** crash windowごとの二重作用否定
- **Proof Obligation:** `PO-26` — Recoveryとidempotent external side effectsについて本R1で新規Host証明なし
- **Authority:** `ANALYST_CANDIDATE / NOT_OWNER_ADOPTED`

### JV6-KR-R1-027 — 認証済Protocol Affiliationの信頼境界

- **v4 Knowledge IDs:** JV4-K-004, JV4-K-007; **v5 Knowledge IDs:** JV5-K-005
- **Claim:** 認証済Protocol Affiliationの信頼境界
- **v4 Evidence:** V4-R01 K-004/007。固定v4原本: [V4-R01](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.1/JUSTICE_V4_KNOWLEDGE_EVIDENCE_R0_1_20261101.md); [V4-R03](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.3/JUSTICE_V4_R0_3_SOURCE_INVENTORY.md); 仕様: [V4-SPEC](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/SPEC.md)
- **v5 Evidence:** V5-PURPOSE §4; V5-LEDGER §3; V5-ARCH K-005。固定採択v5: [V5-ARCH](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_ARCHITECTURE_AND_V6_MAPPING_R0_2_20261101.md); [V5-LEDGER](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_RESEARCH_EVIDENCE_LEDGER_R0_2_20261101.md)
- **Agreement / Conflict:** v5設計転換・hidden origin証明ではない
- **Evidence Strength:** `DOCUMENT_OBSERVED; HOST_NOT_VERIFIED`; **Classification:** `PROOF_REQUIRED`
- **Counterevidence / Limitations:** token-holder mislabelを防ぐ強い証明なし
- **v6 Implication (unadopted):** capability実測と敵対的テスト
- **Proof Obligation:** `PO-27` — 認証済Protocol Affiliationの信頼境界について本R1で新規Host証明なし
- **Authority:** `ANALYST_CANDIDATE / NOT_OWNER_ADOPTED`

### JV6-KR-R1-028 — Requirements/Design/Planの静的ID連鎖

- **v4 Knowledge IDs:** JV4-K-005; **v5 Knowledge IDs:** JV5-K-003, JV5-K-007
- **Claim:** Requirements/Design/Planの静的ID連鎖
- **v4 Evidence:** V4-R01 K-005。固定v4原本: [V4-R01](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.1/JUSTICE_V4_KNOWLEDGE_EVIDENCE_R0_1_20261101.md); [V4-R03](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.3/JUSTICE_V4_R0_3_SOURCE_INVENTORY.md); 仕様: [V4-SPEC](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/SPEC.md)
- **v5 Evidence:** V5-CROSSWALK §§2–7; V5-R2 §3。固定採択v5: [V5-ARCH](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_ARCHITECTURE_AND_V6_MAPPING_R0_2_20261101.md); [V5-LEDGER](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_RESEARCH_EVIDENCE_LEDGER_R0_2_20261101.md)
- **Agreement / Conflict:** 歴史的文書構造は一致
- **Evidence Strength:** `DOCUMENT_OBSERVED; NO_RUNTIME_CLOSURE`; **Classification:** `CARRY_FORWARD_PRINCIPLE_CANDIDATE`
- **Counterevidence / Limitations:** 118 Req/38 Design/14 Tasksは実装済みではない
- **v6 Implication (unadopted):** 条項・証拠・判断の一意追跡
- **Proof Obligation:** `PO-28` — Requirements/Design/Planの静的ID連鎖について本R1で新規Host証明なし
- **Authority:** `ANALYST_CANDIDATE / NOT_OWNER_ADOPTED`

### JV6-KR-R1-029 — Evidence・Gate・Owner・Implementationの権限分離

- **v4 Knowledge IDs:** JV4-K-005, JV4-K-007, JV4-K-012; **v5 Knowledge IDs:** JV5-K-003, JV5-K-007, JV5-K-010
- **Claim:** Evidence・Gate・Owner・Implementationの権限分離
- **v4 Evidence:** V4-R01 K-005/007/012; V4-OWNER-ISSUE。固定v4原本: [V4-R01](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.1/JUSTICE_V4_KNOWLEDGE_EVIDENCE_R0_1_20261101.md); [V4-R03](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.3/JUSTICE_V4_R0_3_SOURCE_INVENTORY.md); 仕様: [V4-SPEC](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/SPEC.md)
- **v5 Evidence:** V5-OWNER; V5-ARCH §§3,8.2。固定採択v5: [V5-ARCH](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_ARCHITECTURE_AND_V6_MAPPING_R0_2_20261101.md); [V5-LEDGER](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_RESEARCH_EVIDENCE_LEDGER_R0_2_20261101.md)
- **Agreement / Conflict:** 全面一致（規範採択は別工程）
- **Evidence Strength:** `OWNER_HISTORICAL_ADOPTION_ONLY`; **Classification:** `CARRY_FORWARD_PRINCIPLE_CANDIDATE`
- **Counterevidence / Limitations:** R3 PASSは訂正範囲のみ
- **v6 Implication (unadopted):** 独立approval/authorization ledger
- **Proof Obligation:** `PO-29` — Evidence・Gate・Owner・Implementationの権限分離について本R1で新規Host証明なし
- **Authority:** `ANALYST_CANDIDATE / NOT_OWNER_ADOPTED`

### JV6-KR-R1-030 — Adaptive routingとFallback/Retryの過剰所有

- **v4 Knowledge IDs:** JV4-K-003, JV4-K-020, JV4-K-021; **v5 Knowledge IDs:** JV5-K-011, JV5-K-012
- **Claim:** Adaptive routingとFallback/Retryの過剰所有
- **v4 Evidence:** V4-R03 K-020/021; V4-R01 K-003。固定v4原本: [V4-R01](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.1/JUSTICE_V4_KNOWLEDGE_EVIDENCE_R0_1_20261101.md); [V4-R03](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.3/JUSTICE_V4_R0_3_SOURCE_INVENTORY.md); 仕様: [V4-SPEC](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/SPEC.md)
- **v5 Evidence:** V5-PURPOSE §5; V5-ARCH K-011/012。固定採択v5: [V5-ARCH](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_ARCHITECTURE_AND_V6_MAPPING_R0_2_20261101.md); [V5-LEDGER](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_RESEARCH_EVIDENCE_LEDGER_R0_2_20261101.md)
- **Agreement / Conflict:** Justice実行系拡張は衝突候補
- **Evidence Strength:** `STATIC_INFERENCE; VALUE_NOT_ESTABLISHED`; **Classification:** `OPTIONAL_VALUE_UNPROVEN`
- **Counterevidence / Limitations:** Host/providerが既に同等機能を持つ可能性
- **v6 Implication (unadopted):** 反事実的価値と二重実行の計測
- **Proof Obligation:** `PO-30` — Adaptive routingとFallback/Retryの過剰所有について本R1で新規Host証明なし
- **Authority:** `ANALYST_CANDIDATE / NOT_OWNER_ADOPTED`

### JV6-KR-R1-031 — Option CでOmO相当Runtimeを内包

- **v4 Knowledge IDs:** JV4-K-001, JV4-K-020; **v5 Knowledge IDs:** JV5-K-001, JV5-K-011
- **Claim:** Option CでOmO相当Runtimeを内包
- **v4 Evidence:** V4-R01 K-001; V4-R03 K-020。固定v4原本: [V4-R01](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.1/JUSTICE_V4_KNOWLEDGE_EVIDENCE_R0_1_20261101.md); [V4-R03](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.3/JUSTICE_V4_R0_3_SOURCE_INVENTORY.md); 仕様: [V4-SPEC](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/SPEC.md)
- **v5 Evidence:** V5-ARCH §§3–4。固定採択v5: [V5-ARCH](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_ARCHITECTURE_AND_V6_MAPPING_R0_2_20261101.md); [V5-LEDGER](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_RESEARCH_EVIDENCE_LEDGER_R0_2_20261101.md)
- **Agreement / Conflict:** 非侵襲原則と重大な設計緊張
- **Evidence Strength:** `STATIC_INFERENCE; NOT_SELECTED`; **Classification:** `CONFLICT_REQUIRES_DECISION`
- **Counterevidence / Limitations:** 安全負担とSSOTの重複、実利未測定
- **v6 Implication (unadopted):** 分解可能なHost Gapと最低実装境界
- **Proof Obligation:** `PO-31` — Option CでOmO相当Runtimeを内包について本R1で新規Host証明なし
- **Authority:** `ANALYST_CANDIDATE / NOT_OWNER_ADOPTED`

### JV6-KR-R1-032 — Review Worker/semantic role identityの厳密性

- **v4 Knowledge IDs:** JV4-K-004, JV4-K-007; **v5 Knowledge IDs:** JV5-K-004, JV5-K-006
- **Claim:** Review Worker/semantic role identityの厳密性
- **v4 Evidence:** V4-R01 K-004/007; V4-SPEC §4.1c。固定v4原本: [V4-R01](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.1/JUSTICE_V4_KNOWLEDGE_EVIDENCE_R0_1_20261101.md); [V4-R03](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.3/JUSTICE_V4_R0_3_SOURCE_INVENTORY.md); 仕様: [V4-SPEC](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/SPEC.md)
- **v5 Evidence:** V5-ARCH K-004/006。固定採択v5: [V5-ARCH](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_ARCHITECTURE_AND_V6_MAPPING_R0_2_20261101.md); [V5-LEDGER](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_RESEARCH_EVIDENCE_LEDGER_R0_2_20261101.md)
- **Agreement / Conflict:** 共通保証・API差異あり
- **Evidence Strength:** `REAL_HOST_FAILURE_REPORTED; NOT_VERIFIED`; **Classification:** `ADAPT_IMPLEMENTATION_CANDIDATE`
- **Counterevidence / Limitations:** native controller≠inner worker
- **v6 Implication (unadopted):** 正規worker身元と結果帰属の証明
- **Proof Obligation:** `PO-32` — Review Worker/semantic role identityの厳密性について本R1で新規Host証明なし
- **Authority:** `ANALYST_CANDIDATE / NOT_OWNER_ADOPTED`
