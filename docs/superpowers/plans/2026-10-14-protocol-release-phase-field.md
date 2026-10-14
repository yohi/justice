# Protocol Release Phase-Scoped Authority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the protocol release manifest, independently trusted publication registry, historical authority provider, and NC1 phase admission use one verifiable phase-scoped release contract without weakening fail-closed behavior.

**Architecture:** Keep privileged publication/witness-store operations separate from a read-only, authenticated registry snapshot and provider. Each signed manifest identifies one phase, exact source bytes, a semantic descriptor digest, and the release-time semantic contract; the verified protected history derives post-commit heads, predecessor relationships, and authorized publisher keys. The provider uses only those derived records and blocks ambiguous phase ancestry, shared-policy changes, or missing Task 5 authority.

**Tech Stack:** TypeScript, Bun, Vitest, Zod, Node.js Ed25519, existing `ProtectedWitnessStore` and canonical JSON fingerprint helpers.

**Spec:** `docs/decisions/2026-10-14-protocol-release-phase-field.md` (Option A, D1–D7, AC-01–AC-12), branch `docs/protocol-release-phase-field`.

## Global Constraints

- **Decision gate:** The spec is design-reviewed but not a formal Requirements Owner / Architecture Owner authorization. Do not start implementation or enable the real provider until applicable owner approvals and independent review gates are satisfied.
- **Release authorization:** `phase` is the *top-level* signed manifest scope, exactly `"design" | "plan"`. Do not derive phase from the descriptor; do not add a phase parameter to `rotatePublisherTrustPolicy()` or `commitPreparedProtocolReleaseCAS()`.
- **Digest semantics:** `sourceDigest` and `ProtocolReleaseRecordV1.descriptorDigest` are SHA-256 of exact source bytes; `releaseDescriptorDigest` is `computeCanonicalJsonFingerprint({ descriptor, verifiedSemanticContractDigest })`. Never substitute one for the other.
- **History:** `registryHead` for a release is the **post-commit** `frontierHash`. Verify the full committed chain, not just the current head. A registry head that cannot be anchored to protected history blocks.
- **Historical verification:** Recompute old fingerprints with the semantic contract digest stored in *that release's signed manifest*, not the present runtime digest.
- **Signatures:** Publisher and installer authenticate the exact canonical `manifest` used by publication; do not introduce a second signature envelope. Key rotation requires a host-root-authorized history chain.
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
5. **Global fingerprint changes as a consequence of a one-phase edit versus a shared policy edit:** first can be considered for phase verification; the latter blocks even if only one phase fingerprint changes; Task 7.

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
| Production-path integration | Create `tests/runtime/review-gate-protocol-release-integration.test.ts` |

---

### Task 1: Signed Phase Manifest and Canonical Identity (D1, D2, D7; AC-01–AC-03, AC-11)

**Files:**
- Modify: `src/runtime/review-gate-release-schema.ts`
- Modify: `src/runtime/review-gate-protocol.ts`
- Test: `tests/runtime/review-gate-protocol.test.ts`
- Test: `tests/runtime/review-gate-protocol-release-publication.test.ts`

**Interfaces:**
- Produce: `export type ReleaseManifest = z.infer<typeof releaseManifestSchema>`.
- Produce: `computeReleaseDescriptorDigest(descriptor: ReviewProtocolDescriptorV1, verifiedSemanticContractDigest: string): string`.
- Produce: `computeCurrentSemanticContractDigest(): string` as the explicitly named current-runtime semantic digest (rename/export the existing private deterministic-validation digest function).
- Retain: `computeReviewGateProtocolFingerprints(descriptor, semanticContractDigestOverride?)`. The optional override is required for historical validation.

