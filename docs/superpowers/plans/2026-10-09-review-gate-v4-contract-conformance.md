# Justice v4 Review Gate Contract Conformance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a restart-safe, fail-closed Justice v4 `/justice-review-gate` whose durable authority, finite remediation budget, semantic resolution, Requirements selection, completed approval and production integration satisfy ratified Issue #297/#310 without importing v5 architecture.

**Architecture:** Preserve existing v4 coordinator, Linux native provider and OpenCode/Superpowers/OmO integration. Introduce deterministic Core admission/transition planners, protected workspace-wide scope witness, versioned causally linked JSONL evidence, verified legacy bridge and exact Git operation recovery. A new completed successor *always* receives a fresh Design Gate; original Requirements V2 admission provenance remains immutable while current authority advances only through verified durable events.

**Tech Stack:** TypeScript, Bun, Vitest, OpenCode v1.18.x, Node Git process APIs with `--literal-pathspecs`, existing Linux x86_64/glibc native N-API addon and Git; devcontainer from `.devcontainer/devcontainer.json`.

**Spec:** `docs/superpowers/specs/2026-10-09-review-gate-v4-contract-conformance-design.md` at commit `b573874f426e221eb50bf242a3f27662efb18842`, Design blob `fe072b444534b1cc58f1c5b9d2e60494f66158c3`. **Ratified upstream:** `SPEC.md` §4.1c, #297 and #310 at amendment commit `5b33b79bb27a26c00e79f950c7211a625b4727bf` (DEP-01 RATIFIED).

**Planning status:** PLAN DRAFT / REVIEW REQUIRED. This document grants **no** permission to edit production code, execute tasks, deploy, merge or claim Implementation Ready. Human review/approval of this Implementation Plan and an independent implementation authorization are required before Task 1.

## Global Constraints

- **Authority:** Justice Core owns admission, budgets, transitions, resolution and CLEAR; agent assertions, hook session maps, partial event replays and unverified cache state do not.
- **Budget:** at most **Design 5, Plan 3** remediation rounds *per generation*. Crash, SUSPENDED resume, NC1 reentry, changed path pair, legacy migration or `--retry 0..10` never replenish spent rounds.
- **Admission:** validate independently protected workspace-wide continuity before new scope enrollment; only one verified immediate **completed** predecessor permits a successor; even Plan-only change triggers a **fresh Design Gate**. No `DESIGN_CLEAR_INHERITED` event for new v4 Gates.
- **Persistence:** writer-sharded `.justice/review-gates/events/<reviewScopeId>/<gateId>/<writerId>.jsonl`, typed/versioned causal events with an independently durable scope frontier; schema-policy max **64 KiB UTF-8/event**, **256-byte ID**, **4096-byte canonical path**, **128 refs/event**. No prompts, raw worker results, secrets or content bodies in the ledger.
- **Scope witness:** separate OS-protected host-state security boundary with verified monotone publication and fsync properties. Do **not** claim whole-volume/root/adversary-with-both-writes rollback protection. Missing/untrusted witness => BLOCK.
- **Legacy:** never mutate `<gateId>/events.jsonl`, `dispatches.jsonl` or original recovery objects. Only independently anchored, provably complete authority can pass verified bridge; otherwise preserve and BLOCK.
- **Requirements:** optional `--requirements <path>` or exactly one valid Design preamble marker `<!-- justice-review-gate:requirements="docs/requirements/feature.md" -->`. Separate, committed Git-tracked Requirements file. New `RequirementsResolutionV2.source = "explicit" | "design_declared_reference"`; historical V1 remains versioned, `auto_design_reference` is **not** new authority.
- **Historical/current binding:** `committedBaselineOid` is immutable admission Git commit H0. Current Requirements/Design and declaration are separately durably revalidated/rebased; unrelated HEAD changes do not cause drift. Completed approval references **both** historical V2 and verified current-effective authority.
- **Review/commit:** mandatory `BASELINE_ADMISSION`, `POST_REMEDIATION_SELF_REVIEW`, `PRE_CLEAR`; self-review discoveries reconciled before commit; verified exact-artifact Git success before lineage resolution; only one predeclared target. No Requirements/prod/test/CI edits by remediator.
- **NC1:** evaluate all six rules in normative priority, upstream precedence before stale revalidation before NC1 before round exhaustion. NC1 resume requires both eligible committed change and independently verified `MATERIAL_PROGRESS`.
- **Compatibility:** all caller-specified string `subagent_type` values including `"general"` are caller-owned; preserve `PlanTask.rawBody`, `task-N` isolation, actual `ses_...` continuations and implementation lock. Shared language-info-aware Markdown fence scanner.
- **Verification:** run in configured devcontainer as `remoteUser`. **Before declaring EACH task complete**, run all four fresh: `bun run test`, `bun run typecheck`, `bun run lint`, `bun run build`, in addition to its targeted RED/GREEN command. Report failures, warnings and skipped tests separately. Rust/native verification as applicable. `BLOCKED`, `SKIPPED`, `NOT RUN` never count as PASS.
- **No automatic implementation:** Task steps are instructions for a future approved worker; no source/test/config changes during writing-plans. Do not reopen ratified DEP-01 or silently amend upstream contracts. Any normative incompatibility is a new explicit approval dependency.

## Review Focus

The following five user-visible input/failure classes have explicit owner tests in Tasks 2, 5, 7, 10, 15 and 16:

1. User passes `--requirements` and an agreeing **or disagreeing** Design marker; identical selectors succeed, disagreement blocks before `GATE_CREATED` (Tasks 2–3).
2. User relabels Design/Plan to change scope ID while an unfinished Gate consumed rounds; workspace-wide witness refuses new-budget enrollment (Tasks 5 and 7).
3. Process crashes between a real single-target Git commit and authority revalidation; same commit/round is recovered, original V2 intact (Tasks 10 and 15).
4. Design remediation moves an otherwise valid marker within preamble; fresh D1 proof succeeds while a changed target path blocks commit (Task 15).
5. Unrelated Git HEAD-only change after completed approval must not create a successor, whereas a stale Requirements blob or selector must block approval (Task 16).

## File/Responsibility Map

- **Pure Core additions:** `src/core/markdown-fence-scanner.ts`; `src/core/review-gate/{requirements-resolution,event-schema,admission,cycle-evidence,reentry,requirements-authority}.ts`.
- **Pure Core focused modifications:** `src/core/{review-gate-command,review-gate-types,plan-parser,dependency-analyzer}.ts`; `src/core/review-gate/{projection,orchestrator,lineage,convergence,deterministic-validation,resume-cursor,types}.ts`.
- **Runtime additions:** `src/runtime/review-gate-{requirements,scope-witness,scope-admission,legacy-bridge}.ts`.
- **Runtime focused modifications:** `src/runtime/review-gate-{event-store,lock-manager,recovery-store,git,approval,history,protocol,coordinator}.ts`; `src/runtime/linux-review-gate-provider.ts` only if required by proven native capability interface.
- **Hook/adapter:** `src/hooks/plan-bridge.ts` and final host adapter where existing wire normalization is implemented.
- **Tests:** exact matching tests under `tests/core`, `tests/core/review-gate`, `tests/runtime`, `tests/hooks`, `tests/integration`. Prefer extending existing test files and adding focused files for new modules. Actual host opt-in: `tests/integration/review-artifact-linux-host-e2e.test.ts`, `tests/runtime/linux-review-gate-provider-e2e.test.ts`.
- **Scope boundary:** do not alter Design Spec or ratified `SPEC.md` as part of implementation without separate review; no bulk coordinator rewrite, host-independent Core I/O, or generalized v5 framework.

---

### Task 1: Shared Markdown Fence Grammar

**Files:**
- Create: `src/core/markdown-fence-scanner.ts`
- Modify: `src/core/plan-parser.ts`, `src/core/dependency-analyzer.ts`
- Test: `tests/core/plan-parser.test.ts`, `tests/core/dependency-analyzer.test.ts` (both already exist)

**Interfaces:**
- Produces: `scanMarkdownFenceLines(text: string): ReadonlyArray<{ line: string; lineNumber: number; insideFence: boolean }>`; both consumers use this scanner.
- Contract: 0..3 spaces, backtick/tilde fences, valid language info, matching close length/character, LF/CRLF; preserve original raw task body.

