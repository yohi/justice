# Review Gate Authority Wiring Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close NEG-001–003 through the SRG-340-001–004 execution contracts below
and keep NEG-004 progress and acceptance claims consistent with actual evidence.

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
   V2 Gate before any prior `GATE_CREATED`; unrelated dirty/staged paths and an
   unentered dirty Plan do not prevent Design admission (Tasks 2, 4).
3. A competing caller changing the frontier between observation and application
   cannot receive stale authority or bypass admission on contention (Task 3).
4. Changed unfinished artifacts and NC1 reentry must preserve Gate/generation,
   spent rounds and independent validation across restart (Tasks 5–6).
5. Completed reuse after unrelated HEAD movement is read-only. Changed
   Requirements/protocol and unknown Legacy authority cannot arm implementation
   (Tasks 7–8). During Plan review, all approved-Design content paths return D0,
   even with a dirty D1 worktree; unsupported paths are denied before reading.

## Baseline and Scope of Completion

Source baseline: `b86562aa6ce7543bf11d78f9ba1067d1f101b1e1` (2026-10-16).
PR #340 comparison is **`v4...PR HEAD`**, not `master`. The independently
re-reviewed HEAD is `c7ef6a4daf19f0ac4848a1e0c041a1737be1c711`
(ahead 2 / behind 0; 3 files), reviewed on 2026-10-18 JST.
`de56d8df7f8f200cdd0e5988a87a8443bd704c3c` is the **previous Review HEAD**.
At c7ef6a4, SRG-340-001 was PARTIALLY RESOLVED and still BLOCKER;
SRG-340-002–004 were RESOLVED IN PROPOSAL, not implemented or verified.
This revision supplies the remaining owned-history read contract for 001;
its independent acceptance is pending, not self-declared READY.
This revision changes only the three PR documents. All source signatures and
tests introduced below are **planned**, not implemented or executed here.
The Review Gate remains **BLOCKED / independent fresh review pending**;
document remediation is not approval or G1/G2/G3/DEP proof.
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

Historical planning-time checks, before product changes, used Bun **1.4.2** in the
configured container. `bun run test` exited 1: **41 suites failed to load,
182 passed, 1 skipped; 2776 tests passed, 5 skipped**. Failures include undefined
`z.string` / `z.strictObject` at Zod consumers. Root cause is not established;
do not attribute these failures to NEG-001–003 or fabricate contract RED from
them. `bun run typecheck` and `bun run build` exited 0; `bun run lint` exited 0
with warnings. These commands were not rerun for this document-only revision.
Historical checklist success is not a current GREEN result.

**Execution prerequisite:** first reproduce the baseline with the lockfile and
configured runtime; diagnose the import/load blocker before interpreting RED
or GREEN. Do not change dependency versions, lockfile or product behavior just
to conceal the failure. If a source fix is required, capture its own failing
test and reviewed fix before executing the tasks below.

**Scoped completion criteria (not current status):** NEG-001/002, decision/lease
integration and D0 host mediation require actual production regression evidence;
every unsupported transition remains explicitly BLOCKED.
**Full original acceptance:** additionally requires every original Task 19/20
obligation, protocol-plan dependencies and DEP-02/03/04 proofs. Scoped completion
must never be relabeled G2/G3 PASS or Implementation Ready.

## Binding Execution Contracts for SRG-340-001–004

The following choices are part of Tasks 2–5 and 7–8, not optional worker design.
Reuse the existing protected store/registry, event publication and read service.
Do not introduce a second signer, journal authority, TTL or approval protocol.

### Owned Admission Publication (SRG-340-001)

**New Runtime entry point:** `withAdmissionWitnessTransaction<T>(context,
request: ScopeAdmissionRequest, run: (owned: AdmissionOwnedWitness)
=> Promise<T>): Promise<T>` in `review-gate-witness-context.ts`.
`context` has the existing `WitnessContext` type. The witness factory exposes
this entry only to scope admission, not as an agent/custom tool capability.

It acquires the existing protected `store.withGuard("installation", ...)`
once, authenticates installation/repository/registry, and discovers related
scopes/Gates and any pending admitted publication under that ownership. Include
the signed proposal's new Gate and all predecessor/related Gates in the sorted
lock set. For genesis, allocate only tentative IDs under installation ownership
before locking, and bind them to the one protected pending publication before
any shard effect; tentative IDs confer no budget or membership. Then use
`withWitnessScopeGateLocks` once for sorted scopes followed
by sorted Gates. Verify journals, rebuild observation and run Core only after
these locks are owned; no pre-lock selection has authority. Busy acquisition
releases the partial set. Release Gate→scope→installation in `finally`.
Admission explicitly recovers authenticated pending publications before the
ordinary committed-journal completeness scan: only exact named/staged bytes
may explain an advanced shard or new member awaiting CAS. An unaccounted orphan,
missing history or conflicting staged bytes remains BLOCK, never an empty scope.
The transaction entry itself does not automatically mutate for read-only use.

`AdmissionOwnedWitness` is a new non-serializable Runtime capability created only
by that entry point, bound to its live guard owner and workspace/lock set. Its
methods reject use after callback exit, foreign Gate/scope IDs or another owner.
The wrapper verifies ownership at runtime; a DTO/type assertion is not proof.
Its narrow methods mirror existing public witness operations:

- `read(): Promise<WitnessTransaction>` authenticates/reloads the registry under
  the already held installation guard; it acquires no lock.
- `readVerifiedFrontier(): Promise<VerifiedScopeFrontier>` uses `workspaceFrom`
  and the existing protected journal verification under the same ownership.
  It returns authenticated workspace membership/frontier, not Gate history.
  Complete scope history is supplied by the EventStore owned method below;
  the former frontier-only `readVerifiedScope` proposal is removed.
