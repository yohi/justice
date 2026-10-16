# Review Gate Authority Wiring Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the verified NEG-001–003 production-authority gaps and keep
NEG-004 progress and acceptance claims consistent with executed evidence.

**Architecture:** Keep the existing Core admission/reentry planners, protected
witness, event codec and Git primitives. Replace production Legacy routing with
one verified admission transaction, explicit decision application and witnessed
V2 publication; recover the same logical operation after a crash. Read-only
reuse stays read-only, and mutation stays disabled wherever host isolation is
unproven.

**Tech Stack:** TypeScript, Bun, Vitest, Zod, Node.js Git APIs and the existing
Linux x86_64/glibc native provider; configured devcontainer with `remoteUser: root`.

**Spec:** [Contract-conformance design](../specs/2026-10-09-review-gate-v4-contract-conformance-design.md),
especially §§4–6, 9, 10.2 and 12; [original implementation plan](2026-10-09-review-gate-v4-contract-conformance.md)
Tasks 3, 5–10 and 14–20; [SPEC §4.1c](../../../SPEC.md).
The design/plan approval dependencies recorded there remain in force.

## Global Constraints

- This is a follow-up execution plan, not a replacement specification, an
  implementation authorization or a claim that the original plan is complete.
- Core owns admission, budgets and transitions. Runtime observes authenticated
  evidence and executes exactly the Core decision; no second Legacy planner.
- Missing/untrusted witness, enrollment, membership or history means BLOCK,
  with no new Gate, reviewer dispatch, completed reuse or implementation arm.
- Design **5**, Plan **3** rounds per generation. Same-generation resume keeps
  spent rounds and crash epoch; only a verified eligible transition starts an
  epoch. Plan-only completed drift starts a fresh Design review in a successor.
- Requirements is a distinct committed artifact selected by explicit CLI or
  exactly one valid Design declaration. Original V2/H0 selection is immutable;
  current-effective authority is separate. Unrelated HEAD changes are not drift.
- Publish bounded typed events through protected prepare → exact shard sync →
  witness CAS. Limits: **64 KiB/event, 256-byte ID, 4096-byte path, 128 refs**.
  Local `events-v2.jsonl` custody or a recording seam is not witness authority.
- Preserve Legacy bytes. Without independently anchored historical authority,
  classify `LEGACY_AUTHORITY_UNVERIFIABLE` and BLOCK; never silently upcast.
- Installation/workspace → sorted scopes → sorted Gates → native effect guards
  is the lock hierarchy. Use existing lock-aware internal witness primitives;
  never reacquire a wider guard from a Gate-held callback.
- PLAN-027/029/030 handoff, closing seal and revoke-only barriers remain required
  before mutable dispatch or terminal acceptance. No same-UID permission-mode
  fixture may stand in for demonstrated worker isolation.
- Keep the protocol-release production `"BLOCK"` stub. Its activation belongs
  to the [phase-release plan](2026-10-14-protocol-release-phase-field.md), after
  its owner approvals and protected deployment prerequisites. Do not claim the
  original protocol-positive acceptance cases from this scoped remediation.
- Preserve caller-owned routing, immutable approved Design reads, scoped Git
  effects and explicit `/justice-implement --approved`. CLEAR is not approval.
- Every implementation task needs focused regression evidence and fresh
  `bun run test`, `bun run typecheck`, `bun run lint`, `bun run build` in the
  configured devcontainer. Record warnings/skips/failures separately. A passing
  helper does not close a production-path task.
- Commit commands below are future worker checkpoints, subject to explicit
  user authorization. This planning task does not execute those commits.

## Review Focus

1. Missing native/witness configuration must block the actual command, including
   the adapter's graph-construction failure path (Task 1).
2. A valid first-use authorization and CLI-only Requirements must create one
   V2 Gate even though no prior `GATE_CREATED` exists (Tasks 2, 4).
3. A competing caller changing the frontier between observation and application
   cannot receive stale authority or bypass admission on contention (Task 3).
4. Changed unfinished artifacts and NC1 reentry must preserve Gate/generation,
   spent rounds and independent validation across restart (Tasks 5–6).
