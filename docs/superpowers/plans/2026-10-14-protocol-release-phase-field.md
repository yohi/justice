# Protocol Release Phase-Scoped Authority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the protocol release manifest, independently trusted publication registry, historical authority provider, and NC1 phase admission use one verifiable phase-scoped release contract without weakening fail-closed behavior.

**Architecture:** Keep privileged publication/witness-store operations separate from a read-only, authenticated registry snapshot and provider. Each signed manifest identifies one phase, exact source bytes, a semantic descriptor digest, and the release-time semantic contract; the verified protected history derives post-commit heads, predecessor relationships, and authorized publisher keys. The provider uses only those derived records inside a live protected-registry admission guard and blocks stale snapshots, ambiguous phase ancestry, shared-policy changes, or missing Task 5 authority. The NC1 dedicated publication owner acquires installation → scope → gate → protocol-release once, revalidates complete NC1 evidence under these guards, and commits the existing witness journal/CAS before releasing them.

**Tech Stack:** TypeScript, Bun, Vitest, Zod, Node.js Ed25519, existing `ProtectedWitnessStore` and canonical JSON fingerprint helpers.

**Spec:** `docs/decisions/2026-10-14-protocol-release-phase-field.md` (Option A, D1–D7, AC-01–AC-12), branch `docs/protocol-release-phase-field`.

## Global Constraints

- **Decision gate:** The spec is design-reviewed but not a formal Requirements Owner / Architecture Owner authorization. Do not start implementation or enable the real provider until applicable owner approvals and independent review gates are satisfied.
- **Release authorization:** `phase` is the *top-level* signed manifest scope, exactly `"design" | "plan"`. Do not derive phase from the descriptor; do not add a phase parameter to `rotatePublisherTrustPolicy()` or `commitPreparedProtocolReleaseCAS()`.
- **Digest semantics:** `sourceDigest` and `ProtocolReleaseRecordV1.descriptorDigest` are SHA-256 of exact source bytes; `releaseDescriptorDigest` is `computeCanonicalJsonFingerprint({ descriptor, verifiedSemanticContractDigest })`. Never substitute one for the other.
- **History:** `registryHead` for a release is the **post-commit** `frontierHash`. Verify complete chain and independently pinned `TrustedProtocolReleaseAnchorV1.protectedRegistryHead` ancestry; an unanchored/stale registry head blocks.
- **Live authority:** Per NC1 finalization acquire installation guard → scope lock → gate lock → `ProtectedWitnessStore.withGuard("protocol-release", ...)` **exactly once** in that order, rebuild snapshot inside, verify full `(head, revision, stateHash, effectivePolicyVersion)`, and commit the canonical NC1 V2 event batch via FDR-011 staging/fsync/witness CAS before releasing guards. Do not invoke ordinary event-store/witness APIs that reacquire these locks, and do not authorize from a cached snapshot.
- **Historical verification:** Recompute old fingerprints with the semantic contract digest stored in *that release's signed manifest*, not the present runtime digest.
- **Signatures:** Publisher and installer authenticate the exact canonical `manifest` used by publication; do not introduce a second signature envelope. Key rotation requires contiguous host-root-authorized policy epochs with a verified PEM/SPKI DER digest; caller-provided key digest is never trust authority.
- **Phase scope:** Authenticate the whole manifest, then authorize the phase delta separately using spec D7.1. Phase-only requires unchanged `promptRegistryDigest`, `validatorRegistryDigest`, `semanticPolicyRegistryDigest`, `verifiedSemanticContractDigest`, shared descriptor fields and opposite-phase slice. Digest-only registry changes BLOCK; authorized key-only rotation does not itself create NC1 eligibility.
- **Sentinel:** Default `trustedPublisherPolicyVersion: ""` is untrusted; signed publication fixture MUST pass its independently provisioned policy version explicitly. No production default promotion.
- **Phase lineage:** For `newRelease`, `oldRelease` must be its closest earlier **same-phase** release along the complete chain; cross-phase entries remain authenticated ancestors but cannot substitute for same-phase predecessors.
- **Migration:** Reject pre-change signed manifests lacking the new required fields. No default phase, inferred digest, in-place signature rewrite, or silent migration. Any historic release conversion needs separate explicit V2 reissuance/migration approval.
- **Trust boundary:** Do not expose a registry write capability from the authority source. Until Task 5 trusted anchor/protected registry is actually independently provisioned and demonstrated, keep `opencode-adapter.ts`'s `"BLOCK"` stub.
- **Engineering:** Preserve existing core/runtime separation, immutable public snapshots, bounded/redacted errors, durable CAS and protected guard behavior. Use Bun in the configured devcontainer. Do not push from Review Gate operations.

## Review Focus

These are high-risk inputs the spec implies; each is pinned to an owning task's tests:

1. **Two signed releases share an identical descriptor but have different phases:** lookup selects only the requested phase; Task 4.
2. **A publisher policy is legitimately rotated while an earlier release remains in the chain:** old proof remains valid, forged/skipped rotation blocks; Tasks 2 and 6.
3. **`design → plan → design` ancestry with a missing or substituted intervening link:** resolve the immediate same-phase predecessor through the full chain, otherwise `"BLOCK"`; Task 6.
4. **Runtime validation semantics change after an older release was signed:** older release verifies with its archived digest, not the new runtime; Task 2.
5. **Global fingerprint changes as a consequence of a one-phase edit versus a shared policy edit:** first can be considered for phase verification; the latter blocks even if only one phase fingerprint changes; Tasks 6–7.
6. **Stale snapshot or publisher rotation between read and final admission append:** any old checkpoint blocks, guarded commit cannot race the append; Tasks 3, 6–8.
8. **Nested ordinary witness publication while scope/gate are held:** the non-reentrant lock graph must use a single dedicated owner with shared unlocked integrity/CAS primitives, otherwise BLOCK; Tasks 7–8.
7. **Unsigned registry-only delta or changed semantic contract digest:** even correctly signed publication cannot grant phase-only NC1; Tasks 2, 6–8.

## File Map

