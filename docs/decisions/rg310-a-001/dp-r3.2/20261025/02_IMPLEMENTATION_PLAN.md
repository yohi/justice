# Justice RG-310-A-001 — Implementation plan proposal for C1-FULL candidate B-C1

**Version**: Candidate IP-R1, 2026-10-25 JST. **Status:** `IMPLEMENTATION_PLAN_DOCUMENTED_FOR_REVIEW_ONLY / NOT_AUTHORIZED_TO_EXECUTE / PREREQUISITES_OPEN`.

## 0. Scope and interpretation

This document specifies **how future work would be implemented and verified IF** the human Owner separately approves canonical O-01 and material R' requirements, independently reviewed D' and P', effective provider custody, and the relevant execution Gate. It does **not** authorize implementation, repository modification, CI/Host/DB/cloud tests, source rewrite, publisher changes, HSA issuance, or R11 approval. The user's 2026-10-25 approval is for design-and-plan authoring only.

The goal of this plan's present task is **completion of a precise, auditable design and implementation plan**, not proof of the hypothetical implementation. Design completeness ≠ formally approved plan ≠ executed/proven runtime.

## 1. Inputs, dependency DAG, stop barriers

Immutable inputs:

- Approved v5 R/D/P HEAD `8a2e4f1536e9cad499ee7e9d996ff163df132fd4`, with normative `JUS5-AUTH-01..09`, `JUS5-GATE-01/02`, `INV-03/04/05/06` unchanged.
- Task1 Evidence HEAD `c428041dfb5779b6b6dc8db7bf14928225a00373`, Task1 31/32, Case A and unknown-tool BLOCKED, Case B PROVEN, H0–H3 NOT_PROVEN.
- P1-P10 static reports and original R11 38×7, 22 Findings OPEN, NC37 NOT_EXECUTED; P10-A follow-up result SHA `194d601b9565f11a55817aa9897912b81375aea01b061cb412001fbecb8b9b55`.
- Owner-prep packet `e252ea48aa3a7e735757dd2208c2ae1b22e9697d0d9eb436cae1a4349099cf5c` with 27 scope candidates all UNSELECTED.

**Future Gate sequence — candidate planning DAG, not current authorization:**

```text
CURRENT DOC ONLY:
  DP-R1 DOCUMENT_AUTHORING -> FRESH_INDEPENDENT_DOCUMENT_REVIEW
    -> DOCUMENT_READINESS_PASS (only if reviewer accepts)

FUTURE CONDITIONAL AND SEPARATELY APPROVED:
  D0 authorized read-only source/provider-capability discovery
    -> D1 authenticated Owner effect/scope and DS selections (O-01; never inferred)
    -> D2 provider-custodian non-secret effective-rights export and feasibility STOP screen
    -> D3 proposed R' independently reviewed and human-adopted, if substantive
    -> D4 D' reconciled, independently reviewed and adopted
    -> D5 P' reconciled, independently reviewed and human-authorized for exact R'/D'/P' chain
    -> D6 AUTH_TO_IMPLEMENT (separate grant: exact branch/files/actors/side-effect class)
    -> D7 implementation and proposed offline fixture development (fixed source commit produced)
    -> D8 CODE_FIXED_HEAD_INDEPENDENT_STATIC_REVIEW (now real code exists)
    -> D9 AUTH_TO_TEST (new bounded grant; offline/controlled-provider/Host classes separately)
    -> D10 authorized tests and provider/Host boundary measurements
    -> D11 HOST_PROVIDER_BOUNDARY_ACCEPTANCE (requires D10 evidence; separate from D8)
    -> D12 independent evidence / readiness adjudication with all selected predicates
    -> D13 AUTH_TO_DEPLOY (explicit human grant; never implicit from D12)
```

**Non-circular ordering invariants:** D8 cannot gate D6/D7; D10/D11 cannot gate creation of their subject under D6/D7. Read-only discovery in D0/D2 documents *unknown* capabilities and may STOP a proposed design; a prior successful physical Host/provider proof is NOT required to draft R1 or obtain a strictly bounded implementation-only grant. D7 implementation has no automatic network/prod write rights. Source review D8, test authority D9, boundary acceptance D11, and deploy authority D13 are different artifacts with different issuers. All future nodes remain `NOT_AUTHORIZED` now.