5. Completed reuse after unrelated HEAD movement is read-only. Changed
   Requirements/protocol and unknown Legacy authority cannot arm implementation
   (Tasks 7–8).

## Baseline and Scope of Completion

Source baseline: `b86562aa6ce7543bf11d78f9ba1067d1f101b1e1` (2026-10-16).
The repository-root `REPORT.md` supplied by the user is an untracked review
input; this plan records its finding IDs without making that file a dependency.

- **NEG-001 → Tasks 1, 3, 8:** `opencode-adapter.ts:1758–1824` and non-durable
  admission at `review-gate-scope-admission.ts:836` allow Legacy fallback.
- **NEG-002 → Tasks 2, 4, 7:** Parser accepts `requirementsPath`; snapshot drops
  it; coordinator creates V1 Design-as-Requirements.
- **NEG-003 → Tasks 3–6, 8:** Only BLOCK/reuse are applied distinctly; other
  decisions use `runStartOrResume`; lock releases before application.
- **NEG-004 → Task 9 and progress correction:** Original Tasks 18–20 overstate
  integration/acceptance; G3 remains NOT CLAIMED.

Additional prerequisites discovered while planning: the snapshot currently
requires a pre-existing V2 genesis, fabricates installation identity from
workspace enrollment fields, and returns `precedence: null`. The verified store
also requires membership before ordinary appends. Merely replacing the V1
payload or adding a switch cannot establish a functioning admitted V2 path.

Fresh planning-time checks, before product changes, used Bun **1.4.2** in the
configured container. `bun run test` exited 1: **41 suites failed to load,
182 passed, 1 skipped; 2776 tests passed, 5 skipped**. Failures include undefined
`z.string` / `z.strictObject` at Zod consumers. Root cause is not established;
do not attribute these failures to NEG-001–003 or fabricate contract RED from
them. `bun run typecheck` and `bun run build` exited 0; `bun run lint` exited 0
with warnings. Historical checklist success is not a current GREEN result.

**Execution prerequisite:** first reproduce the baseline with the lockfile and
configured runtime; diagnose the import/load blocker before interpreting RED
or GREEN. Do not change dependency versions, lockfile or product behavior just
to conceal the failure. If a source fix is required, capture its own failing
test and reviewed fix before executing the tasks below.

**Scoped completion:** NEG-001/002 and decision/lease integration have production
regression evidence; every unsupported transition remains explicitly BLOCKED.
**Full original acceptance:** additionally requires every original Task 19/20
obligation, protocol-plan dependencies and DEP-02/03/04 proofs. Scoped completion
must never be relabeled G2/G3 PASS or Implementation Ready.

## File and Responsibility Map

Paths in this table are relative to the repository root.

- `src/runtime/opencode-adapter.ts`, `src/hooks/plan-bridge.ts`: actual command
  composition, graph-unavailable denial and shared services.
- `src/runtime/review-gate-admission-context.ts` (new): Runtime-only verified
  observation/selection value shared by transaction and executor.
- `src/runtime/review-gate-admission-snapshot.ts`: current request observation
  and historical/current projection, including an empty admitted scope.
- `src/runtime/review-gate-scope-admission.ts` and
  `src/runtime/review-gate-lock-manager.ts`: ordered admission ownership,
  two-pass Core planning, yield/re-entry.
- `src/runtime/review-gate-witness-enrollment.ts`,
  `src/runtime/review-gate-witness-scope-enrollment.ts` and
  `src/runtime/review-gate-scope-witness.ts`: authenticated enrollment reads
  and membership publication.
- `src/runtime/review-gate-event-store.ts`,
  `src/runtime/review-gate-witness-publication.ts` and
  `src/runtime/review-gate-publication-record.ts`: atomic admitted
  generation/writer membership and witnessed V2 publication.
- `src/runtime/review-gate-admission-executor.ts` (new) and
  `src/runtime/review-gate-coordinator.ts`: exhaustive decision application
  and existing driver integration.
- `src/runtime/review-gate-requirements.ts`,
  `src/runtime/review-gate-approval.ts` and
  `src/runtime/review-gate-history.ts`: original V2 versus effective authority
  and verified read-only consumers.
