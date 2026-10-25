# Justice RG-310-A-001 — C1-FULL revised architecture / design proposal (unsigned)

**Version**: Candidate DP-R1 (2026-10-25 JST). **Disposition**: `AUTHOR_DRAFT_COMPLETE_FOR_REVIEW / INDEPENDENT_DOCUMENT_RE_REVIEW_REQUIRED / NO_ADOPTION`. No CI, runtime, source or provider effects have been executed by this document work.

## 1. Purpose, normative hierarchy and hard scope limit

**Purpose:** fully specify, for independent design review, a candidate trust architecture supporting approved v5 fail-closed Justice acceptance and a future bounded C1-FULL product-lifecycle enforcement model. This is *design completion* only; it does not create new normative authority. Approval of authoring does not approve content, effect scope or physical enforcement readiness.

1. Approved v5 Requirements/Design/Plan at `8a2e4f1536e9cad499ee7e9d996ff163df132fd4` controls current Justice semantics. `JUS5-AUTH-01..09`: authorization is human-controlled and binds the exact R→D→P chain; substantive changes invalidate lower authority. `JUS5-GATE-02` and `INV-04`: no unsupported Authorized/Accepted/Verified/Complete; optional telemetry may fail open when safe; `INV-03`: Justice owns acceptance; `INV-05/06`: no silent normative drift/authority reversal.
2. Unapproved R11 `INV-A01..A14` and 38×7 matrix are *not* adopted. Its commit freshness, candidate atomic commit, host origin and HSA proposals are research constraints only until a separate, reviewed human R'→D'→P' process. Never silently interpret their semantics as approved v5.
3. C1-FULL source/effect census includes *all legitimate lifecycle candidate consumers* (Git/CI/release/registry/host/other), not only a private Gateway. Distinguish inventory coverage from mandatory pre-write-control eligibility. Exact per-effect assurance remains an Owner O-01 decision; 27 candidate effect IDs are not certified exhaustive.
4. This design excludes no producer lifecycle path implicitly. Offline, already distributed noncooperative historical copies cannot be retroactively physically stopped by a producer-only Gateway. Justice can refuse future acceptance of unproven observations. The choice of what historical copies *ought* to be in the normative scope remains DS-02 pending.

### Static source/evidence anchors

- v5 Requirements blob `d335c34b747cafd6ac3b2e81d710fdcc61fb777e`; Design blob `64acdf177d2fd207861eb477af7c8a265eed71e8`; Plan blob `10dfba4c199feff19ee387b244daf6c0fd30d5e3`.
- Task1 `release.yml` blob `4f984a012f3fa9421a32531a00394f4d654d5284`. Fixed sequence `release-please-action` before `npm pack --dry-run`, `npm publish --ignore-scripts`, then a *separate* `npm pack` + `gh release upload` — source-level, not proof of actual unauthorized release. Six tracked workflows and additional process/third-party writers remain in scope.
- P9 independent result ZIP SHA256 `f0efb114aaf04a3ced9da45a6b40ca698b2fe6e275afbed61e46a198e02073b0`: eight interfaces, 22 writer candidates, 19 static traces.
- P10-A follow-up ZIP SHA256 `194d601b9565f11a55817aa9897912b81375aea01b061cb412001fbecb8b9b55`: 32 Writer candidates, 24+65 inherited API events (41 connector response hashes not recomputable without response bodies), O-01..07 still unverified.
- U-07 normative independent ZIP SHA256 `d4394e0b2d5da3eac4485785f65a83c55e8573bd73a0739f109b8ff54884c439`: separates accepted v5 guarantees and additional universal retrospective physical enforcement.
- Previous Owner scope worksheet ZIP SHA256 `e252ea48aa3a7e735757dd2208c2ae1b22e9697d0d9eb436cae1a4349099cf5c`: all 27 effects `PENDING_OWNER_SELECTION`.

## 2. Design selection is *not* approval: candidate B-C1 design

**Recommended candidate for specification only: B-C1**, a *private durable candidate → independently certified seal → provider-specific protected effect → actual-use verification* architecture. We describe it because current A cannot prove one distributed atomic `ACCEPT+PUBLISH` over issuer/DB/independent signer/GitHub/registry/Host. B is not automatically R11-compliant and cannot be adopted without explicit R' material semantics changes; an authenticated Owner decision is required before setting new invariants.

Proposed end-to-end trust graph:

```text
  Approved canonical R/D/P -----> Justice semantic evaluator -----┐
                Human binding identity / normative revision       │
                                                                  ▼
  Issuer / ordering authority -----> authorization candidate -> AUTH
       │                                  │                       │
       │ fresh fence + epoch/cause        ▼                       │
       └----------------------------> durable DB operation -------┤
                                           │ PRIVATE ONLY          │
                                      [DB_COMMITTED_UNSEALED]     │
                                           │ readback exact bytes  │
                                           ▼                       │
                                     independent signer/SEAL      │
                                           │ signed epoch/root     │
                                           ▼                       │
                                    sealed proof + visibility     │
                                           │                       │
                               per-effect fresh grant/nonce       │
                                           ▼                       │
                        provider-side PRE_EFFECT_DENIAL guard     │
                         Git / CI / registry / Release / Host     │
                                           │                       │
                                 remote receipt/readback          │
                                           ▼                       │
                                 effect-level reconciliation -----┘
                                             │
                    Supported Host trusted actual-use attestation
                                             │
                    Justice accepts only proven, scoped evidence

  Existing uncontrolled offline third-party copies: outside any
  claimed physical veto; never automatically accepted or certified.
```

All vertical arrows are **required proof obligations**, not currently implemented bindings. The provider-side gate is mandatory for any effect which the human Owner later selects as `PRE_EFFECT_DENIAL`. If no provider mechanism is able to deny all writers, that effect **cannot** be certified as pre-effect protected; do not silently downgrade assurance.

### Proposed trust principal inventory (names logical, not deployed services)

| Logical principal | Trust/custody responsibility | Must be prevented from doing | Evidence still missing |
|---|---|---|---|
| `HUMAN_OWNER` | authenticate exact scope and normative adoption separately | silent implicit consent/blanket unsigned grant | O-01 signed canonical scope, DS-01..06 adoption |
| `ISSUER_ORDER` | monotone revocation/epoch witness or verified high-water | allow detached stale grant to become a fresh proof | O-07 effective fence evidence |
| `AUTH_ADJUDICATOR` | bind subject/op exact R/D/P, scope and issuer order | directly publish, sign or forge provider receipt | independent auth assurance |
| `DURABLE_LEDGER` | atomic internal bytes/digest/root/seq and durable receipt | claim external seal or remote COMMIT | durable-clock and restore proof |
| `INDEPENDENT_SEALER` | re-read durable candidate and attest exact bytes | seal invented/orphan/obsolete state | key custody, signer refusal and ACK |
| `EFFECT_REFERENCE_MONITOR` | per-effect prior admission under proven provider rights | hold wildcard bypass credentials outside policy | O-02..06 provider-effective scope |
| `PUBLISHER_JOB` | use an exact approved immutable blob and one-time grant | tag/release/npm publish before admission; repack | CI release control/registries |
| `SUPPORTED_HOST_ATTESTER` | attest actual loaded JS/native mappings at use and origin | rely on package label/source hash alone | H0..H3 / host custody |
| `RECOVERY_AUTHORITY` | monotone high-water and physical old-primary fence | restart old writers or present stale head as CURRENT | O-07 old-leader and backup proof |

Principals must be separable in the proposed target; sharing broad administrator credentials invalidates any claim of independent mandatory mediation. Existence of a logical principal on a diagram does **not** establish deployed enforcement.

## 3. Contract IDs and acceptance invariants (candidate only)

