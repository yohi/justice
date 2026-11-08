# Justice v6 S1-e MVP Acceptance Packet

This document is a decision input for the Human Owner. It is not a runtime
approval object, a Gate state, or a product status field. It does not choose
an acceptance decision on the Owner's behalf.

## 1. Evidence identity

| Item | Value |
| --- | --- |
| Tested HEAD | `f1328238528617dc6cc9f14ede49e37eba4adfb9` (branch `feature/justice-v6-s1e-acceptance-tests-20261109`, equal to `master` at that commit) |
| Test file | `tests/runtime/s1e-acceptance.test.ts` |
| Test file state | **Untracked and uncommitted** at execution time (`git status`: `?? tests/runtime/s1e-acceptance.test.ts`); nothing staged. HEAD alone does not reproduce the run; the exact bytes are identified by the SHA-256 below and exist only in the working tree until committed. |
| Test file SHA-256 | `13359010b6d248b31c41b4b4e35e1539344fbd10a8be49d05427fd5513aeb44a` |
| Post-run state (added after the run; does not replace the rows above) | The test file was later committed in `bec8099fabc77c5f26c6e641dcb87c20db322a85` (head of PR #370 at the time of this correction). The "uncommitted" statements in this section describe execution time only. |
| Post-run identity | Git blob SHA `15d91baaafce2e237ca2480584c4ff467b926732`; SHA-256 `13359010b6d248b31c41b4b4e35e1539344fbd10a8be49d05427fd5513aeb44a`, identical to the executed bytes above. |
| Post-run CI evidence (separate from the run above) | At `bec8099f`, the CI workflow run 42499467445 reported `tests/runtime/s1e-acceptance.test.ts (15 tests)` executed in its log, and the Coverage workflow run 42499467470 and the same head's other checks reported success (read-only inspection; no test was re-run for this correction). This is CI-environment evidence, not the host run recorded above. |
| Command | `bun run vitest run tests/runtime/s1e-acceptance.test.ts --reporter=verbose` |
| Run timestamp | 2026-11-08T16:10:58Z (host clock, UTC) |
| Environment | Linux, Bun with vitest v4.1.1, repository root as working directory. The devcontainer was not used for this run. |
| Observed counts | 1 test file passed (1); 15 tests passed (15); 0 failed; 0 skipped; duration 384 ms |

Status vocabulary: `NOT_EXECUTED`, `TEST_ABSENT`, `NOT_COLLECTED`,
`SKIPPED_UNPROVEN`, `OBSERVED_PASS`, `OBSERVED_FAIL`. `OBSERVED_PASS` below
means the named test was reported as passing in the run above, nothing more.

## 2. Functional Acceptance

All fixtures come from the test-local factory `makeS1eFixture` inside the test
file (identity: the file SHA-256 above). They use fixed artifact IDs
(`design-1`, `plan-1`, `task-1`, `ac-1`, `ac-2`). Task-B (`task-2`) is added to
the Manifest and served as an Artifact in every case; Evidence refers to Task-B
only in N-03.
The expected and observed fields below are the assertions in the test file; a
test reported as passing means those assertions held.

| Case | Test name (in `S1-e acceptance`) | Fixture mutation | Expected fields | Observed fields | Outcome |
| --- | --- | --- | --- | --- | --- |
| P-01 | `s1ePositiveKeepsAuthorityUnknown` | none (baseline) | All stages EVALUATED; S1-a MATCH, Owner authority NOT_PROVEN, `eligibleBaseline` false; S1-b bindings MATCH, ACs MATCHED_REF_PRESENT, NOT_VERIFIED; S1-c WITHIN_CANDIDATE_SCOPE, verdict UNKNOWN | Assertions held in the run | OBSERVED_PASS |
| N-01 | `s1eStalePlanRevision` | TaskIntent plan revision differs | `REVISION_MISMATCH`, identity MISMATCH, NOT_PROVEN | Assertions held in the run | OBSERVED_PASS |
| N-02 | `s1eTamperedPlanBytes` | Served Plan bytes differ; Manifest digest stays pinned | `ARTIFACT_DIGEST_MISMATCH` on `artifact:plan-1`; S1-c scope UNKNOWN with `S1A_BASELINE_NOT_READY` | Assertions held in the run | OBSERVED_PASS |
| N-03 | `s1eWrongTaskEvidence` | Evidence refers to Task-B while Task-A selected | `TASK_NOT_SELECTED` MISMATCH for the evidence; `ac-1` not MATCHED_REF_PRESENT; `ac-2` unaffected | Assertions held in the run | OBSERVED_PASS |
| N-04 | `s1eMissingMandatoryAc` | TaskIntent omits one of two mandatory ACs; Manifest unchanged | `REQUIRED_AC_MISSING`; other entries unchanged; no revision or digest mismatch | Assertions held in the run | OBSERVED_PASS |
| N-05 | `s1eAcWithoutEvidence` | `ac-2` has no supporting Evidence reference | `MISSING_EVIDENCE` for `ac-2`; S1-c `AC_EVIDENCE_REF_MISSING` for `ac-2` only | Assertions held in the run | OBSERVED_PASS |
| N-06 | `s1eOutsideCandidateScope` | Changed path `docs/outside.ts` outside the Plan allowlist | `OUTSIDE_CANDIDATE_SCOPE`, verdict UNKNOWN (not a formal FAIL) | Assertions held in the run | OBSERVED_PASS |
| N-07 | `s1eSelfDeclaredPassIsUnverified` | Evidence self-declares `EXECUTED` and `PASS` | Claim retained; provenance SELF_DECLARED; authenticity and execution verification NOT_VERIFIED | Assertions held in the run | OBSERVED_PASS |
| N-08 | `s1eApprovalRefNeverProvesAuthority` | Manifest has a non-empty `approvalRef` | Owner authority NOT_PROVEN; `eligibleBaseline` false; verdict UNKNOWN | Assertions held in the run | OBSERVED_PASS |
| N-09a | `s1eInvalidEvidenceIsLevelB` | Evidence value `{invalid:true}` (readable but malformed) | No input issue; S1-b EVALUATED with `INPUT_REJECTED`; S1-c EVALUATED with `S1B_INPUT_REJECTED`, verdict UNKNOWN | Assertions held in the run | OBSERVED_PASS |
| N-09b | `s1eUnreadableEvidenceIsLevelA` | Evidence source read fails | Input issue `INPUT_READ_FAILED`; S1-b NOT_EVALUATED (`EVIDENCE_SOURCE_UNAVAILABLE`); S1-c NOT_EVALUATED; scope fallback shown without a formal verdict | Assertions held in the run | OBSERVED_PASS |
| N-10a | `s1eUnavailableChangeSetIsEvaluated` | ChangeSet parsed with `availability: "UNAVAILABLE"` | S1-c EVALUATED, `CHANGESET_UNAVAILABLE`, scope UNKNOWN, verdict UNKNOWN | Assertions held in the run | OBSERVED_PASS |
| N-10b | `s1eUnreadableChangeSetIsNotEvaluated` | ChangeSet source read fails | Input issue `INPUT_READ_FAILED`; S1-c NOT_EVALUATED (`CHANGESET_SOURCE_UNAVAILABLE`); no scope fallback; not equivalent to N-10a | Assertions held in the run | OBSERVED_PASS |

Mapping notes:

- N-08 maps to `s1eApprovalRefNeverProvesAuthority`, as in the test file.
- N-09 is split: N-09a is malformed Evidence (Level B, evaluated), N-09b is an
  unreadable Evidence source (Level A, not evaluated).
- N-10 is split: N-10a is an unavailable parsed ChangeSet (evaluated), N-10b is
  an unreadable ChangeSet source (not evaluated).

Cross-cutting tests that are not one of the enumerated case IDs:

| Test name | What it asserts | Outcome |
| --- | --- | --- |
| `s1eReportOutputRespectsSafePathBoundary` | A valid relative path appears in Text and JSON; an absolute-path ChangeSet yields `CHANGESET_INVALID` and scope UNKNOWN; neither the absolute path, the file name, a secret marker, nor a stack fragment appears in Text or JSON | OBSERVED_PASS |
| `s1eDeterministicOutputAndNoUnrequestedActions` | Two runs give identical Text and JSON; a spy over the injected read-only source records exactly 9 distinct reads (manifest, intent, evidence, changeset, 5 artifacts), each once per run (18 total) | OBSERVED_PASS |

Related checks recorded by the implementer of Task 2 (not re-run for this
packet, so they are reported only as prior implementer observations, not as
`OBSERVED_PASS` for this identity): the S1-a to S1-d unit suites
(17 files, 210 tests), typecheck and full lint (0 errors, 296 warnings) were
reported as passing in the Task 2 working notes. They were produced before the
final command above and are not tied to this SHA-256 by this document.

Differences between executed evidence and source inspection: case rows list
fixture mutations and expected fields from reading the test source. Only the
pass or fail outcome is an execution observation. Field values were not dumped
from the run.

### Not observed (M4 boundary)

| Item | Status |
| --- | --- |
| External writes (filesystem outside injected sources, network, GitHub) | SKIPPED_UNPROVEN |
| Workflow or task dispatch beyond the injected read-only source | SKIPPED_UNPROVEN |
| Host (OpenCode) behavior for the real plugin path | SKIPPED_UNPROVEN |

The read spy proves only which injected reads occurred. It does not prove the
absence of external writes, dispatch, or Host side effects.

## 3. Native Capability Comparison

Scope: Native-only means Superpowers + OpenCode V2 without Justice S1, as
defined in Design section 6 and the Implementation Plan. oh-my-openagent (OmO)
is not part of this baseline; earlier OmO observations are kept only in the
separate supplementary subsection below and are not counted toward any
dimension. No Native workflow was run and no instrumentation was added.
Statements are based on local source or documentation snapshots only.
Documentation silence is not treated as absence of a capability.

Sources consulted (local snapshots, paths relative to `$HOME`):

| Source | Path | Version or commit |
| --- | --- | --- |
| Superpowers (obra) | `program/oss/superpowers` | v6.4.2, commit `8ca22dba9a94f28898bbce59f2537ff4d87c747d` |
| OpenCode host (V2) | not available locally | UNKNOWN (only `@opencode-ai/plugin` 1.14.21 SDK is installed; it is not the host) |
| Previous runtime traces | none used | not applicable |

Applicability limit: which Superpowers and OpenCode versions were active
in the Owner's real sessions is not established by these checkouts, so every
statement below describes the identified checkout only. No source
implementation (code path) was inspected; no row is `IMPLEMENTATION_CONFIRMED`.
No row is `PREVIOUSLY_OBSERVED`. Snapshot read date: 2026-11-08.

| # | Dimension | Native reference | Evidence class | Verified claim and equivalence limit | Justice fixture result |
| --- | --- | --- | --- | --- | --- |
| 1 | Artifact ID, Revision, Digest association | Superpowers `skills/writing-plans/SKILL.md` | UNKNOWN | A text search of the Superpowers snapshot for digest or checksum terms found only an unrelated brainstorming helper script. No plan-artifact digest association was found there. This is not proof of absence. OpenCode V2 was not inspected. Not directly comparable. | N-01, N-02: OBSERVED_PASS |
| 2 | Task/AC/Evidence binding, wrong-task detection | none identified in the Superpowers snapshot | UNKNOWN | No Task/AC/Evidence binding check was identified in the consulted Superpowers material, and OpenCode V2 was not inspected. Not proof of absence. Not directly comparable. | N-03, N-05: OBSERVED_PASS |
| 3 | Missing Evidence versus AC satisfaction or self-report | Superpowers `skills/verification-before-completion/SKILL.md` lines 10 to 33 | DOCUMENTED | Superpowers documents a procedure requiring fresh verification output before success claims. It is a process rule for agents. Whether a mechanical per-AC missing-evidence report exists is UNKNOWN. | N-05, N-07: OBSERVED_PASS |
| 4 | Candidate Scope out-of-path reporting | Superpowers `skills/writing-plans/SKILL.md` lines 97 to 99 (per-task file list); `skills/subagent-driven-development/SKILL.md` line 8 (spec compliance review) | DOCUMENTED (partial) | Plans list exact files and a review checks spec compliance. A mechanical changed-path versus allowlist report is UNKNOWN. Duplication with the review step is possible and not quantified. | N-06: OBSERVED_PASS |
| 5 | Execution claims versus verified execution | Superpowers `skills/verification-before-completion/SKILL.md` lines 17 to 33 | DOCUMENTED | Same source as row 3. It governs agent behavior and review, not a recorded authenticity status field. Not directly comparable. | N-07: OBSERVED_PASS |
| 6 | Owner authority unknown representation | Superpowers `skills/brainstorming/SKILL.md` lines 44 to 49 | DOCUMENTED (partial) | Documents human approval steps before writing specs and plans. A representation of "approval reference present but authority unproven" is UNKNOWN. Not directly comparable. | N-08: OBSERVED_PASS |
| 7 | Deterministic, explainable Text/JSON diagnostics | none identified in the Superpowers snapshot | UNKNOWN | No deterministic diagnostic output was identified in the consulted Superpowers material, and OpenCode V2 was not inspected. Not proof of absence. Not directly comparable. | `s1eDeterministicOutputAndNoUnrequestedActions`, `s1eReportOutputRespectsSafePathBoundary`: OBSERVED_PASS |
| 8 | No unexpected read-only workflow dispatch | none identified | UNKNOWN | Native workflows dispatch subagents by design when invoked; no read-only diagnosis mode equivalent was identified or ruled out. Not directly comparable. | Injected-read spy only; M4 remains SKIPPED_UNPROVEN |

No claim of Justice superiority, detection rate, or improvement is made. Rows
marked DOCUMENTED may overlap with Justice functionality; the overlap is not
measured here.

### Historical / Supplementary Reference (not part of the Native-only baseline)

An earlier draft of this packet also read a local oh-my-openagent checkout
(package 5.1.2, 28 commits after `v5.1.2`, commit
`9cc59fd9c1ec9a9f4c85c9f49ca22d13b6f2e0ab`, path `program/oss/oh-my-openagent`
relative to `$HOME`). OmO is outside the Design section 6 baseline, so none of
the following counts as a Superpowers + OpenCode V2 capability or as
evidence for any dimension above. It is retained for context only.

- `docs/guide/orchestration.md` line 171 documents a per-checkbox evidence
  ledger (`.omo/ulw-execute/ledger.jsonl`) and independent reviewer
  verification of a worker's done claim.
- `docs/guide/orchestration.md` line 311 mentions exact files in scope.
- `docs/guide/binary-install.md` contains only release-binary checksums.

Because OmO is excluded, dimensions 2 and 7 are UNKNOWN and not directly
comparable; they are not read as absence of Native capability.

## 4. Operational Effectiveness

| Item | Status |
| --- | --- |
| Real-development detection improvement | NOT_MEASURED |
| Real-development false-positive rate | NOT_MEASURED |
| Execution time | NOT_MEASURED |
| Cost | NOT_MEASURED |
| Human Owner burden | NOT_MEASURED |

The 15 fixture tests give counts against 13 explicitly enumerated static
cases only: 13 observed passes, 0 observed failures. These are not real-world
rates and do not show causal superiority. Future S2 measurement is not a
hidden S1 acceptance gate.

## 5. M1 to M5 trace

| Item | Mapped cases | Status |
| --- | --- | --- |
| M1 identity, revision, digest, scope link | P-01, N-01, N-02, N-04 | Observed (4 of 4 OBSERVED_PASS) |
| M2 Evidence binding, AC coverage, claim limits | N-03, N-05, N-07 | Observed (3 of 3 OBSERVED_PASS) |
| M3 contradiction diagnostics | N-01, N-02, N-04, N-05, N-06, N-10a, N-10b | Observed (7 of 7 OBSERVED_PASS) |
| M4 no side effect in the exercised read-only path | `s1eDeterministicOutputAndNoUnrequestedActions` | Partial. Injected read set observed; external writes, dispatch and Host are SKIPPED_UNPROVEN |
| M5 explainable Text/JSON and sourced comparison | `s1eReportOutputRespectsSafePathBoundary`, determinism test, section 3 | Text/JSON observed. Native comparison is sourced but mostly DOCUMENTED or UNKNOWN |

Classification of non-passing areas: observed failure, none. Not executed,
none among enumerated cases. Insufficient Native evidence, dimensions 1, 2, 4,
6, 7, 8 (partly) and the OpenCode V2 version. Genuine safety failure (false
acceptance or authority promotion), none observed.

## 6. Residual risks and unapproved areas

- The test file was uncommitted at execution time and is now committed in
  `bec8099f` (Git blob and SHA-256 recorded in section 1). The CI evidence there
  is separate from the recorded host run.
- The run used the host runtime, not the devcontainer.
- Case rows reflect assertions, not dumped runtime values.
- M4 side effects outside the injected source, and Host behavior, are unproven.
- The Native comparison rests on a local snapshot of Superpowers v6.4.2 and has
  no OpenCode V2 host version; it contains no implementation inspection or
  prior traces. OmO material is supplementary only.
- Fixture coverage is a single Design, Plan, and two Tasks. It does not cover
  other shapes or real repositories.
- Operational effectiveness is wholly unmeasured.
- S2, review loops, Gate changes, commit, push and PR are not authorized by
  this document.

## 7. Human Owner decision options

These are options only. The Owner chooses; this document does not.

| Option | Meaning | Consistency with the evidence |
| --- | --- | --- |
| `ACCEPT_S1_MVP` | Accept S1 functional MVP as exercised | Evidence shows 15 of 15 tests passing with no observed failure or false acceptance; M4 and Native evidence gaps would be accepted as is |
| `ACCEPT_WITH_LIMITATIONS` | Accept and record the limitations in section 6 | The evidence is most directly consistent with this option, given the unproven M4 areas and UNKNOWN Native dimensions |
| `DEFER` | Postpone the decision pending more evidence, such as a devcontainer run or further Native sourcing | Consistent if the Owner wants the gaps closed first |
| `REJECT` | Do not accept S1 as MVP | No observed failure or safety failure supports this option |

Stopping point: this artifact. No further work is triggered by it.