### Planning task IDs versus formal Justice Tasks

The `DP-WP-*` IDs below are **planning work packages**, not authorization to execute Justice Tasks2–14. They are ordered descriptions with strict prerequisites. Proposed paths are *tentative file responsibilities*, not verified existing modules and not changes made today.

## 2. Implementation architecture and decomposition

| WP | Design/implementation work package | Proposed files/modules (not created) | Inputs / consumes → produces | Future tests/exit checks | Dependencies |
|---|---|---|---|---|---|
| DP-WP-00 | Baseline and canonical artifact fingerprint mapping | `docs/rg310/r-prime/`, `src/authority/artifact-chain.ts` (proposed) | signed R'/D'/P' pins → verified canonical clause/source/plan identity | stable hash/projection, invalid substantive delta refuses authorization; no historical R11 rewrite | D1/D3/D4/D5; implementation separately D6 |
| DP-WP-01 | Implement effect-policy and actor/credential census | `src/authority/effect-scope.ts`, `docs/rg310/effect-census.csv` (proposed) | Owner-approved E01–E27 decisions and provider rights export → versioned effect class, deny semantics, writer enumeration | every legitimate first effect mapped; no silent excluded row; inaccessible actor = NOT_VERIFIED | DP-WP-00, O-01..06 |
| DP-WP-02 | Provider protection / reference monitor adapters | `src/authority/provider-policy/`, `src/authority/first-write-guard.ts` | effective branch/tag/ruleset/package/CI policies + scope → evidence of prior veto per provider effect | alternate App/PAT/admin and protected tag-before-pack deny or STOP | DP-WP-01; D2 discovery only, no premature D11 requirement |
| DP-WP-03 | Issuer/revocation order + epoch and pre-effect freshness | `src/authority/issuer-order.ts`, `src/authority/revocation.ts` | authenticated revoke, fence, channel set → monotone verified checkpoint and blackout | issuer issue before DB commit; detached grant; interval crosses expiry ⇒ BLOCK/UNKNOWN | DP-WP-00, DS-03, O-07 |
| DP-WP-04 | DB private durable authority | `src/authority/durable-ledger.ts`, `migrations/rg310_*` (proposed) | approved candidate, canonical exact bytes, term/seq/epoch → PRIVATE `DB_COMMITTED_UNSEALED` receipt | actual durable commit bound check; ACK lost; DB rollback; no public accepted projection | DP-WP-03, DS-04 |
| DP-WP-05 | Independently verified seal/readback | `src/authority/sealer-adapter.ts` | exact committed byte/root and independent signer scope → sealed proof or refusing/unknown state | signer refuse, orphan seal, key epoch mismatch, ACK unknown ⇒ private quarantine | DP-WP-04, DS-04 |
| DP-WP-06 | **Split:** private unsealed/SEALED_PRIVATE projection (WP06a); final lifecycle certification predicate (WP06b) | `src/authority/visibility-projection.ts` (proposed) | WP06a: DB/seal -> strictly private observable state with no CURRENT. WP06b: exact adopted v5 floor + authenticated Owner effect set + all per-effect remote reconciliation + supported Host at-use + issuer/fence + evidence provenance -> `CERTIFIED_CURRENT` or typed `UNKNOWN/NO_CURRENT` | Forbid CURRENT for unsealed, REMOTE_UNKNOWN, missing identity or any selected Host without attestation. WP06b consumes typed closure from WP11, WP12, WP13, WP14, not a bare seal | WP06a: WP00,WP05; WP06b: WP06a,WP11,WP12,WP13,WP14 |
| DP-WP-07 | Per-effect grant and attempt identity | `src/authority/effect-grant.ts`, `src/authority/effect-attempt.ts` | owner-protected effect, epoch/freshness, first writer identity → one-shot attempt nonce / denied | replay/stale grant; earlier release-please; alternate token ⇒ no protected write | DP-WP-02, DP-WP-05, DP-WP-03 |
| DP-WP-08 | Immutable builder + artifact inventory | `scripts/certified-build/`, `src/release/artifact-manifest.ts` | fixed source/lock/toolchain/native → single JS/native/tarball content-addressed manifest | build provenance; native file contained; pack **once**, no digest substitution | DP-WP-00, DP-WP-05 |
| DP-WP-09 | GitHub release first-effect split | `.github/workflows/release.yml`, `src/release/github-provider.ts` (proposal only) | approved effect grant and immutable manifest → protected PR/tag/release/asset mutation with readback | no unmediated release-please first mutation; tag OID/readback/ref status; mismatched tag quarantined | DP-WP-02, DP-WP-07, DP-WP-08 |
| DP-WP-10 | Registry publication and exact-byte readback | `src/release/registry-provider.ts`, `scripts/certified-publish/` | exact one-time tarball and scoped grant → GitHub Packages receipt, remote verification or UNKNOWN | alternate publisher/PAT denied; remote may not expose bytes => no false byte proof; no blind retry | DP-WP-07, DP-WP-08, O-05 |
| DP-WP-11 | Remote-effect recovery/ACK reconciliation | `src/authority/effect-reconciler.ts`, `src/authority/high-water.ts` | remote receipts, attempted nonce, independent high-water and fences → REMOTE_CONFIRMED/UNKNOWN/QUARANTINED | timeout after effect; duplicate; restore behind ACK; old primary recovery | DP-WP-07, DP-WP-09, DP-WP-10, O-07 |
| DP-WP-12 | Supported Host actual-use verification | `src/runtime/host-attestation.ts`, `src/runtime/native-load-attestor.ts` (proposed) | installed content, trusted loader/OS, H0..H3 proof, use-time map → exact JS/native use certificate or NOT_ATTESTED | native replacement between install/use; direct import; unknown origin → BLOCKED | DP-WP-08; DP-WP-11; DS-05; real Host verification future D9-D11 |
| DP-WP-13 | Doctor/status/filesystem effect classification | `src/runtime/justice-tools.ts`, `src/runtime/doctor-cli.ts`, `src/runtime/state-projection-cache.ts` (existing code, future review only) | effect catalog, read vs FS write vs child/network import → declared observed effect proof | `justice_status` cache write not mislabelled pure read; doctor child/native FD bypass exposed | DP-WP-01, DP-WP-12 |
| DP-WP-14 | Evidence ledger/audit/negative oracle runner | `src/authority/evidence-register.ts`, `tests/rg310/` (proposed) | Source/witness/effect identities and negative oracles -> append-only provenance, typed per-proof verification states, all 22/37 historical crosswalks | Missing original proof or placeholder/hash-join sentinel yields NOT_VERIFIED; do not promote any NC status | WP00..05, WP06a, WP07..13 (not WP06b) |
| DP-WP-15 | Independently reviewed rollout/reversion plan | `docs/rg310/rollout.md`, `docs/rg310/cutover.md` (proposed) | successful prior stage Gates, policy/credential/host proofs → migration/checklist and rollback | freeze on unknown remote, stale issuer, unsupported host; no destructive auto rollback of external effect | DP-WP-06b; DP-WP-14 (separate D8 and D11 after code/test) |

