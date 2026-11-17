# Justice v5 — RG-310-A-001 R11 Authorization / Fingerprint / Transition Matrix

- Document ID: `RG310-AUTH-FP-R11`; proposal `ADP-RG310-A-001-R11`; created 2026-10-14 JST.
- **PROPOSAL ONLY / UNAPPROVED / NON-EXECUTABLE.** This file is the **sole operative matrix within the proposed R11 candidate**, `04-authorization-fingerprint-transition-matrix-R11.md`. If formally adopted in the required human chain, R11 §§1–7 take precedence over ambiguous operative candidate terminology in proposal D/E/F/G/H. The approved existing requirements/evaluator and strict STOP requirements prevail over all candidate prose.
- Origin: R7 ZIP SHA-256 `05a1372a1ee30176cb2db560842148251077ce96257905f8fc763f72914282ca`; R7 technical review report SHA-256 `cf0b9173975c9f96720ee9f5b69ff5b8834c9a574c57ddac25139afee6de75a1`, verdict REVISION_REQUIRED, **formal reviewer identity NOT_ESTABLISHED**. R6 ZIP `284eda20ec576f4036c48f5e8b8b8efad235127f6025c6e4bc6d0767eab818c6` is historical only. All earlier R6/R7 matrix pointers and legacy predicate names have **no normative force** in this R11 proposal.

## 1. Typed identities and trust / attacker model

| Object | Immutable / mutable | Binding and semantics |
|---|---|---|
| `IAB`, `baselineId` | immutable grant input | Canonically signed human authorization: `authorizationId, decisionId, grantVersion, humanSigner, actorPrincipal, phase, branch, baseCommit/baseTree, requirements/design/plan approved chain R'/D'/P' blob+raw digests, pinned upstream, precise allowlisted path/hunk/change class/command/environment, negative prohibitions, issuedAt, notBefore, expiresAt (max 14 calendar days), revocation source, recorderId, recorderTrustRoot, monitorPolicyHash, isolationPolicyHash`. IAB does **not** mean the post-edit source tree hash is frozen during legitimate development. |
| `AMIO`, `outputRevisionId` | mutable within signed scope | The complete observed before/after workspace state of sequential authorized writes and allowed temp outputs. A legitimate edit must not change baselineId or enlarge its own scope. |
| `operationId`, `operationProofId` | unique reservation and independent commit/abort history | Unique phase-bound operation, prospective preflight decision, stage and exact accepted after-state; must be produced by a non-actor-controlled enforcement boundary. |
| `EAF`, `artifactId` | fixed per evidence run | SHA-256 over canonical, versioned path/mode/symlink/full resolved source & import closure, `package.json`, `bun.lock`, dependency resolution/integrity, exact upstream pins, compiler/Bun executable hashes/flags/cwd, emitted JS closure, test vectors/negative controls/mutants, verification/isolation profile and specification version. Unknown required inputs yield `UNKNOWN`, never a fallback digest. |
| `B1 attestationId`, `reattestId` | immutable signed result | Evidence `PASS_FOR(EAF_x)` for exactly its examined bytes/profile. Evidence is historical truth, not edit/run authorization. `PASS_FOR(EAF_old)` ≠ `PASS_FOR(EAF_new)`. |
| `phaseCompletionId`, `freezeId` | immutable independent seal | Phase closed at last accepted sealed operation sequence and exact final complete output root; freeze seals complete final source+package+lock+emitted JS graph for independent reattestation. |
| `HSA` / active grant | mutable status, immutable signed scope | `NOT_AUTHORIZED`, `ACTIVE`, `EXPIRED`, `CLOSED`, `REVOKED`, `SUSPENDED`, `UNKNOWN/BLOCKED`; phase/actor/branch/expiry/revocation must be independently verifiable. A completed historical grant is not a live grant. |

**Adversary assumption:** An implementation actor, AI agent, or compromised tool may edit any files it can write, backdate its clock, synthesize or omit ledger records, rebuild an entire hash chain, replay old signatures, reorder events, change branch/worktree, race a guard, alter config/lock/symlinks, and attempt direct shell/background/network/process writes. Its own timestamp, local git history, local hash chain, or self-signed report is **not trustworthy**. The human grant signer, independent enforcement operator, verifier, trust root, monotonic sequencer, independent sealed storage, revocation authority, and attested clock must be outside the actor's modification/control boundary. No assertion is made that such infrastructure currently exists in `yohi/justice`.

**Minimal enforceable boundary / equivalence requirements (candidate):** Every tracked/mutable write and every phase command must pass through a trusted reference monitor that (i) exclusively mediates the declared isolated workspace and its build/test output paths; (ii) **prevents** direct bypass writers, external mounts, symlink escapes and unmediated background processes before any affected write can become visible (detection after public writes is insufficient); (iii) authenticates the actor, human grant signature/key chain, branch/phase/command/scope, independent revocation freshness and trusted clock before each operation; (iv) uses a provably isolated stage and serializable accept+publish that atomically binds the precondition root, actual delta, authoritative bytes and commit proof without an intermediate publicly visible uncertified state; (v) seals operation decisions/roots to independent tamper-evident storage or an equally strong verifiable trusted service that the actor cannot rewrite, omit or reorder; and (vi) emits an independently signed phase-close/freeze snapshot. An equally strong alternative **must** identify its trusted principals, reference-monitor completeness proof, storage/clock guarantees, attacker capabilities and falsification tests before use. Merely “adding a signature” to actor-controlled records does not satisfy these requirements.

**Feasibility STOP:** Verification of reference monitor completeness, actual trustworthy recorder availability, clock/revocation freshness, key custody, isolation of *all* write vectors and reconstruction from sealed history has **not been performed**. `TRUSTED_OP_BOUNDARY_PROVEN=false/UNKNOWN` ⇒ `OP_PREPARE_ALLOWED=UNKNOWN/BLOCKED`, no source operation may start/continue, `PHASE_COMPLETE=BLOCKED`, and no HSA may be treated as operationally usable. This proposal cannot certify those capabilities. A missing trustworthy monitor is **not** cured by human permission alone.

**R11 retained two-phase type constraints (R9 unchanged; originally corrected in R8):** `START_ADMISSIBLE` is a pre-write, prospective decision; `OP_PREPARED` is a durable, independent *reservation* plus a private staging capability; `OP_COMMIT_ACCEPTED` is a post-diff, independently attested atomic decision jointly binding actual authoritative bytes to its sealed record; `OP_ABORTED` is a terminal non-acceptance event. Neither a human IAB/HSA nor a signed `OP_PREPARED` claims a committed delta. A reference monitor has to mediate **all** active output paths and externally visible effects or return STOP before starting; author-owned material is never a substitute for an independently verifiable record. These guarantees remain `UNPROVEN` in the fixed environment.

## 2. Two-phase isolated operation protocol — typed prospective vs retrospective predicates (FI-001)

### 2.1 Canonical event schema and trust roots

The following is a **conditional unimplemented contract**, not a claim that the existing Justice/Senpi tool harness supplies it. `IAB` has immutable signing roots and scope; `AMIO` is the latest accepted, full authoritative output state; `EAF` identifies only the exact separately checked artifact. A grant is neither an evidence report nor a transaction commit. The independent monitor, isolation enforcer, monotonic clock, independent signing/recorder and revocation authority must be outside the actor's privilege boundary and individually identified and attested. Loss of any proof is `UNKNOWN/BLOCKED+STOP` (not automatically `REVOKED`).

