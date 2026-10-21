# RG310 R11 38×7 compatibility and future R'/D'/P' deltas (NOT ADOPTED)

**Original invariant:** original `04-authorization-fingerprint-transition-matrix-R11.md` exact bytes SHA-256 `10b24dd4175ee2d5aae7929f8057355ce27e4db129480830549d756802010923` (inside nested `context/r11_architecture_original_proposal.zip`). **UNMODIFIED**. This document reproduces the 38×7 source rows below *for audit*, and proposes no automatic changes to those cells. No HSA, proof of actual phase PASS, and no invocation of HOST or CI.

## 1. Current decision and source hierarchy

- Current R11 status `UNAPPROVED`. `ARCHITECTURAL_REDESIGN_REQUIRED` applies to the proposed B1/B2 storage-Gateway model **as mapped over current legitimate direct consumers**. It is not a rejection of the existing Task1 evaluator nor an implicit amendment of R11.
- Existing approved baseline R'/D'/P' `8a2e4f1536e9cad499ee7e9d996ff163df132fd4` unchanged; PR #295 actual evidence `c428041dfb5779b6b6dc8db7bf14928225a00373` Task1 `31/32`, `Case A BLOCKED`, `Case B PROVEN`, `unknown-tool BLOCKED`. B-001/B-002 canonical/runtime boundaries separately unresolved. PR #325 `2db995625e37c0573dcafe62ba0cd60e54e9ce0a` is draft candidate evidence, not an approved authority.
- R11 governance Option B (staged authorization) and storage candidate A/B are orthogonal; C1 is a proposed redesigned storage/consumer flow, not a third authorization Option.

## 2. Original 38-state × seven axes: exact original rows (read-only reproduction)

Columns are: operation stage | grant | evidence applicability | next permitted action | human decision | fail-closed | proof obligation. The leftmost column is original state/input ID; a reader MUST interpret future conditional PASS/ACTIVE as hypothetical, never today's state. Content below is copied programmatically from the verified original, not reworded.

| R11 row / input | operation stage | grant | evidence applicability | next permitted action | human decision | fail-closed | proof obligation |
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

## 3. 38-row independent *candidate impact*, without altering 7 source axes

`REDESIGN_NEEDED` indicates a collision between the R11 proof requirement and the *existing* source/consumer/remote-effect and/or proposed single-DB domain; `CONDITIONAL_COMPATIBLE_NO_PROOF` is textual compatibility only; `EXTERNAL_OPEN_NO_DB_SUBSTITUTE` is intentionally outside B1/B2. All 38 rows retain the seven axes above.