- `src/core/review-gate/` modules `admission.ts`, `event-schema.ts`,
  `projection.ts`, `reentry.ts`, `orchestrator.ts`, `types.ts`: only required
  pure DTO/codec/transition gaps; no Runtime imports.
- `tests/runtime/review-gate-admission-snapshot.test.ts` and
  `tests/runtime/review-gate-admission-executor.test.ts` (new): snapshot and
  decision application contracts.
- `tests/integration/review-gate-authority-wiring.test.ts` (new): real
  composition/verified-store command and restart regression matrix.
- Existing test files named per task: production-path and compatibility guards.

Split new runtime responsibilities into focused modules; do not add more
business decisions to the already large coordinator or duplicate Core planning.

---

### Task 1: Deny Unverified Production Composition

**Files:** Modify `src/runtime/opencode-adapter.ts`,
`src/runtime/review-gate-scope-admission.ts`, `src/hooks/plan-bridge.ts`;
test `tests/runtime/opencode-adapter-v2.test.ts`,
`tests/runtime/review-gate-coordinator-scope-admission.test.ts` and
`tests/integration/review-gate-authority-wiring.test.ts` (create).

**Interfaces:** Preserve public command/result shapes and
`buildSharedReviewGateRuntimeGraph(...)`. Production creates only
`createReviewGateEventStore(root, { workspaceIdentity, writerId, witness })`.
The `ReviewGateScopeAdmissionOptions.witness` used for production is required;
Legacy factories remain available only to explicit compatibility verification
and isolated tests, never a missing-trust fallback.

- [ ] **Step 1: Add regression tests** named
  `blocks command when native or trusted witness is unavailable` and
  `does not fall back when graph construction fails`. Assert
  `result.dispatched === false`, no new event/index/approval, no marked worker
  payload, and no fallback PlanBridge review dispatch. Include absent witness
  directory, absent installation, corrupt installation, unsafe config and
  redirected graph root; test the actual adapter command hook.
- [ ] **Step 2: Run RED** with the following command.
  Require an admission assertion failure, not an import/environment failure.

  ```bash
  bun run vitest run \
    tests/runtime/opencode-adapter-v2.test.ts \
    tests/runtime/review-gate-coordinator-scope-admission.test.ts \
    tests/integration/review-gate-authority-wiring.test.ts
  ```

- [ ] **Step 3: Implement denial** at the composition root and command handler.
  Require configured independently protected witness location; do not select
  the workspace witness default or provision on missing. Return canonical
  blocked guidance when the graph is null; do not treat null as permission to
  run the pre-coordinator path. Keep unrelated observation hooks fail-open.
- [ ] **Step 4: Run GREEN** using the focused command and four global checks.
  Confirm the protocol stub is still BLOCK and no existing Legacy bytes changed.
- [ ] **Step 5: Commit checkpoint** after reviewing only these source/tests:
  `git commit -m "fix: 信頼境界不在時のReview Gate開始を拒否"`.

### Task 2: Observe Real Admission Inputs Without Requiring Genesis

**Files:** Create `src/runtime/review-gate-admission-context.ts` and
`tests/runtime/review-gate-admission-snapshot.test.ts`; modify
`src/runtime/review-gate-admission-snapshot.ts`,
`src/runtime/review-gate-scope-admission.ts`,
`src/runtime/review-gate-scope-witness.ts` and
`src/runtime/review-gate-witness-enrollment.ts`.

**Interfaces:** In the new Runtime module define
`ReviewGateAdmissionObservation = Readonly<{ snapshot: VerifiedAdmissionSnapshot;
requirementsResolution: RequirementsResolutionV2 }>`.
Add `request: Readonly<{ designPath: string; planPath: string;
explicitRequirementsPath?: string }>` and a verified authority input to the
observer options. Retain a separate history-derived call mode for read-only
approval consumers. Authority input is
`Readonly<{ installation: TrustedWitnessInstallationV1;
frontier: VerifiedScopeFrontier;
firstEnrollment: VerifiedFirstEnrollment | null }>`.
Its producer reads/authenticates existing protected pending enrollment under
admission ownership; a caller DTO, workspace file or reconstruction from
membership is not an authenticated producer. No Core type imports Runtime.

