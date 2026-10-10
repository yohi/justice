# Justice v4 Review Gate — Contract Conformance Design

- Date: 2026-10-09 (JST)
- Repository: `yohi/justice`, base branch `v4`
- Original implementation audit baseline: `ed4dd8d5a3050fe6ba559b1ced94e01f0157f60b`
- **Ratified normative review baseline:** `5b33b79bb27a26c00e79f950c7211a625b4727bf` (`SPEC.md` §4.1c as amended, [#297](https://github.com/yohi/justice/issues/297) and [#310](https://github.com/yohi/justice/issues/310) as ratified on 2026-10-09)
- Requirements: [#297](https://github.com/yohi/justice/issues/297); gap audit: [#310](https://github.com/yohi/justice/issues/310); v5 boundary: [#298](https://github.com/yohi/justice/issues/298)
- Normative source under review: `SPEC.md` §4.1c (plus §4.1d and §4.1e for compatibility/authorization)
- Status: **DESIGN REVISED AFTER FRESH REVIEW — ARCH-01..10 approved; DEP-01 RATIFIED; formal written Design Gate BLOCKED pending fresh review; NOT IMPLEMENTATION-READY**
- Fresh Design Review remediation scope: **this Design Spec only**. The already-ratified upstream `SPEC.md` and Issue updates are historical inputs, not fresh normative changes. No production source, tests, CI or implementation plan modification is authorized.

## 1. Purpose, scope, and authority

This design makes the existing v4 pre-implementation Review Gate contract-correct, restart-safe, and fail-closed without adopting the v5-wide Event-Sourced Control Plane. The existing `/justice-review-gate` remains the user entry point; `/justice-implement --approved` remains a separate explicit authorization boundary. Justice does not take ownership of Superpowers implementation task scheduling or final code review.

**Hard invariants:**

1. Only Justice Core can admit a generation, apply a state transition, consume a remediation round, authorize a Git mutation, confirm lineage resolution, or CLEAR a phase. Workers return bounded evidence, not authority.
2. Validated durable history is the sole state source; process-local orchestration flags and LLM text are never authoritative. Any unverified, missing, unsupported, causally invalid, or conflicting authority yields BLOCK, not optimistic default state.
3. Design review uses Requirements + Design; Plan review uses approved immutable Design + Plan. Requirements, production source, tests, CI, and unrelated files cannot be remediation targets.
4. Per-generation remediation ceilings are **Design 5** and **Plan 3**. Retry, crash resume, reentry, drift, `--retry`, or legacy migration cannot reset them.
5. Never commit on unresolved targeted self-review, newly discovered blocking/upstream findings, indeterminate evidence, required validation failure, or wrong artifact binding. Resolution follows verified Git success, never an LLM assertion.
6. Read-only completed approval lookup, history inspection, and exact completed reuse never alter state. CLEAR is not human approval, merge authorization, or implementation authorization.
7. Previous generations remain immutable historical evidence. This v4 design deliberately does **not** inherit Design CLEAR or finding-resolution authority into a completed successor (ARCH-09); this is the **DEP-01 ratified normative contract**.

### Scope exclusions

No generic v5 event control plane, no v5-wide authority graph, no sophisticated cross-generation lineage propagation or automatic Design CLEAR inheritance, no arbitrary shell/push, no Requirements auto-editing, no storage compaction/pruning in v4. Retain existing Linux native provider, review-scoped Git/recovery primitives, and Superpowers/OmO integration.

## 2. Architecture decision record

| ID | Approved decision | Responsibility |
| --- | --- | --- |
| ARCH-01 | **B — Scoped Authority Boundary Restructuring** | Keep v4 services; separate deterministic decisions from side effects |
| ARCH-02 | **A — Pure Admission Planner + Runtime Executor** | Locked scope admission, resume/reentry/successor/reuse/BLOCK |
| ARCH-03 | **A — Typed Event + Pure Projection + Durable Commit Intent** | Causally checked transitions and commit-bound resolution |
| ARCH-04 | **A — Normative-compatible JSONL Hardening** | Typed/versioned writer-sharded journal, independent discovery and anchored frontier |
| ARCH-05 | **A — Immutable Legacy Snapshot + Verified Continuation Bridge** | Preserve legacy, verify before continuing, otherwise BLOCK |
| ARCH-06 | **A — Durable Semantic Cycle Evidence + Pure NC1 Evaluator** | Occurrence, lineage, cycle snapshots/evidence, six NC1 predicates |
| ARCH-07 | **A — Stage-aware Validation Planner + Durable Evidence** | Three required stages, durable exact-binding reuse, DVF1 |
| ARCH-08 | **A — Two-Key Reentry Authority** | Deterministic eligible-change proof + independent material-progress validation |
| ARCH-09 | **B — Conservative Design Re-review** | No Design CLEAR inheritance on successor; upstream contract RATIFIED at `5b33b79` |
| ARCH-10 | **A — Contract-first Compatibility Adapters + Tiered Acceptance Gates** | Host/task compatibility, production integration, three verification levels |

## 3. Component ownership and interfaces

```text
/justice-review-gate
  -> PlanBridge / OpenCode Adapter [routing, command, authorization lock]
  -> Runtime Coordinator [scope lock, Gate lock, I/O, agent dispatch, native/Git effects]
       -> Scope History Discovery + Anchor Verifier [read-only verified inputs]
       -> Pure Admission Planner [ADMIT/RESUME/REENTRY/REUSE/SUCCESSOR/BLOCK]
       -> Pure Event Validation + Projection [state, authority, budgets]
       -> Pure Finding/NC1, Validation, Reentry Planners [next authoritative decision]
       -> Durable Event Store + Recovery CAS [persist events/intents/evidence references]
       -> Linux Native Provider + ReviewGateGit [exact-artifact mutation/recovery]
  -> Read-only HistoryService / CompletedApprovalLookup [same verified store]
```

- **Pure Core** consumes immutable *validated* snapshots and produces typed decisions/transition intents. It never reads Git, files, wall clock, agent sessions, or native capabilities.
- **Runtime** performs reads, locks, dispatch, version/binding verification, exactly-scoped side effects, event publication, and recovery. It does not invent alternate approval or budget truth.
- **Store** checks event-specific schema/persistence policy/causal links before append and on replay. Indexes/caches are diagnostic or derived, not authority. Invalid histories are neither repaired by skipping entries nor overwritten.
- **Workers** (history-blind reviewer; independent finding validator; target-only remediator; fresh self-review/reentry validator) deliver strictly parsed typed evidence. The validator's semantic judgment is checked against pinned identities and allowed relations; the worker cannot mint lineage IDs or commit.
- **Authorization integration** retains review-scoped read/query and remediator-only write capabilities. All `implementation` operations remain prohibited until separately authorized.

**Affected seams:** `src/runtime/review-gate-coordinator.ts`, `review-gate-event-store.ts`, `review-gate-git.ts`, `review-gate-recovery-store.ts`, `review-gate-approval.ts`, `review-gate-history.ts`; `src/core/review-gate/{projection,orchestrator,lineage,convergence,deterministic-validation,resume-cursor}.ts`, `review-gate-types.ts`; `src/hooks/plan-bridge.ts`, `src/core/{plan-parser,dependency-analyzer}.ts` and host adapter. This list is a design dependency map, **not** permission to edit them.

## 4. Scope, generations, and admission (ARCH-01/02/08/09)

### 4.1 Scope lock and discovery

1. Resolve canonical workspace root identity and canonical relative Design/Plan paths. `reviewScopeId` hashes the canonical Design/Plan **path pair** (`computeReviewScopeId`), not artifact content; it is stable across invocations only while both paths remain unchanged. Neither paths nor identities may be guessed from text. Changing either path creates a distinct scope identity.
2. Acquire the **non-blocking OS scope lock** before any authoritative scope discovery/selection and before the Gate lock. Read-only diagnostic scans prior to lock have no admission authority.
3. Under scope lock, discover all scope members independently of `scope-index.json`; read trusted scope witness and every relevant Gate/writer shard. Verify schema, causal history, generation chain, unique current tip, predecessor links, and any existing completed binding. Before first enrollment or cross-scope successor selection, additionally inspect the trusted **workspace-wide** scope registry for unfinished scopes related by canonical artifact path or verified provenance; serialize this continuity/enrollment check using a workspace-wide guard or atomic witness-registry CAS. Scope-local locking alone cannot make cross-scope admission atomic. A possible path-relabeled unfinished Gate requires independently verified distinct-workflow or continuity evidence; absent proof, BLOCK rather than issue a fresh budget.
4. Re-read exact Requirements/Design/Plan identity, Git blob/mode and phase/global protocol fingerprints *under admission ownership*. Mixed snapshots, changed bindings, or conflicting tips BLOCK.
5. Select the gate, acquire Gate lock, reproject under ownership, or durably publish new `GATE_CREATED` and scope membership before releasing scope lock. Hold Gate lock for the invocation. Locks never flow to child workers; PID/TTL/heartbeat are not ownership proof.

Corruption of a known current scope blocks its admission/successor creation; unrelated-scope corruption must not globally block a verified healthy scope. Index loss is not evidence that the scope is new.

### 4.2 Pure admission decision table

| Verified situation | Decision | Requirements |
| --- | --- | --- |
| ACTIVE, or ordinary recoverable SUSPENDED with a proven resumable cursor; **excluding** NC1, round exhaustion, upstream reopen, invalidation and authority-conflict stops | `RESUME` | Same `gateId`, generation, epoch, all spent rounds; no restricted stop may use generic resume |
| Resumable generation with binding/context drift | `REVALIDATE_OR_BLOCK` | Use invalidation/upstream/external-change rules; NEVER make budget-reset successor |
| NC1 suspension with candidate eligible committed change | `REENTRY_CANDIDATE` | Only Section 9 two-key verification permits ACTIVE; otherwise remain suspended in same generation/budget |
| Completed tip, **all Requirements/Design/Plan paths, digests/modes, resolution, global protocol** exact | `REUSE_COMPLETED` | Read only; no event append |
| Verified unique immediate completed predecessor with changed content/protocol binding in the same scope, or an **explicitly verified cross-scope continuity reference** | `CREATE_SUCCESSOR` | `supersedesGateId` bound to predecessor; **fresh Design Gate, even Plan-only drift**; no inferred linkage from a path change |
| Current-scope corruption, unsupported version, missing witness, competing tips | `BLOCK` | No synthetic event, fresh gate, or repair |
| Provably uninitialized and independent scope with trusted first-enrollment evidence plus atomic workspace-wide enrollment guard | `CREATE_GENESIS` | First Gate; no plausible unfinished predecessor/alias; enrollment and genesis publication are recoverable |

A successor never inherits predecessor CLEAR or resolution authority. A same-generation Plan resume **does** retain its own still-valid Design CLEAR. On protocol/Requirements/Design drift, previous same-generation approval must be invalidated by a verified change transition, not silently rewritten. Requirements change/upstream blocker precedes Design/Plan remediation. A changed Design/Plan **path** changes `reviewScopeId`; it is neither automatically a successor nor automatically a new independent workflow. The workspace-wide continuity decision must reject ambiguous path moves, concurrent enrollment conflicts and attempts to evade an unfinished scope's spent rounds by relabeling artifacts. A stopped NC1/round-exhausted Gate never falls through the generic SUSPENDED resume path.

**NC1 branch priority (RG-312-002):** For a verified NC1 suspension, check current upstream blockers and stale-lineage revalidation first, **then inspect an eligible independently verified committed change before generic unfinished-binding drift handling**. If a phase-eligible candidate is proven, Core returns `REENTRY_CANDIDATE` carrying old/new binding and stop-event refs, not `REVALIDATE_OR_BLOCK` and never ACTIVE. The runtime dispatches independent `NON_CONVERGENCE_REENTRY_VALIDATION`, validates `MATERIAL_PROGRESS` and the candidate/NC1 identity, and witness-commits an idempotent reentry transition **before** the same generation may resume. If no eligible candidate or no valid progress, remain suspended; upstream reopen is separately authoritative. Normal ACTIVE/ordinary SUSPENDED drift still follows `REVALIDATE_OR_BLOCK`; it cannot reset budgets. A changed binding is evidence for candidate evaluation, **not** permission to bypass either key.

**Protocol identity contract:** Canonical `ReviewProtocolDescriptorV1` has separate `design`, `plan` and `crossPhase` sections. Phase fingerprints bind static prompt digests, reviewer/validator authority and semantic contracts, severity/lineage/resolution/reopen/NC1 policies, required validator registry and round limits; the global `reviewProtocolFingerprint` binds the full descriptor. Model/provider, package/writer identity and timestamps are not protocol authority. A phase-specific change invalidates affected CLEAR; completed reuse always requires global equality. These fingerprints are calculated from versioned canonical data, not from runtime convenience strings.

### 4.3 Epoch and budget

`ORCHESTRATION_RESUMED` is audit in the same epoch after a crash. Only an explicit, verified eligible suspension transition starts `ORCHESTRATION_EPOCH_STARTED`. Each unique round is consumed once at durable `REMEDIATION_STARTED` (before mutation), counted from the projected generation-wide history. Rounds are ordinal and bounded (Design 1..5; Plan 1..3); no event with out-of-range, duplicate conflicting, or reset ordinal is admissible. Blocking post-image carries forward within current generation without minting a round. Exhaustion permits external committed-change revalidation/CLEAR but **not** round 6/4.

## 5. Event ledger, causal persistence, and recovery (ARCH-03/04; DEP-02)

### 5.1 Canonical record and limits

Keep the normative v4 writer-shard path `.justice/review-gates/events/<reviewScopeId>/<gateId>/<writerId>.jsonl`. Each new event has explicit schema version, `eventId`, scope/gate/writer/epoch identity, logical operation/review/round refs where applicable, monotone shard sequence, prior shard hash, causal parent/frontier references, strict event-specific bounded payload, and canonical hash. Event identity and operation outcome must be idempotent; the same ID with different bytes is conflict.

Logical events include the `SPEC.md` §4.1c required families: generation/dispatch, attempt/finding/reconciliation, deterministic validation/reuse, remediation/recovery, self-review, commit intent/success/recovery, lineage resolution, change/invalidation, NC1/reentry, CLEAR and completed approval. Bounded `LEGACY_HISTORY_VERIFIED`/`LEGACY_BRIDGE_COMMITTED` records may be added under a versioned policy; they contain only digests and refs.

Canonical serialization, field allowlists, all enum validation, referential integrity and transition prerequisites apply on both append and replay. Proposed **EventPersistencePolicyV1** hard bounds: individual JSON event <=64 KiB UTF-8; ID <=256 bytes; canonical relative path <=4096 bytes; list <=128 refs per event (larger logical batches are split into causally ordered bounded events, never dropped). No raw agent/tool output, prompts, artifact bodies, hidden reasoning, credentials, environment variables or absolute host paths. Reject authority-field violations with `EVENT_PERSISTENCE_POLICY_VIOLATION`; do **not** redact into altered authority. All current/historical Gate event records are retained; no v4 compaction, auto-prune, or delete-as-recovery.

### 5.2 Trusted scope witness and precise threat model (DEP-02)

**Trust boundary:** the entire mutable `.justice/review-gates` tree, its `scope-index.json`, process cache and event files are **not** sufficient to establish first-use or ledger completeness. Require a separate Justice-owned, OS-protected and durable **scope witness registry** keyed by stable canonical workspace identity/scope ID. The witness records immutable scope enrollment, generation membership, expected committed frontier per writer, and monotonically advanced global scope frontier. The registry is outside the workspace Gate history deletion target (for example, a Justice-owned host-state location); its precise deployment path is configuration, not part of the logical contract.

The witness must have access controls preventing the **modeled actor** that can corrupt/delete workspace history from also replacing/deleting/rolling back the witness. Explicitly:
- **Guaranteed under the stated model only:** process crash/power loss (with verified filesystem sync guarantees), accidental/unauthorized changes to the mutable Gate history or index, and concurrent Justice writers constrained by native scope locking. Completeness is anchored to the last durable witness frontier.
- **Not guaranteed by hashing or path separation alone:** adversaries with effective credentials/write access to **both** journal and witness, privileged root, full-volume snapshot rollback, or destruction of every independent state copy. A directory elsewhere under the same writable identity is **not** an independent security boundary.
- **Deployment prerequisite:** demonstrate witness isolation/durability and authenticated first enrollment. If unavailable, missing, unreadable, unsupported or untrusted, admission is `BLOCK`; do not call it a new workspace. An unproven bootstrap cannot assert absence of past deleted history. If the deployment cannot provision the witness trust boundary, DEP-02 remains unsatisfied and the design is not implementation-ready for that deployment.

**Publication protocol:** under scope lock, validate predecessor frontier and preconditions; durably write+sync new shard bytes and containing directory; conditionally advance an independently durable witness frontier (generation/sequence + hash) using compare-and-swap/serialized ownership; only then acknowledge authoritative append. A partially written/unanchored tail is not projected as authority. Crash recovery validates both frontiers and a durable prepared publication identity: old witness + exact complete new tail can be finished idempotently only if the prepared identity/ownership is proven; witness-ahead/missing data, divergent hash, unexpected tail or unknown rollback => `BLOCK`. No successful worker/commit side effect is started until its prepared intent is witness-committed. A crash after Git commit is recovered using the already committed intent and verified Git state (section 7), not by a second blind commit.

Independent scope discovery checks orphan Gate IDs, missing shards, competing writer heads and ambiguous generations. A hash chain without the independently protected expected frontier is not claimed to detect complete tail deletion or coordinated rollback.

### 5.3 Read-side policy

`projectReviewGate`, read-only history, and completed approval lookup accept only successfully verified contiguous authority history. Unsupported event versions, invalid persistence policy or unresolved causal ambiguity reject the query rather than displaying partial CLEAR. `scope-index.json`, cached DTOs and raw event count are not authority.

## 6. Legacy history admission and bridge (ARCH-05; DEP-03)

Legacy `<gateId>/events.jsonl`, `dispatches.jsonl` and recovery objects are **immutable inputs**, never silently rewritten or deleted. A legacy Gate is not "verified" merely because JSON parses or the legacy reducer returns ACTIVE/COMPLETED.

**VerifiedContinuation preconditions (all required):**
1. Scope enrollment/membership and expected complete history frontier have independent **pre-existing trusted evidence**. A checksum/anchor manufactured at migration time is not evidence of prior non-deletion.
2. Validate all legacy event types and state transitions, exact scope/gate/protocol/Requirements/Design/Plan provenance, epoch sequence, round consumption (including interrupted rounds), dispatch identity/outcome, pending side effects and recovery objects.
3. Verify external Git commits, relevant artifact digest/mode, committed approval, resolution authority and lineage applicability as needed for the requested resume cursor; absence of commit-bound evidence cannot be inferred from `FINDING_SELF_REVIEWED`.
4. No conflicting completed/resumable tips or unsupported history gaps. Bounded legacy upcast is allowed only for equivalent facts, never for invented facts, epochs, resolution, round consumption or lineage.
5. The intended continuation cursor is deterministically reconstructable, including safe suspension for missing redelivery evidence, and passes the same current-binding checks as a native new-ledger resume.

If any precondition fails: retain all bytes, expose safe diagnostic `LEGACY_AUTHORITY_UNVERIFIABLE`, **BLOCK** continuation/replacement/reuse; never create a fresh generation to bypass lost budget.

**Atomic bridge publication:** under scope lock, compute immutable snapshot digest and verified projection digest; publish a durable `LEGACY_BRIDGE_PREPARED` binding both, gate/epoch/generation/rounds/authority references and policy version; write verified new-ledger bridge payload; finalize with witness-committed `LEGACY_BRIDGE_COMMITTED` for a unique operation ID. The new projection consumes exactly one verified predecessor snapshot plus post-bridge typed events; no dual legacy/new authority and no double counted round. After a crash, if only PREPARED exists, reverify immutable bytes and either finish the same bridge idempotently or BLOCK; never guess or mint a second bridge. No legacy event is modified as part of recovery.

Legacy archive/reconstruction tooling beyond these minimums belongs to v5.

## 7. Review, self-review, commit-bound resolution (ARCH-03/06/07)

**Attempt binding:** an attempt pins phase, baseline revision, Requirements/Design/Plan as applicable, approved Design in Plan, protocol fingerprint and operation identity. Separate fresh reviewer and independent finding-validator contexts; hidden reasoning never crosses them. `INVALID` is auditable but not remediable, `minor` advisory never blocks or auto-remediates, duplicate occurrences yield one blocker, contradictory validator results fail closed. The only finding entry points are reviewer validation, self-review discovery, registered deterministic validation, and existing-lineage regression/revalidation.

**Remediation lifecycle:**
1. Durable round start + exact pre-image recovery CAS and target capability constraints precede the first mutation.
2. Remediator can write only the phase target; must not commit, push or modify Requirements/production files. Unknown partial worktree state is not overwritten.
3. On completion, record bounded post-image identity and run mandatory `POST_REMEDIATION_SELF_REVIEW` deterministic checks *and* fresh-context self-review against the same pinned post-image.
4. Self-review's target `RESOLVED/STILL_PRESENT/INDETERMINATE` and **all** discovered occurrences are strictly validated and durably reconciled **before** deciding commit eligibility. `STILL_PRESENT` plus duplicate discovered EXISTING defect is a conflict. Blocking current-phase or upstream discovery, target still present, failed mandatory stage, indeterminate check or binding drift prohibits commit. A blocking current-phase result consumes the round without commit and preserves exact known-dirty post-image for next disposition; on final round suspend.
5. Eligible PASS must first validate the **proposed Design post-image's Requirements selector** against the current effective authority (§10.2.5). An invalid, missing, conflicting or source-changing marker is a blocker; self-review PASS cannot authorize that commit. Otherwise durably witness-commit `REVIEW_COMMIT_PREPARED` (unique operation ID, expected parent/HEAD, target path + pre/post digest/mode, round, bound lineages, **pre/post selector evidence and Requirements identity**). Only then perform the Justice-owned **single-literal-artifact** Git commit, preserving unrelated index/worktree. Commit subject is exactly `[Justice] remediation round <N>` (SPEC.md §4.1c); add a blank line and deterministic Git message trailers `Review-Gate: design|plan`, `Review-Round: <N>`, `Findings: <sorted, deduplicated resolved finding IDs>` (Issue #297 §11.3/AC-9). Prepare and pin trailer bytes with the commit intent; derive IDs only from independently validated, commit-eligible findings, never from worker claims. Never expose Gate ID or private validator details. Verify parent, sole changed path, blob, mode, commit SHA **and exact subject/trailers** (including after crash recovery) before `REMEDIATION_COMMIT_SUCCEEDED`. Malformed/mismatched metadata blocks lineage resolution.
6. Emit `LINEAGE_RESOLUTION_COMMITTED` only after verified success with exact commit/digest/context/lineage binding, or after separately verified committed external-change revalidation. Self-review evidence alone never closes OPEN lineage; failed commit leaves it unresolved. Any crash after side effect uses prepared intent plus real Git state to classify source/destination/conflict and avoid duplicate commit or resolution.
7. After a verified Justice Design commit, re-pin the phase Design baseline to the **verified committed post-image** and publish a causal, durable `REQUIREMENTS_AUTHORITY_REVALIDATED` record under §10.2.5 before fresh review or CLEAR. This proves current Design marker validity without rewriting the immutable admission V2. A crash after Git commit but before this revalidation must recover the **same prepared operation** by verifying actual Git state; no duplicate commit, resolution, round, or authority event. Missing proof BLOCKS fresh review/CLEAR. Fresh history-blind review uses the re-pinned baseline; failed fresh review cannot replay committed remediation. `DESIGN_CLEAR` precedes Plan review; `PLAN_CLEAR` plus durable completed binding follows Plan verification. Neither unlocks implementation automatically.

Exact artifact mode is Git `100644 | 100755`, based on owner execute bit rather than any POSIX execute bit. Native Linux x64/glibc `openat2`, `renameat2`, non-blocking `flock`, and sync support are mandatory for mutation; no unsafe Node pathname-only fallback.

## 8. Semantic lineage and NC1 (ARCH-06)

Justice issues `occurrenceId` per observation and generation-local `lineageId` per semantic defect. Immutable basis = `violationType`, `governingReference`, `semanticLocation`, `violatedContract`, `ownerScope`; `basisDigest` hashes canonical JSON. Semantic relation is validated against offered opaque candidates; digest equality alone is not resolution or relation authority. `ALREADY_RESOLVED` requires `EXISTING`, an actually resolved target lineage and independently validated absence of the defect on the pinned baseline; `NEW + ALREADY_RESOLVED` is invalid. If an existing committed-resolved defect is present again in the same semantic context, the valid observation becomes `LINEAGE_REGRESSED` and reopens that generation-local lineage, rather than being dropped as already resolved. Conflicting verdicts on one pinned snapshot BLOCK.

Durable events reconstruct targeted lineages, complete pre/post semantic blocker landscapes, fingerprint, count, targeted round outcome, contract-conflict group and committed resolution/regression per cycle. A pure NC1 evaluator compares only **same phase baseline/protocol context**. Missing necessary cycle evidence yields `INDETERMINATE/BLOCK`, never `CONVERGENT`.

**RG-312-004 — phase semantic continuity versus artifact revisions:** A *phase baseline* for NC1 is an immutable **logical semantic comparison anchor**, not the digest of each mutable post-remediation artifact. Represent `VerifiedSemanticContext` using `gateId`, `generationId`, `phase`, `phaseBaselineId` (created from the first verified phase admission baseline), `semanticContractFingerprint` (relevant semantic review/lineage/NC1 policy and governing Requirements/approved-upstream authority), and `protocolFingerprint`. Pin each attempt/round's exact `preRevisionDigest` and `postRevisionDigest` separately, with verified commit/event/operation links. A normal, verified same-generation remediation D0→D1→D2 advances revision digests but **retains the phaseBaselineId and semanticContractFingerprint**; therefore the NC1 evaluator compares complete, consecutively linked cycle landscapes across these commits. The first fingerprint in an A→B→A oscillation can precede two successful commits. A resolved lineage's verified regression may also occur in a later revision of the same logical context. Re-pinning a fresh reviewer to D1 does not change the NC1 semantic comparison anchor.

**Context transitions:** A verified Requirements/upstream-approval/semantic-protocol change, explicit reopen or justified reentry may change the comparison context **only through** a typed, witness-committed `SEMANTIC_CONTEXT_TRANSITION` referencing old/new anchor, triggering authority event, preserved generation/round counters, source lineage and independent equivalence or incompatibility proof. Do not silently regenerate an anchor from the latest artifact digest. If continuity is independently established, preserve the existing semantic context and prior cycles; if a true semantic incompatibility is proven, start a new **comparison segment within the same generation**, retain the complete old cycles for auditing/reentry authority, and do not merge incomparable fingerprints. Missing or contradictory transition proof => `INDETERMINATE/BLOCK`. Context changes never clear NC1 suspension, reset budget, or bypass Two-Key Reentry. A sequence of revisions alone, a path rename, or a provider change is **not** context-change authority. Cross-generation completed successors always start new phase semantic contexts and cannot inherit predecessor resolution authority.

Six normative predicates, evaluated all and stored with the ordered first as `primaryReason`:
1. `RESOLVED_LINEAGE_REGRESSED`: committed resolution later regresses in the same context (immediate suspend).
2. `REMEDIATION_OSCILLATION`: `fingerprint[n] == fingerprint[n-2]` and differs from `fingerprint[n-1]`.
3. `SAME_LINEAGE_STALL`: same targeted lineage is STILL_PRESENT in **both** consecutive rounds.
4. `CONTRACT_CONFLICT_REPEATED`: same owner/type/reference/contract group targeted and still blocking after **two** consecutive targeted rounds; exclude semantic location.
5. `BLOCKER_LANDSCAPE_REPEATED`: exact semantic blocker landscape unchanged over two consecutive cycles.
6. `BLOCKER_COUNT_NOT_IMPROVING`: **two** consecutive cycles with `postBlockingCount >= preBlockingCount`; any decrease resets the streak.

Runtime disposition order: **current upstream blocker → stale-lineage revalidation → NC1 → absolute exhaustion → remediation → clean-phase fresh review**. A `reopened` flag, a single plateau or current-state reverse engineering is not sufficient NC1 evidence.

## 9. Three-stage deterministic validation and reentry (ARCH-07/08)

### 9.1 Mandatory validation

One stage-aware planner computes registered mandatory validators for `BASELINE_ADMISSION` (before reviewer dispatch), `POST_REMEDIATION_SELF_REVIEW` (before commit), and `PRE_CLEAR` (before CLEAR). It derives exact phase, baseline/protocol, declared artifact/approval inputs, validator contract/result schema and applicable executable/tool/runtime identities.

Persist `DETERMINISTIC_VALIDATION_COMPLETED` with bounded typed semantic results and `DETERMINISTIC_VALIDATION_REUSED` referencing the verified original evidence. Reuse semantic PASS/FAIL/INDETERMINATE **only** on exact verified binding and supported schema; only accepted PASS satisfies a mandatory required stage. Execution failure/unavailable evidence is never cached as semantic truth. A redispatch within the **same logical operation** with environment drift fails closed. Missing evidence is re-executed where safe; corruption is not repaired by rerun. `PRE_CLEAR` semantic FAIL enters the ordinary lineage flow, INDETERMINATE cannot CLEAR. POST semantic FAIL enters DVF1 while LLM self-review still runs, and blocking findings prevent commit. Admission FAIL/INDETERMINATE suspends without a finding.

Rule identity/severity/owner/contract is registry-owned, not model-owned. Deduplicate deterministic observations by `(validationEventId,ruleId)` and connect them to the same durable semantic lineage as reviewer observations.

### 9.2 Non-convergence reentry

After durable `REVIEW_NON_CONVERGENT`, Core requires **two independent keys**:
1. Deterministic eligible-change verification: Design accepts committed Requirements/Design/design-protocol; Plan accepts committed approved Design/Plan/plan-protocol. Changed artifacts are clean/committed; identity/parent/digest/mode/protocol and phase context must be verified. Model/provider/writer/time-only change is ineligible.
2. Fresh, independently validated `NON_CONVERGENCE_REENTRY_VALIDATION` yielding `MATERIAL_PROGRESS` tied to the verified before/after context and original NC1 evidence. `NO_MATERIAL_PROGRESS`/unavailable/invalid stays suspended.

The result is *evidence*, not ACTIVE authority. A pure reentry planner validates allowed lineage refs and binds evidence to a durable transition, optionally starting a new epoch, **never a new generation or budget**. An upstream reopen result may reference only a pre-existing committed CURRENT upstream lineage; it cannot create a lineage. Requirements → Design → Plan precedence and exact downstream restore remain intact. Round exhaustion admits only external-change revalidation/CLEAR, not more remediation.

## 10. Completed successor, protocol and Requirements authority (ARCH-09; DEP-01/04)

### 10.1 Conservative Design re-review

Exact completed reuse requires verified complete Requirements resolution, Design/Plan canonical path + digest + Git mode and current **global** `reviewProtocolFingerprint` equality. It is read-only. For a changed completed tip, a new successor is permissible **only** from the unique verified immediate completed predecessor; bind `supersedesGateId`. No predecessor Design CLEAR or resolution is projected as current authority. **Even a Plan-only change starts a fresh Design Gate** using current Requirements, Design and design-protocol. Current-generation Design CLEAR from that fresh run can be used during later Plan resume if still valid. When independent semantic reconciliation establishes a verifiable predecessor relation, the successor **MUST durably persist** a `(predecessorGateId, predecessorLineageId)` historical reference, bound to the reconciliation evidence and current generation-local `lineageId`. If such a relation cannot be established, do not fabricate a link: retain a new independent generation-local lineage without a predecessor reference. No predecessor resolved status is imported as successor resolution authority, and no advanced propagation or new `DESIGN_CLEAR_INHERITED` emission is allowed.

An incomplete Gate is not a predecessor eligible for a fresh budget; corrupted history or ambiguous current tips BLOCK.

**DEP-01: RATIFIED.** The v4 Conservative Design Re-review contract is now normative in `SPEC.md` §4.1c, Issue #297 (§21 and AC-14/19–21) and Issue #310 (§8 and revised acceptance conditions), at the ratified amendment baseline `5b33b79bb27a26c00e79f950c7211a625b4727bf`. These supersede the old v4 obligation to emit `DESIGN_CLEAR_INHERITED` for new successors. Previously persisted inherited events remain recognizable for ARCH-05 verified read/validation/migration and fail closed if their authority cannot be proven. DEP-01 ratification alone does **not** pass the Formal Design Gate, prove DEP-02/03, resolve DEP-04, or authorize implementation. Advanced inheritance remains v5 #298.

### 10.2 Requirements resolution contract (DEP-04 / RG-310-FDR-004)

**Decision:** Requirements is a distinct, real, verified Git-tracked workspace artifact; it is not inferred from a Design title, a remote URL or Design bytes. Two authoritative selection interfaces are defined below. The ratified RR1 contract already permits explicit selection or one unambiguous Design reference; this is the **final v4 design interface**, not an optional implementation suggestion. `--design` and `--plan` remain required, and Requirements must not alias either target.

#### 10.2.1 Public command and request interface

```text
/justice-review-gate --design <path> --plan <path> [--requirements <path>] [--retry N]
```

- **REQUIRED:** extend `parseJusticeReviewGateCommandArguments` and `ReviewGateRequest` with a single optional `readonly requirementsPath?: string`. It is the authoritative **explicit** selector when present. Existing `--design`, `--plan`, `--retry N` semantics and their argument order independence are preserved.
- `--requirements <path>` accepts the existing OpenCode `@path` shorthand identically to `--design` / `--plan`: strip exactly one leading `@` then validate. The parser rejects duplicate flags, missing/empty values, unknown switches, extra positional text, `--requirements=path`, paths with whitespace/quoting, and unsafe `@`/path encodings. The deprecated `--retry` cannot change admission, protocol or capacity.
- Malformed command syntax returns `REVIEW_GATE_INVALID_ARGUMENTS` *before* Gate admission, without an event append. An accepted selector with missing, ambiguous, conflicting or unverified Requirements authority returns `REQUIREMENTS_RESOLUTION_REQUIRED` without genesis/reviewer dispatch. Omitting the new flag preserves the existing two-required-flags UX **only when** one valid Design declaration exists; the legacy `auto_design_reference` fallback is not an alternative.
- On an unfinished generation, its existing persisted resolution is immutable. A later `--requirements` override must be evaluated under ARCH-02 change/invalidation rules, never used to replace the resolution silently or create a replacement budget.

#### 10.2.2 Exactly one Design-declared reference grammar

**Only** this standalone HTML-comment marker is recognized as a fresh v4 Design Requirements declaration:

```text
<!-- justice-review-gate:requirements="docs/requirements/feature.md" -->
```

- After trimming **only leading/trailing horizontal whitespace**, the marker must match `<!-- justice-review-gate:requirements="<path>" -->` with exact case, ASCII punctuation and internal spaces. `<path>` must match `[A-Za-z0-9][A-Za-z0-9._/-]*\.md`, be at most 4096 UTF-8 bytes, and pass the same strict canonical path checks as the CLI. Quotes, spaces, `%`/URL escaping, `@`, `~`, fragments, queries and shell expansions are not supported in a marker.
- The marker must be in the **Design document preamble**, outside any Markdown fenced code: after the optional first ATX H1 heading and before the first unfenced ATX H2/H3, and within the first 64 physical lines. A document without an H1 may place it before its first H2/H3. Fence state is computed using the shared backtick/tilde, opening-language-info-aware Markdown scanner from ARCH-10; LF/CRLF are equivalent. Marker-looking lines inside a valid fenced block are not selectors.
- Scan the *whole* document for unfenced marker-prefix occurrences. A malformed reserved marker, a marker outside the preamble, a second declaration even with an identical value, or untrustworthy/unbalanced fence parsing is an **ambiguity/error**, not a reason to select another candidate. No "first/last/nearest" fallback. Plain `Requirements:` headings, arbitrary Markdown links, YAML keys, issue URLs or prose references do not select authority. Other undocumented/legacy declaration grammars are not silently accepted for **new** generations.
- Deterministic candidate extraction: no marker → require explicit CLI; one valid marker → one candidate; duplicate/invalid/late marker → `REQUIREMENTS_RESOLUTION_REQUIRED` even when an explicit CLI path is present. An old Design without this marker can add it explicitly or use the CLI; historical events are read only through ARCH-05 rules.

#### 10.2.3 Path rules, precedence, and fail-closed errors

Under scope/workspace admission ownership, prove all of the following before genesis and reviewer dispatch:

1. Both CLI and marker paths are **workspace-root-relative**, not Design-directory-relative or CWD-relative. Require exact canonical serialization: reject absolute or drive-letter paths, leading `./`, `.`/`..` segments, repeated `/`, backslash, empty/trailing components, NUL/control characters, URI schemes, path aliases or symlink escape (including parent directories). Resolve with proven native safe open semantics; reject symlink, submodule, non-regular artifacts and aliasing to Design or Plan.
2. Verify one real **Git-tracked**, clean and committed Requirements file. Bind canonical workspace/root and repository identity, path, Git blob OID, SHA-256 byte digest, Git mode (`100644|100755`) and the admission snapshot HEAD Git **commit object OID** under one stable snapshot. `committedBaselineOid` is that admission commit H0 whose tree proves the path/blob/mode, **not** the Requirements file's last-changing commit and **not** an equality requirement against later HEAD. Missing, untracked, dirty, unreadable, unsupported mode or mixed-snapshot evidence => `REQUIREMENTS_RESOLUTION_REQUIRED` (or stricter history/authority BLOCK where warranted).
3. **Explicit precedence with mandatory agreement:** CLI-only selects `explicit`; marker-only selects `design_declared_reference`. When both exist, the CLI remains the source selector **only if** canonical path and independently verified artifact identity agree; record both sources of evidence. Any disagreement, duplicates or malformed marker yields `REQUIREMENTS_RESOLUTION_REQUIRED`, **not** a silent CLI override or silent marker preference.
4. URL schemes and external GitHub Issues/PRs are **not** valid Requirements artifact identities. Remote links may appear as context inside a separately verified Requirements file, but never trigger a fetch/selection or serve as the approved baseline. No guessed path or Design-content substitution.
5. An absent/mismatched selector, invalid declaration, unsafe/nonexistent/uncommitted file, or unverifiable independent source fails **before `GATE_CREATED`** with a sanitized actionable `REQUIREMENTS_RESOLUTION_REQUIRED` error. Existing-generation history corruption/invalid authority is handled by the stricter ARCH-02/04/05 BLOCK rules; it must not turn into a new genesis.

#### 10.2.4 Versioned durable source type and historical decoding

Observed current source is `RequirementsResolutionV1` with `source: "explicit" | "auto_design_reference"`. **Do not reinterpret, widen or overwrite this legacy union.** New v4 generations use a separate versioned payload bound to the event schema:

```ts
type RequirementsResolutionV2 = Readonly<{
  schemaVersion: 2;
  source: "explicit" | "design_declared_reference";
  canonicalPath: string;
  digest: ArtifactDigest; // verified SHA-256 content digest
  gitMode: "100644" | "100755";
  requirementsGitBlobOid: string;
  committedBaselineOid: string; // historical admission HEAD Git commit OID, not current HEAD
  workspaceIdentity: string; // stable, versioned authority identity
  selectionEvidence: Readonly<{
    commandPath?: string;
    declaration?: Readonly<{
      designCanonicalPath: string;
      designDigest: ArtifactDigest;
      declarationLine: number; // 1-based physical line
      declarationDigest: ArtifactDigest; // digest of exact marker line
      declaredCanonicalPath: string;
    }>;
  }>;
}>;
```

- Every new `GATE_CREATED` event MUST carry the immutable validated V2 historical selection record (with versioned schema discriminator). A new `COMPLETED_APPROVAL_BINDING` MUST reference **that original V2 event plus the latest verified current-effective Requirements authority event/snapshot**, and bind the **current** Requirements/Design/Plan approved identities and global protocol. It MUST NOT copy an H0-only V2 snapshot as its sole current Requirements proof or modify the original V2. `source="explicit"` in V2 requires actual CLI selection, `source="design_declared_reference"` requires a unique verified declaration and **no CLI**. When both agree, store `explicit` with both evidence sources. Historical and current evidence paths must agree with their respective proven authority identities; inconsistent/missing references are invalid events.
- `RequirementsResolutionV2` stores **bounded typed evidence only**, never full Requirements text, Design excerpt or raw prompts. Persist Requirements path/digest/mode/Git blob OID, the **historical admission HEAD** H0, workspace identity and optional original Design D0 declaration proof in immutable `GATE_CREATED`. The `committedBaselineOid`, `declaration.designDigest`, original `declarationLine` and `declarationDigest` are **historical provenance**, not equality keys for current D1/HEAD. Grammar, source policy, V2 schema and historical/current authority comparison policy enter `requirementsResolutionPolicyVersion` and affected phase/global fingerprints. Completed approval and reuse independently verify **both** the original V2 provenance and the latest durably revalidated current Requirements/Design/Plan identity (§10.2.5), without demanding HEAD==H0.
- Preserve an explicitly **version-aware legacy V1 decoder** with historical `explicit | auto_design_reference`. V1 `explicit` is not sufficient without independently verified original Requirements authority and history integrity under ARCH-05. V1 `auto_design_reference` pointing to Design bytes is **never** accepted as a new Requirements source; continuation requires independent, pre-existing trustworthy evidence for the actual historical Requirements source and exact binding. Lacking such evidence: preserve bytes and BLOCK, no retrospective authority invention, silent upcast, source renaming or new-budget generation. Historical `DESIGN_CLEAR_INHERITED` also remains recognized under verified ARCH-05 reading, never emitted for new v4 successors.
- New generations pin V2 once in `GATE_CREATED`; no same-generation silent rebinding during restart. Current authority is a **separate validated, durably projected effective binding**, not mutation of V2. Design attempts use independently bound Requirements + Design; Plan inherits Requirements approval only through that **same generation's** still-valid Design CLEAR. Requirements committed drift or selector change invokes a verified invalidation/reopen/reentry transition, not genesis replacement; Requirements are never automatically remediated.


#### 10.2.5 Immutable selection provenance and current committed authority

**Two identities must be checked separately.** `GATE_CREATED` V2 is immutable historical selection evidence: `committedBaselineOid` means the Git commit OID at admission H0; its tree must contain the originally verified Requirements path, Git mode and `requirementsGitBlobOid` (cross-checked against SHA-256 file bytes). If selected by Design marker, `declaration.designDigest` = admission Design D0, and `declarationLine` / `declarationDigest` identify the exact original marker at H0. These values are never overwritten, silently rebased, or compared for equality to every subsequent Design revision or repository HEAD. H0 is **not** a "last Requirements change commit" identity.

**Current effective binding** is a separate `RequirementsAuthoritySnapshotV1` projected solely from V2 plus the latest causally verified durable authority transitions. It binds the current Requirements `(workspace/repository identity, canonical path, Git blob OID, SHA-256 byte digest, Git mode)`, the effective source and selected path, and the current committed Design `(path, digest, Git mode, verified Git commit/tree identity, phase protocol fingerprint)`. Freshly parse its marker as `(presence, valid preamble position, unique declared path, physical line, marker-line digest)` using §10.2.2; persist bounded proof and the producing logical operation/event ID, not Design text. This current evidence, **not** the historical D0/line/H0, is the authority check for fresh review, PRE_CLEAR, approval lookup and completed exact reuse. The current Requirements identity excludes whole-repository HEAD equality; changing HEAD alone cannot create Requirements drift.

**Deterministic transition policy (the sole authority path):**

1. For any new review-stage binding, acquire the relevant Gate/admission ownership and verify a stable committed Git/filesystem snapshot. Prove historical V2 admission evidence independently, then compare current Requirements path/blob/digest/mode and current valid Design marker to the **last durably effective Requirements selection**. An uncommitted, dirty, incomplete or unanchored observation has no authority. Review-stage evidence is keyed by this verified **current context**, not stale original Design D0.
2. For a **Justice-owned Design remediation D0→D1**, first inspect the proposed post-image selector before `REVIEW_COMMIT_PREPARED`. Normal body edits are permitted when Requirements content/blob/mode/path and effective source/selected path are unchanged and the marker (if applicable) is uniquely valid under the same grammar. If marker text stays equivalent but shifts physical line within the permitted preamble, validate its new line/location and store new provenance; do **not** treat its historical `declarationLine` as the expected current line. Harmless leading/trailing marker whitespace changes likewise require fresh verification but not automatic Requirements invalidation. A valid same-selector revalidation is allowed; a changed selector is not presumed equivalent.
3. After the exact Justice Design commit H0→H1 succeeds, verify Design D1, Requirements R0 and marker M1 from **that same committed H1 tree**. Emit a typed, idempotent, causally anchored `REQUIREMENTS_AUTHORITY_REVALIDATED` event referencing the existing `REVIEW_COMMIT_PREPARED`, verified commit, previous effective authority event and updated current Design/marker proof. Its current Requirements identity remains R0. This event is mandatory before fresh review or CLEAR; the original V2 remains unchanged. A crash after H1 and before event append is resolved through the prepared intent, verified Git state and the **same operation ID**, without duplicate commit, round or revalidation. Conflicting commit/tree/provenance BLOCKS.
4. A **Justice remediator must not change Requirements selection**. Deletion, duplicate/invalid marker, path change, move outside the permitted preamble, or insertion of a new marker into a previously CLI-only selection changes selector authority/shape. Block commit preparation, retain the known-dirty post-image under existing round/recovery rules, and never accept self-review PASS as override. A declaration whose line moves within the valid preamble but has the same verified selector is **revalidation**, not source mutation. If marker content changes yet still denotes the same canonical source, a new marker digest must be recorded and independently revalidated before any commit; malformed/ambiguous changes remain BLOCK.
5. For **external committed** Requirements or Design changes, use `REQUIREMENTS_CHANGE_OBSERVED` / `DESIGN_CHANGE_OBSERVED` and, when current authority is affected, `REVIEW_PROGRESS_INVALIDATED` plus applicable upstream reopen or NC1 Two-Key Reentry. No generic SUSPENDED resume or budget replacement. If a new Requirements blob or new valid selector is separately authorized after exact binding validation, publish a typed, versioned, causal `REQUIREMENTS_AUTHORITY_REBASED` carrying the new current authority and proof, linked to historical V2, prior effective authority and verified external commit. This is **same-generation** transition: spent rounds remain spent; dependent Design CLEAR/Plan progress must be invalidated before any new approval. An invalid/unproven/removed/duplicate declaration or disagreement with pinned explicit selection BLOCKS rather than silently substituting a new source. An external change that preserves the current selector and Requirements identity needs **verified external-commit-bound revalidation**, not a spurious successor. A changed source path in an existing generation requires explicit fresh source selection (CLI for an explicit-source change) or independently validated unique Design declaration, plus the appropriate authorized reentry/reopen transition before `REQUIREMENTS_AUTHORITY_REBASED`; an old pinned CLI path is historical evidence, not permission to choose a new conflicting path implicitly. Missing fresh selection or explicit/Design disagreement BLOCKS.
6. **Completed exact reuse and approval lookup:** independently verify (a) historical H0/V2 and any original declaration, (b) complete causal chain of revalidation/rebase events, (c) **current** committed Requirements identity and current uniquely valid marker/explicit selection, (d) **current** Design/Plan path/digest/mode, approved phase milestones, and (e) global protocol fingerprint. Never compare latest HEAD to H0 or current Design D1 to historical D0, and never approve based on saved V2 alone after marker/Requirements drift. Unrelated commit with no relevant artifact change cannot force successor or invalidate approval. Inconsistency, missing current evidence or unprovable Git baseline fails closed.
7. `REQUIREMENTS_AUTHORITY_REVALIDATED` and `REQUIREMENTS_AUTHORITY_REBASED` are **additive versioned typed causal events** governed by ARCH-04 schema, bounded payload, witness publication and ordering rules. They complement, not replace, existing change/invalidation and commit events. Revalidation has a typed origin discriminator: `justice_remediation_commit` MUST reference its committed `REVIEW_COMMIT_PREPARED` / verified Git commit operation; `external_committed_change` MUST instead reference the verified external commit/change-observed transition and effective predecessor authority (no fictitious Justice commit intent). Rebase requires separate verified external-change/reentry authority. The pure projection rejects missing predecessors, duplicated conflicting results, a rebase without required invalidation, or stale context. If a normative upstream event registry is discovered to forbid compatible extensions, record an explicit DEP-04 upstream amendment dependency; **do not change ratified `SPEC.md` implicitly**.

#### 10.2.6 Ratified RR1 compatibility, normative dependency and DEP-04 status

The public optional flag, one strict Design declaration grammar, and V2 semantics are **definitive choices in this Design**, refining RR1's already-ratified "explicit or unambiguous Design reference" contract without changing DEP-01. The current `SPEC.md` note stating that `--requirements` does not exist and the coordinator uses `auto_design_reference` is a **pre-implementation observation**, not a license to retain that fallback.

If further inspection finds a *normative* `SPEC.md` / #297 / #310 rule that **prohibits** this additive public interface or requires an incompatible source schema, do not amend it within this Design fix. Raise a **separate DEP-04 normative amendment / approval dependency** before Implementation Ready. As written, **DEP-04's design ambiguity is resolved** by §§10.2.1–10.2.5; implementation/API alignment, legacy decoding proof and G1/G2 verification remain independently **OPEN**, not satisfied by the design-only change. DEP-01 stays RATIFIED; neither Design self-review nor this contract constitutes Formal Design Gate or implementation authorization.


## 11. Compatibility and authorization (ARCH-10)

Maintain the exact authorized `PlanTask.rawBody` and final prompt construction. Only a genuine `ses_...` continuation can be forwarded as wire `task_id`; internal `task-N` never leaks. Every caller-provided **string** `subagent_type`, including `"general"`, owns routing and excludes the final wire `category`; without one, use Justice category. Authoritative approved task context and foreground mandatory reviews still apply. Unsupported wire `agent/model/provider/variant/reasoning/fallback_models` fields are not introduced. Final host adapter normalization must preserve original args-object identity where already guaranteed.

Share one Markdown fence scanner between PlanParser and DependencyAnalyzer, accepting 0..3-space indentation, backtick/tilde opening fences (including language info where valid), matching closing character with sufficient length, LF/CRLF. Code-fenced headings and `**Interfaces:**` never create tasks/markers. Only the exact trimmed non-fenced `**Interfaces:**` marker enforces conservative sequential execution. Original raw task body is not normalized.

Read-only history remains truly read-only, including on invalid/corrupt histories; no accidental Gate lock acquisition, event append, validator work or artifact resolution. Keep implementation lock until explicit approval; do not conflate Review Gate CLEAR with a human authorization.

## 12. Verification, artifacts and release gates (ARCH-10; DEP-05)

Three independently required gates:

1. **G1 — Pure contract tests:** strict schema/replay, causal hash/frontier, scope discovery, admission decisions, round limits, authoritative commit and crash states, six NC1 conditions/priority, all validation stages/reuse, eligibility/reentry, successor Design re-review, Requirements command parser, one-declaration grammar, path/selector agreement, V2 source and legacy V1 decoding, immutable H0/V2 versus current H1/D1/R0 authority, revalidation/rebase event ordering, marker-line movement and recovery idempotency, routing and shared fence grammar.
2. **G2 — Devcontainer production-path integration:** real coordinator + adapter + durable store + recovery + Git/native boundaries; restart after prepared commit and after verified commit; concurrent scope contention; deletion/index loss/conflicting tips; self-review discovered regression; phase precedence; budget non-reset; old history verified/unverified bridge; command-to-coordinator Requirements authority, pinned V2 event/reuse/approval, drift and reopen; actual Justice Design remediation D0→D1 with intact selector/R0, moved marker line, unrelated HEAD commit, external changed selection or Requirements blob, restart between Git success and authority revalidation; exact completed reuse. Run `bun run test`, `bun run typecheck`, `bun run lint`, `bun run build`. Existing warnings may be separately tracked but **new** errors fail.
3. **G3 — Supported real-host E2E:** actual supported OpenCode + Superpowers/OmO host, Linux x86_64/glibc native addon/capabilities, real task dispatch and final wire behavior, exact prompt/rawBody, caller routing, logical/continuation IDs, scoped Git mutation and crash/restart flows. Opt-in coverage cannot be reported as exercised unless it really runs. Upstream smoke report at baseline is BLOCKED, **not** PASS.

**Required positive-path G2 evidence:** a fully witnessed NC1 stop followed by independently proven eligible committed change, `REENTRY_CANDIDATE`, external validator `MATERIAL_PROGRESS`, idempotent durable reentry and actual coordinator restart in the SAME generation/remaining round budget; across-commit D0→D1→D2 oscillation/regression under a stable semantic phase anchor; Design/Plan target dirty BLOCK versus unrelated dirty allow. Tests must exercise the production coordinator, not only pure Core.

Required negative-path matrix: concurrent and lost scope indices; Design/Plan path rename, cross-scope alias and concurrent first-enrollment budget-bypass attempts; corrupt/truncated/rolled-back event history; incomplete/unsupported legacy proof; Requirements selector absent/explicit/declaration/both agreeing/both conflicting, duplicate/late/malformed/fenced marker, remote Issue URL ignored, missing/unsafe/symlink/untracked/dirty file, V1 auto fallback unverifiable, V2 payload/provenance mismatch, historical H0 versus current H1 without Requirements drift, valid same-path moved marker line, selector path change/deletion/duplication/invalid relocation before Justice commit, external Requirements/selector mutation requiring durable invalidation/rebase, external unchanged-selector revalidation without fictitious Justice commit intent, completed approval binding V2 historical pointer plus current authority proof, restart after Design commit before revalidation, stale completed approval lookup, unrelated HEAD-only commit without successor, changed Requirements/protocol, wrong Requirements reference; out-of-budget resume; target-dirty/unsafe native operation; commit failure and post-commit crash; self-review new blocking/upstream finding; missing/incompatible validation stage; stale/reused execution failure; same-context NC1 six predicates; provider-only reentry, no progress and exhaustion; successor Protocol/Requirements/Design mismatch; completed approval staleness; `subagent_type="general"`; language-fenced Interfaces. All are exercised through actual coordinator/adapter paths where relevant, not only mocked pure seams.

**Acceptance rule:** `BLOCKED`, `SKIPPED`, `NOT RUN` are never PASS. G1 + G2 + G3 must pass; DEP-01 is **already RATIFIED** at the stated baseline; DEP-02 trusted witness and DEP-03 legacy proof must have demonstrated evidence on the target deployment; DEP-04 resolution contract must be reconciled and verified. Passing this Design self-review alone gives **no** implementation authorization. Human approval of the written Design Spec precedes any Implementation Plan; approval of the Implementation Plan precedes implementation.

## 13. Dependency gates and implementation sequencing

| Dependency | Design rule | Proof/approval still required | Current status |
| --- | --- | --- | --- |
| **DEP-01** Upstream contract | Section 10.1; `SPEC.md` §4.1c and #297/#310 ratified for v4 re-review; advanced inheritance remains #298 | **Satisfied — ratified amendment `5b33b79`** | **RATIFIED / CLOSED AS CONTRACT DEPENDENCY** |
| **DEP-02** Scope witness | Section 5.2; separate trusted high-watermark, modeled threat, fsync/recovery; BLOCK if protection absent | Real security isolation, durability and rollback/deletion tests | **DESIGN RULE SPECIFIED / PROOF PENDING** |
| **DEP-03** Legacy history | Section 6; pre-existing trusted witness, verified complete authority, immutable prepared/committed bridge; otherwise BLOCK | Legacy corpus classifications and crash-injection evidence | **DESIGN RULE SPECIFIED / PROOF PENDING** |
| **DEP-04** Requirements authority | §10.2 fixes public `--requirements`, unique exact Design marker, independent tracked Git identity, V2 source semantics and V1 legacy decoder | **Historical/current authority (§10.2.5) contract now specified**; API/parser/resolver/versioned transition, crash recovery and G1/G2 proof pending; separate normative approval if a conflicting upstream rule is discovered | **DESIGN SPECIFIED / IMPLEMENTATION VERIFICATION PENDING** |
| **DEP-05** Live host | Section 12; mandatory real-host E2E | Actual PASS under supported environment | **IMPLEMENTATION ACCEPTANCE PENDING** |

Suggested **implementation plan decomposition** only after *the Formal Design Gate passes and separate Implementation Plan authoring is authorized*, preserving one overall contract: (1) authority/storage/anchor/schema + admission, (2) recovery/commit/self-review, (3) lineage/NC1/validation/reentry, (4) successor/Requirements/compatibility + integration/E2E. No slice can independently assert Review Gate compliance without the final full evidence suite.

## 14. Self-review checklist and Design Gate handoff

This document is a **proposal for formal review**, not an approved implementation baseline.

- Confirm ARCH-01..10 all map to one authority and no in-memory flag can bypass durable projection.
- Confirm incomplete generation cannot become a successor, restart/reentry cannot reset rounds, NC1 suspension cannot use ordinary SUSPENDED resume, and changed path-pair scope IDs cannot create a fresh-budget alias.
- Confirm no self-review or deterministic failure authorizes a Git commit; only verified commit authorizes resolution.
- Confirm DEP-01 is **RATIFIED** at `5b33b79`, new successors cannot inherit Design CLEAR, and historical `DESIGN_CLEAR_INHERITED` reads remain ARCH-05-gated.
- Confirm DEP-02 does not claim whole-volume rollback protection without a protected independent witness.
- Confirm DEP-03 does not bootstrap legacy integrity evidence retroactively; unsafe legacy BLOCK.
- Confirm DEP-04 exactly specifies public CLI, Design marker, source precedence, Git/scope identity, historical H0/V2 versus current H1/D1/R0 authority and event transition/recovery, historical V1 decoding and fail-closed errors without treating `auto_design_reference` as authority.
- Confirm G3 is required and `BLOCKED/SKIPPED/NOT RUN` cannot satisfy acceptance.
- Confirm this Fresh Design Review remediation modifies only this Design Spec; already-ratified `SPEC.md`/Issue changes are separately identified as prior upstream contract work; no production source, tests, CI or implementation plan changes are authorized.

### Historical authoring self-review result (2026-10-09, before DEP-01 ratification)

The following table is preserved **as historical evidence at its original baseline**, not as the current gate/dependency status. In particular its DEP-01 BLOCKED and scope statements were accurate before the `5b33b79` upstream amendment and its later ratification.

| Check | Result | Reason |
| --- | --- | --- |
| Placeholder / unfinished prose | PASS | No TODO/TBD/FIXME placeholders; explicit dependencies are labeled, not silently assumed |
| ARCH-01..10 completeness / shared authority | PASS | One Core decision path and one validated durable source; all ten choices mapped to sections |
| Round / epoch / successor consistency | PASS | Resumable generation cannot be replaced; only completed predecessor may lead to successor, with fresh Design review |
| Commit / self-review / NC1 / validation consistency | PASS | Resolution is post-commit, stages and 6-rule NC1 are mandatory, no agent-granted authority |
| DEP-01 upstream alignment | BLOCKED | Current SPEC and Issues require a separate reviewed amendment; this file does not amend them |
| DEP-02 trusted witness | CONDITIONAL | Threat boundary and recovery protocol specified; deployment isolation/durability still requires proof |
| DEP-03 legacy authority | CONDITIONAL | Strict verified bridge designed; legacy histories lacking independent prior proof remain BLOCKED |
| DEP-04 Requirements authority | CONDITIONAL | Explicit or unique verified reference selected; existing fallback and optional CLI need upstream/code alignment later |
| DEP-05 live host | NOT RUN | This is a design-only change; real-host E2E is an implementation acceptance dependency |
| Scope / permissions | PASS | This commit changes only this Design Spec; no production or upstream contract mutation authorized |

**Self-review outcome:** Document-level consistency checks PASS with explicitly identified external blockers; **Formal Design Gate remains unpassed** and no implementation plan or production work is authorized.

### Fresh Design Review remediation record (2026-10-09; ratified baseline `5b33b79`)

| Finding | Severity | Disposition | Contract evidence |
| --- | --- | --- | --- |
| RG-310-FDR-001 | Major | **RESOLVED in Design** | §10.1, §13, §14 and document header reflect ratified DEP-01; historical self-review remains explicitly historical |
| RG-310-FDR-002 | Major | **RESOLVED in Design** | §10.1 requires durable predecessor lineage reference **when independently validated**; unknown relations must not be invented and prior resolution carries no authority |
| RG-310-FDR-003 | Minor | **RESOLVED in Design** | §10.2 and §13 isolate the unresolved RR1/`auto_design_reference` compatibility question under **DEP-04** |

Fresh Review shall independently verify the exact committed Design blob and ratified upstream contract; a document self-review cannot itself close the Formal Design Gate.

**Independent review history:** The original frozen Design blob `fe072b444534b1cc58f1c5b9d2e60494f66158c3` at HEAD `b573874f426e221eb50bf242a3f27662efb18842` received explicit human Design approval; the earlier BLOCKED self-review entries below are historical, not its final disposition. **This RG-312 documentation amendment changes that reviewed blob and requires a new independent Fresh Design Review before being treated as an approved Design baseline.** DEP-01 remains RATIFIED and the original reviewed blob is retained for audit.

### RG-310-FDR-004 — Design clarification record (2026-10-09)

The new Major finding concerned the public Requirements selector, Design declaration syntax and durable source type, **not** the earlier FDR-003 DEP-01/04 separation. §§10.2.1–10.2.6 define the public interface, historical/current authority, precedence, fail-closed handling and acceptance tests. **Earlier FDR-004 remediation: PARTIALLY RESOLVED on prior baseline; current §10.2.5 binding-lifecycle correction: DOCUMENT-ADDRESSED / INDEPENDENT FRESH REVIEW REQUIRED**. Historical FDR-001〜003 results and DEP-01 RATIFIED are unchanged. No implementation or test is asserted.

### RG-310-FDR-004 — Fresh self-review record (2026-10-09)

- **Design remediation:** historical selection H0/D0 remains immutable while `RequirementsAuthoritySnapshotV1` derives current committed R0/D1 from typed causal events; completed approval references **both**. Normal Justice Design-only commit publishes revalidation without changing Requirements identity or consumption budget.
- **Failure boundaries:** changed/missing/invalid selector blocks Justice commit; externally changed source/Requirements requires independently verified invalidation/rebase/reentry; unrelated HEAD-only changes cannot create false drift. Post-commit crash resumes the same logical operation; historical V1 and upstream RATIFIED contracts are untouched.
- **Cross-contract scan:** ARCH-02 admission/budget, ARCH-03 commit and recovery, ARCH-04 durable evidence, ARCH-05 legacy reading, ARCH-07 mandatory validation, ARCH-08 reentry, ARCH-09 successor, ARCH-10 G1/G2 scenarios remain compatible. Historical self-review entries remain historical.
- **Disposition:** RG-310-FDR-001/002/003 stay RESOLVED; RG-310-FDR-004 is **DOCUMENT-REMEDIATED, INDEPENDENT FRESH REVIEW REQUIRED**. This self-review does not approve the Formal Design Gate, authorize an Implementation Plan or assert production tests passed.

**Historical status at this earlier self-review (before later independent Design approval):** DEP-01 RATIFIED; DEP-02/03 proof pending; DEP-04 implementation/alignment verification pending; DEP-05 real-host E2E NOT RUN. Formal Design Gate was BLOCKED then; Implementation Plan was NOT AUTHORIZED then. These statements are retained as dated historical evidence, not current approval authority.

### RG-312 documentation amendment / approval handoff (2026-10-10)

- **Previously approved Design:** fixed HEAD `b573874f426e221eb50bf242a3f27662efb18842`, blob `fe072b444534b1cc58f1c5b9d2e60494f66158c3`, formally approved after RG-310-FDR-001〜004 resolution. Preserve this as historical ratified review evidence.
- **RG-312-001:** §7 clarifies commit subject + metadata trailers without amending the upstream SPEC or Issue #297 normative wording.
- **RG-312-002:** §4.2 clarifies NC1 dedicated admission candidate before generic drift and the independent durable Two-Key production reentry.
- **RG-312-004:** §8 makes logical semantic context continuous across normal remediation commit revisions and requires a verifiable transition proof to split incompatible semantic comparison segments.
- **Current modified Design:** independent **Fresh Design Review required** before replacing the earlier approved blob. DEP-01 remains RATIFIED; DEP-02/03 deployment/legacy proof pending, DEP-04 implementation verification pending and DEP-05 live host E2E NOT RUN. The reviewed Implementation Plan at `29f52eea` was independently READY, but RG-312 changes require a **new Fresh Plan Review** after Design re-review. Production implementation and automatic merge remain NOT AUTHORIZED by these document edits.
