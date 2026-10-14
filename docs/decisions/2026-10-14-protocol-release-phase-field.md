# プロトコルリリース権限における phase フィールドの設計判断

## ステータス

- 作成日: 2026-10-14
- 更新日: 2026-10-14
- 状態: **設計審査済み / Option A 条件付き採用 / 統合契約の確定・検証待ち**
- 注意: 本書は設計審査済みの判断文書であり、正式な Requirements Owner / Architecture Owner の決裁は別途必要

## 背景

Task 18 で追加した `src/runtime/review-gate-protocol-release-authority.ts` は、NC1 protocol-kind 遷移を検証する read-only な `VerifiedProtocolReleaseProvider` を提供する。
現在の実装は以下の構成になっている。

- `ProtocolReleaseRecordV1`：provider が読み込む release レコード。`phase: "design" | "plan"` を持つ。
- `VerifiedProtocolReleaseSource`：registry からレコードを読み出す seam。
- `createTrustedProtocolReleaseRegistry`：protected witness store 上に release registry を管理する。

adapter 内では現状、Task 5 の trusted release anchor / protected registry が未整備であることを理由に、provider を常に `"BLOCK"` を返す stub で配線している。

## 問題

`ProtocolReleaseRecordV1` は `phase` を持つが、registry が永続化する `releaseManifestSchema`（`ReleaseRegistry.releases[*].manifest`）には **release がどちらの phase を対象としているかを示すフィールドが存在しない**。

### 影響箇所

- `VerifiedProtocolReleaseSource.readRelease(releaseId)`：phase を引数に取らないため、返すレコードの `phase` を決定できない。
- `VerifiedProtocolReleaseSource.readReleaseByDescriptorDigest(descriptorDigest)`：同様に phase を決定できない。
- `createVerifiedProtocolReleaseProvider.readVerifiedPhaseProtocolDelta(input)`：`input.phase` と一致するか `isWellFormedReleaseRecord` で検証するが、source から返されるレコードの `phase` が不定。

## 選択肢

### 選択肢 A：release manifest に `phase` フィールドを追加する

`releaseManifestSchema` に `phase: z.literal("design").or(z.literal("plan"))` を追加し、1 つの release が design または plan のいずれかを明示的に対象とする。

#### 利点

- provider の `input.phase` との整合が自然。
- `ProtocolReleaseRecordV1.phase` の意味が明確になる。
- descriptor 内の `designPhase` / `planPhase` とは独立に、release 単位で対象 phase を指定できる。

#### 欠点

- `releaseManifestSchema` の変更が必要。
- 既存の `tests/runtime/review-gate-protocol-release-publication.test.ts` 等のテストデータを更新する必要がある。
- 既存の署名済み release に phase を追加することは破壊的変更。既存 release は V2 schema として再発行するか、明示的な移行手続きが必要。

### 選択肢 B：1 つの release が両 phase を同時にカバーする

`ProtocolReleaseRecordV1.phase` を廃止するか、配列 `phases: ("design" | "plan")[]` に変更する。

#### 利点

- manifest schema に phase フィールドを追加する必要がない。
- 同じ descriptor が両 phase に適用される場合に冗長性を減らせる。

#### 欠点

- provider インターフェースの変更が大きい。
- `phaseFingerprint` が phase ごとに異なるため、1 レコードで両方をカバーする場合はフィールド構造を変更する必要がある。
- 既存の `createVerifiedProtocolReleaseProvider` 実装と整合しない箇所が多い。

### 選択肢 C：descriptor の内容から phase を推定する

descriptor の `designPhase` / `planPhase` の差分や、提供された `input.phase` に対応する fingerprint の存在から phase を推定する。

#### 利点

- schema 変更が不要。

#### 欠点

- 推定ロジックが不可靠。同一内容の descriptor が両 phase に適用される場合に曖昧性が生じる。
- 設計意図が暗黙的になり、監査性が低下する。
- fail-closed の原則に反する可能性がある。

## 最終判断

**選択肢 A：release manifest に `phase` フィールドを追加する**

採用理由は以下の通り。

1. 既存の `ProtocolReleaseRecordV1` の設計意図と最も整合する。
2. NC1 protocol-kind 遷移は phase 単位で発生するため、release も phase 単位で管理するのが自然。
3. descriptor 内に両 phase の情報が含まれていても、release は特定の phase に対する承認を表すべき。
4. 監査証跡と fail-closed 動作を保ちやすい。

## 設計決定

### D1：phase は manifest トップレベル

`releaseManifestSchema` のトップレベルに必須フィールドとして追加する。`phase` は descriptor の性質ではなく、release によって付与された承認の範囲である。