```text
PreflightSeal = { schemaVersion, preflightId, opId, authorizationId, baselineId,
  grantVersion, actorPrincipal, monitorIdentity, independentRecorderIdentity,
  phase, attemptIndex, branch, commandDigest, normalizedArgsDigest,
  signedScopeId, monitorPolicyHash, isolationPolicyHash, stageId,
  authoritativeBeforeRevision, beforeFullRoot, beforeProtectedRoot,
  trustedPreflightTime, revocationEpochAndFreshness, reservedSequence,
  predecessorAcceptedSealId, independentSignedPrepareReceipt }
CandidateSeal = { opId, stageId, stagedAfterFullRoot, stagedAfterProtectedRoot,
  canonicalActualChangedPathsModesSymlinksHunks, measuredSideEffects,
  commitCheckTime, validatedBeforeRoot, revocationEpochAndFreshness,
  reservationAndSequence, independentCommitCandidateSignature }
AcceptPublishSeal = { schemaVersion, opId, stageId, authorizationId, phase,
  attemptIndex, branch, beforeFullRoot, afterFullRoot, outputRevisionId,
  exactDeltaDigest, trustedCommitTime, monotonicSequence,
  independentAtomicTransactionId, authoritativeBytesRootAtLinearization,
  independentDurableAcceptedRecord, externalReceiptOrAtomicEquivalentProof }
AbortSeal = { opId, stageId, reservedSequence, reason, independentAbortSeal,
  beforeFullRootPreserved, noExternallyVisibleEffectsProof, trustedAbortTime }
PhaseSeal = { authorizationId, phase, attemptIndex, lastAcceptedSequence,
  allReservedIdsResolvedAcceptedOrIndependentlyAborted, acceptedOpSealSetDigest,
  finalFullRoot, finalProtectedRoot, trustedCloseTime,
  independentVerifierSignature, independentlyReconstructibleSealedHistory }
FreezeSeal = { dependencyPhaseSealId, hostPrepPhaseSealId, attemptIndex,
  exactFinalArtifactId, fullSourcePackageLockCompilerJSAndProfileManifestRoot,
  trustedFreezeTime, phaseFenceNoWritesSeal, independentSignature }
```

An `OP_PREPARED` **cannot** include any unknown future `afterRoot`, actual post-operation diff, trusted commit time, signed accepted-receipt, or post-write result as a prerequisite. `CandidateSeal` is not an accepted or publicly committed event. An actor-signed ledger, local filesystem snapshot, claimed time, or local hash-chain rewrite cannot elevate either seal.

### 2.2 Machine-checkable prospective and retrospective contracts

```text
TRUSTED_OP_BOUNDARY_PROVEN := independently_audited_complete_mediation
    AND actor_cannot_control_monitor_clock_keys_revocation_recorder_history
    AND independent_actor_identity_and_trust_chain_and_fresh_revocation
    AND durable_monotonic_unique_opId_sequence_reservation
    AND trusted_current_preRoot_with_exclusive_writer_fence
    AND staged_private_changes_no_public_or_irreversible_side_effects
    AND independently_proven_serializable_atomic_accept_and_publish
    AND crash_recovery_can_reconstruct_pending_accepted_aborted_without_gaps

GRANT_VALID_AT(g,t,actor,phase,branch,cmd) := verified_signed_human_IAB_HSA
    AND canonical_Rp_Dp_Pp_adopted AND independent_normative_review_proven
    AND exact_phase_actor_branch_command_args_and_signed_hunk_scope(g)
    AND trusted_notBefore(g) <= t < trusted_expiresAt(g)
    AND independent_revocation_fresh_at(t)==NOT_REVOKED
    AND phase_open_at(t) AND no_proven_unresolved_safety_violation

OP_PREPARE_ALLOWED(g,opIntent,beforeState): START_ADMISSIBLE | DENIED | UNKNOWN
  := if NOT TRUSTED_OP_BOUNDARY_PROVEN then UNKNOWN
     else if NOT GRANT_VALID_AT(g,trusted_preflight_now(), actor,phase,branch,command)
          then DENIED/UNKNOWN according_to_verified_reason
     else if NOT exact_preRoot_equals_trusted_authoritative_snapshot(beforeState)
          or NOT exclusive_writer_fence_or_phase_epoch_or_scope_reservation
          or NOT permitted_isolated_stage_and_no_side_effects
          or NOT exact_command_and_negative_prohibitions_prevalidated
          or NOT trusted_unique_opId_and_sequence_reserved
          or NOT independent_preflight_recorder_can_durably_prepare_before_stage
          then UNKNOWN/BLOCKED_or_DENIED
     else START_ADMISSIBLE

OP_PREPARED(opId,phase,preflightSeal,stageId,preRoot,...): PREPARED
    iff OP_PREPARE_ALLOWED==START_ADMISSIBLE
    AND stage_private_nonpublic_unforgeable_and_bound_to_opId
    AND independently_durable_preflight_and_unique_sequence_reservation
    AND no_write_has_crossed_authoritative_or_external_visibility_boundary

OP_COMMIT_ACCEPTED(opId,stagedAfter,...): ACCEPTED | REJECTED | UNKNOWN
    requires PREPARED AND independently_trusted_commit_time
    AND GRANT_VALID_AT(g,actual_trusted_commit_time,actor,phase,branch,command)
    AND fresh_revoke_and_lease_verified_at_linearization
    AND beforeRoot == current_trusted_authoritative_root_at_commit
    AND exclusive_writer_fence_and_phase_open_at_commit
    AND actual_staged_full_root_integrity_and_exact_diff
    AND actual_changed_paths_hunks_modes_symlinks_within_signed_scope
    AND no prohibited protected changes, pin drift, writer escape, side effect
    AND continuous unique sequence, predecessor and stage/op identity
    AND independent complete CandidateSeal_and_signed_commit_proof
    AND *one proven linearizable durable atomic ACCEPT+PUBLISH*
        binding (authoritative bytes, afterFullRoot, acceptedRecord, opId, seq)
    AND externally independently verifiable receipt or formally equivalent
        proof inseparable from the same authoritative atomic transition
    # No result ACCEPTED may exist for absent authoritative bytes;
    # no authoritative bytes may become visible without its accepted proof.

OP_ABORTED(opId,reason,...): ABORTED
    iff verified_no_public_or_irreversible_mutation_and_isolated_stage_destroyed
    AND independent durable abort tombstone resolving the reserved sequence
    AND no restoration of human grant or evidence from a failed operation

ACCEPTED_DELTA(opId): historical sealed accepted operation only
    iff durable OP_COMMIT_ACCEPTED(opId)==ACCEPTED
    AND independently recovered complete authoritative state/root/sequence
    AND trusted preflight/commit times and scope valid at their own instants
    AND no later proven tamper that invalidates the accepted history

B0_PREPARE_ALLOWED(g,intent,state): START_ADMISSIBLE
    := phase(g)==B0 AND phase_epoch_open AND OP_PREPARE_ALLOWED(g,intent,state)
B0_EDIT_ACCEPTED(g,opId): historical ACCEPTED_DELTA
    := phase(g)==B0 AND ACCEPTED_DELTA(opId)
DEP_PREPARE_ALLOWED(g,intent,state): START_ADMISSIBLE
    := valid_independent_DEP_STARTED_latch AND phase(g)==B2_DEP
       AND only_permitted_dependency_intent AND no_host_execution
       AND OP_PREPARE_ALLOWED(g,intent,state)
DEP_EDIT_ACCEPTED(g,opId): historical ACCEPTED_DELTA
    := valid_independent_DEP_STARTED_latch AND phase(g)==B2_DEP
       AND ACCEPTED_DELTA(opId)
HOST_PREPARE_ALLOWED(g,intent,state): START_ADMISSIBLE
    := DEP_COMPLETE AND phase(g)==B2_HOST_PREP
       AND independently_valid_separate_human_PREP_HSA
       AND no_host_execution_or_root_export_registration
       AND OP_PREPARE_ALLOWED(g,intent,state)
HOST_PREP_EDIT_ACCEPTED(g,opId): historical ACCEPTED_DELTA
    := phase(g)==B2_HOST_PREP AND ACCEPTED_DELTA(opId)

PHASE_COMPLETE(g,p): sealed historical phase completion
    iff phase_closed_and_fenced_against_new_ops_before_final_snapshot
    AND independently_authenticated_PhaseSeal(p,g)
    AND EVERY reserved opId/sequence terminal: ACCEPTED or independently ABORTED
    AND all ACCEPTED_DELTA operations valid at THEIR trusted op times
    AND all ABORTED records carry no accepted delta nor unmediated effects
    AND no UNKNOWN/IN_DOUBT/pending/unreconstructible operation
    AND p.finalFullRoot == trusted_complete_authoritative_final_snapshot
    AND finalProtectedRoot_and_scope_consistency_verified
    AND no post-close edits silently ascribed to closed phase

EAF(state,profile) := SHA256(versioned_complete_canonical_artifact_manifest)
B1_PASS_FOR(a) := verified_independent_B1_attestation_id_and_signature
    AND attestation.artifactId==a AND exact_signed_profile_complete
    AND actual_emitted_compiled_JS_N1_N4_P1_P2_positive_and_negative_controls
    AND source_import_compiler_lock_graph_hash_identity_and_mutant_detection
    AND no_skipped_required_checks_and_verified_isolation
B1_APPLICABLE_NOW(EAF_0) := B1_PASS_FOR(EAF_0)
    AND EAF(actual_trusted_current_artifact,B1_profile)==EAF_0
    AND verified_full_signed_manifest_byte_identity
# The source/package/lock/root comparison for DEP_START must use the exact
# canonical signed EAF0 manifest projection, not an invented actor hash.
CURRENT_APPLICABILITY(report,current,profile) :=
     signed_PASS_FOR(report.exact_EAF) AND report.exact_EAF==EAF(current,profile)
     AND unchanged_profile_resolution_inputs_and_complete_graph
```

