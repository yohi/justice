# Justice Review Gate Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the v4 mutable Review Gate retry loop with the approved Issue #297 event-sourced deterministic Review Orchestrator, including staged Design/Plan approval, semantic lineage/convergence, durable restart-safe history, exact review-safe mutation/restore/commit authority, and history/implementation-approval integration.

**Architecture:** Add a focused `src/core/review-gate/` domain whose only state source is versioned durable Review Gate events. A Linux x64/glibc N-API substrate supplies non-blocking FD locks and descriptor-relative durable filesystem primitives; runtime adapters own Git/workspace I/O and OpenCode integration. `PlanBridge` becomes an adapter to `ReviewGateCoordinator` rather than owning Review Gate workflow state.

**Tech Stack:** TypeScript 6, Bun, Vitest, Zod 4, Node process/fs APIs, Rust 2021 + napi-rs + libc, Git CLI, existing OpenCode plugin hooks.

**Spec:** `docs/superpowers/specs/2026-10-06-review-gate-convergence-design.md`

**Approved Design baseline:** `1f3f22bbc329d66a1144a63ec0802d1f8d26b167`

**Approved Design blob:** `2ea580a9119b4e6369745564189c0c91ce7ced1d`

## Global Constraints

- Implement against the approved Design above; do not change the Design Spec as part of implementation.
- v4.3.1 source baseline is `a521f0d1767fba10abd778adf3a4a6f86944b268`.
- Keep `src/core/**` free of `@opencode-ai/*` imports.
- Keep the public tool surface unchanged: `OpenCodeAdapter.getTools()` still exposes only `justice_review`.
- Review Gate mutation remains pre-implementation-only: Design remediation may write Design only; Plan remediation may write Plan only; Requirements, production source, tests, CI/config/dependency/release metadata are never Review Gate model-write targets.
- Review Gate core state is reconstructed from durable events only; no mutable retry/checkpoint file is authoritative.
- Event history namespace is `.justice/review-gates/events/<reviewScopeId>/<gateId>/<writerId>.jsonl`.
- Review Gate event history is JSON-only and indefinite. Recovery CAS raw bytes are the Design-approved short-lived exception under `.justice/review-gates/recovery/objects/sha256/...`.
- Design remediation ceiling is exactly 5 total rounds per Gate generation. Plan remediation ceiling is exactly 3 total rounds per Gate generation. Epoch changes never replenish capacity.
- Current-phase disposition ordering is: OSC1 upstream precedence first; then NC1; then absolute round exhaustion; then remediation continuation.
- `--retry 0..10` remains parser-compatible, deprecated, and semantically ignored.
- Mutating Review Gate execution is supported only when the Linux Review Gate native substrate proves Linux x64 + glibc + `openat2` + `renameat2` + non-blocking `flock` + file/directory sync semantics. Missing capability blocks mutation; it never degrades to unsafe Node-only writes.
- Reuse the existing `native/review-artifact-linux` N-API binary. Do not add a second native package or a new npm/Cargo dependency.
- Native Gate locks use a descriptor-relative lock file opened with `O_CLOEXEC` and `flock(fd, LOCK_EX | LOCK_NB)`; the returned handle owns the FD and releases the lock on `close()`/process exit.
- Review Gate event/CAS/workspace durable replace uses same-directory temp creation, write, `fdatasync`, `renameat2`, and parent-directory `fsync`; all paths are descriptor-relative and symlink-safe. Review Gate directories are owner-only (`0700`) and event/CAS/lock/temp files are owner-only (`0600`).
- Never auto-restore unknown partial remediation bytes. `REMEDIATION_STARTED` without `REMEDIATION_COMPLETED` may resume only when current bytes still equal the durable preDigest; otherwise suspend with recovery conflict.
- `review_mutation` is remediator-only; `review_restore` and `review_commit` are Justice-core-only; implementation mutation remains behind `/justice-implement --approved`.
- Review Gate commit uses the GIT1 exact-artifact contract and never pushes.
- `/justice-implement --approved` must validate the exact current `CompletedApprovalBindingV1`, including Requirements, Design, Plan, and `reviewProtocolFingerprint`, before handing off to the existing plan-authorization store.
- Persist only typed/bounded/redacted Review Gate audit fields; never persist prompts, hidden reasoning, raw model/tool output, full artifacts, credentials, environment variables, or absolute host paths.
- Every task follows TDD and ends in an independently reviewable commit.
- Before implementation completion, run fresh: `bun run test`, `bun run typecheck`, `bun run lint`, and `bun run build`.

## Review Focus

1. **Corrupt current-scope genesis vs unrelated-scope corruption:** current scope MUST fail closed without creating a replacement generation, while unrelated corrupt scope MUST NOT globally deny the requested scope. Pin this in Task 4 discovery/store tests.
2. **Unknown partial remediation vs external edit:** a crash after `REMEDIATION_STARTED` with current bytes different from preDigest MUST never overwrite/restore those bytes. Pin this in Task 9 workspace recovery tests and Task 12 integration tests.
3. **NC1 vs absolute round exhaustion:** NC1 MUST win whether remaining capacity is positive or zero; only NC1 no-trigger may produce `ROUND_LIMIT_EXHAUSTED` or `REMEDIATION_REQUIRED`. Pin all four truth-table cases in Task 7 and an end-to-end final-round case in Task 15.
4. **Unrelated staged Git state:** exact Review Gate commit MUST commit only the phase artifact and preserve every unrelated index entry byte-for-byte. Pin this in Task 9 real-Git tests.
5. **Crash after prepared restore/commit:** restart MUST recover the exact intended side effect once, never duplicate it, and must conflict on any third state. Pin restore/commit recovery in Task 9 and full restart projection in Task 15.

---

## File Structure

### Core domain

- Create `src/core/review-gate/types.ts` — IDs, artifact/binding types, phase/status/workspace/lineage types, public internal contracts.
- Create `src/core/review-gate/identity.ts` — canonical JSON hashing, reviewScopeId, context/binding fingerprints, monotonic display IDs.
- Create `src/core/review-gate/protocol.ts` — Design/Plan/CrossPhase descriptors and fingerprint validation.
- Create `src/core/review-gate/requirements-resolution.ts` — strict Design-declared Requirements reference extraction and resolution decisions.
- Create `src/core/review-gate/events.ts` — EVC1 event payload union/envelope versions.
- Create `src/core/review-gate/event-codec.ts` — strict persisted-event decode/upcast/digest verification.
- Create `src/core/review-gate/persistence-policy.ts` — persistable-event schema, path/redaction/bounds enforcement.
- Create `src/core/review-gate/projection.ts` — pure event projection, invariants, effective milestones, workspace state.
- Create `src/core/review-gate/resume-cursor.ts` — ResumeCursor derivation and OSC1/current-phase priority.
- Create `src/core/review-gate/lineage.ts` — occurrence/lineage reconciliation, revalidation, resolution transitions.
- Create `src/core/review-gate/convergence.ts` — NC1 fingerprints/rules and absolute round disposition.
- Create `src/core/review-gate/deterministic-validation.ts` — descriptor registry, stage scheduling, input/cache binding, DVF1 bridge.
- Create `src/core/review-gate/capabilities.ts` — review_query/review_mutation/review_restore/review_commit/implementation authority checks.
- Create `src/core/review-gate/agent-protocol.ts` — strict external-operation request/result schemas.
- Create `src/core/review-gate/orchestrator.ts` — pure next-operation planning from projection/evidence.
- Create `src/core/review-gate/history.ts` — stable history query DTO builders.
- Keep `src/core/review-gate-command.ts` as the slash-command parser, updated for RR1/RTY1.
- Create `src/core/review-gate-history-command.ts` — read-only history command parser.

### Runtime / I/O

- Create `src/runtime/linux-native-addon.ts` — shared typed loader for the existing native binary.
- Modify `src/runtime/linux-review-artifact-provider.ts` — consume the shared native loader without behavior change.
- Create `src/runtime/linux-review-gate-provider.ts` — typed native Review Gate lock/storage/workspace adapter.
- Create `src/runtime/review-gate-event-store.ts` — DA1 scope/gate snapshots and append.
- Create `src/runtime/review-gate-lock-manager.ts` — scope/Gate/GC lock lifecycle.
- Create `src/runtime/review-gate-recovery-store.ts` — RO1 CAS publish/read/GC.
- Create `src/runtime/review-gate-artifacts.ts` — safe Requirements/Design/Plan reads and admission bindings.
- Create `src/runtime/review-gate-query.ts` — CAP1 typed, phase-scoped read/search/Git-metadata query service; no shell or repository-wide semantic review.
- Create `src/runtime/review-gate-git.ts` — GIT1 inspect/restore/commit/recovery.
- Create `src/runtime/review-gate-protocol.ts` — assembles the production typed protocol descriptor from Task 8 validator contracts and Task 10 static agent prompt contracts.
- Create `src/runtime/review-gate-coordinator.ts` — executes pure orchestrator operations, owns live lock/capability handles.
- Create `src/runtime/review-gate-history.ts` — lock-free coherent snapshot query/renderer.
- Modify `src/runtime/review-gate-tool-paths.ts` — extract read/write target paths for CAP1 enforcement.
- Modify `src/runtime/command-registration.ts` — staged Review Gate agents and history command.
- Modify `src/runtime/opencode-adapter.ts` — command/hook wiring only.

### Existing integration