- [ ] **Step 1: Write failing tests.** Assert `releaseManifestSchema.safeParse` rejects missing/unknown `phase`, missing `verifiedSemanticContractDigest`, and mismatched/absent `releaseDescriptorDigest`; valid `design` and `plan` manifest shapes parse. Assert `computeReleaseDescriptorDigest(d, s) === computeCanonicalJsonFingerprint({ descriptor: d, verifiedSemanticContractDigest: s })` and differs if `s` changes. Keep input fixture source bytes separate from descriptor digest.
- [ ] **Step 2: Run RED.** `bunx vitest run tests/runtime/review-gate-protocol.test.ts tests/runtime/review-gate-protocol-release-publication.test.ts`. Expected: new schema/digest cases fail.
- [ ] **Step 3: Implement schema and pure digest helper.** In `releaseManifestSchema` make `phase: z.enum(["design", "plan"])`, `releaseDescriptorDigest` and `verifiedSemanticContractDigest` mandatory. Export `ReleaseManifest`. Keep `sourceDigest` unchanged; do not derive phase from `designPhase` or `planPhase`.
- [ ] **Step 4: Align runtime descriptor identity.** Replace the current `{ domain, descriptor, deterministicValidationSemanticContract }` release digest calculation with the D7 exact two-property payload. Do not infer publisher trust-policy version from `descriptor.authorityPolicy.current`. Expose an explicit trusted-policy-version input for *release authority binding*; when absent, emit a non-authoritative sentinel so existing pure descriptor callers are usable but no release can be approved. Acceptance of a version remains subject to verified anchor matching in Task 6.
- [ ] **Step 5: Run GREEN.** Same targeted Vitest command; expected: PASS. Run `bun run typecheck`; update direct callers/fixtures whose types require the new mandatory manifest fields, without weakening validation.
- [ ] **Step 6: Commit.** `git add src/runtime/review-gate-release-schema.ts src/runtime/review-gate-protocol.ts tests/runtime/review-gate-protocol.test.ts tests/runtime/review-gate-protocol-release-publication.test.ts && git commit -m "feat(review-gate): define signed phase release identity"`

### Task 2: Trusted Semantic Contract and Historical Verification (D7; AC-03, AC-09, AC-11)

**Files:**
- Modify: `src/runtime/review-gate-release-verification.ts`
- Modify: `src/runtime/review-gate-release-schema.ts`
- Modify: `src/runtime/review-gate-protocol-release-publication.ts`
- Test: `tests/runtime/review-gate-protocol-release-publication.test.ts`

**Interfaces:**
- Consume: `ReleaseManifest`, `computeReleaseDescriptorDigest`, `computeReviewGateProtocolFingerprints(descriptor, verifiedSemanticContractDigest)`.
- Preserve: `createReleaseVerification(...).verifyEvidence(state, input, installationId, requireCurrentPolicy?)`.
- Produce: Signed policy/root-bound `verifiedSemanticContractDigest`: provisioned root policy pins its approved semantic digest; an authorized policy revision/rotation pins the next digest. Every release cites the digest authorized by its signed policy epoch.

- [ ] **Step 1: Write failing tests.** Signed publication with an invented semantic digest blocks; wrong `releaseDescriptorDigest` blocks; mutated descriptor with unchanged digest blocks. After a host-authorized policy/digest revision, `registry.readHead()` still validates an older signed release against its *original* digest while checking a newer release against its newer approved digest. A missing digest in a legacy signed manifest blocks without reconstruction.
- [ ] **Step 2: Run RED.** `bunx vitest run tests/runtime/review-gate-protocol-release-publication.test.ts`; expected: new tamper/history tests fail.
- [ ] **Step 3: Bind verified semantic digest to host authorization.** Extend signed `releaseAnchorSchema` and `policySchema`/authorized rotation payload with `verifiedSemanticContractDigest: string` (digest schema); update `provisionProtocolReleaseRegistry` and `rotatePublisherTrustPolicy` to require it from the independently approved trust configuration. No phase parameter. Do not accept a bare manifest-supplied value as its own authorization.
- [ ] **Step 4: Validate each manifest against its signed policy epoch.** In `verifyEvidence` require `manifest.verifiedSemanticContractDigest === policy.verifiedSemanticContractDigest`, `manifest.releaseDescriptorDigest === computeReleaseDescriptorDigest(manifest.descriptor, manifest.verifiedSemanticContractDigest)`, and compute all three fingerprints with `manifest.verifiedSemanticContractDigest`. Verify source SHA-256 and both signatures over the exact manifest as before.
- [ ] **Step 5: Run GREEN.** `bunx vitest run tests/runtime/review-gate-protocol-release-publication.test.ts` and `bun run typecheck`; expected: PASS.
- [ ] **Step 6: Commit.** `git add src/runtime/review-gate-release-schema.ts src/runtime/review-gate-release-verification.ts src/runtime/review-gate-protocol-release-publication.ts tests/runtime/review-gate-protocol-release-publication.test.ts && git commit -m "feat(review-gate): authenticate historical semantic contracts"`