- [ ] **Step 1: Add tests** `observes CLI-only Requirements before genesis`,
  `rejects CLI marker disagreement`, `does not manufacture first enrollment`
  and `projects unfinished precedence from the same frontier`. Assert exact
  `requirementsResolution.selectionEvidence.commandPath`, V2 blob/mode/H0,
  independent installation ID and original proof; zero prior Gate is valid
  only with authenticated enrollment. Include aliases, dirty Requirements,
  duplicate marker, unrelated HEAD movement and a related unfinished scope.
- [ ] **Step 2: Run RED**:

  ```bash
  bun run vitest run \
    tests/runtime/review-gate-admission-snapshot.test.ts \
    tests/runtime/review-gate-requirements.test.ts \
    tests/runtime/review-gate-scope-admission.test.ts
  ```

- [ ] **Step 3: Implement observation** using request paths and one pinned Git
  snapshot; pass `explicitPath` to `resolveRequirementsForAdmission`. Remove
  `findV2GateCreated` as a prerequisite for command admission, but never infer
  empty history from missing/corrupt journals. Replace
  `buildAuthorizedFirstEnrollment`'s inferred installation fields with verified
  protected evidence. Project current upstream/stale lineage event references
  into `VerifiedAdmissionPrecedenceV1`, not `null` or fabricated empty proof.
  Preserve persisted original Requirements selection on existing generations;
  later selectors are observed changes, not replacements.
- [ ] **Step 4: Run GREEN** using the focused command and four global checks.
  Missing protected first-use evidence must remain BLOCK, not a new workspace.
- [ ] **Step 5: Commit checkpoint**:
  `git commit -m "fix: Requirements選択と検証済み初回認可を伝播"`.

### Task 3: Keep Admission Authority Through Decision Application

**Files:** Modify `src/runtime/review-gate-scope-admission.ts`,
`src/runtime/review-gate-lock-manager.ts`,
`src/runtime/review-gate-witness-context.ts`,
`src/runtime/review-gate-coordinator.ts`; test
`tests/runtime/review-gate-scope-admission.test.ts`,
`tests/runtime/review-gate-coordinator-scope-admission.test.ts` and
`tests/runtime/review-gate-lock-manager.test.ts`.

**Interfaces:** Change the Runtime-only callback to
`withAdmissionLease<T>(request: ScopeAdmissionRequest,
run: (decision: AdmissionDecision, observation: ReviewGateAdmissionObservation)
=> Promise<T>): Promise<T>`. The transaction owns ordered locks through the
callback and releases in `finally`. Context-internal publication must use
already-owned lock-aware primitives; no public witness call may nest the
installation guard. Wider writer handoff/terminal continuation is yielded to
the existing original-plan outer driver, then freshly admitted on re-entry.

- [ ] **Step 1: Add tests** `keeps admission ownership until genesis is durable`,
  `contention never skips admission`, `replans after yielded authority changes`
  and `releases every guard on callback failure`. Pause two real callers;
  assert only one generation/publication, no stale-frontier dispatch and no
  Gate→workspace inversion. An occupied guard must not call Legacy routing.
- [ ] **Step 2: Run RED**:

  ```bash
  bun run vitest run \
    tests/runtime/review-gate-scope-admission.test.ts \
    tests/runtime/review-gate-coordinator-scope-admission.test.ts \
    tests/runtime/review-gate-lock-manager.test.ts
  ```

- [ ] **Step 3: Implement transaction ownership** and remove
  `scope_lease_occupied`'s `runStartOrResume()` bypass. Read/recover/replan after
  acquiring guards; re-read the full snapshot after NC1 observation advances
  the frontier. Do not reuse the first-pass spread as second-pass authority.
  Read-only completed reuse obtains no writer lease or append; mutable
  continuation yields before wider guards and revalidates on return.
- [ ] **Step 4: Run GREEN** with the focused command and four global checks;
  instrument actual acquisition/release order, including thrown exceptions.
- [ ] **Step 5: Commit checkpoint**:
  `git commit -m "fix: Admission判断と適用のロック境界を統一"`.

### Task 4: Publish Admitted V2 Generations and Membership Atomically