- Modify `src/hooks/plan-bridge.ts` — delegate Review Gate state/work to `ReviewGateCoordinator`; retain workflow/authorization responsibilities.
- Leave `src/core/implement-command.ts` unchanged; `/justice-implement` CLI syntax is unchanged and durable approval lookup is integrated in `PlanBridge`/runtime in Task 14.
- Delete in Task 12 after all callers are migrated: `src/core/review-gate-retry-state.ts`, `src/core/review-gate-lock.ts`, and `src/core/review-gate-execution.ts`.
- Delete in Task 12 after migration: `tests/core/review-gate-retry-state.test.ts`, `tests/core/review-gate-lock.test.ts`, and `tests/core/review-gate-execution.test.ts`; their replacement coverage lives under `tests/core/review-gate/` and the new integration test.
- Rename in Task 12: `tests/integration/review-gate-adapter-retry.test.ts` → `tests/integration/review-gate-adapter-orchestration.test.ts`.

### Native

- Modify `native/review-artifact-linux/src/lib.rs` — add Review Gate root, `flock` handles, durable shard/CAS/workspace primitives.
- Do not add crates; use existing `libc`, `napi`, `napi-derive`.
- Create `spikes/review-gate-linux/verify.ts` — focused host proof for lock/durability contract.

### Tests

- Create `tests/core/review-gate/*.test.ts` for domain contracts.
- Create `tests/runtime/linux-review-gate-provider*.test.ts`.
- Create `tests/runtime/review-gate-*.test.ts`.
- Create `tests/integration/review-gate-event-sourced-flow.test.ts`.
- Create `tests/integration/review-gate-restart-recovery.test.ts`.
- Update existing Review Gate command/adapter/authorization tests rather than duplicating legacy expectations.

---

## Design Contract Ownership

| Approved Design contract | Owning implementation tasks |
| --- | --- |
| ARCH1 authority split / agents as evidence producers | 3, 5, 10, 11, 12 |
| R1 / C1 / L1 scope discovery + process-lifetime locks | 1, 4, 12, 13 |
| G1 generation lifecycle / completion | 4, 5, 11, 12 |
| E1 epochs + absolute Design 5 / Plan 3 rounds | 5, 7, 11, 15 |
| RR1 Requirements resolution | 2, 12, 15 |
| PF1 phase/global protocol descriptors | 2, 8, 10, 12, 15 |
| CB1 completed binding reuse / implementation staleness | 2, 4, 5, 12, 14 |
| IP1 DESIGN_CLEAR inheritance | 5, 11, 15 |
| CTX1 baseline revision + semantic context identity | 2, 5, 6, 12, 15 |
| P1 / DA1 / SV1 causal log, durability, schema evolution | 1, 3, 4 |
| PR1 / RET1 persistence policy + indefinite history | 3, 4, 13 |
| RO1 recovery CAS | 1, 4, 9, 12 |
| WSP1 workspace authority / exact restore | 5, 9, 11, 12, 15 |
| CLR1 Design/Plan CLEAR milestones | 5, 11, 15 |
| RI1 reopen / invalidation | 5, 6, 11, 12, 15 |
| LNR1 / AR1 finding identity + pinned validation | 6, 10, 11, 12 |
| XG1 / XGR1 cross-generation lineage | 6, 10, 11 |
| EV1 evidence vs authoritative mutation | 3, 6, 11, 12 |
| OSC1 ownerScope/upstream precedence | 5, 6, 7, 11 |
| RV1 stale-lineage revalidation | 6, 10, 11 |
| RSL1 / FR1 resolution + history-blind fresh review | 5, 6, 10, 11, 12 |
| AIM1 attempt/operation/dispatch identity | 2, 5, 10, 11, 12 |
| SRF1 self-review findings / carry-forward | 6, 7, 10, 11 |
| VAL1 / VSC1 deterministic validators + cache | 2, 8, 11, 12 |
| DVF1 deterministic finding bridge | 6, 8, 11 |
| NC1 / N1 non-convergence + material-progress reentry | 7, 10, 11, 15 |
| CAP1 query/mutation/restore/commit authority | 9, 10, 12 |
| CP1 event-sourced recovery journal / ResumeCursor | 5, 9, 11, 12, 15 |
| GIT1 exact-artifact commit | 9, 12, 15 |
| HQ1 history query | 4, 5, 13 |
| RTY1 deprecated `--retry` no-op | 2, 15 |
| EVC1 catalog + projection invariants | 3, 5, 11, 15 |

### Task 1: Prove and publish the Linux Review Gate native substrate

**Files:**
- Modify: `native/review-artifact-linux/src/lib.rs`
- Create: `src/runtime/linux-native-addon.ts`
- Modify: `src/runtime/linux-review-artifact-provider.ts`
- Create: `src/runtime/linux-review-gate-provider.ts`
- Create: `tests/runtime/linux-review-gate-provider.test.ts`
- Create: `tests/runtime/linux-review-gate-provider-mock.test.ts`
- Modify: `tests/runtime/linux-review-artifact-provider-mock.test.ts`
- Create: `spikes/review-gate-linux/verify.ts`

**Interfaces:**
- Produces:
  - `loadJusticeLinuxNativeAddon(): JusticeLinuxNativeAddon | undefined`
  - `createLinuxReviewGateProvider(rootDir: string): LinuxReviewGateProvider | undefined`
  - `LinuxReviewGateProvider.acquireScopeLock(reviewScopeId: string): Promise<ReviewGateLockHandle | "occupied">`
  - `LinuxReviewGateProvider.acquireGateLock(gateId: string): Promise<ReviewGateLockHandle | "occupied">`
  - `LinuxReviewGateProvider.acquireRecoveryGcLock(): Promise<ReviewGateLockHandle | "occupied">`
  - `LinuxReviewGateProvider.listScopeIds(): Promise<readonly string[]>`
  - `LinuxReviewGateProvider.listGateIds(reviewScopeId: string): Promise<readonly string[]>`
  - `LinuxReviewGateProvider.listWriterIds(reviewScopeId: string, gateId: string): Promise<readonly string[]>`
  - `LinuxReviewGateProvider.readWriterShard(...): Promise<Buffer | null>`
  - `LinuxReviewGateProvider.durableReplaceWriterShard(..., bytes: Buffer): Promise<void>`
  - `LinuxReviewGateProvider.publishRecoveryObject(digest: string, bytes: Buffer): Promise<"created" | "exists">`
  - `LinuxReviewGateProvider.readRecoveryObject(digest: string): Promise<Buffer | null>`
  - `LinuxReviewGateProvider.listRecoveryObjects(): Promise<readonly string[]>`
  - `LinuxReviewGateProvider.deleteRecoveryObject(digest: string): Promise<void>`
  - `LinuxReviewGateProvider.readWorkspaceFile(path: string): Promise<Buffer | null>`
  - `LinuxReviewGateProvider.replaceWorkspaceFileExact(path: string, expectedCurrentDigest: string, replacement: Buffer): Promise<void>`
- Native lock primitive: descriptor-relative regular file + `O_CLOEXEC` + `flock(LOCK_EX | LOCK_NB)`; handle owns FD.

- [ ] **Step 1: Write native/runtime RED tests for the capability surface**

Add tests that assert:
- second independent scope/Gate lock acquisition returns occupied,
- closing the first handle permits reacquisition,
- lock FD has `FD_CLOEXEC`,
- unsupported runtime/native API returns no provider,
- writer shard durable replace round-trips bytes,
- recovery object create is no-replace and exact-existing is accepted,
- workspace replace rejects a current-digest mismatch,
- every ID/path validator rejects traversal, slash injection, malformed SHA-256, and symlinked workspace ancestors.

Run: `bun run vitest run tests/runtime/linux-review-gate-provider.test.ts tests/runtime/linux-review-gate-provider-mock.test.ts`  
Expected: FAIL because the provider/API does not exist.

- [ ] **Step 2: Add focused Rust tests before N-API wiring**

In `native/review-artifact-linux/src/lib.rs`, add focused tests for:
- `flock` non-blocking collision/release,
- `FD_CLOEXEC`,
- file `fdatasync`,
- parent directory `fsync`,
- `renameat2` same-directory publish,
- `RENAME_NOREPLACE` recovery object publication,
- descriptor-relative workspace path traversal rejection.

Run: `cargo test --manifest-path native/review-artifact-linux/Cargo.toml --features test`  
Expected: FAIL until the low-level primitives are implemented.

- [ ] **Step 3: Implement the native Review Gate root in the existing addon**

Add N-API exports:
- `probeReviewGateCapabilities()`
- `openReviewGateRoot(rootDir: string)`

The native root owns the workspace root FD and exposes only typed scope/gate/writer/digest operations listed above. Use existing `openat2` helper patterns; never accept a raw arbitrary `.justice` path from JS. Create Review Gate directories with mode `0700` and lock/event/CAS/temp files with mode `0600`; tests must assert the effective modes under a normal umask.

The durable replace sequence is exactly:

```text
open/create same-directory temp with O_CLOEXEC|O_EXCL
→ write all bytes
→ fdatasync(temp)
→ renameat2(temp, final)
→ fsync(parent directory)
→ reopen/readback when the caller requires verification
```

The immutable recovery publish uses `RENAME_NOREPLACE`.

- [ ] **Step 4: Add the shared TS addon loader and adapters**

Move native binary loading/type guarding to `linux-native-addon.ts`. Keep existing review-artifact behavior unchanged. Implement `linux-review-gate-provider.ts` as a safe error-mapping wrapper around the new native root.

- [ ] **Step 5: Add the focused host spike**

`spikes/review-gate-linux/verify.ts` must print one JSON report with PASS/BLOCKED cases:

```text
exclusive_scope_lock
exclusive_gate_lock
lock_release_on_close
lock_cloexec
writer_shard_durable_publish
recovery_object_noreplace
workspace_exact_replace_guard
symlinked_ancestor_rejected
```

Run:

```bash
bun run build:native:review-artifact
bun spikes/review-gate-linux/verify.ts
```