### Task 3: Verify Protected History and Post-Commit Frontier (D3; AC-05)

**Files:**
- Modify: `src/runtime/review-gate-release-verification.ts`
- Modify: `src/runtime/review-gate-protocol-release-publication.ts`
- Test: `tests/runtime/review-gate-protocol-release-publication.test.ts`

**Interfaces:**
- Consume: `current()`'s validated `ReleaseRegistry` and `head`.
- Produce: `readVerifiedReleaseSnapshot(): Promise<VerifiedReleaseSnapshot>` from `createTrustedProtocolReleaseRegistry`, where `VerifiedReleaseSnapshot` is a readonly value containing `head` and committed releases ordered oldest→newest with each release's reconstructed **post-commit** frontier.
- Protected link formula: `computeCanonicalJsonFingerprint({ previous: previousFrontierHash, manifest })`, exactly matching the existing commit code; genesis starts at signed `anchor.initialFrontierDigest`.

- [ ] **Step 1: Write failing tests.** A two-release chain yields per-release frontiers matching the heads returned immediately after each commit. Tampering a historical parent, committed manifest, frontier link, or latest head blocks snapshot/read; a missing ancestor and a stale-but-signed branch block. Verify pending entries are not returned as committed.
- [ ] **Step 2: Run RED.** `bunx vitest run tests/runtime/review-gate-protocol-release-publication.test.ts`; expected: new history/snapshot tests fail.
- [ ] **Step 3: Implement full ancestry/frontier replay.** In `current()` start from the host-authenticated genesis frontier and deterministically replay signed manifests in chain order; require exact parent id, expected head (`releaseId`/`sequence`/`frontierHash`), one-to-one membership, and final equality with protected registry head. Reject cycles, forks, missing records, and head rollback.
- [ ] **Step 4: Expose the guarded read-only snapshot.** Add `readVerifiedReleaseSnapshot()` under the existing `store.withGuard("protocol-release", ...)`; produce immutable cloned/frozen values only after `current()` succeeds. No caller receives `store`, registry mutation functions, or unverified in-memory maps.
- [ ] **Step 5: Run GREEN.** Targeted publication Vitest + `bun run typecheck`; expected: PASS.
- [ ] **Step 6: Commit.** `git add src/runtime/review-gate-release-verification.ts src/runtime/review-gate-protocol-release-publication.ts tests/runtime/review-gate-protocol-release-publication.test.ts && git commit -m "feat(review-gate): prove release frontiers from protected history"`

### Task 4: Phase-Indexed, Read-Only Registry Source (D2–D4; AC-01, AC-02, AC-05)

**Files:**
- Modify: `src/runtime/review-gate-protocol-release-authority.ts`
- Modify: `src/runtime/review-gate-protocol-release-publication.ts`
- Test: `tests/runtime/review-gate-protocol-release-authority.test.ts`
- Test: `tests/runtime/review-gate-protocol-release-publication.test.ts`

**Interfaces:**
- Extend `ProtocolReleaseRecordV1` with `releaseDescriptorDigest: string`, `verifiedSemanticContractDigest: string`, and `manifest: ReleaseManifest`; retain `descriptorDigest === manifest.sourceDigest` and exact `canonicalDescriptorBytes`.
- Replace `VerifiedProtocolReleaseSource.readReleaseByDescriptorDigest` with `readReleaseByPhaseAndDescriptorDigest(phase: VerifiedProtocolReleasePhase, releaseDescriptorDigest: string): Promise<ProtocolReleaseRecordV1 | null>`. Preserve `readRegistryHead()` and `readRelease(id)`.
- Produce: `createRegistryBackedVerifiedProtocolReleaseSource(snapshot: VerifiedReleaseSnapshot): VerifiedProtocolReleaseSource`: pure read-only index over Task 3's authenticated snapshot.
- Derived record `registryHead` is its post-commit frontier, and `ancestorReleaseIds` is the validated predecessor chain across *all* phases.