`START_ADMISSIBLE` is a **permission to create a private stage only**, not to modify a shared source worktree, a provider, a network, a process outside the isolation, or host state. There is **no** `B0_EDIT_ALLOWED`/`DEP_OPERATION_ALLOWED`/`ALLOWED_DELTA_AT_OP_TIME` mixed-type write-admission predicate in the historical R8 contract (retained in R9 and this R11 proposal). When the older names appear in history they are non-operative; new actions call `*_PREPARE_ALLOWED` while retrospective acceptance uses `*_EDIT_ACCEPTED`/`ACCEPTED_DELTA`.

### 2.3 Exactly one atomic acceptance/publication boundary

Happens-before constraints, verified by the future independent monitor:

```text
SIGNED HUMAN IAB/HSA + TRUST ROOT/REVOCATION/ATOMIC CAPABILITY PROOFS
  → PREPARE_CHECK(beforeRoot,t_pre) → durable signed OP_PREPARED(opId,seq,stageId)
  → STAGE (private, no external effects) → sealed CandidateSeal/COMMIT_CHECK(t_commit)
  → [ONE TRUSTED SERIALIZABLE ATOMIC ACCEPT+PUBLISH LINEARIZATION POINT]
      simultaneously: durable accepted record + authoritative bytes + root + seq
  → OP_COMMIT_ACCEPTED / ACCEPTED_DELTA / subsequent operation may observe it
OR
  → OP_ABORTED (durable abort tombstone, no public effect)
OR
  → IN_DOUBT → QUARANTINE/STOP (never implicit accepted or silently dropped)
```

A mere external recorder ACK **before** publishing bytes is only a PREPARE/candidate receipt, not an `ACCEPTED` record. Publishing bytes **before** proof is durable violates the invariant. A separate append receipt arriving eventually after a visible public commit is insufficient. Unless a single trusted transactional coordinator, write-ahead evidence with cryptographic publication fencing, or independently reviewed formally equivalent mechanism proves the two facts are inseparable across crashes and concurrency, `TRUSTED_OP_BOUNDARY_PROVEN=false` and `STOP BEFORE PREPARE`. Post-failure best-effort rollback does not repair a visible unauthorized effect. The atomic publish/receipt mechanism must state exactly where **commit linearization** occurs, which durable evidence binds it, and how third-party readers are fenced. No claimed external signature constitutes a commit if bytes are absent.

**Writer universe and side effects:** include direct shell, parallel sessions, child/grandchild/background processes, alternate worktrees or branches, symlinks, hardlinks, mount/namespace exits, temporary/build/install outputs, dependency managers, CI/hooks, network calls, host/provider/tool effects, writes to other hosts and later asynchronous effects. For an externally irreversible effect without enforceable staging and commit, prohibit the action altogether. Observing a bypass **after** it happens is not prevention; known bypass→`REVOKED+STOP` and incident quarantine; unmeasurable writer boundary→`UNKNOWN/BLOCKED+STOP` *before* any affected operation.

**Lease race:** HSA and independent revocation freshness must be rechecked at the commit linearization point. If it expires/revokes between prepare and commit, stage aborts without authoritative mutation. A later signed grant cannot retroactively authorize an old stage. If `beforeRoot` changes or current phase/attempt/root differs, reject stage and require new PREPARE on actual current accepted state, never reuse an old result.

**Crash/recovery:** reconstruct accepted commits and abort tombstones from independent durable journal and authoritative byte roots under the writer fence before further work. Crash before the atomic point resolves via ABORT if independent no-effect proof is possible; crash after atomically accepted state is revalidated against exactly one durable commit/root. Ambiguous mid-transition or recorder partition creates `IN_DOUBT`, quarantines potentially affected bytes and external outputs from all consumers, and stops all new phase actions/phase close/RA/HOST until independent resolution. Missing seq cannot be omitted. If quarantine is impossible, *do not attempt operation*. Distinguish lacking proof `UNKNOWN/BLOCKED` from proved unauthorized side effect `REVOKED`. A genuine verified scope/safety breach requires revocation even if actor ledger claims success.

**Orthogonal transition invariants:** immutable `IAB` and authorizationId do not change on accepted allowed edits; `AMIO` and `outputRevisionId` advance monotonically for accepted deltas; evidence `EAF_old` remains historical but current applicability is false for changed inputs; current grant may remain ACTIVE if phase/scope/time and integrity allow; ACTIVE never means evidence PASS. Freeze forbids *all* current-attempt writes. A later legitimate edit requires terminating/fencing the frozen attempt, invalidating freeze/RA/exact activation *before PREPARE*, opening a new strictly higher `attemptIndex` and obtaining distinct reviewed/human scoped authorization where required. Historical seals remain immutable and cannot be repurposed for the new attempt.

## 3. B2-DEP first-operation latch; B1/RA/ACTIVATE and HOST boundaries

`DEP_START_REQUEST` checks the historical exact independently signed `B1_PASS_FOR(EAF_0)` and `B1_APPLICABLE_NOW(EAF_0)` **once**, before even staging the first dependency change. It also requires read-only preflight, independent DEP human HSA, a verified real `beforeFullRoot`, and an immutable externally signed `DEP_STARTED` latch/sequence predecessor. The latch is NOT a post-edit permission and cannot be manufactured by the actor after a change. The `DEP_START_REQUEST` guard is evaluated **before** the independent latch is written; it checks the capability to durably seal, but never refers to a future `DEP_STARTED` result. Only after successful independent `DEP_STARTED` sealing may `DEP_PREPARE_ALLOWED` be evaluated. This avoids hidden self-dependency at the latch-creation boundary.