Expected on supported Linux x64/glibc: `status: "PASS"` and every case PASS.

- [ ] **Step 6: Run regression tests for the existing artifact provider**

Run:
```bash
bun run vitest run   tests/runtime/linux-review-artifact-provider.test.ts   tests/runtime/linux-review-artifact-provider-mock.test.ts   tests/integration/review-artifact-linux-e2e.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add native/review-artifact-linux/src/lib.rs   src/runtime/linux-native-addon.ts   src/runtime/linux-review-artifact-provider.ts   src/runtime/linux-review-gate-provider.ts   tests/runtime/linux-review-gate-provider.test.ts   tests/runtime/linux-review-gate-provider-mock.test.ts   tests/runtime/linux-review-artifact-provider-mock.test.ts   spikes/review-gate-linux/verify.ts
git commit -m "feat: add durable Review Gate native substrate"
```

---

### Task 2: Define Review Gate identities, protocol fingerprints, RR1 resolution, and command compatibility

**Files:**
- Create: `src/core/review-gate/types.ts`
- Create: `src/core/review-gate/identity.ts`
- Create: `src/core/review-gate/protocol.ts`
- Create: `src/core/review-gate/requirements-resolution.ts`
- Create: `src/runtime/review-gate-artifacts.ts`
- Modify: `src/core/review-gate-command.ts`
- Create: `tests/core/review-gate/identity.test.ts`
- Create: `tests/core/review-gate/protocol.test.ts`
- Create: `tests/core/review-gate/requirements-resolution.test.ts`
- Modify: `tests/core/review-gate-command.test.ts`

**Interfaces:**
- Produces:
  - branded string aliases `ReviewScopeId`, `GateId`, `WriterId`, `ReviewAttemptId`, `OperationId`, `LineageId`, `OccurrenceId`
  - `ArtifactBinding = { canonicalPath: string; digest: string }`
  - `computeReviewScopeId(designPath: string, planPath: string): ReviewScopeId`
  - `computePhaseReviewContextIdentity(...): string`
  - `computeDesignApprovalBindingFingerprint(binding): string`
  - `computeCompletedApprovalBindingFingerprint(binding): string`
  - `buildReviewProtocolDescriptor(input: ReviewProtocolDescriptorInput): ReviewProtocolDescriptorV1`
  - `computeProtocolFingerprints(descriptor): ReviewProtocolFingerprints`
  - `extractDesignRequirementsReference(markdown: string): RequirementsReferenceExtraction`
  - `ReviewGateArtifactReader.readRegularWorkspaceFile(path: string): Promise<Buffer | null>`
- Updates `ReviewGateRequest` to:
```ts
export interface ReviewGateRequest {
  readonly source: "command";
  readonly requirementsPath: string | null;
  readonly designPath: string;
  readonly planPath: string;
  readonly legacyRetryOption: number | null;
}
```

- [ ] **Step 1: Write RED identity/protocol tests**

Pin:
- exact `justice-review-scope-v1\0<design>\0<plan>` hash input,
- canonical JSON key ordering,
- phase-local vs global fingerprint invalidation examples from PF1,
- CrossPhase-only change leaves phase fingerprints unchanged,
- shared policy version drift returns `REVIEW_PROTOCOL_DESCRIPTOR_INVALID`.

Run: `bun run vitest run tests/core/review-gate/identity.test.ts tests/core/review-gate/protocol.test.ts`  
Expected: FAIL.

- [ ] **Step 2: Implement domain types, canonical hashing, descriptors, and bindings**

Use immutable readonly structures. Do not include model/provider/runtime identity in protocol fingerprints.

Task 2 implements only the **pure descriptor schema/fingerprint machinery**. `ReviewProtocolDescriptorInput` explicitly accepts:
- Design/Plan/CrossPhase semantic contract versions and policies,
- static reviewer/validator/remediator/self-review prompt digests,
- deterministic validator contract descriptors,
- absolute Design/Plan round limits.

Task 2 tests use fixed descriptor fixtures. Do **not** assemble the production descriptor here: Task 8 supplies the production deterministic validator contract set, Task 10 supplies the static agent prompt contracts, and Task 12 wires both through `src/runtime/review-gate-protocol.ts`.

- [ ] **Step 3: Write RED RR1 tests**

Cover:
- explicit `--requirements` wins,
- exactly one strict Design metadata reference auto-resolves,
- zero/multiple/malformed reference produces `REQUIREMENTS_RESOLUTION_REQUIRED`,
- filesystem/date/stem/Plan inference is never attempted,
- explicit path differing from Design declaration remains explicit and yields a later consistency condition rather than resolver override,
- unsafe/symlink/non-regular files are rejected through the runtime artifact reader.

The accepted Design reference syntax is one top-level metadata line:

```markdown
**Requirements:** `docs/superpowers/requirements/<file>.md`
```

Also accept the same path without backticks. Multiple canonical matches are ambiguous.

- [ ] **Step 4: Implement the pure extractor plus runtime artifact reader**

The extractor returns candidates only; the runtime reader uses Task 1 native workspace reads and computes SHA-256 digests.

Add explicit opaque ID issuers for Justice-owned identities:
```ts
newGateId(): GateId
newReviewAttemptId(): ReviewAttemptId
newOperationId(): OperationId
newOccurrenceId(): OccurrenceId
```
backed by `randomUUID()`. Task 6 owns lineage ID issuance: Justice core derives the next generation-local, owner-scoped monotonic `LineageId` from projection state (Design/Plan examples `DG-L-NNN` / `PG-L-NNN`); validators only select Justice-provided opaque existing-lineage refs and never supply a new lineage ID.

- [ ] **Step 5: Update the slash-command parser for RR1 and RTY1**

Accept:
```text
--requirements <path>   optional
--design <path>         required
--plan <path>           required
--retry 0..10           optional deprecated syntax
```

`--retry` populates `legacyRetryOption` only. It has no protocol/history/budget effect.

Run: `bun run vitest run tests/core/review-gate-command.test.ts tests/core/review-gate/*.test.ts`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/review-gate src/runtime/review-gate-artifacts.ts   src/core/review-gate-command.ts tests/core/review-gate tests/core/review-gate-command.test.ts
git commit -m "feat: define Review Gate identities and protocol"
```

---

### Task 3: Define strict versioned events and persistence policy

**Files:**
- Create: `src/core/review-gate/events.ts`
- Create: `src/core/review-gate/event-codec.ts`
- Create: `src/core/review-gate/persistence-policy.ts`
- Create: `tests/core/review-gate/events.test.ts`
- Create: `tests/core/review-gate/persistence-policy.test.ts`

**Interfaces:**
- Produces:
  - `ReviewGateEventEnvelopeV1`
  - strict `ReviewGateEvent` union containing every EVC1 event from Design §33
  - `encodeReviewGateEvent(event): string`
  - `decodeReviewGateEvent(line): ReviewGateDecodeResult`
  - `buildNextReviewGateEvent(expectedHead, input): ReviewGateEvent`
  - `toPersistableReviewGateEvent(input): PersistableReviewGateEvent`
  - separate error kinds `REVIEW_HISTORY_CONFLICT`, `REVIEW_HISTORY_VERSION_UNSUPPORTED`, `EVENT_PERSISTENCE_POLICY_VIOLATION`

- [ ] **Step 1: Write RED schema/catalog tests**

Use a table containing every Design §33 event type. Assert:
- each has explicit `payloadVersion`,
- `GATE_CREATED` is genesis revision 1/null predecessor,
- later events require exact predecessor ID/digest and revision +1,
- unknown envelope/event/payload version is VERSION_UNSUPPORTED,
- understood malformed/integrity-invalid event is HISTORY_CONFLICT,
- unknown fields in authority payloads are rejected.

Run: `bun run vitest run tests/core/review-gate/events.test.ts`  
Expected: FAIL.

- [ ] **Step 2: Implement strict schemas and canonical event digesting**

Use Zod `.strict()` at persistence boundaries. Persisted-version canonicalization must be version-specific and immutable.

- [ ] **Step 3: Write RED persistence-policy tests**

Reject:
- absolute paths,
- full artifact bodies/excerpts,
- prompt/raw model/tool output keys,
- environment/credential fields,
- unbounded display text.

Assert semantic authority fields are never silently truncated/redacted. Display-only text may be bounded.

- [ ] **Step 4: Implement `PersistableReviewGateEvent` boundary**

Required pipeline:

```text
typed event builder
→ persistence sanitizer + strict schema
→ PersistableReviewGateEvent
→ durable store
```

- [ ] **Step 5: Run tests**

Run: `bun run vitest run tests/core/review-gate/events.test.ts tests/core/review-gate/persistence-policy.test.ts`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/review-gate/events.ts src/core/review-gate/event-codec.ts   src/core/review-gate/persistence-policy.ts   tests/core/review-gate/events.test.ts tests/core/review-gate/persistence-policy.test.ts
git commit -m "feat: define durable Review Gate event protocol"
```

---

### Task 4: Implement durable event store, scope discovery, OS locks, and recovery CAS

**Files:**
- Create: `src/runtime/review-gate-event-store.ts`
- Create: `src/runtime/review-gate-lock-manager.ts`
- Create: `src/runtime/review-gate-recovery-store.ts`
- Create: `src/core/review-gate/discovery.ts`
- Create: `tests/runtime/review-gate-event-store.test.ts`
- Create: `tests/runtime/review-gate-lock-manager.test.ts`
- Create: `tests/runtime/review-gate-recovery-store.test.ts`
- Create: `tests/core/review-gate/discovery.test.ts`