**Files:** Modify `src/runtime/review-gate-event-store.ts`,
`src/runtime/review-gate-witness-publication.ts`,
`src/runtime/review-gate-publication-record.ts`,
`src/runtime/review-gate-witness-scope-enrollment.ts`,
`src/runtime/review-gate-coordinator.ts`; test
`tests/runtime/review-gate-event-store.test.ts`,
`tests/runtime/review-gate-witness-scope-enrollment.test.ts` and
`tests/integration/review-gate-authority-wiring.test.ts`.

**Interfaces:** Extend the existing verified publication owner, not the Legacy
`appendEvents` interface. Add
`prepareAdmittedGenerationPublication(input: VerifiedEventPublicationInput &
Readonly<{ decision: Extract<AdmissionDecision, { kind: "CREATE_GENESIS" |
"CREATE_SUCCESSOR" }>; observation: ReviewGateAdmissionObservation }>)
: Promise<PreparedWitnessPublicationV1>` to the durable store. Runtime validates
the input against live protected authority; structural typing is not trust.
Genesis consumes the original first-enrollment authorization. Successor records
verified predecessor and new writer membership in the same expected-frontier
publication, without reusing first-enrollment authorization.

- [ ] **Step 1: Add tests** `creates one witnessed V2 genesis from authorized
  pending enrollment`, `publishes successor membership with exact predecessor`
  and `recovers prepared genesis without a second budget`. Assert
  `schemaVersion === 2`, exact historical Requirements V2, actual Git modes,
  `supersedesGateId`, writer membership and verified shard frontier. Inject
  crashes before prepare, after staging, after shard sync and after CAS;
  concurrent authorization consumption must have one winner. Plan-only completed
  drift gets fresh Design review, not inherited CLEAR.
- [ ] **Step 2: Run RED**:

  ```bash
  bun run vitest run \
    tests/runtime/review-gate-event-store.test.ts \
    tests/runtime/review-gate-witness-scope-enrollment.test.ts \
    tests/integration/review-gate-authority-wiring.test.ts
  ```

- [ ] **Step 3: Implement admitted publication** through protected exact-byte
  prepare and existing recover/publish APIs. Persist Gate/generation/operation
  identities before a recoverable side effect; no random second genesis on
  restart. Make verified projection the coordinator's production state source;
  do not cast V2 events into V1 projection or use a locally appended V2 mirror
  as canonical authority. Scope index remains a hint, not the selected tip.
- [ ] **Step 4: Run GREEN** with focused and global checks; reopen disk stores
  and independently read `readVerifiedScope` to assert the same authority.
- [ ] **Step 5: Commit checkpoint**:
  `git commit -m "fix: V2世代とWitness登録を一体で永続化"`.

### Task 5: Apply Every Core Decision Without Replanning in Legacy Code

**Files:** Create `src/runtime/review-gate-admission-executor.ts` and
`tests/runtime/review-gate-admission-executor.test.ts`; modify
`src/runtime/review-gate-coordinator.ts`,
`src/runtime/review-gate-admission-context.ts`; extend
`tests/runtime/review-gate-coordinator-scope-admission.test.ts` and
`tests/integration/review-gate-authority-wiring.test.ts`.

**Interfaces:** Define `applyReviewGateAdmissionDecision(input:
Readonly<{ decision: AdmissionDecision;
observation: ReviewGateAdmissionObservation }>,
handlers: ReviewGateAdmissionHandlers): Promise<ReviewGateCommandResult>`.
`ReviewGateAdmissionHandlers` is a mapped type over `AdmissionDecision["kind"]`;
each handler receives `Extract<AdmissionDecision, { kind: K }>` and the same
observation. Coordinator supplies Runtime execution handlers; the executor's
exhaustive switch and `never` check cannot invent a new decision. Internal
`INSPECT_NC1_ELIGIBLE_CHANGE` reaching final application blocks, never resumes.