- `preparePublication(input: PreparedWitnessPublicationV1,
  bytes: Uint8Array): Promise<"prepared" | "already_prepared">` invokes existing
  `preparePublicationUnlocked(context, current, input, bytes)` with Task 4's
  authenticated admission validation. Re-read `current` after every advance.
- `publishPreparedJournal(publicationId: string): Promise<void>` uses a new
  private `publishPreparedJournalUnlocked(context, current, publicationId)`
  extracted from the existing public wrapper. It verifies protected staging,
  pending revision, terminal seal, exact preimage and bytes, then calls the
  existing native `durableReplaceWriterShard`; no nested scope/Gate guard.
- `commitPreparedPublicationCAS(input: PublicationCommitInput)
  : Promise<PublicationCommitResult>` calls existing `commitPublicationUnlocked`
  with freshly read `current`. Protected journal, consumed authorization and
  frontier move remain one `store.advance` CAS, not separate authority writes.
- `recoverPreparedPublication(publicationId: string)
  : Promise<PublicationCommitResult>` authenticates the same protected pending
  record, syncs its exact bytes if needed, and uses the same commit method;
  no new operation, event, Gate or authorization is allocated for recovery.

**Call order:** scope admission → owned entry → verified read/recovery → current
Git/Requirements observation → Core decision → Task 5 handler → Task 4 prepare
→ exact shard sync → fresh-registry CAS → internal result → reverse release.
The EventStore methods take `owned: AdmissionOwnedWitness` explicitly. They
must not call public `prepareVerifiedEventPublication`'s ordinary witness path,
`withWitnessTransaction` or `withGateOwnedWitnessTransaction` from this callback:
the last helper still acquires installation, despite its name. Public wrappers
remain usable only when their own guard acquisition is legal. Terminal intent
cannot pass generic publication: preserve the existing sealed specialized route.

This is a short authoritative slice, not a guard held while an external worker,
host signer, closing seal or revoke operation runs. Response/result application
re-enters ownership and rebuilds current authority. No worker inherits handles.

### Owned Verified History Read (SRG-340-001 Remaining Blocker)

Add the following Runtime-only method to the durable EventStore surface in
`review-gate-event-store.ts`; reuse its existing `VerifiedScopeRead` type:

```typescript
readVerifiedScopeOwned(
  owned: AdmissionOwnedWitness,
  scopeId: string,
): Promise<VerifiedScopeRead>

// Existing result type; no frontier-only substitute or schema relaxation.
type VerifiedScopeRead = Readonly<{
  frontier: VerifiedScopeFrontier;
  gateIds: readonly string[];
  eventsByGate: ReadonlyMap<string, readonly VerifiedReviewGateEvent[]>;
}>;
```

**Ownership and reuse:** validate the live owned capability, workspace and full
required scope/Gate lock set. Use `owned.readVerifiedFrontier()` and existing
frontier membership, `findScope`/`findGate`, `readShardBytes`, `decodeShard`,
`readGateVerifiedEvents` and verified causal projection checks. Extract their
common assembly into private
`readVerifiedScopeFromFrontier(frontier: VerifiedScopeFrontier,
scopeId: string): Promise<VerifiedScopeRead>`. That private assembler acquires
no guard and never calls `observeFrontier` or a public witness/store read.
Only the public wrapper's independently verified frontier or this live owned
wrapper may call it; a caller-supplied/cached frontier grants no authority.
Do not route owned reads through the public `serialize` queue: a queued public
operation may itself wait for installation ownership held by this callback.

The ordinary `eventStore.readVerifiedScope(scopeId)` retains its signature,
public serialization and `observeFrontier()` entry, then uses the shared
assembler. Read-only History/Approval callers outside admission keep that API.
Owned callers never reach `witness.readWorkspaceScopeFrontier()`,
`withWitnessTransaction()` or the public store wrapper, directly or transitively.

**Completeness:** after admission's authenticated pending recovery, verify
fresh protected frontier membership and exact per-writer shard/hash/sequence/
protected-mirror agreement. Decode bounded typed events, validate their Gate,
writer, generation, parent/causal ordering and unique tip; reject missing member
shards, duplicate/conflicting events or unprovable ordering. Assemble all member
Gates/writers in the same deterministic order as the shared verified projection.
Every listed Gate has its complete `eventsByGate` entry; do not substitute `[]`
for a missing map entry or shard. Preserve registered Legacy fail-closed rules.

Observer discovers the required related scopes from the authenticated complete
workspace registry, not a caller path list or scope index. Each required
`readVerifiedScopeOwned(owned, relatedScopeId)` returns history bound to the
same `globalFrontierHash`; require complete relation closure before projecting
admission precedence/budgets. If recovery or a witnessed observation advances
the frontier, discard **all** prior scope reads and rebuild under ownership.
Reuse existing orphan detection: only an exact authenticated pending publication
may explain staged/advanced bytes, and recovery must finish before those bytes
become projection authority. Unknown orphan, corruption or incomplete required
closure BLOCKS without partial projection, allocation or new operation IDs.
Keep Design §4.1's scope boundary: independently unrelated-scope corruption alone
cannot invalidate a verified healthy scope; this never permits omitting a
required related scope or treating unknown membership as proven independence.

**Observer wiring:** add
`observeVerifiedAdmissionSnapshotOwned(options: VerifiedAdmissionSnapshotOptions
& Readonly<{ owned: AdmissionOwnedWitness }>)
: Promise<VerifiedAdmissionSnapshot | null>` in the snapshot module. Its shared
observation logic uses only the owned reader closure
`scopeId => eventStore.readVerifiedScopeOwned(owned, scopeId)` for the requested
scope **and every related scope**. Scope admission invokes this entry, including
NC1 second-pass observation after publication. Keep the existing public observer
for outside-lease History/Approval, with the public reader bound separately;
there is no optional owned→public fallback on missing proof or exceptions.