**Interfaces:**
- Produces:
```ts
interface ReviewGateEventStore {
  snapshotScope(reviewScopeId: ReviewScopeId): Promise<ReviewGateScopeSnapshot>;
  snapshotGate(reviewScopeId: ReviewScopeId, gateId: GateId): Promise<ReviewGateGateSnapshot>;
  append(input: {
    reviewScopeId: ReviewScopeId;
    gateId: GateId;
    writerId: WriterId;
    expectedHead: ReviewGateHead | null;
    event: PersistableReviewGateEvent;
  }): Promise<void>;
}

interface ReviewGateLockManager {
  acquireScope(reviewScopeId: ReviewScopeId): Promise<ReviewGateLockLease | "busy">;
  acquireGate(gateId: GateId): Promise<ReviewGateLockLease | "busy">;
  acquireRecoveryGc(): Promise<ReviewGateLockLease | "busy">;
}

interface ReviewGateRecoveryStore {
  put(bytes: Buffer): Promise<RecoveryObjectRef>;
  get(ref: RecoveryObjectRef): Promise<Buffer>;
  sweep(liveDigests: ReadonlySet<string>): Promise<void>;
}
```
- `selectReviewGateGeneration(scopeProjection, currentBinding): GateDiscoveryDecision`

- [ ] **Step 1: Write RED store tests for scope membership and coherent snapshots**

Cover Review Focus #1:
- corrupt `GATE_CREATED` under the requested `reviewScopeId` namespace blocks discovery and cannot become “no history”,
- corrupt unrelated scope is not opened during requested-scope discovery,
- same-scope broken/multiple tips produce `REVIEW_GATE_IDENTITY_CONFLICT`,
- supersedes target outside scope is conflict,
- exact completed binding returns read-only reuse,
- binding mismatch creates a fresh generation with immediate predecessor.

Run: `bun run vitest run tests/runtime/review-gate-event-store.test.ts tests/core/review-gate/discovery.test.ts`  
Expected: FAIL.

- [ ] **Step 2: Implement stable shard snapshot, writer allocation, and P1 merge**

Allocate one fresh `WriterId` per coordinator/orchestration-owner lifetime using the existing `w-${randomUUID()}` convention from `src/runtime/writer-id.ts`; retry if that writer shard already exists in the selected Gate. A restarted owner always uses a new writer shard. `writerId` and writer sequence are never cross-shard ordering authority.

Read each writer shard exactly once per snapshot. Verify per-writer sequence, then reconstruct one causal chain by revision/predecessor/digest; never timestamp-sort a fork.

- [ ] **Step 3: Implement append expected-head checks**

Under the caller-held Gate lock:
- reread current shard/snapshot,
- reject expected-head mismatch,
- encode previous shard bytes + one line,
- call native durable replace,
- do not truncate/repair malformed tails.

- [ ] **Step 4: Implement R1 scope/Gate lock ordering**

```text
scope LOCK_EX|LOCK_NB
→ snapshot/select generation
→ exact completed binding match:
     return immutable reuse
     do NOT acquire Gate lock
     do NOT create writer shard/event
→ otherwise acquire selected/new Gate lock
→ reread/reproject selected Gate
→ release scope lock
→ retain Gate lock for orchestration invocation
```

The event store exposes no automatic history-delete/rotation API in v4. ACTIVE, SUSPENDED, COMPLETED, corrupt, and unsupported Gate directories are retained indefinitely.

- [ ] **Step 5: Implement RO1 CAS**

Hash exact bytes, publish by digest, read back and verify. GC marks from all safely projected retained histories; if any potentially relevant retained history is unprojectable, do not sweep.

- [ ] **Step 6: Run focused tests**

Run:
```bash
bun run vitest run   tests/runtime/review-gate-event-store.test.ts   tests/runtime/review-gate-lock-manager.test.ts   tests/runtime/review-gate-recovery-store.test.ts   tests/core/review-gate/discovery.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/runtime/review-gate-event-store.ts src/runtime/review-gate-lock-manager.ts   src/runtime/review-gate-recovery-store.ts src/core/review-gate/discovery.ts   tests/runtime/review-gate-event-store.test.ts tests/runtime/review-gate-lock-manager.test.ts   tests/runtime/review-gate-recovery-store.test.ts tests/core/review-gate/discovery.test.ts
git commit -m "feat: persist and discover Review Gate generations"
```

---

### Task 5: Implement pure projection, WSP1 workspace state, approval milestones, and ResumeCursor

**Files:**
- Create: `src/core/review-gate/projection.ts`
- Create: `src/core/review-gate/resume-cursor.ts`
- Create: `tests/core/review-gate/projection.test.ts`
- Create: `tests/core/review-gate/resume-cursor.test.ts`

**Interfaces:**
- Produces:
  - `projectReviewGate(events: readonly ReviewGateEvent[]): ReviewGateProjection`
  - `deriveResumeCursor(projection: ReviewGateProjection): ReviewGateResumeCursor`
  - effective `DesignClearMilestone`
  - `ReviewTargetWorkspaceState = CLEAN_COMMITTED | KNOWN_DIRTY | MUTATION_IN_FLIGHT`
  - `currentRemediableBlockers`, `currentUpstreamBlockers`, `pendingRevalidationBlockers`
  - `phaseBaselineRevision` + `PhaseReviewContextIdentity`

- [ ] **Step 1: Write RED projection invariant tests**

Table-test Design §34:
- `PLAN_CLEAR` terminal,
- at most one effective Design CLEAR,
- invalidation references exact effective milestone,
- Plan phase requires Design CLEAR,
- stale attempt cannot authorize CLEAR,
- OPEN→RESOLVED only by resolution event,
- pending revalidation blocks CLEAR,
- restore authority and unknown partial invariants,
- Design round >5 / Plan round >3 is history conflict,
- protocol-only drift can stale context without baseline revision increment,
- `DESIGN_CLEAR_INHERITED` is valid only from the exact immediate `supersedesGateId` COMPLETED predecessor with an exact `DesignApprovalBindingV1`; it establishes the effective Design milestone without pretending to be reviewed in the new generation,
- `DESIGN_CLEAR` / `PLAN_CLEAR` clearanceBasis references a current RECONCILED fresh review and its exact candidate/validation/reconciliation evidence events,
- completed generation accepts no later diagnostic or state-transition event.

Run: `bun run vitest run tests/core/review-gate/projection.test.ts`  
Expected: FAIL.

- [ ] **Step 2: Implement the pure event fold**

No filesystem, clock, model, or process calls. Freeze returned snapshots.

- [ ] **Step 3: Write RED ResumeCursor tests**

Cover:
- target restore required/recovery required before reopen,
- commit recovery,
- remediation recovery,
- validation/reconciliation steps,
- Design→Plan→PLAN_CLEAR,
- completed returns COMPLETED,
- suspended operational failures stay SUSPENDED until their specific recovery/reentry condition.

Do not yet assert NC1 choice; Task 7 supplies that decision input.

- [ ] **Step 4: Implement cursor derivation with explicit disposition seam**

Define:
```ts
export type CurrentPhaseDisposition =
  | { readonly kind: "non_convergent"; readonly payload: ReviewNonConvergentPayload }
  | { readonly kind: "round_limit" }
  | { readonly kind: "remediate" };

export function deriveResumeCursor(
  projection: ReviewGateProjection,
  currentPhaseDisposition?: CurrentPhaseDisposition,
): ReviewGateResumeCursor;
```

OSC1 upstream precedence and workspace restore ordering are handled before the current-phase disposition input.

- [ ] **Step 5: Run tests and commit**

Run: `bun run vitest run tests/core/review-gate/projection.test.ts tests/core/review-gate/resume-cursor.test.ts`  
Expected: PASS.

```bash
git add src/core/review-gate/projection.ts src/core/review-gate/resume-cursor.ts   tests/core/review-gate/projection.test.ts tests/core/review-gate/resume-cursor.test.ts
git commit -m "feat: project Review Gate state and resume cursor"
```

---

### Task 6: Implement semantic finding lineage, revalidation, resolution, and cross-generation links

**Files:**
- Create: `src/core/review-gate/lineage.ts`
- Create: `tests/core/review-gate/lineage.test.ts`

**Interfaces:**
- Produces:
```ts
reconcileFindingBatch(
  projection: ReviewGateProjection,
  evidence: ValidatedFindingBatch,
): FindingReconciliationCommitPayload

commitLineageRevalidation(
  projection: ReviewGateProjection,
  evidence: LineageRevalidationEvidence,
): LineageRevalidationCommitPayload

buildLineageResolution(
  projection: ReviewGateProjection,
  input: ResolutionCommitInput,
): LineageResolutionCommitPayload

selectFindingDisposition(
  phase: ReviewPhase,
  lineages: readonly ProjectedLineage[],
): ScopeDisposition

issueNextLineageId(
  projection: ReviewGateProjection,
  ownerScope: FindingOwnerScope,
): LineageId
```

- [ ] **Step 1: Write RED lineage identity tests**

Pin:
- Justice issues lineage IDs; validator supplies only opaque existing refs,
- VALID+EXISTING resolved defect present → REGRESSED, same ID,
- NEW cannot be ALREADY_RESOLVED,
- duplicate candidates in one snapshot map to one blocker,
- minor/advisory persists but never blocks/remediates,
- ownerScope/phase/decision mismatch is `VALIDATOR_RESULT_CONFLICT`,
- same-generation canonical basis immutable, confirmed basis may vary by context.

- [ ] **Step 2: Write RED RV1/RSL1 tests**

Pin:
- STILL_PRESENT revalidation creates no occurrence/counter,
- RESOLVED uses `LINEAGE_RESOLUTION_COMMITTED`,
- INDETERMINATE remains pending and blocks CLEAR,
- reviewer absence never resolves,
- post-remediation resolution requires verified commit binding,
- external-change resolution uses `EXTERNAL_CHANGE_REVALIDATION`.