**Files are proposals**; before actual development P' must validate current repository paths, exact method signatures, dependency assumptions, tests and owner boundaries, then obtain explicit authorizations. No source modifications are authorized by this document.

## 3. Workstream order with review gates

**Phase D (in CURRENT scope: documentation work only):**

D-01. Preserve source/evidence baselines and their SHA chains; classify normative provenance. Deliverable: stable references and non-regression traceability.

D-02. Fully specify the 27 candidate effect coverage and recommended protection *proposal* (not Owner selection). E01..27 remain UNSIGNED and not certified exhaustive. Deliverable: effect matrix.

D-03. Resolve assumptions as explicit Decision Required records for DS-01..06/O-01..07; provide R' delta draft without representing it as adopted. Deliverable: decision register and proposed normative change list.

D-04. Specify candidate B-C1 trust boundaries, eight interfaces, states, authorization/evidence semantics, recovery, build/Host chain. Deliverable: design R1 and machine-readable **candidate only** interfaces.

D-05. Specify every implementation WP with inputs, proposed file responsibilities, dependency, non-regression tests and expected fail-closed outcomes. Deliverable: this plan, test matrix, requirements/Findings trace.

D-06. Fresh independent architecture and implementation-plan review; resolve findings with scoped revisions. Deliverable: reviewer adjudication on candidate R1; **review acceptance is not Owner adoption**.