| Responsibility | Files |
| --- | --- |
| Manifest shape and canonical digest contract | `src/runtime/review-gate-release-schema.ts`, `src/runtime/review-gate-protocol.ts` |
| Signed trust policy, historical evidence validation | `src/runtime/review-gate-release-verification.ts` |
| Privileged registry, immutable verified read snapshot, frontier derivation | `src/runtime/review-gate-protocol-release-publication.ts` |
| Read-only phase source, signature and old/new proofs, lineage verification | `src/runtime/review-gate-protocol-release-authority.ts` |
| NC1 protocol dimension classification | `src/runtime/review-gate-scope-admission.ts` |
| Hard Task 5 fail-closed production boundary | `src/runtime/opencode-adapter.ts` |
| Focused tests | `tests/runtime/review-gate-protocol.test.ts`, `tests/runtime/review-gate-protocol-release-publication.test.ts`, `tests/runtime/review-gate-protocol-release-authority.test.ts`, `tests/runtime/review-gate-scope-admission.test.ts`, `tests/runtime/review-gate-scope-admission-nc1.test.ts`, `tests/runtime/opencode-adapter-v2.test.ts` |
| NC1 protected publication owner | `src/runtime/review-gate-event-store.ts`, `src/runtime/review-gate-witness-publication.ts`, `src/runtime/review-gate-witness-context.ts`, `src/runtime/review-gate-publication-record.ts`, `src/core/review-gate/event-schema.ts`, `src/core/review-gate/types.ts` |
| NC1 finalization composition | `src/runtime/review-gate-coordinator.ts`, `src/runtime/review-gate-scope-admission.ts`; new `tests/runtime/review-gate-protocol-release-integration.test.ts` |

---

### Task 1: Signed Phase Manifest and Canonical Identity (D1, D2, D7; AC-01–AC-03, AC-11)

**Files:**
- Modify: `src/runtime/review-gate-release-schema.ts`
- Modify: `src/runtime/review-gate-protocol.ts`
- Test: `tests/runtime/review-gate-protocol.test.ts`
- Test: `tests/runtime/review-gate-protocol-release-publication.test.ts`

**Interfaces:**
- Produce: `export type ReleaseManifest = z.infer<typeof releaseManifestSchema>`.
- Produce: `createReviewGateProtocolDescriptor(options?: Readonly<{ trustedPublisherPolicyVersion?: string }>): ReviewGateProtocolDescriptor`; default empty sentinel is NEVER signed. All tests publishing a release must use the independently provisioned effective policy version.
- Produce: `computeReleaseDescriptorDigest(descriptor: ReviewProtocolDescriptorV1, verifiedSemanticContractDigest: string): string`.
- Produce: `computeCurrentSemanticContractDigest(): string` as the explicitly named current-runtime semantic digest (rename/export the existing private deterministic-validation digest function).
- Retain: `computeReviewGateProtocolFingerprints(descriptor, semanticContractDigestOverride?)`. The optional override is required for historical validation.

- [ ] **Step 1: Write failing tests.** Assert `releaseManifestSchema.safeParse` rejects missing/unknown `phase`, missing `verifiedSemanticContractDigest`, and absent `releaseDescriptorDigest`; valid `design` and `plan` manifest shapes parse. Relational digest *mismatch* is tested through authenticated publication in Task 2 (not a Zod shape check). Assert `computeReleaseDescriptorDigest(d, s) === computeCanonicalJsonFingerprint({ descriptor: d, verifiedSemanticContractDigest: s })` and differs if `s` changes. Keep input fixture source bytes separate from descriptor digest.
- [ ] **Step 2: Run RED.** `bunx vitest run tests/runtime/review-gate-protocol.test.ts tests/runtime/review-gate-protocol-release-publication.test.ts`. Expected: new schema/digest cases fail.
- [ ] **Step 3: Implement schema and pure digest helper.** In `releaseManifestSchema` make `phase: z.enum(["design", "plan"])`, `releaseDescriptorDigest` and `verifiedSemanticContractDigest` mandatory. Export `ReleaseManifest`. Keep `sourceDigest` unchanged; do not derive phase from `designPhase` or `planPhase`.
- [ ] **Step 4: Align runtime descriptor identity.** Replace the current `{ domain, descriptor, deterministicValidationSemanticContract }` release digest calculation with the D7 exact two-property payload. Do not infer publisher trust-policy version from `descriptor.authorityPolicy.current`. Use `createReviewGateProtocolDescriptor(options?: Readonly<{ trustedPublisherPolicyVersion?: string }>): ReviewGateProtocolDescriptor` and set `releaseAuthority.trustedPublisherPolicyVersion` to `options?.trustedPublisherPolicyVersion ?? ""` (fail-closed sentinel). Assert no-argument output uses `""` and `releaseManifestSchema` rejects the empty sentinel. For signed publication fixtures construct `createReviewGateProtocolDescriptor({ trustedPublisherPolicyVersion: verifiedPolicyVersion })`, where `verifiedPolicyVersion` comes from the fixture's host-root-provisioned policy (e.g. `"policy-1"`), and require `manifest.releaseAuthority.trustedPublisherPolicyVersion === manifest.trustPolicyVersion`. The provided string is never accepted as authority by itself: Task 6 verifies it against the independently authenticated effective publisher policy.
- [ ] **Step 5: Run GREEN.** Same targeted Vitest command; expected: PASS. Run `bun run typecheck`; update direct callers/fixtures whose types require the new mandatory manifest fields, without weakening validation. In separate tests assert default sentinel fails publication while explicit host-root-provisioned fixture version succeeds; never substitute a production fallback.
- [ ] **Step 6: Commit.** `git add src/runtime/review-gate-release-schema.ts src/runtime/review-gate-protocol.ts tests/runtime/review-gate-protocol.test.ts tests/runtime/review-gate-protocol-release-publication.test.ts && git commit -m "feat(review-gate): define signed phase release identity"`

### Task 2: Trusted Semantic Contract and Historical Verification (D7; AC-03, AC-09, AC-11)

**Files:**
- Modify: `src/runtime/review-gate-release-verification.ts`
- Modify: `src/runtime/review-gate-release-schema.ts`
- Modify: `src/runtime/review-gate-protocol-release-publication.ts`
- Test: `tests/runtime/review-gate-protocol-release-publication.test.ts`

**Interfaces:**
- Consume: `ReleaseManifest`, `computeReleaseDescriptorDigest`, `computeReviewGateProtocolFingerprints(descriptor, verifiedSemanticContractDigest)`, and the root-authorized `verifiedSemanticContractDigest` for the selected historical policy epoch.
- Preserve: `createReleaseVerification(...).verifyEvidence(state, input, installationId, requireCurrentPolicy?)`.
- Produce: Signed policy/root-bound `verifiedSemanticContractDigest`: provisioned root policy pins its approved semantic digest; an authorized policy revision/rotation pins the next digest. Every release cites the digest authorized by its signed policy epoch.