- [ ] **Step 3: Write RED XG1/XGR1 tests**

Pin:
- new generation always gets a new lineage ID,
- immediate predecessor only,
- predecessor relation never inherits counters,
- malformed/ambiguous cross-gen result prevents lineage finalization.

Run: `bun run vitest run tests/core/review-gate/lineage.test.ts`  
Expected: FAIL.

- [ ] **Step 4: Implement lineage functions and batch consistency checks**

No partial mutation payload is returned when any batch entry conflicts.

- [ ] **Step 5: Run tests and commit**

```bash
bun run vitest run tests/core/review-gate/lineage.test.ts
git add src/core/review-gate/lineage.ts tests/core/review-gate/lineage.test.ts
git commit -m "feat: reconcile Review Gate finding lineage"
```

---

### Task 7: Implement NC1 semantic convergence and absolute remediation disposition

**Files:**
- Create: `src/core/review-gate/convergence.ts`
- Create: `tests/core/review-gate/convergence.test.ts`
- Modify: `tests/core/review-gate/resume-cursor.test.ts`

**Interfaces:**
- Produces:
```ts
computeBlockerLandscapeFingerprint(...): string
computeConvergenceFingerprint(...): string
evaluateNonConvergence(projection: ReviewGateProjection): NonConvergenceDecision
decideCurrentPhaseRemediationDisposition(
  projection: ReviewGateProjection,
  decision: NonConvergenceDecision,
): CurrentPhaseDisposition
```

- [ ] **Step 1: Write RED tests for all six NC1 rules**

Pin exact priority:
1. RESOLVED_LINEAGE_REGRESSED
2. REMEDIATION_OSCILLATION
3. SAME_LINEAGE_STALL
4. CONTRACT_CONFLICT_REPEATED
5. BLOCKER_LANDSCAPE_REPEATED
6. BLOCKER_COUNT_NOT_IMPROVING

Exclude advisory and PENDING_REVALIDATION.

- [ ] **Step 2: Write the four disposition truth-table tests from the Design Review**

```text
NC1 trigger + capacity > 0  → REVIEW_NON_CONVERGENT
NC1 trigger + capacity == 0 → REVIEW_NON_CONVERGENT
NC1 no-trigger + capacity == 0 → ROUND_LIMIT_EXHAUSTED
NC1 no-trigger + capacity > 0  → REMEDIATION_REQUIRED
```

Also assert OSC1 upstream blockers bypass this current-phase decision entirely.

- [ ] **Step 3: Implement descriptor hashing, cycle reconstruction, and decision priority**

No mutable convergence counter file. Derive streaks from durable remediation-cycle events.

- [ ] **Step 4: Integrate with ResumeCursor tests**

Final Design round 5/Plan round 3 must have no next-round cursor. NC1 still wins on the final round.

- [ ] **Step 5: Run tests and commit**

```bash
bun run vitest run tests/core/review-gate/convergence.test.ts tests/core/review-gate/resume-cursor.test.ts
git add src/core/review-gate/convergence.ts tests/core/review-gate/convergence.test.ts   tests/core/review-gate/resume-cursor.test.ts
git commit -m "feat: detect Review Gate semantic non-convergence"
```

---

### Task 8: Implement registered deterministic validation, scheduling, caching, and DVF1 bridge

**Files:**
- Create: `src/core/review-gate/deterministic-validation.ts`
- Create: `tests/core/review-gate/deterministic-validation.test.ts`

**Interfaces:**
- Produces:
```ts
interface DeterministicValidatorDescriptor {
  readonly validatorId: string;
  readonly validatorContractVersion: number;
  readonly resultSchemaVersion: number;
  readonly applicablePhases: readonly ReviewPhase[];
  readonly executionKind: "IN_PROCESS" | "ISOLATED_PROCESS";
  readonly declaredInputs: readonly ValidationInputKind[];
  readonly mandatoryStages: readonly ValidationStage[];
  readonly stageFailurePolicy: Readonly<Record<ValidationStage, "PRECONDITION" | "FINDING">>;
  readonly rules: readonly DeterministicValidationRuleDescriptor[];
}

class DeterministicValidatorRegistry {
  register(descriptor: DeterministicValidatorDescriptor, runner: InProcessValidator): void;
  resolve(validatorId: string): RegisteredValidator | undefined;
}

computeValidationCacheKey(binding: ValidationInputBinding): string
scheduleMandatoryValidations(...): readonly ValidationRequirement[]
bridgeDeterministicFindings(...): DeterministicFindingsObservedPayload
```

- [ ] **Step 1: Write RED scheduling/cache tests**

Pin:
- PRE_CLEAR reuses exact PASS evidence,
- exact FAIL/INDETERMINATE evidence can also be reused,
- execution failure is never cached,
- a changed executable/runtime binding on a **new** logical validation causes cache miss,
- redispatch of the **same** logical validation operation with a changed execution-environment binding fails closed as `VALIDATION_ENVIRONMENT_CHANGED_DURING_ATTEMPT`,
- undeclared input use is impossible through runner interface,
- BASELINE_ADMISSION FAIL creates no finding,
- same `(validationEventId, ruleId)` creates at most one occurrence.

- [ ] **Step 2: Register the v4 in-process validators**

Production registry contains:
1. `review-input-binding-integrity-v1` — BASELINE_ADMISSION, PRECONDITION; verifies pinned paths/digests/approved Design binding can be reconstructed.
2. `design-requirements-reference-consistency-v1` — Design POST_REMEDIATION_SELF_REVIEW + PRE_CLEAR, FINDING; major/design-owned rule when the Design-declared Requirements reference differs from the bound Requirements path.

Do not register general lint/test/build commands.

`ISOLATED_PROCESS` descriptors are representable but produce unavailable/execution-failure evidence mapped to `DETERMINISTIC_VALIDATION_FAILED` unless a future registered runner supplies the Design-required sandbox contract; no v4 production descriptor uses it. This path never fabricates PASS/FAIL/INDETERMINATE semantic evidence.

- [ ] **Step 3: Implement cache/input bindings and DVF1 bridge**

Severity/ownerScope/violationType/governingReference/violatedContract come from the rule descriptor, never from an LLM.

- [ ] **Step 4: Run tests and commit**

```bash
bun run vitest run tests/core/review-gate/deterministic-validation.test.ts
git add src/core/review-gate/deterministic-validation.ts   tests/core/review-gate/deterministic-validation.test.ts
git commit -m "feat: add deterministic Review Gate validation"
```

---

### Task 9: Implement CAP1, exact workspace restore, and exact-artifact Git commit

**Files:**
- Create: `src/core/review-gate/capabilities.ts`
- Create: `src/runtime/review-gate-query.ts`
- Create: `src/runtime/review-gate-git.ts`
- Modify: `src/runtime/review-gate-tool-paths.ts`
- Create: `tests/core/review-gate/capabilities.test.ts`
- Create: `tests/runtime/review-gate-query.test.ts`
- Create: `tests/runtime/review-gate-git.test.ts`
- Modify: `tests/runtime/review-gate-tool-paths.test.ts`

**Interfaces:**
- Produces:
```ts
type ReviewQueryScope = Readonly<{
  phase: ReviewPhase;
  allowedArtifactPaths: ReadonlySet<string>;
  allowedGitPaths: ReadonlySet<string>;
}>;

interface ReviewGateQueryService {
  readArtifact(scope: ReviewQueryScope, path: string): Promise<Buffer>;
  searchArtifact(
    scope: ReviewQueryScope,
    path: string,
    literal: string,
  ): Promise<readonly ReviewQueryMatch[]>;
  getScopedStatus(scope: ReviewQueryScope): Promise<ReviewGitStatus>;
  getScopedDiff(
    scope: ReviewQueryScope,
    request: ReviewDiffRequest,
  ): Promise<ReviewGitDiff>;
  resolveRevision(ref: ReviewRevisionRef): Promise<string>;
  getScopedLog(
    scope: ReviewQueryScope,
    request: ReviewLogRequest,
  ): Promise<readonly ReviewGitLogEntry[]>;
  showPathAtRevision(
    scope: ReviewQueryScope,
    ref: ReviewRevisionRef,
    path: string,
  ): Promise<Buffer>;
}

class ReviewGateCapabilityRegistry {
  issueMutation(input: ReviewMutationCapabilityInput): ReviewMutationCapability;
  consumeMutation(capabilityId: string, use: ScopedToolUse): ReviewCapabilityDecision;
}

class ReviewGateGit {
  inspectTarget(path: string): Promise<ReviewTargetGitBinding>;
  prepareRestore(input: ReviewRestorePrepareInput): Promise<ReviewTargetRestorePreparedPayload>;
  executePreparedRestore(payload: ReviewTargetRestorePreparedPayload): Promise<ReviewRestoreResult>;
  recoverPreparedRestore(payload: ReviewTargetRestorePreparedPayload): Promise<ReviewRestoreRecoveryResult>;
  prepareCommit(input: ReviewCommitPrepareInput): Promise<ReviewCommitPreparedPayload>;
  executePreparedCommit(payload: ReviewCommitPreparedPayload): Promise<VerifiedReviewCommit>;
  recoverPreparedCommit(payload: ReviewCommitPreparedPayload): Promise<ReviewCommitRecoveryResult>;
}
```

- [ ] **Step 1: Write RED CAP1 query-scope and actor tests**