**First use:** inspect authenticated pending enrollment and workspace frontier
under ownership before requesting scope history. If the requested scope is
absent, the owned scope reader still rejects membership absence. Only a valid
first-use authorization plus proven empty committed membership/history permits
the observer's distinct first-enrollment branch with no existing history and
`currentTips: []`. Do not construct a fake registered scope, Gate or
`GATE_CREATED`, and do not call `findV2GateCreated` in that branch. Any existing
pending publication is recovered as its original operation first; missing or
corrupt history never becomes first-use absence. Enrolled scopes always use
complete verified history, including every related unfinished generation.

**D0 consumer:** Task 7's `buildApprovedDesignOperationReadBinding` uses the
same owned reader/observer to project Design CLEAR and effective authority.
It cannot call the public approval/history lookup or public verified reader
from a held guard. The host authority facade may start a fresh read-only owned
transaction when none is held; its internal projection stays entirely owned.
Immutable Git blob reads do not reacquire witness guards. Missing history/proof
denies content; no cached frontier or shape-only D0 binding can authorize reads.
A read-only D0 query never invokes publication recovery/CAS to make itself
readable. If pending state prevents a complete committed projection, deny
content until ordinary admission recovers it; keep the query mutation-free.

### Internal Results and Outer Driver (SRG-340-001)

Define the new Runtime union in `review-gate-admission-context.ts`:

```typescript
type ReviewGateAdmissionExecutionResult =
  | Readonly<{ kind: "RESULT"; result: ReviewGateCommandResult }>
  | Readonly<{
      kind: "BLOCK";
      reason: string;
      result: ReviewGateCommandResult;
    }>
  | Readonly<{
      kind: "HANDOFF_PENDING";
      continuation: VerifiedTargetWriterHandoffContinuationV1;
    }>
  | Readonly<{
      kind: "TERMINAL_INTENT_PREPARED_UNPUBLISHED";
      gateId: string;
      publicationId: string;
      terminalTransitionOperationId: string;
    }>;
```

`ReviewGateCommandResult` remains the PlanBridge-facing public result. The
executor/handlers and admission callback return the union; only the outer
coordinator converts RESULT/BLOCK to the public result. The terminal IDs resolve
the exact authenticated pending record and target set; they are not authority
to seal/revoke. No continuation carries a reusable `AdmissionDecision`.
The driver interfaces below are requirements from the original plan; their
production completeness is not assumed or certified by this document.

- **HANDOFF:** persist the original bounded intent, return HANDOFF_PENDING,
  release all admission guards, then run the original PLAN-027
  `executeWriterHandoffContinuation`. It acquires the complete ordered guard
  set, revalidates/fences/claims, releases it, and invokes `withAdmissionLease`
  again. Resume only from verified receipt plus fresh Core planning.
- **Terminal:** protected-prepare exact intent, return the terminal variant
  with no witnessed intent/COMPLETED. After full release, the original PLAN-030
  `executeTerminalClosingSealContinuation` owns ordered workspace/scope/Gate/
  target guards, verifies native ordering and installs the complete seal.
  Release and re-admit; the specialized sealed route alone can witness the
  original intent and enter CLOSING_PENDING. Yield HANDOFF_PENDING with the
  existing revoke-only continuation, release, perform PLAN-029 protected revoke
  and tombstone, release and re-admit again before terminal confirmation.
- **Busy:** before prepare, release and return retryable blocked guidance with
  zero side effects. A durably prepared handoff/terminal operation retains its
  original pending state and operation ID; outer-driver retry does not publish
  completion or allocate rounds. Never bypass admission or spin under a guard.
- **Exception/crash:** release every acquired guard. Before durable prepare,
  grant no authority; after prepare, recover the same protected record. After
  shard sync but before CAS, no authoritative Gate completion exists. After CAS
  but before response, recover the committed result once. Sealed-unpublished
  recovery denies old writes but is not CLOSING_PENDING or completion.
- **CAS conflict:** no reviewer/worker dispatch, no index-tip promotion and no
  new authorization. Preserve pending exact bytes, release, and re-admit to
  recover the same operation or BLOCK if its frontier/proof is unrecoverable.
  Never rebind a signed authorization or prepared event to a different frontier.

### Authenticated Membership Publication (SRG-340-002)

**Genesis producer:** independently provisioned `authorizeWorkspace` signs and
stores the first authorization. Task 2 authenticates pending enrollment, actual
installation identity and absence/continuity proof. Admission never signs.
Extract new private `validateFirstEnrollmentUnderAdmission(context, current,
authorization, snapshot): Promise<VerifiedFirstEnrollmentAuthorityV1>` from the
existing consumer's signature/nonce/identity checks. It does not advance state;
Task 4's genesis prepare atomically records nonce/enrollment consumption and
the exact pending publication in one registry CAS. The stage bytes are durable
first. Validate genesis against that intended consumed state before advance;
do not weaken `validatePublication`'s genesis rules or consume on a separate
irrecoverable admission call. Existing consumed-without-matching-pending state
is not permission for a new genesis; BLOCK if its operation cannot be proved.

**Successor producer:** the independently authenticated host provisioner invokes
existing `authorizeAdditionalScope(context, { scope, operationId, authorize })`
outside admission ownership. Its host signer validates the existing payload:
installation ID, workspace identity, stable operation ID, expected workspace
frontier and exact proposed `ScopeEnrollmentV1`. The existing helper validates
completed predecessor, continuity and absence of active prior target owner,
verifies host signature and persists `scopeAuthorizations[operationId]`.
No agent access, Runtime signing callback, fabricated signature or first-use
authorization reuse is allowed. A deployment lacking this provisioner BLOCKS.

