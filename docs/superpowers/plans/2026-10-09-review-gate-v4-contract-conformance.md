# Justice v4 Review Gate Contract Conformance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a restart-safe, fail-closed Justice v4 `/justice-review-gate` whose durable authority, finite remediation budget, semantic resolution, Requirements selection, completed approval and production integration satisfy ratified Issue #297/#310 without importing v5 architecture.

**Architecture:** Preserve existing v4 coordinator, Linux native provider and OpenCode/Superpowers/OmO integration. Introduce deterministic Core admission/transition planners, protected workspace-wide scope witness, versioned causally linked JSONL evidence, verified legacy bridge and exact Git operation recovery. A new completed successor *always* receives a fresh Design Gate; original Requirements V2 admission provenance remains immutable while current authority advances only through verified durable events.

**Tech Stack:** TypeScript, Bun, Vitest, OpenCode v1.18.x, Node Git process APIs with `--literal-pathspecs`, existing Linux x86_64/glibc native N-API addon and Git; devcontainer from `.devcontainer/devcontainer.json`.

**Spec:** `docs/superpowers/specs/2026-10-09-review-gate-v4-contract-conformance-design.md` at commit `b573874f426e221eb50bf242a3f27662efb18842`, Design blob `fe072b444534b1cc58f1c5b9d2e60494f66158c3`. **Ratified upstream:** `SPEC.md` §4.1c, #297 and #310 at amendment commit `5b33b79bb27a26c00e79f950c7211a625b4727bf` (DEP-01 RATIFIED).

**Review history/status:** Plan blob `fb849de2529f68d1159eaad17e4fe0a93c968c85` at HEAD `29f52eeaa2f22b9c49572e38900404bf7a23c1f9` received an **independent document review READY** (RG-310-PLAN-001〜004 RESOLVED), **not** human Plan approval or implementation authorization. The RG-312 amendments to Design/Plan are a **new unreviewed baseline**: independent Fresh Design and Fresh Plan review and explicit human authorization are still required. Do not merge, deploy, claim Implementation Ready or execute tasks on the strength of this document.

## Global Constraints

- **Authority:** Justice Core owns admission, budgets, transitions, resolution and CLEAR; agent assertions, hook session maps, partial event replays and unverified cache state do not.
- **Budget:** at most **Design 5, Plan 3** remediation rounds *per generation*. Crash, SUSPENDED resume, NC1 reentry, changed path pair, legacy migration or `--retry 0..10` never replenish spent rounds.
- **Admission:** validate independently protected workspace-wide continuity before new scope enrollment; only one verified immediate **completed** predecessor permits a successor; even Plan-only change triggers a **fresh Design Gate**. No `DESIGN_CLEAR_INHERITED` event for new v4 Gates.
- **Persistence:** writer-sharded `.justice/review-gates/events/<reviewScopeId>/<gateId>/<writerId>.jsonl`, typed/versioned causal events with an independently durable scope frontier; schema-policy max **64 KiB UTF-8/event**, **256-byte ID**, **4096-byte canonical path**, **128 refs/event**. No prompts, raw worker results, secrets or content bodies in the ledger.
- **Scope witness:** separate OS-protected host-state security boundary with verified monotone publication and fsync properties. Do **not** claim whole-volume/root/adversary-with-both-writes rollback protection. Missing/untrusted witness => BLOCK.
- **Legacy:** never mutate `<gateId>/events.jsonl`, `dispatches.jsonl` or original recovery objects. Only independently anchored, provably complete authority can pass verified bridge; otherwise preserve and BLOCK.
- **Requirements:** optional `--requirements <path>` or exactly one valid Design preamble marker `<!-- justice-review-gate:requirements="docs/requirements/feature.md" -->`. Separate, committed Git-tracked Requirements file. New `RequirementsResolutionV2.source = "explicit" | "design_declared_reference"`; historical V1 remains versioned, `auto_design_reference` is **not** new authority.
- **Historical/current binding:** `committedBaselineOid` is immutable admission Git commit H0. Current Requirements/Design and declaration are separately durably revalidated/rebased; unrelated HEAD changes do not cause drift. Completed approval references **both** historical V2 and verified current-effective authority.
- **Review/commit:** mandatory `BASELINE_ADMISSION`, `POST_REMEDIATION_SELF_REVIEW`, `PRE_CLEAR`; self-review discoveries reconciled before commit; verified exact-artifact Git success **and subject/trailers** before lineage resolution; only one predeclared target. No Requirements/prod/test/CI edits by remediator. At **fresh Gate creation** both Design and Plan target files must be Git-clean, while unrelated dirty/staged files remain allowed and excluded from each commit. A known-dirty post-image from an already started Gate may resume **only** via exact Task 10 durable mutation/restore intent and verified recovery; dirty artifacts without such proof BLOCK, never auto-start a new Gate.
- **NC1:** evaluate all six rules in normative priority within a stable **logical phase semantic context** across normal remediation commit revisions; artifact baseline revision digest is not a semantic-context reset. Admission checks NC1 eligible-change candidate **before** generic unfinished-drift disposition after upstream/stale revalidation. Runtime reentry requires independently verified `MATERIAL_PROGRESS` and witness-committed transition in the same generation/remaining budget; lack of either key stays SUSPENDED.
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

- [ ] **Step 1: Write RED tests** — valid `--requirements docs/r.md`, valid marker `<!-- justice-review-gate:requirements="docs/r.md" -->`, zero marker with CLI, both equal, both conflict, two same markers, late/fenced marker, issue URL prose, malformed/duplicate flags. **`--retry 0`, `--retry 5`, `--retry 10`** must parse as deprecated `legacyRetryOption` and produce the observable `RETRY_DEPRECATED` warning text (on the Justice command response, not merely an internal log), with **no changes** to Design 5/Plan 3 budgets, phase/global fingerprints, epoch, admission decision or history. Invalid/out-of-range values fail closed.
- [ ] **Step 2: Verify RED** — `bun run vitest run tests/core/review-gate-command.test.ts tests/core/review-gate/requirements-resolution.test.ts`; expect new assertions FAIL.
- [ ] **Step 3: Implement parser/selector and deprecated-warning result** — marker must be exactly one unfenced preamble comment (first 64 physical lines before first unfenced H2/H3); case/punctuation fixed, path ASCII regex `[A-Za-z0-9][A-Za-z0-9._/-]*\.md`, max 4096 bytes; reject malformed reserved marker even when CLI supplied. Expose `legacyRetryOption` and a stable `RETRY_DEPRECATED` warning diagnostic at the public command boundary; do not feed this option into identity, state machine, budget or protocol authority.
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
- Requirement: schema/version discrimination for historical V1 and new V2; `requirementsResolutionPolicyVersion` and historical/current authority policy enter Design and global fingerprints; payload limits **64KiB/256B/4096B/128 refs**. **Foundational type-only contracts in Task 4:** define `RequirementsAuthoritySnapshotV1` (immutable historical/current event references and verified Requirements/Design/marker binding) in `src/core/review-gate-types.ts` and `SEMANTIC_CONTEXT_TRANSITION` event payload schema (old/new semantic phase anchors, trigger event, proof/ref, same generation + unmodified round counters) in `src/core/review-gate/types.ts`. Task 9 can consume the DTO as a pure projection input *before* Task 15 implements its producer. The schema is inert until an independently validated transition is emitted; no unreviewed authority by parsing a string.