- [ ] **Step 1: Write RED tests** — `it("ignores language-fenced Interfaces and task headings")`: a fenced `**Interfaces:**` / `### Task 99` yields no dependency/task, but an unfenced exact `**Interfaces:**` still enforces sequential execution. Assert `PlanTask.rawBody` equals source slice.
- [ ] **Step 2: Verify RED** — `bun run vitest run tests/core/dependency-analyzer.test.ts tests/core/plan-parser.test.ts`; expect at least the new assertions FAIL.
- [ ] **Step 3: Implement scanner and replace both independent fence detectors** — reuse one typed `scanMarkdownFenceLines` result, never normalize PlanTask body or change task identity.
- [ ] **Step 4: Verify GREEN** — same focused command, then all four global checks; expect 0 failing tests, type errors or lint errors.
- [ ] **Step 5: Commit** — `git add src/core/markdown-fence-scanner.ts src/core/plan-parser.ts src/core/dependency-analyzer.ts tests/core/plan-parser.test.ts tests/core/dependency-analyzer.test.ts && git commit -m "fix: share review plan Markdown fence grammar"`.

### Task 2: Requirements Public CLI and Declaration Parser

**Files:**
- Create: `src/core/review-gate/requirements-resolution.ts`, `tests/core/review-gate/requirements-resolution.test.ts`
- Modify: `src/core/review-gate-command.ts`
- Test: `tests/core/review-gate-command.test.ts`, new requirements-resolution test

**Interfaces:**
- Produces: `ReviewGateRequest.requirementsPath?: string`; `parseDesignRequirementsDeclaration(design: string): { kind: "none" } | { kind: "selected"; canonicalPath: string; line: number; markerDigest: string } | { kind: "invalid"; reason: string }`; `selectRequirementsSource(input: { explicitPath?: string; declaration: ReturnType<typeof parseDesignRequirementsDeclaration> }): {kind:"selected";source:"explicit"|"design_declared_reference";canonicalPath:string}|{kind:"blocked";reason:"REQUIREMENTS_RESOLUTION_REQUIRED"}`.
- Consumes: `scanMarkdownFenceLines` (Task 1); existing `normalizeCommandArtifactPath`.

- [ ] **Step 1: Write RED tests** — valid `--requirements docs/r.md`, valid marker `<!-- justice-review-gate:requirements="docs/r.md" -->`, zero marker with CLI, both equal, both conflict, two same markers, late/fenced marker, issue URL prose, malformed/duplicate flags. Assert exact discriminants; `--retry` remains no-op.
- [ ] **Step 2: Verify RED** — `bun run vitest run tests/core/review-gate-command.test.ts tests/core/review-gate/requirements-resolution.test.ts`; expect new assertions FAIL.
- [ ] **Step 3: Implement parser/selector** — marker must be exactly one unfenced preamble comment (first 64 physical lines before first unfenced H2/H3); case/punctuation fixed, path ASCII regex `[A-Za-z0-9][A-Za-z0-9._/-]*\.md`, max 4096 bytes; reject malformed reserved marker even when CLI supplied.
- [ ] **Step 4: Verify GREEN** — focused tests plus four global commands; assert no behavior regression for existing two-required-flags and `@path`.
- [ ] **Step 5: Commit** — `git add src/core/review-gate-command.ts src/core/review-gate/requirements-resolution.ts tests/core/review-gate-command.test.ts tests/core/review-gate/requirements-resolution.test.ts && git commit -m "feat: specify Requirements command and Design reference parser"`.

### Task 3: Independent Git-tracked Requirements Resolver and V2

**Files:**
- Create: `src/runtime/review-gate-requirements.ts`, `tests/runtime/review-gate-requirements.test.ts`
- Modify: `src/core/review-gate-types.ts`, `src/core/review-gate/identity.ts`
- Test: `tests/core/review-gate-types.test.ts`, new runtime test

**Interfaces:**
- Consumes Task 2 selector and verified Design AND Plan identities from one locked Git/workspace snapshot.
- Produces `VerifiedTrackedArtifactIdentity = Readonly<{canonicalPath:string;workspaceIdentity:string;repositoryIdentity:string;gitBlobOid:string;digest:ArtifactDigest;gitMode:"100644"|"100755";fsIdentity:Readonly<{device:string;inode:string}>}>` in `src/core/review-gate-types.ts`. The secure native `(device,inode)` is runtime-only, never a persisted absolute path. Matching content hashes alone do not prove aliasing.
- Produces `resolveRequirementsForAdmission(input:Readonly<{workspaceRoot:string;design:VerifiedTrackedArtifactIdentity;plan:VerifiedTrackedArtifactIdentity;designBytes:Uint8Array;explicitPath?:string}>):Promise<RequirementsResolutionV2>` in `src/runtime/review-gate-requirements.ts`. It rejects Requirements aliasing **either** Design or Plan by canonical path, symlink-safe resolved identity or hardlink inode identity, before `GATE_CREATED`.
- The V2 fields/source remain exactly as Design §10.2; legacy V1 stays distinct and admission H0 is not current HEAD equality.
- [ ] **Step 1: Write RED tests** — independent Git-tracked Requirements ACCEPT; `Requirements == Design` and `Requirements == Plan` BLOCK; distinct tracked paths to the same inode/hardlink BLOCK; symlink/unsafe/dirty/untracked path BLOCK. Distinct files with identical bytes ACCEPT. Verify H0/Git mode/blob/digest and no gate creation on rejection.
- [ ] **Step 2: Verify RED** — `bun run vitest run tests/runtime/review-gate-requirements.test.ts tests/core/review-gate-types.test.ts`; expect RED for V2 behavior.
- [ ] **Step 3: Implement `resolveRequirementsForAdmission`** — inspect Requirements and the pinned Design/Plan using the same secure filesystem/Git snapshot; reject exact canonical-path equality, symlink and device/inode alias to either target, without inferring alias from equal digests. Fail before `GATE_CREATED` with `REQUIREMENTS_RESOLUTION_REQUIRED`.
- [ ] **Step 4: Verify GREEN** — focused tests and four global commands. Confirm V1 stored events can still be parsed by historical type but not mistaken for new V2.
- [ ] **Step 5: Commit** — `git add src/runtime/review-gate-requirements.ts src/core/review-gate-types.ts src/core/review-gate/identity.ts tests/runtime/review-gate-requirements.test.ts tests/core/review-gate-types.test.ts && git commit -m "feat: resolve independently committed Requirements with V2 provenance"`.

### Task 4: Versioned Typed Event Schema and Protocol Authority

**Files:**
- Create: `src/core/review-gate/event-schema.ts`, `tests/core/review-gate/event-schema.test.ts`
- Modify: `src/core/review-gate/types.ts`, `src/core/review-gate-types.ts`, `src/runtime/review-gate-protocol.ts`
- Test: `tests/runtime/review-gate-protocol.test.ts`

**Interfaces:**
- Produces: `validateReviewGateEventRecord(record: unknown): VerifiedReviewGateEvent`; `encodeReviewGateEventRecord(event: VerifiedReviewGateEvent): string`; `VerifiedReviewGateEvent` is a branded, read-only versioned causal record with event-specific bounded payload.
- Requirement: schema/version discrimination for historical V1 and new V2; `requirementsResolutionPolicyVersion` and historical/current authority policy enter Design and global fingerprints; payload limits **64KiB/256B/4096B/128 refs**.

- [ ] **Step 1: Write RED tests** — reject event with raw worker text, secret, unsupported enum, overlimit payload, duplicate/conflicting ID or fabricated V2 source; preserve historical V1 type on decoding; assert fingerprint changes when Requirements policy/version changes but not provider identity.
- [ ] **Step 2: Verify RED** — `bun run vitest run tests/core/review-gate/event-schema.test.ts tests/runtime/review-gate-protocol.test.ts`; expect new schema tests FAIL.
- [ ] **Step 3: Implement bounded deterministic event codec and descriptor** — event-specific field allowlists, causal pointers, canonical encoding, strict versioned decoding; forbid authority-bearing silent redaction and replay-only relaxed checks.
- [ ] **Step 4: Verify GREEN** — focused tests plus all four global checks; no persisted raw prompts/absolute paths.
- [ ] **Step 5: Commit** — `git add src/core/review-gate/event-schema.ts src/core/review-gate/types.ts src/core/review-gate-types.ts src/runtime/review-gate-protocol.ts tests/core/review-gate/event-schema.test.ts tests/runtime/review-gate-protocol.test.ts && git commit -m "feat: enforce typed Review Gate event and protocol contracts"`.

### Task 5: Trusted Workspace-wide Witness and Security Prerequisite

**Files:**
- Create: `src/runtime/review-gate-scope-witness.ts`, `tests/runtime/review-gate-scope-witness.test.ts`
- Modify: `src/runtime/review-gate-lock-manager.ts`
- Test: `tests/runtime/review-gate-lock-manager.test.ts`

