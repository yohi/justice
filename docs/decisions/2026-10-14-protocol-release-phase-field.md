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


#### D3.1：NC1 専用 protected witness publication と lock graph（RG-PHASE-001 / R1限定修正）

**採用方式を一つに固定:** 通常の `eventStore.appendEvents()` / `prepareVerifiedEventPublication()` → `publishPreparedEvent()` を scope lock 保持中に呼ぶ方式は採用しない。NC1 protocol-kind の成功経路だけに **`DurableReviewGateEventStore.finalizeVerifiedProtocolNc1()`**（内部 trusted owner API）を設け、`ReviewGateScopeWitness.withProtocolNc1PublicationTransaction()` によって **installation guard → scope lock → gate lock → protocol-release guard** の順序で所有する。通常の FDR-011 protected staging → exact native shard durable replace + fsync → witness CAS をそのまま共有し、再入しない `preparePublicationUnlocked()` / 新規 `publishPreparedJournalUnlocked()` / `commitPublicationUnlocked()` を使う。`withWitnessTransaction(context, ..., {scopeIds:[scopeId], gateIds:[gateId]})` をこの専用 entrypoint の**外側一回だけ**実行し、同一 scope/gate lock を内部で再取得しない。

現行 `withGateOwnedWitnessTransaction()` は installation guard の再取得を避ける既存補助として存在するが、**scope/gate lock を先に取得した後で installation guard を取得するため、本経路の outer transaction には利用しない。** 既存の通常 witness API は installation → scope → gate を採用しており、逆順の二経路を混在させない。

```typescript
type ReleaseHead = z.infer<typeof releaseHeadSchema>;
type VerifiedRegistryCheckpoint = Readonly<{
  head: ReleaseHead;
  registryRevision: number;
  registryStateHash: string;
  currentPolicyVersion: string;
}>;
type GuardedProtocolReleaseRead = Readonly<{
  snapshot: VerifiedReleaseSnapshot;
  source: VerifiedProtocolReleaseSource;
  checkpoint: VerifiedRegistryCheckpoint;
}>;
interface TrustedProtocolReleaseAdmissionHost {
  // Caller already owns installation guard + exactly one scope/gate lock pair.
  withVerifiedReleaseAdmissionLease<T>(
    run: (read: GuardedProtocolReleaseRead) => Promise<T>,
  ): Promise<T>;
}
```

**Lock graph（actor、順序、release、再入）**

| Operation / actor | 必須取得順序 | 解放順序 | 再入・競合 |
| --- | --- | --- | --- |
| 通常 durable witness publication / witness owner | installation → scope → gate（`withWitnessTransaction`） | gate → scope → installation | 非再入。失敗/occupied は既存 fail-closed |
| NC1 protocol finalization / durable event-store owner | installation → scope → gate（専用 `withWitnessTransaction`）→ protocol-release（`withGuard("protocol-release")`） | protocol-release → gate → scope → installation | 各 lock 取得は一度。occupied、timeout、OS guard 不可なら `BLOCK` |
| Release commit / privileged publisher | protocol-release | protocol-release | installation/scope/gate を**保持・要求しない**。後続 witness append を同じ callback で開始禁止 |
| Publisher policy rotation / privileged trust owner | protocol-release | protocol-release | 同上。head.frontierHash が同じでも revision/hash が変わる |
| NC1 preflight / scope admission（現行コードの read-only 経路） | scope lock → installation guard（`withAdmissionLease` 内の既存 witness read が後から取得） | installation → scope | **非正規の read-only 例外**。installation は `flock --nonblock` で競合時 BLOCK。gate lock / protocol-release guard / durable publication を決して開始せず、preflight candidate は最終成功証拠として再利用禁止 |
| Gate-owned coordinator normal actions | 既存 Gate-owned lock lease、既存 publication 契約に従う | 対応する逆順 | NC1 専用 API と同じ gate/scope を同時に取得できない。逆順 acquisition の actor は同時に installation/protocol-release を要求してはならない |

すべての同一 namespace の lock は共通の OS-backed lock manager / `ProtectedWitnessStore` に属する。**どの path でも同一 scope/gate lock・installation guard を再入取得しない。** `ProtectedWitnessStore.withGuard()` は `flock --nonblock`、scope/gate lock は occupied 時に非待機失敗することを前提とし、逆順の既存 Gate-owned 経路との競合も **wait-and-deadlock ではなく即時 fail-closed** とする。nonblocking lock の待機型への変更を単独で認めない。 `scope → protocol-release → installation` や `protocol-release → installation` は禁止。独立 release writer が installation/scope/gate を取得しないという制約をコードレビューと race テストで確認し、違反があれば `BLOCK`。通常 gate-held coordinator の既存動作全体をこの改訂で変更しないが、NC1 finalization への entry 時に既存 gate/scope lease があれば拒否する。

**最新性と pinning**