- [ ] **Step 1: Write failing tests.** Signed publication with an invented semantic digest blocks; wrong `releaseDescriptorDigest` blocks; mutated descriptor with unchanged digest blocks. After a host-authorized policy/digest revision, `registry.readHead()` still validates an older signed release against its *original* digest while checking a newer release against its newer approved digest. A missing digest in a legacy signed manifest blocks without reconstruction. Explicitly distinguish signed publication/historical verification success after an authorized semantic-contract epoch update from phase-only NC1: changed old/new semantic digests must BLOCK in Task 6/8.
- [ ] **Step 2: Run RED.** `bunx vitest run tests/runtime/review-gate-protocol-release-publication.test.ts`; expected: new tamper/history tests fail.
- [ ] **Step 3: Bind verified semantic digest to host authorization.** Extend signed `releaseAnchorSchema` and `policySchema`/authorized rotation payload with `verifiedSemanticContractDigest: string` (digest schema); update `provisionProtocolReleaseRegistry` and `rotatePublisherTrustPolicy` to require it from the independently approved trust configuration. No phase parameter. Do not accept a bare manifest-supplied value as its own authorization.
- [ ] **Step 4: Validate each manifest against its signed policy epoch.** In `verifyEvidence` require `manifest.verifiedSemanticContractDigest === policy.verifiedSemanticContractDigest`, `manifest.releaseDescriptorDigest === computeReleaseDescriptorDigest(manifest.descriptor, manifest.verifiedSemanticContractDigest)`, and compute all three fingerprints with `manifest.verifiedSemanticContractDigest`. Verify source SHA-256 and both signatures over the exact manifest as before. Publication tests must specify `createReviewGateProtocolDescriptor({ trustedPublisherPolicyVersion: hostVerifiedEpoch.version })`; reject default `""` and require `manifest.releaseAuthority.trustedPublisherPolicyVersion === manifest.trustPolicyVersion`.
- [ ] **Step 5: Run GREEN.** `bunx vitest run tests/runtime/review-gate-protocol-release-publication.test.ts` and `bun run typecheck`; expected: PASS.
- [ ] **Step 6: Commit.** `git add src/runtime/review-gate-release-schema.ts src/runtime/review-gate-release-verification.ts src/runtime/review-gate-protocol-release-publication.ts tests/runtime/review-gate-protocol-release-publication.test.ts && git commit -m "feat(review-gate): authenticate historical semantic contracts"`

### Task 3: Verify Protected History and Post-Commit Frontier (D3; AC-05)

**Files:**
- Modify: `src/runtime/review-gate-release-verification.ts`
- Modify: `src/runtime/review-gate-protocol-release-publication.ts`
- Test: `tests/runtime/review-gate-protocol-release-publication.test.ts`

**Interfaces:**
- Consume: `current()`'s validated `ReleaseRegistry` and `head`.
- Produce: `readVerifiedReleaseSnapshot(trustedAnchor: TrustedProtocolReleaseAnchorV1): Promise<VerifiedReleaseSnapshot>` for read-only diagnostics and `readVerifiedReleaseSnapshotWithinGuard(trustedAnchor): Promise<VerifiedReleaseSnapshot>` for D3.1 guarded admission (internal; never acquire the guard recursively). Both validate anchor against signed root/full history; they cannot accept an unproven caller anchor as authority. `VerifiedReleaseSnapshot` is **exactly** the type in spec D4.1: `installationId`, signed root, `trustedAnchor`, `policyHistory: readonly VerifiedPublisherPolicyEpoch[]`, `committedReleases: readonly VerifiedCommittedRelease[]`, `head`, `registryRevision`, `registryStateHash`, `currentPolicyVersion`. Each immutable release carries `sourceBytesBase64`, not a mutable byte array.
- Produce: `VerifiedRegistryCheckpoint = { head, registryRevision, registryStateHash, currentPolicyVersion }` (spec D3.1), so policy rotation is visible even without a release frontier change. `TrustedProtocolReleaseAdmissionHost.withVerifiedReleaseAdmissionLease` takes a callback only when the **caller already holds installation/scope/gate**, acquires only the release guard and never reacquires witness publication locks.
- Protected link formula: `computeCanonicalJsonFingerprint({ previous: previousFrontierHash, manifest })`, exactly matching the existing commit code; genesis starts at signed `anchor.initialFrontierDigest`.

- [ ] **Step 1: Write failing tests.** A two-release chain yields per-release frontiers matching the heads returned immediately after each commit. Tampering a historical parent, committed manifest, frontier link, or latest head blocks snapshot/read; a missing ancestor and a stale-but-signed branch block. Verify pending entries are not returned as committed. Independently anchored minimum frontier must be an ancestor of current replayed head; a stale/broken pinned frontier blocks. A rotation after an earlier snapshot changes state revision/hash even if release head does not change.
- [ ] **Step 2: Run RED.** `bunx vitest run tests/runtime/review-gate-protocol-release-publication.test.ts`; expected: new history/snapshot tests fail.
- [ ] **Step 3: Implement full ancestry/frontier replay.** In `current()` start from the host-authenticated genesis frontier and deterministically replay signed manifests in chain order; require exact parent id, expected head (`releaseId`/`sequence`/`frontierHash`), one-to-one membership, and final equality with protected registry head. Reject cycles, forks, missing records, and head rollback. Replay host-root-authorized `policyHistory` root→current; for each release bind the `effectivePolicyVersion` to the policy epoch authorized **at its commit**, not a later policy. Check signed rotation `authorizedAtHead`, `previousVersion`, PEM/SPKI DER digest, and semantic digest. Match `trustedAnchor` installation, root key digest/version, genesis, and minimum pinned frontier.
- [ ] **Step 4: Expose the guarded read-only snapshot.** Add `readVerifiedReleaseSnapshot()` under the existing `store.withGuard("protocol-release", ...)`; produce immutable cloned/frozen values only after `current()` succeeds. Snapshot is **not fresh authority** after guard release; never cache for admission. The guarded builder must not reacquire the same guard. No caller receives `store`, registry mutation functions, or unverified in-memory maps.
- [ ] **Step 5: Run GREEN.** Targeted publication Vitest + `bun run typecheck`; expected: PASS.
- [ ] **Step 6: Commit.** `git add src/runtime/review-gate-release-verification.ts src/runtime/review-gate-protocol-release-publication.ts tests/runtime/review-gate-protocol-release-publication.test.ts && git commit -m "feat(review-gate): prove release frontiers from protected history"`

### Task 4: Phase-Indexed, Read-Only Registry Source (D2–D4; AC-01, AC-02, AC-05)

**Files:**
- Modify: `src/runtime/review-gate-protocol-release-authority.ts`
- Modify: `src/runtime/review-gate-protocol-release-publication.ts`
- Test: `tests/runtime/review-gate-protocol-release-authority.test.ts`
- Test: `tests/runtime/review-gate-protocol-release-publication.test.ts`