- [ ] **Step 1: Write failing tests.** With `design` and `plan` releases having the same `releaseDescriptorDigest`, each phase query returns its corresponding signed record. A missing phase/digest pair returns `null`. Duplicate same-phase identities select the reachable candidate nearest the verified head; an ambiguous/invalid candidate or unverified release returns `null`. Exact `readRelease(id)` returns its signed phase, post-commit head, source SHA, and verified semantic digest.
- [ ] **Step 2: Run RED.** `bunx vitest run tests/runtime/review-gate-protocol-release-authority.test.ts tests/runtime/review-gate-protocol-release-publication.test.ts`; expected: new source/index cases fail.
- [ ] **Step 3: Map verified snapshot to records.** Build immutable records only from authenticated committed manifest, exact stored bytes, approved policy-key digest, and replayed frontier. Do not synthesize `phase` from query input or sign a post-commit field absent from the original manifest.
- [ ] **Step 4: Implement deterministic phase+semantic digest lookup.** Resolve candidates using verified ancestry/head reachability and reject duplicates whose signed identity, authorization, or ordering cannot be uniquely proven. Do not use an unqualified "latest".
- [ ] **Step 5: Run GREEN.** Targeted Vitest + `bun run typecheck`; expected: PASS.
- [ ] **Step 6: Commit.** `git add src/runtime/review-gate-protocol-release-authority.ts src/runtime/review-gate-protocol-release-publication.ts tests/runtime/review-gate-protocol-release-authority.test.ts tests/runtime/review-gate-protocol-release-publication.test.ts && git commit -m "feat(review-gate): expose phase-indexed verified release source"`

### Task 5: Unify Publisher Signature and Historical Proof (D5; AC-01, AC-04)

**Files:**
- Modify: `src/runtime/review-gate-protocol-release-authority.ts`
- Test: `tests/runtime/review-gate-protocol-release-authority.test.ts`

**Interfaces:**
- Consume: `ProtocolReleaseRecordV1.manifest`, signed `publisherSignature`, approved publisher key digest, and Task 3-derived frontiers.
- Preserve: `VerifiedProtocolReleaseSignatureVerifier(input: { domain: string; payload: unknown; signature: string; publisherKeyDigest: string }): Promise<boolean>`. Its `payload` MUST equal `record.manifest`.
- Produce: `computeHistoricalReleaseProofDigest(record: ProtocolReleaseRecordV1): string` using exactly D5's seven release properties plus `domain` and `schemaVersion`.

- [ ] **Step 1: Write failing tests.** Capture `verifyPublisherSignature` arguments and assert `payload === record.manifest` (not `releaseSignaturePayload(record)`). Wrong manifest phase, digest, or publisher signature blocks. Historical digest matches D5 including `phase` and `releaseDescriptorDigest`; old D5-incomplete proof, cross-phase replay, or modified `registryHead` blocks.
- [ ] **Step 2: Run RED.** `bunx vitest run tests/runtime/review-gate-protocol-release-authority.test.ts`; expected: new proof/signature tests fail.
- [ ] **Step 3: Remove the divergent envelope verifier.** Authenticate the exact `manifest` through the host-root-approved publisher key at its historical policy epoch. Publisher identity/key is derived from the verified policy chain; compare trust root and policy versions, not a mutable caller claim.
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
- Consume: verified snapshot's signed root policy, ordered host-authorized rotations, all release manifests, and Task 4's cross-phase `ancestorReleaseIds`.
- Preserve: `createVerifiedProtocolReleaseProvider(options).readVerifiedPhaseProtocolDelta(input): Promise<VerifiedProtocolReleaseDeltaV1 | "BLOCK">` and current `VerifiedPhaseProtocolDeltaInput` contract. `input.currentDescriptorDigest` names the **semantic** `releaseDescriptorDigest`, not the raw `sourceDigest`.
- Produce: provider result `oldDescriptorDigest`/`newDescriptorDigest` remain **exact source-byte** digests; phase fingerprints come from their respective signed, historically verified semantic contracts.