- [ ] **Step 1: Add a table-driven test** over all **11** current discriminants:
  BLOCK, REUSE_COMPLETED, CREATE_GENESIS, CREATE_SUCCESSOR, RESUME,
  STAY_SUSPENDED, REVALIDATE_OR_BLOCK, UPSTREAM_PRECEDENCE_REQUIRED,
  STALE_LINEAGE_REVALIDATION_REQUIRED, INSPECT_NC1_ELIGIBLE_CHANGE and
  REENTRY_CANDIDATE. Assert exactly the matching handler receives every bound
  ID/proof, and no generic `runStartOrResume` handler exists. Through the real
  coordinator, changed unfinished input cannot create a new Gate, a suspended
  tip cannot generically resume, and exact crash resume keeps epoch/rounds.
- [ ] **Step 2: Run RED**:

  ```bash
  bun run vitest run \
    tests/runtime/review-gate-admission-executor.test.ts \
    tests/runtime/review-gate-coordinator-scope-admission.test.ts \
    tests/integration/review-gate-authority-wiring.test.ts
  ```

- [ ] **Step 3: Implement exhaustive application** and remove production
  `runStartOrResume` equality-based routing. Route upstream/stale branches to
  existing Core orchestrator/lineage operations and verified current proof;
  restore known-dirty downstream before reopen, with successful restore evidence
  reprojected first. `REVALIDATE_OR_BLOCK` uses same-generation invalidation and
  authority revalidation; absent prerequisite proof blocks without allocation.
  `STAY_SUSPENDED` has no reviewer/remediator dispatch or budget/epoch change.
- [ ] **Step 4: Run GREEN** with focused and global checks. Prove the actual
  coordinator branches, not just a mocked decision handler table.
- [ ] **Step 5: Commit checkpoint**:
  `git commit -m "fix: Core AdmissionDecisionを網羅的に適用"`.

### Task 6: Complete Artifact NC1 Reentry and Restart-Safe Outcome Application

**Files:** Modify `src/runtime/review-gate-scope-admission.ts`,
`src/runtime/review-gate-coordinator.ts`,
`src/runtime/review-gate-requirements.ts`; extend
`tests/runtime/review-gate-scope-admission-nc1.test.ts`,
`tests/integration/review-gate-restart-recovery.test.ts` and
`tests/integration/review-gate-authority-wiring.test.ts`.

**Interfaces:** Consume existing Core `VerifiedReentryInput`,
`planNonConvergenceReentry(input): ReentryDecision`, registered deterministic
compatibility validation, verified dispatch recovery cursors and protected
response staging. `REENTRY_CANDIDATE` carries the original stop/change IDs;
only `REENTER_SAME_GENERATION` plus the required witnessed semantic/authority
transitions allows ACTIVE. Preserve existing operation protocol result types.

- [ ] **Step 1: Add tests** `reenters the same generation only after independent
  material progress`, `current upstream blocker preempts NC1 inspection` and
  `replays staged response once after restart`. Cover clean committed Design and
  Requirements changes, NO_MATERIAL_PROGRESS, INDETERMINATE, stale stop/frontier,
  malformed response, missing redelivery evidence, duplicated/conflicting result
  and spent Design 5/Plan 3. Assert same Gate/generation and unchanged rounds;
  no ACTIVE before witnessed outcome. Protocol-only candidates remain BLOCK.
- [ ] **Step 2: Run RED**:

  ```bash
  bun run vitest run \
    tests/runtime/review-gate-scope-admission-nc1.test.ts \
    tests/integration/review-gate-restart-recovery.test.ts \
    tests/integration/review-gate-authority-wiring.test.ts
  ```

- [ ] **Step 3: Connect the independent validation** and current Requirements
  compatibility producer to existing Core planners, private response staging
  and witnessed publication. Rebuild CURRENT precedence after change observation
  before candidate dispatch. Apply the original operation once; missing recovery
  evidence suspends with `REDISPATCH_EVIDENCE_UNAVAILABLE`. Never manufacture
  MATERIAL_PROGRESS, reset semantic cycles on an ordinary commit, or activate
  the protocol-only release path as a shortcut.
- [ ] **Step 4: Run GREEN** with focused/global checks and real disk restart.
  Cases requiring unavailable isolation remain explicitly BLOCKED, never mocked
  into full original Task 18 acceptance.