**Interfaces:**
- Produces `ReviewGateScopeWitness` through `createReviewGateScopeWitness(options:ReviewGateScopeWitnessOptions):ReviewGateScopeWitness`, with `ReviewGateScopeWitnessOptions = Readonly<{workspaceRoot:string;workspaceIdentity:string;witnessDirectory:string}>`. Runtime composition obtains **required** absolute `witnessDirectory` from `JUSTICE_REVIEW_GATE_WITNESS_DIR`. It MUST be independently host-provisioned, outside workspace, symlink-safe, protected by checked ownership/ACL and durable fsync. Missing/invalid/protection-unproven config => BLOCK; never bootstrap from a missing registry without independently trusted first-enrollment evidence.
- Schema `ScopeEnrollmentV1 = Readonly<{scopeId:string;workflowContinuityId:string;canonicalDesignPath:string;canonicalPlanPath:string;pathPairDigest:string;provenance:Readonly<{kind:"verified_genesis"|"verified_completed_successor"|"verified_independent_workflow";evidenceDigest:string;priorScopeId:string|null;priorGateId:string|null}>;gateMembership:readonly Readonly<{gateId:string;generationId:string;supersedesGateId:string|null;admissionEventId:string;writerIds:readonly string[]}>[]}>`. It links immutable enrollment/path pair, scope ID, Gate/generation/predecessor and cross-scope provenance. Actual status and spent rounds are **derived from anchored events**, not registry hints.
- Schema `WriterFrontierV1 = Readonly<{scopeId:string;gateId:string;writerId:string;sequence:number;hash:string}>`; `VerifiedScopeFrontier = Readonly<{workspaceIdentity:string;workspaceEnrollmentId:string;scopes:readonly ScopeEnrollmentV1[];writerHeads:readonly WriterFrontierV1[];globalFrontierHash:string}>`. All references are uniquely keyed, canonical sorted and verified against existing journal entries; witness/Gate/writer membership mismatch => BLOCK.
- API `readWorkspaceScopeFrontier(workspaceIdentity:string):Promise<VerifiedScopeFrontier>`, `compareAndAdvance(input:{workspaceIdentity:string;expectedFrontier:string;newFrontier:VerifiedScopeFrontier;operationId:string}):Promise<"advanced"|"already_committed">`, `acquireWorkspaceAdmissionGuard(workspaceIdentity:string):Promise<ReviewGateLockHandle|"occupied">`. Compare full canonical global frontier hash under guard; publication atomically records scope membership and expected shard heads after journal sync. No path relabeling may create a fresh budget without independently proved distinct workflow or verified continuity link.
- Consumed by Task 6 event store, Task 7 admission and Task 18 coordinator through **one identical injected witness instance**. DEP-02 remains deployment-proof pending; no claim against actors controlling both journal and witness or whole-volume rollback.

- [ ] **Step 1: Write RED tests** — delete journal/index and prove witness retains scope/path/Gate enrollment; relabel canonical Design/Plan while unfinished Gate has consumed rounds => BLOCK; concurrent first enrollment creates one genesis; witness records writer/Gate missing in shards or orphan journal member => BLOCK; absent witness registry is NOT a new workspace. Inject witness CAS crash; incomplete state recover only with proof, otherwise BLOCK.
- [ ] **Step 2: Verify RED** — `bun run vitest run tests/runtime/review-gate-scope-witness.test.ts tests/runtime/review-gate-lock-manager.test.ts`; expect new protection tests FAIL.
- [ ] **Step 3: Implement `createReviewGateScopeWitness` and guarded CAS** — bind canonical path pairs, workflow continuity, scope/Gate/generation membership, shard heads and trusted bootstrap to one protected workspace registry. Enforce `JUSTICE_REVIEW_GATE_WITNESS_DIR` and durable sync; never accept digest-only enrollment or silently recreate missing authority.
- [ ] **Step 4: Verify GREEN** — focused tests, native capability checks where required, four global commands; **DEP-02 deployment proof remains PENDING** until isolation and rollback threat assumptions are demonstrated on target host.
- [ ] **Step 5: Commit** — `git add src/runtime/review-gate-scope-witness.ts src/runtime/review-gate-lock-manager.ts tests/runtime/review-gate-scope-witness.test.ts tests/runtime/review-gate-lock-manager.test.ts && git commit -m "feat: anchor workspace-wide Review Gate scope frontiers"`.

### Task 6: Versioned Causal JSONL Writer Shards and Read Validation

**Files:**
- Modify: `src/runtime/review-gate-event-store.ts`, `src/runtime/review-gate-recovery-store.ts`
- Modify: `src/runtime/opencode-adapter.ts` (migrate `buildSharedReviewGateRuntimeGraph` factory call and construct ONE Task 5 witness)
- Test: `tests/integration/review-gate-event-sourced-flow.test.ts` (migrate existing factory callers)
- Test: `tests/runtime/review-gate-event-store.test.ts`, `tests/runtime/review-gate-recovery-store.test.ts`

**Interfaces:**
- Consumes Task 4 `validateReviewGateEventRecord` and Task 5 `ReviewGateScopeWitness`/`VerifiedScopeFrontier`.
- **Required factory migration**: `ReviewGateEventStoreOptions = Readonly<{workspaceIdentity:string;writerId:string;witness:ReviewGateScopeWitness}>`; `createReviewGateEventStore(rootDir:string,options:ReviewGateEventStoreOptions):ReviewGateEventStore`. This replaces the old one-arg factory; update all production and existing test callers. **Composition owner:** `src/runtime/opencode-adapter.ts` `buildSharedReviewGateRuntimeGraph` resolves `JUSTICE_REVIEW_GATE_WITNESS_DIR`, validates canonical `workspaceIdentity`, constructs one Task 5 witness and injects it into the Task 6 store. Keep it in `SharedReviewGateRuntimeGraph` for Tasks 7/18; on missing/untrusted witness, do not construct the authority graph. G1 may use a contract-faithful test witness; G2 must use the protected real witness.
- Produces `ReviewGateEventStore.readVerifiedScope(scopeId:string):Promise<Readonly<{frontier:VerifiedScopeFrontier;gateIds:readonly string[];eventsByGate:ReadonlyMap<string,readonly VerifiedReviewGateEvent[]>}>>`. `readEvents(gateId)`, `appendEvents`, `listGateIds` must also independently verify Gate→scope and expected writer frontier against the injected witness; `scope-index.json` remains a non-authoritative cache.
- Shards use `.justice/review-gates/events/<reviewScopeId>/<gateId>/<writerId>.jsonl`; original legacy files remain immutable for Task 8.

- [ ] **Step 1: Write RED tests** — two-arg factory with mandatory witness, shard sequence/hash/frontier and independent membership checks. Missing witness, lost index/history, missing witness-listed shard, orphan writer/Gate, unexpected path-pair association, corrupt/truncated JSONL and conflicting witness heads must BLOCK; read-only history cannot create/write authority.
- [ ] **Step 2: Verify RED** — `bun run vitest run tests/runtime/review-gate-event-store.test.ts tests/runtime/review-gate-recovery-store.test.ts`; expect new cases FAIL.
- [ ] **Step 3: Implement verified shard append and read** — require `options.witness`; `buildSharedReviewGateRuntimeGraph` creates a single verified witness and injects into store; add it to `SharedReviewGateRuntimeGraph`. Verify scope/Gate/writer membership, sync journal and CAS witness before ack. Repair only trusted same-intent prepared tails; untrusted state BLOCK. Migrate one-arg call sites and preserve same instance on restart from protected durable directory.
- [ ] **Step 4: Verify GREEN** — tests and four global commands; preserve all historical records without pruning/compaction.
- [ ] **Step 5: Commit** — stage `src/runtime/review-gate-event-store.ts`, `src/runtime/review-gate-recovery-store.ts`, `src/runtime/opencode-adapter.ts`, affected store tests and migrated factory-caller tests; `git commit -m "feat: persist causally verified Review Gate writer shards"`.

### Task 7: Pure Generation Admission and Verified Approval Selection

**Files:**
- Create: `src/core/review-gate/admission.ts`, `src/runtime/review-gate-scope-admission.ts`, `tests/core/review-gate/admission.test.ts`, `tests/runtime/review-gate-scope-admission.test.ts`
- Modify: `src/core/review-gate/identity.ts`
- Test: `tests/core/review-gate-identity.test.ts`