- `readVerifiedReleaseSnapshot()` は過去時点の資料であり authority ではない。NC1 の `withVerifiedReleaseAdmissionLease()` 内で **毎回** current root/history/currentPolicy と protected registry head/revision/hash を独立認証し、snapshot/source/verifier を同時生成する。callback の外へ snapshot/source/candidate を持ち出して許可しない。
- `snapshot.head` と live protected head（`releaseId`, `sequence`, `frontierHash`）、`registryRevision`、`registryStateHash`、`currentPolicyVersion` の全項目を照合する。`TrustedProtocolReleaseAnchorV1.protectedRegistryHead` を署名済み genesis または ancestor post-commit frontier に結び付け、現在 head がその descendant であることを検証する。anchor installation/root key/root policy/genesis も一致必須。
- `finalizeVerifiedProtocolNc1` は、事前の `REENTRY_CANDIDATE` を信用せず、**上記四 lock/guard 内で** protected witness の verified scope/gate/generation/stop/writer frontier を再読・検証し、verified release provider と Core admission を再実行して **完全な protocol candidate** を得る。guard 下の witness 読み取りには **in-transaction** helper を使用し、`readVerifiedScope()`・`witness.readWorkspaceScopeFrontier()` など通常のロック再取得 API は呼ばない。
- Registry guard を保持したまま FDR-011 staging → fsynced journal → witness CAS を完了する。native preimage、protected expectedGlobalFrontier、expectedWriterHash/sequence、`current` revision に不一致があれば `BLOCK`。`preparePublicationUnlocked` による pending advance 後は**同じ installation guard 内で** fresh `scope` revision を再読してから `commitPublicationUnlocked` に渡す（古い `current` は再利用禁止）。`"advanced"` または**同一正規 bytes/op**の `"already_committed"` が保護 witness で確証されるまで成功と呼ばない。
- Guard/locks は **witness CAS が確定した後**だけ解放する（逆順）。通常 Gate dispatch / mutating actions は解放後に別途行う。release commit/rotation が先行したら古い snapshot を利用せず再認証する。NC1 の guarded read/append 中に競合 writer が変更することは同じ protocol-release guard により排除される。
- Pending→journal 書込みの中断または結果不明時は **成功ではない**。専用 recovery は同一 installation→scope→gate→protocol-release 順序で protected pending/committed record、exact stage bytes、writer shard、policy-history/checkpoint、stable operation ID を再検証し、**同一 bytes のみ** CAS 回復（`"already_committed"` 可）する。head/rotation/checkpoint が準備時から変わった場合は `BLOCK` し、古い authority を承認しない。未知の tail を truncate、re-sign、re-ID、再構築してはならない。

#### D3.2：NC1 finalizer の実体・型・durable evidence binding

Owner は `DurableReviewGateEventStore` の新規 **internal** `finalizeVerifiedProtocolNc1` であり、coordinator は通常 `appendEvents` の代わりに**未ロック状態**からこの API を一回呼ぶ。Scope admission は protected callback 内の候補検査を担当し、durable journal/CAS の owner にならない。正常な reentry の動作継続は finalizer 成功応答の後だけ。