The signed scope proposal fixes new Gate/writer IDs and predecessor before
admission; for the same scope, keep old enrollment/members byte-identical and
add only the authorized successor member. Cross-scope proposals retain the
existing verified-completed-successor provenance/continuity checks. Changed
proposal/operation/frontier requires independent reauthorization, never a
Runtime rewrite. Do not invent an expiry field or time-based lease: existing
freshness is exact frontier, operation identity and one-time consumption.

**Consumer:** Task 4 adds `membership: AdmittedMembership` to its prepared input.
Define the new union in `review-gate-admission-context.ts`: genesis carries
`kind: "genesis"` and `firstEnrollment: VerifiedFirstEnrollment`; successor
carries `kind: "successor"`, `scope: ScopeEnrollmentV1` and
`authorizationOperationId: string`. The owned validator loads that exact
protected authorization record, verifies signature, installation/workspace,
unconsumed status and expected frontier with
`verifyAdditionalScopeAuthorization(current, scope, expectedFrontier,
authorizationOperationId): void`; add the fourth required argument rather
than accepting any matching record. Reverify the Core predecessor approval,
relation proof and current completed tip, then build the exact next frontier.

Extend `buildPublication` only for that authenticated union; absence of
firstEnrollment is not an exception to membership checks. Preserve generic
append validation. `preparePublicationUnlocked` authenticates the new Gate
membership, allowed writer, genesis/successor relation and exact next frontier.
`commitPublicationUnlocked` consumes the **matching operation's** additional
authorization in the same CAS that installs membership and new writer head.
Do not consume all merely scope-equal records. `expectedInstallationFrontier`
uses the fresh registry hash after the provisioner saved its record;
`expectedGlobalFrontier` must still match its signed workspace frontier.
Carry `scopeAuthorizationOperationId: string | null` in newly prepared
`PreparedWitnessPublicationV1` and its protected schema/receipt: successor uses
its exact authorization ID; genesis and ordinary unchanged-membership appends
use null. Extend the witness contracts and registry schema, not event bytes or
the host-signed payload. Historical records remain immutable; a missing field
is not additional membership authority, and unprovable old pending membership
changes BLOCK rather than gaining a fabricated operation ID.

Recovery reuses signed proposal, IDs, bytes and publication ID. Prepared but
uncommitted authorization remains tied to that pending record; an already
committed identical publication returns the recorded result, not a second use.
Invalid signature, replay for another operation, missing proof, changed
predecessor/frontier, competing authorization or missing staged bytes means
BLOCK/no allocation. Full CAS races are serialized by installation ownership;
injected stale/CAS conflicts still fail closed. Successor always starts fresh
Design review and never inherits Design CLEAR.

### First-use Target Clean Policy (SRG-340-003)

Define `VerifiedEnrollmentAdmissionSnapshot` in the Runtime context module as
`Readonly<{ phase: "design"; requirementsResolution: RequirementsResolutionV2;
designArtifact: ReviewArtifactBinding; planArtifact: ReviewArtifactBinding }>`.
It is an observed candidate, not caller-authenticated proof. The owned validator
recomputes canonical path/blob/mode/digest and a single stable HEAD/index/worktree
snapshot; require clean committed Requirements and the Design target. For Plan,
bind only its committed Git entry as unapproved downstream input, allowing dirty
or staged Plan bytes. Allow unrelated modified, staged and untracked paths;
they never enter selection, scoped index updates or commit payloads.

Remove the blanket porcelain-empty condition from the ordinary first-enrollment
consumer and reuse this target-local validator there and in admitted prepare.
Signature/nonce, repository identity, absent-prior-enrollment/related-scope,
safe-path/alias, HEAD and exact artifact checks remain mandatory. No current
host provisioning operation is shown to require global cleanliness; do not
retain it as an undocumented admission prerequisite. A separately approved
installer policy, if any, is not a reason to reject ordinary Gate admission.
Later Plan entry rechecks clean Plan and approved D0 independently. Dirty current
target without exact prepared recovery proof BLOCKS; no broad clean waiver.

## File and Responsibility Map

Paths below are relative to the repository root; these are future code changes.

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
  `src/runtime/review-gate-publication-record.ts` and
  `src/runtime/review-gate-publication-validation.ts`: atomic admitted
  generation/writer membership and witnessed V2 publication.
- `src/runtime/review-gate-witness-contracts.ts` and
  `src/runtime/review-gate-witness-registry.ts`: exact protected publication
  authorization-operation reference, preserving immutable historical records.
- `src/runtime/review-gate-admission-executor.ts` (new) and
  `src/runtime/review-gate-coordinator.ts`: exhaustive decision application
  and existing driver integration.
- `src/runtime/review-gate-requirements.ts`,
  `src/runtime/review-gate-approval.ts` and
  `src/runtime/review-gate-history.ts`: original V2 versus effective authority
  and verified read-only consumers.
- `src/runtime/review-gate-approved-design-authority.ts` (new),
  `src/runtime/review-gate-query.ts`, `src/runtime/justice-tools.ts` and the
  adapter/PlanBridge: operation-bound D0 producer, verified query facade,
  prompt input and last-mile host mediation (Task 7).
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
`src/runtime/review-gate-event-store.ts`,
`src/runtime/review-gate-scope-admission.ts`,
`src/runtime/review-gate-scope-witness.ts` and
`src/runtime/review-gate-witness-enrollment.ts`.