**Interfaces:**
- **Produces in `src/runtime/review-gate-scope-admission.ts`:**
```ts
type ScopeAdmissionRequest = Readonly<{
  workspaceRoot: string; workspaceIdentity: string;
  designPath: string; planPath: string;
  explicitRequirementsPath?: string;
  protocol: ReviewGateProtocolDescriptor;
}>;
type ReviewGateScopeAdmissionOptions = Readonly<{
  witness: ReviewGateScopeWitness;
  eventStore: ReviewGateEventStore;
  lockManager: ReviewGateLockManager;
  requirementsResolver: typeof resolveRequirementsForAdmission;
}>;
interface ReviewGateScopeAdmission {
  withAdmissionLease<T>(
    request: ScopeAdmissionRequest,
    run: (decision: AdmissionDecision) => Promise<T>,
  ): Promise<T>;
}
function createReviewGateScopeAdmission(
  options: ReviewGateScopeAdmissionOptions,
): ReviewGateScopeAdmission;
```
- **Produces in Core:** `planReviewGateAdmission(input:VerifiedAdmissionSnapshot):AdmissionDecision` with `RESUME | REENTRY_CANDIDATE | REVALIDATE_OR_BLOCK | REUSE_COMPLETED | CREATE_SUCCESSOR | CREATE_GENESIS | BLOCK`. The Runtime builds its immutable input under protected ownership; **Core alone** decides binding equality and next generation.
- **Lock ownership:** `withAdmissionLease` acquires Task 5 workspace guard, then scope lock, validates Task 6's witness-complete scope and Task 3's exact Design/Plan/Requirements snapshot, acquires Gate lock and reprojects, publishes any new enrollment before dropping workspace/scope guards, and invokes `run(decision)` while holding Gate lock for active orchestration. Release Gate lock in `finally` on success, error or cancellation; BLOCK/read-only reuse exits without a retained mutation lock; never hand lock descriptors to workers.

- Define these Task 7 types in `src/core/review-gate/admission.ts`. The completed tip is a **discriminated union**, not an optional previous binding that could be forgotten:

```ts
type VerifiedCompletedBindingSnapshot = Readonly<{
  approvalEventId: string; gateId: string; generationId: string;
  historicalRequirementsV2EventId: string;
  historicalRequirements: RequirementsResolutionV2;
  currentRequirementsAuthorityEventId: string;
  currentRequirements: VerifiedRequirementsBinding;
  design: ReviewArtifactBinding; plan: ReviewArtifactBinding;
  designClearEventId: string; planClearEventId: string;
  globalProtocolFingerprint: string;
  verifiedHistoryFrontier: string;
}>;
type VerifiedRequirementsBinding = Readonly<{
  source: 'explicit' | 'design_declared_reference';
  workspaceIdentity: string; canonicalPath: string;
  digest: ArtifactDigest; gitMode: '100644' | '100755';
  gitBlobOid: string; selectedByEventId: string;
}>;
type VerifiedGateTip =
  | Readonly<{status: 'completed'; gateId: string; generationId: string;
      scopeId: string; supersedesGateId: string | null;
      completedApproval: VerifiedCompletedBindingSnapshot}>
  | Readonly<{status: 'active' | 'suspended'; gateId: string;
      generationId: string; scopeId: string; supersedesGateId: string | null;
      rounds: Readonly<{design:number;plan:number}>;
      suspensionReason: string | null; ownDesignClear:
        Readonly<{eventId:string;binding:ReviewArtifactBinding;
          requirementsAuthorityEventId:string}> | null}>;
type VerifiedAdmissionSnapshot = Readonly<{
  workspaceIdentity: string; scopeId: string; verifiedFrontierHash: string;
  currentTips: readonly VerifiedGateTip[];
  current: Readonly<{requirements: VerifiedRequirementsBinding;
    design: ReviewArtifactBinding; plan: ReviewArtifactBinding;
    globalProtocolFingerprint: string;
    designProtocolFingerprint: string; planProtocolFingerprint: string}>;
}>;
```

- Task 6 provides verified writer-shard membership, Task 9 projects tip and own-generation Design CLEAR, and Task 15 produces verified **current-effective** Requirements authority. Task 7's pure planner consumes only immutable verified inputs; its G1 tests use explicitly constructed verified fixtures, while G2 integrated authority is gated on Task 15/18 wiring.
- Pure Core compares `completedApproval.currentRequirements` with `current.requirements` (source/path/digest/mode/blob/workspace), its Design/Plan path/digest/mode, and global protocol. Equal => read-only `REUSE_COMPLETED`; changed completed binding => `CREATE_SUCCESSOR` with fresh Design; unfinished drift => `REVALIDATE_OR_BLOCK`. Missing/corrupt completed approval or conflicting tips => `BLOCK` before any new generation.


- [ ] **Step 1: Write RED tests** — construct both discriminated `VerifiedGateTip` variants: completed with exact Requirements+Design+Plan+global protocol => read-only `REUSE_COMPLETED`; Plan-only change => `CREATE_SUCCESSOR` with fresh Design; Requirements or global protocol drift => no reuse; missing/corrupt completed approval or competing completed tips => `BLOCK`; active/suspended drift => `REVALIDATE_OR_BLOCK`, never successor. Preserve only same-generation `ownDesignClear`. Reject missing/mismatched witness, mismatched `ScopeAdmissionRequest.workspaceIdentity`, concurrent enrollment and lease leaks after errors.
- [ ] **Step 2: Verify RED** — `bun run vitest run tests/core/review-gate/admission.test.ts tests/runtime/review-gate-scope-admission.test.ts`; expect new cases FAIL.
- [ ] **Step 3: Implement `planReviewGateAdmission` and `createReviewGateScopeAdmission`** — use fully verified previous completed bindings from Task 9/15 in `VerifiedAdmissionSnapshot`, compare solely in Core and apply decisions through `withAdmissionLease` under workspace/scope/Gate ownership. Recheck source and frontiers, close locks via `finally`, never mint successor from NC1/exhausted/unfinished drift.
- [ ] **Step 4: Verify GREEN** — focused tests and four global commands; no double Gate creation under concurrent admission.
- [ ] **Step 5: Commit** — `git add src/core/review-gate/admission.ts src/runtime/review-gate-scope-admission.ts src/core/review-gate/identity.ts tests/core/review-gate/admission.test.ts tests/runtime/review-gate-scope-admission.test.ts tests/core/review-gate-identity.test.ts && git commit -m "feat: admit Review Gates from verified workspace continuity"`.

### Task 8: Immutable Legacy Snapshot and Atomic Continuation Bridge

**Files:**
- Create: `src/runtime/review-gate-legacy-bridge.ts`, `tests/runtime/review-gate-legacy-bridge.test.ts`
- Modify: `src/core/review-gate/legacy-execution.ts`
- Test: `tests/integration/review-gate-restart-recovery.test.ts`

**Interfaces:**
- Produces: `verifyLegacyContinuation(input:LegacyGateSnapshot): LegacyVerificationResult` with `VERIFIED | BLOCK`; `publishVerifiedLegacyBridge(input:VerifiedLegacyGate, store:ReviewGateEventStore):Promise<"committed"|"already_committed">`.
- Define `LegacyGateSnapshot` as immutable original `events.jsonl`/`dispatches.jsonl` bytes plus recovery-object refs, pre-existing trusted frontier and canonical scope/Git identities. `VerifiedLegacyGate` adds verified digest, generation/epoch/round counters, commit/resolution binding and deterministic resume cursor; `LegacyVerificationResult = {kind:"VERIFIED";value:VerifiedLegacyGate}|{kind:"BLOCK";reason:string}`. Evidence requires independent **pre-existing** frontier and idempotent `LEGACY_BRIDGE_PREPARED` → `LEGACY_BRIDGE_COMMITTED`.

- [ ] **Step 1: Write RED tests** — structurally well-formed but unanchored legacy history BLOCK; ambiguous partial round/commit BLOCK; old V1 `auto_design_reference` without genuinely independent original Requirements proof BLOCK; valid old `DESIGN_CLEAR_INHERITED` can be read/validated without becoming new authority; bridge crash does not double rounds.
- [ ] **Step 2: Verify RED** — `bun run vitest run tests/runtime/review-gate-legacy-bridge.test.ts tests/integration/review-gate-restart-recovery.test.ts`; expect newly added cases FAIL.
- [ ] **Step 3: Implement immutable verification and single-witness bridge commit** — NEVER rewrite old JSONL or invent lineage/epoch/round/Requirements provenance; fail closed when complete authority is not provable.
- [ ] **Step 4: Verify GREEN** — focused tests and four global commands. Preserve **DEP-03 PROOF PENDING** for real legacy corpus until evidence actually exists.
- [ ] **Step 5: Commit** — `git add src/runtime/review-gate-legacy-bridge.ts src/core/review-gate/legacy-execution.ts tests/runtime/review-gate-legacy-bridge.test.ts tests/integration/review-gate-restart-recovery.test.ts && git commit -m "feat: bridge only independently verified legacy Review Gates"`.

### Task 9: Pure Projection, Round Consumption and Resume Cursor