- **DP-INV-01 AUTHORITY_CHAIN:** Every protected authorization binds exact approved R/D/P identities, fingerprints, schema and plan scope; any substantive delta triggers reconciliation and fresh human approval. No new draft bypasses v5.
- **DP-INV-02 NEGATIVE_ACCEPTANCE:** Absence/unknown/mismatch in evidence never produces Authorized/Accepted/Verified/Complete. Telemetry fail-open cannot be reused as acceptance fail-open.
- **DP-INV-03 PRIVATE_UNSEALED:** Candidate DB commit is **not** visible as an externally Accepted/current state until independent readback seal and admissibility criteria succeed. Signer absence => private/unsealed/quarantine, not success.
- **DP-INV-04 BOUNDED_COMMIT_CLOCK:** A protected COMMIT's freshness must be evaluated against an independently justified causal bound for actual durable COMMIT, not `now()`/`nextval()`/client ACK alone. An interval overlapping expiry => UNKNOWN/BLOCK. Choose R11 COMMIT freshness vs added issuer-effective Rv-S explicitly before adoption.
- **DP-INV-05 FRESH_EFFECT_GRANT:** Each first protected provider-visible write requires Owner-selected effect classification, issuer/fence freshness and scope-specific single-use grant **before** the effect. Source YAML permission or post-`pack` check alone is not a veto.
- **DP-INV-06 NO_BYPASS:** Every other authorized App/PAT/DeployKey/admin/reusable workflow/restore path that can perform the same protected effect must be disabled, fenced or mediated by verified policy. If completeness unknown, `NOT_PROVEN`.
- **DP-INV-07 SINGLE_BYTE_CHAIN:** One immutable canonical build/tarball/hash maps to any certified registry version and release asset. Exact uploaded bytes or independently verified equivalent remote canonical bytes must be read back; no assumed equality from `npm pack --dry-run` and independent later `npm pack`.
- **DP-INV-08 ACK_IS_NOT_CAUSAL_ATOMICITY:** Provider ACK/timeout/rollback is not part of a DB distributed transaction. ACK unknown => `REMOTE_UNKNOWN` and no blind retry; remote conflict/partial effect => quarantine and manual reconciler path.
- **DP-INV-09 FORMER_PRIMARY_FENCING:** Restore/current promotion needs independently anchored high-water, nonrollbackable epoch and proof stale writers/issuer/signer/grants and old credentials cannot still act. DB record alone is insufficient.
- **DP-INV-10 HOST_AT_USE:** Supported host must bind actual loaded JS/native mapping at `t_use`, trusted origin H0–H3, scope/epoch and certified artifact; source path/package manifest alone insufficient. Unknown => no certified use/acceptance.
- **DP-INV-11 EFFECT_COVERAGE:** Every effect in the 27-row starting census has an explicit Owner disposition and normative compatibility mapping; direct/noncooperative/outside actors are not silently dropped. Non-applicable must be justified and reviewable.
- **DP-INV-12 AUDIT_PROVENANCE:** Evidence distinguishes source-level reachability, provider-side policy state, actual provider effect/byte receipt, host use and human adoption. Placeholder SHA, null join sentinel, unsigned record, 403/400 must not be promoted to proof.

All twelve are proposed **design assertions**, not currently adopted invariants or proven system properties. They require independent review and human R' if materially stronger/different than approved v5.

## 4. State and visibility protocol

Candidate states are explicit to avoid false distributed atomicity:

```text
DRAFT_INTENT
  -> SCOPE_UNKNOWN / DENIED
  -> AUTH_CANDIDATE
  -> DB_COMMIT_OUTCOME_UNKNOWN   (timeout/lost ACK; reconcile; never assume abort)
  -> DB_COMMITTED_UNSEALED      (durable **private** candidate)
  -> SIGNER_REFUSED / SEAL_OUTCOME_UNKNOWN / ORPHAN_SEAL
  -> SEALED_PRIVATE             (signed exact internal record; not remote publication)
  -> EFFECT_GRANT_PENDING / EFFECT_DENIED / EFFECT_IN_DOUBT
  -> EFFECT_ADMITTED_ONCE
  -> REMOTE_UNKNOWN / REMOTE_CONFLICT / REMOTE_PARTIAL
  -> REMOTE_CONFIRMED           (provider-effect-specific verified receipt)
  -> HOST_USE_UNKNOWN / HOST_USE_ATTESTED (only for supported host requirements)
  -> CERTIFIABLE_VIEW          (ONLY after WP06b dependency closure; never seal alone)
```

**Per-effect**, not global, remote states are required; an authorized build artifact does not automatically certify a release tag, npm registry version or Host use. A PUBLIC provider object may exist while Justice's `CURRENT`/Accepted projection is BLOCKED; the system cannot claim to atomically undo external objects. Visibility fences must not present private `DB_COMMITTED_UNSEALED` as accepted.

**Revocation design fork:**

- `RV_COMMIT_FRESHNESS`: verify revocation/grant freshness at the objectively evidenced durable commit time (R11 investigation subject); clock source & issuer causal import still unproven.
- `RV_STRICT_ISSUE`: revocation effective at issuer issuance independent of delayed notification. Cross-domain detached actors can violate this without common serializer/physical fence; no GO for observed split.
- `RV_FENCE_BLACKOUT`: proposed alternative only if R' formally adopted: issuer issue begins blackout (no new protected effects); eventual independently attested provider-effective fence determines reactivation. NOT a silent replacement of strict semantics.

Unknown issue/commit causal order, uncertain monotonic fence, sign-after-revoke, or pre-effect grant stale -> block protected action/certification. *One* revocation semantics must be selected normatively; this document does not select for the Owner.