**Interfaces:**
- Consume: Task 3's exact `VerifiedReleaseSnapshot`, `VerifiedPublisherPolicyEpoch`, `VerifiedCommittedRelease`, and `VerifiedRegistryCheckpoint` (spec D3.1/D4.1); no independent fetch/cache by the source.
- Extend `ProtocolReleaseRecordV1` with `releaseDescriptorDigest: string`, `verifiedSemanticContractDigest: string`, `manifest: ReleaseManifest`, `effectivePolicyVersion: string`; retain `descriptorDigest === manifest.sourceDigest`, exact `canonicalDescriptorBytes`, and `registryHead === postCommitHead.frontierHash`.
- Replace `VerifiedProtocolReleaseSource.readReleaseByDescriptorDigest` with `readReleaseByPhaseAndDescriptorDigest(phase: VerifiedProtocolReleasePhase, releaseDescriptorDigest: string): Promise<ProtocolReleaseRecordV1 | null>`. Preserve `readRegistryHead()` and `readRelease(id)`.
- Produce: `createRegistryBackedVerifiedProtocolReleaseSource(snapshot: VerifiedReleaseSnapshot): VerifiedProtocolReleaseSource`: pure read-only index over Task 3's authenticated snapshot. `readRegistryHead()` is **snapshot head only**, not live freshness; it can be used for NC1 only inside D3.1's matching `GuardedProtocolReleaseRead` callback.
- Derived record `registryHead` is its post-commit frontier, and `ancestorReleaseIds` is the validated predecessor chain across *all* phases.

- [ ] **Step 1: Write failing tests.** With `design` and `plan` releases having the same `releaseDescriptorDigest`, each phase query returns its corresponding signed record. A missing phase/digest pair returns `null`. Duplicate same-phase identities select the reachable candidate nearest the verified head; an ambiguous/invalid candidate or unverified release returns `null`. Exact `readRelease(id)` returns its signed phase, post-commit head, source SHA, and verified semantic digest. Passing a snapshot from before another release commit or policy rotation may produce a historical read result but MUST NOT produce NC1 admission success; verify stale checkpoint rejection in Task 8.
- [ ] **Step 2: Run RED.** `bunx vitest run tests/runtime/review-gate-protocol-release-authority.test.ts tests/runtime/review-gate-protocol-release-publication.test.ts`; expected: new source/index cases fail.
- [ ] **Step 3: Map verified snapshot to records.** Build immutable records only from authenticated committed manifest, decoded exact `sourceBytesBase64`, matching `effectivePolicyVersion` / `policyHistory` PEM-derived SHA-256(SPKI DER), and replayed frontier. Do not synthesize `phase` from query input or sign a post-commit field absent from the original manifest.
- [ ] **Step 4: Implement deterministic phase+semantic digest lookup.** Resolve candidates using verified ancestry/head reachability and reject duplicates whose signed identity, authorization, or ordering cannot be uniquely proven. Do not use an unqualified "latest".
- [ ] **Step 5: Run GREEN.** Targeted Vitest + `bun run typecheck`; expected: PASS.
- [ ] **Step 6: Commit.** `git add src/runtime/review-gate-protocol-release-authority.ts src/runtime/review-gate-protocol-release-publication.ts tests/runtime/review-gate-protocol-release-authority.test.ts tests/runtime/review-gate-protocol-release-publication.test.ts && git commit -m "feat(review-gate): expose phase-indexed verified release source"`

### Task 5: Unify Publisher Signature and Historical Proof (D5; AC-01, AC-04)

**Files:**
- Modify: `src/runtime/review-gate-protocol-release-authority.ts`
- Test: `tests/runtime/review-gate-protocol-release-authority.test.ts`

**Interfaces:**
- Consume: `ProtocolReleaseRecordV1.manifest`, signed `publisherSignature`, `VerifiedReleaseSnapshot.policyHistory`, matching historical `effectivePolicyVersion`, approved Ed25519 SPKI PEM/key digest, and Task 3-derived frontiers.
- Preserve: `VerifiedProtocolReleaseSignatureVerifier(input: { domain: string; payload: unknown; signature: string; publisherKeyDigest: string }): Promise<boolean>`. Its `payload` MUST equal `record.manifest`.
- Produce: `createVerifiedHistoricalPublisherSignatureVerifier(snapshot: VerifiedReleaseSnapshot): VerifiedProtocolReleaseSignatureVerifier` (spec D4.1). The snapshot is the *same* input as Task 4 source; verify manifest identity in `committedReleases` and resolve publisher public key via its signed historical policy epoch, never caller-provided PEM.
- Produce: `computeHistoricalReleaseProofDigest(record: ProtocolReleaseRecordV1): string` using exactly D5's seven release properties plus `domain` and `schemaVersion`.

- [ ] **Step 1: Write failing tests.** Capture `verifyPublisherSignature` arguments and assert `payload === record.manifest` (not `releaseSignaturePayload(record)`). Wrong manifest phase, digest, or publisher signature blocks. Test root publisher old release, authorized rotated key, old release verified with old key, unregistered key, forged rotation, skipped policy epoch, PEM/digest mismatch, release epoch/signer mismatch. Historical digest matches D5 including `phase` and `releaseDescriptorDigest`; old D5-incomplete proof, cross-phase replay, or modified `registryHead` blocks.
- [ ] **Step 2: Run RED.** `bunx vitest run tests/runtime/review-gate-protocol-release-authority.test.ts`; expected: new proof/signature tests fail.
- [ ] **Step 3: Remove the divergent envelope verifier.** Authenticate the exact `manifest` using Task 3's verified policy epoch keyed by `manifest.trustPolicyVersion` and Task 4's same-snapshot committed record; derive its key from host-authorized Ed25519 SPKI PEM. Compare DER digest with the verifier's `publisherKeyDigest` *as assertion only*; reject mismatched payload/release identity and unsigned caller-supplied resolver.
- [ ] **Step 4: Implement D5 historical proof.** Include `domain: "justice-protocol-release-v1"`, `schemaVersion: "justice-protocol-release-v1"`, `releaseId`, `phase`, `descriptorDigest`, `releaseDescriptorDigest`, `phaseFingerprint`, and post-commit `registryHead`. Reject malformed digests.
- [ ] **Step 5: Run GREEN.** Authority Vitest + `bun run typecheck`; expected: PASS.
- [ ] **Step 6: Commit.** `git add src/runtime/review-gate-protocol-release-authority.ts tests/runtime/review-gate-protocol-release-authority.test.ts && git commit -m "feat(review-gate): verify manifest signatures and historical proofs"`

### Task 6: Historical Key Rotation and Cross-Phase Lineage (D4, D6; AC-05, AC-06, AC-09, AC-10)

**Files:**
- Modify: `src/runtime/review-gate-release-verification.ts`
- Modify: `src/runtime/review-gate-protocol-release-authority.ts`
- Test: `tests/runtime/review-gate-protocol-release-authority.test.ts`
- Test: `tests/runtime/review-gate-protocol-release-publication.test.ts`