- [ ] **Step 1: Write failing tests.** A root-publisher `design R1`, rotated-publisher `plan R2`, then `design R3` passes only if R1 is R3's nearest same-phase ancestor and every R1→R2→R3 history link is verified. `R3` pinned to wrong design predecessor, skipped R2, swapped R2 id, forged rotation, unapproved key, stale head, rollback, mismatched `input.phase`, or shared descriptor-policy mutation all produce `"BLOCK"`.
- [ ] **Step 2: Run RED.** `bunx vitest run tests/runtime/review-gate-protocol-release-authority.test.ts tests/runtime/review-gate-protocol-release-publication.test.ts`; expected: new lineage/rotation tests fail.
- [ ] **Step 3: Verify complete signed key-policy ancestry.** Starting at independently signed `release-anchor.json`, require every rotation proof's host signature, previous→next policy identity, pinned head, key digest, and continuity. Historical release signatures validate with their release-time publisher key, not the currently active key. Cyclic/unknown policy links block.
- [ ] **Step 4: Verify provider lineage through *all* phases.** Lookup with `readReleaseByPhaseAndDescriptorDigest(input.phase, input.currentDescriptorDigest)`, require exact old id and fingerprint/proof, recheck source SHA and semantic digest, compare protected heads, and walk the authenticated chain for the nearest earlier matching phase; `oldRelease` must equal that node.
- [ ] **Step 5: Enforce phase scope at the authority.** Compare signed old/new descriptor fields: a change to `crossPhase`, `requirementsResolutionPolicyVersion`, `authorityPolicy`, the other phase slice, or any shared semantic-policy component is not justified by one phase's approval and blocks. Allow only verified changes within the requested phase. Missing evidence does not yield a delta.
- [ ] **Step 6: Run GREEN.** Targeted authority/publication Vitest + `bun run typecheck`; expected: PASS.
- [ ] **Step 7: Commit.** `git add src/runtime/review-gate-release-verification.ts src/runtime/review-gate-protocol-release-authority.ts tests/runtime/review-gate-protocol-release-authority.test.ts tests/runtime/review-gate-protocol-release-publication.test.ts && git commit -m "feat(review-gate): prove rotated publishers and same-phase ancestry"`

### Task 7: NC1 Phase-versus-Global Classification (AC-07, AC-08)

**Files:**
- Modify: `src/runtime/review-gate-scope-admission.ts`
- Test: `tests/runtime/review-gate-scope-admission.test.ts`
- Test: `tests/runtime/review-gate-scope-admission-nc1.test.ts`

**Interfaces:**
- Retain admission's `protocolRelease.readVerifiedPhaseProtocolDelta` seam and `VerifiedNC1EligibleChangeV1` contract. Pass `currentDescriptorDigest: request.protocol.releaseDescriptorDigest` only; do not substitute `sourceDigest`.
- Update `changedDimension(binding: ComparableContext, current: ComparableContext)` classification so an aggregate fingerprint change consequent on **exactly one** changed phase fingerprint is not rejected prematurely; both-phase changes and a global-only mismatch remain global/blocked. Task 6 provider is still responsible for signed, field-level shared-policy refusal.

- [ ] **Step 1: Write failing admission tests.** Only design changes + resulting global fingerprint change reaches the design provider once; plan analogous. Both phase fingerprints change → no provider call and `BLOCK`. Only global fingerprint changes → `BLOCK`. Simulated shared-policy change with a single phase fingerprint change reaches the provider but receives `"BLOCK"` and cannot be admitted.
- [ ] **Step 2: Run RED.** `bunx vitest run tests/runtime/review-gate-scope-admission.test.ts tests/runtime/review-gate-scope-admission-nc1.test.ts`; expected: new classification cases fail.
- [ ] **Step 3: Make dimension classification phase-aware.** Preserve existing requirements/design/plan artifact precedence and unrelated NC1 ordering. Classify from the phase fingerprint pair before treating the aggregate difference as a standalone global change; never auto-approve based only on classification.
- [ ] **Step 4: Run GREEN.** Targeted scope-admission Vitest + `bun run typecheck`; expected: PASS.
- [ ] **Step 5: Commit.** `git add src/runtime/review-gate-scope-admission.ts tests/runtime/review-gate-scope-admission.test.ts tests/runtime/review-gate-scope-admission-nc1.test.ts && git commit -m "fix(review-gate): classify verified phase protocol changes"`

### Task 8: Production-Path Test and Fail-Closed Adapter Gate (AC-01–AC-12)

**Files:**
- Create: `tests/runtime/review-gate-protocol-release-integration.test.ts`
- Modify: `tests/runtime/opencode-adapter-v2.test.ts`
- Modify: `src/runtime/opencode-adapter.ts` **only if necessary to preserve, not remove, the Task 5 stub**
- Test: `tests/runtime/review-gate-protocol-release-publication.test.ts`
- Test: `tests/runtime/review-gate-protocol-release-authority.test.ts`

**Interfaces:**
- Exercise `provisionReviewGateWitnessInstallation` → `provisionProtocolReleaseRegistry` → `createTrustedProtocolReleaseRegistry.publishAuthenticatedProtocolRelease` → `readVerifiedReleaseSnapshot` → `createRegistryBackedVerifiedProtocolReleaseSource` → `createVerifiedProtocolReleaseProvider`.
- Test-only trusted anchor comes from separately authenticated test provisioning; it **does not** constitute Task 5 production approval.