## 5. Eight interface contracts (detail in JSON)

The eight P9 names are retained, with their **result/failure and source-of-truth requirements**: `ISSUER.revoke_issue/query_fence`, `AUTH.authorize_commit`, `DB.commit_durable_receipt`, `SIGNER.readback_and_seal`, `EFFECT_GRANT.authorize_once`, `REMOTE.readback`, `ACK.high_water/RECOVERY.fence`, `HOST.attest_actual_use`. Each request requires protocol version, canonical subject/effect ID, exact root/source identity, epoch/term/seq, nonce and evidentiary timestamp; each response is proof or explicit BLOCKED/UNKNOWN, **never a plain boolean success**. Contract JSON is informative and not a frozen wire schema.

### Proposed error semantics

`DENIED_SCOPE`, `AUTHORITY_UNVERIFIED`, `FENCE_UNKNOWN`, `COMMIT_TIME_UNKNOWN`, `PRIVATE_UNSEALED`, `SIGNER_REFUSED`, `SEAL_UNKNOWN`, `PROVIDER_DENIAL_NOT_PROVEN`, `REMOTE_UNKNOWN`, `REMOTE_CONFLICT`, `OLD_PRIMARY_NOT_FENCED`, `ACTUAL_USE_NOT_ATTESTED`, `ARTIFACT_BYTES_MISMATCH`, `ORIGIN_NOT_PROVEN`. Invalid/missing schema/permission must yield fail-closed acceptance and audit record. No raw secret, token, private key, or credential in evidence receipts.

## 6. Source/build/release/host redesign — design only

### CI and First-Effect policy

**Do not continue the fixed release job and merely add a late `npm pack` gate.** Propose a release pipeline split into (a) discovery/analysis that is powerless to mutate Owner-protected effects, (b) prepare deterministic candidate build and validation, (c) exact-byte signing/seal, (d) provider-specific per-effect preauthorization, (e) first provider mutation, (f) authenticated readback and reconciliation. Release-please's creation/update of **PR/tag/Release** is itself an effect; whether each is protected must be explicitly decided and reflected in GitHub actor permissions. No early `release-please` token may retain an unmediated capability to create protected tags/releases before the gate. PR-only mode likewise needs explicit PR classification.

**Provider denial is not a process wrapper:** effective GitHub branch/tag/ruleset/App/PAT/admin/workflow rights and Github Packages ACL must be proven. `master protected:false`, disabled ruleset `14286365`, 403/400 on other settings mean O-02..06 unresolved; no complete writer census or prior veto now. If protected write cannot be physically denied at source, record `UNENFORCEABLE_AS_PROPOSED`; no production certification for that guarantee, no silent reclassification.

### Bytes and external effects

Build from immutable source/lock/toolchain/native inputs to a **single content-addressed artifact set**, produce the tarball *once*; derive `artifact_digest`, `native_digest`, `js_digest`, `tarball_digest`; attest build policy and signer identity separately. Any provider return object must bind exact version/ref/OID/digest and actor/effect-attempt identity where available. If GitHub Packages cannot yield exact published tarball attestation, document weaker provider metadata/readback and the resulting proof limitation; do not assert exact byte equality without proof. Release assets reuse the verified same tarball (never separately re-pack), and their remote digest/OID must be read back and compared. External remote mutation cannot be rolled back by DB rollback.

### Host and local tool effects

Host support is conditional upon attested custody/origin H0–H3 and loaded JS/native bytes at use, not just install-time package hashes. `doctor-cli` dynamic imports/child `opencode` process, `justice_status` projection-cache write, local file-system/native/FD and direct source installations must be classified for **both** executed tool authorization and Justice acceptance. If actual-use origin is unprovable for a host, classify `UNSUPPORTED_FOR_CERTIFIED_USE`, not generic ``Host verified``. Prior noncooperating offline copies: no claimed retroactive veto.

## 7. Recovery and external ACK

For any provider effect, write an immutable `effect_attempt` identity before dispatch, atomically bind operation/effect/root/epoch/nonce to policy proof if that boundary exists. No automatic `retry` when the provider outcome is uncertain unless the provider's idempotency/readback semantics are separately verified. A failed writer may leave a partially public object; distinguish `QUARANTINED_REMOTE` from private accepted-state rollback. Track issuer, DB, seal, high-water and remote-effect high-water independently, with externally auditable fencing of former writers. A stale former primary or signer => `NO_CURRENT / NO_NEW_PROTECTED_WRITES` until trusted reconvergence.