For `ReviewGateQueryService`, pin:
- Design scope = bound Requirements + current Design only,
- Plan scope = effective approved Design + current Plan only,
- self-review/remediation scope is explicitly constructed from upstream authority + current phase target,
- artifact search is an in-process literal search over already authorized bytes; it cannot traverse/glob another path,
- status/diff/log/show are pathscoped to `allowedGitPaths`,
- revision resolution accepts only Justice-defined symbolic refs/validated Git object IDs, not shell fragments,
- Git reads use `spawn("git", args, { shell: false })`,
- no query API accepts arbitrary executable, argv, cwd, environment, or repository-wide path omission,
- raw query output is transient/bounded and is never itself durable Review Gate authority.

Pin actor/operation matrix:
- reviewer/finding-validator/self-review query-only,
- remediator has a single-use capability tied to gate/operation/phase/round/path/preDigest/context,
- stale/consumed/wrong-path mutation denied,
- core restore and core commit are not model capabilities,
- implementation-capable/unknown tools remain denied.

- [ ] **Step 2: Implement the typed query service and expand tool-path extraction to read scope**

Implement `ReviewGateQueryService` using Task 1 safe workspace reads plus non-mutating Git subprocess calls with `shell:false`. Search is performed in-process on authorized artifact bytes. Every Git operation includes an explicit authorized path list except `resolveRevision`, which resolves only a validated ref and returns an object ID.

Extract canonical target paths for the model-visible `read`, edit/write variants, and `apply_patch`. Do not expose shell, repository-wide grep/glob, or a new public plugin tool. The coordinator injects any scoped Git/query metadata required by an operation packet; agents may additionally use `read` only for exact phase-authorized paths.

- [ ] **Step 3: Write RED real-Git GIT1 tests**

In a temporary Git repository assert:
- target must be HEAD == index == worktree at new phase admission,
- unrelated dirty paths are allowed,
- unrelated staged paths are allowed,
- commit changes exactly target path,
- unrelated index fingerprint is identical before/after,
- hooks and signing do not run,
- prepared parent/blob/message mismatch conflicts,
- exact intended commit is recovered after simulated crash,
- third-state HEAD causes recovery conflict,
- commit message is exactly:
```text
docs: address <design|plan> review round <N>

Review-Gate: <design|plan>
Review-Round: <N>
Findings: <comma-separated sorted lineage IDs>
```
  with no Gate ID, operation ID, validator internals, or push side effect,
- scope mismatch → `REVIEW_COMMIT_SCOPE_VIOLATION`, Git/process failure before verified success → `REVIEW_COMMIT_FAILED`, and unprovable crash state → `REVIEW_COMMIT_RECOVERY_CONFLICT`.

- [ ] **Step 4: Implement Git runner without shell interpolation**

Use `spawn("git", args, { shell: false })`.

Commit args are equivalent to:

```text
-c core.hooksPath=/dev/null
commit --only --no-gpg-sign --no-status --cleanup=verbatim
--pathspec-from-file=- --pathspec-file-nul
-F <Justice-owned-message-file>
```

Write exactly one NUL-terminated target path to stdin.

- [ ] **Step 5: Write RED WSP1 restore/recovery tests**

Cover Review Focus #2 and #5:
- known dirty exact source → clean committed exact destination,
- source/target/path mismatch → `REVIEW_RESTORE_SCOPE_VIOLATION`,
- exact prepared restore execution failure before verified destination → `REVIEW_RESTORE_FAILED`,
- prepared restore + source state → safe re-execute,
- prepared restore + destination state → recovered,
- any third state → `REVIEW_RESTORE_RECOVERY_CONFLICT`,
- Requirements/prod/tests/config paths cannot be restore targets.

- [ ] **Step 6: Implement `review_restore` through Task 1 native exact replace**

Get clean bytes by verified Git blob identity; pass only the durable source digest + clean bytes to `replaceWorkspaceFileExact`; recheck HEAD/index before and after.

- [ ] **Step 7: Run tests and commit**

```bash
bun run vitest run   tests/core/review-gate/capabilities.test.ts   tests/runtime/review-gate-query.test.ts   tests/runtime/review-gate-tool-paths.test.ts   tests/runtime/review-gate-git.test.ts

git add src/core/review-gate/capabilities.ts src/runtime/review-gate-query.ts   src/runtime/review-gate-git.ts   src/runtime/review-gate-tool-paths.ts tests/core/review-gate/capabilities.test.ts   tests/runtime/review-gate-query.test.ts tests/runtime/review-gate-git.test.ts   tests/runtime/review-gate-tool-paths.test.ts
git commit -m "feat: enforce Review Gate mutation and Git authority"
```

---

### Task 10: Replace retry-worker protocol with typed staged Review Gate agents

**Files:**
- Create: `src/core/review-gate/agent-protocol.ts`
- Replace: `src/core/review-gate-execution.ts` with a compatibility re-export only until Task 12 removes legacy imports
- Modify: `src/runtime/command-registration.ts`
- Create: `tests/core/review-gate/agent-protocol.test.ts`
- Modify: `tests/core/review-gate-execution.test.ts`
- Modify: `tests/runtime/command-registration.test.ts`

**Interfaces:**
- Agent names:
```text
justice-review-controller
justice-review-reviewer
justice-review-finding-validator
justice-review-remediator
```
- `justice-review-finding-validator` is reused with a fresh context for ordinary finding validation, self-review, lineage revalidation, cross-generation reconciliation, and non-convergence reentry.
- Produces strict schemas:
  - `ReviewCandidatesResultV1`
  - `FindingValidationResultV1`
  - `RemediationResultV1`
  - `SelfReviewResultV1`
  - `LineageRevalidationResultV1`
  - `CrossGenerationReconciliationResultV1`
  - `NonConvergenceReentryResultV1`
  - `ReviewGateOperationPacketV1`

- [ ] **Step 1: Write RED strict result-schema tests**

Every result must bind exact `operationId` plus its attempt/round context. Unknown fields, stale IDs, duplicate results, and malformed typed semantic basis fail closed. Raw output is discarded after strict parse.

- [ ] **Step 2: Define agent permissions**

```text
controller: task only
reviewer: read only
finding-validator: read only
remediator: read + edit/write/apply_patch; hook/CAP1 narrows actual scope
```

No worker receives shell, generic task, `justice_review`, or commit/restore authority.

- [ ] **Step 3: Rewrite controller prompt as a dumb exact packet relay**

Remove Retry-Budget semantics. The controller invokes exactly the Justice-supplied operation packet, then only follows a subsequent Justice-supplied NEXT OPERATION packet. It never chooses phase, round, retry, finding status, or commit/reopen action.

Export the immutable static prompt text/contracts and `computeReviewGatePromptContractDigests()`; these exact digests are consumed by Task 12's production protocol factory. The digest set has explicit keys `designReviewer`, `planReviewer`, `findingValidator`, `remediator`, and `selfReview`; dynamic gate/attempt/round/artifact values are excluded from the static digest.

- [ ] **Step 4: Implement operation prompt builders/parsers**

Every operation that Design requires to use a fresh context (ordinary finding validation, self-review, lineage revalidation, cross-generation reconciliation, and non-convergence reentry) MUST dispatch a new foreground task with no continuation/session reuse. A redispatch after crash/malformed output keeps the same logical `operationId` but still uses a fresh physical child task and increments `dispatchSerial`.

Review prompt inputs are exactly phase-scoped:
- Design reviewer/validator: Requirements + Design.
- Plan reviewer/validator: approved Design + Plan.
- Remediator reads upstream authority + current phase target, writes only target.
- Fresh reviewer receives no lineage/remediation history.
- Any Git/status/diff/log/show/revision evidence in an operation packet comes only from Task 9 `ReviewGateQueryService`, is bounded to the same phase scope, and is evidence only; workers never receive a shell/Git execution capability.

- [ ] **Step 5: Update registration tests and commit**

```bash
bun run vitest run tests/core/review-gate/agent-protocol.test.ts   tests/core/review-gate-execution.test.ts tests/runtime/command-registration.test.ts

git add src/core/review-gate/agent-protocol.ts src/core/review-gate-execution.ts   src/runtime/command-registration.ts tests/core/review-gate/agent-protocol.test.ts   tests/core/review-gate-execution.test.ts tests/runtime/command-registration.test.ts
git commit -m "feat: stage Review Gate agent operations"
```

---

### Task 11: Implement the pure event-sourced Review Gate orchestrator

**Files:**
- Create: `src/core/review-gate/orchestrator.ts`
- Create: `tests/core/review-gate/orchestrator.test.ts`

**Interfaces:**
- Produces:
```ts
export type ReviewGateNextOperation =
  | { readonly kind: "dispatch_reviewer"; ... }
  | { readonly kind: "dispatch_finding_validator"; ... }
  | { readonly kind: "commit_finding_reconciliation"; ... }
  | { readonly kind: "dispatch_lineage_revalidation"; ... }
  | { readonly kind: "start_remediation"; ... }
  | { readonly kind: "recover_remediation"; ... }
  | { readonly kind: "dispatch_self_review"; ... }
  | { readonly kind: "prepare_restore"; ... }
  | { readonly kind: "recover_restore"; ... }
  | { readonly kind: "prepare_commit"; ... }
  | { readonly kind: "recover_commit"; ... }
  | { readonly kind: "commit_resolutions"; ... }
  | { readonly kind: "append_reopen"; ... }
  | { readonly kind: "run_pre_clear_validation"; ... }
  | { readonly kind: "append_design_clear"; ... }
  | { readonly kind: "append_plan_clear"; ... }
  | { readonly kind: "validate_non_convergence_reentry"; ... }
  | { readonly kind: "suspended"; ... }
  | { readonly kind: "completed"; ... };

export function planReviewGateNextOperation(
  projection: ReviewGateProjection,
  context: ReviewGatePlanningContext,
): ReviewGateNextOperation;
```

- [ ] **Step 1: Write RED state-machine scenario tests**