**Interfaces:**
- Consume: guarded `GuardedProtocolReleaseRead { snapshot, source, checkpoint }` (spec D3.1), `VerifiedReleaseSnapshot.policyHistory` root→current (Task 3), source records + same-snapshot historical verifier (Tasks 4–5), signed `trustedAnchor` and cross-phase `ancestorReleaseIds`. The provider must be instantiated only inside one `withVerifiedReleaseAdmissionLease` callback.
- Preserve: `createVerifiedProtocolReleaseProvider(options).readVerifiedPhaseProtocolDelta(input): Promise<VerifiedProtocolReleaseDeltaV1 | "BLOCK">` and current `VerifiedPhaseProtocolDeltaInput` contract. `input.currentDescriptorDigest` names the **semantic** `releaseDescriptorDigest`, not the raw `sourceDigest`.
- Produce: provider result `oldDescriptorDigest`/`newDescriptorDigest` remain **exact source-byte** digests; phase fingerprints come from their respective signed, historically verified semantic contracts. Produce a `VerifiedRegistryCheckpoint` binding to the pending protocol NC1 candidate; a delta **never** authorizes a durable event after the guard expires.

- [ ] **Step 1: Write failing tests.** A root-publisher `design R1`, rotated-publisher `plan R2`, then `design R3` passes only if R1 is R3's nearest same-phase ancestor and every R1→R2→R3 history link is verified **under the same guarded current snapshot**. Include valid rotation-only with unchanged semantic contract digest. `R3` pinned to wrong design predecessor, skipped R2, swapped R2 id, forged rotation, unapproved key, stale head, rollback, mismatched `input.phase`, or shared descriptor-policy mutation all produce `"BLOCK"`. Additionally check snapshot obtained before new release commit or policy rotation, stale caller checkpoint and anchored frontier missing from chain: stale candidate cannot succeed.
- [ ] **Step 2: Run RED.** `bunx vitest run tests/runtime/review-gate-protocol-release-authority.test.ts tests/runtime/review-gate-protocol-release-publication.test.ts`; expected: new lineage/rotation tests fail.
- [ ] **Step 3: Verify complete signed key-policy ancestry.** Consume `VerifiedReleaseSnapshot.policyHistory` produced in Task 3 (do not invent a second policy loader): recheck every host-signed root/rotation proof's previous→next policy identity, pinned head, Ed25519 key digest, and continuity. The immutable root identifies the starting policy, but `input.trustedPublisherPolicyVersion` must match the currently effective authenticated policy epoch after rotations, not necessarily the root's original version. Historical release signatures validate with their release-time publisher key, not the currently active key. Cyclic/unknown policy links block.
- [ ] **Step 4: Verify provider lineage through *all* phases.** Within the D3.1 release-guarded callback, entered by the D3.2 witness-owned installation→scope→gate transaction, build source and verifier from **one** fresh snapshot; verify `trustedAnchor` installation/genesis/root publisher digest/root policy/minimum pinned frontier as a chain ancestor, and verify `input.trustedPublisherPolicyVersion === snapshot.currentPolicyVersion`. Lookup with `readReleaseByPhaseAndDescriptorDigest(input.phase, input.currentDescriptorDigest)`, require exact old id and fingerprint/proof, recheck source SHA and historical semantic digest, compare full protected checkpoint `(head, revision, stateHash, currentPolicyVersion)`, then walk the authenticated all-phase chain to the nearest earlier matching phase. `oldRelease` must equal that node. Never cache `VerifiedReleaseSnapshot` or accept a bare `readRegistryHead()` equality as freshness.
- [ ] **Step 5: Enforce phase scope at the authority.** Enforce **every signed manifest field** using spec D7.1 matrix. Reject changed `promptRegistryDigest` (no registry-level phase impact proof in scope), `validatorRegistryDigest`, `semanticPolicyRegistryDigest`, or `verifiedSemanticContractDigest` even if signed. Reject changed `crossPhase`, `requirementsResolutionPolicyVersion`, `authorityPolicy`, other phase slice, or wrong phase; verify exact source/semantic fingerprints. Permit independently authenticated `trustPolicyVersion`/`keyRotationReference` rotation **only** when semantic digest and phase-only conditions are unchanged. A key-only rotation has no eligible phase fingerprint delta. Missing proof → `"BLOCK"`.
- [ ] **Step 6: Run GREEN.** Targeted authority/publication Vitest + `bun run typecheck`; expected: PASS.
- [ ] **Step 7: Commit.** `git add src/runtime/review-gate-release-verification.ts src/runtime/review-gate-protocol-release-authority.ts tests/runtime/review-gate-protocol-release-authority.test.ts tests/runtime/review-gate-protocol-release-publication.test.ts && git commit -m "feat(review-gate): prove rotated publishers and same-phase ancestry"`

### Task 7: NC1 Phase Classification and Witness-Owned Atomic Finalization (AC-05, AC-07, AC-08, AC-12)

**Files:**
- Modify: `src/runtime/review-gate-scope-admission.ts`
- Modify: `src/runtime/review-gate-coordinator.ts`
- Modify: `src/runtime/review-gate-event-store.ts`
- Modify: `src/runtime/review-gate-witness-publication.ts`
- Modify: `src/runtime/review-gate-witness-context.ts`
- Modify: `src/runtime/review-gate-publication-record.ts`
- Modify: `src/core/review-gate/event-schema.ts`
- Modify: `src/core/review-gate/types.ts`
- Test: `tests/runtime/review-gate-scope-admission.test.ts`
- Test: `tests/runtime/review-gate-scope-admission-nc1.test.ts`
- Test: `tests/runtime/review-gate-protocol-release-integration.test.ts` (**Task 8 extends**)

**Interfaces:**
- Consume: Task 3 `VerifiedReleaseSnapshot`/`VerifiedRegistryCheckpoint`, Tasks 4–6 guarded phase provider and verified root, existing `WitnessContext`/`WitnessTransaction`, `PreparedWitnessPublicationV1`, `VerifiedSemanticContextTransitionInput`, `VerifiedNC1EligibleChangeV1`, and `AdmissionDecision`.
- Produce: `ExpectedNc1WitnessFrontier`, `ProtocolNc1FinalizeRequest`, `VerifiedProtocolNc1Candidate`, `VerifiedProtocolNc1FinalizationEvidence`, and `ProtocolNc1FinalizationOwner` **exactly** as typed in Design D3.2. Finalizer owner API: `finalizeVerifiedProtocolNc1(request: ProtocolNc1FinalizeRequest): Promise<"committed"|"already_committed"|"blocked">` plus `recoverVerifiedProtocolNc1(publicationId: string)`.
- Produce: `ReviewGateScopeWitness.withProtocolNc1PublicationTransaction<T>(ids: {scopeId:string; gateId:string}, run:(current: WitnessTransaction, capabilities: ProtocolNc1WitnessTransactionCapabilities)=>Promise<T>): Promise<T>`. It invokes `withWitnessTransaction(context, ..., { scopeIds:[scopeId], gateIds:[gateId] })` **once**, so canonical locks are installation → scope → gate; `capabilities` only exist in callback and expose guarded re-read/`preparePublicationUnlocked`, `publishPreparedJournalUnlocked`, `commitPublicationUnlocked` / shared integrity primitives; never expose raw unlocked methods to untrusted callers.
- Produce: `TrustedProtocolReleaseAdmissionHost.withVerifiedReleaseAdmissionLease<T>(run:(read:GuardedProtocolReleaseRead)=>Promise<T>):Promise<T>` invoked inside that callback; it acquires only the protocol-release guard (installation→scope→gate→registry). No cross-guard lock inversion, retries or lock re-entry.
- Produce: **internal** `DurableReviewGateEventStore.finalizeVerifiedProtocolNc1` and `recoverVerifiedProtocolNc1` implementations; protect the existing verified typed publication, not a new unauthenticated journal. `ReviewGateScopeAdmission` supplies a guarded NC1 re-evaluation helper that consumes the already-verified current witness scope/events, not `readVerifiedScope()` or `readWorkspaceScopeFrontier()` which would reacquire locks.
- Produce: V2 event `PROTOCOL_NC1_RELEASE_OBSERVED` (`event-schema.ts` and `types.ts`) with full `VerifiedProtocolNc1Candidate`, verified stop/generation binding, checkpoint, operation ID; pair with existing `SEMANTIC_CONTEXT_TRANSITION` using an authenticated `VerifiedSemanticContextTransitionInput` and proof reference to the observed event. Both strict-validated and journaled by one FDR-011 operation.