**Phases E–F are NOT part of today's authorized work**; listed solely so the implementation plan can be evaluated:

E-01. Authenticated Owner scope DS decision and approved R' if material.
E-02. Provider-custodian O-02..07 effective rights/non-secret export and third-party Host proof discovery.
E-03. Normative D' and P' independent review and explicit Owner authorization bound to exact byte identities.
F-01. Implementation WPs **only after D6 AUTH_TO_IMPLEMENT**, followed by D8 code review and separately scoped D9 test grant, isolated from documentation archive branches.
F-02. Separate fixed-head independent code review, authorized offline tests and provider/HOST test grants.
F-03. Independent evidence acceptance; no early certification based on test simulation.

## 4. Planned negative tests and deterministic failure outcomes

See `06_FALSIFIABLE_TESTS_AND_GATES.csv`. Tests are *specified* only. Execution state is `NOT_EXECUTED` for every DP test. Static checks may use read-only source snapshots; dynamic tests demand future separately granted instrumentation/fixtures/credentials. The expected outcome of unverified proof is always BLOCKED/UNKNOWN/QUARANTINED, not permission.

Mandatory representative tests and expected assertions:

- PR/tag created before grant: provider denial or **design NO_GO** if writer remains capable.
- `npm pack --dry-run` succeeds, release tag already created: never claim prior denial.
- `DB_COMMITTED_UNSEALED` plus signer refuses: no current accepted view, no publish grant.
- issuer revoke at t0, detached writer commits at t1 before fence: strict semantics blocked/unproven; alternative blackout only after adopted R'.
- COMMIT timestamp interval straddles expiry: UNKNOWN, not acceptance.
- GitHub Release returns 5xx after provider write: `REMOTE_UNKNOWN`; reconcile by verified remote readback, never blind retry.
- Exact tarball digest differs from remote asset or registry readback unavailable: no certified equality.
- Host verified install followed by mutable native `.node` replacement before use: fail actual-use attestation.
- Restore DB state n < independently attested high-water k, old primary still holds writer credential: `NO_CURRENT / NO_WRITES`.
- `justice_status` writes projection cache and doctor dynamic import: classify as actual FS/child/process effect; absence of proven tool write mediation remains a blocked proof.

## 5. Entry/exit definitions for design-and-plan completion

**Author-draft ready for fresh independent document review** if and only if:

1. Approved and proposal normative sources are separate with exact SHA and clauses; user scope limitation explicit.
2. All 27 current effect categories are represented with Owner disposition still pending, appropriate proposed assurance targets, and no silent C2 narrowing.
3. Eight candidate interface semantics, two-stage protocol/failure paths, releases first-write prevention, immutable bytes, supported host use-time, recovery/fencing and provenance are described.
4. Each future implementation WP has clear inputs/outputs, dependencies, proposed file areas, test oracles and future approval barriers.
5. A/B and U-07 conditions are bounded, R11 original 38×7 and 22 Findings / NC37 unchanged, P2–P4 STOP maintained.
6. A fresh independent reviewer can falsify design claims using documented evidence and can see every assumption marked PENDING/NOT_VERIFIED.

**Not** a criterion: running CI, enabling branch protection, secrets exports, granting O-01 signature, adopting R', or building code. These are outside this task and must not be performed.

**Cannot declare** implementation-ready / deployment-ready / formal Gate PASS while O-01..07 / DS approvals/physical prior veto/Host use proof remain unverified.

## 6. Rollout and governance constraints (hypothetical future only)

- No `master`/package/Release/provider credentials modified as part of this design task.
- No plugin/native loader monkeypatch, CI release changes or process-control instrumentation unless a future grant covers exact files, actor, environment, time and evidence handling.
- No creation of test CI artifacts claimed to be non-effects: GitHub Actions artifacts, SARIF, Codecov/SonarCloud and Dependabot are provider-visible actions and must be categorized.
- Do not create an implementation PR by assuming PR #325 draft evidence archive is an approved implementation branch.
- A future plan update must be reconciled to current code and exact adopted R'/D' bytes; stale fixed Task1 Head is evidence pin, not implicit base for new production changes.
- Unknown evidence never satisfies 31/32 remaining Case A or H0–H3.