| R11 row | Impacted trust edge | Verdict | Proposed treatment (not adopted) |
|---|---|---|---|
| 01 | AUTHORITY_CONSUMERS,PROOF,TIME | REDESIGN_NEEDED | R/D/P delta candidate; no original state change |
| 02 | ROOT,REVOCATION,FENCING | REDESIGN_NEEDED | R/D/P delta candidate; no original state change |
| 03 | TCB,TOCTOU | REDESIGN_NEEDED | R/D/P delta candidate; no original state change |
| 04 | PACKAGE,HOOKS | REDESIGN_NEEDED | R/D/P delta candidate; no original state change |
| 05 | COMMIT_ATTESTATION | REDESIGN_NEEDED | R/D/P delta candidate; no original state change |
| 06 | EXPIRY_RACE | REDESIGN_NEEDED | R/D/P delta candidate; no original state change |
| 07 | CLOCK_ISSUER | REDESIGN_NEEDED | R/D/P delta candidate; no original state change |
| 08 | INDEPENDENT_PROOF | REDESIGN_NEEDED | R/D/P delta candidate; no original state change |
| 09 | ATTEMPT_TERMINALS | REDESIGN_NEEDED | R/D/P delta candidate; no original state change |
| 10 | PROOF_ROOTS | REDESIGN_NEEDED | R/D/P delta candidate; no original state change |
| 11 | PHASE_CLOSE | REDESIGN_NEEDED | R/D/P delta candidate; no original state change |
| 12 | HIST_TIME | CONDITIONAL_COMPATIBLE_NO_PROOF | Existing typed decision preserved; no adoption |
| 13 | EAF_NOT_GRANT | CONDITIONAL_COMPATIBLE_NO_PROOF | Existing typed decision preserved; no adoption |
| 14 | PHYSICAL_EFFECT_FENCE | CONDITIONAL_COMPATIBLE_NO_PROOF | Existing typed decision preserved; no adoption |
| 15 | NEW_ATTEMPT | CONDITIONAL_COMPATIBLE_NO_PROOF | Existing typed decision preserved; no adoption |
| 16 | DEP_LATCH_PROOF | REDESIGN_NEEDED | R/D/P delta candidate; no original state change |
| 17 | DENY_DEP | CONDITIONAL_COMPATIBLE_NO_PROOF | Existing typed decision preserved; no adoption |
| 18 | DEP_LOCK_SNAPSHOT | REDESIGN_NEEDED | R/D/P delta candidate; no original state change |
| 19 | SECOND_DEP_GRANT_TIME | REDESIGN_NEEDED | R/D/P delta candidate; no original state change |
| 20 | PROHIBITED_HUNKS | REDESIGN_NEEDED | R/D/P delta candidate; no original state change |
| 21 | DEP_EXPIRY | REDESIGN_NEEDED | R/D/P delta candidate; no original state change |
| 22 | PENDING_CLOSE | REDESIGN_NEEDED | R/D/P delta candidate; no original state change |
| 23 | HOST_PREP_NO_RUN | REDESIGN_NEEDED | R/D/P delta candidate; no original state change |
| 24 | REMOTE_HOST_AND_EXPORT | REDESIGN_NEEDED | R/D/P delta candidate; no original state change |
| 25 | IMMUTABLE_FREEZE | REDESIGN_NEEDED | R/D/P delta candidate; no original state change |
| 26 | MISMATCH_STOP | CONDITIONAL_COMPATIBLE_NO_PROOF | Existing typed decision preserved; no adoption |
| 27 | RA_INDEPENDENCE | CONDITIONAL_COMPATIBLE_NO_PROOF | Existing typed decision preserved; no adoption |
| 28 | RA_FAIL_NOT_REVOKE | CONDITIONAL_COMPATIBLE_NO_PROOF | Existing typed decision preserved; no adoption |
| 29 | RA_UNKNOWN | CONDITIONAL_COMPATIBLE_NO_PROOF | Existing typed decision preserved; no adoption |
| 30 | NEW_ATTEMPT_EAF | CONDITIONAL_COMPATIBLE_NO_PROOF | Existing typed decision preserved; no adoption |
| 31 | ACTIVATE_MISSING | CONDITIONAL_COMPATIBLE_NO_PROOF | Existing typed decision preserved; no adoption |
| 32 | HOST_REVOKE_AND_TIME | REDESIGN_NEEDED | R/D/P delta candidate; no original state change |
| 33 | WRONG_EAF | CONDITIONAL_COMPATIBLE_NO_PROOF | Existing typed decision preserved; no adoption |
| 34 | A1_H0_OPEN | EXTERNAL_OPEN_NO_DB_SUBSTITUTE | Existing typed decision preserved; no adoption |
| 35 | G1_G2_ORIGIN_OPEN | EXTERNAL_OPEN_NO_DB_SUBSTITUTE | Existing typed decision preserved; no adoption |
| 36 | TASK1_CASE_A_BLOCKED | EXTERNAL_OPEN_NO_DB_SUBSTITUTE | Existing typed decision preserved; no adoption |
| 37 | PRODUCT_I_SEPARATE | EXTERNAL_OPEN_NO_DB_SUBSTITUTE | Existing typed decision preserved; no adoption |
| 38 | HISTORIC_DEP_RECEIPTS | REDESIGN_NEEDED | R/D/P delta candidate; no original state change |

## 4. INV-A01..A14 preservation audit