- [ ] **Step 1: Write failing integration tests.** Build a protected temporary directory with independently generated host/publisher Ed25519 keys. Publish signed R1(design), R2(plan), R3(design) with distinct required manifest fields and authorized key/digest changes; assert positive phase delta and its old/new source digests, proof and frontier. Then independently assert `"BLOCK"` on mismatched phase, signer, historical proof, shared policy, duplicate index ambiguity, missing bytes, history rollback, unauthorized rotation, and stale head. Assert pending-only releases never appear as approved.
- [ ] **Step 2: Write fail-closed adapter regression.** Without a production Task 5 authority, invoking the adapter-wired provider in a protocol-kind NC1 attempt must return `"BLOCK"` and must not publish a success/approval event. The presence of a valid *test-only* registry does not enable production wiring.
- [ ] **Step 3: Run RED.** `bunx vitest run tests/runtime/review-gate-protocol-release-integration.test.ts tests/runtime/opencode-adapter-v2.test.ts`; expected: integration gap is exposed until Tasks 1–7 are wired in the test path.
- [ ] **Step 4: Connect only the test composition.** Wire read-only verified snapshots and mock independently trusted anchors in the integration fixture. Leave production `buildSharedReviewGateRuntimeGraph()` provider as `readVerifiedPhaseProtocolDelta: async () => "BLOCK"`. Do not install a real provider or fabricate Task 5 readiness.
- [ ] **Step 5: Run GREEN.** `bunx vitest run tests/runtime/review-gate-protocol-release-integration.test.ts tests/runtime/review-gate-protocol-release-publication.test.ts tests/runtime/review-gate-protocol-release-authority.test.ts tests/runtime/review-gate-scope-admission.test.ts tests/runtime/opencode-adapter-v2.test.ts`; expected: PASS. Recheck each AC-01–AC-12 against its test assertion and record any gap before a review gate.
- [ ] **Step 6: Run mandatory full checks inside devcontainer.** `bun run test`, `bun run typecheck`, `bun run lint`, `bun run build`; all must exit 0. Separately report skipped tests, host-only limitations and warnings; these commands are planned checks, **not yet executed**.
- [ ] **Step 7: Commit.** `git add tests/runtime/review-gate-protocol-release-integration.test.ts tests/runtime/opencode-adapter-v2.test.ts tests/runtime/review-gate-protocol-release-publication.test.ts tests/runtime/review-gate-protocol-release-authority.test.ts && git commit -m "test(review-gate): prove protocol release contract end to end"`

## Acceptance / Review Matrix

| Requirement | Proof-bearing task |
| --- | --- |
| AC-01 phase mismatch BLOCK | 1, 4, 5, 8 |
| AC-02 design/plan same digest separation | 4, 8 |
| AC-03 source vs semantic digest | 1, 2, 6, 8 |
| AC-04 common manifest signatures | 2, 5, 8 |
| AC-05 head rollback/history/old head | 3, 6, 8 |
| AC-06 authorized publisher rotation | 2, 6, 8 |
| AC-07 phase change not false global BLOCK | 7, 8 |
| AC-08 shared policy not single-phase approved | 6, 7, 8 |
| AC-09 historical runtime semantic contract | 2, 6, 8 |
| AC-10 cross-phase same-phase lineage | 4, 6, 8 |
| AC-11 signed semantic digest recoverability | 1, 2, 8 |
| AC-12 Task 5 absent → BLOCK | 8 |

## Non-Goals and Execution Gate

- This plan does **not** authorize a normative Requirements/Architecture change, production Task 5 provisioning, schema auto-migration, or enabling a real provider.
- Treat signature/root-policy schema expansion as a proposal requiring review of the versioned trust-bootstrap/migration contract. Do not claim a production-upgrade path for legacy signed releases without separate explicit approval.
- After implementing the testable release subsystem, obtain a fresh independent architecture/security review and separate Task 5 trust-boundary proof before proposing production adapter wiring.
- Stop before implementation until the human reviews this plan and selects an execution approach. Recommended: **subagent-driven**, with a fresh per-task reviewer, because errors in signed history or phase authority can silently grant incorrect NC1 transitions.