## 7. Output and approval semantics

**Historical R1 author-era statement:** the deliverable at that time was an author-draft R1 implementation plan for independent document review; `AUTHOR_DRAFT_COMPLETE_FOR_REVIEW` is a *document-status* label, not Justice acceptance or execution GO. All later work packages remain **NOT_AUTHORIZED**. The user may approve further review or change a research preference without this draft automatically becoming a signed Owner artifact.

## 8. R1 implementation contract precision / proposed dependencies

`11_WP_IMPLEMENTATION_CONTRACTS_R1.csv` is the authoritative **candidate planning** register for WP00–15, with WP06a/06b split. Each row names typed consumes/produces, source custody, proposed file presence, T IDs, negative oracle, and the *future* Gate. No row authorizes execution. A proposed path marked `FUTURE_ONLY_UNVERIFIED` is not represented as present at the pinned source HEAD.

The topological relationship is: `WP00→WP01→WP02`; `(WP00,WP03)→WP04→WP05→WP06a`; `(WP02,WP03,WP05)→WP07`; `(WP00,WP05)→WP08`; `(WP02,WP07,WP08)→WP09/10→WP11`; `(WP08,WP11)→WP12`; `(WP01,WP12)→WP13`; `(WP00..05,WP06a,WP07..13)→WP14`; `(WP06a,WP11,WP12,WP13,WP14)→WP06b`; `(WP06b,WP14)→WP15`. Each future WP requires D6 AUTH_TO_IMPLEMENT. Provider/Host effects and test calls independently require D9; passing D8 does not grant D9.

### WP06a / WP06b exact separation

- **WP06a**: internal read model may report `DB_COMMITTED_UNSEALED`, `SEALED_PRIVATE`, `REMOTE_UNKNOWN`, etc., **as private diagnostic states**. It MUST never emit certified `CURRENT`, Justice `Accepted`, `Verified`, `Authorized`, or `Complete` merely on private seal.
- **WP06b**: require an authenticated canonical Owner policy and an explicit set `Required(e,p)` for *each* selected effect and predicate. Evaluate `CERTIFIED_CURRENT` iff 
  `ApprovedV5Floor ∧ ExactChainAuthorized ∧ CandidateDurablyProven ∧ SealVerified ∧ RevocationAndRecoveryFresh ∧ EffectiveWriterDenialProvenForEverySelectedPreEffect ∧ RemoteProofsClosed ∧ RequiredHostUseProven ∧ EvidenceProvenanceValid ∧ NoUnknownOrConflict`.
- `RemoteProofsClosed` requires a typed, per-object provider receipt/readback for **every** selected external effect. If the Owner did not select remote physical-veto assurance, this does not erase the already approved v5 acceptance requirement. `Required(e,p)` cannot convert a missing approved-v5 proof into optional evidence.
- `UNKNOWN`, `IN_DOUBT`, `CONFLICT`, missing policy selection, missing proof, a disputed imported timestamp, or uncensused alternative writer always prevents `CERTIFIED_CURRENT` and protected first-write claims. A seal alone is **insufficient**.

### Per-WP evidence and hypothetical future grants

- D0–D5 are *planning/discovery/authorization* prerequisites; design edits require neither code review nor Host boundary tests.
- D6 grants implementation-only source modifications on separately named future branch; no delegated provider credentials or released files implied.
- D8 examines created fixed-head code; it cannot be fulfilled using this R1 document or the existing Task1 evidence source pin.
- D9 grants offline/model tests only as a base case, then separately scoping any real CI/provider/Host test effect; a provider-visible SARIF/artifact counts as a write.
- D11 requires independent boundary evidence actually collected after D9; `EVIDENCE_MISSING` is not `REVIEW_FAIL` of this static document, but is a runtime/deployment STOP.
- D12/13 are subsequent independent acceptance/human execution decisions; this document confers none.

## 9. Planned exact-byte / remote proof chain