- [ ] **Step 1: Write failing RED tests for classification.** `changedDimension`: design-only and plan-only protocol fingerprint changes (with resulting global difference) are eligible for provider inspection; global-only and both-phase changes BLOCK. Signed shared/registry/semantic digest change BLOCK at provider even when classification passes. `bunx vitest run tests/runtime/review-gate-scope-admission.test.ts tests/runtime/review-gate-scope-admission-nc1.test.ts` → expected new cases FAIL.
- [ ] **Step 2: Write failing RED tests for actual durable transaction.** In `review-gate-protocol-release-integration.test.ts`, with the **real protected witness and event store** assert: outer installation→scope→gate→registry order; normal `preparePublication()`/`appendEvents()` **not invoked within** locked callback; each scope/gate lock acquired once; actual canonical batch staged + native durable shard written and synced + witness CAS committed; expected witness writer/global frontier advances and replay returns the observed proof and transition. Simulate competing gate/scope lock, installation guard, registry guard and wrong lock order; expect BLOCK without success. Run `bunx vitest run tests/runtime/review-gate-protocol-release-integration.test.ts` → expected RED.
- [ ] **Step 3: Implement phase dimension classifier only.** Preserve existing requirements/design/plan artifact precedence and NC1 ordering. Fingerprint classification authorizes inspection, **never** an event append. Keep `currentDescriptorDigest: request.protocol.releaseDescriptorDigest`.
- [ ] **Step 4: Implement a non-reentrant witness-owned finalizer transaction.** New `withProtocolNc1PublicationTransaction` wraps only **one** `withWitnessTransaction(context, ..., publicationLockIds)`; do not use `withGateOwnedWitnessTransaction` as outer owner (it would take installation after already held gate/scope). `publishPreparedJournalUnlocked` shares the exact validation/fsync logic of existing `publishPreparedJournal`; do not bypass `verifyTerminalPublication`, native preimage CAS or protected revision/hash checks. Refresh current scope revision after prepared `scope` state advance before calling `commitPublicationUnlocked`. Reuse FDR-011 `PreparedWitnessPublicationV1` publicationId and deterministic operation ID, never invent a second journal format.
- [ ] **Step 5: Implement guarded evidence-to-event binding.** In event store internal `finalizeVerifiedProtocolNc1`, confirm **no prior scope/gate lease**, start the witness transaction, then acquire release guard; read fresh verified witness scope/gate/generation/stop/writer frontier and registry snapshot inside guards; build same-snapshot historical verifier/provider; independently recalculate full `candidate: Extract<VerifiedNC1EligibleChangeV1,{kind:"protocol"}>` and Core `REENTRY_CANDIDATE`, require stop / frontier / observation event ID / generation binding. Derive `publicationOperationId` from `{domain:"justice-protocol-nc1-publication-v1",scopeId,gateId,writerId,generationId,nc1StopEventId,observationOperationId:candidate.observationOperationId}`. Reject stale preflight expected frontier, missing verified compatibility validation/`transition` payload, mismatched registry checkpoint, changed writer/global head, invalid parentEventId, unsigned producer or unknown event. Append V2 `PROTOCOL_NC1_RELEASE_OBSERVED` and `SEMANTIC_CONTEXT_TRANSITION` **in that order, one canonical FDR-011 batch**. Only witness CAS advanced / exact identical already_committed produces success.
- [ ] **Step 6: Define fail-closed crash / conflict recovery.** `recoverVerifiedProtocolNc1(publicationId)` reacquires installation→scope→gate→registry, loads protected pending/committed record and staged exact bytes under the same authorization, revalidates anchored policy/checkpoint, original operation ID and witness preimage. Missing/invalid/stale checkpoint or altered bytes → BLOCK, leave unanchored tail untouched. If shard is absent/exact preimage, write only staged bytes; if exact staged complete tail, finish CAS; if already committed matching record/tail, `already_committed`; third/partial tail, CAS conflict, unknown result without verified commit → `blocked`.
- [ ] **Step 7: Wire coordinator without lock re-entry.** NC1 preflight may detect `REENTRY_CANDIDATE`, but after release of its existing inspection lease it is a **hint only**. Coordinator calls dedicated `finalizeVerifiedProtocolNc1` **from unlocked state** (not `eventStore.appendEvents`). The finalizer rechecks full proof and commits while all guards are held. Only afterward may ordinary Gate locks/dispatch be acquired. No Task 5 authoritative host → leave real provider stub returning `"BLOCK"`.
- [ ] **Step 8: Run targeted GREEN.** `bunx vitest run tests/runtime/review-gate-scope-admission.test.ts tests/runtime/review-gate-scope-admission-nc1.test.ts tests/runtime/review-gate-protocol-release-integration.test.ts` and `bun run typecheck`; expected PASS only if actual durable witness publication + protected CAS paths complete without nested locks.
- [ ] **Step 9: Commit (future implementation only).** `git add src/runtime/review-gate-scope-admission.ts src/runtime/review-gate-coordinator.ts src/runtime/review-gate-event-store.ts src/runtime/review-gate-witness-publication.ts src/runtime/review-gate-witness-context.ts src/runtime/review-gate-publication-record.ts src/core/review-gate/event-schema.ts src/core/review-gate/types.ts tests/runtime/review-gate-scope-admission.test.ts tests/runtime/review-gate-scope-admission-nc1.test.ts tests/runtime/review-gate-protocol-release-integration.test.ts && git commit -m "feat(review-gate): finalize NC1 via protected witness publication"`

