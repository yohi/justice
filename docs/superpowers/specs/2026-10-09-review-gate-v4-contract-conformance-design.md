# Justice v4 Review Gate — Contract Conformance Design

- Date: 2026-10-09 (JST)
- Repository: \`yohi/justice\`, base branch \`v4\`
- Source baseline: \`ed4dd8d5a3050fe6ba559b1ced94e01f0157f60b\`
- Requirements: [#297](https://github.com/yohi/justice/issues/297); gap audit: [#310](https://github.com/yohi/justice/issues/310); v5 boundary: [#298](https://github.com/yohi/justice/issues/298)
- Normative source under review: \`SPEC.md\` §4.1c (plus §4.1d and §4.1e for compatibility/authorization)
- Status: **DESIGN DRAFT — architecture approved; formal written Design Gate pending; NOT IMPLEMENTATION-READY**
- Change permission: **this document only**. No production source, tests, CI, \`SPEC.md\`, Issues, or implementation plan changes authorized by this document.

## 1. Purpose, scope, and authority

This design makes the existing v4 pre-implementation Review Gate contract-correct, restart-safe, and fail-closed without adopting the v5-wide Event-Sourced Control Plane. The existing \`/justice-review-gate\` remains the user entry point; \`/justice-implement --approved\` remains a separate explicit authorization boundary. Justice does not take ownership of Superpowers implementation task scheduling or final code review.

**Hard invariants:**

1. Only Justice Core can admit a generation, apply a state transition, consume a remediation round, authorize a Git mutation, confirm lineage resolution, or CLEAR a phase. Workers return bounded evidence, not authority.
2. Validated durable history is the sole state source; process-local orchestration flags and LLM text are never authoritative. Any unverified, missing, unsupported, causally invalid, or conflicting authority yields BLOCK, not optimistic default state.
3. Design review uses Requirements + Design; Plan review uses approved immutable Design + Plan. Requirements, production source, tests, CI, and unrelated files cannot be remediation targets.
4. Per-generation remediation ceilings are **Design 5** and **Plan 3**. Retry, crash resume, reentry, drift, \`--retry\`, or legacy migration cannot reset them.
5. Never commit on unresolved targeted self-review, newly discovered blocking/upstream findings, indeterminate evidence, required validation failure, or wrong artifact binding. Resolution follows verified Git success, never an LLM assertion.
6. Read-only completed approval lookup, history inspection, and exact completed reuse never alter state. CLEAR is not human approval, merge authorization, or implementation authorization.
7. Previous generations remain immutable historical evidence. This v4 design deliberately does **not** inherit Design CLEAR or finding-resolution authority into a completed successor (ARCH-09); see **DEP-01 contract amendment gate**.

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
| ARCH-09 | **B — Conservative Design Re-review** | No Design CLEAR inheritance on successor; approved upstream contract amendment required |
| ARCH-10 | **A — Contract-first Compatibility Adapters + Tiered Acceptance Gates** | Host/task compatibility, production integration, three verification levels |

## 3. Component ownership and interfaces

\`\`\`text
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
\`\`\`

- **Pure Core** consumes immutable *validated* snapshots and produces typed decisions/transition intents. It never reads Git, files, wall clock, agent sessions, or native capabilities.
- **Runtime** performs reads, locks, dispatch, version/binding verification, exactly-scoped side effects, event publication, and recovery. It does not invent alternate approval or budget truth.
- **Store** checks event-specific schema/persistence policy/causal links before append and on replay. Indexes/caches are diagnostic or derived, not authority. Invalid histories are neither repaired by skipping entries nor overwritten.
- **Workers** (history-blind reviewer; independent finding validator; target-only remediator; fresh self-review/reentry validator) deliver strictly parsed typed evidence. The validator's semantic judgment is checked against pinned identities and allowed relations; the worker cannot mint lineage IDs or commit.
- **Authorization integration** retains review-scoped read/query and remediator-only write capabilities. All \`implementation\` operations remain prohibited until separately authorized.

**Affected seams:** \`src/runtime/review-gate-coordinator.ts\`, \`review-gate-event-store.ts\`, \`review-gate-git.ts\`, \`review-gate-recovery-store.ts\`, \`review-gate-approval.ts\`, \`review-gate-history.ts\`; \`src/core/review-gate/{projection,orchestrator,lineage,convergence,deterministic-validation,resume-cursor}.ts\`, \`review-gate-types.ts\`; \`src/hooks/plan-bridge.ts\`, \`src/core/{plan-parser,dependency-analyzer}.ts\` and host adapter. This list is a design dependency map, **not** permission to edit them.

## 4. Scope, generations, and admission (ARCH-01/02/08/09)

### 4.1 Scope lock and discovery

1. Resolve canonical workspace root identity and canonical relative Design/Plan paths. The scope identity is stable across invocations; identities/paths must not be guessed from text.
2. Acquire the **non-blocking OS scope lock** before any authoritative scope discovery/selection and before the Gate lock. Read-only diagnostic scans prior to lock have no admission authority.
3. Under scope lock, discover all scope members independently of \`scope-index.json\`; read trusted scope witness and every relevant Gate/writer shard. Verify schema, causal history, generation chain, unique current tip, predecessor links, and any existing completed binding.
4. Re-read exact Requirements/Design/Plan identity, Git blob/mode and phase/global protocol fingerprints *under admission ownership*. Mixed snapshots, changed bindings, or conflicting tips BLOCK.
5. Select the gate, acquire Gate lock, reproject under ownership, or durably publish new \`GATE_CREATED\` and scope membership before releasing scope lock. Hold Gate lock for the invocation. Locks never flow to child workers; PID/TTL/heartbeat are not ownership proof.

Corruption of a known current scope blocks its admission/successor creation; unrelated-scope corruption must not globally block a verified healthy scope. Index loss is not evidence that the scope is new.

### 4.2 Pure admission decision table

| Verified situation | Decision | Requirements |
| --- | --- | --- |
| Resumable ACTIVE/SUSPENDED generation, no meaningful drift | \`RESUME\` | Same \`gateId\`, generation, epoch, all spent rounds |
| Resumable generation with binding/context drift | \`REVALIDATE_OR_BLOCK\` | Use invalidation/upstream/external-change rules; NEVER make budget-reset successor |
| Eligible NC1 suspension | \`REENTRY_CANDIDATE\` | Section 9 two-key verification; same generation |
| Completed tip, **all Requirements/Design/Plan paths, digests/modes, resolution, global protocol** exact | \`REUSE_COMPLETED\` | Read only; no event append |
| Verified unique immediate completed predecessor with changed identity | \`CREATE_SUCCESSOR\` | \`supersedesGateId\` bound to predecessor; **fresh Design Gate, even Plan-only drift** |
| Current-scope corruption, unsupported version, missing witness, competing tips | \`BLOCK\` | No synthetic event, fresh gate, or repair |
| Provably uninitialized scope with trusted first-enrollment evidence | \`CREATE_GENESIS\` | First Gate; enrollment and genesis publication are recoverable |

A successor never inherits predecessor CLEAR or resolution authority. A same-generation Plan resume **does** retain its own still-valid Design CLEAR. On protocol/Requirements/Design drift, previous same-generation approval must be invalidated by a verified change transition, not silently rewritten. Requirements change/upstream blocker precedes Design/Plan remediation.

### 4.3 Epoch and budget

\`ORCHESTRATION_RESUMED\` is audit in the same epoch after a crash. Only an explicit, verified eligible suspension transition starts \`ORCHESTRATION_EPOCH_STARTED\`. Each unique round is consumed once at durable \`REMEDIATION_STARTED\` (before mutation), counted from the projected generation-wide history. Rounds are ordinal and bounded (Design 1..5; Plan 1..3); no event with out-of-range, duplicate conflicting, or reset ordinal is admissible. Blocking post-image carries forward within current generation without minting a round. Exhaustion permits external committed-change revalidation/CLEAR but **not** round 6/4.

## 5. Event ledger, causal persistence, and recovery (ARCH-03/04; DEP-02)

### 5.1 Canonical record and limits

Keep the normative v4 writer-shard path \`.justice/review-gates/events/<reviewScopeId>/<gateId>/<writerId>.jsonl\`. Each new event has explicit schema version, \`eventId\`, scope/gate/writer/epoch identity, logical operation/review/round refs where applicable, monotone shard sequence, prior shard hash, causal parent/frontier references, strict event-specific bounded payload, and canonical hash. Event identity and operation outcome must be idempotent; the same ID with different bytes is conflict.

Logical events include the \`SPEC.md\` §4.1c required families: generation/dispatch, attempt/finding/reconciliation, deterministic validation/reuse, remediation/recovery, self-review, commit intent/success/recovery, lineage resolution, change/invalidation, NC1/reentry, CLEAR and completed approval. Bounded \`LEGACY_HISTORY_VERIFIED\`/\`LEGACY_BRIDGE_COMMITTED\` records may be added under a versioned policy; they contain only digests and refs.

Canonical serialization, field allowlists, all enum validation, referential integrity and transition prerequisites apply on both append and replay. Proposed **EventPersistencePolicyV1** hard bounds: individual JSON event <=64 KiB UTF-8; ID <=256 bytes; canonical relative path <=4096 bytes; list <=128 refs per event (larger logical batches are split into causally ordered bounded events, never dropped). No raw agent/tool output, prompts, artifact bodies, hidden reasoning, credentials, environment variables or absolute host paths. Reject authority-field violations with \`EVENT_PERSISTENCE_POLICY_VIOLATION\`; do **not** redact into altered authority. All current/historical Gate event records are retained; no v4 compaction, auto-prune, or delete-as-recovery.

### 5.2 Trusted scope witness and precise threat model (DEP-02)

**Trust boundary:** the entire mutable \`.justice/review-gates\` tree, its \`scope-index.json\`, process cache and event files are **not** sufficient to establish first-use or ledger completeness. Require a separate Justice-owned, OS-protected and durable **scope witness registry** keyed by stable canonical workspace identity/scope ID. The witness records immutable scope enrollment, generation membership, expected committed frontier per writer, and monotonically advanced global scope frontier. The registry is outside the workspace Gate history deletion target (for example, a Justice-owned host-state location); its precise deployment path is configuration, not part of the logical contract.

The witness must have access controls preventing the **modeled actor** that can corrupt/delete workspace history from also replacing/deleting/rolling back the witness. Explicitly:
- **Guaranteed under the stated model only:** process crash/power loss (with verified filesystem sync guarantees), accidental/unauthorized changes to the mutable Gate history or index, and concurrent Justice writers constrained by native scope locking. Completeness is anchored to the last durable witness frontier.
- **Not guaranteed by hashing or path separation alone:** adversaries with effective credentials/write access to **both** journal and witness, privileged root, full-volume snapshot rollback, or destruction of every independent state copy. A directory elsewhere under the same writable identity is **not** an independent security boundary.
- **Deployment prerequisite:** demonstrate witness isolation/durability and authenticated first enrollment. If unavailable, missing, unreadable, unsupported or untrusted, admission is \`BLOCK\`; do not call it a new workspace. An unproven bootstrap cannot assert absence of past deleted history. If the deployment cannot provision the witness trust boundary, DEP-02 remains unsatisfied and the design is not implementation-ready for that deployment.

**Publication protocol:** under scope lock, validate predecessor frontier and preconditions; durably write+sync new shard bytes and containing directory; conditionally advance an independently durable witness frontier (generation/sequence + hash) using compare-and-swap/serialized ownership; only then acknowledge authoritative append. A partially written/unanchored tail is not projected as authority. Crash recovery validates both frontiers and a durable prepared publication identity: old witness + exact complete new tail can be finished idempotently only if the prepared identity/ownership is proven; witness-ahead/missing data, divergent hash, unexpected tail or unknown rollback => \`BLOCK\`. No successful worker/commit side effect is started until its prepared intent is witness-committed. A crash after Git commit is recovered using the already committed intent and verified Git state (section 7), not by a second blind commit.

Independent scope discovery checks orphan Gate IDs, missing shards, competing writer heads and ambiguous generations. A hash chain without the independently protected expected frontier is not claimed to detect complete tail deletion or coordinated rollback.

### 5.3 Read-side policy

\`projectReviewGate\`, read-only history, and completed approval lookup accept only successfully verified contiguous authority history. Unsupported event versions, invalid persistence policy or unresolved causal ambiguity reject the query rather than displaying partial CLEAR. \`scope-index.json\`, cached DTOs and raw event count are not authority.

## 6. Legacy history admission and bridge (ARCH-05; DEP-03)

Legacy \`<gateId>/events.jsonl\`, \`dispatches.jsonl\` and recovery objects are **immutable inputs**, never silently rewritten or deleted. A legacy Gate is not "verified" merely because JSON parses or the legacy reducer returns ACTIVE/COMPLETED.

**VerifiedContinuation preconditions (all required):**
1. Scope enrollment/membership and expected complete history frontier have independent **pre-existing trusted evidence**. A checksum/anchor manufactured at migration time is not evidence of prior non-deletion.
2. Validate all legacy event types and state transitions, exact scope/gate/protocol/Requirements/Design/Plan provenance, epoch sequence, round consumption (including interrupted rounds), dispatch identity/outcome, pending side effects and recovery objects.
3. Verify external Git commits, relevant artifact digest/mode, committed approval, resolution authority and lineage applicability as needed for the requested resume cursor; absence of commit-bound evidence cannot be inferred from \`FINDING_SELF_REVIEWED\`.
4. No conflicting completed/resumable tips or unsupported history gaps. Bounded legacy upcast is allowed only for equivalent facts, never for invented facts, epochs, resolution, round consumption or lineage.
5. The intended continuation cursor is deterministically reconstructable, including safe suspension for missing redelivery evidence, and passes the same current-binding checks as a native new-ledger resume.

If any precondition fails: retain all bytes, expose safe diagnostic \`LEGACY_AUTHORITY_UNVERIFIABLE\`, **BLOCK** continuation/replacement/reuse; never create a fresh generation to bypass lost budget.

**Atomic bridge publication:** under scope lock, compute immutable snapshot digest and verified projection digest; publish a durable \`LEGACY_BRIDGE_PREPARED\` binding both, gate/epoch/generation/rounds/authority references and policy version; write verified new-ledger bridge payload; finalize with witness-committed \`LEGACY_BRIDGE_COMMITTED\` for a unique operation ID. The new projection consumes exactly one verified predecessor snapshot plus post-bridge typed events; no dual legacy/new authority and no double counted round. After a crash, if only PREPARED exists, reverify immutable bytes and either finish the same bridge idempotently or BLOCK; never guess or mint a second bridge. No legacy event is modified as part of recovery.

Legacy archive/reconstruction tooling beyond these minimums belongs to v5.

## 7. Review, self-review, commit-bound resolution (ARCH-03/06/07)

**Attempt binding:** an attempt pins phase, baseline revision, Requirements/Design/Plan as applicable, approved Design in Plan, protocol fingerprint and operation identity. Separate fresh reviewer and independent finding-validator contexts; hidden reasoning never crosses them. \`INVALID\` is auditable but not remediable, \`minor\` advisory never blocks or auto-remediates, duplicate occurrences yield one blocker, contradictory validator results fail closed. The only finding entry points are reviewer validation, self-review discovery, registered deterministic validation, and existing-lineage regression/revalidation.

**Remediation lifecycle:**
1. Durable round start + exact pre-image recovery CAS and target capability constraints precede the first mutation.
2. Remediator can write only the phase target; must not commit, push or modify Requirements/production files. Unknown partial worktree state is not overwritten.
3. On completion, record bounded post-image identity and run mandatory \`POST_REMEDIATION_SELF_REVIEW\` deterministic checks *and* fresh-context self-review against the same pinned post-image.
4. Self-review's target \`RESOLVED/STILL_PRESENT/INDETERMINATE\` and **all** discovered occurrences are strictly validated and durably reconciled **before** deciding commit eligibility. \`STILL_PRESENT\` plus duplicate discovered EXISTING defect is a conflict. Blocking current-phase or upstream discovery, target still present, failed mandatory stage, indeterminate check or binding drift prohibits commit. A blocking current-phase result consumes the round without commit and preserves exact known-dirty post-image for next disposition; on final round suspend.
5. Eligible PASS creates and durably witness-commits \`REVIEW_COMMIT_PREPARED\` (unique operation ID, expected parent/HEAD, target path + pre/post digest/mode, round, bound lineages). Only then run Justice-owned **single-literal-artifact** Git commit, preserving unrelated index/worktree. Verify parent, sole changed path, blob, mode and commit SHA before \`REMEDIATION_COMMIT_SUCCEEDED\`.
6. Emit \`LINEAGE_RESOLUTION_COMMITTED\` only after verified success with exact commit/digest/context/lineage binding, or after separately verified committed external-change revalidation. Self-review evidence alone never closes OPEN lineage; failed commit leaves it unresolved. Any crash after side effect uses prepared intent plus real Git state to classify source/destination/conflict and avoid duplicate commit or resolution.
7. Fresh history-blind review follows verified resolution; failed fresh review cannot replay committed remediation. \`DESIGN_CLEAR\` precedes Plan review; \`PLAN_CLEAR\` plus durable completed binding follows Plan verification. Neither unlocks implementation automatically.

Exact artifact mode is Git \`100644 | 100755\`, based on owner execute bit rather than any POSIX execute bit. Native Linux x64/glibc \`openat2\`, \`renameat2\`, non-blocking \`flock\`, and sync support are mandatory for mutation; no unsafe Node pathname-only fallback.

## 8. Semantic lineage and NC1 (ARCH-06)

Justice issues \`occurrenceId\` per observation and generation-local \`lineageId\` per semantic defect. Immutable basis = \`violationType\`, \`governingReference\`, \`semanticLocation\`, \`violatedContract\`, \`ownerScope\`; \`basisDigest\` hashes canonical JSON. Semantic relation is validated against offered opaque candidates; digest equality alone is not resolution or relation authority.

Durable events reconstruct targeted lineages, complete pre/post semantic blocker landscapes, fingerprint, count, targeted round outcome, contract-conflict group and committed resolution/regression per cycle. A pure NC1 evaluator compares only **same phase baseline/protocol context**. Missing necessary cycle evidence yields \`INDETERMINATE/BLOCK\`, never \`CONVERGENT\`.

Six normative predicates, evaluated all and stored with the ordered first as \`primaryReason\`:
1. \`RESOLVED_LINEAGE_REGRESSED\`: committed resolution later regresses in the same context (immediate suspend).
2. \`REMEDIATION_OSCILLATION\`: \`fingerprint[n] == fingerprint[n-2]\` and differs from \`fingerprint[n-1]\`.
3. \`SAME_LINEAGE_STALL\`: same targeted lineage is STILL_PRESENT in **both** consecutive rounds.
4. \`CONTRACT_CONFLICT_REPEATED\`: same owner/type/reference/contract group targeted and still blocking after **two** consecutive targeted rounds; exclude semantic location.
5. \`BLOCKER_LANDSCAPE_REPEATED\`: exact semantic blocker landscape unchanged over two consecutive cycles.
6. \`BLOCKER_COUNT_NOT_IMPROVING\`: **two** consecutive cycles with \`postBlockingCount >= preBlockingCount\`; any decrease resets the streak.

Runtime disposition order: **current upstream blocker → stale-lineage revalidation → NC1 → absolute exhaustion → remediation → clean-phase fresh review**. A \`reopened\` flag, a single plateau or current-state reverse engineering is not sufficient NC1 evidence.

## 9. Three-stage deterministic validation and reentry (ARCH-07/08)

### 9.1 Mandatory validation

One stage-aware planner computes registered mandatory validators for \`BASELINE_ADMISSION\` (before reviewer dispatch), \`POST_REMEDIATION_SELF_REVIEW\` (before commit), and \`PRE_CLEAR\` (before CLEAR). It derives exact phase, baseline/protocol, declared artifact/approval inputs, validator contract/result schema and applicable executable/tool/runtime identities.

Persist \`DETERMINISTIC_VALIDATION_COMPLETED\` with bounded typed semantic results and \`DETERMINISTIC_VALIDATION_REUSED\` referencing the verified original evidence. Reuse semantic PASS/FAIL/INDETERMINATE **only** on exact verified binding and supported schema; only accepted PASS satisfies a mandatory required stage. Execution failure/unavailable evidence is never cached as semantic truth. A redispatch within the **same logical operation** with environment drift fails closed. Missing evidence is re-executed where safe; corruption is not repaired by rerun. \`PRE_CLEAR\` semantic FAIL enters the ordinary lineage flow, INDETERMINATE cannot CLEAR. POST semantic FAIL enters DVF1 while LLM self-review still runs, and blocking findings prevent commit. Admission FAIL/INDETERMINATE suspends without a finding.

Rule identity/severity/owner/contract is registry-owned, not model-owned. Deduplicate deterministic observations by \`(validationEventId,ruleId)\` and connect them to the same durable semantic lineage as reviewer observations.

### 9.2 Non-convergence reentry

After durable \`REVIEW_NON_CONVERGENT\`, Core requires **two independent keys**:
1. Deterministic eligible-change verification: Design accepts committed Requirements/Design/design-protocol; Plan accepts committed approved Design/Plan/plan-protocol. Changed artifacts are clean/committed; identity/parent/digest/mode/protocol and phase context must be verified. Model/provider/writer/time-only change is ineligible.
2. Fresh, independently validated \`NON_CONVERGENCE_REENTRY_VALIDATION\` yielding \`MATERIAL_PROGRESS\` tied to the verified before/after context and original NC1 evidence. \`NO_MATERIAL_PROGRESS\`/unavailable/invalid stays suspended.

The result is *evidence*, not ACTIVE authority. A pure reentry planner validates allowed lineage refs and binds evidence to a durable transition, optionally starting a new epoch, **never a new generation or budget**. An upstream reopen result may reference only a pre-existing committed CURRENT upstream lineage; it cannot create a lineage. Requirements → Design → Plan precedence and exact downstream restore remain intact. Round exhaustion admits only external-change revalidation/CLEAR, not more remediation.

## 10. Completed successor, protocol and Requirements authority (ARCH-09; DEP-01/04)

### 10.1 Conservative Design re-review

Exact completed reuse requires verified complete Requirements resolution, Design/Plan canonical path + digest + Git mode and current **global** \`reviewProtocolFingerprint\` equality. It is read-only. For a changed completed tip, a new successor is permissible **only** from the unique verified immediate completed predecessor; bind \`supersedesGateId\`. No predecessor Design CLEAR or resolution is projected as current authority. **Even a Plan-only change starts a fresh Design Gate** using current Requirements, Design and design-protocol. Current-generation Design CLEAR from that fresh run can be used during later Plan resume if still valid. New generation lineages may store independently validated \`(predecessorGateId, predecessorLineageId)\` historical references; no cross-generation resolution import, advanced propagation or \`DESIGN_CLEAR_INHERITED\` emission.

An incomplete Gate is not a predecessor eligible for a fresh budget; corrupted history or ambiguous current tips BLOCK.

**DEP-01 is an unconditional authorization gate:** \`SPEC.md\` §4.1c and #297/#310 currently expect Design CLEAR inheritance in the relevant completed successor scenario. Explicitly amend the *v4 contract* to permit/require fresh Design re-review as the selected conservative alternative and move advanced inheritance to v5 #298. This Design document **does not** make that upstream amendment or grant its approval. Until upstream amendments are reviewed and approved, formal implementation-ready status is forbidden.

### 10.2 Requirements resolution contract (DEP-04)

Requirements authority is a **real independently identified input artifact**, not a name inferred from a Design title or a substitution of Design bytes. Resolution is either:
- An optional **explicit** canonical Requirements path (compatible additive \`--requirements <path>\` input proposed for v4) whose bytes, blob, mode, scope and binding are verified under admission lock; or
- Exactly **one** syntactically valid, canonical, unambiguous Design-declared Requirements reference resolved under the same lock and independently verified.

Zero, multiple, ambiguous, missing, unreadable, unsafe, mismatched or stale references => **BLOCK with actionable \`REQUIREMENTS_RESOLUTION_REQUIRED\`** before reviewer dispatch or genesis. \`auto_design_reference\` does not prove independent Requirements identity; legacy Gate with that field may continue only if DEP-03 verified authoritative external evidence establishes its genuine Requirements source. The user is not required to supply an argument when an unambiguous reference is present; the public command entrance remains backward-compatible wherever the prior input is verifiably valid.

Persist \`RequirementsResolutionV1\` source, canonical path, digest, Git mode, proof of reference/explicit selection and binding to generation in \`GATE_CREATED\`; no subsequent silent rebinding. Design attempt pins Requirements + Design; Plan inherits Requirements authority **transitively through its current-generation verified Design CLEAR**. A changed Requirements artifact invalidates that approval and invokes upstream rules. The Requirements artifact is never an auto-remediation target.

Any conflicting current \`SPEC.md\` command-limitation text (the historical Design-as-Requirements fallback) must be explicitly reconciled during DEP-01/contract alignment, not hidden as an implementation detail.

## 11. Compatibility and authorization (ARCH-10)

Maintain the exact authorized \`PlanTask.rawBody\` and final prompt construction. Only a genuine \`ses_...\` continuation can be forwarded as wire \`task_id\`; internal \`task-N\` never leaks. Every caller-provided **string** \`subagent_type\`, including \`"general"\`, owns routing and excludes the final wire \`category\`; without one, use Justice category. Authoritative approved task context and foreground mandatory reviews still apply. Unsupported wire \`agent/model/provider/variant/reasoning/fallback_models\` fields are not introduced. Final host adapter normalization must preserve original args-object identity where already guaranteed.

Share one Markdown fence scanner between PlanParser and DependencyAnalyzer, accepting 0..3-space indentation, backtick/tilde opening fences (including language info where valid), matching closing character with sufficient length, LF/CRLF. Code-fenced headings and \`**Interfaces:**\` never create tasks/markers. Only the exact trimmed non-fenced \`**Interfaces:**\` marker enforces conservative sequential execution. Original raw task body is not normalized.

Read-only history remains truly read-only, including on invalid/corrupt histories; no accidental Gate lock acquisition, event append, validator work or artifact resolution. Keep implementation lock until explicit approval; do not conflate Review Gate CLEAR with a human authorization.

## 12. Verification, artifacts and release gates (ARCH-10; DEP-05)

Three independently required gates:

1. **G1 — Pure contract tests:** strict schema/replay, causal hash/frontier, scope discovery, admission decisions, round limits, authoritative commit and crash states, six NC1 conditions/priority, all validation stages/reuse, eligibility/reentry, successor Design re-review, Requirements resolver, routing and shared fence grammar.
2. **G2 — Devcontainer production-path integration:** real coordinator + adapter + durable store + recovery + Git/native boundaries; restart after prepared commit and after verified commit; concurrent scope contention; deletion/index loss/conflicting tips; self-review discovered regression; phase precedence; budget non-reset; old history verified/unverified bridge; exact completed reuse. Run \`bun run test\`, \`bun run typecheck\`, \`bun run lint\`, \`bun run build\`. Existing warnings may be separately tracked but **new** errors fail.
3. **G3 — Supported real-host E2E:** actual supported OpenCode + Superpowers/OmO host, Linux x86_64/glibc native addon/capabilities, real task dispatch and final wire behavior, exact prompt/rawBody, caller routing, logical/continuation IDs, scoped Git mutation and crash/restart flows. Opt-in coverage cannot be reported as exercised unless it really runs. Upstream smoke report at baseline is BLOCKED, **not** PASS.

Required negative-path matrix: concurrent and lost scope indices; corrupt/truncated/rolled-back event history; incomplete/unsupported legacy proof; wrong Requirements reference; out-of-budget resume; target-dirty/unsafe native operation; commit failure and post-commit crash; self-review new blocking/upstream finding; missing/incompatible validation stage; stale/reused execution failure; same-context NC1 six predicates; provider-only reentry, no progress and exhaustion; successor Protocol/Requirements/Design mismatch; completed approval staleness; \`subagent_type="general"\`; language-fenced Interfaces. All are exercised through actual coordinator/adapter paths where relevant, not only mocked pure seams.

**Acceptance rule:** \`BLOCKED\`, \`SKIPPED\`, \`NOT RUN\` are never PASS. G1 + G2 + G3 must pass; DEP-01 must be independently upstream-approved; DEP-02 trusted witness and DEP-03 legacy proof must have demonstrated evidence on the target deployment; DEP-04 resolution contract must be verified. Passing this Design self-review alone gives **no** implementation authorization. Human approval of the written Design Spec precedes any Implementation Plan; approval of the Implementation Plan precedes implementation.

## 13. Dependency gates and implementation sequencing

| Dependency | Design rule | Proof/approval still required | Current status |
| --- | --- | --- | --- |
| **DEP-01** Upstream contract | Section 10.1; explicitly amend \`SPEC.md\` §4.1c and #297/#310 to v4 re-review; retain advanced inheritance in #298 | **External human approval of the upstream amendment** | **BLOCKING / UNAPPROVED** |
| **DEP-02** Scope witness | Section 5.2; separate trusted high-watermark, modeled threat, fsync/recovery; BLOCK if protection absent | Real security isolation, durability and rollback/deletion tests | **DESIGN RULE SPECIFIED / PROOF PENDING** |
| **DEP-03** Legacy history | Section 6; pre-existing trusted witness, verified complete authority, immutable prepared/committed bridge; otherwise BLOCK | Legacy corpus classifications and crash-injection evidence | **DESIGN RULE SPECIFIED / PROOF PENDING** |
| **DEP-04** Requirements authority | Section 10.2; explicit or unique actual Requirements file; no Design-as-Requirements fallback | Contract reconciliation + parser/provenance & production tests | **DESIGN RULE SPECIFIED / PROOF PENDING** |
| **DEP-05** Live host | Section 12; mandatory real-host E2E | Actual PASS under supported environment | **IMPLEMENTATION ACCEPTANCE PENDING** |

Suggested **implementation plan decomposition** after *written-spec and upstream approvals*, preserving one overall contract: (1) authority/storage/anchor/schema + admission, (2) recovery/commit/self-review, (3) lineage/NC1/validation/reentry, (4) successor/Requirements/compatibility + integration/E2E. No slice can independently assert Review Gate compliance without the final full evidence suite.

## 14. Self-review checklist and Design Gate handoff

This document is a **proposal for formal review**, not an approved implementation baseline.

- Confirm ARCH-01..10 all map to one authority and no in-memory flag can bypass durable projection.
- Confirm incomplete generation cannot become a successor and restart/reentry cannot reset rounds.
- Confirm no self-review or deterministic failure authorizes a Git commit; only verified commit authorizes resolution.
- Confirm DEP-01 is an explicit upstream contract change, **not** hidden as a permissive reading of \`DESIGN_CLEAR_INHERITED\`.
- Confirm DEP-02 does not claim whole-volume rollback protection without a protected independent witness.
- Confirm DEP-03 does not bootstrap legacy integrity evidence retroactively; unsafe legacy BLOCK.
- Confirm DEP-04 forbids guessed Requirements authority and reconciles existing \`auto_design_reference\`.
- Confirm G3 is required and \`BLOCKED/SKIPPED/NOT RUN\` cannot satisfy acceptance.
- Confirm no production source, tests, CI, original \`SPEC.md\`, upstream Issue, or implementation plan was modified in this authoring step.

**Formal Design Gate: NOT YET PASSED. Implementation Plan: NOT AUTHORIZED. Production Changes: NOT AUTHORIZED. Implementation Ready: BLOCKED pending DEP-01 upstream approval (plus proof of DEP-02..04).**