| Original invariant ID | Candidate assessment | Normative delta rule |
|---|---|---|
| INV-A01 | RETAIN_TYPED_NON_REGRESSION; B1/B2 cannot self-certify | Original meaning and required evidence unchanged; independently cross-check original exact passage and relevant phase/Gate. |
| INV-A02 | RETAIN_TYPED_NON_REGRESSION; B1/B2 cannot self-certify | Original meaning and required evidence unchanged; independently cross-check original exact passage and relevant phase/Gate. |
| INV-A03 | RETAIN_TYPED_NON_REGRESSION; B1/B2 cannot self-certify | Original meaning and required evidence unchanged; independently cross-check original exact passage and relevant phase/Gate. |
| INV-A04 | RETAIN_TYPED_NON_REGRESSION; B1/B2 cannot self-certify | Original meaning and required evidence unchanged; independently cross-check original exact passage and relevant phase/Gate. |
| INV-A05 | RETAIN_TYPED_NON_REGRESSION; B1/B2 cannot self-certify | Original meaning and required evidence unchanged; independently cross-check original exact passage and relevant phase/Gate. |
| INV-A06 | RETAIN_TYPED_NON_REGRESSION; B1/B2 cannot self-certify | Original meaning and required evidence unchanged; independently cross-check original exact passage and relevant phase/Gate. |
| INV-A07 | RETAIN_TYPED_NON_REGRESSION; B1/B2 cannot self-certify | Original meaning and required evidence unchanged; independently cross-check original exact passage and relevant phase/Gate. |
| INV-A08 | RETAIN_TYPED_NON_REGRESSION; B1/B2 cannot self-certify | Original meaning and required evidence unchanged; independently cross-check original exact passage and relevant phase/Gate. |
| INV-A09 | RETAIN_TYPED_NON_REGRESSION; B1/B2 cannot self-certify | Original meaning and required evidence unchanged; independently cross-check original exact passage and relevant phase/Gate. |
| INV-A10 | RETAIN_TYPED_NON_REGRESSION; B1/B2 cannot self-certify | Original meaning and required evidence unchanged; independently cross-check original exact passage and relevant phase/Gate. |
| INV-A11 | RETAIN_TYPED_NON_REGRESSION; B1/B2 cannot self-certify | Original meaning and required evidence unchanged; independently cross-check original exact passage and relevant phase/Gate. |
| INV-A12 | RETAIN_TYPED_NON_REGRESSION; B1/B2 cannot self-certify | Original meaning and required evidence unchanged; independently cross-check original exact passage and relevant phase/Gate. |
| INV-A13 | RETAIN_TYPED_NON_REGRESSION; B1/B2 cannot self-certify | Original meaning and required evidence unchanged; independently cross-check original exact passage and relevant phase/Gate. |
| INV-A14 | RETAIN_TYPED_NON_REGRESSION; B1/B2 cannot self-certify | Original meaning and required evidence unchanged; independently cross-check original exact passage and relevant phase/Gate. |

Actual original INV text and statement precedence are in the immutable R11 proposal; this is a trace coverage index, **not** a substitute or literal redefinition of any INV. Particularly INV-A07 runtime/I separation and all other invariants retain their existing provisional status. Any apparent normative contradiction must be submitted as redline proposal before adoption.

## 5. Candidate Requirements → Design → Plan changes in permitted order