```typescript
type VerifiedProtocolNc1Candidate =
  Extract<VerifiedNC1EligibleChangeV1, { readonly kind: "protocol" }>;
type ExpectedNc1WitnessFrontier = Readonly<{
  globalFrontierHash: string;
  writerHash: string;
  writerSequence: number;
  scopeRegistryRevision: number;
  scopeRegistryStateHash: string;
}>;
type ProtocolNc1FinalizeRequest = Readonly<{
  scopeId: string;
  gateId: string;
  writerId: string;
  generationId: string;
  nc1StopEventId: string;
  admissionRequest: ScopeAdmissionRequest; // descriptor/path/workspace を持つ; finalizer が再認証
  expectedEventStoreFrontier: ExpectedNc1WitnessFrontier;
}>;
type ProtocolNc1CompatibilityResult = "COMPATIBLE" | "INCOMPATIBLE" | "INDETERMINATE";
type ProtocolNc1CompatibilityValidationInputV1 = Readonly<{
  domain: "justice-protocol-nc1-compatibility-v1";
  scopeId: string; gateId: string; generationId: string;
  nc1StopEventId: string; phase: "design" | "plan";
  oldRequirementsAuthorityEventId: string;
  newRequirementsAuthorityEventId: string;
  oldRequirementsBindingDigest: string; newRequirementsBindingDigest: string;
  oldContextDigest: string; newContextDigest: string;
  oldGlobalProtocolFingerprint: string; newGlobalProtocolFingerprint: string;
  oldDesignProtocolFingerprint: string; newDesignProtocolFingerprint: string;
  oldPlanProtocolFingerprint: string; newPlanProtocolFingerprint: string;
  observedEventId: string;
  candidate: VerifiedProtocolNc1Candidate; // full signed-release-derived evidence
  checkpoint: VerifiedRegistryCheckpoint;
  expectedWitnessFrontier: ExpectedNc1WitnessFrontier;
  authorizedPolicyDigest: string; // approved registry descriptor/policy identity
}>;
type ProtocolNc1CompatibilityValidationProofV1 = Readonly<{
  validatorId: "PROTOCOL_NC1_COMPATIBILITY_V1";
  validatorVersion: "1"; ruleId: "PHASE_ONLY_SIGNED_RELEASE_V1";
  result: ProtocolNc1CompatibilityResult;
  inputDigest: string; validatorExecutableDigest: string;
  validatorRegistryDigest: string; authorizedPolicyDigest: string;
  observedEventId: string; validationEventId: string;
  witnessFrontierHash: string; checkpointDigest: string;
}>;
type VerifiedProtocolNc1ReleaseObservedPayloadV2 = Readonly<{
  candidate: VerifiedProtocolNc1Candidate; verifiedStop: VerifiedNC1StopV1;
  checkpoint: VerifiedRegistryCheckpoint; publicationOperationId: string;
  expectedWitnessFrontier: ExpectedNc1WitnessFrontier;
}>;
type VerifiedProtocolNc1CompatibilityValidatedPayloadV2 = Readonly<{
  validationInput: ProtocolNc1CompatibilityValidationInputV1;
  proof: ProtocolNc1CompatibilityValidationProofV1;
  observedEventId: string; publicationOperationId: string;
}>;
type VerifiedHostApprovedProtocolNc1ValidatorRegistrationV1 = Readonly<{
  validatorId: "PROTOCOL_NC1_COMPATIBILITY_V1";
  validatorVersion: "1"; ruleId: "PHASE_ONLY_SIGNED_RELEASE_V1";
  executableDigest: string; ruleTableDigest: string;
  validatorRegistryDigest: string; authorizedPolicyDigest: string;
  hostRootAuthorizationProofDigest: string;
}>;
interface VerifiedProtocolNc1ValidatorResolver {
  resolveWithinGuard(
    signedValidatorRegistryDigest: string,
  ): Promise<VerifiedHostApprovedProtocolNc1ValidatorRegistrationV1 | "BLOCK">;
}
type VerifiedProtocolNc1ContextTransitionV1 = Readonly<{
  oldInputs: SemanticContextInputsV1; newInputs: SemanticContextInputsV1;
  observedEventId: string;
  validationEventId: string;
  validationProof: ProtocolNc1CompatibilityValidationProofV1;
  nc1StopEventId: string; generationId: string; phase: "design" | "plan";
  operationId: string;
  verifiedHistoryFrontier: string;
  roundCountersBefore: Readonly<{ design: number; plan: number }>;
  roundCountersAfter: Readonly<{ design: number; plan: number }>;
}>;
interface RegisteredProtocolNc1CompatibilityProducer {
  validateWithinGuard(
    input: ProtocolNc1CompatibilityValidationInputV1,
  ): Promise<ProtocolNc1CompatibilityValidationProofV1 | "BLOCK">;
}
interface VerifiedProtocolNc1TransitionComposer {
  composeWithinGuard(input: Readonly<{
    verifiedScope: VerifiedScopeRead;
    candidate: VerifiedProtocolNc1Candidate;
    verifiedStop: VerifiedNC1StopV1;
    observedProofEventId: string;
    validationEventId: string;
    validationProof: ProtocolNc1CompatibilityValidationProofV1;
  }>): Promise<VerifiedProtocolNc1ContextTransitionV1 | "BLOCK">;
}
type VerifiedProtocolNc1FinalizationEvidence = Readonly<{
  decision: Extract<AdmissionDecision, { readonly kind: "REENTRY_CANDIDATE" }>;
  candidate: VerifiedProtocolNc1Candidate;
  checkpoint: VerifiedRegistryCheckpoint;
  verifiedStop: VerifiedNC1StopV1;
  publicationOperationId: string;
  expectedEventStoreFrontier: ExpectedNc1WitnessFrontier;
  compatibilityInput: ProtocolNc1CompatibilityValidationInputV1;
  validationProof: ProtocolNc1CompatibilityValidationProofV1;
  transition: VerifiedProtocolNc1ContextTransitionV1;
}>;
interface ProtocolNc1FinalizationOwner {
  finalizeVerifiedProtocolNc1(
    request: ProtocolNc1FinalizeRequest,
  ): Promise<"committed" | "already_committed" | "blocked">;
  recoverVerifiedProtocolNc1(
    publicationId: string,
  ): Promise<"committed" | "already_committed" | "blocked">;
}
```