**Files:**
- Modify: `src/core/review-gate/projection.ts`, `src/core/review-gate/resume-cursor.ts`, `src/core/review-gate/types.ts`
- Test: `tests/core/review-gate/projection.test.ts`, `tests/core/review-gate-projection.test.ts`, new `tests/core/review-gate/resume-cursor.test.ts`

**Interfaces:**
- Preserve `projectReviewGate(events: readonly ReviewGateEvent[]): ReviewGateProjection` and introduce `projectVerifiedGateTip(input:Readonly<{gateId:string;scopeId:string;events:readonly VerifiedReviewGateEvent[];frontier:VerifiedScopeFrontier;currentAuthority:VerifiedRequirementsBinding}>):VerifiedGateTip`. Task 7 owns `VerifiedGateTip` and `VerifiedCompletedBindingSnapshot`: completed output MUST have `completedApproval` with approval event, original V2 event, current authority event, verified Requirements, Design/Plan and global protocol; active/suspended output MUST have only its own `ownDesignClear`, rounds and suspension reason. Task 15 supplies `currentAuthority` proof; until connected, missing current authority BLOCKS integrated admission, while Task 9 Core tests use an explicitly verified fixture. `deriveResumeCursor` distinguishes normal crash, NC1, exhaustion, upstream reopen, invalidation. Define `projectVerifiedLineageHistory(events:readonly VerifiedReviewGateEvent[],frontier:VerifiedScopeFrontier):VerifiedLineageHistory` in `src/core/review-gate/projection.ts`, which projects Task 11 typed target outcomes, committed resolutions, regressions, blocker semantic basis and complete pre/post causal event IDs for Task 12.

- [ ] **Step 1: Write RED tests** — `projectVerifiedGateTip` returns completed only with verifiable V2/history/current-effective authority refs and Design/Plan/approval binding; missing completed event or source proof BLOCKS. Active/suspended projects only its own Design CLEAR, round counts (Design 1..5/Plan 1..3) and true stop reason; NC1 and exhaustion cannot fall through ordinary resume. Duplicate conflicting ordinal or reprojected lineage history BLOCKS.
- [ ] **Step 2: Verify RED** — `bun run vitest run tests/core/review-gate/projection.test.ts tests/core/review-gate-projection.test.ts tests/core/review-gate/resume-cursor.test.ts`; expect new state assertions FAIL.
- [ ] **Step 3: Implement `projectVerifiedGateTip`, `projectVerifiedLineageHistory` and deterministic cursor** — include Task 11 outcome/commit/regression and exact pre/post snapshots in the typed `VerifiedLineageHistory` consumed by Task 12; reject missing causal refs, use own-generation CLEAR, spend rounds at durable start and prohibit generic NC1/exhaustion resume.
- [ ] **Step 4: Verify GREEN** — targeted tests and four global commands; replay same events twice must produce same projection.
- [ ] **Step 5: Commit** — `git add src/core/review-gate/projection.ts src/core/review-gate/resume-cursor.ts src/core/review-gate/types.ts tests/core/review-gate/projection.test.ts tests/core/review-gate-projection.test.ts tests/core/review-gate/resume-cursor.test.ts && git commit -m "feat: project durable budgets and suspension cursors"`.

### Task 10: Exact Git Commit Intent, Recovery and Resolution Barrier

**Files:**
- Modify: `src/runtime/review-gate-git.ts`, `src/runtime/review-gate-recovery-store.ts`, `src/core/review-gate/capabilities.ts`
- Test: `tests/runtime/review-gate-git.test.ts`, `tests/integration/review-gate-restart-recovery.test.ts`

**Interfaces:**
- Reuse `ReviewGateGit.prepareCommit(input):Promise<ReviewCommitPreparedPayload>` and `executePreparedCommit(payload):Promise<VerifiedReviewCommit>`.
- Produces complete `REVIEW_COMMIT_PREPARED` → verified `REMEDIATION_COMMIT_SUCCEEDED` → `LINEAGE_RESOLUTION_COMMITTED`; targets exact one literal artifact path/blob/mode/parent and operation ID.

- [ ] **Step 1: Write RED tests** — crash before/after commit, changed HEAD, unrelated staged files and executable mode owner-bit (0655 → 100644), commit failure, newly discovered blocker, exact post-image recovery; assert only one commit and no resolution before verified commit.
- [ ] **Step 2: Verify RED** — `bun run vitest run tests/runtime/review-gate-git.test.ts tests/integration/review-gate-restart-recovery.test.ts`; expect new assertions FAIL.
- [ ] **Step 3: Implement commit intent recovery barrier** — durable prepared operation required before native/Git side effect; replay matches expected parent, sole path, SHA/blob/mode and never commits twice. Preserve unrelated index/worktree state.
- [ ] **Step 4: Verify GREEN** — focused tests and four global commands. Any unresolved Git source/destination conflict must BLOCK, not overwrite or reattempt blindly.
- [ ] **Step 5: Commit** — `git add src/runtime/review-gate-git.ts src/runtime/review-gate-recovery-store.ts src/core/review-gate/capabilities.ts tests/runtime/review-gate-git.test.ts tests/integration/review-gate-restart-recovery.test.ts && git commit -m "feat: recover exact-artifact Review Gate commits idempotently"`.

### Task 11: Semantic Occurrence/Reconciliation and Commit-bound Lineages

**Files:**
- Modify: `src/core/review-gate/lineage.ts`, `src/core/review-gate/agent-protocol.ts`
- Create: `tests/core/review-gate/lineage.test.ts`
- Test: `tests/core/review-gate/agent-protocol.test.ts`

**Interfaces:**
- Preserve `reconcileFindingBatch` / `buildLineageResolution`; store generation-local immutable basis `(violationType, governingReference, semanticLocation, violatedContract, ownerScope)`, occurrence IDs, independently validated relations and commit-bound resolutions.
- **Task 11 produces:** `ValidatedTargetOutcome(lineageId,roundOrdinal,result,validationEventId,targetEventId)` with `result = STILL_PRESENT | RESOLVED | INDETERMINATE`, `VerifiedCommittedResolution(lineageId,resolutionEventId,verifiedCommitOid,contextDigest)`, `VerifiedRegression(lineageId,priorResolutionEventId,newObservationEventId,contextDigest)` and `SemanticBlockerEvidence` with lineage ID plus exact owner/type/reference/contract/location keys and observation event. Only independently validated, Task 6-anchored causal evidence can prove resolution or regression. Simple reappearance is not sufficient.
- For independently verified predecessor semantic relation, successor **MUST** store `(predecessorGateId, predecessorLineageId)` as historic durable link, without inheriting predecessor resolution.

- [ ] **Step 1: Write RED tests** — duplicate/minor/invalid observations; `STILL_PRESENT` as a targeted outcome instead of mere blocker presence; resolution event emitted only after verified Git commit; same-context regression with committed resolution emitted, uncommitted reappearance does not count; group key owner/type/reference/contract excludes location; predecessor link required only on independently verified relation.
- [ ] **Step 2: Verify RED** — `bun run vitest run tests/core/review-gate/lineage.test.ts tests/core/review-gate/agent-protocol.test.ts`; expect new authority tests FAIL.
- [ ] **Step 3: Implement durable occurrence/proof relations and commit-bound transitions** — final lineage resolution references exact verified Git commit; no model-originated lineage ID/source truth.
- [ ] **Step 4: Verify GREEN** — focused tests and four global commands; historic lineage and current generation authority remain separate.
- [ ] **Step 5: Commit** — `git add src/core/review-gate/lineage.ts src/core/review-gate/agent-protocol.ts tests/core/review-gate/lineage.test.ts tests/core/review-gate/agent-protocol.test.ts && git commit -m "feat: validate semantic lineage and commit-bound resolution"`.

### Task 12: Complete Durable Cycle Evidence and Six-rule NC1

**Files:**
- Create: `src/core/review-gate/cycle-evidence.ts`, `tests/core/review-gate/cycle-evidence.test.ts`
- Modify: `src/core/review-gate/convergence.ts`
- Test: `tests/core/review-gate/convergence.test.ts`