```text
DEP_START_REQUEST(g): boolean | UNKNOWN
  := phase(g)==B2_DEP AND B1_APPLICABLE_NOW(EAF_0)
     AND signed_B1_PASS_FOR(EAF_0)_attestationId_and_profile_exact
     AND independent_readonly_static_preflight_PASS
     AND independent_DEP_HSA_and_trusted_monitor_proven
     AND independent_current_source_package_lock_root_matches_exact_signed_EAF0_manifest_projection
     AND independent_latch_recorder_available_and_start_sequence_reserved
DEP_STARTED := signedImmutable(depStartId, authId, baselineId, phase, attempt,
     EAF_0, B1_attestationId, preflightId, beforeRoot,
     trustedStartTime, beforeFirstWriteSequence, independentExternalReceipt)
# For first and subsequent legal DEP operations:
DEP_PREPARE_ALLOWED(g,intent,state) :=
     DEP_STARTED valid AND scope/current grant/phase valid
     AND OP_PREPARE_ALLOWED(g,intent,state)
DEP_EDIT_ACCEPTED(g,opId) := accepted and scoped OP_COMMIT_ACCEPTED
# NO B1_APPLICABLE_NOW condition on DEP continuation.
DEP_COMPLETE := DEP_STARTED valid AND PHASE_COMPLETE(B2_DEP)
     AND exact_devDependency+minimal_lock_hunks_and_type_integrity_proven
     AND no_exports_scripts_unrelated_dependency_pin_drift
     AND sealed_complete_outputRoot matches authoritative DEP final root
HOST_PREP_COMPLETE := PHASE_COMPLETE(B2_HOST_PREP)
     AND test_only_source_hunks_only AND proven_no_host_execution
FINAL_FROZEN := DEP_COMPLETE AND HOST_PREP_COMPLETE AND no_pending_operations
     AND independent_final_EAF_full_manifest_and_freeze_phase_fence
RA_PASS_FOR(EAF_final) := FINAL_FROZEN AND independent_readonly_verifier
     AND actually_recompiled_emitted_JS_N1_N4_P1_P2_and_negative_mutants
     AND complete_source_compiler_lock_types_import_graph_parity
     AND independently_signed_exact_EAF_final_report
     AND isolated_no_install_no_tracked_mutation
HUMAN_HOST_ACTIVATE_VALID := separately_authenticated_human_HSA
     AND exact_signed_EAF_final+RA_id+phase+scope+time+revocation_freshness
# FI-004: prospective permission to start an isolated trial; never a positive R/I fact.
HOST_RUN_START_ADMISSIBLE := HUMAN_HOST_ACTIVATE_VALID
     AND RA_PASS_FOR(current_EAF_final) AND freeze_fence_still_closed
     AND INDEPENDENT_HOST_SOURCE_CAPABILITY_PROVEN
     AND independently_attested_complete_ingress_mediation_before_first_event
     AND prevent_external_effects_before_run AND test_only_isolation_proven
     AND runtime_monitor_trusted_and_fresh_at_every_effect_boundary
# Only a compatibility name for START, not for accepting a result.
HOST_RUN_ALLOWED := HOST_RUN_START_ADMISSIBLE
# Actual per-result proof comes into existence only AFTER trusted observation.
HOST_EVENT_INGRESS_ADMISSIBLE(event) := HOST_RUN_START_ADMISSIBLE_current
     AND independently_owned_nonforgeable_ingress_registration_for_this_source
     AND event_not_trusted_from_callId_or_current_context_alone
     AND source_instance_attempt_session_binding_unambiguous_at_ingress
     AND independent_monitor_authorizes_processing_before_any_authority_effect
HOST_RESULT_ORIGIN_VERIFIED(result, source, generation, callId, attempt) :=
     actual_public_result_observed_by_independent_recorder
     AND HOST_EVENT_INGRESS_ADMISSIBLE(result)
     AND immutable_origin_matches_pre_registered_live_source_incarnation
     AND no_G1_G2_same_callId_cross_association_or_replay
     AND observed_order_and_invalidation_epoch_independently_joined
HOST_RUN_EVIDENCE_ACCEPTED := independently_signed_actual_host_observations
     AND all_relied_upon_results_have_HOST_RESULT_ORIGIN_VERIFIED
     AND scoped_HOST_RUN_positive_and_negative_controls_were_actually_observed
     AND independently_verifiable_role_session_callId_order_join_for_evidence_submission
     # does NOT require full Task1 evaluator PASS before H3
```

Historical `B1_PASS(EAF_0)` is retained after the first `bun.lock` update, not applied to `EAF_1`. A second or third legal DEP edit uses the current accepted AMIO root, active **independent DEP grant** and prospective OP_PREPARE, without asking for current B1 again; each has its own atomic accepted commitment. If HSA expires/revokes, STOP before new PREPARE or commit. B1 formal submitted FAIL still enforces `B0_REVOKED`; RA FAIL without a proven safety violation leaves historical authorization status orthogonal but denies HOST.

**FI-004 non-circular host-run rule:** `INDEPENDENT_HOST_SOURCE_CAPABILITY_PROVEN` is *prospective* proof of the ability to bind every subsequent ingress/result to its real immutable source, independently of a duplicated `callId`, current generation context, caller-supplied `originProof` or modeled `P`. It must be independently auditable against the **fixed** Senpi public API/source, complete lifecycle ownership, actual callback ingress topology, stable registration/fencing and isolation enforcer **before first execution**. It is **not** the later observation that any particular result actually came from `G1`/`G2`; it grants no Task1 `R`, production `I`, acceptance, receipt or state restoration. A signed human HSA/RA PASS, source review alone without proven complete ingress mediation, actor-invented private table, local contextual lookup or assumed new Senpi field is insufficient.

**Per-event barrier:** each real callback/result must be captured by the independently trusted ingress **before** any authority/issuance, transcript append/receipt or external effect; stale/unknown/ambiguous-origin results are rejected with `NO_ISSUANCE`, no trusted provenance and no reuse as successful evidence. Cancellation, restart, error and G1/G2 reuse must not change a prior origin by recomputing from current context. The host observer independently records actual source, generation/incarnation, attempt, ordering, session, result and rejection and seals its raw evidence; only this retrospective event-by-event proof can establish `HOST_RESULT_ORIGIN_VERIFIED` and contribute to actual Task1 `R`. Runtime evidence absent, merely denied, never delivered or simulated stays **NOT_RUNTIME_PROVEN**. `HOST_RUN_EVIDENCE_ACCEPTED` depends on actual host-run-scoped positive/negative controls and exact provenance/session/identity, not on a future whole Task1 evaluator PASS. Other canonical Task1 inputs remain separately assessed; H3 cannot itself issue Task1 PASS.

**Mandatory fail-closed fallback:** fixed Senpi public API/source ingress capability and nonforgeability are **NOT_PROVEN**, and actual G1/G2 results are **NOT_RUNTIME_PROVEN**. If pre-run complete binding cannot be proved, `HOST_RUN_START_ADMISSIBLE=UNKNOWN/BLOCKED`: **NO HOST RUN**, no observability experiment that may cause host effects, independently investigate a separate **no-effect evidence route** only after distinct human authorization and proof of non-effect isolation, or refer Option C to the Architecture Owner. That route, if proposed, needs named monitor/principal, input/output/clock/source lifecycle, negative controls, failure STOP and fresh independent review **before** any execution; it may not silently bypass phase/HSA or substitute a new unpinned API. If no such route can be proved, Option C / STOP is the explicit disposition. Any ambiguity at real ingress is STOP for that event and prevents R/I/receipt/evidence credit; an independently established actual violation applies the existing REVOKED rule. The complete no-bypass monitor/atomic accepted-publish obligation from §§1–2 remains unchanged. Actual Task1 `R`, compiled `P`, later production `I` are non-substitutable and do not add new evaluator inputs.

### 3.1 FI-004 host execution temporal types and negative traces (R11 candidate)

| Time | Typed evidence | What it MAY permit | What it CANNOT prove |
|---|---|---|---|
| H0 before start | `INDEPENDENT_HOST_SOURCE_CAPABILITY_PROVEN` + current HSA/RA/freeze/monitor/isolation | `HOST_RUN_START_ADMISSIBLE`: one confined test-only host execution | No actual origin of any future result, no Task1 `R`, no production `I` |
| H1 at callback ingress | nonforgeable independent ingress witness bound to immutable real source/attempt, prior to consuming event | `HOST_EVENT_INGRESS_ADMISSIBLE(event)` for precisely that event | No assertion that an unobserved future read completed |
| H2 after real result | independently observed exact source/generation/callId/order and rejection semantics | `HOST_RESULT_ORIGIN_VERIFIED(result,...)` only for that result | No implication for other calls/generations or all INV controls |
| H3 after complete evidence | independent sealed replay-safe trace, scoped positive and negative actual host conditions, role/session/result identity join for later evaluator submission (NOT evaluator PASS) | `HOST_RUN_EVIDENCE_ACCEPTED` (submission material) | Never itself Task1 Gate PASS / product enable / HSA |