- `ExpectedNc1WitnessFrontier` は scope admission preflight が**認証済み witness frontier**と writer head/`scope` protected revision/hash から生成する。値の受け渡しは expected-value pin にすぎない。finalizer は自分の guard 下で再取得し、**全項目一致**しなければ `BLOCK`。Gate/generation/stop は signed/verified stop と membership に再照合する。`admissionRequest` も workspace/scope paths と署名済み release descriptor に照合し、caller が与えた入力だけでは許可しない。
- `VerifiedProtocolNc1FinalizationEvidence` は finalizer 内で**必ず新しく構築**する。`REENTRY_CANDIDATE` は Core 判定であり、完全な `candidate` の代用にしない。両者の gate/generation/stop/`changeObservedEventId`/frontier を相互照合し、`candidate.beforeReleaseId`/`afterReleaseId`、前後 fingerprint/digest、`verifiedPublisherIdentityDigest`、`authenticatedImmutableReleaseProvenanceDigest`、`protectedProtocolRegistryFrontierHash`、`progressInvalidatedEventId` 等を exact byte binding する。
- `publicationOperationId = computeCanonicalJsonFingerprint({ domain: "justice-protocol-nc1-publication-v1", scopeId, gateId, writerId, generationId, nc1StopEventId, observationOperationId: candidate.observationOperationId })` を採用する。既存 `PreparedWitnessPublicationV1.publicationId` は scope/gate/writer/operationId/newTailDigest に対する**既存の決定式**を使用し、同じ operation ID に異なる bytes/tail が現れたら `BLOCK`。
- **Protocol-only と既存 Requirements validator の境界:** Requirements authority が旧新で同一の正常ケースは、既存 `evaluateSemanticContextCompatibility()` が `incomplete_authority_binding` → `INDETERMINATE` を返す。既存 `SEMANTIC_CONTEXT_COMPATIBILITY_V1` を流用せず、`VerifiedSemanticContextTransitionInput` / `SEMANTIC_CONTEXT_TRANSITION`（`proof.validatorId` が旧 V1 固定）を **protocol-only NC1 では生成しない**。Requirements authority ID の擬似変更も行わない。Requirements-driven semantic transition の旧 schema・イベント・projection は変更しない。
- **新たに提案する独立の登録済み検証契約:** `PROTOCOL_NC1_COMPATIBILITY_V1` / `PHASE_ONLY_SIGNED_RELEASE_V1` は非 agent の deterministic in-process registered validator。権限者が承認した pinned validator descriptor/version, executable digest, rules digest を、host-root 認証した deterministic validation registry に**事前登録**する。`input.authorizedPolicyDigest` と実際に解決された registry entry の digest/実行ハッシュ/validator ID を検証する。**old/new signed releases の `validatorRegistryDigest` は同じ登録済み digest を保持**しなければならず、過去 release に登録情報を後付けしない。未登録・未承認・digest 違い・旧 V1 に対する勝手な fallback は `INDETERMINATE` → `BLOCK`。本書は提案契約であり、Owner の正式規範採用や本番 Task 5 readiness を意味しない。 `VerifiedProtocolNc1ValidatorResolver.resolveWithinGuard(signedValidatorRegistryDigest)` は independently host-root-authorized `VerifiedHostApprovedProtocolNc1ValidatorRegistrationV1` を返す read-only trusted seam とする。registry entry の存在だけでは承認としない。`hostRootAuthorizationProofDigest` と policy/executable/ruleTable digests を host trust anchor に結び付け、old/new manifest の同一 `validatorRegistryDigest` に照合する。
- **決定規則:** `evaluateProtocolNc1CompatibilityV1(input): ProtocolNc1CompatibilityResult` は trusted pure evaluator。`COMPATIBLE` は全条件を満たす場合 **だけ**：(1) same scope/gate/generation/NC1 stop と release phase; (2) old/new Requirements authority event ID・source/Git binding digest・governing reference が完全同一かつ protected witness に一致; (3) old/new context と signed old/new release の phase/global fingerprints が正確に一致し、要求外 phase fingerprint は不変; (4) 要求 phase fingerprint は**変化**、global はその派生として変化可; (5) D7.1 manifest field-level authorization で要求 phase descriptor slice 以外は不変、`promptRegistryDigest`/`validatorRegistryDigest`/`semanticPolicyRegistryDigest`/`verifiedSemanticContractDigest` は同一; (6) root→policy epoch・publisher keys/歴史的 signature・same-phase ancestry・signed source digest・live `VerifiedRegistryCheckpoint`・anchor・expected witness writer/global frontier の全検証が PASS; (7) 観測イベント ID / proof の入力 digest に tamper が無い。正当に署名されても shared semantic change を含むとき `INCOMPATIBLE`、根拠が不明・missing・untrusted のとき `INDETERMINATE`。**finalizer success に採用できるのは `COMPATIBLE` のみ**。これは「Requirements 文書の意味が equivalent」という主張ではなく、署名・policy・phase 範囲内の release transition を独立に認可する狭い述語。
- **Validation proof producer:** `RegisteredProtocolNc1CompatibilityProducer.validateWithinGuard` は protected host-owned in-process runner（AI/worker の文字列を使わない）。scope admission の preflight はヒントのみ。`finalizeVerifiedProtocolNc1` が installation→scope→gate→release guard を取得して verified release candidate と `PROTOCOL_NC1_RELEASE_OBSERVED` の canonical event を確定した後、**同じ guard 内、journal への書込み前**にこの runner を起動する。`ProtocolNc1CompatibilityValidationInputV1` は host から認証済みの Requirements binding、verified effective old/new context、signed release source/digests、complete candidate、live checkpoint、trusted validator registry entry、witness frontier だけから生成する。caller-provided verdict / forged validation event は受理しない。
- **Finalizer の独立検証:** producer は classification + rule/registered executable/policy identity と canonical input digest を計算する。finalizer は別の検証ステップで `evaluateProtocolNc1CompatibilityV1` を**検証済み正規入力から再計算**し、`ProtocolNc1CompatibilityValidationProofV1` の全部（`validatorId`、version、rule、result、inputDigest、executable/registry/policy digests、observedEventId、validationEventId、witness frontier、checkpointDigest）と突合する。`COMPATIBLE` 以外・未登録 policy・不正 proof・再検証不一致は `BLOCK`。`validationEventId` は実際に発行する `PROTOCOL_NC1_COMPATIBILITY_VALIDATED.eventId` と**同一**にし、`observedEventId` は `PROTOCOL_NC1_RELEASE_OBSERVED.eventId` と同一。source of truth は event writer ではなく registered executable と protected witness。
- **Durable event type/schema/順序:** 新しい **V2 typed** `PROTOCOL_NC1_RELEASE_OBSERVED` → `PROTOCOL_NC1_COMPATIBILITY_VALIDATED` → `PROTOCOL_NC1_CONTEXT_TRANSITION` の**3イベントを同一 FDR-011 canonical batch に順序固定**。旧 `SEMANTIC_CONTEXT_TRANSITION` はこの経路で生成しない。(1) OBSERVED は complete `VerifiedProtocolNc1Candidate`、`verifiedStop`、`VerifiedRegistryCheckpoint`、stable publicationOperationId と base witness frontier を保持。(2) VALIDATED は complete `ProtocolNc1CompatibilityValidationProofV1`、canonical `ProtocolNc1CompatibilityValidationInputV1` の fingerprint、`observedEventId` を保持。(3) TRANSITION は `VerifiedProtocolNc1ContextTransitionV1`（**旧 `VerifiedSemanticContextTransitionInput` ではない**）を保持し `observedEventId` と `validationEventId` に exact reference し、old/new `SemanticContextInputsV1` の requirements authority IDs を**同一のまま**保持する。3イベントの `eventId` は一意、`parentEventId` は前項 event ID、scope/gate/generation/epoch/writer はすべて verified scope 内で一致、`operationId` は同一 stable publication ID、同じ writer に strict hash+sequence preimage を要求。3件とも prepared/journal-only 状態では authority とみなさず、**witness CAS が全3件を commit した時点で初めて validation event が durable witnessed proof となり、transition が有効化**する。独立した事前 witnessed validation event は要求しない。
- **Transition/projection の意味:** `PROTOCOL_NC1_CONTEXT_TRANSITION` は**protocol authority のみ**を移行する新規イベントとする。pure V2 projection は event triple の same-batch witness membership・VALIDATED PASS・exact proof references を確認してから、`VerifiedGateTip.lastVerifiedBinding.effective.context` の要求 phase/global protocol fingerprint と protocol source binding を新 release に切替える。`requirements` binding、`requirements.authorityEventId`、`requirements.selectedByEventId`、governing reference、既存 `currentRequirementsAuthorityEventId` は不変。既存 projection の `authorityEventId` に protocol transition event を誤代入して Requirements authority を変えてはならない（必要なら別 `protocolAuthorityEventId` を追跡）。`roundCountersBefore/After` は既存契約と同様同値であり、unproven reset は禁止。`INDETERMINATE`、missing VALIDATED、missing OBSERVED、forged validation、unknown validator ID、単独 transition、別 batch への切離し、incomplete replay はすべて `BLOCK`、成功 reentry なし。
- **認証・承認ゲート:** この3-event/validator 契約は旧 release や旧 semantic proof を書き換えるものではない。registered validator/table の正式 Requirements Owner / Architecture Owner 承認、独立した検証、Task 5 production trust-boundary 承認がない限り production stub は `"BLOCK"`。test-only fixture が正当な登録済み validator を仮 provision して実行できても本番承認に昇格しない。