## 8. Threat model and proof obligations

- **Adversaries/noncooperating surfaces:** unmediated GitHub App/PAT/admin/deploy key; release-please credential; reusable workflow; external publisher; stale old leader; restore rollback; malicious/corrupt npm tarball; native swapping after install; lying Host observer; signer refusal and key rotation; time interval crossing expiry; reader of private DB candidate; provider response lost after side effect.
- **Dominant failures:** unauthorized first tag/release/PR before gate; provider or registry bypass; unsealed candidate leaked as accepted; COMMIT time guessed from non-durable timestamp; remote ACK falsely treated as atomic success; stale Host bytes or signer/principal; false `PROVEN` on absent provider-rights metadata.
- **Bounded mitigation strategy:** mandatory provider policy with independently verified effective rights; private durable staging; independent sealing and proof readback; fresh per-effect grant; immutable byte chain; host use attestations; fail-closed/current fences and robust unknown outcome states; separate signed human normative adoption.

## 9. Decision, verification and adoption boundaries

Design artifacts may be independently reviewed as **conditionally complete research design**. The following are **blocking for adoption and any interface/schema freeze**:

- `O-01`: Owner's authenticated exact resource/effect, semantic assurance and lifecycle epoch; DS-02 population choice.
- `O-02..06`: effective provider writer population/rights and credible prior-veto proof per protected FIRST write (not just YAML declarations).
- `O-07`: old-primary/issuer physical fencing and recovery evidence.
- `DS-01/03/04/05/06`: owner selects trust authority, temporal revocation meaning, DB/seal/publication semantics, actual Host custody and recovery guarantees; DS historical original provenance still unverified.
- Independent normative/R' review, independently reviewed D' and reconciled P', explicit human approval, and **separate** implementation/test/execution grants.

**No formal adoption** is implied by this candidate design. An inability to obtain O-02..07 proof is a design feasibility STOP for a protected pre-write-effect claim; the team may continue authoring the plan but cannot call it implementation-ready.

## 10. DP-R1 correction: finite temporal oracle and independent witnesses (proposed, not normative)

**Semantic Owner fork `DS-03` — all choices UNSELECTED:**

| Meaning candidate | Ordering duty | Required independent witness | Unknown/negative oracle |
|---|---|---|---|
| `RV_COMMIT_FRESHNESS` | no revoked/expired grant at actual **durable** `COMMIT` | cryptographically validated issuer checkpoint and a causal/durability interval `C∈[C_lower,C_upper]` bound to the acknowledged DB term | no provable before/after relation -> `COMMIT_TIME_UNKNOWN`; never infer from `transaction_timestamp()` or client ACK |
| `RV_STRICT_ISSUE` | issuer revoke issuance precedes a protected commit/effect => no protected success despite delayed import | issuer-issued event order and common effective serializer **or** physically enforced pre-effect fence on every authorized writer | detached writer commit after issuer revoke, before DB import -> `CONTRADICTORY_IN_OBSERVED_SPLIT` unless independent serializer is proven |
| `RV_FENCE_BLACKOUT` | issuance triggers immediate blackout; resume only after provider-effective fencing of all relevant writers | issuance evidence + independently witnessed provider/old-writer fence epoch + replay/restore guarantee | partial or delayed fencing/unknown effect => `BLACKOUT_NO_NEW_EFFECTS`, `NO_CURRENT`; material **R' Owner adoption required** |

**Static interval decision algorithm** (concept only): prove all time observations in a *common independently attested clock/order domain*. For expiry point with independently bounded event `E∈[E_lower,E_upper]` and COMMIT `C∈[C_lower,C_upper]`, `C_upper < E_lower` is sufficient for definitely-before-expiry, `C_lower >= E_upper` is sufficient for definitely-expired, and overlapping intervals are `UNKNOWN`. This necessary check does **not** prove no intervening revocation; a verified issuer order/causal fence is a separate predicate. Missing clock calibration/certification, rollbackable witness or clock discontinuity -> `UNKNOWN`. Signed issuer/DB tokens alone do not create cross-domain temporal ordering.

**DB / independent seal:** exactly one private, durable candidate root must be independently read back by the signer. Verify full root/bytes, issuer checkpoint, DB term+epoch+sequence, signer key validity/rotation epoch, replay nonce, candidate durability, and no competing root. `SIGNER_REFUSED`, `SEAL_ACK_LOST`, `ORPHAN_SEAL`, `SIGNER_KEY_REVOKED`, `SEAL_EPOCH_STALE` => no published/accepted view. Seal signature proves only the signer assertion on listed bytes; it is not a remote publisher ACK or a physical reference monitor.