At minimum:
- new Gate → Design review,
- inherited Design CLEAR → Plan review,
- Design blocker → remediation,
- Plan Design-owned blocker → restore if dirty then Design reopen,
- Requirements reopen,
- remediation → self-review → commit → resolution → fresh review,
- self-review current blocker → NC1/capacity/remediation truth table,
- deterministic PRE_CLEAR finding → normal finding/disposition,
- PLAN_CLEAR terminal,
- unsupported/corrupt history never reaches orchestrator mutation.

- [ ] **Step 2: Write RED crash-window planning tests**

For every intent/completion boundary:
- external operation dispatched/no completion,
- remediation started/completed,
- restore prepared/completed,
- commit prepared/completed,
- resolution pending,
- fresh review pending.

Assert exactly one next operation.

- [ ] **Step 3: Implement pure planning**

The orchestrator emits decisions only. It never touches filesystem/Git/model/runtime clocks.

- [ ] **Step 4: Run tests and commit**

```bash
bun run vitest run tests/core/review-gate/orchestrator.test.ts
git add src/core/review-gate/orchestrator.ts tests/core/review-gate/orchestrator.test.ts
git commit -m "feat: plan Review Gate orchestration from events"
```

---

### Task 12: Add `ReviewGateCoordinator` and migrate PlanBridge/OpenCode hook integration

**Files:**
- Create: `src/runtime/review-gate-protocol.ts`
- Create: `src/runtime/review-gate-coordinator.ts`
- Modify: `src/hooks/plan-bridge.ts`
- Modify: `src/runtime/opencode-adapter.ts`
- Modify: `tests/hooks/plan-bridge-review-lock.test.ts`
- Rename: `tests/integration/review-gate-adapter-retry.test.ts` → `tests/integration/review-gate-adapter-orchestration.test.ts`
- Modify: `tests/integration/review-gate-implementation-lock.test.ts`
- Modify: `tests/runtime/opencode-adapter.test.ts`
- Remove: `src/core/review-gate-retry-state.ts`
- Remove: `src/core/review-gate-lock.ts`
- Remove: `src/core/review-gate-execution.ts`
- Remove: `tests/core/review-gate-retry-state.test.ts`
- Remove: `tests/core/review-gate-lock.test.ts`
- Remove: `tests/core/review-gate-execution.test.ts`

**Interfaces:**
- Produces:
```ts
class ReviewGateCoordinator {
  startOrResume(sessionId: string, request: ReviewGateRequest): Promise<ReviewGateCommandResult>;
  preToolUse(event: Extract<HookEvent,{type:"PreToolUse"}>): Promise<HookResponse | null>;
  postToolUse(event: Extract<HookEvent,{type:"PostToolUse"}>): Promise<HookResponse | null>;
  classifyToolUse(rootSessionId: string | null, use: ScopedReviewToolUse): ReviewCapabilityDecision | undefined;
  releaseSession(sessionId: string): void;
}
```
- `PlanBridge.setReviewGateCoordinator(coordinator: ReviewGateCoordinator): void`
- Existing `PlanBridge.handleReviewGateStart/pre/post/classify` become thin delegation seams during migration.

- [ ] **Step 1: Write RED coordinator integration tests**

Assert:
- command start performs RR1 + target-clean admission before `GATE_CREATED`,
- scope lock then Gate lock ordering,
- exact completed binding is read-only reuse with no Gate lock acquisition, writer allocation, or append,
- active/suspended generation resumes same durable gate with a fresh writer shard,
- initial Design phase admission rejects a dirty/staged Design target before `GATE_CREATED`,
- Plan phase admission rejects a dirty/staged Plan target before the first Plan review, including after current/inherited Design CLEAR,
- missing native mutation capability returns blocked guidance without unsafe fallback,
- lock handle is retained across worker operations and released on terminal return/session teardown/process-close seam,
- external worker completion cannot mutate state without matching durable dispatch event,
- a relevant Requirements/Design/Plan binding change during a pinned attempt suspends as `REVIEW_INPUT_CHANGED_DURING_ATTEMPT` and no mixed-snapshot validator result is accepted,
- reviewer/validator execution failure after durable dispatch projects the typed `EXECUTION_SUSPENDED` reason (including `FRESH_REVIEW_FAILED` where applicable) without repeating a completed remediation/restore/commit side effect.

- [ ] **Step 2: Assemble the production protocol descriptor, then implement the coordinator execution loop**

Implement `src/runtime/review-gate-protocol.ts` to combine:
- Task 10 immutable static prompt-contract digests,
- Task 8 deterministic validator semantic contracts/stages/rules,
- Design/Plan/CrossPhase fixed semantic policy versions and absolute 5/3 ceilings.

All newly introduced `*ContractVersion` / policy-version fields start at integer `1`; future semantic changes increment the owning field instead of reusing version 1 with new meaning. Shared finding-validator/severity/resolution/lineage/convergence semantics are supplied identically to both phase descriptors. The controller relay contract version is CrossPhase-only.

The factory returns the one current `ReviewProtocolDescriptorV1` plus Design/Plan/global fingerprints. No placeholder prompt digest or runtime/model/provider identity is permitted.

For each pure `ReviewGateNextOperation`:
1. append required intent/evidence event,
2. build the exact phase `ReviewQueryScope` and gather only the typed Task 9 query evidence required by that operation,
3. execute the one permitted side effect,
4. strict-parse result,
5. append typed completion/mutation event,
6. reproject,
7. derive next operation.

No in-memory retry state.

- [ ] **Step 3: Migrate PreToolUse/PostToolUse claims**

Bind worker session/call to durable `operationId`, not retry round state. Remediator tool checks consume the exact CAP1 mutation capability. Read operations are limited to phase-approved artifact paths.

- [ ] **Step 4: Remove legacy retry state/files and legacy session Review Gate lock authority**

After all Task 12 imports are migrated:
```bash
git rm   src/core/review-gate-retry-state.ts   src/core/review-gate-lock.ts   src/core/review-gate-execution.ts   tests/core/review-gate-retry-state.test.ts   tests/core/review-gate-lock.test.ts   tests/core/review-gate-execution.test.ts

git mv   tests/integration/review-gate-adapter-retry.test.ts   tests/integration/review-gate-adapter-orchestration.test.ts
```

Session maps may retain transient call/lock handles only; durable Gate state comes from event projection.

- [ ] **Step 5: Run integration regressions**

```bash
bun run vitest run   tests/hooks/plan-bridge-review-lock.test.ts   tests/integration/review-gate-adapter-orchestration.test.ts   tests/integration/review-gate-implementation-lock.test.ts   tests/runtime/opencode-adapter.test.ts
```

Expected: PASS with new semantics.

- [ ] **Step 6: Commit**

```bash
git add src/runtime/review-gate-protocol.ts src/runtime/review-gate-coordinator.ts   src/hooks/plan-bridge.ts src/runtime/opencode-adapter.ts   tests/hooks/plan-bridge-review-lock.test.ts   tests/integration/review-gate-adapter-orchestration.test.ts   tests/integration/review-gate-implementation-lock.test.ts   tests/runtime/opencode-adapter.test.ts

git commit -m "feat: orchestrate Review Gate from durable events"
```

---

### Task 13: Add durable `/justice-review-history` query and stable DTO rendering

**Files:**
- Create: `src/core/review-gate-history-command.ts`
- Create: `src/core/review-gate/history.ts`
- Create: `src/runtime/review-gate-history.ts`
- Modify: `src/runtime/command-registration.ts`
- Modify: `src/runtime/opencode-adapter.ts`
- Create: `tests/core/review-gate-history-command.test.ts`
- Create: `tests/core/review-gate/history.test.ts`
- Create: `tests/runtime/review-gate-history.test.ts`
- Modify: `tests/runtime/command-registration.test.ts`

**Interfaces:**
- Command parser supports:
```text
/justice-review-history --design <path> --plan <path> [--view summary|rounds|findings] [--all-generations]
/justice-review-history --gate <gateId> [--view summary|rounds|findings]
```
- Produces `HistorySummaryDto`, `HistoryRoundsDto`, `HistoryFindingsDto`.

- [ ] **Step 1: Write RED parser/query tests**

Pin mutual exclusivity of `--gate` vs Design+Plan, safe paths, view enum, and `--all-generations`.

- [ ] **Step 2: Write RED snapshot/selection tests**

Cover:
- query captures scope/gate shard bytes once and projects one coherent prefix,
- unique ACTIVE/SUSPENDED tip default,
- otherwise completed chain tip,
- broken/multiple tips conflict,
- `--gate` locates a unique `events/*/<gateId>/` namespace without decoding genesis for membership,
- conflict/version unsupported returns failure, never partial display.

- [ ] **Step 3: Implement stable DTO builders/renderers**

Summary includes exactly the Design HQ1 fields: IDs/status/phase/epoch, Design CLEAR authority, blocker counts, pending revalidation, absolute remediation usage/remaining, last transition/commit, ResumeCursor, gateRevision/headEventId.

Do not expose raw events. History querying never deletes, compacts, repairs, or rewrites retained event history. Storage diagnostics (gate/completed/active/suspended counts, event count/bytes, recovery object count/bytes, oldest Gate when available) are non-authoritative display data only.

- [ ] **Step 4: Wire command registration and command.execute.before**

History command has no agent and causes no Gate lock, event append, epoch, resume, artifact re-resolution, or validator call. Replace host-expanded prompt parts with Justice-generated read-only result text.

- [ ] **Step 5: Run tests and commit**