```typescript
export const releaseManifestSchema = z.strictObject({
  installationId: id,
  publicationOperationId: id,
  expectedProtectedReleaseHead: releaseHeadSchema,
  parentReleaseId: id.nullable(),
  releaseId: id,
  phase: z.enum(["design", "plan"]),
  trustPolicyVersion: id,
  sourceDigest: digest,
  releaseDescriptorDigest: digest,
  verifiedSemanticContractDigest: digest,
  descriptor,
  // ...existing fields
});
```

### D2：digest は統合せず、関係を厳密に定義する

| フィールド | 意味 |
| --- | --- |
| `sourceDigest` | exact source bytes の SHA-256 |
| `releaseDescriptorDigest` | descriptor + verified semantic contract digest からなる canonical JSON の fingerprint |
| `ProtocolReleaseRecordV1.descriptorDigest` | **exact source bytes の SHA-256 として維持**（= `sourceDigest` と対応） |
| `ProtocolReleaseRecordV1.releaseDescriptorDigest` | 別フィールドとして追加し、`manifest.releaseDescriptorDigest` と対応 |

`verifiedSemanticContractDigest` は、信頼ポリシーまたは信頼できる semantic contract registry から取得し、descriptor と結合して `releaseDescriptorDigest` を計算する。取得元と検証方法は `review-gate-release-verification.ts` および `review-gate-protocol.ts` で統一する。

### D3：registryHead は commit 後の frontierHash

`createTrustedProtocolReleaseRegistry.commit()` で計算される `nextHead.frontierHash` を、当該 release の `registryHead` に対応させる。過去 release の `registryHead` は protected history から再構築・検証する。

### D4：同一 phase・同一 descriptor digest に複数 release が存在する場合の検索規則

`readReleaseByPhaseAndDescriptorDigest()` は以下の規則で一意の結果を決定する。

1. `(phase, releaseDescriptorDigest)` に一致する release を registry から収集する。
2. 該当 release が存在しない場合は `null` を返す。
3. 複数存在する場合は、保護された履歴において現在の head に到達可能な release のみを候補とする。
4. 候補が複数残る場合は、最も head に近い release（chain の末端）を選択する。
5. それでも一意に決定できない場合、または無効・未承認の release が含まれる場合は `null` を返し、provider 側で `"BLOCK"` とする。

無条件に「最新」を選択せず、保護された履歴と承認状態に基づく決定的な選択、または安全な失敗を優先する。

### D5：historicalReleaseProofDigest の検証対象

`historicalReleaseProofDigest` は以下を含む canonical JSON の fingerprint とする。

```typescript
{
  domain: "justice-protocol-release-v1",
  schemaVersion: "justice-protocol-release-v1",
  releaseId: oldRelease.releaseId,
  phase: oldRelease.phase,
  descriptorDigest: oldRelease.descriptorDigest,
  releaseDescriptorDigest: oldRelease.releaseDescriptorDigest,
  phaseFingerprint: oldRelease.phaseFingerprint,
  registryHead: oldRelease.registryHead,
}
```

これにより、異なる phase の release 証跡を流用できないようにする。

### D6：Phase をまたぐ release ancestry

同一 phase 内の履歴は、release chain 全体を走査して検証する。例えば `R1(design) → R2(plan) → R3(design)` のような phase を跨ぐ chain では、R3 の直接 predecessor は R2 だが、R3 の design phase としての正当性を確認するには R1 までの design lineage を辿る必要がある。

provider は以下の規則で検証する。

1. 要求 phase に一致する release のみを chain 上の有効ノードとする。
2. `oldRelease` は、要求 phase に一致する release chain 内で `newRelease` の直前の同一 phase ancestor とする。
3. `newRelease.ancestorReleaseIds` が含む release id は phase に関係なく検証されるが、同一 phase 内の継続性は別途 lineage 走査で確認する。
4. 同一 phase の lineage が不連続、不明瞭、または改竄されている場合は `"BLOCK"` とする。

### D7：Historical semantic contract の再現性

各 release において `releaseDescriptorDigest` を計算する際に使用された `verifiedSemanticContractDigest` は、署名済み証跡から一意に復元できる必要がある。

Invariant:

```typescript
manifest.releaseDescriptorDigest ===
  computeCanonicalJsonFingerprint({
    descriptor: manifest.descriptor,
    verifiedSemanticContractDigest: manifest.verifiedSemanticContractDigest,
  })
```

- `verifiedSemanticContractDigest` は release manifest の必須フィールドとして保持する。
- 過去 release を再検証する際は、当時の `verifiedSemanticContractDigest` を使用する。
- 現在の runtime の semantic contract と異なる場合でも、署名済み証跡が一致すれば正当とする。
- 現在の runtime での追加検証は、それとは別の工程として実施する。

## 追加で解決すべき不整合

### 1. scope-admission の global/phase fingerprint 判定順序

`src/runtime/review-gate-scope-admission.ts` の `changedDimension()` は現在 global fingerprint を先に判定するため、通常の design/plan 変更も `global_protocol` として誤って拒否される。変更の影響範囲を分類してから承認対象 phase に対応させる必要がある。