### Task 8: Production-Path Test and Fail-Closed Adapter Gate (AC-01–AC-12)

**Files:**
- Create: `tests/runtime/review-gate-protocol-release-integration.test.ts`
- Modify: `tests/runtime/opencode-adapter-v2.test.ts`
- Modify: `tests/runtime/review-gate-scope-admission-nc1.test.ts` (guarded finalization race)
- Modify: `src/runtime/opencode-adapter.ts` **only if necessary to preserve, not remove, the Task 5 stub**
- Test: `tests/runtime/review-gate-protocol-release-publication.test.ts`
- Test: `tests/runtime/review-gate-protocol-release-authority.test.ts`

**Interfaces:**
- Exercise host-provisioned witness/release roots → authenticated release publication → *preflight only* scope NC1 candidate → **unlocked coordinator** calls `DurableReviewGateEventStore.finalizeVerifiedProtocolNc1` → `ReviewGateScopeWitness.withProtocolNc1PublicationTransaction` (installation→scope→gate) → `TrustedProtocolReleaseAdmissionHost.withVerifiedReleaseAdmissionLease` (release guard) → fresh witness/registry verification, same-snapshot provider, complete Core `REENTRY_CANDIDATE`+`VerifiedProtocolNc1Candidate` → exact V2 proof/transition event batch → FDR-011 protected stage/native durable shard/fsync/witness CAS. Assert fully verified success on actual event-store reread, not mock provider or preflight return.
- Assert `createRegistryBackedVerifiedProtocolReleaseSource(snapshot)` may serve read-only historical lookup but **never** establishes live authority by itself. Verify freshness against all checkpoint fields, including revision/hash changed by key rotation with no release frontier change.
- Test-only trusted anchor comes from separately authenticated test provisioning; it **does not** constitute Task 5 production approval.

- [ ] **Step 1: Write failing integration tests.** Build protected temp directory with independently generated host/publisher Ed25519 keys and **explicit host-provisioned** `createReviewGateProtocolDescriptor({ trustedPublisherPolicyVersion: verifiedPolicyVersion })` fixtures (never default `""`). Publish R1(design), R2(plan), R3(design) with a **valid publisher key rotation but unchanged `verifiedSemanticContractDigest`**, same registry digests and only the requested phase descriptor slice changing; assert a valid NC1 phase delta, old/new **source-byte** digests, authenticated old/new keys, same-phase ancestry, fresh checkpoint, and **both the `PROTOCOL_NC1_RELEASE_OBSERVED` proof event and matching `SEMANTIC_CONTEXT_TRANSITION` durably committed in one canonical witness CAS**. Include independently verified `SEMANTIC_CONTEXT_COMPATIBILITY_V1` validation event/proof; missing transition proof must BLOCK. Separate positive publication/history test updates the historical semantic contract digest under signed policy authorization but asserts phase-only NC1 `"BLOCK"`. Also test design-only, plan-only, design+shared policy, plan+shared policy, key-only rotation (candidate `null`, no approval), semantic digest change, each registry-only digest change, and shared registry change invisible in descriptor: outcomes per spec D7.1. Assert wrong signer, old proof, skipped epoch, unregistered key, forged rotation, mismatched SPKI digest, bad epoch signer, duplicate index ambiguity, rollback or missing bytes never yields approval. Pending-only release is not committed.
- [ ] **Step 2: Write all nine RG-PHASE-001 adversarial RED tests on actual protected witness and event-store.** (1) Scope lock held **by the NC1 owner** allows successful publication; (2) same scope/gate lock acquired only once, standard witness entrypoints not called inside; (3) gate lock / installation guard / registry guard contention → blocked without cycles or success; (4) release commit races append; (5) publisher rotation races append (including unchanged release frontier); (6) witness writer/global/shard CAS conflict → blocked, not successful; (7) journal synced but CAS outcome unknown → only exact operation/bytes checkpoint-verified idempotent `recoverVerifiedProtocolNc1` may return committed/already_committed; (8) durable V2 observed event includes the full candidate, stop/generation, release IDs, phase fingerprints, signer/chain digests, live checkpoint, operation ID, and transition references it; (9) stale candidate replay after all guards release is rejected. Keep actual FDR-011 stage/native shard durability and protected CAS; never use a mock success shortcut. Without production Task 5, adapter-wired NC1 remains `"BLOCK"` with no approval event.
- [ ] **Step 3: Run RED.** `bunx vitest run tests/runtime/review-gate-protocol-release-integration.test.ts tests/runtime/review-gate-scope-admission-nc1.test.ts tests/runtime/opencode-adapter-v2.test.ts`; expected: new guarded-finalization/authorization tests fail before implementation (RED), without running them during this documentation-only review.
- [ ] **Step 4: Connect only the test composition.** Wire authenticated test-only roots, signed policy histories, real native/witness journal provider, and scope/coordinator finalization using **installation→scope→gate→release guard** (one acquisition each). Call new owner API, not ordinary `appendEvents`/`prepareVerifiedEventPublication` while locks are held. Record exact per-gate writer frontier and protected registry revision/hash before/after. Do not substitute mock-success appends, an unguarded/live reread, or re-entrant witness APIs. Leave production `buildSharedReviewGateRuntimeGraph()` provider as `readVerifiedPhaseProtocolDelta: async () => "BLOCK"`. Do not install a real provider or fabricate Task 5 readiness.
- [ ] **Step 5: Run GREEN.** `bunx vitest run tests/runtime/review-gate-protocol-release-integration.test.ts tests/runtime/review-gate-protocol-release-publication.test.ts tests/runtime/review-gate-protocol-release-authority.test.ts tests/runtime/review-gate-scope-admission.test.ts tests/runtime/review-gate-scope-admission-nc1.test.ts tests/runtime/opencode-adapter-v2.test.ts`; expected: PASS. Recheck each AC-01–AC-12 against its test assertion and record any gap before a review gate.
- [ ] **Step 6: Run mandatory full checks inside devcontainer.** `bun run test`, `bun run typecheck`, `bun run lint`, `bun run build`; all must exit 0. Separately report skipped tests, host-only limitations and warnings; these commands are planned checks, **not yet executed**.
- [ ] **Step 7: Commit.** `git add tests/runtime/review-gate-protocol-release-integration.test.ts tests/runtime/opencode-adapter-v2.test.ts tests/runtime/review-gate-scope-admission-nc1.test.ts tests/runtime/review-gate-protocol-release-publication.test.ts tests/runtime/review-gate-protocol-release-authority.test.ts && git commit -m "test(review-gate): prove guarded protocol release contract end to end"`

## Acceptance / Review Matrix

