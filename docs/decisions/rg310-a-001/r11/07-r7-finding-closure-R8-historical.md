# Justice v5 — RG-310-A-001 R7 Finding Closure / Diff Map — R8 Author Candidate

- Document: `RG310-R7-FI-CLOSURE-R8`; date: 2026-10-14 JST. **Author claim only / UNAPPROVED**. The R7 technical review was produced earlier in this same conversation; the R8 author is therefore **not organizationally/actor-independent from the R7 technical reviewer**. This is a document-revision role, not a Fresh Independent Review. A future R8 reviewer must be a different verified identity. Formal R7 Gate identity was NOT_ESTABLISHED. A different Fresh Independent R8 Reviewer is required.
- R7 original ZIP SHA-256: `05a1372a1ee30176cb2db560842148251077ce96257905f8fc763f72914282ca`.
- R6 original ZIP SHA-256: `284eda20ec576f4036c48f5e8b8b8efad235127f6025c6e4bc6d0767eab818c6`.
- R7 technical review SHA-256: `cf0b9173975c9f96720ee9f5b69ff5b8834c9a574c57ddac25139afee6de75a1`; verdict REVISION_REQUIRED, formal identity missing.
- R5 full original review is not provided; the contextual summary is not a signed substitute. This revision changes **documents only**, not active Requirements/Design/Plan or runtime/evaluator status.

## 1. Author technical triage (NOT independent Gate; same conversation as R7 technical review)

| R7 Finding | Source and R8 mapped anchors | Actual counterexample / independent source-derived validity | R8 author resolution hypothesis | Residual necessary proof |
|---|---|---|---|---|
| **R7-FI-001 Major** | R7 R7 04:L77; R7 04:L98; R7 01:L298; R7 01:L536; R7 01:L768 → R8 R8 04:L82; R8 04:L101; R8 04:L119; R8 01:L306; R8 01:L547 | **CONFIRMED**: at T0 B0 first edit, R7 preflight requires T1 afterRoot/trustedCommitTime/receipt not yet available. Implementer must either never start or write before acceptance; expiry/race at T1 leaves public unsafe bytes. | Split BEFORE permission `OP_PREPARE_ALLOWED`/`START_ADMISSIBLE` and durable private `OP_PREPARED`, AFTER independent staging/commit `OP_COMMIT_ACCEPTED`/`ACCEPTED_DELTA`, `OP_ABORTED` tombstones, atomic accept+publish, IN_DOUBT quarantine, all writers. Row 01/02/06/16/18/19/23 plus 15/30 reformulated. **PROPOSED_FIXED_IN_TEXT only**. | Independent feasibility proof of fully controlled stage, transaction+durable seal same linearization, key clock/revoke/seq, crash/recorder recovery. No proof now ⇒ `UNKNOWN/BLOCKED+STOP`; never operationally authorized. |
| **R7-FI-002 Moderate** | R7 R7 01:L359 → R8 R8 01:L370 | **CONFIRMED**: R7 D.5 imperative says R6 §§3–5, whose missing-proof case could be classed `REVOKED`, in conflict with R7 §04 UNKNOWN/BLOCKED. Different operators can assign incompatible authority. | R8 main D/E/F/G/H/I/J point to only `04-authorization-fingerprint-transition-matrix-R8.md`. Old R6/R7 only historical non-normative provenance. **PROPOSED_FIXED_IN_TEXT**. | Fresh reviewer must independently search for hidden obsolete operative pointer and verify R8 §04 classification. |
| **R7-FI-003 Minor** | R7 R7 01:L52 and R7 01:L823 → R8 R8 01:L54 and R8 01:L842 | **CONFIRMED as editing ambiguity**: '本 R5' and 'R5 の別セッション fresh reviewer' ambiguously project historical review request into current R7 context. Not an observed runtime safety defect. | Past-tense '当時の R5' and separation of past review requirements from R8 actual status; missing R5 original explicitly retained. **PROPOSED_FIXED_IN_TEXT**. | R5 original absent; full historical finding provenance cannot be certified. R8 reviewer identity remains unproven until a distinct real process. |

**Safety distinction:** Any missing monitor/transaction/recorder proof is `UNKNOWN/BLOCKED+STOP`. Proved unauthorized public delta, independent forgery or actual bypass is `REVOKED+STOP` (formal B1 submitted FAIL still has separate prescribed `B0_REVOKED`). Rejected stage without visible change is independently `ABORTED`, not an invented breach. Legal accepted edit changes AMIO/EAF applicability, not automatically immutable IAB grant.

## 2. Exact old-to-new predicate and temporal diff