Attack G1 `read(X)` → restart → G2 `read(X)` → G1 late `tool_result(X)`: the host binding MUST identify G1 at H1/H2, regardless of G2's current context and duplicate `callId`. If G1 cannot be cryptographically/structurally distinguished on the fixed public ingress, reject result and STOP acceptance. Claiming successful old-result *rejection* requires an **actual delivered** result with proven G1 origin, not only a synthetic result, a missing result or a guessed `generation` on `ToolResultEventBase`. Unverified input must be rejected *before* changing authority, issuing capability, persisting token-bearing data, signing a receipt, or creating evidence. An actual uncontrolled external effect is a breach, not a successful diagnostic.

**No implicit diagnostic privilege:** `HOST_RUN_START_ADMISSIBLE` is unavailable while H0 proof is unknown. A separate prior source/capability investigation can be read-only. Any live no-effect diagnostic would be a new independently reviewed scope and human-authorized route with a separate trust/monitor/no-effects proof before the diagnostic, not the already-blocked `B2-HOST-RUN` renamed. No implementable bounded route on fixed pins ⇒ human Option C decision required.

## 4. Orthogonal grant/evidence/attempt and operation-state transitions

| Trigger / independent proof | Grant status | Evidence applicability | Operation stage / outcome | Next permitted action and STOP |
|---|---|---|---|---|
| Valid signed IAB/HSA but monitor/atomicity not proved | `UNKNOWN/BLOCKED` operationally | unchanged / historical | `UNAVAILABLE` | Read-only feasibility; **NO PREPARE**, STOP |
| Fresh in-scope prepare, isolation/sequence proved | `ACTIVE` for scoped phase | unchanged | `START_ADMISSIBLE`→`PREPARED` | Private stage only; no public bytes/external effects |
| Stage violates path/hunk/negative list, before publication | `ACTIVE` unless actual breach independently proven | current evidence unaffected | `REJECTED`→`ABORTED` if no effect proved | Log independent tombstone; correct with new PREPARE |
| Trusted atomic accept+publish of verified scoped stage | May remain `ACTIVE` if unexpired/current | prior exact EAF becomes HIST if changed | `OP_COMMIT_ACCEPTED`/`ACCEPTED_DELTA` | Next operation must use accepted root and fresh preflight |
| Expiry/revocation while stage private | `EXPIRED` or proven `REVOKED` | old EAF historical | `ABORTED` with no visible bytes | Separate new grant/attempt as required; no retroactive commit |
| Recorder down / split atomic outcome / crash uncertain | `UNKNOWN/BLOCKED` pending proof | `UNKNOWN` for affected state | `IN_DOUBT` | QUARANTINE/STOP; no phase close or host |
| Independently proved unmediated/forbidden actual effect | `REVOKED` | `UNTRUSTED` for affected state | `VIOLATION` | STOP/incident review; no automatic regrant |
| Valid sealed phase close before later grant expiry | `CLOSED`, later `EXPIRED` | HIST valid only for sealed EAF | `PHASE_COMPLETE` | New phase needs separate current signed authorization |
| B1 signed PASS followed by legitimate guard/DEP source edit | Grant may stay ACTIVE only if new attempt or correct open phase | `PASS_FOR(EAF_old)` HIST, new EAF EI | independent accepted edit | Rebuild/retest exact EAF; no old PASS substitution |
| Freeze/RA signed on current EAF; no changes | phase source-edit grants CLOSED | current only if exact EAF unchanged | frozen/no pending stage | Read-only RA, then separate exact human ACTIVATE |
| Frozen source needs lawful new edit | previous attempt CLOSED/fenced | old freeze/RA/ACTIVATE invalid for new attempt | new attempt/new HSA→PREPARE | STOP HOST until fresh freeze+RA+ACTIVATE |
| B1 formal submitted FAIL versus RA FAIL | B1=`B0_REVOKED`; RA failure not automatic grant revoke | FAILED | no next HOST | Maintain formal B1 fail rule separately |

`UNKNOWN/BLOCKED` means a missing proof or unresolved state; `REVOKED` requires independently verified actual scope/safety/forgery/bypass violation, except specifically prescribed formal B1 failure revocation. Do not turn a missing recorder or delayed external receipt into a fictitious committed operation. An `ABORTED` reservation is included in the continuous sequence but **never** treated as an accepted delta. A `CLOSED`/`EXPIRED` historical grant cannot initiate a new operation; evidence applicability is independently determined by current EAF.

## 5. R7→R8→R9→R10→R11 stable-ID 38-to-38 adversarial state-transition truth table (hypothetical only)

**Stable mapping:** R7 §5 IDs `01..38` → identical R11 IDs `01..38`, no omission, split or merger. Columns are independent: actual operation stage, grant status, evidence applicability, next permitted action, separate human decision, fail-closed outcome, and falsifiable independent proof obligation. Each row assumes a *future* trusted monitor only when explicitly stated; **today every future write/run is NOT_AUTHORIZED**. This R11 proposal's sole current candidate matrix is this file; R6/R7 are **historical non-normative references**. `PREPARED` never means an accepted/public write. `ABORTED` needs independent no-side-effect proof; otherwise `IN_DOUBT` and STOP.