**Effect dispatch:** create immutable attempt ID, check fresh issuer and provider policy at **the effect-time fence**, and prove independent non-bypassable denial *before the first protected provider mutation*. If a provider has no suitable pre-effect denial surface for the Owner-required assurance, classify `UNENFORCEABLE_AS_PROPOSED` and STOP. For uncertain remote ACK, preserve `IN_DOUBT` until independently comparable remote ID/ref/OID/digest readback. Never retry an unknown nonidempotent effect without independently verified idempotency identity.

**Recovery:** compare `restored_seq` and independently nonrollbackable attested `high_water` for all relevant ledger and effect streams. If `restored_seq < high_water`, or former-primary keys/grants still write, `OLD_PRIMARY_NOT_FENCED / NO_CURRENT / NO_NEW_PROTECTED_EFFECTS` regardless of freshly generated DB epoch. Require provider-effective credential/key revocation and independent high-water replay witness. No automatic remote-effect rollback is possible from local DB rollback.

See `12_TEMPORAL_RECOVERY_NEGATIVE_ORACLES_R1.csv` for finite paper counterexamples and `04_EIGHT_INTERFACE_CONTRACTS_CANDIDATE.json` for candidate typed envelopes. These are **unexecuted** proofs-to-design, not runtime evidence.

## 11. DP-R1 correction: certified visibility uses transitive proof closure

Early private visibility (`DP-WP-06a`) and final certified state (`DP-WP-06b`) are separate **logical responsibilities**, not one seal-triggered transition. Certified lifecycle `CURRENT` requires `ApprovedV5Floor`, human-approved exact R/D/P, durable committed bytes, independent seal, nonstale issuer+old-primary fencing, every Owner-selected mandatory pre-effect denial including complete writer closure, each required remote object verified to its own byte/ref identity, supported Host actual-use attestation where required, and a complete independently reviewable evidence register. Any unresolved selected predicate is `UNKNOWN/NO_CURRENT`. Missing physical enforcement cannot be recoded as optional acceptance-only without the Owner's explicit normative selection, and already-approved v5 fail-closed acceptance is never optional.

**Separate decision levels:** approved v5 acceptance floor is binding now; expanded lifecycle certification/pre-provider physical denial are unsigned **candidate** R'/D'/P' duties. A public remote object may exist even as local `CURRENT=NO`. This design never claims external atomic rollback or physical denial simply because Justice refuses acceptance.

## 12. DP-R1 correction: effect class and provider effective authority

`05_PROPOSED_EFFECT_COVERAGE_MATRIX.csv` is a census **seed**, not the denominator of all enforceable first-effect writes. It distinguishes provider-visible `FIRST_WRITE`, internal `BUILD_BYTES`, runtime `ACTUAL_USE`, *already approved* `JUSTICE_ACCEPTANCE_FLOOR`, `RECOVERY_CONTROL`, and `HISTORICAL_UNCONTROLLED_COPY`. E24 is **non-overridable** `JUS5-GATE-02 / INV-04` even while unsigned new lifecycle effect selection is pending. E26/E27 and new inherited/principal paths stay in the source-closure register; none is silently removed or retroactively claimed denyable.

For each `FIRST_WRITE`, `10_PROVIDER_FIRST_EFFECT_CONTRACTS_R1.csv` specifies: provider+API/write kind, policy identifier/epoch, first-effect signer/subject, principal census custodian, bypass authority, *independent physically preceding denial* and provider readback, with STOP on an uncensused App/PAT/admin, credential class or missing effective policy. A proposed GitHub ruleset does not substitute for a verified all-writer effective reference monitor; an App or admin with effective bypass privileges disproves that specific protection claim until mediated or fenced. All such effective-rights proofs currently `NOT_ESTABLISHED`.

## 13. DP-R1 correction: Host attester alternatives and independent byte identities

No Host is automatically a Supported Host. Proposed alternatives require either (A) an OS-enforced trusted loader with attester custody inaccessible to package JS/native, immutable measured mapping/namespace/inode for JS and `.node` actually used; or (B) a remotely held, independently verified host attestation source with demonstrable mapping to loaded executable pages and protected epoch. Mere path hashing, self-reported package manifest, local wrapper hooks, installation digest, open file descriptor labels, or an `opencode` launcher report are **insufficient**. A directly imported module, inherited writable FD, mount namespace alias, mutable symlink, native syscall, privileged child and renamed `.node` must be within the enforced coverage or cause `UNSUPPORTED_FOR_CERTIFIED_USE`.