| R7 original name or edge (historical, non-normative) | R8 operative type/edge (sole candidate §04) | Effect |
|---|---|---|
| `ALLOWED_DELTA_AT_OP_TIME` (postRoot+receipt as start gate) | `OP_PREPARE_ALLOWED` BEFORE → `OP_PREPARED` → `STAGE` → `OP_COMMIT_ACCEPTED` AFTER | Never require future evidence at PREPARE |
| `B0_EDIT_ALLOWED` | `B0_PREPARE_ALLOWED` and `B0_EDIT_ACCEPTED` | Separates start from accepted delta |
| `DEP_OPERATION_ALLOWED` | sealed start-only `DEP_STARTED`, `DEP_PREPARE_ALLOWED`, `DEP_EDIT_ACCEPTED` | Normal lock edits continue without current `B1_PASS_FOR(EAF1)` |
| `HOST_PREP_ALLOWED` | `HOST_PREPARE_ALLOWED`, `HOST_PREP_EDIT_ACCEPTED` | Test-only source stage/commit; no host execution |
| post-write independent append `OperationSeal` | durable `PreflightSeal`, non-accepted `CandidateSeal`, atomic `AcceptPublishSeal`, `AbortSeal`, phase/freeze seals | Crash/split receipt cannot expose unaccepted bytes |
| past `FROZEN→legal edit` wording | `attemptIndex+1` with old freeze/RA/ACTIVATE fenced beforehand | Removes frozen same-attempt edit reachability |
| B1 PASS before valid B0 close but 'before phase closure' edit | prior phase completion + **new attempt**/new signed scope + re-test B1 | Removes impossible phase order |
| old D.5 `R6 matrix §§3–5` | current `04-authorization-fingerprint-transition-matrix-R8.md` §§2–5 | No obsolete operative authority |

### 2.1 Counterexample obligations for all 38 R7 IDs, stable 1:1

The R8 §04 §5 contains exactly one mapped row for each R7 ID `01..38`, with **Operation stage; Grant status; Evidence applicability; Next action; Human decision; Fail-closed result; Proof obligation** columns. The matrix includes before/after-proof distinction on `01/02/06/16/18/19/23`, new-attempt reachability on `15/30`, and intact baseline conditions on all other 29 IDs. All stages are *hypothetical until human decisions and independently proven monitor exist*.

- 01–02/18–19/23: legitimate repeated PREPARE/private STAGE/ATOMIC ACCEPT, latest accepted root and new per-op independent proof; cannot derive from one past seal.
- 03–04/20/24: bad staged candidate and proved publicly escaped prohibited mutation are not the same status.
- 05–12: trusted expiry at commit, ledger/clock/key replay, recorder gap, phase sealed root and historical grant closed/expired.
- 13–21: B1 exact artifact, first-latch before stage, not B1 current as DEP continuation, formal B1 failures and authorized new attempt.
- 22–35: accepted/aborted full sequence phase complete, freeze, final RA, human ACTIVATE, host-origin proof still missing; 30 requires new attempt before change.
- 36–38: canonical 31/32, Task1 R / compiled P / production I independent, expiry historical truth.

## 3. INV-A01..A14, R1–R5 and DAG nonregression register

- **Exact F matrix preservation:** all 14 rows are compared verbatim against R7's F table; any modification to INV-A07 content, A10/A12 token/identity, or negative controls is forbidden by this document contract. `TASK1_EXISTING_ACCEPTANCE` keeps canonical32/CaseA/CaseB/runtime/safety with 31/32 and CaseA BLOCKED currently, no new P/I/PRODUCT condition. `RG-310-B-001=BLOCKED`, `B-002=NOT_PROVEN`, separate unadopted product readiness.
- `L_ACT/L_INV` synchronous authority fence; forbidden pre-await stale Promise writeback; `AUTHORITY_FAIL_CLOSED` is independent of actual `PERSISTENCE_SAFE`. A10/A12 require positive original token → actual removal → same role exact message identity → canonical SessionManager/JSONL readback.
- Phase edges remain `R′(rank0)→D′(rank1)→P′(rank2)→normative review→human ADR→B0→B1→DEP→PREP→freeze→RA→ACTIVATE→HOST-RUN→B3 optional→Task1 existing evaluator→normal Tasks2–6→full Task6→product`. No `Task1→RA`, `full Task6→Task1`, `HOST_RUN→RA`, `production I→Task1 R`; repairs strictly higher `attemptIndex`, lexicographic `(attemptIndex,rank)`.
- **Formal distinction:** this proves the *specified directed ranks*, not an operationally accessible monitor or actual fixed Senpi host-origin proof. A future feasibility investigation is separate; no platform capabilities are assumed.
- R1–R4 closure obligations remain in inherited A/G history; no source/evaluator change. R5 full original is absent, so an unqualified statement of full original R5 nonregression would be unjustified. R6 preliminary wasn't a formal Gate; R7 review was technical but formal identity unverified; R8 reviewer must independently reassess them.

## 4. Gate/authority and next holder

```text
R8 proposal: UNAPPROVED; Formal Fresh Independent R8 Gate: NOT_ESTABLISHED
R'/D'/P': NOT_ADOPTED; Architecture Decision: HUMAN_DECISION_REQUIRED
Task1: BLOCKED; canonical 31/32, Case A BLOCKED, Case B PROVEN, unknown-tool BLOCKED
Required-runtime aggregate: true; Mandatory-safety aggregate: true
RG-310-DR-001..004: OPEN; RG-310-A-001: NO_EQUIVALENT_EVIDENCE_CONTRACT
Tasks2–14: NOT_AUTHORIZED; B0/B1/B2: NOT_AUTHORIZED
Implementation/TaskAccepted/PlanComplete: NOT_AUTHORIZED
```

**Next holder:** Different Fresh Independent R8 Architecture Reviewer, independent of this author and the R7 reviewer. The technical reviewer tests claims, not adopts them. After an independently acceptable technical review, separate Requirements/Design/Plan owners and a human Architecture Decision signer decide; independently trusted monitor/host-origin feasibility stays unproven. **No code/runtime/build/test/GitHub operations or human grants were performed.**