| Stage | Candidate delta ID | Target / exact prospective change | Type and dependencies | Status |
|---|---|---|---|---|
| R' (human-owned) | R-C1-01 | Define public accepted authority namespace and enumerate all legitimate readers/write/effect edges including Git/worktree/JSONL/CI/npm host; mark ordinary product domain exclusion explicitly if selected | AUTHORITY_SCOPE; resolves NEW-015 | PROPOSED_ONLY |
| R' | R-C1-02 | Decide strict source-time versus fence-effective revoke; preserve authenticated source order and stop on message loss | ORDER_SEMANTICS; NEW-016 | PROPOSED_ONLY |
| R' | R-C1-03 | State whether trusted expiry requires COMMIT-attested instant or redesign as a pre-committed cancellable operation protocol; `now()` not sufficient | TRUSTED_TIME; NEW-017 | PROPOSED_ONLY |
| R' | R-C1-04 | State whether independent signed external proof must be single-domain atomic or if two-threshold sealed visibility is accepted as a normative *replacement*, with proof conditions | FORMAL_EQUIVALENCE; NEW-018 | PROPOSED_ONLY |
| R' | R-C1-05 | Require physically fenced primary, monotonic ACK prefix, no unverified restore, independently reconstructible terminal history | RECOVERY; NEW-020/021 | PROPOSED_ONLY |
| D' after R' | D-C1-01 | Bind consumer census to exact R11 authority, `READ_CURRENT` vs `HISTORIC_PIN`, immutable materialization at actual build/host use | IMPACTS CURRENT DIRECT SOURCES; NEW-015/019 | PROPOSED_ONLY |
| D' | D-C1-02 | Define TCB owners/OS principals, children, mount, FDs, network, remote publisher and signed operation protocol; prohibit actor root | NEW-022; NEVER SUBSTITUTE 6 TOOL POLICY | PROPOSED_ONLY |
| D' | D-C1-03 | Define DB transaction schema, `acceptedSeq` vs `attemptSeq`, terminal reconciliation, failure states, independent witness and physical fencing | NEW-018/020/021 | PROPOSED_ONLY |
| D' | D-C1-04 | Select explicit time/revoke/effect serialization mechanism or abandon C1 if unavailable | NEW-016/017; unknown ⇒ STOP | PROPOSED_ONLY |
| P' after D' | P-C1-01 | Offline proof obligations: static full consumer graph, path-to-enforcer table, canonical JSON/manifest encodings, symbolic counterexamples NC-01..37 | NO HOST/DB/CLOUD ACTION BY THIS PLAN | PROPOSED_ONLY |
| P' | P-C1-02 | Future separately authorized implementation/evaluation slices after valid R'/D'/P' chain and owner decisions; no automatic phase HSA | B0→B1→B2-DEP→B2-HOST unchanged | PROPOSED_ONLY |
| P' | P-C1-03 | Independent future validation of frozen build/use, committed-vs-signed proof, ACK high-water, restore and primary fence | CONCRETE PROTOCOL TESTS; NOT RUN | PROPOSED_ONLY |
| P' | P-C1-04 | Separate A1 host H0 pre-run/true G1/G2 origin and existing Task1 Case A, B-001/B-002; no edge into Task1 mandatory Gate from B1/B2 | EXTERNAL DEP; no Task1 PASS | PROPOSED_ONLY |

## 6. Phase/typed separation — compatibility and collision

| Phase / type | Conserved original semantics | C1 collision / must-not-infer |
|---|---|---|
| IAB / baselineId | Immutable signed baseline, allowlist, issuer and branch/protected inputs | DB head must never rewrite baselineId or make IAB mutable |
| AMIO / outputRevisionId | Mutable accepted full root within scoped signed grant | Actual direct workspace/CI root currently differs from DB accepted root; design collision |
| EAF / artifactId | Exact source/package/lock/toolchain/compiler emitted JS graph and negative proofs | DB content hash ≠ EAF; requires snapshot at use; no old PASS promotion |
| EI / IRA / HSA | Evidence invalidation, independent reattestation and human authorization are separate | DB storage success does not issue grant, IRA PASS or activation |
| B0 → B1 | B0 permitted source edits then independent B1 EAF proof | B0 operations cannot use nonmediated worktree effects; B1 must attest use-time snapshot |
| B2-DEP | Separate scoped DEP grant/latch; source+lock operations accepted, ordered and closed | Signed sealed transaction & physical effect prohibition still unimplemented |
| B2-HOST | PREP test-only, freeze, independent RA, distinct human ACTIVATE and H0/H1/H2/H3 | Cannot infer host permission from DB accepted head or B1 PASS |
| Task 1 | Approved 31/32; Case A BLOCKED, Case B PROVEN; unknown-tool BLOCKED | New DB/IRA/production I must never become Task1 mandatory or substitute its evidence |
| Tasks 2–14 | Not unlocked by document design, technical feasibility or Task1 hypothesis | Separate human-approved plan/phase chain; no implementation/host now |

**Net:** Do not auto-promote these deltas into R'/D'/P'. A future independent reviewer must both compare the original source and independently decide whether any `atomic-equivalent` retiming violates R11's stated invariant. If impossible, retain `ARCHITECTURAL_REDESIGN_REQUIRED` rather than force a schema workaround.