Candidate byte chain has **independent identities**, not one alias: `source_tree_oid`, `lock_digest`, `toolchain_image_digest`, `built_js_digest`, `built_native_digest`, `local_tarball_sha256`, `registry_remote_tarball_or_provider_attested_equivalent`, `tag_ref_oid + peeled_commit_oid + immutable_expected_target`, `release_object_id+version`, `release_asset_id+remote_sha256`, `host_loaded_js_measurement`, `host_loaded_native_measurement`. If an API exposes metadata only, record `REMOTE_BYTE_IDENTITY_NOT_ATTESTABLE` and `NO_CURRENT` for any Owner-selected byte-equivalence duty. An npm registry metadata digest is not a proof of remotely read raw bytes unless the provider's binding contract has been separately verified. The release asset **MUST NOT** be created via a new independent `npm pack` for a claimed same-blob chain.

## 10. Design-and-plan readiness versus future implementation readiness

`AUTHOR_DRAFT_COMPLETE_FOR_REVIEW` means R1 author believes the document is reviewable. A fresh independent static reviewer alone can emit `DOCUMENT_READINESS_PASS`. Only a separately signed exact-R'/D'/P' Owner adoption could subsequently authorize a bounded future implementation phase. Neither is present in this historical R1 author draft. All 34 revised T-case entries are falsifiable **design oracles**, not executions of NC37 or provider tests.

### Paper-fixture verification scope (author R1)

`15_DETERMINISTIC_PAPER_FIXTURES_CANDIDATE.json` fixes synthetic ordered event and epoch values for each of T01–T34. These fictional fixture values are only static input proposals. The witness identity and test execution result remain NOT_VERIFIED/NOT_EXECUTED. No supposed “independent observer” has been created.


## DP-R2 limited work-package document additions — not implementation authority

- `DP-WP-02/07/09`: Consume the E01–E15 `10_...R2.csv` conditional mechanism and writer-census contract; do not assume GitHub/Packages/Codecov/SonarCloud expose a native root-scoped first-write reference monitor. At `D0/D1` record capability as `NOT_OBSERVED` or `UNSUPPORTED_AS_REQUIRED`. Under any subsequently Owner-selected strict physical denial obligation, an unmatched effective writer or unavailable causal provider refusal is an **early `UNENFORCEABLE_AS_PROPOSED` STOP**. Do not assign future implementation paths or policy changes until explicit Owner-authorized later Gates.
- `DP-WP-03/04/05`: Align 8 candidate interface results to 04/04A/04B. A schema-valid PROVEN or DENIED claim is untrusted; independent proof-verifier validation is mandatory; comparison of lower/upper and common time domain is semantic, not covered by JSON Schema.
- `DP-WP-15`: Treat 34 R2 paper fixtures as frozen **synthetic** negative oracle specifications. T07 temporal interval and T34 signer key-vs-seal epochs are explicit; 15A audits the other 32 without claiming runtime or cryptographic test execution. Future controlled tests require separately granted D9 and genuine independent providers; no such Gate is passed.
- Preserve non-circular D0→D13 future Gate order, WP06a private/WP06b certified split, approved v5 JUS5-GATE-02 / INV-04 floor, and the individual original 22/NC37 mappings. No Gate or interface is frozen by this edit.


## DP-R3 candidate implementation-plan contract correction — no implementation authorized

DP-WP-03/04/05 and the certified evaluator DP-WP-06b must consume the **externally issued authenticated** `04A.canonical_verification_receipt` and the `04B ... R3` verifier profile as future **typed** inputs. Explicitly split `ClaimantResponse` (untrusted PROVEN/DENIED strings) from `IndependentVerifiedPredicateReceipt` (signed, canonical byte-bound result) and `CertificationDecision` (full WP06b conjunction): these are three different output types.

The future verifier must load independently provisioned Owner-approved trust roots, verify raw witness bytes/hash, sign/cross-bind immutable request↔attempt or no-attempt predicate, exact resource/principal/policy+epoch/effect/root, replay domain, keys, time source and causal order. Each failed predicate becomes `UNKNOWN/NO_CURRENT`, not a synthetic `DENIED` implying physical pre-write veto. Future tests must separately cover paper-only R3-NEG-01..08 after a future granted D9; **none executed**.