**Interfaces:**
- Produces: `evaluateNonConvergenceCycles(cycles: readonly VerifiedSemanticCycle[]): {kind:"convergent"}|{kind:"non_convergent";primaryReason:NonConvergenceKind;allReasons:readonly NonConvergenceKind[]}|{kind:"indeterminate";reason:string;missingEvidence:readonly string[]}`.
- **Task 11 produces typed lineage event evidence:** `ValidatedTargetOutcome = Readonly<{lineageId:LineageId;roundOrdinal:number;result:"STILL_PRESENT"|"RESOLVED"|"INDETERMINATE";validationEventId:string;targetEventId:string}>`, `VerifiedCommittedResolution = Readonly<{lineageId:LineageId;resolutionEventId:string;verifiedCommitOid:string;contextDigest:string}>`, and `VerifiedRegression = Readonly<{lineageId:LineageId;priorResolutionEventId:string;newObservationEventId:string;contextDigest:string}>`. No model-asserted ID, missing blocker or merely repeated text can substitute for committed-resolution evidence.
- **Task 9 projects**, and Task 12 cycle builder consumes these causally validated records under one `VerifiedSemanticContext = Readonly<{gateId:string;generationId:string;phase:ReviewGatePhase;baselineDigest:string;protocolFingerprint:string;contextDigest:string}>`. Each blocker is `SemanticBlockerEvidence = Readonly<{lineageId:LineageId;basisDigest:string;semanticLocation:string;ownerScope:string;violationType:string;governingReference:string;violatedContract:string;observationEventId:string}>`. Canonical conflict key includes owner/type/reference/contract **without location**; blocker landscape fingerprint includes all complete semantic blocker keys.
- **Produces** `VerifiedSemanticCycle = Readonly<{context:VerifiedSemanticContext;roundOrdinal:number;operationId:string;roundStartedEventId:string;preLandscapeEventId:string;postLandscapeEventId:string;preBlockers:readonly SemanticBlockerEvidence[];postBlockers:readonly SemanticBlockerEvidence[];preCount:number;postCount:number;preFingerprint:string;postFingerprint:string;targetOutcomes:readonly ValidatedTargetOutcome[];committedResolutions:readonly VerifiedCommittedResolution[];regressions:readonly VerifiedRegression[]}>`. Every outcome/commit/regression reference must exist in Task 6 witness-complete causal events, with same context and exact phase/round; missing or contradictory snapshots/IDs are **not VerifiedSemanticCycle**.
- **Result:** `evaluateNonConvergenceCycles(cycles:readonly VerifiedSemanticCycle[]): {kind:"convergent"}|{kind:"non_convergent";primaryReason:NonConvergenceKind;allReasons:readonly NonConvergenceKind[]}|{kind:"indeterminate";reason:string;missingEvidence:readonly string[]}`. Validate cycle completeness **before** all six predicates: missing proof produces `indeterminate` and Task 18 applies BLOCK. Evaluate ALL six predicates, preserve normative primary priority. `RESOLVED_LINEAGE_REGRESSED` requires prior commit-bound resolution + validated same-lineage same-context later observation, `SAME_LINEAGE_STALL` requires consecutive explicitly targeted `STILL_PRESENT` outcomes, and `CONTRACT_CONFLICT_REPEATED` uses the canonical group key, not semantic location.

- [ ] **Step 1: Write RED table tests** — no committed resolution + blocker reappearance => NOT regression; validated same-lineage regression after commit => immediate NC1; two consecutive targeted STILL_PRESENT => stall, not inferred from blocker presence; distinct contract-conflict group keys do not merge; missing/contradictory landscape/outcome/event IDs => `indeterminate`; six predicates can fire together but `primaryReason` follows exact normative priority.
- [ ] **Step 2: Verify RED** — `bun run vitest run tests/core/review-gate/cycle-evidence.test.ts tests/core/review-gate/convergence.test.ts`; expect predicate tests FAIL.
- [ ] **Step 3: Implement `buildVerifiedSemanticCycles(projected:VerifiedLineageHistory): readonly VerifiedSemanticCycle[]` in `cycle-evidence.ts` plus pure `evaluateNonConvergenceCycles`** — consume Task 11 typed lineage events through Task 9 `projectVerifiedLineageHistory` and Task 6 causal history; verify context/evidence completeness before computing all six ordered predicates. No Runtime I/O in Core; indeterminate must force BLOCK in Task 18.
- [ ] **Step 4: Verify GREEN** — focused tests and four global checks; one plateau must not imply two-round stall.
- [ ] **Step 5: Commit** — `git add src/core/review-gate/cycle-evidence.ts src/core/review-gate/convergence.ts tests/core/review-gate/cycle-evidence.test.ts tests/core/review-gate/convergence.test.ts && git commit -m "feat: detect semantic non-convergence from durable cycles"`.

### Task 13: Stage-aware Validation and Persisted Evidence Reuse

**Files:**
- Modify: `src/core/review-gate/deterministic-validation.ts`, `src/runtime/review-gate-protocol.ts`
- Test: `tests/core/review-gate/deterministic-validation.test.ts`, `tests/runtime/review-gate-protocol.test.ts`

**Interfaces:**
- Preserve `scheduleMandatoryValidations` and `computeValidationCacheKey`; add typed durable `DETERMINISTIC_VALIDATION_COMPLETED` and `DETERMINISTIC_VALIDATION_REUSED` references to original checked evidence.
- Stage names are **`BASELINE_ADMISSION`, `POST_REMEDIATION_SELF_REVIEW`, `PRE_CLEAR`**. Cache binds validator/contract/schema, phase, declared inputs and executable/runtime identity.

- [ ] **Step 1: Write RED tests** — baseline admission failing prevents dispatch and finding; POST FAIL triggers DVF1 while fresh self-review still happens, cannot commit; PRE_CLEAR invalid/missing evidence never CLEAR; same exact PASS reuse, semantic FAIL reuse not accepted as PASS; environment change under one operation BLOCK.
- [ ] **Step 2: Verify RED** — `bun run vitest run tests/core/review-gate/deterministic-validation.test.ts tests/runtime/review-gate-protocol.test.ts`; expect stage/evidence cases FAIL.
- [ ] **Step 3: Implement stage-aware pure planner and durable reuse reference validation** — registry owns rule severity/owner; dedupe by `(validationEventId,ruleId)`; never cache execution failure as semantic truth.
- [ ] **Step 4: Verify GREEN** — focused tests and four global checks; protocol fingerprint changes when stage/rule semantics change.
- [ ] **Step 5: Commit** — `git add src/core/review-gate/deterministic-validation.ts src/runtime/review-gate-protocol.ts tests/core/review-gate/deterministic-validation.test.ts tests/runtime/review-gate-protocol.test.ts && git commit -m "feat: enforce all mandatory Review Gate validation stages"`.

### Task 14: Two-Key Reentry and Phase Reopen State Machine

**Files:**
- Create: `src/core/review-gate/reentry.ts`, `tests/core/review-gate/reentry.test.ts`
- Modify: `src/core/review-gate/orchestrator.ts`, `src/core/review-gate/resume-cursor.ts`
- Test: `tests/core/review-gate/orchestrator.test.ts`

**Interfaces:**
- Produces: `planNonConvergenceReentry(input: VerifiedReentryInput): ReentryDecision` with `STAY_SUSPENDED | REENTER_SAME_GENERATION | REQUIREMENTS_REOPEN_REQUIRED | DESIGN_REOPEN_REQUIRED | BLOCK`.
- Define `VerifiedReentryInput = Readonly<{gateId:string;generationId:string;epochId:string;phase:ReviewGatePhase;remainingRounds:number;verifiedChange:{kind:"requirements"|"design"|"plan"|"protocol";beforeDigest:string;afterDigest:string;commitOid:string}|null;validatorOutcome:"MATERIAL_PROGRESS"|"NO_MATERIAL_PROGRESS"|"DESIGN_REOPEN_REQUIRED"|"REQUIREMENTS_REOPEN_REQUIRED"|"INDETERMINATE";nc1EvidenceEventId:string}>`; verify the independent signed/bound evidence rather than trusting this shape alone. Requires eligible **clean committed** change and independently validated progress; no budget/generation creation.

- [ ] **Step 1: Write RED tests** — provider/model-only change, claimed progress without independent validator, invalid lineage reference, conflicting external Git context => no reentry; valid two-key returns same generation/remaining rounds; exhaustion permits external revalidation but no new remediation ordinal.
- [ ] **Step 2: Verify RED** — `bun run vitest run tests/core/review-gate/reentry.test.ts tests/core/review-gate/orchestrator.test.ts`; expect new cases FAIL.
- [ ] **Step 3: Implement planner/typed transition and OSC1 precedence** — Requirements reopen then Design reopen; invalid downstream Plan work restores exact approved bindings. NC1 stop cannot pass ordinary SUSPENDED.
- [ ] **Step 4: Verify GREEN** — focused tests and four global checks; verify crash reentry idempotency via existing epoch/event state.
- [ ] **Step 5: Commit** — `git add src/core/review-gate/reentry.ts src/core/review-gate/orchestrator.ts src/core/review-gate/resume-cursor.ts tests/core/review-gate/reentry.test.ts tests/core/review-gate/orchestrator.test.ts && git commit -m "feat: gate NC1 reentry on verified material progress"`.

