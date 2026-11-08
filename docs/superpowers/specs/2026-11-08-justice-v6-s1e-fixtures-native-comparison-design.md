# Justice v6 — S1-e Positive/Negative Fixtures & Native-only Comparison

> **Design:** R0.1 — candidate for Human Owner review, not adopted
> **Issue:** [#354](https://github.com/yohi/justice/issues/354)
> **Decision:** `S1E_FIXTURE_ACCEPTANCE_WITH_BOUNDED_NATIVE_COMPARISON`
> **Comparison policy:** `S1E_EVIDENCE_BASED_NATIVE_CAPABILITY_COMPARISON_NO_NEW_EXECUTION`
> **Source baseline:** `yohi/justice` master `694433a3976da3450dbe012264ce2501448d4d31` (2026-11-08 JST)
> **Scope:** S1-e / DOCUMENT_ONLY / DESIGN_ONLY
> **Authority:** This design's creation, Commit and Push are authorized by the Human Owner's explicit request. This does not authorize code implementation, tests/build/CI execution, Host probes, Native-only execution, Gate/HOLD changes, PR creation, or downstream tasks.

## 1. Purpose, value, and boundary

S1-e is the final functional-acceptance decision input for the Justice v6 S1 Assurance Core MVP. Reuse the existing S1-a through S1-d diagnostics to run a bounded, reproducible collection of positive, negative, and missing-input fixtures and report what was actually evaluated.

In parallel, compare Justice's **capability coverage** against the Superpowers + OpenCode V2 Native-only baseline, using versioned official documentation, inspected existing source, and previously collected execution evidence only. Do **not** execute a new Native-only workflow or claim an operational improvement from static evidence.

Success means the Human Owner can decide whether the S1 **functional** MVP is usable and what remains unknown. S1 completion neither asserts a formally approved underlying task nor proves that Justice is superior in real development workflows.

The two adopted design-direction labels are:

- `S1E_FIXTURE_ACCEPTANCE_WITH_BOUNDED_NATIVE_COMPARISON`: static functional acceptance plus bounded Native capability comparison.
- `S1E_EVIDENCE_BASED_NATIVE_CAPABILITY_COMPARISON_NO_NEW_EXECUTION`: no new Native-only runs, Host probes, or live A/B experiments.

The design is a proposed implementation specification, not implementation authorization.

### Goals

- Reuse existing tests and the S1-a/b/c core plus S1-d integrated diagnostic path; do not recreate assurance rules.
- Demonstrate behavior for positive, negative, and missing/untrusted inputs using a small, fixed and reproducible example.
- Keep identity, evidence-reference presence, provenance claims, authority, and formal verdict **distinct**.
- Evaluate confirmed Native capabilities without converting lack of documentation into proof of non-existence.
- Record functional acceptance, Native capability comparison, and operational effectiveness independently.

### Non-goals and anti-goals

No new diagnostic engine, broad test harness, server, persistent store, Host Adapter, OpenCode V2 execution integration, Native-only execution, real-world A/B experiment, automatic task/review/fix dispatch, Approval/Gate/HOLD adjustment, or fabricated performance targets. S2 is the boundary for actual host integration and operational effect measurement.

**Anti-goal:** A passing test, CLI exit code `0`, evidence self-report, candidate scope match, or recognized reference must never become a formally proven Owner approval or `formalVerdict: PASS`.

## 2. Alternatives and selection

| Approach | Benefit | Limitation | Decision |
| --- | --- | --- | --- |
| Fixture-only acceptance | Smallest implementation | Hard to explain incremental value over Native | Rejected |
| Existing-core fixtures + evidence-based Native comparison | Reproducible functional decision and bounded, sourced comparison | Cannot prove operational superiority | **Selected** |
| New Native execution + live A/B | Can compare real workflow outcomes | Requires Host control, new execution and S2 scope | Deferred to S2 |

The selected approach is sufficient for an S1 functional-MVP judgment without requiring a full AI development task to be executed twice.

## 3. Grounded existing interfaces

At the frozen source baseline the repository contains:

- `src/core/s1a/loader.ts`: `loadS1aArtifacts()` and the `LoaderResult` contract in `src/core/s1a/contract.ts`.
- `src/core/s1b/binder.ts`: `bindEvidence()` and typed `EvidenceRefV1` in `src/core/s1b/contract.ts`.
- `src/core/s1c/evaluator.ts`: `evaluateS1c()`, `S1cResult`, and `ChangeSet` in `src/core/s1c/contract.ts`.
- `src/runtime/s1d-diagnostic.ts`: `runS1dDiagnostic()`, orchestrating S1-a, S1-b and S1-c without replacing their decisions.
- `src/core/s1d/report.ts`, `src/core/s1d/formatter.ts`, `src/core/s1d/contract.ts`, `src/runtime/s1d-cli.ts`: assembled Text/JSON diagnostic output.
- Existing test families under `tests/core/s1a/`, `tests/core/s1b/`, `tests/core/s1c/`, `tests/core/s1d/` and `tests/runtime/s1d-*.test.ts`. `tests/helpers/s1a-fixtures.ts` provides reusable setup material.

**Read-only inspection only:** Existing files and test names were confirmed. No tests, build, CI, or Native comparison runs were performed as part of this design task.

### Normative trust boundaries

1. S1-a `identityStatus: MATCH` is a local identity check against caller-provided digest-pinned bytes. `ownerAuthorityStatus: NOT_PROVEN`, `ownerTrustPrecondition: EXTERNAL_NOT_VERIFIED_BY_S1A`, and `eligibleBaseline: false` remain as provided.
2. S1-b `MATCHED_REF_PRESENT` reflects an associated reference, not evidence authenticity, actual execution, an AC being satisfied, or an approved action. `reportedOutcome` and `reportedExecutionState` are **claims**.
3. S1-c `candidateScopeComparison` is a candidate-path comparison, not a formal pass/fail of the overall task. `ownerAuthorityVerification: NOT_VERIFIED_BY_S1C` and `formalVerdict: UNKNOWN` must be preserved.
4. S1-d `stages[*].state: EVALUATED` denotes that a stage was evaluated, not that it passed. Its CLI exit `0` is not functional acceptance or formal approval.
5. S1-d's `scopeFallback` when S1-c cannot run is a limited scope-only observation with `formalVerdictAvailable: false`; do not present it as an S1-c formal result.
6. A present caller-supplied ChangeSet does not establish Git diff completeness. A readable Plan or Manifest `approvalRef` is not independent Owner-authority proof.

## 4. Minimal fixture architecture

Use existing S1-d diagnostic orchestration as the acceptance entry point, with direct core assertions added only when a specific contract is not exposed by S1-d.

~~~text
Frozen fixtures: Manifest, TaskIntent, 1 Design, 1 Plan,
                 Task-A, Task-B, ACs, EvidenceRefs, ChangeSet
                         |
                         v
              Existing S1-d diagnostic
                  /       |       \
               S1-a     S1-b     S1-c
                  \       |       /
                   S1-d Text/JSON
                         |
                 Expected vs observed
                         |
              Functional acceptance

Native official docs / inspected code / prior evidence
                         |
               Evidence classification
                         |
              Native capability comparison

Functional + Native capability results + NOT_MEASURED
                         |
                 Owner decision package
~~~

Proposed **test-only** additions after separate implementation authorization, and only if existing coverage is insufficient:

- `tests/fixtures/s1e/`: compact deterministic input fixture set, or reuse `tests/helpers/s1a-fixtures.ts` without adding files when practical.
- `tests/runtime/s1e-acceptance.test.ts`: cross-stage assertions exercising the existing S1-d entry point.
- A bounded acceptance evidence report recording actual test execution and cited Native comparison.

No production source path, CLI mode, API contract, runtime hook, or persistence layer is introduced by S1-e.

### Fixture identity

Start from one Design, one Implementation Plan, two Tasks and the minimal ACs required by selected Task(s); each diagnostic selects one Task using the existing TaskIntent contract. Task-B exists for deliberately wrong-task Evidence tests and must **not** implicitly become an additional selected Task.

Use fixed explicit artifact IDs, revisions, scope keys, byte digests and known raw-byte contents. For each mutation label **exactly what changed** and distinguish intentional digest mismatch from an artifact whose manifest digest was correctly re-pinned. Do not accidentally make an unrelated invalid digest the cause of a test intended to exercise a different rule.

S1-c policy tests need actual digest-pinned Plan bytes with its existing scoped-policy section and valid task references. No newly invented Plan schema or authorization rule.

## 5. Positive / negative / missing-input acceptance matrix

| ID | Scenario | Primary expected observation |
| --- | --- | --- |
| P-01 | Matching identities, Task-linked Evidence reference, changed path within candidate scope | No spurious identity / binding / candidate-scope contradiction; formal verdict remains UNKNOWN |
| N-01 | Selected Plan revision differs from TaskIntent | S1-a `REVISION_MISMATCH` |
| N-02 | Stale/tampered Plan raw bytes and digest mismatch | S1-a identity contradiction; no promoted valid candidate scope |
| N-03 | Evidence refers to Task-B while Task-A is selected | S1-b Task-binding mismatch; never treated as Task-A evidence |
| N-04 | Manifest retains at least two mandatory ACs for the selected Task; TaskIntent omits exactly one of those AC refs while retaining at least one, with all other Manifest/Artifact identities valid | S1-a `REQUIRED_AC_MISSING`; do not conflate with deleting that AC from Manifest |
| N-05 | Selected AC exists but supporting Evidence reference is missing | S1-b `MISSING_EVIDENCE` and applicable S1-c `AC_EVIDENCE_REF_MISSING` |
| N-06 | Changed path outside selected Plan's candidate allowlist | S1-c `OUTSIDE_CANDIDATE_SCOPE`, not a formal FAIL |
| N-07 | Self-declared `EXECUTED` and `PASS` Evidence | Reported claim retained, `authenticityStatus` and `executionVerificationStatus` remain `NOT_VERIFIED` |
| N-08 | Manifest has an `approvalRef` but independent Owner authority is unproved | S1-a Owner authority NOT_PROVEN; S1-c formalVerdict UNKNOWN |
| N-09 | Malformed Evidence value vs unreadable Evidence source | Distinguish evaluated `INPUT_REJECTED` from `NOT_EVALUATED`; do not promote fallback |
| N-10a | Parsed ChangeSet has `availability: "UNAVAILABLE"`; other prerequisites remain valid | S1-c `EVALUATED`, diagnostic `CHANGESET_UNAVAILABLE`, candidate scope `UNKNOWN` |
| N-10b | ChangeSet source read fails; other prerequisites remain valid | S1-c `NOT_EVALUATED`, reason `CHANGESET_SOURCE_UNAVAILABLE` (input issue `INPUT_READ_FAILED`); not equivalent to N-10a |

Expected output must be derived from existing code contracts and narrowed to the selected S1-d execution path during Implementation Plan work; no claim that all example cases already passed. Existing equivalent coverage is reused, not duplicated.

For S1-d fallback under Evidence source failure, compare `scopeFallback` separately from the unavailable formal S1-c stage. For rejected-but-parseable Evidence input, S1-c may still produce a partial scope comparison: acceptance assertions must respect that distinction rather than require every diagnostic to be UNKNOWN.

### Shared assertions

- Do not elevate S1-a `identityCandidateReady` or `eligibleBaseline: false` into Owner acceptance.
- Keep `formalVerdict: UNKNOWN` for all evaluated S1-c fixture cases; if S1-c is not evaluated, record *not evaluated* instead of inventing a formal verdict.
- Do not turn S1-b coverage `MATCHED_REF_PRESENT` into AC completion or Evidence authenticity.
- Keep claimant-provided execution status separate from observed execution evidence.
- Do not equate CLI `exitCode: 0` with assurance PASS.
- Repeated runs of deterministic fixtures should produce the same relevant diagnostic output. Existing S1-c-validated repository-relative paths may be displayed in S1-d Text/JSON diagnostics; do not blanket-redact them. Host absolute paths, secrets, and raw exception strings must not be emitted in either format. Assert these conditions under existing S1-c input validation and S1-d Formatter behavior, without inventing a new redaction contract.
- A normal fixture must not induce unrelated workflow dispatch or external writes; test only interfaces and absence-of-side-effect guarantees that can actually be observed in the authorized test scope.

## 6. Native-only capability comparison

### Evidence levels (not an approval or authority system)

- `IMPLEMENTATION_CONFIRMED`: implementation found in **identified version/commit** of Native source.
- `DOCUMENTED`: capability present in versioned **official** docs.
- `PREVIOUSLY_OBSERVED`: prior trace / test / report recorded behavior **under identified conditions**.
- `UNKNOWN`: available evidence cannot determine presence/absence or equivalence.

These evidence levels are not exclusive or ordered as a single strength ranking. The comparison record may contain more than one, with source, version, URI/path, relevant section/line or commit, observation date and applicability. An absence of documentation does **not** prove feature absence.

### Comparison dimensions

Use the same **scenario definitions**, Design / Plan / Task / Evidence / ChangeSet semantics as the functional fixtures, but **do not** run a new Native-only reproduction.

1. Artifact ID/Revision/Digest association.
2. Task/AC/Evidence reference association and wrong-task detection.
3. Missing Evidence versus unsatisfied AC or merely self-reported success.
4. Candidate-scope out-of-path reporting.
5. Self-reported execution versus externally validated execution.
6. Owner-authority / approval-unknown representation.
7. Deterministic, explainable structured diagnostics.
8. No unexpected task/review/fix/Host actions during read-only diagnosis.

Compare **capability** as confirmed, duplicated, Native unknown, or not directly comparable. Do not turn this classification into a numeric detection rate, false positive rate, causal improvement, or blanket superiority claim.

### Baseline scope

Native-only means Superpowers + OpenCode V2 capability **without Justice S1**. Record which Superpowers version and OpenCode V2 version or source commit each statement describes; where versions or integrations are not established, label applicability `UNKNOWN`. Existing prior runtime traces, if used, are observations for their own environment and not automatically evidence for other versions or Hosts.

Use previously collected Native evidence only. No live source instrumentation, execution, Host probing, or new A/B scenarios in S1-e.

## 7. Reporting: three independent layers

### A. Functional Acceptance

For each case record fixture identity/digest, target HEAD, test/command **actually executed**, assertion name, expected/observed diagnostic fields, and outcome. Allowed reporting statuses include:

- `OBSERVED_PASS`: executed and assertion observed passing.
- `OBSERVED_FAIL`: executed and assertion observed failing.
- `NOT_EXECUTED`: not run.
- `SKIPPED_UNPROVEN`: explicitly skipped, guarantee unproven.
- `TEST_ABSENT` / `NOT_COLLECTED`: expected test missing or not collected.

Do not derive an observed PASS from existing test source alone or from this Design being committed.

### B. Native Capability Comparison

Each dimension includes Native version, evidence level(s), exact source references, verified claim, equivalence limit, unknowns, and possible duplication with Justice. If insufficient evidence, use `UNKNOWN` rather than fabricated absence or improvement.

### C. Operational Effectiveness

Real-development true-positive/false-positive rates, time, cost and Human Owner effort are `NOT_MEASURED` for S1-e. Their future S2 evaluation is **not** a hidden S1 acceptance gate or authorization to start S2.

## 8. M1–M5 traceability

| Goal | Cross-stage acceptance evidence |
| --- | --- |
| M1 | Design/Plan/Task/AC identity, revision, digest and scope link fixtures |
| M2 | Evidence binding, AC coverage and claim/authenticity limitations |
| M3 | Stale Plan, missing AC/Evidence, candidate-scope contradiction diagnostics |
| M4 | No unrequested workflow, gate or external side effect in the exercised read-only path; no universal Host guarantee claimed |
| M5 | Explainable S1-d Text/JSON output and sourced Native capability matrix |

Attach existing test evidence when equivalent; add only the minimal missing assertions. A design matrix alone is neither executed evidence nor a PASS.

## 9. Completion, escalation and stop

**Functional-acceptance completion candidate** is ready for Human Owner decision when:

1. The frozen tested HEAD and exact fixture inputs are identified.
2. S1-a–d cross-stage assertions for the required positive/negative/missing cases have actually been collected and run; each result is recorded honestly.
3. Serious false-acceptance or authority-elevation paths are not demonstrated in the tested scope.
4. Identity, scope, claim authenticity, and `formalVerdict: UNKNOWN` boundaries are preserved.
5. Native capability comparison is sourced, versioned and keeps `UNKNOWN` explicit.
6. Operational improvements remain `NOT_MEASURED` where not directly evidenced.
7. Residual risks and unresolved matters are clear enough for the Human Owner to accept, limit, defer or reject S1 MVP.

**Stop affected operation** and report to Human Owner on unexpected sensitive side effects, observed major false acceptance, authority promotion, nonreproducible fixture identity, unauthorized writes, surprising HEAD/ref drift, or any proposed work beyond approved scope. Do not suppress such problems, but do not halt unrelated work solely because a Finding exists. Minor or unproven limitations can be recorded for the Owner's disposition.

The first bounded acceptance plus needed limited correction should lead to **one Human Owner checkpoint**. Do not automatically create subsequent review/fix/re-review chains; do not require zero Findings for completion.

## 10. Implementation boundary and next authorization

The subsequent Implementation Plan (only when separately authorized) should break work into a small number of tasks:

- Inventory/reuse existing tests; add minimum positive/negative/missing fixtures and cross-stage assertions.
- Execute only specifically approved validation commands and collect actual evidence.
- Assemble a read-only, sourced Native capability matrix from docs/source/prior evidence, without new Native execution.
- Present a concise S1 MVP decision package, noting risks, UNKNOWN and NOT_MEASURED.

Writing this Design and pushing its Git commit **does not** authorize creating that Plan, changing production code, running build/tests/CI, creating a PR, starting S2, or modifying external systems.

**End state of this document task:** one Design R0.1 candidate committed to its dedicated feature branch; further work is a separate Human Owner decision.