DP-WP-02/07/09 still require capability and effective-writer census for all chosen strict effects. Any unproven provider causal veto remains `UNENFORCEABLE_AS_PROPOSED` irrespective of a locally signed or structurally valid receipt. No changes to D0..D13, WP06a/private vs WP06b/certified dependency closure, 34 historical T tests, 27 effects, 16 WP base ids, 22 Finding/NC37 status, or O/DS decisions.

**Current R3 document state:** `AUTHOR_R3_DRAFT_COMPLETE_FOR_REVIEW / INDEPENDENT_DOCUMENT_REVIEW_NOT_YET_RUN`. R2 independent review: 11 YES / 1 PARTIAL, sole remaining FND-DPR0-004. This plan is neither an implementation grant nor `DOCUMENT_READINESS_PASS`.

## DP-R3.1 bounded verifier receipt clarification (author candidate, not adopted)

HISTORICAL R3.1 AUTHOR-ERA TEXT (superseded by DP-R3.2 addendum below): The DP-R3 independent review (2026-10-25) awarded eleven documentary YES, one PARTIAL (`FND-DPR0-004`). The present R3.1 author-only correction is not an independent pass. Canonical candidate interface version is **`CANDIDATE_DP_R3_1`** in both `04` and `04A`; older R2/R3 message versions have no implicit conversion. The signed subject's nanosecond interval bounds are canonical **decimal JSON strings**, exactly range-checked outside schema. The `request_attempt_binding_sha256` hashes separately authenticated typed external-attempt **or no-external-predicate** canonical binding documents; no physical attempt is invented for issuer/DB/signer/Host-local observations. The signed policy identity is discriminated as provider, internal, or precisely scoped NOT_APPLICABLE (no provider DENIED possible under the latter two). Signed receipt IDs, algorithm and canonicalization values are bound to externally pinned verifier profiles. The detailed unadopted contracts appear in `04B_INDEPENDENT_PROOF_VERIFIER_CANDIDATE_R3_1.md`; `04D` paper counterexamples remain unexecuted.

Until a new independent static re-review, status is **`AUTHOR_R3_1_CORRECTION_PROPOSED / DOCUMENT_READINESS_NOT_GRANTED`**. This addendum does not change the 27 Owner-pending effect selections, eight interface identities, D0–D13 future Gates, 16 base WPs + WP06a/b, 34 paper fixtures, signed Owner/Host/provider evidence deficiencies, or approved v5 mandatory fail-closed acceptance. It is **not** a R'/D'/P' revision or implementation grant.


## DP-R3.2 limited signed-integer identity correction — document-only, UNADOPTED

The independent DP-R3.1 review dated 2026-10-25 recorded **11 historical document YES, 1 PARTIAL**, identifying **FND-DPR31-NEW-001**: unbounded JSON integer epochs/DB sequences could lose distinguishability in RFC 8785/JCS IEEE-754 parsing. This is a **new author-only DP-R3.2 proposal**, not a runtime finding, adoption, completed interface freeze or Gate release. Previous R3.1 review-pending language is historical author-era text.

The **R3.2 candidate** `04A_TYPED_ENVELOPE_CANDIDATE_SCHEMA.json` encodes **all 19** previously unconstrained nonnegative integer fields (8 outer/legacy claimant and 11 verified_subject/policy/source fields) as lexical canonical unsigned decimal JSON strings with `^(0|[1-9][0-9]*)$`, length 1..128 ASCII digits, and exact arbitrary-precision semantics. Signed nanosecond fields remain canonical signed-int64 decimal strings with independently authenticated time-domain bounds. The `04` interface proposal, `04A` candidate schema, and `04B_INDEPENDENT_PROOF_VERIFIER_CANDIDATE_R3_2.md` jointly require authenticated claim/subject/source exact-value joins, proof-boundary and digest identity without any float/Number step. They forbid legacy R2/R3/R3.1 silent migration and require separate future approved verifier profiles.

This correction **does not** prove a cryptographic signer, actual provider pre-write veto, authorized profile, Host use, all-writers census, or future task authorization. Missing proof, source witness, or policy epoch remains `UNKNOWN/NOT_PROVEN/NO_CURRENT`; all approved v5 fail-closed duties, unselected DS/O decisions and historic STOPs remain in force.