At use-time attest `{accepted_root, js_loaded_bytes_digest, native_loaded_bytes_digest, process/namespace identity, mapping/inode binding, trusted_origin, issuer/credential epochs, bounded freshness, challenge_nonce, attester_key}` and independently verify key custody, origin H0–H3, replay and source-map closure. Any unmeasurable dynamic code/loader swap or untrusted observer yields `ACTUAL_USE_NOT_ATTESTED` and `NO_CURRENT` for any required Host-use assurance. Existing H0–H3 remain `NOT_PROVEN`, and this section neither authorizes a Host instrument nor claims it works.

**Byte chain proof dimensions (nonfungible):** pinned source/lock/toolchain/native inputs -> built JS & native digests -> exactly one tarball SHA256 -> registry actual object bytes (or provider-attested equivalent with explicit binding limitations) -> Git tag ref OID / commit OID & Release object -> Release asset remote digest -> install provenance -> actual use-time JS/native mapping. Each link requires distinct proof; metadata or name equality is not content equality. If readback APIs cannot verify a selected strict requirement, report `REMOTE_BYTE_IDENTITY_NOT_ATTESTABLE`, not inferred PASS.

## 14. Historical DP-R1 documentation status

`AUTHOR_DRAFT_COMPLETE_FOR_REVIEW` is only the author's current document assessment. Review response `REVISION_REQUIRED` to R0 remains historical; fresh R1 independent document review was **PENDING AT R1 AUTHOR DRAFT TIME**; subsequent R1 review was REVISION_REQUIRED (9 YES, 3 PARTIAL) and R2 review was REVISION_REQUIRED (11 YES, 1 PARTIAL). Nothing is `DOCUMENT_READINESS_PASS`, `OWNER_ADOPTED`, `INTERFACE_FROZEN`, `PROVIDER_ENFORCED`, `RUNTIME_PROVEN` or `EXECUTION_GO`.


## DP-R2 limited amendments (AUTHOR PROPOSAL / not adopted)

### Provider first-effect control and failure contract — FND-DPR0-003

`10_PROVIDER_FIRST_EFFECT_CONTRACTS_R2.csv` supersedes R1 provider rows only for document-review purposes. Each E01–E15 now distinguishes API mutation class, actual **candidate** provider admission primitive, conditional protection capability, needed policy/actor/epoch match and unsupported branch. A branch or tag **active** ruleset can constrain matching ref mutations, but is not by itself a release/asset/package/PR creation veto. All other provider token/permission gates are not shown to evaluate an Owner-signed attempt/root at exact first effect. Therefore `UNENFORCEABLE_AS_PROPOSED` if the Owner selects strict physical prior denial and no complete non-bypassable control is demonstrated by a custodian; do **not** silently weaken it to acceptance-only. Full effective writer identity and former primary bypass census remain NOT_PROVEN.

### Proof verification closure — FND-DPR0-004

The eight interface specifications remain candidates (`is_normative=false`, `frozen=false`, `adopted=false`). `04A` checks wire shape; `04B` specifies external semantic validation including trusted anchors, cryptographic/provider attestation, request nonce replay prevention, exact root/effect/actor/policy/epoch bindings, causal interval domain consistency, and authentic provider rejection *before first mutation*. A schema-valid `PROVEN` or `DENIED` value with unverified evidence is **NOT_PROVEN**, blocks selected strict effects and `Accepted/CURRENT`, and cannot be promoted by another local string flag.

### Deterministic paper traces — FND-DPR0-007

`15` T07 now records a synthetic COMMIT interval `[1e9,2e9] ns` and synthetic expiry `[1.5e9,1.5e9] ns`, with overlapping interval and **unproven** common-domain attestation => `UNKNOWN_NO_CURRENT`. `15` T34 now separates active signer key epoch 8 vs restored seal epoch 7, seal seq 40 vs paper high-water 42, and physical old-primary fence `NOT_PROVEN` => `SEAL_REJECT_NO_CURRENT`. All paper traces remain `SPEC_ONLY_NOT_EXECUTED`; see `15A` individual 34-case static audit. These synthetic numbers are **not** provider source timings, signatures or runtime proof.


## DP-R3 narrowly bounded verification-receipt amendment — candidate only