- [ ] **Step 1: Write RED tests** — reject event with raw worker text, secret, unsupported enum, overlimit payload, duplicate/conflicting ID, fabricated V2 source or forged `SEMANTIC_CONTEXT_TRANSITION` without triggering event/context proof; preserve V1 decoder; assert phase semantic-policy/protocol changes update fingerprint but provider identity/revision-only commit does not. Typecheck a pure Task 9 projection consumer against the Task 4 `RequirementsAuthoritySnapshotV1` contract.
- [ ] **Step 2: Verify RED** — `bun run vitest run tests/core/review-gate/event-schema.test.ts tests/runtime/review-gate-protocol.test.ts`; expect new schema tests FAIL.
- [ ] **Step 3: Implement bounded deterministic codec, foundational typed authority DTO and protocol descriptor** — define Task 9/15 shared `RequirementsAuthoritySnapshotV1` now; version and validate `SEMANTIC_CONTEXT_TRANSITION` references, same-generation identity and unchanged budget. Keep the event inert until real verified emission. Enforce event-specific allowlists, causal pointers and canonical encoding; no authority-bearing redaction or relaxed replay.
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
- Create: `src/core/review-gate/admission.ts`, `tests/core/review-gate/admission.test.ts`
- Modify: `src/core/review-gate/identity.ts`, `src/core/review-gate/types.ts`
- **Deferred to Task 18:** `src/runtime/review-gate-scope-admission.ts` and `tests/runtime/review-gate-scope-admission.test.ts`. Task 7 defines their type contracts only; do not implement placeholder methods or claim runtime admission GREEN.
- Test: `tests/core/review-gate-identity.test.ts`

**Interfaces:**
- **Defines the shared public runtime types in `src/core/review-gate/types.ts`; Task 18 produces the concrete factory in `src/runtime/review-gate-scope-admission.ts`:**
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
- **Task 18 runtime ownership contract, not Task 7 implementation:** `withAdmissionLease` will acquire Task 5 workspace guard then scope lock, validate Task 6 witness-complete scope and Task 3 Design/Plan/Requirements, acquire Gate lock/reproject, publish enrollment before dropping workspace/scope guards and invoke `run(decision)` under Gate lock. Task 18 must release in `finally`; no worker inherits locks. **Task 7's completion is only its independently testable pure planner + exported type signatures, never a fake successful runtime wrapper.**

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
type VerifiedObservedRequirementsCandidate = Readonly<{
  // Independently verified current Git observation, NOT approval authority.
  source: 'explicit' | 'design_declared_reference';
  workspaceIdentity: string; canonicalPath: string;
  digest: ArtifactDigest; gitMode: '100644' | '100755';
  gitBlobOid: string; observedCommitOid: string;
  observationEvidenceId: string;
}>;
type VerifiedGateContextBinding = Readonly<{
  requirements: VerifiedRequirementsBinding;
  design: ReviewArtifactBinding;
  plan: ReviewArtifactBinding;
  globalProtocolFingerprint: string;
  designProtocolFingerprint: string;
  planProtocolFingerprint: string;
}>;
type VerifiedUnfinishedBindingSnapshot = Readonly<{
  // Immutable authority captured by this generation's original GATE_CREATED.
  admission: Readonly<{
    gateCreatedEventId: string;
    historicalRequirementsV2EventId: string;
    context: VerifiedGateContextBinding;
  }>;
  // Latest causally durable effective context, never inferred from live files.
  effective: Readonly<{
    context: VerifiedGateContextBinding;
    authorityEventId: string;
    operationId: string;
    verifiedHistoryFrontier: string;
  }>;
  // Only the same generation's Design CLEAR, and only at its approved context.
  ownDesignClear: Readonly<{
    eventId: string;
    approvedContextEventId: string;
    approvedRequirementsAuthorityEventId: string;
    approvedDesign: ReviewArtifactBinding;
    designProtocolFingerprint: string;
  }> | null;
}>;
type VerifiedGateTip =
  | Readonly<{status: 'completed'; gateId: string; generationId: string;
      scopeId: string; supersedesGateId: string | null;
      completedApproval: VerifiedCompletedBindingSnapshot}>
  | Readonly<{status: 'active' | 'suspended'; gateId: string;
      generationId: string; scopeId: string; supersedesGateId: string | null;
      rounds: Readonly<{design:number;plan:number}>;
      suspensionReason: string | null;
      lastVerifiedBinding: VerifiedUnfinishedBindingSnapshot;
      nc1Stop: Readonly<{stopEventId:string; phase:ReviewGatePhase;
        eligibleChange: Readonly<{kind:'requirements'|'design'|'plan'|'protocol';
          committedOid:string; proofEventId:string; beforeDigest:string;
          afterDigest:string; observationEvidenceId:string}> | null}> | null}>;