- Publication は `VerifiedEventPublicationInput` と同等の typed canonical batch を FDR-011 record に組み立てる。新規 `buildPublicationWithinWitnessTransaction(input: VerifiedEventPublicationInput, current: WitnessTransaction): Promise<PublicationDraft>` は `workspaceFrom(current, workspaceIdentity).frontier`、`current.installation.installationId`、`current.hash`、native `readWriterShard()` から verified writer/global preimage・expected installation frontier を導き、通常の `buildPublication()` が行う `witness.readInstallation()` / `readInstallationFrontierHash()` / `observeFrontier()` を callback 内で再実行しない。**通常と専用の build で digest/sequence/operation→publicationId の検査を共有**する。さらに同一 `(scopeId,gateId,writerId,operationId)` に異なる tail/digest が存在すれば pending/committed をまたいで `BLOCK`（publicationId が異なるため見落とさない）。既存の `PreparedWitnessPublicationV1`、`preparePublicationUnlocked`、native `durableReplaceWriterShard`＋directory fsync、`commitPublicationUnlocked` を使う。`publishPreparedJournalUnlocked` は通常 `publishPreparedJournal` の exact stage/signer/terminal verification・native preimage 条件を**共通化して切り出す**。`publicationLockIds` を内部で再実行しない。verification/commit owner のみが in-transaction helper を利用し、公開任意 caller に raw unlocked primitives を渡さない。
- `blocked`（競合/CAS failure/権威不明）は成功イベントなしと判定。prepared tail が存在する場合は未承認として閉塞し、`recoverVerifiedProtocolNc1` の**同一証拠・同一 batch**の idempotent recovery 以外を禁止する。結果不明でも `committed` と推測しない。verified existing committed publication の一致のみ `already_committed`。provider `"BLOCK"` / Task 5 未成立 / reverse lock order / unavailable native / unknown published tail は必ず `"blocked"`。