### 2. 署名対象の不一致

publication 側は署名済み `manifest` を認証する。authority 側の `releaseSignaturePayload()` は異なる envelope を署名対象としている。両者を統一し、provider は検証済み manifest と保護された履歴から `ProtocolReleaseRecordV1` 相当の情報を導出する。

### 3. phase 付き検索 API

`readReleaseByDescriptorDigest` に加え、phase を引数に取る検索 API が必要。

```typescript
interface VerifiedProtocolReleaseSource {
  readRegistryHead(): Promise<string | null>;
  readRelease(releaseId: string): Promise<ProtocolReleaseRecordV1 | null>;
  readReleaseByPhaseAndDescriptorDigest(
    phase: VerifiedProtocolReleasePhase,
    releaseDescriptorDigest: string,
  ): Promise<ProtocolReleaseRecordV1 | null>;
}
```

### 4. Publisher 鍵ローテーション

authority 側は単純な鍵 digest 一致を要求しているが、初期鍵と異なる新しい publisher 鍵を拒否してしまう。trust root から承認された鍵ローテーション履歴を検証する必要がある。

### 5. Runtime version と過去 release の再検証

`createReleaseVerification.current()` は過去 release を現在の runtime の `computeReviewGateProtocolFingerprints` で再検証する。semantic contract が更新されると過去 release が拒否されるリスクがある。過去 release は当時の署名済み semantic contract digest に基づいて検証すべき。

### 6. trustedPublisherPolicyVersion の不一致

publication テストでは `trustPolicyVersion: "policy-1"` を使用するが、runtime descriptor は `"1"` を生成する。信頼ポリシーのバージョンは runtime の内部 authority policy 番号から推測せず、検証済みの外部信頼設定から取得すべき。

## 受入条件（real provider 有効化前）

| ID | 条件 | 優先度 |
| --- | --- | --- |
| AC-01 | manifest の phase と要求 phase が不一致なら BLOCK | 必須 |
| AC-02 | 同一 descriptor digest の design/plan release を区別できる | 必須 |
| AC-03 | sourceDigest と semantic descriptor digest をそれぞれ正しく検証する | 必須 |
| AC-04 | publication と authority が同一の署名契約を検証する | 必須 |
| AC-05 | registry head rollback・履歴改変・古い head を拒否する | 必須 |
| AC-06 | 正当な publisher 鍵ローテーションを履歴から検証できる | 必須 |
| AC-07 | phase 単位の変更を global fingerprint の差分だけで拒否しない | 必須 |
| AC-08 | 共有ポリシー変更を単一 phase の承認で通さない | 必須 |
| AC-09 | 過去 release を当時の semantic contract に基づいて再検証できる | 必須 |
| AC-10 | Phase を跨ぐ chain 内で同一 phase の lineage が正当である | 必須 |
| AC-11 | 各 release の `verifiedSemanticContractDigest` が署名済み証跡から一意に復元できる | 必須 |
| AC-12 | Task 5 未成立時は引き続き BLOCK | 必須 |

## 実装対象ファイル

| 対象 | 変更内容 |
| --- | --- |
| `src/runtime/review-gate-release-schema.ts` | 必須 `phase` / `releaseDescriptorDigest` / `verifiedSemanticContractDigest` の追加 |
| `src/runtime/review-gate-release-verification.ts` | phase・digest・semantic contract・署名の整合性検証 |
| `src/runtime/review-gate-protocol-release-publication.ts` | 検証済み snapshot を返す read-only API の追加 |
| `src/runtime/review-gate-protocol-release-authority.ts` | manifest 署名契約と統一、phase 対応検索、履歴証明 |
| `src/runtime/review-gate-protocol.ts` | descriptor digest と publisher policy version の意味を統一 |
| `src/runtime/review-gate-scope-admission.ts` | global/phase fingerprint の変更分類を修正 |
| `src/runtime/opencode-adapter.ts` | Task 5 の信頼境界が成立した場合のみ real provider を接続 |
| `tests/runtime/review-gate-protocol-release-publication.test.ts` | schema 変更に伴う更新 |
| `tests/runtime/review-gate-protocol-release-authority.test.ts` | 既存テスト拡張・registry 統合テスト追加 |

## 注意事項

- `rotatePublisherTrustPolicy()` への phase 引数追加は不要。Publisher 信頼ポリシーは release の承認対象 phase とは別の概念。
- `commitPreparedProtocolReleaseCAS()` も、署名済み manifest の `phase` を利用できるため、操作引数に重複して指定する必要はない。
- 既存の署名済み release に phase を自動補完する移行は避ける。V2 schema として再発行するか、明示的な手続きを設ける。
- 上記の統合契約が検証されるまでは、`opencode-adapter.ts` の fail-closed stub を維持する。
- Task 5 の信頼境界が成立し、受入条件が実証されるまでは real provider の有効化は行わない。