- [ ] **Step 5: Commit checkpoint**:
  `git commit -m "fix: NC1再入場を独立証拠と同一世代へ接続"`.

### Task 7: Preserve V2 Provenance in Approval and Read-Only Reuse

**Files:** Modify `src/runtime/review-gate-approval.ts`,
`src/runtime/review-gate-history.ts`,
`src/runtime/review-gate-admission-snapshot.ts`,
`src/runtime/review-gate-coordinator.ts`; test
`tests/runtime/review-gate-approval.test.ts`,
`tests/runtime/review-gate-history.test.ts` and
`tests/integration/review-gate-implementation-lock.test.ts`.

**Interfaces:** Preserve `ReviewGateApprovalLookup` and history wire shapes.
The history-mode observer derives its selector from immutable V2 and latest
verified effective authority, not absent CLI input or current marker alone.
Approval consumes the same Core exact-reuse decision and exact durable approval
event ID; no Legacy equality fallback for production V2/unverified histories.

- [ ] **Step 1: Add tests** `reuses CLI-selected completed gate without a marker`,
  `HEAD-only movement keeps approval read-only` and `stale Requirements prevents
  implementation arm`. Assert original H0/V2 selection remains byte-identical,
  effective authority may advance only through verified events, global protocol
  drift and ambiguous completed tips reject reuse. Count zero append, writer
  allocation, validator dispatch and Git mutation for history/reuse; CLEAR alone
  cannot arm, explicit approved command still needs exact current binding.
- [ ] **Step 2: Run RED**:

  ```bash
  bun run vitest run \
    tests/runtime/review-gate-approval.test.ts \
    tests/runtime/review-gate-history.test.ts \
    tests/integration/review-gate-implementation-lock.test.ts
  ```

- [ ] **Step 3: Implement shared verified observation** for read-only consumers
  and remove selector loss or V1 payload adaptation as authority. Validate original
  provenance plus latest effective Requirements/approved Design proof. Keep
  independently verified approved D0 reads when upstream worktree D1 is dirty;
  never silently substitute mutable Design bytes.
- [ ] **Step 4: Run GREEN** with focused/global checks; compare durable directory
  bytes before/after read-only calls and process restart.
- [ ] **Step 5: Commit checkpoint**:
  `git commit -m "fix: 完了承認でV2由来と現行権威を照合"`.

### Task 8: Prove the Actual Composition and Mutation Denial Boundaries

**Files:** Extend `tests/integration/review-gate-authority-wiring.test.ts`,
`tests/integration/review-gate-production-path.test.ts`,
`tests/integration/review-gate-real-host.test.ts`,
`tests/runtime/review-gate-legacy-bridge.test.ts` and
`tests/integration/review-gate-adapter-orchestration.test.ts`; modify
`src/runtime/opencode-adapter.ts` only for proven integration defects.

**Interfaces:** Exercise the existing actual command hook and shared runtime
factory. Keep Legacy/seam tests as lower-level regression coverage; add a
separately labeled protected verified-store matrix. Test fixtures may explicitly
provision trusted test installation evidence but must not install a production
trust root, change global credentials or authorize human approval implicitly.

- [ ] **Step 1: Add the command-path matrix**: CLI Requirements→V2 genesis,
  ordinary resume, Plan-only successor→fresh Design, unfinished drift→same-Gate
  revalidation, NC1 two-key path, read-only reuse and explicit implementation
  lock. Include native absent, wrong membership, corrupt/deleted history,
  cross-scope relabel, competing claims and unanchored Legacy corpus. Assert
  no fallback/capacity reset, durable replay equality and no mutable worker
  dispatch when FDR-015/016 or closing-seal prerequisites are unproven.
- [ ] **Step 2: Run RED**:

  ```bash
  bun run vitest run \
    tests/integration/review-gate-authority-wiring.test.ts \
    tests/integration/review-gate-production-path.test.ts \
    tests/runtime/review-gate-legacy-bridge.test.ts \
    tests/integration/review-gate-adapter-orchestration.test.ts
  ```