**FIX-001 で追加した予定ソース/テスト対象（現時点で変更しない）:** `src/core/review-gate/deterministic-validation.ts`（新しい deterministic registered runner）、`src/core/review-gate/event-schema.ts` / `types.ts`（3-event V2 payload）、`src/core/review-gate/projection.ts`（Requirements authority 不変の protocol-only context 適用）、`tests/core/review-gate/deterministic-validation.test.ts`、`tests/core/review-gate/event-schema.test.ts`、`tests/core/review-gate/projection.test.ts`、`tests/runtime/review-gate-protocol-release-integration.test.ts`。既存 `SEMANTIC_CONTEXT_TRANSITION` や Requirements validator の意味は変更しない。

**対象の予定コード（現時点で変更しない）:** `src/runtime/review-gate-event-store.ts`、`review-gate-witness-publication.ts`、`review-gate-witness-context.ts`、`review-gate-publication-record.ts`、`review-gate-scope-admission.ts`、`review-gate-coordinator.ts`、`src/core/review-gate/event-schema.ts`、`src/core/review-gate/types.ts`。既存の FDR-011 journal / CAS 以外に未保護の別 journal は作らない。

### D4：同一 phase・同一 descriptor digest に複数 release が存在する場合の検索規則

`readReleaseByPhaseAndDescriptorDigest()` は以下の規則で一意の結果を決定する。

1. `(phase, releaseDescriptorDigest)` に一致する release を registry から収集する。
2. 該当 release が存在しない場合は `null` を返す。
3. 複数存在する場合は、保護された履歴において現在の head に到達可能な release のみを候補とする。
4. 候補が複数残る場合は、最も head に近い release（chain の末端）を選択する。
5. それでも一意に決定できない場合、または無効・未承認の release が含まれる場合は `null` を返し、provider 側で `"BLOCK"` とする。

無条件に「最新」を選択せず、保護された履歴と承認状態に基づく決定的な選択、または安全な失敗を優先する。


#### D4.1：snapshot、policy history、historical signature verifier の契約（RG-PHASE-002）

**採用構成:** privileged registry verifier が host-root-authorized policy history を検証して `VerifiedReleaseSnapshot` を返し、Task 4 の pure source と historical verifier の**両方**を同一 snapshot から生成する。外部の任意の verifier・key resolver には依存しない。`publisherKeyDigest` は信頼できる SPKI DER 公開鍵の SHA-256（lowercase 64 hex）。

```typescript
type VerifiedPublisherPolicyEpoch = Readonly<{
  version: string;
  previousVersion: string | null;    // root epoch は null
  publisherPublicKeyPem: string;      // host-root-authorized Ed25519 SPKI PEM
  publisherKeyDigest: string;         // SHA-256(SPKI DER)
  verifiedSemanticContractDigest: string;
  rotationReference: string | null;
  authorizedAtHead: ReleaseHead;      // host-signed expectedProtectedReleaseHead
}>;
type VerifiedCommittedRelease = Readonly<{
  manifest: ReleaseManifest;
  publisherSignature: string;
  installerSignature: string;
  sourceBytesBase64: string;          // exact bytes; mutable Uint8Array を公開しない
  sequence: number;
  postCommitHead: ReleaseHead;
  effectivePolicyVersion: string;
}>;
type VerifiedReleaseSnapshot = Readonly<{
  installationId: string;
  signedRoot: Readonly<{
    installationId: string;
    trustPolicyVersion: string;
    publisherPublicKeyPem: string;
    initialFrontierDigest: string;
  }>;
  trustedAnchor: TrustedProtocolReleaseAnchorV1;
  policyHistory: readonly VerifiedPublisherPolicyEpoch[]; // root→current
  committedReleases: readonly VerifiedCommittedRelease[]; // oldest→newest
  head: ReleaseHead;
  registryRevision: number;
  registryStateHash: string;
  currentPolicyVersion: string;
}>;
interface VerifiedProtocolReleaseSource {
  readRegistryHead(): Promise<string | null>;   // guarded snapshot head のみ
  readRelease(id: string): Promise<ProtocolReleaseRecordV1 | null>;
  readReleaseByPhaseAndDescriptorDigest(
    phase: VerifiedProtocolReleasePhase,
    releaseDescriptorDigest: string,
  ): Promise<ProtocolReleaseRecordV1 | null>;
}
```