**Interfaces:** In the new Runtime module define
`ReviewGateAdmissionObservation = Readonly<{ snapshot: VerifiedAdmissionSnapshot;
requirementsResolution: RequirementsResolutionV2 }>`.
Also declare the Runtime-only owned port, membership, internal-result and
first-use snapshot types specified in the binding execution contracts above;
Task 3 creates their authenticated live transaction, not Task 2's test fixtures.
Define the owned observer entry and EventStore owned-reader signature from the
remaining-blocker contract. Task 2 extracts shared observation/assembly and
binds owned versus public readers explicitly; Task 3 supplies the live guard
capability. Never satisfy projection with a frontier-only return value.
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
  Add `first enrollment permits unrelated dirty staged and untracked paths`
  and `first Design enrollment permits dirty downstream Plan`. Assert both
  preserve unrelated index/worktree bytes and pin committed Plan, never its
  dirty bytes. `dirty Design or Requirements blocks first enrollment` must
  leave nonce pending and create no Gate or writer. Reject unsafe path/alias,
  mixed HEAD/index snapshot, replayed nonce and related unfinished scope even
  when all current targets are clean.
  Add `owned observer projects all Gates and writers at one verified frontier`
  and `related unfinished history cannot be hidden by an empty requested scope`.
  Assert exact gate IDs, complete per-Gate events/causal tips, spent rounds and
  relation-closure frontier. Test valid pending enrollment as no-history first
  use, distinct from registered-empty/missing/corrupt history. A mock frontier
  alone or scope-index hint cannot make any positive case pass.
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
  Extract `validateFirstEnrollmentUnderAdmission` and the required
  `VerifiedEnrollmentAdmissionSnapshot`; ordinary
  `consumeFirstEnrollment(context, authorization, snapshot)` shares its
  target-local validation rather than porcelain-empty. The admitted genesis
  path calls the non-consuming owned validator, not the public consuming
  wrapper. Task 4 owns atomic consumed-plus-pending publication. Do not remove
  signature, nonce, absence/continuity or exact Git evidence checks.
  Route scope admission and both NC1 passes to the owned observer; its requested
  and related reads use `readVerifiedScopeOwned`. Public History/Approval retain
  their outside-lease API. Owned exceptions become existing null/BLOCK handling,
  never a public-reader retry or fabricated empty history.
- [ ] **Step 4: Run GREEN** using the focused command and four global checks.
  Missing protected first-use evidence must remain BLOCK, not a new workspace.
- [ ] **Step 5: Commit checkpoint**:
  `git commit -m "fix: Requirements選択と検証済み初回認可を伝播"`.

### Task 3: Keep Admission Authority Through Decision Application

**Files:** Modify `src/runtime/review-gate-scope-admission.ts`,
`src/runtime/review-gate-lock-manager.ts`,
`src/runtime/review-gate-witness-context.ts`,
`src/runtime/review-gate-event-store.ts`,
`src/runtime/review-gate-admission-snapshot.ts`,
`src/runtime/review-gate-coordinator.ts`; test
`tests/runtime/review-gate-scope-admission.test.ts`,
`tests/runtime/review-gate-coordinator-scope-admission.test.ts` and
`tests/runtime/review-gate-lock-manager.test.ts`; extend
`tests/runtime/review-gate-event-store.test.ts` and the new snapshot tests.

**Interfaces:** Change the Runtime-only callback to
`withAdmissionLease<T>(request: ScopeAdmissionRequest,
run: (decision: AdmissionDecision, observation: ReviewGateAdmissionObservation,
owned: AdmissionOwnedWitness) => Promise<T>): Promise<T>`.
For coordinator application, `T` is `ReviewGateAdmissionExecutionResult`, not
the public command result. Implement the owned entry, exact lock set/lifetime,
private shard-sync extraction and continuation state machine specified above.
No external worker/signer/seal/revoke is awaited while this callback owns guards.

- [ ] **Step 1: Add tests** `keeps admission ownership until genesis is durable`,
  `contention never skips admission`, `replans after yielded authority changes`
  and `releases every guard on callback failure`. Pause two real callers;
  assert only one generation/publication, no stale-frontier dispatch and no
  Gate→workspace inversion. An occupied guard must not call Legacy routing.
  Add `owned publication acquires each guard once` with a real protected store:
  assert installation→sorted scopes→sorted Gates→read→prepare→shard sync→CAS
  and reverse release; spy-reject public transaction/witness wrapper re-entry.
  Cover busy second scope/Gate, read/prepare/sync/callback exceptions, stale
  CAS, capability use after release and foreign-Gate capability use. No worker
  dispatch/index-tip promotion on failure; durable pending IDs survive.
  Add `owned verified history never reenters public reads`: use the real
  EventStore/Witness/Admission graph with signed enrollment and actual writer
  shards; fail the test on `readWorkspaceScopeFrontier`, public
  `eventStore.readVerifiedScope` or duplicate installation/scope/Gate acquisition
  inside the owned callback. Assert correct multi-Gate/multi-writer projection
  at one frontier, complete related scopes and valid pending first enrollment.
  Orphan, missing/corrupt shard, incomplete related history and stale cached
  frontier must BLOCK with no partial projection/dispatch. A prepared but
  uncommitted shard recovers the identical publication once before projection;
  missing staging BLOCKS. No mocked frontier-only fixture counts as GREEN.
- [ ] **Step 2: Run RED**:

  ```bash
  bun run vitest run \
    tests/runtime/review-gate-scope-admission.test.ts \
    tests/runtime/review-gate-coordinator-scope-admission.test.ts \
    tests/runtime/review-gate-lock-manager.test.ts \
    tests/runtime/review-gate-event-store.test.ts \
    tests/runtime/review-gate-admission-snapshot.test.ts
  ```