### Task 15: Immutable V2 Versus Current Requirements Authority

**Files:**
- Create: `src/core/review-gate/requirements-authority.ts`, `tests/core/review-gate/requirements-authority.test.ts`
- Modify: `src/core/review-gate/projection.ts`, `src/runtime/review-gate-requirements.ts`, `src/core/review-gate-types.ts`
- Test: `tests/integration/review-gate-restart-recovery.test.ts`, `tests/runtime/review-gate-requirements.test.ts`

**Interfaces:**
- Produces: `RequirementsAuthoritySnapshotV1`; `planRequirementsAuthorityTransition(input: {historical:RequirementsResolutionV2;effective:RequirementsAuthoritySnapshotV1;proposed:VerifiedRequirementsContext;origin:"justice_remediation_commit"|"external_committed_change"}): RequirementsAuthorityDecision`.
- Define `RequirementsAuthoritySnapshotV1 = Readonly<{historicalV2EventId:string; currentAuthorityEventId:string; source:"explicit"|"design_declared_reference"; requirements:{workspaceIdentity:string;canonicalPath:string;digest:string;gitMode:"100644"|"100755";gitBlobOid:string};design:{canonicalPath:string;digest:string;gitMode:"100644"|"100755";commitOid:string;protocolFingerprint:string};marker:{present:boolean;valid:boolean;line:number|null;digest:string|null;declaredPath:string|null}}>`; `RequirementsAuthorityDecision = {kind:"REVALIDATE"|"REBASE";next:RequirementsAuthoritySnapshotV1}|{kind:"BLOCK";reason:string}`. Durable events `REQUIREMENTS_AUTHORITY_REVALIDATED`/`REQUIREMENTS_AUTHORITY_REBASED` point to verified original/current authority. Justice-origin ties to prepared commit; external-origin to verified external change.

- [ ] **Step 1: Write RED tests** — H0/D0 marker M0, Justice commit H1/D1 marker M1/R0 => current R0 approval valid and H0 immutable; marker moved line within preamble accepted with new proof; deleted/duplicated/path-changed marker blocks commit; unrelated HEAD-only commit no drift; external R1 needs invalidation+rebase; restart after H1 before event recovers same intent.
- [ ] **Step 2: Verify RED** — `bun run vitest run tests/core/review-gate/requirements-authority.test.ts tests/runtime/review-gate-requirements.test.ts tests/integration/review-gate-restart-recovery.test.ts`; expect new stale-authority tests FAIL.
- [ ] **Step 3: Implement pure effective snapshot/transition planner and runtime verification** — verify historical H0 tree separately from current D1/R0 committed tree; never compare latest HEAD to `committedBaselineOid`, never overwrite V2, and never make self-review PASS a selector-change authorization.
- [ ] **Step 4: Verify GREEN** — targeted tests and all four global commands; new authority proof is durably anchored before fresh review and CLEAR, including after crash.
- [ ] **Step 5: Commit** — `git add src/core/review-gate/requirements-authority.ts src/core/review-gate/projection.ts src/core/review-gate-types.ts src/runtime/review-gate-requirements.ts tests/core/review-gate/requirements-authority.test.ts tests/runtime/review-gate-requirements.test.ts tests/integration/review-gate-restart-recovery.test.ts && git commit -m "feat: track current Requirements authority without rewriting provenance"`.

### Task 16: Completed Successor and Read-only Approval Lookup

**Files:**
- Modify: `src/runtime/review-gate-approval.ts`, `src/runtime/review-gate-history.ts`, `src/core/review-gate/history.ts`
- Test: `tests/runtime/review-gate-approval.test.ts`, `tests/runtime/review-gate-history.test.ts`, `tests/core/review-gate/history.test.ts`

**Interfaces:**
- Preserve `createReviewGateApprovalLookup(options).findCurrentCompletedApproval(planPath:string)`, `listCompletedApprovalCandidates(planPath:string)` and read-only history DTO contract.
- Exact reuse checks current independently verified Requirements resolution, Design and Plan path/digest/Git mode, global protocol and unique completed tip; successor never emits `DESIGN_CLEAR_INHERITED`, runs Design fresh.

- [ ] **Step 1: Write RED tests** — Plan-only successor fresh Design; missing/ambiguous immediate completed predecessor BLOCK; actual valid same-generation Plan resume preserves *its own* CLEAR; unrelated HEAD-only commit keeps completed lookup read-only approved; stale Requirements blob/marker or global protocol mismatch rejects completed lookup.
- [ ] **Step 2: Verify RED** — `bun run vitest run tests/runtime/review-gate-approval.test.ts tests/runtime/review-gate-history.test.ts tests/core/review-gate/history.test.ts`; expect stale-authority cases FAIL.
- [ ] **Step 3: Implement exact verified lookup and durable predecessor link** — read-only queries cannot initialize/mutate state or run validator/lock side effects; always compare historical V2 proof + latest verified effective authority against current artifacts.
- [ ] **Step 4: Verify GREEN** — focused tests and four global checks; corrupt scope and unsupported history yield `history_unavailable`/identity conflict, never false approval.
- [ ] **Step 5: Commit** — `git add src/runtime/review-gate-approval.ts src/runtime/review-gate-history.ts src/core/review-gate/history.ts tests/runtime/review-gate-approval.test.ts tests/runtime/review-gate-history.test.ts tests/core/review-gate/history.test.ts && git commit -m "feat: verify completed approval against current exact bindings"`.

### Task 17: Caller-owned Routing and Host Adapter Compatibility

**Files:**
- Modify: `src/hooks/plan-bridge.ts`, final host adapter implementation where TaskTool wire is formed
- Test: `tests/hooks/plan-bridge.test.ts`, `tests/hooks/plan-bridge-review-lock.test.ts`, `tests/integration/review-gate-adapter-orchestration.test.ts`

**Interfaces:**
- Preserve existing `normalizeTaskToolInputWithCategory`, `PlanBridge` and final OpenCode adapter wire shape.
- `typeof subagent_type === "string"` always caller-owned (including `"general"`); when caller-owned, **no** final `category`; only genuine `ses_...` continuation may reach wire `task_id` (never `task-N`).

- [ ] **Step 1: Write RED tests** — `subagent_type:"general"` bypasses Justice category and preserves object identity; arbitrary caller strings, absent type, `task-N`, real `ses_...`, field sanitization and implementation-not-authorized boundary; exact `PlanTask.rawBody` to worker.
- [ ] **Step 2: Verify RED** — `bun run vitest run tests/hooks/plan-bridge.test.ts tests/hooks/plan-bridge-review-lock.test.ts tests/integration/review-gate-adapter-orchestration.test.ts`; expect the new `general` case FAIL.
- [ ] **Step 3: Patch routing ownership and actual last-mile adapter** — preserve review locks, parent-session task correlation and foreground mandatory review. Do not change worker privileges or add unsupported model/provider/reasoning fields.
- [ ] **Step 4: Verify GREEN** — focused tests and four global commands.
- [ ] **Step 5: Commit** — stage **only** the actual touched `src/hooks/plan-bridge.ts`, host adapter file and matching three test files; `git commit -m "fix: preserve caller-owned Review Gate routing"`.

### Task 18: Production Coordinator End-to-end Authority Wiring

**Files:**
- Modify: `src/runtime/review-gate-coordinator.ts`, `src/hooks/plan-bridge.ts`, `src/runtime/review-gate-protocol.ts`
- Test: `tests/integration/review-gate-event-sourced-flow.test.ts`, `tests/integration/review-gate-restart-recovery.test.ts`, `tests/integration/review-gate-implementation-lock.test.ts`

**Interfaces:**
- Preserve `createReviewGateCoordinator`/`PlanBridge.setReviewGateCoordinator` public seams. Wire Tasks 2–16 into one runtime loop; coordinator owns I/O, mutation, locks, dispatch only; Core owns next-step decisions.
- Admission path uses verified scope witness/ledger; all three mandatory validation stages must be enforced *in production*, and `REVIEW_COMMIT_PREPARED` is witnessed before Git; no authority from `session.materialProgressObserved` or legacy mutable flags.