```bash
bun run vitest run tests/core/review-gate-history-command.test.ts   tests/core/review-gate/history.test.ts tests/runtime/review-gate-history.test.ts   tests/runtime/command-registration.test.ts

git add src/core/review-gate-history-command.ts src/core/review-gate/history.ts   src/runtime/review-gate-history.ts src/runtime/command-registration.ts   src/runtime/opencode-adapter.ts tests/core/review-gate-history-command.test.ts   tests/core/review-gate/history.test.ts tests/runtime/review-gate-history.test.ts   tests/runtime/command-registration.test.ts
git commit -m "feat: query durable Review Gate history"
```

---

### Task 14: Bind `/justice-implement --approved` to the durable completed approval

**Files:**
- Create: `src/runtime/review-gate-approval.ts`
- Modify: `src/hooks/plan-bridge.ts`
- Modify: `tests/hooks/plan-bridge-implement.test.ts`
- Modify: `tests/hooks/plan-bridge-authorization.test.ts`
- Modify: `tests/integration/review-gate-implementation-lock.test.ts`

**Interfaces:**
- Produces:
```ts
interface ReviewGateApprovalLookup {
  findCurrentCompletedApproval(planPath: string): Promise<
    | { readonly kind: "approved"; readonly gateId: GateId; readonly binding: CompletedApprovalBindingV1 }
    | { readonly kind: "not_approved" }
    | { readonly kind: "identity_conflict" }
    | { readonly kind: "history_unavailable" }
  >;
}
```

- [ ] **Step 1: Write RED approval lookup tests**

Enumerate completed candidates whose persisted `CompletedApprovalBindingV1.plan.canonicalPath` equals the requested Plan path. For each candidate, re-read the persisted Requirements/Design/Plan canonical paths, compute current digests plus the Task 12 production `reviewProtocolFingerprint`, and retain only exact structured-binding matches.

A plan is approved only when exactly one exact current match has:
- current Requirements canonical path + digest,
- current Design canonical path + digest,
- current Plan canonical path + digest,
- current `reviewProtocolFingerprint`,
all exactly equal to persisted `CompletedApprovalBindingV1`.

Test Requirements-only, Design-only, Plan-only, protocol-only drift → not approved. Zero exact matches → `not_approved`; more than one exact current match across scope namespaces → `identity_conflict`.

- [ ] **Step 2: Write RED restart tests**

Without any in-memory Review Gate lock/session state, a restarted process can still approve an exact completed binding. Multiple candidate completed approvals for one plan without unique exact current binding fail closed.

- [ ] **Step 3: Implement lookup and integrate `handleImplementationArm`**

Replace current process-local `reviewGateLock.designDigest/planDigest` approval authority with durable lookup. After durable approval succeeds, keep the existing `AuthorizationStore` canonical plan snapshot/fingerprint flow unchanged for implementation task authorization.

- [ ] **Step 4: Assert stale completed Gate is never mutated**

Approval lookup is read-only; binding mismatch does not append invalidation to the old completed Gate.

- [ ] **Step 5: Run tests and commit**

```bash
bun run vitest run   tests/hooks/plan-bridge-implement.test.ts   tests/hooks/plan-bridge-authorization.test.ts   tests/integration/review-gate-implementation-lock.test.ts

git add src/runtime/review-gate-approval.ts src/hooks/plan-bridge.ts   tests/hooks/plan-bridge-implement.test.ts tests/hooks/plan-bridge-authorization.test.ts   tests/integration/review-gate-implementation-lock.test.ts
git commit -m "feat: bind implementation approval to Review Gate history"
```

---

### Task 15: Add full lifecycle/restart E2E coverage, retire legacy semantics, and update architecture docs

**Files:**
- Create: `tests/integration/review-gate-event-sourced-flow.test.ts`
- Create: `tests/integration/review-gate-restart-recovery.test.ts`
- Modify: `tests/integration/review-gate-adapter-orchestration.test.ts`
- Modify: `README.md`
- Modify: `SPEC.md`
- Modify: `AGENTS.md` only to synchronize invariants; do not add implementation guidance that belongs in code/tests.

**Interfaces:**
- No new production interfaces. This task proves the integrated contract and removes stale documentation/naming.

- [ ] **Step 1: Write the full Design→Plan CLEAR E2E**

Use a temporary Git/workspace and deterministic fake agent runner:
1. RR1 resolution,
2. Design review/reconciliation,
3. Design remediation/self-review/exact commit/fresh review,
4. DESIGN_CLEAR,
5. Plan review,
6. PLAN_CLEAR,
7. history query,
8. `/justice-implement --approved`.

Assert durable history alone reconstructs the same final projection after creating a fresh coordinator instance.

- [ ] **Step 2: Add Review Focus restart/crash E2E cases**

Cover:
- Review Focus #1 corrupt current scope vs unrelated corrupt scope,
- Review Focus #2 unknown partial bytes never overwritten,
- Review Focus #3 final round with NC1 trigger chooses NON_CONVERGENT even with zero capacity; no-trigger chooses ROUND_LIMIT,
- Review Focus #4 unrelated staged index survives commit,
- Review Focus #5 prepared restore/commit recover exactly once and conflict on third state.

- [ ] **Step 3: Add reopen/invalidation/protocol-change E2E cases**

Cover:
- Plan finding owned by Design → dirty Plan restore → DESIGN_REOPEN_REQUIRED,
- Design finding owned by Requirements → dirty Design restore → REQUIREMENTS_REOPEN_REQUIRED,
- Requirements/Design change invalidates both phase progress,
- Plan-only change retains Design CLEAR,
- Design protocol change invalidates Design+Plan; Plan-only protocol change invalidates Plan only; CrossPhase-only change keeps phase lineage applicability but prevents completed binding reuse.

- [ ] **Step 4: Add non-convergence/reentry/absolute-limit E2E cases**

Prove all six NC1 triggers, N1 material progress guard, and that no execution path creates Design round 6 or Plan round 4.

- [ ] **Step 5: Remove stale retry terminology**

The legacy retry-state/execution/lock files and tests were already deleted/renamed in Task 12. In remaining tests/docs, remove descriptions that treat `retryBudget`, textual `contentChanged == false`, or combined Design+Plan review as authoritative behavior. Keep only RTY1 parser compatibility assertions for `legacyRetryOption`.

- [ ] **Step 6: Update README/SPEC/AGENTS to the shipped architecture**

Document:
- staged Design→Plan Gate,
- Requirements flag/auto-resolution,
- absolute 5/3 rounds,
- `/justice-review-history`,
- durable restart semantics,
- explicit `/justice-implement --approved` binding,
- Linux mutation capability requirement,
- actor-separated mutation/restore/commit authority.

Do not copy the full Design Spec into README.

- [ ] **Step 7: Run focused integration suite**

```bash
bun run vitest run   tests/integration/review-gate-event-sourced-flow.test.ts   tests/integration/review-gate-restart-recovery.test.ts   tests/integration/review-gate-implementation-lock.test.ts
```

Expected: PASS.

- [ ] **Step 8: Run full verification fresh**

```bash
bun run test
bun run typecheck
bun run lint
bun run build
cargo test --manifest-path native/review-artifact-linux/Cargo.toml --features test
bun run build:native:review-artifact
bun spikes/review-gate-linux/verify.ts
```

Expected:
- all test suites PASS,
- typecheck/lint/build exit 0,
- native cargo tests PASS,
- Review Gate Linux spike reports `status: "PASS"`.

- [ ] **Step 9: Verify branch scope**

Run:
```bash
git diff --name-status a521f0d1767fba10abd778adf3a4a6f86944b268...HEAD
git status --short
```

Confirm every changed production/test/doc/native file is named by this Implementation Plan and there are no accidental dependency/version/release changes.

- [ ] **Step 10: Commit**

```bash
git add   tests/integration/review-gate-event-sourced-flow.test.ts   tests/integration/review-gate-restart-recovery.test.ts   tests/integration/review-gate-adapter-orchestration.test.ts   README.md SPEC.md AGENTS.md
git commit -m "test: verify event-sourced Review Gate workflow"
```

---

## Implementation Plan Completion Contract

Before implementation starts, Fresh Implementation Plan Review Gate must verify:

1. The `Design Contract Ownership` table remains complete: every approved R1–RTY1 / EVC1 / CTX1 / ARCH1 contract maps to at least one owning task and every owning task keeps the approved Design semantics unchanged.
2. Native lock/durability implementation choice is fixed: existing `native/review-artifact-linux` binary, `flock(LOCK_EX|LOCK_NB)`, `O_CLOEXEC`, descriptor-relative `openat2`, `renameat2`, `fdatasync`, parent `fsync`; no package/API choice remains for the implementer.
3. Event-store/CAS layout and exact TS/native interfaces are fixed.
4. Finding/lineage/NC1/round-limit priority is tested before runtime orchestration integration.
5. CAP1 `review_query` is implemented as typed phase-scoped reads/search/Git metadata with no arbitrary shell or scope expansion; `review_mutation`, `review_restore`, `review_commit`, and implementation authority are separate in both types and integration tests.
6. Restore and commit crash windows have exact prepared/succeeded/recovered/conflict tests.
7. History query and implementation approval consume durable projection, not process-local Review Gate state.
8. `--retry` exists only as deprecated parser compatibility.
9. No Task asks the implementer to choose architecture, a library, a lock primitive, a storage format, an error policy, or a test strategy.
10. Production protocol descriptor assembly occurs only after deterministic validator contracts and static agent prompt contracts exist; no placeholder fingerprint inputs are used.
11. GIT1 commit subject/trailers and REVIEW_COMMIT/REVIEW_RESTORE error taxonomy are fixed and tested.
12. Validation environment drift and review-input drift have explicit fail-closed tests before OpenCode integration.
13. Production implementation MUST NOT begin until this Plan's Fresh Implementation Plan Review Gate is READY.