`ProtocolReleaseRecordV1` は既存の exact bytes SHA-256 `descriptorDigest` を維持し、`releaseDescriptorDigest: string`、`verifiedSemanticContractDigest: string`、`manifest: ReleaseManifest`、`effectivePolicyVersion: string` を追加する。必須 invariant は `descriptorDigest === manifest.sourceDigest`、`releaseDescriptorDigest === manifest.releaseDescriptorDigest`、`effectivePolicyVersion === manifest.trustPolicyVersion`、`registryHead === postCommitHead.frontierHash`。

責務とデータの流れ：

1. **Task 3 / privileged verifier** は host-signed release root と rotation proof を root→current の順に検証し、`previousVersion` と署名時 `authorizedAtHead` の chain continuity、rotationReference、policy version の一意性、PEM の Ed25519 key type・SPKI DER digest、policy epoch ごとの semantic contract digest を確認する。rotation は release frontier を変更しない場合があるが `registryRevision` と `registryStateHash` は更新される。各 release の effective epoch は **その release の commit 時点で有効かつ host-authorized だった** `manifest.trustPolicyVersion` で一意に決まる。未来の policy を古い release に遡及適用禁止。
2. **Task 4 / pure source** は snapshot 内の authenticated `committedReleases` だけを index する。公開鍵の resolver、guard、registry mutation は持たない。`record.publisherKeyDigest` は verified epoch からのみ導出する。`readRegistryHead()` は snapshot head に過ぎず、live freshness は D3.1 の trusted host が保証する。
3. **Task 5 / historical verifier** は `createVerifiedHistoricalPublisherSignatureVerifier(snapshot): VerifiedProtocolReleaseSignatureVerifier` を提供し、既存の `(domain, payload, signature, publisherKeyDigest)` 引数形を維持する。`payload` が当該 release の署名済み `manifest` に一致し、その `trustPolicyVersion` → verified epoch → verified PEM によって Ed25519 署名を検証する。caller が渡した `publisherKeyDigest` は verified DER digest と**照合する値**であり trust root ではない。任意の caller-provided PEM、fallback current publisher key、未認証 epoch を使わない。
4. **Task 6 / provider** は D3.1/D3.2 の **installation→scope→gate→release の guarded NC1 finalization callback 内**で**同一 snapshot**由来の source、verifier、trusted anchor を受け取る。anchor の installation、root publisher digest、initial genesis frontier、root policy version、minimum anchored frontier を protected history と比較する。NC1 の `input.trustedPublisherPolicyVersion` は **snapshot.currentPolicyVersion** に一致させる（rotation 後の root version を強制しない）。異なる snapshot 同士の source/verifier 組合せや caller の digest の自己認証を禁止。

追加テスト：root publisher の旧 release、正当 rotation 後の新鍵 release、旧鍵の再検証、未登録鍵、偽造 rotation、skipped policy epoch、公開鍵/digest 不一致、release epoch と署名者の不一致。

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


#### D7.1：signed manifest 変更分類と phase-scoped authorization（RG-PHASE-003）

**署名が正当であることと、単一 phase の変更が許可されることは別の判定。** 全 manifest/policy/history の真正性検証の後、old/new の signed semantic fields を次表で分類する。本版では registry 単体 digest から内部構造を復元できず、外部 registry impact proof も導入しないため、影響範囲が証明できない registry digest 変更は **BLOCK** とする。

| Signed manifest field | 分類 | Phase-only NC1 の確定規則 |
| --- | --- | --- |
| `phase` | 不変条件 | old/new とも要求 phase に一致必須。他 phase の中間 ancestry は認証を条件に許可 |
| `installationId` | 不変条件 | independently authenticated installation と全 release で一致 |
| `publicationOperationId`, `releaseId`, `parentReleaseId`, `expectedProtectedReleaseHead` | 独立認証済み publication/chain metadata | 値は更新可、CAS と chain/head replay、操作の一意性を検証 |
| `sourceDigest`, `releaseDescriptorDigest` | digest/integrity invariant | 更新可だが exact bytes / signed semantic descriptor とそれぞれ一致必須 |
| `descriptor.designPhase` / `descriptor.planPhase` | 要求 phase 固有 semantic change | 要求 phase の slice のみ変化可。要求外 slice は不変 |
| `descriptor.crossPhase`, `descriptor.requirementsResolutionPolicyVersion`, `descriptor.authorityPolicy` | Shared/global semantic change | 値が変化すれば **BLOCK** |
| `reviewProtocolFingerprint`, `designProtocolFingerprint`, `planProtocolFingerprint` | 派生値の不変条件 | 各 release の signed semantic digest で再計算。要求 phase fingerprint だけ old/new で変化可。global の追随変化は許容 |
| `promptRegistryDigest` | Phase-only として認証不能な registry metadata | **値が変化した場合 BLOCK**。digest だけでは design/plan 限定を証明不能 |
| `validatorRegistryDigest` | Shared/global または範囲不明 | **値が変化した場合 BLOCK** |
| `semanticPolicyRegistryDigest` | Shared/global または範囲不明 | **値が変化した場合 BLOCK**（descriptor 外の共有 policy も含む） |
| `verifiedSemanticContractDigest` | Shared/global semantic change | **old/new で変化した場合 BLOCK**。歴史的に真正でも phase-only 許可にはならない |
| `trustPolicyVersion`, `keyRotationReference` | 独立に認証された publisher trust metadata | host-root-authorized contiguous rotation のみ更新可。semantic digest は不変必須。key rotation だけでは NC1 許可を生成しない |
| `releaseAuthority.schemaVersion` | 不変条件 | current verified schema と完全一致。既存 signed release の暗黙変更禁止 |
| `releaseAuthority.trustedPublisherPolicyVersion` | 独立認証済み trust metadata | 各 manifest の `trustPolicyVersion` と一致必須。空文字 sentinel 不許可。実行時は live effective policy と照合 |