| Stable ID and input (R7→R8→R9→R10→R11) | Operation stage / transition | Grant status | Evidence applicability | Next permitted action | Human decision | Fail-closed result | Proof obligation / counterexample |
|---|---|---|---|---|---|---|---|
| 01 B0 first allowed edit (per-op pre+commit) | PREPARE→PRIVATE_STAGE→ATOMIC_ACCEPT | ACTIVE only with current IAB + proven monitor | Initial EAF not B1 PASS | Stage then accepted B0 delta; next op requires new PREPARE | Existing separate B0 HSA | BLOCKED before stage if trust missing; abort if commit denies | First B0 edit must not require afterRoot at PREPARE. Show real durable pre-seal and atomic bytes+accepted record. |
| 02 B0 2nd and 3rd allowed edits, unchanged IAB | NEW PREPARE/COMMIT for each op | Same immutable IAB; live scope/grant only | prior EAF historical if changed | 2nd and 3rd operations use latest *accepted* AMIO root, never old stage | No extra HSA if active and still scoped | Any unsealed/gapped op→UNKNOWN/BLOCKED; no self REVOKE | For each op fresh revocation, exclusive fence, unique seq; legal changes preserve IAB. |
| 03 B0 path outside allowlist demonstrably committed | STAGE REJECT→ABORT (or proven bypass) | ACTIVE if prevented before visibility; REVOKED if actual unauthorized effect | Historical untouched on clean abort; affected current UNTRUSTED if bypass | Reject staged out-of-scope path and independently tombstone; if bypass isolate | New reviewed scope if resubmission needed | Clean ABORT no revoke; actual public bypass REVOKED+STOP | Distinct out-of-scope stage rejected pre-publication versus independently proved public breach. |
| 04 B0 prohibited package/lock edit | STAGE REJECT→ABORT or proven unauthorized WRITE | ACTIVE if only private rejected stage; REVOKED on public forbidden change | Past evidence unaffected on clean abort | Do not publish package/lock, stop for demonstrated bypass | New reviewed scope/HSA for attempted expansion | Proven breach REVOKED; missing containment UNKNOWN | Verify protected package/lock cannot become public under B0, not merely logged. |
| 05 Authorized B0 write before trusted expiry (commit < expiry) | PREPARE+COMMIT before trusted expiry | ACTIVE until expiry, subsequently EXPIRED | Historical complete acceptance valid for its exact EAF | Commit only while grant live, then phase history; future ops need freshness | No new human if operations before expiry | Expiry-after-accept does not erase historical event | Independent t_pre,t_commit are both pre-expiry with same sealed accepted root. |
| 06 B0 write starts before expiry but commits after expiry | PREPARED before expiry→COMMIT_CHECK after expiry→ABORT | EXPIRED, or REVOKED only if bypass proven | HIST only; no accepted new delta | No publication, sealed abort, fenced resume only after new authorization | New grant/attempt as needed | UNKNOWN/BLOCKED if side effect isolation unproved; REVOKED if actual bypass proved | The t_commit recheck fails; no partial authoritative bytes or delayed post-seal accept. |
| 07 Write after expiry with backdated actor timestamp | DENY_PREPARE / forensic on forged timestamp | EXPIRED; REVOKED if actual forged bypass verified | UNKNOWN for tainted state | No commit inferred from actor time; independent audit | Fresh human authority cannot retroauthorize | UNKNOWN/BLOCKED on missing seal; proven fraud REVOKED | Independent monotonic time/epoch defeats retroactive local timestamp. |
| 08 Actor controls ledger and reconstructs earlier hash chain | TRUST FAILURE BEFORE PREPARE | UNKNOWN/BLOCKED | UNKNOWN | No source edits; re-establish external chain | Independent monitor owner | STOP, not automatic REVOKED | Actor ledger hash-chain may be fully reconstructed; require external immutable root/signing key custody. |
| 09 Missing/reordered/deleted operation record | UNRESOLVED_SEQ / FORENSIC | UNKNOWN/BLOCKED; REVOKED if verified deliberate tamper | UNKNOWN | No phase close; reconstruct all accepted/aborted reservations | Independent investigator | STOP until gap-free durable history | Abort tombstones consume sequences; no silent dropped failed operation. |
| 10 Actor forged signature / recorder absent | PREPARE denied / signed proof validation | UNKNOWN/BLOCKED or proven REVOKED | UNKNOWN/UNTRUSTED | Independent trust-root forensic; no stage | Independent signer/operator | STOP | Verify signatures against pinned independent root; distinguish missing recorder from proved forgery. |
| 11 Phase seal output differs from final full root | PHASE_CLOSE DENIED | CLOSED not established; UNKNOWN/BLOCKED pending | UNKNOWN for current; old HIST if independently verified | Reconcile sealed accepted root vs actual full root without mutable actor repairs | Owner only for new changes | STOP; proven bypass REVOCATION separately | Phase seal may never hide mismatched actual authoritative root or in-doubt commit. |
| 12 Grant expires AFTER valid sealed phase close | HISTORICAL PHASE_COMPLETE | CLOSED/EXPIRED | HIST only for sealed exact EAF | Read-only audit; next phase uses fresh HSA | Human next phase | STOP new old-grant operation | All t_commit seals verifiably before previous expiry and gaps absent. |
| 13 B1 PASS(EAF0), no artifact change | B1 PASS→READONLY DEP PREFLIGHT | Old phase CLOSED; no DEP grant by B1 | B1 current only EAF0 | Read-only review, submit DEP human scope and reserve latch | YES DEP HSA | NO DEP stage before human/latch | EAF_0 full compiled evidence distinct from an authorization grant. |
| 14 B1 PASS(EAF0), guard changed under valid but wrong phase after close | UNAUTHORIZED POSTCLOSE WRITE | REVOKED if effect proven | HIST old B1, current UNTRUSTED | STOP; no lifecycle repair by pretending same phase | Incident + new independent decision | REVOKED for proven bypass | Changing guard after B0 close is not a lawful B0 followup within same attempt. |
| 15 B1 PASS(EAF0), guard edited lawfully before phase closure | NEW ATTEMPT → NEW PREPARE → EDIT → B1 RE-RUN | Old attempt CLOSED; new attempt phase HSA ACTIVE only if freshly authorized | Old B1 PASS_FOR(EAF0) HIST; new EAF EI | Reopen B0 editing ONLY at attemptIndex+1 with explicit signed HSA; then new B1 | YES newly scoped HSA/new review as required | Original attempt frozen/closed; DEP_START BLOCKED until new PASS | R7 “after B1 PASS but before B0 close” is unreachable in same attempt; fix by strictly higher attempt. |
| 16 DEP_START preflight PASS+exact B1 at EAF0+latch sealed | BEFORE-FIRST-DEP-OP signed LATCH, then new PREPARE | DEP HSA ACTIVE, monitor proven | B1 PASS_FOR(EAF0) current only at latch | Durably seal DEP_STARTED before even staging first DEP operation | YES separate DEP HSA (already supplied by scenario) | No latch/recorder→UNKNOWN/BLOCKED; not a retroactive seal | DEPENDENCY start latch ≠ ACCEPTED_DELTA; beforeRoot/EAF0/preflight signature independent. |
| 17 DEP_START failed/no attestation/mismatched EAF | LATCH DENIED | DEP grant may exist but operation cannot PREPARE | UNKNOWN/EI | Read-only remediation or new B1 review | As needed | STOP before private stage | Invalid B1 EAF/readonly result cannot be coerced to true. |
| 18 First permitted DEP `bun.lock` edit EAF0→EAF1 | FIRST DEP PREPARE→STAGE→ATOMIC_ACCEPT | ACTIVE with exact DEP HSA | EAF0 B1 becomes HIST; EAF1 EI | First signed lock edit; then type/lock review or next DEP stage | No new HSA if within same scoped grant | Commit not accepted if late expiry/actual hunk mismatch | Latched at EAF0 before first write; require explicit commit for EAF1, old B1 not current. |
| 19 Second DEP edit after EAF1, live grant and new seal | SECOND DEP FRESH PREPARE→STAGE→ATOMIC_ACCEPT | ACTIVE only if current per-op grant valid | Old B1 HIST, EAF2 EI | Use previous accepted afterRoot EAF1 as next beforeRoot | No fresh HSA only if same allowed phase and attempt | No recheck B1_APPLICABLE_NOW; trust missing STOP | No cyclic old B1 current proof; unique seq and revocation/time at second commit. |
| 20 DEP write outside signed hunks or pinned version | STAGED OUT OF SCOPE→ABORT / actual public BYPASS | ACTIVE if clean abort; REVOKED on actual breach | HIST if clean abort; affected current UNTRUSTED if bypass | Reject prepublish; proven forbidden actual mutation incident STOP | Human for scope expansion | STOP; independently proven violation REVOKED | Do not revoke merely from rejected candidate hunk; public bypass is a violation. |
| 21 DEP grant expires before next proposed edit | DENY PREPARE | EXPIRED | HIST independent DEP accepted ops | No more DEP stage; new authority for more work | YES separate HSA/new attempt if close | STOP | Expiry on historical completed op does not erase seal; cannot authorize new work. |
| 22 DEP phase complete with trusted sealed root/type/lock PASS | PHASE_COMPLETE ONLY AFTER ALL TERMINAL OPS | DEP CLOSED | DEP HIST, later final RA not yet known | Read-only reconcile; apply PREP HSA | YES new PREP HSA | No host run | All reserved op IDs accepted/aborted; exact package/lock/type and final root gap-free. |
| 23 HOST-PREP legal test-only source edit, no runtime | HOST PREPARE→PRIVATE_STAGE→ATOMIC_ACCEPT | PREP HSA ACTIVE until close | New EAF EI for final candidate | Test-only exact source hunk edits and independent close, ZERO host exec | YES PREP HSA as precondition | Host execution remains forbidden during PREP | DEP completed; no actual runtime, graph/export activation or network side effect. |
| 24 HOST-PREP attempts early runtime/production export | DENY STAGE HOST/EXPORT→ABORT or proven bypass | ACTIVE on clean abort; REVOKED on proven forbidden exec | Old state unaffected if aborted; current untrusted on breach | STOP and record side effect | Independent incident/human | Proven runtime side effect REVOKED | PREP is not ACTIVATE; any allowed effect channel must be staged/prevented. |
| 25 Final freeze: roots sealed, no pending writes | DURABLE FREEZE + PHASE FENCE | PREP CLOSED | RA NOT_RUN; EAF_final fixed | Independent read-only RA only | No edit grant | STOP host until RA and ACTIVATE | No pending/IN_DOUBT stage, freeze complete source/JS/lock/profile and all writer fencing. |
| 26 Freeze absent, untrusted or mismatch | FREEZE PROOF UNKNOWN / RECONCILE | UNKNOWN/BLOCKED if trust incomplete | UNKNOWN | Read-only verification, new attempt if mutation required | As scope requires | RA and host STOP | Never claim a frozen tree while partial accepted bytes are uncertain. |
| 27 Independent RA PASS(EAF_final) exact graph | RA PASS EXACT EAF | Edit HSA CLOSED; ACTIVATE absent | RA_PASS_FOR(EAF_final) only | Request independent human exact ACTIVATE | YES ACTIVATE | Host STOP until authorization+origin | RA verifier separated, no writes or installs, compiled N1..P2 actual JS. |
| 28 Independent RA FAIL, no violation established | RA FAIL | Grant independent; RA not HSA | RA_FAILED | No host; independent read-only investigate | New HSA for source change | HOST BLOCKED not auto REVOKED | FAIL is evidence status unless a separate safety breach is proven. |
| 29 RA UNKNOWN/missing negative mutation/reviewer independence | RA UNKNOWN | No new authorization from RA | RA_UNKNOWN | Repeat truly independent read-only proof | If source change, new scope | HOST BLOCKED | Missing negative controls/reviewer independence cannot be inferred PASS. |
| 30 Legal write after final freeze / RA PASS changes EAF | FROZEN ATTEMPT FENCED→NEW ATTEMPT→PREPARE→COMMIT | Old attempt CLOSED, new HSA separate and ACTIVE only after sign-off | Old RA/EAF_final/ACTIVATE HIST; new EAF EI | Invalidate freeze/RA/ACTIVATE before any new PREPARE, then lawful scoped edit at attempt+1 | YES new scoped edit HSA/review and later ACTIVATE | NO WRITE to same frozen attempt; HOST STOP until new RA+HSA | R7 “legal write after freeze” is unreachable within same frozen attempt. New attempt strictly increases lexicographic rank. |
| 31 Human HOST-ACTIVATE absent | DENY HOST ACTIVATE/RUN | NOT_AUTHORIZED | RA could be current but not grant | Request distinct signed exact human ACTIVATE | YES | HOST STOP | RA PASS not authority. |
| 32 Human activation expired/revoked | HOST GRANT EXPIRY/REVOCATION | EXPIRED or independently proven REVOKED | RA historical/current orthogonal | Cease HOST RUN immediately | YES for future execution | STOP | Time/revocation must be checked at real host effect boundaries. |
| 33 Human activation signed for wrong artifact | ARTIFACT ID MISMATCH | Not valid for current EAF | RA current for another EAF only | No run; independent reattest and new exact activation | YES | STOP | Signatures link exact EAF/RA/phase/attempt/profile. |
| 34 Pre-run host binding capability missing/unknown (G1/G2 reused callId) | H0 PRE-RUN CAPABILITY UNKNOWN | Human ACTIVATE/RA not enough | P possible; R/I absent | **NO RUN**; read-only independent capability inquiry, or independently authorized no-effect proof route; else human Option C | Architecture owner for Option C; separate human authority for new diagnostic route | `HOST_RUN_START_ADMISSIBLE=UNKNOWN/BLOCKED+STOP` | Proven complete pre-effect host ingress binding on fixed Senpi is mandatory before run; a retrospective H2 result cannot be an H0 prerequisite. |
| 35 Test-only start admissible, then actual origin-bound result observed | H0 START→H1 trusted ingress→H2 per-result verify→H3 evidence | RUN HSA ACTIVE, exact RA/freeze and independent pre-run capability; each effect rechecked | RA current; R only after true old success delivered/rejected and exact canonical join | Start confined run only after H0; accept independently captured origin-verified per-result trace later; no product enable | YES exact separate ACTIVATE; further authority if route/scope changes | Unknown H0: NO RUN; unknown H1/H2: reject event/no issuance/evidence; actual breach REVOKED | The same G1/G2 callId must not cause cross-generation attribution; `HOST_RESULT_ORIGIN_VERIFIED` is a post-observation predicate, never pre-run authority. |
| 36 Canonical Task1 31/32, Case A BLOCKED, unknown-tool BLOCKED; B1/IRA PASS attempted substitute | BLOCKED TASK1 GATE | No phase HSA can override existing evaluator | P-only insufficient; CaseA/unknown identity remain missing | Existing Task1 evaluator only | Task1 evidence owner | Task1 BLOCKED | 31/32 and Case A BLOCKED; do not add P/I or B3 mandatory Task1 inputs. |
| 37 Production I absent, Task1 R hypothetically PROVEN | PRODUCT READINESS GATE | Separate from Task1 | Even hypothetical R+P ≠ production I | Do not enable product | Product/normal Task6 owners | Product STOP | Production I later independently required; never Task1 mandatory edge. |
| 38 Read-only historical DEP completion after expiry, sealed operations all within previous time | HISTORICAL CLOSED DEP READ | CLOSED/EXPIRED, not active for new ops | HIST for exact previously accepted DEP root | Read-only audit, new separately signed phase if any | YES next human phase | STOP old HSA reuse | Past accepted+aborted seq gap-free at historical trusted instants; expiry does not rewrite truth. |