- [ ] **Step 3: Implement transaction ownership** and remove
  `scope_lease_occupied`'s `runStartOrResume()` bypass. Read/recover/replan after
  acquiring guards; re-read the full snapshot after NC1 observation advances
  the frontier. Do not reuse the first-pass spread as second-pass authority.
  Read-only completed reuse obtains no writer lease or append; mutable
  continuation yields before wider guards and revalidates on return.
  Construct the owner-checked port only inside
  `withAdmissionWitnessTransaction`; reload `WitnessTransaction` after every
  registry advance so shard sync/CAS use the prepared revision. Do not reuse
  the immutable pre-prepare transaction object for later mutations. Keep
  existing public witness wrappers for callers outside this owned path.
  Implement `readVerifiedScopeOwned` using the shared unguarded assembler and
  owned frontier verification, bypassing public guard-taking read/serialization.
  Snapshot projection and all related-scope reads consume `VerifiedScopeRead`,
  not the frontier-only port. Every witnessed change invalidates earlier read
  material; retry builds a complete current snapshot or returns BLOCK.
- [ ] **Step 4: Run GREEN** with the focused command and four global checks;
  instrument actual acquisition/release order, including thrown exceptions.
- [ ] **Step 5: Commit checkpoint**:
  `git commit -m "fix: Admission判断と適用のロック境界を統一"`.

### Task 4: Publish Admitted V2 Generations and Membership Atomically

**Files:** Modify `src/runtime/review-gate-event-store.ts`,
`src/runtime/review-gate-witness-publication.ts`,
`src/runtime/review-gate-publication-record.ts`,
`src/runtime/review-gate-publication-validation.ts`,
`src/runtime/review-gate-witness-contracts.ts`,
`src/runtime/review-gate-witness-registry.ts`,
`src/runtime/review-gate-witness-enrollment.ts`,
`src/runtime/review-gate-witness-scope-enrollment.ts`,
`src/runtime/review-gate-coordinator.ts`; test
`tests/runtime/review-gate-event-store.test.ts`,
`tests/runtime/review-gate-witness-scope-enrollment.test.ts` and
`tests/integration/review-gate-authority-wiring.test.ts`.

**Interfaces:** Extend the existing verified publication owner, not the Legacy
`appendEvents` interface. Add
`prepareAdmittedGenerationPublication(input:
Omit<VerifiedEventPublicationInput, "firstEnrollment"> &
Readonly<{ decision: Extract<AdmissionDecision, { kind: "CREATE_GENESIS" |
"CREATE_SUCCESSOR" }>; observation: ReviewGateAdmissionObservation;
membership: AdmittedMembership }>, owned: AdmissionOwnedWitness)
: Promise<PreparedWitnessPublicationV1>` to the durable store. Runtime validates
the input against live protected authority; structural typing is not trust.
The admitted path has one membership authority source, not a second conflicting
`firstEnrollment` field inherited from the ordinary publication input.
Genesis/successor use the separate producers, exact protected authorization
lookup, owned publication methods and CAS consumption specified above.
No `authorizeAdditionalScope` call or host signing callback runs under a held
admission lease. Missing independent signed proposal means BLOCK guidance to
the provisioner; it does not start an implicit enrollment workflow.

- [ ] **Step 1: Add tests** `creates one witnessed V2 genesis from authorized
  pending enrollment`, `publishes successor membership with exact predecessor`
  and `recovers prepared genesis without a second budget`. Assert
  `schemaVersion === 2`, exact historical Requirements V2, actual Git modes,
  `supersedesGateId`, writer membership and verified shard frontier. Inject
  crashes before prepare, after staging, after shard sync and after CAS;
  concurrent authorization consumption must have one winner. Plan-only completed
  drift gets fresh Design review, not inherited CLEAR.
  Add `same-scope successor consumes exact additional authorization once` and
  `cross-scope successor preserves signed continuity`. Use actual host-signed
  registry records, not a DTO or mocked verifier. Assert membership and writer
  head appear together with the advanced frontier; only that operation's
  authorization becomes consumed. Test missing/wrong signer, altered membership,
  wrong operation/installation/workspace/frontier, unfinished/ambiguous prior
  Gate and active old writer; none may allocate or dispatch. Crash after signed
  authorization, after prepare, after sync and after CAS must recover identical
  IDs/bytes or BLOCK, never sign again or consume for another publication.
  Re-run Task 2's dirty unrelated/Plan positives through real genesis prepare.
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
  Implement the authenticated `AdmittedMembership` branch in `buildPublication`
  and `validatePublication`, including exact-operation authorization selection.
  Genesis atomically prepares and consumes its nonce; successor keeps its
  authorization unconsumed until the same CAS installs membership/head/frontier.
  Recovery verifies the original protected pending/committed record. Do not
  replace existing signature/continuity checks with the Core decision alone.