**Positive path:** old/new の signed descriptor が要求 phase slice **だけ**異なり、非対象 slice・shared fields・3 registry digests・`verifiedSemanticContractDigest` が不変で、D1–D7 の署名、protected history、policy epoch、live freshness、same-phase ancestry および NC1 finalization CAS が通った場合のみ phase-only candidate を許可できる。phase 専用 prompt 変更でも `promptRegistryDigest` が変わるなら、本版では **BLOCK**（将来の phase-impact proof 導入は別途設計審査）。

| テストシナリオ | Publication/history | Phase-only NC1 |
| --- | --- | --- |
| Design slice だけ変更（3 registry/semantic digest は不変） | 正当な署名なら受理可能 | すべての証拠一致で成功 |
| Plan slice だけ変更（上記同様） | 正当な署名なら受理可能 | すべての証拠一致で成功 |
| Design + shared policy / Plan + shared policy | 独立承認済み publication なら受理可能 | **BLOCK** |
| Publisher key **だけ**正当に rotation、semantic digest 不変 | rotation は受理可能 | phase fingerprint 差分がないため candidate `null`、承認 event 無し |
| Verified semantic contract digest が変更、history は正当 | historical release は再検証可能 | **BLOCK** |
| prompt/validator/semanticPolicy registry digest のみ変更 | 署名済み history の検証とは独立 | **BLOCK** |
| descriptor に現れない shared registry 変更 | 同上 | **BLOCK** |

Task 2 の semantic contract version 更新テストは **signed publication / historical re-verification** のみの正常系である。Task 8 の phase-only NC1 正常系では **semantic contract digest を固定**し、Task 7 の global/phase fingerprint 分類は provider 判定の**前段**とする。署名が通っただけで phase-only の authorization を推定してはならない。

#### D7.2：非承認 sentinel と signed publication fixture（RG-PHASE-004）

`createReviewGateProtocolDescriptor()` の既定 `releaseAuthority.trustedPublisherPolicyVersion = ""` は **未認証・未承認**を意味する sentinel とし、`releaseManifestSchema` の `id` validation を**変更せず**空値を reject する。`createReviewGateProtocolDescriptor({ trustedPublisherPolicyVersion: "policy-1" })` のように signed publication fixture は **テスト内で独立に provision・検証した実際の publisher policy version** を明示し、`manifest.trustPolicyVersion` と一致させる。placeholder や fallback policy version を自動補完しない。production Task 5 が成立しない場合は sentinel のまま、実 release は発行不可、NC1 adapter は `"BLOCK"`。sentinel reject と valid fixture success は異なるテストで証明する。

## 追加で解決すべき不整合

### 1. scope-admission の global/phase fingerprint 判定順序

`src/runtime/review-gate-scope-admission.ts` の `changedDimension()` は現在 global fingerprint を先に判定するため、通常の design/plan 変更も `global_protocol` として誤って拒否される。変更の影響範囲を分類してから承認対象 phase に対応させる必要がある。

### 2. 署名対象の不一致

publication 側は署名済み `manifest` を認証する。authority 側の `releaseSignaturePayload()` は異なる envelope を署名対象としている。両者を統一し、provider は検証済み manifest と保護された履歴から `ProtocolReleaseRecordV1` 相当の情報を導出する。

### 3. phase 付き検索 API

`readReleaseByDescriptorDigest` を置き換え、phase を引数に取る検索 API が必要。read-only source の live freshness は D3.1 の guard 内に限定する。

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
- R2 Fresh Independent Review の処置: `RG-PHASE-002〜004` は **RESOLVED（静的文書レビューに限定）**、再オープンしない。`RG-PHASE-001` は **PARTIALLY RESOLVED / BLOCKER** のままで、既受理の D3.1 lock/FDR-011 契約を変更しない。D3.2 FIX-001 の登録済み protocol validator / durable proof producer だけを限定修正した。**Fresh Independent Limited Recheck が次のゲート**。正式承認・実装許可・Task 5 成立を意味しない。
- 上記の統合契約が検証されるまでは、`opencode-adapter.ts` の fail-closed stub を維持する。
- Task 5 の信頼境界が成立し、受入条件が実証されるまでは real provider の有効化は行わない。