### 5.1 Mandatory attack trace groups and explicit acceptance constraints

- **01/02/18/19/23 (normal multi-edit):** each allowed operation is `PREPARE` (future afterRoot absent) → exclusively private stage → independently measured changed hunks → atomic accept+publish. The accepted full root becomes the *next* fresh preRoot. No second or third B0/DEP or HOST-PREP edit inherits an operation seal from its predecessor. Human HSA need not be renewed merely for allowed changes while still in the same open, scoped phase.
- **03/04/20/24 (bad candidate, actual violation):** stage rejection must be independently ABORTED without shared bytes. If actual forbidden/escaped effects were proven, classify `REVOKED+STOP`. Merely discovering a forbidden proposed hunk is **not** proof of a publicly committed violation.
- **06/07/09/10/11 (expiry, replay and gaps):** time and revocation check at both trusted instants, reserve sequence before stage, close gap with independent accepted or aborted finality. A forged actor timestamp cannot create a signed commit, a missing durable record cannot be silently discarded, and an unknown recorder status never earns a grant.
- **16/17/18/19/21 (DEP noncycle):** the start-only `DEP_STARTED(EAF_0)` is independently sealed before the *first stage*. First and second independent lock commits may change EAF, not the signed DEP grant. `B1_APPLICABLE_NOW(EAF_1)` is not checked for legal continuation; every operation checks its own fresh grant and actual scope.
- **15 (reachability repair):** a complete B1 PASS requires the B0 artifact to be closed; an edit “after PASS and before close” cannot legally occur in the same attempt. Only `attemptIndex+1`, its own legitimate scoped authorization and separate new B1 can reach DEP again. It never rewrites the prior EAF attestation.
- **30 (freeze reachability repair):** the frozen attempt is fenced *before any new editing*. If a source change is legitimate, the system first terminates previous freeze/current RA/ACTIVATE applicability and opens a **higher independent attempt** with renewed human scoped authorization; edit is only staged in that new attempt. No same-attempt path `FROZEN → WRITE` is allowed.
- **05/12/22/38 (historical truth):** an accepted delta has a valid independent commit instant; historical phase completion is reconstructed from gap-free signed accepted/aborted outcomes. Grant expiry after lawful close does not undo historical validity and cannot enable a new operation.
- **25–35/36/37 (RA/HOST/proof):** compiled `P` and exact RA/freeze/human ACTIVATE plus separately proven pre-run host ingress capability are prerequisites to the isolated trial (H0). The trial itself supplies only later verified H1/H2/H3 observations; these cannot be a prior H0 precondition. At H1 an unknown/reused `callId` without immutable G1/G2 source binding is rejected before authority/evidence/side effect. Runtime Task1 `R` (actually delivered old success and rejected after error) and production `I` remain distinct; `P`, `R`, `I` do not substitute for one another. No proven H0 capability ⇒ NO RUN / STOP / Option C.

**Proof acceptance is conditional, not claimed:** an independent reviewer must be able to falsify every listed obligation at the actor/monitor/recorder boundary, including crash between candidate proof and visible bytes, power failure immediately at linearization, recorder partitions, backdated ledgers, multiple worktrees, external process/host side effects, and G1/G2 same-callId origination. If atomicity/complete mediation cannot be demonstrated, STOP prior to all phases; a “PASS” text row alone never authorizes a phase.

## 6. Strict DAG and attempt-index proof (specification only)