- [ ] **Step 4: Run GREEN** with focused and global checks; reopen disk stores
  and independently read `readVerifiedScope` to assert the same authority.
  This public post-transaction assertion runs only after every owned guard has
  been released; inside the callback use `readVerifiedScopeOwned` exclusively.
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
observation: ReviewGateAdmissionObservation; owned: AdmissionOwnedWitness }>,
handlers: ReviewGateAdmissionHandlers)
: Promise<ReviewGateAdmissionExecutionResult>`.
`ReviewGateAdmissionHandlers` is a mapped type over `AdmissionDecision["kind"]`;
each handler receives `Extract<AdmissionDecision, { kind: K }>` and the same
observation/owned port and returns that internal union. Coordinator supplies
Runtime execution handlers; the executor's
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
  Add `handoff returns before outer guards are acquired` and
  `terminal seal and revoke each require fresh admission`. Assert the sequence
  prepared-unpublished→release→seal→release→re-admit→sealed intent CAS→release
  →revoke/tombstone→release→re-admit→terminal confirmation. No CLOSING_PENDING
  before seal, no COMPLETED before verified revoke, no worker write after seal.
  Competing frontier changes between every slice must trigger fresh Core
  planning or BLOCK. Cover busy/exception/CAS/crash in every slice and prove
  no continuation can carry/use an old decision or leaked capability.
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
  Implement `driveReviewGateAdmission(sessionId: string,
  request: ScopeAdmissionRequest)
  : Promise<ReviewGateCommandResult>` as the outer coordinator loop. It consumes
  the internal union using the original PLAN-027/029/030 drivers; return public
  results only for RESULT/BLOCK. Resolve terminal IDs from authenticated pending
  records, never synthesize target/seal authority. Every driver outcome releases
  guards before another `withAdmissionLease`; a retry resumes the original
  operation under fresh observation, not a saved callback/AdmissionDecision.
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

### Task 7: Wire V2 Approval and Immutable D0 Through the Real Host

**Files:** Modify `src/runtime/review-gate-approval.ts`,
`src/runtime/review-gate-history.ts`,
`src/runtime/review-gate-admission-snapshot.ts`,
`src/runtime/review-gate-coordinator.ts`,
`src/runtime/review-gate-recovery-store.ts`,
`src/runtime/review-gate-query.ts`, `src/runtime/opencode-adapter.ts`,
`src/runtime/justice-tools.ts`, `src/hooks/plan-bridge.ts`;
create `src/runtime/review-gate-approved-design-authority.ts`;
test `tests/runtime/review-gate-query.test.ts`,
`tests/hooks/plan-bridge-review-lock.test.ts`,
`tests/runtime/opencode-adapter-v2.test.ts`,
`tests/runtime/review-gate-approval.test.ts`,
`tests/runtime/review-gate-history.test.ts` and
`tests/integration/review-gate-implementation-lock.test.ts`;
create `tests/integration/review-gate-approved-design-read.test.ts`.

**Interfaces:** Preserve `ReviewGateApprovalLookup` and history wire shapes.
The history-mode observer derives its selector from immutable V2 and latest
verified effective authority, not absent CLI input or current marker alone.
Approval consumes the same Core exact-reuse decision and exact durable approval
event ID; no Legacy equality fallback for production V2/unverified histories.

**SRG-340-004 producer:** the new Runtime module exports
`buildApprovedDesignOperationReadBinding(owned: AdmissionOwnedWitness,
input: Readonly<{ gateId: string; operationId: string; designPath: string }>)
: Promise<ApprovedDesignOperationReadBinding | null>`.
The new Runtime value contains `operationId: string`, `inputBindingDigest:
string` and `approvedDesign: VerifiedApprovedDesignReadBindingV1`. Under owned
verified read, require the current Plan operation, same-generation Design CLEAR,
latest effective Requirements/protocol/Design authority, exact committed Git
tree/blob/mode/digest and witness frontier. Dirty/staged D1 is diagnostic only.
No proof means null/BLOCK, never a shape-only DTO or worktree-derived binding.
Its Design CLEAR/effective-authority projection uses
`eventStore.readVerifiedScopeOwned(owned, scopeId)` and the owned observer for
all required scopes. Never obtain that projection through public Approval,
History, `readVerifiedScope` or `readWorkspaceScopeFrontier` while owned.

Coordinator calls that builder directly with its existing owned port; no nested
admission or public witness call. Persist the bounded binding with the existing
prepared logical operation/recovery input and bind its digest into the existing
dispatch input binding. Recover the same D0 for that operation after restart;
do not replace it with current HEAD/D1. Do not persist raw Design text/prompts
in authority events. Revalidate effective authority before content use and
commit/CLEAR; irrelevant HEAD movement alone is not invalidation.

**Composition:** export `createReviewGateApprovedDesignAuthority(input:
Readonly<{ admission: ReviewGateScopeAdmission; eventStore: ReviewGateEventStore;
git: ReviewGateGit; query: ReviewGateQueryService }>)
: ReviewGateApprovedDesignAuthority` from that module. Consume the shared
instances; the PlanBridge interface uses operation-bound inputs.
Extend `getApprovedDesignBinding` input with required
`operationId: string`; extend read/search inputs likewise. Retain the existing
query-service read/search signatures internally, delegating only after current
operation/authority checks. A host query starts a fresh short read-only owned
transaction; it cannot allocate writer/round/event. Add verified durable
`reviewPhase: ReviewGatePhase | null` and `operationId: string | null` to
`ReviewGateLockSnapshot`; null cannot authorize Plan content. A child request
cannot supply/override them. The composition root injects the created authority
using `setReviewGateApprovedDesignAuthority` alongside coordinator/approval,
before any Plan worker can run. No producer configured means blocked Plan
dispatch/content, never a global clean-Design prerequisite.
Read-mode observation uses the verified effective selector/approved Git binding,
not dirty D1's bytes or marker as new authority. Dirty D1 alone does not revoke
D0; a genuinely verified committed authority change still invalidates it.
Add the query and approved-design authority to the shared runtime graph;
never construct a second witness/store instance for the read path.

**Last-mile choice:** the current OpenCode before-hook can cancel a native tool,
but cannot safely replace native `read` output with arbitrary D0 bytes. Extend
the existing read-only `justice_review` tool with a strict optional `query`
union: `artifact_read { path }`, `artifact_search { path, literal }`,
`show { path }`, `status {}` or `diff { staged }` (each has a `kind` field).
Keep resolution actions disjoint and forbidden to reviewers. This is one
scoped query facade over existing services, not a new general shell/read API.
`show` of the approved Design has no caller revision override and returns D0.
Resolve operation/session authority from actual host context, not query args.

Wire `OpenCodeAdapter.onToolExecuteBefore` and the scoped query facade to
`PlanBridge.mediateReviewerArtifactRead`, resolving root/child session and
current operation first. Generic Design `read`, `grep/search`, content-bearing
Git `show`, shell fallback, alias/absolute paths and other unmediated content
tools are denied **before filesystem/tool execution** with scoped-query
guidance; after-hook output replacement is not an authorization barrier.
The facade returns the mediation result's exact D0 text/matches through the
normal plugin-tool response. Permit independent scoped status/diff diagnostics
through existing query methods, label D1 patches unapproved and never use them
as prompt/CLEAR evidence. Preserve unrelated allowed queries and exact denial
taxonomy; do not blanket-deny all queries as implementation-not-authorized.

**Prompt/attachment:** before dispatch, coordinator reads the same operation's
D0 via the verified query service and assembles all Plan reviewer, independent
validator, revalidation and applicable self-review context from those bytes.
Remove mutable `@Design` references and workspace attachments in that path.
If an attachment/content provider cannot deliver the pinned bytes with matching
proof, BLOCK that dispatch. Plan P0 must be clean; dirty D1 never becomes source
authority. The child worker receives neither the owned port nor signing keys.

- [ ] **Step 1: Add tests** `reuses CLI-selected completed gate without a marker`,
  `HEAD-only movement keeps approval read-only` and `stale Requirements prevents
  implementation arm`. Assert original H0/V2 selection remains byte-identical,
  effective authority may advance only through verified events, global protocol
  drift and ambiguous completed tips reject reuse. Count zero append, writer
  allocation, validator dispatch and Git mutation for history/reuse; CLEAR alone
  cannot arm, explicit approved command still needs exact current binding.
  Add `actual Plan host serves approved D0 while D1 is dirty or staged`: run
  the actual adapter/tool hook and dispatched prompt path with contradictory
  D0/D1 fixtures, no mocked authority producer. Assert every Plan role's prompt,
  attachment and facade read/search/show contains only exact D0 bytes, pinned
  mode/blob/digest and logical operation. Exercise an actual generic tool
  callback and assert its workspace-reader/shell executor is never invoked
  after denial; do not prove this with mediator-only mocks. Scoped status/diff
  still report D1 as diagnostics without replacing D0. Assert
  `review_operation_not_permitted` for missing/unbound proof and
  `review_scope_violation` for outside paths, not implementation authorization.
  Missing/corrupt D0 blob, stale CLEAR, changed Requirements/protocol, wrong
  operation/session/generation, alias spoof and unsupported attachment must
  block before content/dispatch. Restart restores the original bound D0; an
  invalidated binding cannot commit/CLEAR even if older read bytes are cached.
  Add `D0 read-only owned operation does not reacquire witness guards`: use
  actual protected history and shared graph, fail on any nested public reader
  or duplicate installation/scope/Gate acquisition, and assert exact D0 content
  and unchanged writer/event/round state. Missing/corrupt history must deny
  content even with a previously cached valid frontier and D0-shaped binding.
- [ ] **Step 2: Run RED**:

  ```bash
  bun run vitest run \
    tests/runtime/review-gate-approval.test.ts \
    tests/runtime/review-gate-history.test.ts \
    tests/runtime/review-gate-query.test.ts \
    tests/hooks/plan-bridge-review-lock.test.ts \
    tests/runtime/opencode-adapter-v2.test.ts \
    tests/integration/review-gate-implementation-lock.test.ts \
    tests/integration/review-gate-approved-design-read.test.ts
  ```

- [ ] **Step 3: Implement shared verified observation** for read-only consumers
  and remove selector loss or V1 payload adaptation as authority. Validate original
  provenance plus latest effective Requirements/approved Design proof. Keep
  independently verified approved D0 reads when upstream worktree D1 is dirty;
never silently substitute mutable Design bytes.
  Implement the producer, bounded recovery binding, exact authority injection,
  before-execution denial, strict scoped facade and pinned prompt/attachment
  assembly specified above. Existing helper shape tests, a setter with no
  composition caller or an unused mediator are not implementation completion.
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
  Include Task 7's D0/D1 matrix through actual `OpenCodePlugin` hooks, returned
  tool schema and worker packets; the provider must be the real producer from
  the shared graph. No fixture-only query scope, post-read redaction or
  broad tool denial may stand in for serving D0 and preserving diagnostics.
- [ ] **Step 2: Run RED**:

  ```bash
  bun run vitest run \
    tests/integration/review-gate-authority-wiring.test.ts \
    tests/integration/review-gate-production-path.test.ts \
    tests/runtime/review-gate-legacy-bridge.test.ts \
    tests/integration/review-gate-adapter-orchestration.test.ts \
    tests/integration/review-gate-approved-design-read.test.ts
  ```

- [ ] **Step 3: Fix only demonstrated integration defects**. Use one real
  witness/store/admission graph; the publication proof must come from verified
  shards and protected CAS, not `createRecordingSeam`. Do not enable production
  `mutationSubstrate` until the original PLAN-027/029/030 and FDR-015/016 effect
  guards and host isolation are demonstrated; otherwise assert typed suspension.
  Retain immutable Legacy bytes and explicit fail-closed classification.
  Assert original PLAN-027/029/030 acquisition/prepare/seal/CAS/revoke order
  and authenticated Successor membership consumption in this same real graph;
  component PASS cannot substitute for the producer→consumer chain.
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
NEG-004→9; SRG-340-001→3/4/5/8; SRG-340-002→4/8;
SRG-340-003→2/4/8; SRG-340-004→7/8. Each Review Focus item has explicit
positive/negative owner tests. All 45 execution steps remain unchecked.
Existing design remains the contract owner; this follow-up neither reapproves
the old plan nor grants implementation/merge/deployment authority.