type VerifiedAdmissionSnapshot = Readonly<{
  workspaceIdentity: string; scopeId: string; verifiedFrontierHash: string;
  currentTips: readonly VerifiedGateTip[];
  current: Readonly<{requirements: VerifiedObservedRequirementsCandidate;
    design: ReviewArtifactBinding; plan: ReviewArtifactBinding;
    globalProtocolFingerprint: string;
    designProtocolFingerprint: string; planProtocolFingerprint: string}>;
}>;
```

- **Unfinished binding producer/consumer:** Task 6 supplies complete witness-anchored history; Task 15 verifies persisted Requirements authority transitions and their effective evidence; Task 9 projects the immutable initial `admission.context`, most recent **durably committed** `effective.context` and same-generation `ownDesignClear` into `lastVerifiedBinding`. Task 15/3 runtime verification separately produces `VerifiedObservedRequirementsCandidate` and stable current Design/Plan/protocol observations under Task 7's lease. An observed candidate is never a new `selectedByEventId`/approved authority; only a later verified durable transition can advance that authority. The scope-admission adapter must **never** manufacture the tip's persisted effective context from fresh observations. The pure planner receives both inputs, with G1 immutable fixtures and G2 real Task 9/15/18 verification.
- **Pure Core completed decision:** compare the **material identity fields** in `completedApproval.currentRequirements` with the independently verified `current.requirements` observation (source/path/digest/mode/blob/workspace), Design/Plan path/digest/mode and global protocol; do not demand equality between durable `selectedByEventId` and fresh observation commit/evidence IDs. Exact => read-only `REUSE_COMPLETED`; changed completed binding => `CREATE_SUCCESSOR` with fresh Design; missing/corrupt completed approval or conflicting tips => `BLOCK`.
- **Pure Core unfinished decision:** require valid `lastVerifiedBinding.admission` and `effective`, causal event/operation IDs and its independent history frontier. Compare the **material** Requirements identity of `effective.context.requirements` with the independent `current.requirements` candidate (source/path/digest/mode/blob/workspace, **excluding persisted event ID and observation-only commit OID**), plus Design and Plan canonical path/digest/Git mode and **global + both phase protocol fingerprints**. A differing field returns `REVALIDATE_OR_BLOCK` with an explicit dimension/reason and predecessor proof references; **never `CREATE_SUCCESSOR`**. **Admission precedence:** after verified upstream-blocker and stale-lineage revalidation, **an NC1 SUSPENDED tip takes the dedicated `nc1Stop` path before generic binding drift**. `nc1Stop.eligibleChange` must prove a phase-eligible clean/committed change (pinned commit, before/after binding, proof/event refs) from the same trusted observed snapshot; if proven, output `REENTRY_CANDIDATE` with NC1 stop and candidate IDs for Task 14's independent progress check, **even though the material binding differs**. This output is not ACTIVE authority; invalid/missing candidate stays SUSPENDED/BLOCK and must not reach generic RESUME. Only other ACTIVE or ordinary recoverable SUSPENDED exact matches with verified cursors return `RESUME`; their drift returns `REVALIDATE_OR_BLOCK`. Exhaustion/upstream reopen/invalidation/authority conflict use their restricted transitions, never generic resume. Two-Key `MATERIAL_PROGRESS` and witness-committed reentry are prerequisites to new ACTIVE state. The same-generation `ownDesignClear` survives only if its approved Requirements authority, Design binding and phase protocol still match the effective/current context and no upstream invalidation exists; it is never imported from a predecessor. Missing, corrupt or contradictory persisted effective binding => `BLOCK` (not inferred from `admission.context` or mutable cache).


- [ ] **Step 1: Write RED tests** — NC1 SUSPENDED with clean committed eligible D0→D1 and verified `nc1Stop` refs produces `REENTRY_CANDIDATE` **instead of** ordinary drift; provider-only/uncommitted change cannot. Original NC1 budget/epoch remains unchanged. Completed exact approval => read-only reuse; Plan-only successor fresh Design; protocol/Requirements drift or missing previous completed approval => never false reuse. For unfinished tips: **NC1 SUSPENDED + eligible committed Design/Requirements/phase-protocol input drift → REENTRY_CANDIDATE before general drift, then independent MATERIAL_PROGRESS + durable transition; noneligible change or provider-only change stays SUSPENDED/BLOCK; ACTIVE + exact binding → RESUME; ACTIVE + Design drift → REVALIDATE_OR_BLOCK; ACTIVE + Plan drift → REVALIDATE_OR_BLOCK; ACTIVE + global/Design/Plan protocol drift → phase-appropriate REVALIDATE_OR_BLOCK; ordinary SUSPENDED + Requirements drift → REVALIDATE_OR_BLOCK; missing/corrupt last effective binding → BLOCK; unfinished + any drift → NEVER CREATE_SUCCESSOR**. Valid same-generation Design CLEAR survives only at its approved effective/current context; **NC1 SUSPENDED + exact binding must NOT generic RESUME**, and round exhaustion/upstream reopen/invalidation never default to RESUME. Assert admission H0 immutable after a verified same-generation D0→D1 transition, and test witness mismatch, concurrent enrollment and lock release. Assert initial `GATE_CREATED` identity remains unchanged after a committed same-generation remediation, and validate witness identity, single enrollment, lock release on error.
- [ ] **Step 2: Verify RED** — `bun run vitest run tests/core/review-gate/admission.test.ts tests/core/review-gate-identity.test.ts`; expect new **pure** admission cases FAIL. Runtime scope-admission RED/GREEN belongs to Task 18 after Task 9/15.
- [ ] **Step 3: Implement only `planReviewGateAdmission(input:VerifiedAdmissionSnapshot):AdmissionDecision` and its type contracts** — with pre-verified immutable fixtures, give NC1 `nc1Stop` candidate admission priority **after upstream/stale revalidation but before ordinary drift**; return `REENTRY_CANDIDATE` (key 1 only), never ACTIVE, for verified eligible clean committed changes. The Task 14 independent MATERIAL_PROGRESS and witness-committed transition implement key 2 later. Ordinary exact RESUME, phase-specific REVALIDATE_OR_BLOCK and restricted BLOCK remain pure and bounded; runtime witness lease, Task 9 projection and Task 15 live authority are Task 18 prerequisites, not pretend-GREEN. Never mint successor from unfinished status.
- [ ] **Step 4: Verify GREEN** — Task 7's pure tests and all four global checks pass against the actual Core function and typed DTOs; no runtime admission claim. Concurrent Gate creation and lease recovery are covered as Task 18 G2 tests.
- [ ] **Step 5: Commit** — `git add src/core/review-gate/admission.ts src/core/review-gate/types.ts src/core/review-gate/identity.ts tests/core/review-gate/admission.test.ts tests/core/review-gate-identity.test.ts && git commit -m "feat: determine verified Review Gate admission in pure Core"`.

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
- Preserve `projectReviewGate(events: readonly ReviewGateEvent[]): ReviewGateProjection` and introduce `projectVerifiedGateTip(input:Readonly<{gateId:string;scopeId:string;events:readonly VerifiedReviewGateEvent[];frontier:VerifiedScopeFrontier;persistedAuthority:RequirementsAuthoritySnapshotV1}>):VerifiedGateTip`. Task 7 owns `VerifiedGateTip`, `VerifiedCompletedBindingSnapshot` and `VerifiedUnfinishedBindingSnapshot`: completed output requires verified completed approval; active/suspended output MUST carry the **immutable initial admission context** and **latest durable effective context** (including Requirements authority, Design/Plan path/digest/mode, global and both phase protocol fingerprints, event/operation/frontier proofs) with only its own context-bound Design CLEAR. Task 4 supplies the **type-only** `RequirementsAuthoritySnapshotV1` input; Task 9 independently projects only supplied verified event-backed fields (G1 explicitly pinned fixtures), while Task 15 **later** implements actual runtime production of persisted authority. Never use a fresh observed candidate to reconstruct old effective context. If no post-genesis transition exists, the initial GATE_CREATED context is the effective context, but missing/unverified later history BLOCKS. Task 9 G1 uses verified fixture history and the already-defined Task 4 DTO; no Task 15 function import or fake implementation is allowed. Task 18 G2 wires real Task 15 anchored authority source. `deriveResumeCursor` distinguishes normal crash, NC1, exhaustion, upstream reopen, invalidation. **Project phaseBaselineId and semanticContractFingerprint from immutable verified phase admission; track per-round pre/post artifact revisions as separate fields. A normal remediation commit must not reset the semantic lineage/cycle context. A typed `SEMANTIC_CONTEXT_TRANSITION` with proof may start a different comparison segment within the same generation without changing budget; missing proof BLOCKS.** Define `projectVerifiedLineageHistory(events:readonly VerifiedReviewGateEvent[],frontier:VerifiedScopeFrontier):VerifiedLineageHistory` in `src/core/review-gate/projection.ts`, which projects Task 11 typed target outcomes, committed resolutions, regressions, blocker semantic basis and complete pre/post causal event IDs for Task 12.

- In Task 9 first declare **shared type-only evidence interfaces** (`VerifiedSemanticContext`, `SemanticBlockerEvidence`, `ValidatedTargetOutcome`, `VerifiedCommittedResolution`, `VerifiedRegression`, `VerifiedCycleEvidence`) in existing `src/core/review-gate/types.ts`. Task 11 later emits their events and Task 12 imports/uses the SAME interfaces, without new duplicate type definitions or Runtime I/O.
- Define `VerifiedLineageHistory` in `src/core/review-gate/projection.ts` as a readonly `{frontierHash:string;context:VerifiedSemanticContext;rounds:readonly VerifiedCycleEvidence[]}`, where `VerifiedCycleEvidence` binds `roundOrdinal`, `operationId`, `roundStartedEventId`, complete **pre/post** `{eventId,blockers,blockingCount,semanticFingerprint}` landscapes, `targetOutcomes:readonly ValidatedTargetOutcome[]`, `committedResolutions:readonly VerifiedCommittedResolution[]` and `regressions:readonly VerifiedRegression[]`. Task 11 produces the named outcome/resolution/regression evidence types; Task 12 imports the same Task 9-owned context/blocker types and consumes exactly this projection in `buildVerifiedSemanticCycles`. `VerifiedLineageHistory` can be produced only from Task 6 witness-complete event refs with same pinned phase/context and exact causal order, otherwise projection fails closed.
- [ ] **Step 1: Write RED tests** — initial verified phase baseline D0 carries stable `phaseBaselineId`; after normal verified D0→D1→D2 commits, Task 9 projects the **same** semantic context plus distinct revision/event IDs. Explicit independently verified semantic contract change creates a causally linked segment without budget replenishment; missing transition event BLOCKS. Unfinished Gate with only GATE_CREATED yields `admission.context === effective.context` and immutable proof; after verified Justice Design remediation D0→D1, `admission.context` stays D0 while `effective.context` is D1 with new event/operation/frontier; fresh D1 observation must not rewrite last effective D0 without a durable transition. Verify Plan/protocol changes and own Design CLEAR binding are projected, with missing/contradictory committed authority BLOCK. Completed tip still requires V2/current-approved event references; NC1/exhaustion cannot generic resume; round counters replay deterministically.
- [ ] **Step 2: Verify RED** — `bun run vitest run tests/core/review-gate/projection.test.ts tests/core/review-gate-projection.test.ts tests/core/review-gate/resume-cursor.test.ts`; expect new state assertions FAIL.
- [ ] **Step 3: Implement `projectVerifiedGateTip`, `projectVerifiedLineageHistory` and deterministic cursor** — use Task 4 type-only Requirements authority DTO and Task 6 verified history; project logical semantic phase anchor and each revision's event/commit links, never derive a new cycle context from mutable artifact digest. Require verified context-transition proof for incompatible upstream changes. Derive `lastVerifiedBinding` (immutable admission vs last effective) without consulting current worktree/cache; bind event/operation/frontier and Design/Plan/protocol for every committed transition. Include Task 11 outcome/commit/regression and pre/post snapshots for Task 12, reject missing refs and any unsupported intermediate state, count spent rounds at durable start and prohibit NC1/exhaustion generic resume.
- [ ] **Step 4: Verify GREEN** — targeted tests and four global commands; replay same events twice must produce same projection.
- [ ] **Step 5: Commit** — `git add src/core/review-gate/projection.ts src/core/review-gate/resume-cursor.ts src/core/review-gate/types.ts tests/core/review-gate/projection.test.ts tests/core/review-gate-projection.test.ts tests/core/review-gate/resume-cursor.test.ts && git commit -m "feat: project durable budgets and suspension cursors"`.

### Task 10: Exact Git Commit Intent, Recovery and Resolution Barrier

**Files:**
- Modify: `src/runtime/review-gate-git.ts`, `src/runtime/review-gate-recovery-store.ts`, `src/core/review-gate/capabilities.ts`
- Test: `tests/runtime/review-gate-git.test.ts`, `tests/integration/review-gate-restart-recovery.test.ts`

**Interfaces:**
- Reuse `ReviewGateGit.prepareCommit(input):Promise<ReviewCommitPreparedPayload>` and `executePreparedCommit(payload):Promise<VerifiedReviewCommit>`.
- Produces complete `REVIEW_COMMIT_PREPARED` → verified `REMEDIATION_COMMIT_SUCCEEDED` → `LINEAGE_RESOLUTION_COMMITTED`; targets exact one literal artifact path/blob/mode/parent and operation ID.
- **Git metadata contract (SPEC.md §4.1c + Issue #297 §11.3/AC-9):** exact subject `[Justice] remediation round <N>` plus blank line and deterministic trailers:
  ```text
  Review-Gate: design|plan
  Review-Round: <N>
  Findings: <sorted, deduplicated resolved finding IDs>
  ```
  `ReviewCommitPreparedPayload` must bind `phase`, `roundOrdinal`, `resolvedFindingIds:readonly string[]`, `commitSubject`, `commitMessageDigest` and exact expected commit message bytes, derived from independently validated commit-eligible findings/round history (no internal Gate ID, private validator data or model-chosen trailers). `VerifiedReviewCommit` includes the verified message digest and Git commit OID; prepared/success/recovery events bind the same metadata. Reject a missing/duplicate/unknown trailer, wrong phase/round/finding set or message mismatch before `REMEDIATION_COMMIT_SUCCEEDED`, after crash and before lineage resolution; no automatic push. An empty finding set is a policy error unless an independently validated remediation case explicitly permits it; no fabricated finding IDs.

- [ ] **Step 1: Write RED tests** — `Review-Gate: design` and `Review-Gate: plan` cases assert exact `[Justice] remediation round N` subject, `Review-Round: N`, sorted/distinct `Findings` trailers and absence of Gate ID/private validator metadata. Invalid/missing/duplicate trailers, forged finding IDs, wrong round/phase, changed expected message on recovery and zero verified resolved findings fail closed. Retain crash before/after commit, changed HEAD, unrelated staged files, 0655→100644 mode, post-image recovery and one-commit/no-premature-resolution assertions.
- [ ] **Step 2: Verify RED** — `bun run vitest run tests/runtime/review-gate-git.test.ts tests/integration/review-gate-restart-recovery.test.ts`; expect new assertions FAIL.
- [ ] **Step 3: Implement deterministic subject/trailer builder and commit intent recovery barrier** — durable prepared payload binds expected message bytes/hash, verified phase/round/resolved IDs before native/Git side effect; on success/recovery check exact message plus parent, sole path, SHA/blob/mode/OID. Never repeat a commit, change its trailers, mix unrelated index/worktree entries, or allow commit-less resolution.
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
- **Consumes the Task 9 shared evidence types, filled by Task 11:** `ValidatedTargetOutcome = Readonly<{lineageId:LineageId;roundOrdinal:number;result:"STILL_PRESENT"|"RESOLVED"|"INDETERMINATE";validationEventId:string;targetEventId:string}>`, `VerifiedCommittedResolution = Readonly<{lineageId:LineageId;resolutionEventId:string;verifiedCommitOid:string;contextDigest:string}>`, and `VerifiedRegression = Readonly<{lineageId:LineageId;priorResolutionEventId:string;newObservationEventId:string;contextDigest:string}>`. No model-asserted ID, missing blocker or merely repeated text can substitute for committed-resolution evidence. A normal Justice remediation D0→D1→D2 changes per-round revision digests but **not** the verified `phaseBaselineId` / comparison segment or semantic contract fingerprint; no rebase of lineage by digest alone.
- **Task 9 projects**, and Task 12 cycle builder consumes these causally validated records under one `VerifiedSemanticContext = Readonly<{gateId:string;generationId:string;phase:ReviewGatePhase;phaseBaselineId:string;semanticContractFingerprint:string;protocolFingerprint:string;contextDigest:string}>`. Each blocker is `SemanticBlockerEvidence = Readonly<{lineageId:LineageId;basisDigest:string;semanticLocation:string;ownerScope:string;violationType:string;governingReference:string;violatedContract:string;observationEventId:string}>`. Canonical conflict key includes owner/type/reference/contract **without location**; blocker landscape fingerprint includes all complete semantic blocker keys.
- **Produces** `VerifiedSemanticCycle = Readonly<{context:VerifiedSemanticContext;roundOrdinal:number;operationId:string;roundStartedEventId:string;preRevisionDigest:string;postRevisionDigest:string;revisionCommitEventId:string|null;comparisonSegmentId:string;preLandscapeEventId:string;postLandscapeEventId:string;preBlockers:readonly SemanticBlockerEvidence[];postBlockers:readonly SemanticBlockerEvidence[];preCount:number;postCount:number;preFingerprint:string;postFingerprint:string;targetOutcomes:readonly ValidatedTargetOutcome[];committedResolutions:readonly VerifiedCommittedResolution[];regressions:readonly VerifiedRegression[]}>`. Every outcome/commit/regression/revision reference must exist in Task 6 witness-complete causal events, with the same logical phase semantic context, verifiable consecutive pre/post revisions and exact phase/round/operation. Any proven semantic authority change creates a new comparison segment **only** through witness-committed `SEMANTIC_CONTEXT_TRANSITION` with old/new anchor, change event, preserved cumulative budgets and independent equivalence/incompatibility proof; equivalent changes preserve context and NC1 cycles. Unproven transitions and gaps yield `indeterminate`, never a silent cycle reset. Cross-generation comparisons are forbidden.
- **Result:** `evaluateNonConvergenceCycles(cycles:readonly VerifiedSemanticCycle[]): {kind:"convergent"}|{kind:"non_convergent";primaryReason:NonConvergenceKind;allReasons:readonly NonConvergenceKind[]}|{kind:"indeterminate";reason:string;missingEvidence:readonly string[]}`. Validate cycle completeness **before** all six predicates: missing proof produces `indeterminate` and Task 18 applies BLOCK. Evaluate ALL six predicates, preserve normative primary priority. `RESOLVED_LINEAGE_REGRESSED` requires prior commit-bound resolution + validated same-lineage same-context later observation, `SAME_LINEAGE_STALL` requires consecutive explicitly targeted `STILL_PRESENT` outcomes, and `CONTRACT_CONFLICT_REPEATED` uses the canonical group key, not semantic location.

- [ ] **Step 1: Write RED table tests** — D0→D1→D2 with stable `phaseBaselineId` detects two-round `STILL_PRESENT`; D0→D1→D2→D3 with fingerprints A→B→A detects oscillation **across successful commits**; committed-resolved D1 lineage reappears at D2 in same context => immediate regression; uncommitted reappearance is NOT regression. Different conflict group keys do not merge; incompatible protocol/upstream transition starts independently proved segment **without budget reset**, equivalent transition preserves cycles, unanchored transition or mismatched revision parent => `indeterminate`. Six predicates simultaneous follow normative priority.
- [ ] **Step 2: Verify RED** — `bun run vitest run tests/core/review-gate/cycle-evidence.test.ts tests/core/review-gate/convergence.test.ts`; expect predicate tests FAIL.
- [ ] **Step 3: Implement `buildVerifiedSemanticCycles(projected:VerifiedLineageHistory): {kind:"verified";cycles:readonly VerifiedSemanticCycle[]}|{kind:"indeterminate";reason:string;missingEvidence:readonly string[]}` plus pure evaluator** — compare **stable phase semantic context** across different revision digests, check actual revision-to-commit causality, preserve all six predicate histories over D0→D1→D2; only a fully verified semantic transition can create a new segment, never an ordinary remediation commit. An incomplete/inconsistent cycle, missing target outcome or unproven context reset => `indeterminate` to Task 18 BLOCK, not an empty-convergent list. Task 9 projects the same typed events; Core has no Runtime I/O.
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
- Define `VerifiedReentryInput = Readonly<{gateId:string;generationId:string;epochId:string;phase:ReviewGatePhase;remainingRounds:number;nc1EvidenceEventId:string;verifiedChange:{kind:"requirements"|"design"|"plan"|"protocol";beforeDigest:string;afterDigest:string;commitOid:string;proofEventId:string;beforeContextDigest:string;afterContextDigest:string}|null;validation:{outcome:"MATERIAL_PROGRESS"|"NO_MATERIAL_PROGRESS"|"DESIGN_REOPEN_REQUIRED"|"REQUIREMENTS_REOPEN_REQUIRED"|"INDETERMINATE";validationEventId:string;boundNc1EvidenceEventId:string;boundChangeProofEventId:string}|null}>`; verify the independent signed/bound evidence rather than trusting this shape alone. Requires eligible **clean committed** change and independently validated progress; no budget/generation creation.

- [ ] **Step 1: Write RED tests** — input from Task 7 `REENTRY_CANDIDATE` with verified eligible Design/Requirements/Plan-phase change + an independently checked, evidence-bound `MATERIAL_PROGRESS` yields `REENTER_SAME_GENERATION` only after Task 14 transition intention is committed. Provider/model-only/uncommitted changes, mismatched stopEventId, invalid lineage, false model progress, missing validator event, conflicting Git context or `NO_MATERIAL_PROGRESS` remain suspended/BLOCK. Restart after prepared reentry recovers same operation; cumulative rounds unchanged and exhaustion cannot allocate another ordinal.
- [ ] **Step 2: Verify RED** — `bun run vitest run tests/core/review-gate/reentry.test.ts tests/core/review-gate/orchestrator.test.ts`; expect new cases FAIL.
- [ ] **Step 3: Implement planner/typed transition and OSC1 precedence** — consume Task 7 `REENTRY_CANDIDATE` proof, independently validate dispatched `NON_CONVERGENCE_REENTRY_VALIDATION` outcome against before/after context and original NC1 stop evidence; witness-commit idempotent `NON_CONVERGENCE_REENTRY_VALIDATION_COMPLETED` + eligible reentry/epoch transition before ACTIVE. Requirements→Design reopen precedence, exact downstream restore and no budget reset remain mandatory; no generic SUSPENDED bypass.
- [ ] **Step 4: Verify GREEN** — focused tests and four global checks; verify crash reentry idempotency via existing epoch/event state.
- [ ] **Step 5: Commit** — `git add src/core/review-gate/reentry.ts src/core/review-gate/orchestrator.ts src/core/review-gate/resume-cursor.ts tests/core/review-gate/reentry.test.ts tests/core/review-gate/orchestrator.test.ts && git commit -m "feat: gate NC1 reentry on verified material progress"`.

### Task 15: Immutable V2 Versus Current Requirements Authority

**Files:**
- Create: `src/core/review-gate/requirements-authority.ts`, `tests/core/review-gate/requirements-authority.test.ts`
- Modify: `src/core/review-gate/projection.ts`, `src/runtime/review-gate-requirements.ts`, `src/core/review-gate-types.ts`
- Test: `tests/integration/review-gate-restart-recovery.test.ts`, `tests/runtime/review-gate-requirements.test.ts`

**Interfaces:**
- Produces: `RequirementsAuthoritySnapshotV1`; `planRequirementsAuthorityTransition(input: {historical:RequirementsResolutionV2;effective:RequirementsAuthoritySnapshotV1;proposed:VerifiedRequirementsContext;origin:"justice_remediation_commit"|"external_committed_change"}): RequirementsAuthorityDecision`.
- **Consumes Task 4 `RequirementsAuthoritySnapshotV1`** (defined before Task 9); runtime Task 15 implements its verified producer. Retain this shared type contract without redeclaring it: `RequirementsAuthoritySnapshotV1 = Readonly<{historicalV2EventId:string; currentAuthorityEventId:string; source:"explicit"|"design_declared_reference"; requirements:{workspaceIdentity:string;canonicalPath:string;digest:string;gitMode:"100644"|"100755";gitBlobOid:string};design:{canonicalPath:string;digest:string;gitMode:"100644"|"100755";commitOid:string;protocolFingerprint:string};marker:{present:boolean;valid:boolean;line:number|null;digest:string|null;declaredPath:string|null}}>`; `RequirementsAuthorityDecision = {kind:"REVALIDATE"|"REBASE";next:RequirementsAuthoritySnapshotV1}|{kind:"BLOCK";reason:string}`. **Produces two distinct Task 7 contracts:** (a) `projectPersistedRequirementsBinding(snapshot:RequirementsAuthoritySnapshotV1, verifiedEvents:readonly VerifiedReviewGateEvent[]): VerifiedRequirementsBinding` only after Task 6-backed validation of `historicalV2EventId` and `currentAuthorityEventId`; this is Task 9's `persistedAuthority` source; (b) `inspectObservedRequirementsCandidate(input:Readonly<{workspaceRoot:string;workspaceIdentity:string;design:VerifiedTrackedArtifactIdentity;plan:VerifiedTrackedArtifactIdentity;explicitRequirementsPath?:string}>):Promise<{kind:'verified';candidate:VerifiedObservedRequirementsCandidate}|{kind:'unresolved';reason:string}>`, which rereads a stable committed Git snapshot and current unique Design declaration under Task 7's lock. The candidate carries verified path/blob/digest/mode/source and observation commit/evidence ID **but no authority event ID**; it cannot approve drift. For unresolved current selection, Core admission is fail-closed rather than fabricating a `current` binding. Missing/untrusted durable authority cannot produce the persisted binding. Durable events `REQUIREMENTS_AUTHORITY_REVALIDATED`/`REQUIREMENTS_AUTHORITY_REBASED` point to verified original/current authority. Justice-origin ties to prepared commit; external-origin to verified external change.

- [ ] **Step 1: Write RED tests** — distinguish persisted D0/R0 authority event from independently observed D1/R0 candidate: before verified remediation transition, historical/current persisted remain D0 while observation reads D1; after durable revalidation effective becomes D1, genesis stays D0. Requirements R1 and Plan-only/global protocol drift do not manufacture new `selectedByEventId`. Unchanged marker moved within preamble accepted on new proof; deleted/duplicate/path-changed source unresolved/BLOCK, no hidden fallback. Unrelated HEAD-only commit no drift; external R1 needs invalidation/rebase; crash after H1 before event recovers same intent.
- [ ] **Step 2: Verify RED** — `bun run vitest run tests/core/review-gate/requirements-authority.test.ts tests/runtime/review-gate-requirements.test.ts tests/integration/review-gate-restart-recovery.test.ts`; expect new stale-authority tests FAIL.
- [ ] **Step 3: Implement pure effective snapshot/transition planner, `projectPersistedRequirementsBinding` and `inspectObservedRequirementsCandidate`** — verify immutable H0 tree separately from latest **event-persisted** D1/R0 context and from the independently observed current Git tree; preserve typed authority versus candidate distinction through Task 9 and Task 7. No latest HEAD-to-H0 equality, V2 mutation, implicit approval, or runtime-only drift decision.
- [ ] **Step 4: Verify GREEN** — targeted tests and all four global commands; new authority proof is durably anchored before fresh review and CLEAR, including after crash.
- [ ] **Step 5: Commit** — `git add src/core/review-gate/requirements-authority.ts src/core/review-gate/projection.ts src/core/review-gate-types.ts src/runtime/review-gate-requirements.ts tests/core/review-gate/requirements-authority.test.ts tests/runtime/review-gate-requirements.test.ts tests/integration/review-gate-restart-recovery.test.ts && git commit -m "feat: track current Requirements authority without rewriting provenance"`.

### Task 16: Completed Successor and Read-only Approval Lookup

**Files:**
- Modify: `src/runtime/review-gate-approval.ts`, `src/runtime/review-gate-history.ts`, `src/core/review-gate/history.ts`
- Test: `tests/runtime/review-gate-approval.test.ts`, `tests/runtime/review-gate-history.test.ts`, `tests/core/review-gate/history.test.ts`

**Interfaces:**
- Preserve `createReviewGateApprovalLookup(options).findCurrentCompletedApproval(planPath:string)`, `listCompletedApprovalCandidates(planPath:string)` and read-only history DTO contract.
- **Consumes Task 7** `VerifiedCompletedBindingSnapshot` and Core `AdmissionDecision` (never an independent runtime equality decision), **Task 15** persisted verified `RequirementsAuthoritySnapshotV1` reduced to `VerifiedRequirementsBinding` **and** independent `VerifiedObservedRequirementsCandidate` for read-only current lookup and **Task 6/9** history/frontier. Verify the original V2 event/tree, the most recent current authority event, Requirements source/path/blob/digest/mode/workspace, Design/Plan bindings and global protocol; only Core `REUSE_COMPLETED` supports read-only approval. Missing proof BLOCKS; successor runs fresh Design and never emits `DESIGN_CLEAR_INHERITED`.

- [ ] **Step 1: Write RED tests** — exact verified completed binding => lookup without writing, Plan-only drift => successor fresh Design, missing completedApproval/ambiguous completed tips => BLOCK, same-generation Plan resume preserves its *own* Design CLEAR, unrelated HEAD-only commit retains approval, stale current Requirements source/blob/marker or global protocol rejects lookup.
- [ ] **Step 2: Verify RED** — `bun run vitest run tests/runtime/review-gate-approval.test.ts tests/runtime/review-gate-history.test.ts tests/core/review-gate/history.test.ts`; expect stale-authority cases FAIL.
- [ ] **Step 3: Implement read-only lookup using Task 7 `VerifiedCompletedBindingSnapshot` and Task 15 current authority** — verify historical V2 provenance plus latest anchored effective binding and consume Pure Core exact-reuse decision; never perform a second hidden Runtime equality check, mutation, fresh validation dispatch or writer lock.
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
- Create: `src/runtime/review-gate-scope-admission.ts`, `tests/runtime/review-gate-scope-admission.test.ts` (**deferred concrete implementation from Task 7**)
- Modify: `src/runtime/review-gate-coordinator.ts`, `src/runtime/opencode-adapter.ts`, `src/hooks/plan-bridge.ts`, `src/runtime/review-gate-protocol.ts`
- Test: `tests/integration/review-gate-event-sourced-flow.test.ts`, `tests/integration/review-gate-restart-recovery.test.ts`, `tests/integration/review-gate-implementation-lock.test.ts`

**Interfaces:**
- Preserve `createReviewGateCoordinator`/`PlanBridge.setReviewGateCoordinator` public seams. Wire Tasks 2–16 into one runtime loop; coordinator owns I/O, mutation, locks, dispatch only; Core owns next-step decisions.
- **Composition root `src/runtime/opencode-adapter.ts` / `buildSharedReviewGateRuntimeGraph`:** reuse the *same* Task 5 `ReviewGateScopeWitness` instance held by Task 6's store. Implement the Task 7 **type-only** factory contract in `src/runtime/review-gate-scope-admission.ts` here as `createReviewGateScopeAdmission({witness,eventStore,lockManager,requirementsResolver})`, backed by real Task 9/15 projections; inject `scopeAdmission:ReviewGateScopeAdmission` as a **required** new property of `ReviewGateCoordinatorOptions` in `src/runtime/review-gate-coordinator.ts`. The `SharedReviewGateRuntimeGraph` retains witness/store/admission for the invocation; on restart, reopen the same protected `JUSTICE_REVIEW_GATE_WITNESS_DIR` + verified `workspaceIdentity`, not a new empty registry. Do not construct a second witness in Coordinator or Approval. Missing config/witness, inconsistent workspace identity or ledger membership BLOCKS graph admission, never a legacy unanchored fallback.
- **ScopeAdmissionRequest**, constructed from the command request: canonical workspace root/identity, Design/Plan paths, optional explicit Requirements selector and ratified ReviewGateProtocolDescriptor. Task 7/9 restore the **last durable effective binding** from Task 6 events + Task 15 persisted authority, while Task 15/3 independently inspect the **current observed candidate** within the lease. Runtime must not replace `lastVerifiedBinding` with current observations, compare drift itself, or infer an absent binding from `ownDesignClear`. Pure Core compares them. The coordinator MUST route start/resume through `scopeAdmission.withAdmissionLease(request, async decision => ...)`; Gate lease is held across orchestration, released by Task 7 in `finally`, and no worker inherits handles. Any `REUSE_COMPLETED`/`CREATE_SUCCESSOR`/BLOCK or NC1 `REENTRY_CANDIDATE` decision is Task 7 Pure Core output only, never redecided by the coordinator. **After protected admission, NC1 candidate triggers the actual independent validator dispatch and Task 14 witness-committed reentry before a new ACTIVE invocation; `NO_MATERIAL_PROGRESS` remains suspended, crash retries same operation. The Task 14 input binds NC1 stop event, eligible-change committed proof, independent validator event and before/after semantic context; model text alone cannot claim material progress.** Under the scope lock, a **fresh Gate/enrollment** must verify BOTH Design and Plan targets are Git-clean in index and worktree; dirty Design or Plan => BLOCK, unrelated staged/dirty files => allowed if they do not affect target bindings or commit intent. **For an existing in-flight Gate, a known-dirty target may be used only in a verified Task 10 same-operation mutation/recovery cursor**; unknown dirty state BLOCKS. Never reject valid exact crash recovery solely because an authoritative post-image has not yet been committed. All three mandatory validation stages run in production, and `REVIEW_COMMIT_PREPARED` is witness-committed before Git. No authority from `session.materialProgressObserved` or legacy mutable flags.
- **NC1 evidence:** coordinator consumes `projectVerifiedLineageHistory` (Task 9), `buildVerifiedSemanticCycles`/three-variant `evaluateNonConvergenceCycles` (Task 12). Apply **upstream blocker → stale lineage revalidation → NC1 → exhaustion → remediation → clean fresh review/CLEAR**. `kind:indeterminate` is BLOCK; never default to remediation/convergent.

- [ ] **Step 1: Write RED production-path scenarios** — actual `buildSharedReviewGateRuntimeGraph` creates ONE witness/store/admission graph with matching identity; missing witness or wrong membership prevents dispatch; `withAdmissionLease` acquires/releases ownership even on crash. **Fresh admission clean isolation:** Design dirty or staged => BLOCK, Plan dirty or staged => BLOCK; unrelated dirty/staged file => allow Gate start and preserve unrelated changes. **Crash resume exception:** only an exact durable known-dirty post-image with verified prepared recovery intent can continue the same Gate/round; an unexplained dirty target BLOCKS. **Positive NC1 end-to-end:** verified eligible committed Design/Plan change from NC1 SUSPENDED → candidate branch → independent `MATERIAL_PROGRESS` dispatch and strict result check → witness-committed reentry → restarted coordinator ACTIVE on same Gate/generation with spent round counters unchanged; NO progress, mismatched stop ID or crash before durable event => SUSPENDED or exact recovery. Real committed Requirements → Design/Plan validation/commit/CLEAR; on an incomplete Gate, exact stored-vs-observed context RESUME, D0→observed D1/Plan drift/global-or-phase-protocol drift REVALIDATE_OR_BLOCK, suspended Requirements drift REVALIDATE_OR_BLOCK, missing/corrupt effective binding BLOCK, no unfinished successor, and only valid same-generation Design CLEAR retained. NC1 exact context never generic RESUME; exhaustion/reopen/invalidation remain restricted. Completed lookup still uses Task 7 Pure Core decision; NC1 without committed resolution is not false regression, verified same-context regression stops, missing cycle evidence BLOCKS; upstream/revalidation precedence and crash recovery.
- [ ] **Step 2: Verify RED** — `bun run vitest run tests/runtime/review-gate-scope-admission.test.ts tests/integration/review-gate-event-sourced-flow.test.ts tests/integration/review-gate-restart-recovery.test.ts tests/integration/review-gate-implementation-lock.test.ts`; expect newly added runtime/real coordinator authority and positive reentry cases FAIL (no fake Core-only passing test).
- [ ] **Step 3: Implement Task 7's deferred concrete `createReviewGateScopeAdmission` and connect Tasks 5/6/7/9/11/12/14/15/16 to coordinator through `buildSharedReviewGateRuntimeGraph`** — supply one protected witness, verified event store, Task 9/15 real historical/current projections, lock-backed lease; enforce target-clean check within ownership before `GATE_CREATED`. Core chooses NC1 branch before generic drift, runtime dispatches Task 14 independent validator and persists reentry before ACTIVE; no hidden runtime reuse/successor, no invented progress. Preserve native adapter, unrelated dirty files and `/justice-implement --approved` authorization.
- [ ] **Step 4: Verify GREEN** — focused tests + all four global commands. No mocked-only helper success counts as proof of coordinator-path acceptance.
- [ ] **Step 5: Commit** — `git add src/runtime/review-gate-scope-admission.ts tests/runtime/review-gate-scope-admission.test.ts src/runtime/review-gate-coordinator.ts src/runtime/opencode-adapter.ts src/hooks/plan-bridge.ts src/runtime/review-gate-protocol.ts tests/integration/review-gate-event-sourced-flow.test.ts tests/integration/review-gate-restart-recovery.test.ts tests/integration/review-gate-implementation-lock.test.ts && git commit -m "feat: integrate verified Review Gate admission and reentry"`.

### Task 19: G2 Devcontainer Production-path Negative Matrix

**Files:**
- Modify: `tests/integration/review-gate-adapter-orchestration.test.ts`, `tests/integration/review-gate-event-sourced-flow.test.ts`, `tests/integration/review-gate-restart-recovery.test.ts`
- Test: `tests/integration/review-artifact-linux-e2e.test.ts`, `tests/runtime/linux-review-gate-provider-e2e.test.ts`
- Artifact: capture test logs/coverage and dependency proof in implementation report **only after approved execution**; do not edit spec/plan during this task without review.

**Interfaces:**
- G2 acceptance consumes actual provider/coordinator/adapters and recorded durable evidence. Tests must inject process death or fsync/publication gap at each critical boundary, then reconstruct from disk; mocks are permitted only for non-security network worker transport, not for core commit/ledger/lock evidence.

- [ ] **Step 1: Add RED integration matrix** — real coordinator NC1 **positive reentry**: enter REVIEW_NON_CONVERGENT with consumed rounds, observe clean committed phase-eligible change, return `REENTRY_CANDIDATE` rather than drift BLOCK, dispatch independent `NON_CONVERGENCE_REENTRY_VALIDATION`, verify `MATERIAL_PROGRESS`, durably publish reentry transition, restart coordinator and continue **same generation / remaining rounds**; negative provider-only, `NO_MATERIAL_PROGRESS`, stale evidence and crash/restart. Also cover six NC1 conditions/precedence, simultaneous scope first enrollment, path budget bypass, witness/shard loss, invalid legacy, self-review blocking, failed/post-crash commit, stale validation, D0→D1/R0 marker, stale approval, read-only history and implementation lock.
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
- Tasks 5–9: witness/ledger and **type-only/pure** admission + pure projection; Task 7 implementation MUST NOT invoke Task 9/15 runtime producers, and Task 9 G1 consumes Task 4 DTOs/test fixtures without importing unimplemented Task 15 runtime functions. Any runtime admission through the old graph remains fail-closed until Task 18, not a false GREEN. Untrusted witness always BLOCK.
- Tasks 10–15: Git/recovery, semantic lifecycle, NC1, validation, reentry and **Task 15 real Requirements persisted/current authority producer**. Shared `RequirementsAuthoritySnapshotV1` is already defined by Task 4; Task 9's pure projection is compilable before Task 15. Task 14 plans reentry without dispatch side effects until Task 18.
- Tasks 16–18: completed approval, adapter compatibility and **Task 18 implements deferred runtime scope admission**, injecting Task 9 and Task 15 sources and Task 14 reentry dispatch into coordinator. Task 18 owns runtime scope-admission RED/GREEN, target clean isolation and positive NC1 E2E, and is the first point at which full production Gate-path acceptance can be claimed. No shadow state, fake stubs or mock-only completion.
- Tasks 19–20: complete G2/G3 evidence, actual security boundary proof and independent whole-branch review. Do not create many tiny PRs: preferred review checkpoints are **foundation (Tasks 1–9)**, **authority engine (Tasks 10–15)** and **end-to-end integration (Tasks 16–20)**, each with no partial Implementation Ready claim. PR creation/merge still needs human authorization and adherence to normal branch policy.

## Final Plan Self-review and Authorization Boundary

- **Coverage mapping:** §1–3 Tasks 4–9,18; §4 Tasks 5,7,9,14,16; §5 Tasks 4–6,10; §6 Task 8; §7 Tasks 10–11,15,18; §8 Task 12; §9 Tasks 13–14; §10.1 Task 16; §10.2 Tasks 2–4,15; §11 Tasks 1,17; §12 Tasks 19–20; §13 dependency gates Tasks 5,8,15,19–20.
- **TDD:** Every task has RED assertion, focused RED command, change, focused GREEN plus four global commands, and a scoped commit.
- **Review Focus:** five input/failure classes pinned in Tasks 2–3, 5/7, 10/15, 15 and 16.
- **Type/ownership:** Core pure planners never call host; runtime witnesses/ledger/native handle all side effects. Shared V2/authority/event types and exact operations are introduced before coordinator wiring.
- **No false ready:** DEP-01 RATIFIED, DEP-02/03 proof pending, DEP-04 implementation proof pending, DEP-05 actual host E2E pending. `BLOCKED`, `SKIPPED`, `NOT RUN` are not PASS.
- **Next formal gate:** Independent Implementation Plan Review Gate and explicit execution authorization. No source/test/CI/config changes were made to create this plan.

**Review status:** The historical Plan blob `fb849de2529f68d1159eaad17e4fe0a93c968c85` at HEAD `29f52eeaa2f22b9c49572e38900404bf7a23c1f9` was independently **READY**, with PLAN-001〜004 RESOLVED; this does not mean human implementation approval. This RG-312-modified Plan is **FRESH PLAN REVIEW PENDING**, after the modified Design receives its independent Fresh Design Review. DEP-01 RATIFIED; DEP-02/03 proof pending, DEP-04 implementation verification pending, DEP-05 host E2E not run. **Formal Implementation Ready: NOT APPROVED. Production execution and merge: NOT AUTHORIZED by this document.**