`04_EIGHT_INTERFACE_CONTRACTS_CANDIDATE.json` and `04A_TYPED_ENVELOPE_CANDIDATE_SCHEMA.json` now define an *untrusted wire claim* versus a `canonical_verification_receipt` signed by a separately trusted independent verifier. `04B_INDEPENDENT_PROOF_VERIFIER_CANDIDATE_R3.md` specifies canonical signed subject bytes, independent raw-witness recomputation, attempt-vs-request binding, predicate-specific remote before-effect refusal and no-external-attempt typed variant. `04C` enumerates eight synthetic negative oracles. Structural schema validation alone proves none of these semantics; no crypto/provider verification has occurred.

A `PROVEN` or `DENIED` claim **cannot** promote without independently authenticated verifier output over the exact raw proof digest, request↔attempt (or typed no-attempt predicate), effect/resource/principal/policy+epoch, artifact chain/root, nonce, key epochs, causal interval and interface predicate. DENIED of one mutation is not writer-universe closure. Missing original proof bytes or currently authorized trust-anchor/profile results in `UNKNOWN/NOT_PROVEN/NO_CURRENT`. All DS/O selection and approved-v5 floors are unchanged.

## DP-R3.1 bounded verifier receipt clarification (author candidate, not adopted)

HISTORICAL R3.1 AUTHOR-ERA TEXT (superseded by DP-R3.2 addendum below): The DP-R3 independent review (2026-10-25) awarded eleven documentary YES, one PARTIAL (`FND-DPR0-004`). The present R3.1 author-only correction is not an independent pass. Canonical candidate interface version is **`CANDIDATE_DP_R3_1`** in both `04` and `04A`; older R2/R3 message versions have no implicit conversion. The signed subject's nanosecond interval bounds are canonical **decimal JSON strings**, exactly range-checked outside schema. The `request_attempt_binding_sha256` hashes separately authenticated typed external-attempt **or no-external-predicate** canonical binding documents; no physical attempt is invented for issuer/DB/signer/Host-local observations. The signed policy identity is discriminated as provider, internal, or precisely scoped NOT_APPLICABLE (no provider DENIED possible under the latter two). Signed receipt IDs, algorithm and canonicalization values are bound to externally pinned verifier profiles. The detailed unadopted contracts appear in `04B_INDEPENDENT_PROOF_VERIFIER_CANDIDATE_R3_1.md`; `04D` paper counterexamples remain unexecuted.

Until a new independent static re-review, status is **`AUTHOR_R3_1_CORRECTION_PROPOSED / DOCUMENT_READINESS_NOT_GRANTED`**. This addendum does not change the 27 Owner-pending effect selections, eight interface identities, D0–D13 future Gates, 16 base WPs + WP06a/b, 34 paper fixtures, signed Owner/Host/provider evidence deficiencies, or approved v5 mandatory fail-closed acceptance. It is **not** a R'/D'/P' revision or implementation grant.


## DP-R3.2 limited signed-integer identity correction — document-only, UNADOPTED

The independent DP-R3.1 review dated 2026-10-25 recorded **11 historical document YES, 1 PARTIAL**, identifying **FND-DPR31-NEW-001**: unbounded JSON integer epochs/DB sequences could lose distinguishability in RFC 8785/JCS IEEE-754 parsing. This is a **new author-only DP-R3.2 proposal**, not a runtime finding, adoption, completed interface freeze or Gate release. Previous R3.1 review-pending language is historical author-era text.

The **R3.2 candidate** `04A_TYPED_ENVELOPE_CANDIDATE_SCHEMA.json` encodes **all 19** previously unconstrained nonnegative integer fields (8 outer/legacy claimant and 11 verified_subject/policy/source fields) as lexical canonical unsigned decimal JSON strings with `^(0|[1-9][0-9]*)$`, length 1..128 ASCII digits, and exact arbitrary-precision semantics. Signed nanosecond fields remain canonical signed-int64 decimal strings with independently authenticated time-domain bounds. The `04` interface proposal, `04A` candidate schema, and `04B_INDEPENDENT_PROOF_VERIFIER_CANDIDATE_R3_2.md` jointly require authenticated claim/subject/source exact-value joins, proof-boundary and digest identity without any float/Number step. They forbid legacy R2/R3/R3.1 silent migration and require separate future approved verifier profiles.

This correction **does not** prove a cryptographic signer, actual provider pre-write veto, authorized profile, Host use, all-writers census, or future task authorization. Missing proof, source witness, or policy epoch remains `UNKNOWN/NOT_PROVEN/NO_CURRENT`; all approved v5 fail-closed duties, unselected DS/O decisions and historic STOPs remain in force.