| Requirement | Proof-bearing task |
| --- | --- |
| AC-01 phase mismatch BLOCK | 1, 4, 5, 8 |
| AC-02 design/plan same digest separation | 4, 8 |
| AC-03 source vs semantic digest | 1, 2, 6, 8 |
| AC-04 common manifest signatures | 2, 5, 8 |
| AC-05 head rollback/history/old head **and admission-time protected checkpoint** | 3, 4, 6, 7, 8 |
| AC-06 authorized publisher rotation / historical public key | 2, 3, 5, 6, 8 |
| AC-07 phase change not false global BLOCK | 7, 8 |
| AC-08 shared policy and signed registry metadata not single-phase approved | 6, 7, 8 |
| AC-09 historical runtime semantic contract | 2, 6, 8 |
| AC-10 cross-phase same-phase lineage | 4, 6, 8 |
| AC-11 signed semantic digest recoverability | 1, 2, 8 |
| AC-12 Task 5 absent → BLOCK | 7, 8 |


## Finding Disposition Matrix — documentation-only correction (2026-10-14 JST)

**Review Gate is still BLOCKED.** The status below means a documented corrective design/plan change, **not** independently verified finding closure, implementation readiness, owner approval, or a test result.

| Finding | Severity | Changed design sections | Changed plan tasks | Planned RED/GREEN verification | Disposition |
| --- | --- | --- | --- | --- | --- |
| RG-PHASE-001 | Blocker | D3.1, **D3.2**, D4.1 | 3, 4, 6, **7, 8** | Real event-store/witness integration: canonical installation→scope→gate→release graph, full proof+transition batch, protected stage/shard/fsync/CAS, nine concurrency/recovery scenarios, exact guarded candidate binding | **R1 PARTIALLY RESOLVED → R2 DOCUMENT CORRECTION; PENDING FRESH RECHECK** |
| RG-PHASE-002 | Major | D3.1, D4.1, D5, D6 | 3, 4, 5, 6, 8 | authority + publication tests: authorized root/rotation, old-key verification, missing epoch, forged proof, bad PEM digest, epoch-signer mismatch | **R1 RESOLVED (static documentation); NOT REOPENED** |
| RG-PHASE-003 | Major | D2, D7.1 | 2, 6, 7, 8 | publication historic semantic success **separate** from integration phase-only design/plan positive (unchanged registries/semantic digest), shared policy and registry-only negative | **R1 RESOLVED (static documentation); NOT REOPENED** |
| RG-PHASE-004 | Minor | D7.2 | 1, 2, 8 | protocol + publication tests: default sentinel rejects signed publication; explicitly provisioned policy-1 matches signed manifest and publishes | **R1 RESOLVED (static documentation); NOT REOPENED** |

All `RED`/`GREEN` are **future implementation steps**, not executed checks.

## D1–D7 / AC-01–AC-12 / Task 1–8 Traceability

| Design | Acceptance criteria | Implementing tasks | Primary assertion / review target |
| --- | --- | --- | --- |
| D1 top-level phase | AC-01, AC-02 | 1, 4, 5, 8 | signed phase parses, wrong phase BLOCK, same digest across phases resolves only requested phase |
| D2 source vs semantic identity | AC-03 | 1, 2, 4, 6, 8 | exact source SHA-256 distinct from canonical semantic digest; tamper blocks |
| D3 post-commit head, D3.1/D3.2 witness-owned publication | AC-05, AC-07, AC-08, AC-12 | 3, 4, 6, 7, 8 | anchored live head, installation→scope→gate→release, V2 observed proof + semantic transition, FDR-011 CAS, recovery & Task 5 BLOCK |
| D4 deterministic lookup and D4.1 policy history | AC-02, AC-04, AC-05, AC-06 | 3, 4, 5, 6, 8 | phase-indexed lookup, verified current state, release-specific policy epoch and PEM digest |
| D5 historic proof and signature | AC-01, AC-04 | 5, 6, 8 | publication/authority sign same manifest; D5 digest binds old phase/source/semantic/head |
| D6 full cross-phase ancestry | AC-05, AC-06, AC-10 | 3, 4, 6, 8 | root→rotated key, design→plan→design nearest same-phase old release |
| D7 historical semantic digest and D7.1 classification | AC-03, AC-07, AC-08, AC-09, AC-11 | 1, 2, 6, 7, 8 | archived digest re-verifies; shared/registry/semantic digest changes block phase-only; aggregate global diff alone not rejection |
| D7.2 policy sentinel | AC-11, AC-12 | 1, 2, 8 | untrusted empty sentinel rejects signed publication, valid host-verified version required |
| Cross-cutting integration | AC-01–AC-12 | 8 (depends on Tasks 1–7) | actual witness-protected event-store V2 pair publication + CAS and 9 RG-PHASE-001 races; no mock-only success |

## Planned Verification Commands (not run in documentation review)

- Task 1 RED/GREEN: `bunx vitest run tests/runtime/review-gate-protocol.test.ts tests/runtime/review-gate-protocol-release-publication.test.ts`.
- Task 2/3 RED/GREEN: `bunx vitest run tests/runtime/review-gate-protocol-release-publication.test.ts`.
- Task 4/5/6 RED/GREEN: `bunx vitest run tests/runtime/review-gate-protocol-release-authority.test.ts tests/runtime/review-gate-protocol-release-publication.test.ts`.
- Task 7 RED/GREEN: `bunx vitest run tests/runtime/review-gate-scope-admission.test.ts tests/runtime/review-gate-scope-admission-nc1.test.ts tests/runtime/review-gate-protocol-release-integration.test.ts`.
- Task 8 RED/GREEN: `bunx vitest run tests/runtime/review-gate-protocol-release-integration.test.ts tests/runtime/review-gate-protocol-release-publication.test.ts tests/runtime/review-gate-protocol-release-authority.test.ts tests/runtime/review-gate-scope-admission.test.ts tests/runtime/review-gate-scope-admission-nc1.test.ts tests/runtime/opencode-adapter-v2.test.ts`.
- After implementation and independent authorization only: `bun run test`, `bun run typecheck`, `bun run lint`, `bun run build`. Expected: exit 0; report actual failures/skips separately. No test was executed for this document change.

## Non-Goals and Execution Gate

- **Current Review Gate: BLOCKED.** Next action is **Fresh Independent Review of these revised documents**; writing this plan does not convert findings to CLOSED or READY.
- This plan does **not** authorize a normative Requirements/Architecture change, production Task 5 provisioning, schema auto-migration, or enabling a real provider.
- Treat signature/root-policy schema expansion as a proposal requiring review of the versioned trust-bootstrap/migration contract. Do not claim a production-upgrade path for legacy signed releases without separate explicit approval.
- After implementing the testable release subsystem, obtain a fresh independent architecture/security review and separate Task 5 trust-boundary proof before proposing production adapter wiring.
- Stop before implementation until the human reviews this plan and selects an execution approach. Recommended: **subagent-driven**, with a fresh per-task reviewer, because errors in signed history or phase authority can silently grant incorrect NC1 transitions.