Within each authorized operation, temporal edges are `PREPARE_CHECK→durable OP_PREPARED→private STAGE→COMMIT_CHECK→atomic ACCEPT+PUBLISH` or `ABORT`; the atomic transaction is **a single linearization event**, not distinct `sealed-accept→visible-publish` edges that permit a crash gap. `IN_DOUBT` has no outgoing authorization edge until independent recovery closes the uncertainty; it is not permitted to reach PHASE_COMPLETE. An ACCEPTED outcome needs no future after-state to authorize PREPARE. Every same-phase next operation requires the previous accepted full root; independent ABORT does not change it. `PHASE_COMPLETE` depends on all terminal outcomes, never on an unproven future effect to initiate earlier work.


**Within an attempt** assign **distinct integer ranks**:

| Node | Rank | Preconditions (forward-only) |
|---|---:|---|
| `R'` Requirements formal adoption | 0 | Requirements owner independently decides |
| `D'` Design formal adoption | 1 | `R'` |
| `P'` Plan formal adoption | 2 | `D'` |
| Fresh normative chain review | 3 | `P'` |
| Human Architecture Decision | 4 | Fresh normative review |
| Human B0 HSA + B0 scoped work | 5 | Human Architecture Decision |
| B1 compiled independent PASS(EAF0) | 6 | Completed B0 artifact |
| B2-DEP scoped human HSA and latched DEP_STARTED | 7 | B1 PASS(EAF0), read-only preflight, separately reviewed scope |
| B2-DEP completion/type/lock proof | 8 | DEP_STARTED, allowed per-operation edits |
| B2-HOST-PREP scoped human HSA + phase close | 9 | DEP completion and human PREP grant |
| Final freeze EAF_final | 10 | DEP and PREP phase completion |
| Independent B1-REATTEST-FINAL | 11 | Exact frozen input only; no actual HOST_RUN needed |
| Human B2-HOST-ACTIVATE | 12 | RA PASS exact frozen artifact |
| B2-HOST-RUN trial start and observed result | 13 | ACTIVATE + H0 `HOST_RUN_START_ADMISSIBLE` (including independently proven fixed-ingress capability, prior isolation); H1/H2/H3 only AFTER actual ingress/result |
| B3-T1 evidence submission | 14 | Observed B2 limited evidence; does not force Task1 PASS |
| Task1 existing evaluator Gate | 15 | Existing canonical32/CaseA/CaseB/runtime/safety only; B3 is a submission route, **not** mandatory alternate acceptance condition |
| Normal human Tasks2–6 authorization/work including Task5 | 16 | Existing Task1 PASS |
| Ordinary full Task6 integration/acceptance | 17 | Normal authorized Tasks2–6 including Task5 |
| Existing product/PlanComplete assurance | 18 | Full normal task completion plus existing production `I`, persistence and authority proofs; unadopted product-readiness stays separate |

Define precedence edge set only for the displayed chain and true prerequisite gates; for **each edge** `(u,v)` in the same attempt, `r(u)<r(v)` holds. In particular `r(R')=0 < r(D')=1 < r(P')=2`, repairing R6's equal-rank proof defect. B3-T1 may precede Task1 evidence determination, but **Task1 acceptance can also be evaluated from other existing legitimate evidence**; no new required B3 input is inserted into the existing evaluator. Inside rank 13 the strictly prospective→retrospective micro-order is `H0(capability+HSA/RA+isolation) → HOST_START → H1(ingress barrier) → H2(actual result origin verification) → H3(independent evidence acceptance/submission)`. These are *sequential internal events*, not a new backward Gate dependency and not evidence for prior phases. Every observed event receives a fresh monotonically ordered ingress sequence; missing H1/H2 never permits forward H3. Forbidden reverse edges `H2→HOST_START` and `H3→H0` are excluded. For formal ordering use lexicographic `(attemptIndex, phaseRank, microstep/eventSequence)` and strictly increasing intra-rank sequence. The host run is safe-admissible at H0 **only if** independently proven fixed ingress mediation blocks unbound events/effects; unproved H0 means no edge to HOST_START. If a live no-effect diagnostic is separately proposed, its own prior human/monitor/no-effects constraints must be established in a separately reviewed route rather than adding a backward phase edge.

An RA verification is pre-runtime and pre-full-Task6, so there is **no** edge `Task1→RA`, `fullTask6→RA`, `fullTask6→Task1`, `HOST_RUN→RA`, or `production I→Task1 R`.

A new attempt for row 15 B1-after-edit remediation or row 30 post-freeze lawful edit is a **new signed phase instance**; no same-attempt mutation of closed/frozen state. Repairs/new submissions use strictly increasing `attemptIndex`. For a retry from late rank to an earlier stage rank, the new attempt MUST have a newly and independently authorized revision/phase, fresh source/evidence identity and `(attemptIndex+1, lowRank)`. All dependency transitions strictly increase lexicographic `(attemptIndex,rank)`: either same attempt and increasing rank, or greater attempt index. A failed attempt cannot reuse expired/revoked grant, old B1 PASS, frozen EAF, or old exact-artifact ACTIVATE as current proofs. There cannot be a directed cycle in a strictly increasing well-founded rank order. This proves **proposed authorization dependency acyclicity**, not runtime feasibility or existence of actual trusted ledger infrastructure. An attempt repair may not erase earlier violations and cannot bypass fresh human/independent review requirements.

## 7. Non-regression and current fixed statuses

- INV-A01–A14 all retained; A07 Task1's actual runtime `R` and production `I` are separate. B1/RA prove compiled/static subset `P`, never replace `R` or `I`. `L_ACT/L_INV` synchronization still required; `AUTHORITY_FAIL_CLOSED` ≠ `PERSISTENCE_SAFE`. A10/A12 require actual positive role sanitation, same session/ID and canonical JSONL readback. `HOST_RUN_START_ADMISSIBLE` pre-run capability unproven ⇒ NO RUN/STOP; per-result `HOST_RESULT_ORIGIN_VERIFIED` absent ⇒ NO EVIDENCE/ISSUANCE, Task1 R remains BLOCKED.
- Existing Task1 evaluator unchanged: canonical exactly 32 (final `31/32 PROVEN`), Case A independent BLOCKED, Case B PROVEN, unknown-tool canonical identity BLOCKED; required-runtime-evidence aggregate **true** and mandatory-safety aggregate **true**, Task1 **BLOCKED**. Separate B-001 BLOCKED and B-002 NOT_PROVEN do not silently alter Task1 denominator. `RG310-PRODUCT-READINESS` is `PROPOSED_NOT_ADOPTED`.
- Task1 existing Gate precedes and does not depend on **full Task6**. B1 partial compiled PASS and B2 subset host observation do not issue `TaskAccepted`, `PlanComplete`, production `I`, or general Tasks2–14 authorization.
- `TRUSTED_OP_BOUNDARY_PROVEN` (including verified atomic publish, crash recovery, stage isolation) and all human grants, independent RA, host origin proof are *specified but not established*. Static specification cannot claim them operationally feasible.

```text
R11 Architecture Proposal: UNAPPROVED
Formal Fresh Independent R11 Review: NOT_ESTABLISHED
Architecture Decision: HUMAN_DECISION_REQUIRED
RG-310-A-001: NO_EQUIVALENT_EVIDENCE_CONTRACT
RG-310-DR-001..004: OPEN
Canonical runtime contracts: 31/32 PROVEN, 1/32 BLOCKED
Case A: BLOCKED; Case B: PROVEN; Unknown-tool: BLOCKED
Required-runtime-evidence aggregate: true
Mandatory-safety aggregate: true
RG-310-B-001: BLOCKED; RG-310-B-002: NOT_PROVEN
RG310-PRODUCT-READINESS: PROPOSED_NOT_ADOPTED
Task 1: BLOCKED; Tasks 2–14: NOT_AUTHORIZED
B0/B1/B2-DEP/B2-HOST-PREP/IRA/HOST-ACTIVATE/HOST-RUN: NOT_AUTHORIZED / NOT_PROVEN
Implementation / TaskAccepted / PlanComplete: NOT_AUTHORIZED
```