- [ ] **Step 1: Write RED production-path scenarios** — actual coordinator admission with real committed Requirements, Design/Plan validation, reviewer→validator→remediator→self-review discovery→commit→fresh review→Design CLEAR→Plan CLEAR→completed binding; restart at prepared and committed phases; NC1 reentry, exhaustion and upstream reopen.
- [ ] **Step 2: Verify RED** — `bun run vitest run tests/integration/review-gate-event-sourced-flow.test.ts tests/integration/review-gate-restart-recovery.test.ts tests/integration/review-gate-implementation-lock.test.ts`; expect new authority cases FAIL.
- [ ] **Step 3: Connect pure planners and durable services to coordinator** — remove competing mutable authority, reuse existing native/provider adapter; one phase at a time, exact binding per operation, preserve user command UX and `/justice-implement --approved` separate human authorization.
- [ ] **Step 4: Verify GREEN** — focused tests + all four global commands. No mocked-only helper success counts as proof of coordinator-path acceptance.
- [ ] **Step 5: Commit** — `git add src/runtime/review-gate-coordinator.ts src/hooks/plan-bridge.ts src/runtime/review-gate-protocol.ts tests/integration/review-gate-event-sourced-flow.test.ts tests/integration/review-gate-restart-recovery.test.ts tests/integration/review-gate-implementation-lock.test.ts && git commit -m "feat: integrate verified Review Gate authority into coordinator"`.

### Task 19: G2 Devcontainer Production-path Negative Matrix

**Files:**
- Modify: `tests/integration/review-gate-adapter-orchestration.test.ts`, `tests/integration/review-gate-event-sourced-flow.test.ts`, `tests/integration/review-gate-restart-recovery.test.ts`
- Test: `tests/integration/review-artifact-linux-e2e.test.ts`, `tests/runtime/linux-review-gate-provider-e2e.test.ts`
- Artifact: capture test logs/coverage and dependency proof in implementation report **only after approved execution**; do not edit spec/plan during this task without review.

**Interfaces:**
- G2 acceptance consumes actual provider/coordinator/adapters and recorded durable evidence. Tests must inject process death or fsync/publication gap at each critical boundary, then reconstruct from disk; mocks are permitted only for non-security network worker transport, not for core commit/ledger/lock evidence.

- [ ] **Step 1: Add RED integration matrix** — simultaneous scope first enrollment, path-pair budget bypass, missing/wrong witness, writer shard loss, invalid V1 bridge, NC1 six cases and precedence, self-review discovered blocker, fail-before-commit, post-commit crash, stale deterministic PASS, marker D0→D1/R0, stale approval, read-only history mutation, implementation authorization lock.
- [ ] **Step 2: Establish baseline / RED only where a gap exists** — run `bun run vitest run tests/integration/review-gate-adapter-orchestration.test.ts tests/integration/review-gate-event-sourced-flow.test.ts tests/integration/review-gate-restart-recovery.test.ts tests/integration/review-artifact-linux-e2e.test.ts`; record new-case results. If a case already PASSes against the unmodified implementation, retain its observable assertions and treat it as regression coverage; do not fabricate RED or mutate code merely to make it fail.
- [ ] **Step 3: Fix only failures attributable to earlier contracts** — each fix gets its own RED/GREEN check and focused commit; **STOP** for upstream normative conflict, insecure witness on target deployment, or unverifiable required legacy authority. Never weaken tests to turn BLOCK into PASS.
- [ ] **Step 4: Verify GREEN** — run focused G2 suite and fresh `bun run test`, `bun run typecheck`, `bun run lint`, `bun run build` from configured devcontainer remoteUser. Record exact commands/outcomes, any skipped test, DEP-02 trust-model proof and DEP-03 actual legacy corpus classification. Unproven proofs remain BLOCKED.
- [ ] **Step 5: Commit** — stage only added/changed integration tests and implementation fixes reviewed against original task owners; `git commit -m "test: prove Review Gate authority through production integration"`.

### Task 20: G3 Real-host E2E and Final Evidence-based Review

**Files:**
- Modify: `tests/integration/review-artifact-linux-host-e2e.test.ts`, `tests/runtime/linux-review-gate-provider-e2e.test.ts` (only add necessary live-host cases)
- Reference: `.devcontainer/devcontainer.json`, `docs/agents/review-artifact-linux-provider.md`
- Report: create `docs/reports/2026-10-09-issue-310-review-gate-v4-implementation-verification.md` **only after authorized implementation and actual runs**.

**Interfaces:**
- Supported host requirements: Linux x86_64/glibc native addon and supported OpenCode v1.18.x with Superpowers/OmO. `JUSTICE_RUN_LIVE_HOST_E2E=1` opt-in must actually execute; real provider, actual TaskTool routing/prompt and exact scoped Git mutation must be observed.
- Acceptance state is `G1 PASS && G2 PASS && G3 PASS && DEP-02 DEPLOYMENT PROVEN && DEP-03 LEGACY PROOF OR EXPLICIT FAIL-CLOSED CLASSIFICATION && DEP-04 IMPLEMENTATION PROVEN`. No automatic `Implementation Ready` declaration.

- [ ] **Step 1: Write live E2E cases** — valid command with Requirements source, caller `"general"`, controller→worker foreground dispatch, clean Design/Plan review/commit/approval path, crash/restart, unauthorized implementation rejected, sanctioned `--approved` path checks binding.
- [ ] **Step 2: Execute actual opt-in native/host cases** — `bun run build:native:review-artifact` if required; then `JUSTICE_RUN_LIVE_HOST_E2E=1 bun run vitest run tests/integration/review-artifact-linux-host-e2e.test.ts tests/runtime/linux-review-gate-provider-e2e.test.ts`. Record RED for genuinely missing behavior and GREEN only after fixes; if cases pass immediately, retain their assertions as regression evidence. Host unavailable or any skipped mandatory case means `BLOCKED`, **not** PASS.
- [ ] **Step 3: Fix only tested integration defects under review** — preserve exact permission/read-only contract, bounded events and fail-closed semantics; do not change ratified Design or upstream scope without approval.
- [ ] **Step 4: Verify complete acceptance** — all four global commands freshly, both real-host cases actually PASS, native capability security checks, exact source/test/protocol diff, DEP-02/03/04 proof artifacts. Report `SKIPPED/BLOCKED/NOT RUN` explicitly as blockers. Request an independent whole-branch code/security review before any completion claim.
- [ ] **Step 5: Commit report and tests** — `git add tests/integration/review-artifact-linux-host-e2e.test.ts tests/runtime/linux-review-gate-provider-e2e.test.ts docs/reports/2026-10-09-issue-310-review-gate-v4-implementation-verification.md && git commit -m "test: record live Review Gate contract-conformance evidence"` **only when the report records actual results**.

---

## Task dependencies and PR review checkpoints

- Tasks 1–4: parser/Requirements/protocol **pure contract foundation**; no new durable approval can be asserted until Tasks 5–8.
- Tasks 5–9: anchored persistence, legacy read, admission and replay **durable authority foundation**; untrusted witness is always BLOCK.
- Tasks 10–15: Git/recovery, semantic lifecycle, NC1, validation, reentry and Requirements current binding **safe Review Gate operation**.
- Tasks 16–18: completed approval, adapter compatibility and **fully wired production coordinator**; no shadow state or mock-only completion.
- Tasks 19–20: complete G2/G3 evidence, actual security boundary proof and independent whole-branch review. Do not create many tiny PRs: preferred review checkpoints are **foundation (Tasks 1–9)**, **authority engine (Tasks 10–15)** and **end-to-end integration (Tasks 16–20)**, each with no partial Implementation Ready claim. PR creation/merge still needs human authorization and adherence to normal branch policy.

## Final Plan Self-review and Authorization Boundary

- **Coverage mapping:** §1–3 Tasks 4–9,18; §4 Tasks 5,7,9,14,16; §5 Tasks 4–6,10; §6 Task 8; §7 Tasks 10–11,15,18; §8 Task 12; §9 Tasks 13–14; §10.1 Task 16; §10.2 Tasks 2–4,15; §11 Tasks 1,17; §12 Tasks 19–20; §13 dependency gates Tasks 5,8,15,19–20.
- **TDD:** Every task has RED assertion, focused RED command, change, focused GREEN plus four global commands, and a scoped commit.
- **Review Focus:** five input/failure classes pinned in Tasks 2–3, 5/7, 10/15, 15 and 16.
- **Type/ownership:** Core pure planners never call host; runtime witnesses/ledger/native handle all side effects. Shared V2/authority/event types and exact operations are introduced before coordinator wiring.
- **No false ready:** DEP-01 RATIFIED, DEP-02/03 proof pending, DEP-04 implementation proof pending, DEP-05 actual host E2E pending. `BLOCKED`, `SKIPPED`, `NOT RUN` are not PASS.
- **Next formal gate:** Independent Implementation Plan Review Gate and explicit execution authorization. No source/test/CI/config changes were made to create this plan.

**Plan status: AUTHORED FOR REVIEW — NOT IMPLEMENTATION-READY. Production work NOT AUTHORIZED.**