- [ ] **Step 3: Fix only demonstrated integration defects**. Use one real
  witness/store/admission graph; the publication proof must come from verified
  shards and protected CAS, not `createRecordingSeam`. Do not enable production
  `mutationSubstrate` until the original PLAN-027/029/030 and FDR-015/016 effect
  guards and host isolation are demonstrated; otherwise assert typed suspension.
  Retain immutable Legacy bytes and explicit fail-closed classification.
- [ ] **Step 4: Run GREEN** with focused/global checks. On a supported host,
  additionally run
  `JUSTICE_REAL_HOST_E2E=1 bun run vitest run tests/integration/review-gate-real-host.test.ts`.
  This opt-in is native/Git regression evidence, not live OpenCode G3 proof.
- [ ] **Step 5: Commit checkpoint**:
  `git commit -m "test: 本番Review Gate認可経路の回帰を検証"`.

### Task 9: Record Acceptance Evidence and Reconcile Progress

**Files:** Modify `docs/review-gate-v4-evidence-checklist.md`,
`docs/superpowers/plans/2026-10-09-review-gate-v4-contract-conformance.md`, this
plan and `README.md`'s behavior summary where necessary. Create
`docs/reports/2026-10-09-issue-310-review-gate-v4-implementation-verification.md`
only after authorized implementation and actual runs, as the original plan
requires. Correct stale implementation-status prose in `SPEC.md` only through
the separately reviewed documentation update required by the original plan;
do not change normative behavior to match incomplete code.

**Interfaces:** Evidence rows identify source HEAD, command/environment,
executed production boundary, result, warnings/skips and remaining blockers.
Track IMPLEMENTED/PARTIAL, VERIFIED/UNVERIFIED and acceptance separately.
Merged PR or test-file existence alone never means task acceptance.

- [ ] **Step 1: Audit each NEG closure** against Tasks 1–8 actual results and
  each reopened original-plan step. Historical RED cannot be retroactively
  asserted; an already-passing test is regression evidence. Count every
  mandatory NOT RUN/SKIPPED case as outstanding, not PASS.
- [ ] **Step 2: Run the original live-host command**, only on the supported
  provisioned host:
  Record host/credentials/isolation prerequisites as BLOCKED when unavailable;
  do not infer physical fencing or protected deployment from native Git tests.

  ```bash
  JUSTICE_RUN_LIVE_HOST_E2E=1 bun run vitest run \
    tests/integration/review-artifact-linux-host-e2e.test.ts \
    tests/runtime/linux-review-gate-provider-e2e.test.ts
  ```

- [ ] **Step 3: Record a claim-limited report** and request independent
  whole-branch code/security review. Map original G2/G3 and DEP-02/03/04
  obligations individually. Protocol-positive cases still depend on the phase
  plan; no unconditional original Task 18–20 completion while they are blocked.
- [ ] **Step 4: Verify docs and final checks** with `markdownlint-cli2` on
  changed Markdown plus the four fresh global commands; validate relative
  links, actual command/test paths and checkbox consistency. Update only the
  steps whose full deliverable and required evidence are satisfied.
- [ ] **Step 5: Commit checkpoint** after review of exact evidence files:
  `git commit -m "docs: Review Gate是正の実証と残課題を記録"`.

## Dependencies and Handoff

Execute Task 1 first to contain unverified admission. Task 2 supplies the
observation contract; Task 3 its ownership; Task 4 its generation publication;
Tasks 5–7 complete decision execution and consumers; Task 8 proves their real
composition. Task 9 records evidence. No task may hide an unavailable dependency
behind a permissive stub. Unimplemented mutation/protocol trust prerequisites
remain explicit BLOCKED items under their original owners.

Estimated effort remains **10–20 engineer-days for scoped remediation**,
excluding baseline-load diagnosis and newly discovered prerequisite defects.
Full original host/deployment acceptance may require **4–8 weeks or more**.
The source inspection above exposes integration prerequisites, so the lower
estimate is not a fixed-price commitment or an assurance of G3 readiness.

Plan self-review: NEG-001→1/3/8; NEG-002→2/4/7/8; NEG-003→3–6/8;
NEG-004→9. Each Review Focus item has explicit positive/negative owner tests.
Existing design remains the contract owner; this follow-up neither reapproves
the old plan nor grants implementation/merge/deployment authority.
