# SDD ledger — plan: docs/superpowers/plans/2026-11-10-justice-v6-s2c-controlled-native-comparison.md

## Explicit human approval recorded
- Date: 2026-11-10
- User confirmed: start implementation from first task of this plan.
- User approved scope: Host operations, Secrets/Network use, model calls, test execution, Commit/Push/PR, GitHub reflection of evaluation results — all approved for this run.
- Plan status at start: `PLAN_DRAFT_FOR_OWNER_DECISION / GITHUB_RECORDED / EVALUATION_NOT_RUN / EXECUTION_BLOCKED`. Execution proceeds under the explicit Owner approval recorded above.

## Task tracking
- Parent: `T-ae3a456a-2318-4b35-9b4b-af3d8e20a2ef` — S2-c Controlled Native-only Comparison plan execution
- Task 1: `T-45133da9-4127-40ab-942d-bae2f139648d` — Authorization, source selection, and immutable baseline `COMPLETED_WITH_BLOCKER / NOT_ASSESSABLE`
- Task 2: `T-603dfee6-c62a-454a-83ee-efa8f65e3cee` — Exactly six immutable cases and blinded Ground Truth (blocked by Task 1)
- Task 3: `T-6661b082-c0b8-414c-8717-0b645a54335b` — Existing S2-b report generation and bounded diagnostics (blocked by Task 2)
- Task 4: `T-5b3f2b19-08b2-49ce-850c-3f04c36ad9a3` — Independent Native-only / Native + Justice reviews (blocked by Task 3)
- Task 5: `T-eb0d57d0-40d4-4e98-ba40-2ebe6ea9c3b3` — Strict scoring and minimal Owner decision report (blocked by Task 4)

## Pre-flight conflict scan
| Pair / item | Check | Finding | Ruling |
| --- | --- | --- | --- |
| Task 1 → Task 2 | Task 1 produces read-only baseline; Task 2 consumes it | Interface matches; no conflict | Proceed |
| Task 2 → Task 3 | Task 2 produces fixed cases; Task 3 runs S2-b on them | Interface matches; no conflict | Proceed |
| Task 3 → Task 4 | Task 3 produces S2-b reports; Task 4 adds to Native+Justice arm | Interface matches; no conflict | Proceed |
| Task 4 → Task 5 | Task 4 produces review responses; Task 5 scores them | Interface matches; no conflict | Proceed |
| All tasks vs Global Constraints | No product source edits, no secret leakage, no truth escalation | Tasks respect constraints | Proceed |
| Task 1 Step 2 | Plan requires real OpenCode v2.2.5 saved session API responses, but does not specify their location | External input not pre-located in repo | Implementer must locate or request; if unavailable, report `NOT_ASSESSABLE` / `EXECUTION_BLOCKED` and STOP. Do not fabricate or use synthetic test fixtures as real data. |
| $S2C_WORKSPACE | Plan says "Owner-approved repo-external private directory" without a fixed path | Path ambiguity | Use this plan's git-ignored SDD workspace: `.superpowers/sdd/2026-11-10-justice-v6-s2c-controlled-native-comparison/` as the concrete `$S2C_WORKSPACE`. This keeps outputs outside the source tree and under the recorded approval. |
| Task 4 model / cost | Plan requires 6 cases × 2 arms = 12 model calls, but no model ID/version specified | Operational ambiguity | Implementer must fix model ID/version, seed/temperature, effort, cost limits in Task 4 Step 1 and record them; if no model access is available, mark reviews `NOT_RUN` and continue scoring only completed pairs. |

## Task 1 result
- Status: `complete (BLOCKED / NOT_ASSESSABLE)`
- Reason: No real OpenCode v2.2.5 saved `session.get` + `session.message.list` API responses located; local host version is 1.19.0, not 2.2.5.
- Deliverables: `authorization.md`, `identity.json`, `baseline/README.md`, `evidence/`, `task-1-report.md` committed in workspace.
- Workspace commits: `5d84d3b`, `5cf32cf`, `ca0aea3`, plus fix-round commits.
- Verification: `bun run vitest run tests/s2b` 104/104 passed; `bun run typecheck` passed; `bun run build` passed; `bun run lint` 0 errors.
- Decision: STOP here; Tasks 2–5 blocked pending Owner-provided real v2.2.5 saved API responses.

## In progress
No further tasks proceed without real baseline.

## Task 1 review round 1
- Reviewer: Sisyphus-Junior (sp-review)
- Review package: review-empty..HEAD.diff (16196 bytes)
- Verdict: Task quality: Needs fixes
- Critical: none
- Important findings to fix:
  1. `authorization.md` must explicitly record the approved target Version/Commit (`2.2.5` + `650c944...`) and must not attribute GitHub-reflection approval to the plan text (the plan prohibits it until separate approval); cite the Owner's direct approval from the dispatch instead.
  2. `identity.json` must add an `evidenceLocation` pointing to saved raw test/typecheck logs for the S2-b functional verification, and must record the product HEAD / working-tree state at test time.
  3. Remove host-specific absolute paths from `identity.json` and `task-1-report.md` to comply with the No Absolute Paths rule; update recorded hashes after editing.
- Minor findings recorded (see review output); do not block fix loop.
- Fix round: 1 of 5; resume original implementer.

## Task 1 review round 2 (re-review of fix round 1)
- Re-reviewer: Sisyphus-Junior (sp-review)
- Re-review package: review-ca0aea3..HEAD.diff
- Verdict: Findings remain open
- Finding 1 (authorization target Version/Commit + GitHub citation): ADDRESSED
- Finding 2 (identity.json evidence location + test state): ADDRESSED
- Finding 3 (host absolute paths): ADDRESSED — task-1-report.md references now use `$HOME/.local/share/...` and `/home/<user>/...` is no longer committed literally; evidence file redacted.
- New Critical/Important breakage: none
- Minor observations: authorization.md:17 wording, identity.json updatedAt before createdAt, evidence role label "full output" vs redacted output.
- Fix round: 2 of 5; resume original implementer.

## Task 1 review round 3 (re-review of fix round 2)
- Re-reviewer: Sisyphus-Junior (sp-review)
- Re-review package: review-c336fd7..HEAD.diff
- Verdict: All findings addressed, no new Critical/Important breakage
- Finding 3 (absolute paths): ADDRESSED — no literal host-specific absolute paths remain in tracked text files.
- Finding 1 (authorization wording): ADDRESSED.
- Finding 2 (evidence location): ADDRESSED.
- Deferred Minor: `identity.json` `updatedAt` is still earlier than `createdAt` under UTC semantics (timezone offset mix). Does not block Task 1.
- New Critical/Important breakage: none.

## Task 1 completion
- Status: `complete (BLOCKED / NOT_ASSESSABLE)`
- Reason: No real OpenCode v2.2.5 saved `session.get` + `session.message.list` API responses could be located in the environment, and the local OpenCode host version is 1.19.0 (required 2.2.5).
- Decision per plan deliverable/stop: safely stop and await Owner decision.
- Tasks 2–5 remain blocked until a valid immutable baseline exists.
- Workspace commits: `5d84d3b`, `5cf32cf`, `ca0aea3`, `c336fd7`, `eb27d54`.

## PENDING transition
- Date: 2026-11-10
- Authority: Human Owner instruction to record current results as PENDING and stop safely.
- Scope: `progress.md` only; no source code, identity, evidence, plan, or GitHub state changed.

### S2-c Overall Status
`PENDING_INPUT`

### Pending Reason
`OPENCODE_V225_SAVED_API_RESPONSE_UNAVAILABLE`

### Task States
- Task 1: `COMPLETED_WITH_BLOCKER / NOT_ASSESSABLE`
- Task 2: `NOT_STARTED / PENDING`
- Task 3: `NOT_STARTED / PENDING`
- Task 4: `NOT_STARTED / PENDING`
- Task 5: `NOT_STARTED / PENDING`

### Implementation / Evaluation
- S2-b existing functional verification: `OBSERVED_PASS` (104/104 tests passed, typecheck passed)
- S2-c Operational Effectiveness: `NOT_MEASURED`
- Native-only vs Justice comparison: `NOT_RUN`
- Justice incremental value: `NOT_ESTABLISHED`

### Confirmed source status
- Real OpenCode v2.2.5 saved `session.get` response: unavailable in current environment
- Real OpenCode v2.2.5 saved `session.message.list` response: unavailable in current environment
- Local host version observed: `1.19.0`
- Required version: `2.2.5`

### Deferred Finding
- `identity.json` `updatedAt`/`createdAt` timestamp ordering inconsistency under UTC semantics.
- Status: `DEFERRED / NON_BLOCKING_FOR_PENDING`
- Action: leave `identity.json` unchanged for now; revisit only if needed when resuming.

### Restart conditions
1. Owner provides genuine OpenCode v2.2.5 saved `session.get` and `session.message.list` responses, or points to an approved location.
2. Confirm Source Identity, Version, collection scope, permissions, Secrets/Network, cost, STOP conditions.
3. Obtain Owner's explicit approval for the fixed session, 6 cases, injections, sealed Ground Truth, input hashes, scoring rules, and both-arm conditions.
4. Confirm mapping to existing S2-b functional verification evidence for the target commit.

### Relation to S3+
- `PENDING_INPUT` here does **not** automatically BLOCK S3–S5 decisions.
- S3–S5 remain subject to their own Owner approvals.
- S2-c unverified status should be recorded as a residual risk in S5 adoption decisions.

### Work not performed in this transition
- No source code edits.
- No new tests, builds, CI, or model calls.
- No Host operations or real data collection.
- No synthetic fixture creation.
- No new review or fix rounds.
- No Git commit, push, PR, Issue, or Gate changes.

## 2026-11-12 JST — Human Owner-provided development-session capture
- Authority and scope: Human Owner explicitly requested this Git record of the observed capture, artifact hashes, test result, and the interruption/resumption note. This entry is **documentation only**; it does not authorize case injection, new model comparisons, additional independent review, source-code changes, or uploading raw API JSON.
- Provenance: Human Owner executed the collection/verification on their own OpenCode v2.2.5 OC2 Phase 5 R5 Sandbox and Ubuntu host. The outputs below were shared in the conversation; the raw files and tools' internal contents were **not independently inspected** by this recorder.
- Development Session ID: `ses_e34af0584ffeEkqLsNQo1iOVr4`. This is the newly created `s2c-session-inspector` development session, **not** the earlier `Greeting` session.
- Captured `session.get` and unfiltered, ascending `session.message.list`: 37 messages on page 0; zero-message terminal page 1; `cursor.next=null` at the end; `PAGINATION_COMPLETE` for the **saved page sequence only**. This does not prove complete or authentic Host history.
- Observed Tool entries: 32 (glob 3, patch 4, question 8, read 5, shell 7, skill 5). These are occurrences, not independently established successful Tool outcomes.
- Raw-response evidence: `session.get.json`, `messages-page-000.json`, `messages-page-001.json`, `SHA256SUMS` retained **outside Git**, in a private host copy. `sha256sum -c SHA256SUMS` reported **3/3 PASS** both inside the Sandbox and after copying to the Ubuntu host. Individual raw-response digests were not provided to this recorder; no digest value is inferred or invented.
- Development artifacts copied to a private host directory and their SHA-256 values matched the Sandbox originals:
  - `DESIGN.md`: `4fb3c5e8f5ec69822883b1f0bb1e6b5c6f3c4881898b7bbc1cb14a27573ba355`
  - `PLAN.md`: `31b8fd110a9d9ef06be234089a5825b151a0fc9d0342842ffe73e2867a161877`
  - `inspector.py`: `a6fc007d2f205fc5c19f1ca33d6b578bbc5149a90c5f39ca05b399c7425bcb5a`
  - `test_inspector.py`: `310e2008ce488bfbc49d95af5b5889ee4e03385cc403877e991cbc36b75ecd1d`
- `DESIGN.md` has AC-01 through AC-06; `PLAN.md` has Task 1. Human Owner ran `python3 -B -m unittest discover -s . -p 'test_inspector.py' -v` on the copied artifacts and reported **7 tests PASS / 0 failures**. AC traceability and actual Tool outcomes have not been independently established.
- **Execution condition (Human Owner report only):** One accidental `Esc` interruption occurred, followed by the literal instruction `continue` in the same Session. Interruption point, exact interruption semantics, and effects on timing/Token/Tool efficiency were not independently verified. **Do not treat this as uninterrupted execution or silently exclude the resumed turns.** This is not a defect finding and does not require a rerun of the completed development Task.
- **Current status:** `SOURCE_CAPTURE_COMPLETE / HOST_COPY_SHA256_PASS / INPUT_ADMISSION_PENDING`. Earlier `OPENCODE_V225_SAVED_API_RESPONSE_UNAVAILABLE` describes the previous implementer's environment at the time of that report; Owner has now supplied credible capture evidence from a separate environment. The original Task 1 `COMPLETED_WITH_BLOCKER / NOT_ASSESSABLE` remains a historical result, **not** retroactively converted to Task 1 PASS.
- **Remaining boundaries:** S2-b schema-valid Source wrapper, single TaskIntent, independent Manifest digest, explicit Task/Revision/Message/Tool/AC Correlation, redaction preserving identity, and Host/Artifact provenance still require validation; hence S2-c formal input admission and the six-case comparison are **not started**. No raw Message/Tool JSON, Secret, or host-specific path has been committed.
- **Stop/Owner checkpoint:** This documentation-only update ends here. Task 2–5, model calls, case construction, additional reviews, and GitHub changes beyond this single record are not started automatically.

## 2026-11-12 JST — Retrospective S1-a and Supplement 01 Owner checkpoint
- **Authority:** Human Owner approved retrospective Artifact/Correlation establishment, then **one** bounded evidence supplementation attempt (Approach B). After receiving the results, the Owner instructed that the outcome be preserved as a record. This entry records reported results only; it does not approve a repeat attempt, further API capture, comparison, review, or other GitHub changes.
- **Retrospective S1-a result:** `NOT_ASSESSABLE` for full S2-b admission, but 4 S1-a Artifacts (Design/Plan byte copies; Task/AC reconstructed after execution), `manifest.json`, and `task-intent.json` were generated **privately outside Git**. Existing S1-a Loader reported `identityStatus=MATCH`, `identityCandidateReady=true`, `ownerAuthorityStatus=NOT_PROVEN`, `eligibleBaseline=false`. Manifest independent expected SHA-256: `ce669abc66ebfbd6b18d71613f55a618b85c9dfef0061e47c3af239677502703`. Reconstructed Artifact provenance and its limited approval scope were explicitly recorded. No formal runtime-era Task/AC attribution is claimed.
- **Retrospective S2-b gaps:** `source.json` and `correlation.json` **not created**. Original saved API responses did not independently establish `collectedAt`, full per-page request metadata (especially page-1 request cursor), or evidenced Task↔Message / Task↔Tool / Tool↔AC bindings. Saved page responses (37 messages followed by 0 messages and terminal `cursor.next=null`) do not themselves prove request continuity or full Host history.
- **Supplement 01 — `NOT_ASSESSABLE` / safe stop:** The Codex environment inspected the existing process addressed by `OPENCODE_SERVER_URL` and observed **OpenCode 1.19.0**, not required **2.2.5**. No Session API GET was made; no new Collection, request timestamps, Source Wrapper, Correlation, or Adapter report was produced. The previously observed v2.2.5 R5 Sandbox was **not rechecked** by this attempt; do not infer it was lost or changed. No Server/Sandbox was started or modified.
- **Integrity and scope:** Original private Session/Artifact evidence remains unchanged per executor report; SHA-256 was **not rerun during Supplement 01**. No new model calls, case injections, Task 2–5, reviews, product source edits, or Git writes occurred in the executor run. Source raw JSON and private Artifact files are **not committed here**. These findings are sourced from the Owner-shared Codex report, not independently verified by this Git-recording action.
- **Current decision:** `S2-c = PENDING_INPUT`; `S1-a retrospective identity = MATCH_WITH_AUTHORITY_LIMITATIONS`; `S2-b admission = NOT_ASSESSABLE`; `Supplement 01 = CLOSED_NOT_ASSESSABLE`; `S2-c Operational Effectiveness = NOT_MEASURED`; `Native-only vs Justice = NOT_RUN`; `Justice incremental value = NOT_ESTABLISHED`. Previous ledger entries are preserved as historical observations, not retroactively rewritten.
- **Stop / Owner checkpoint:** The authorized single supplementation attempt is closed. Any future baseline strategy, correct-host recapture, prospective instrumented task, or six-case comparison requires a separate scope-specific Human Owner decision; **no automatic continuation or review loop**.


## 2026-11-14 JST — Owner approval to resume and PR #380 merge confirmation
- **Authority:** Human Owner explicitly approved continuation of the S2-c plan implementation. PR #380 is confirmed merged by the Owner. This approval covers resuming from the PENDING_INPUT state and proceeding with baseline construction and the six-case evaluation under the plan's Global Constraints.
- **Scope of this approval:** baseline completion, case construction, S2-b report generation, independent reviews, and scoring, all within the git-ignored SDD workspace and subject to the plan's no-source-edit / no-secret-leakage / no-truth-escalation constraints. The approval does not extend to modifying product source code, creating public PRs, or uploading raw evaluation data to GitHub without separate Owner approval.
- **New evidence:** The private host evidence directory `/home/y_ohi/justice-s2c-private/justice-s2c-be0_k9o_/` was located in the current environment. It contains:
  - `session.get.json` (569 bytes, SHA-256 matches `SHA256SUMS`)
  - `messages-page-000.json` (263,802 bytes, SHA-256 matches)
  - `messages-page-001.json` (50 bytes, SHA-256 matches)
  - `SHA256SUMS` (3/3 verified)
  - `artifacts/DESIGN.md`, `PLAN.md`, `inspector.py`, `test_inspector.py`
  - `derived/` with retrospective S1-a Manifest/TaskIntent and admission reports
- **Functional verification at current product HEAD:** `bun run vitest run tests/s2b` passed 104/104; `bun run typecheck` passed. Current repository HEAD is `927bd49c` (merge of PR #389), which includes the merged PR #380.

## Ruling: wrapper metadata reconstruction
- **Decision:** Proceed with constructing the Justice-defined `justice-s2b-source-v1` wrapper around the verified raw API response bytes.
- **Why:** The saved API responses contain the required Session and Message data but do not include the wrapper-level `collectedAt` timestamps or per-page `request` metadata. Those fields are Justice-defined acquisition metadata, not part of the original OpenCode API responses. Reconstructing them is necessary to invoke the existing S2-b adapter, and the Owner's implementation approval is taken as authorization for this bounded reconstruction.
- **Cost if wrong:** If the reconstructed metadata is later deemed unacceptable, the baseline must be discarded and the evaluation restarted. To limit this cost, every reconstructed field will be explicitly labeled as `RECONSTRUCTED` with its derivation basis, and the original API response bytes will be embedded unchanged so they remain independently verifiable against the recorded SHA-256 values.
- **Boundaries preserved:** No original API byte will be altered; no Message/Tool content will be invented; no Task/Revision/Scope/AC binding will be inferred from free text; no secret will be copied unredacted into the baseline.

## Task state update
- Task 1: `RESUMED / BASELINE_CONSTRUCTION_IN_PROGRESS` (was `COMPLETED_WITH_BLOCKER / NOT_ASSESSABLE`; reopened because capture files are now available and Owner approved continuation).
- Task 2: `NOT_STARTED / BLOCKED_BY_TASK1`.
- Task 3–5: `NOT_STARTED / PENDING`.

## Next actions
1. Complete Task 1 by creating the S2-b source wrapper, explicit correlation, and updated baseline identity records.
2. Obtain Owner confirmation of the fixed baseline before injecting deviations for Task 2.


## Task 1 resumed result — validation blocker found
- Date: 2026-11-14
- Status: `BLOCKED / NOT_ASSESSABLE` (baseline files exist but fail complete admission under current S2-b validator)
- Implementer subagent: `Sisyphus-Junior (sp-implementation)`; report in `task-1-resume-report.md`.
- Workspace commit: `ca6d7bb`

### What was delivered
- `baseline/source.json` (265,047 bytes, SHA-256 `19002ef30dbc43bc9cd9de99919011a54ffd213a28fac35624c669cc834503ae`): `justice-s2b-source-v1` wrapper embedding the original `session.get.json`, `messages-page-000.json`, and `messages-page-001.json` bytes unchanged.
- `baseline/correlation.json` (590 bytes, SHA-256 `174900b3bcbb4ceb1951da55c0211d53854c316ca699b35b11cebc4f3ea30dbb`): structural one-message/one-tool mapping to the retrospective Task/AC.
- Retrospective S1-a artifacts copied into `baseline/`.
- Updated `identity.json`, `authorization.md`, `baseline/README.md`, evidence outputs, brief, and report.

### Functional verification
- `bun run vitest run tests/s2b`: 104/104 PASS.
- `bun run typecheck`: PASS.

### Validation blocker
`validateS2bSource` accepts the wrapper but stops after page 0 and reports:
- `SOURCE_SCHEMA_INVALID: 1`
- `PAGINATION_INCOMPLETE: 1`
- `collectionStatus: PAGINATION_INCOMPLETE`
- `validatedPageCount: 1` (only page 0)

Root cause: the saved page-1 response contains `"cursor": {"previous": null, "next": null}`. The current `src/runtime/s2b-input.ts::parsePageResponse` uses `isOptional(cursor, "previous", isString)` and `isOptional(cursor, "next", isNonEmptyString)`. Because `null` is present but is not a string, the shape check fails. This is a real incompatibility between the captured OpenCode v2.2.5 response shape and the current S2-b validator.

The original API response bytes are preserved unchanged in the private evidence directory and embedded unchanged in `baseline/source.json`. The failure is not due to reconstruction errors; it is due to the product validator's strict cursor-shape contract.

### Owner decision required
Per the brief's stop condition, Tasks 2–5 were not started. To proceed, one of the following paths must be explicitly chosen:

1. **Fix the S2-b validator** (`src/runtime/s2b-input.ts`) to accept `cursor.previous: null` and `cursor.next: null` as valid terminal/null values.
   - This is a product source edit in `src/runtime/**`, which the plan says not to change without a separate Owner decision.
   - A regression test in `tests/s2b/` should be added.
   - Risk: changes product behavior; requires full test/typecheck/build verification.

2. **Normalize the derivative wrapper** (`baseline/source.json`) to remove the null cursor fields from the embedded page-1 response before validation.
   - The original bytes remain untouched in `/home/y_ohi/justice-s2c-private/justice-s2c-be0_k9o_/messages-page-001.json`.
   - The wrapper would be labeled as a derivative normalization, not original bytes.
   - Risk: the comparison input is no longer a byte-identical API response copy.

3. **Stop as NOT_ASSESSABLE**.
   - Record that the S2-c comparison cannot proceed with this capture under the current validator.
   - No further work; no source edits.

**Ruling is pending Owner choice.**

## 2026-11-14 JST — Task 1 resumed validator fix and baseline re-evaluation
- **Authority and scope:** Owner-approved validator fix only. `src/runtime/s2b-input.ts` and `tests/s2b/input-shapes.test.ts` were the only product files changed. Tasks 2–5, model calls, case construction, and Git writes were not performed.
- **Validator change:** `parsePageResponse` now accepts absent/null/string `cursor.previous` and absent/null/non-empty-string `cursor.next`; malformed cursor shapes, non-empty cursor rules, and pagination-chain terminal behavior remain enforced.
- **Regression evidence:** Added coverage for a linked two-page collection ending with `previous: null` and `next: null`, a single-page null-cursor terminal page, and rejection of empty/number `next` and number `previous`. The new test failed before the fix with `PAGINATION_INCOMPLETE` and passed after it.
- **Verification:** `bun run vitest run tests/s2b` — 105/105 PASS; `bun run typecheck` — PASS; `bun run lint` — PASS, 0 errors (313 warnings); `bun run build` — PASS.
- **Baseline re-evaluation:** `bun run baseline/build-baseline.ts` — Source ACCEPTED, `PAGINATION_COMPLETE`, 2/2 pages, only `DIFF_UNAVAILABLE`; Correlation ACCEPTED with no diagnostics. The original response hashes/byte sizes remain unchanged.
- **Admission ruling:** Baseline remains `NOT_ASSESSABLE`. Complete pagination resolves the validator blocker, but wrapper metadata remains reconstructed, Task/AC attribution is retrospective and structural rather than execution-time evidence, and this saved sequence does not establish complete/authentic Host history. Do not proceed to Task 2–5 without separate Owner direction and adequate admission evidence.
- **Report:** `task-1-validator-fix-report.md` records scope, verification, baseline result, and stop decision.


## 2026-11-14 JST — Task 2 completion
- **Authority/scope:** Human Owner approval for Task 2 data preparation recorded in `authorization.md`. No Task 3–5 work, model calls, product edits, or GitHub/Git writes were performed.
- **Cases:** Six independently copied derivative inputs were created under `cases/` using neutral review-facing keys `case-01` through `case-06`. The baseline directory was read-only and remains byte-identical as checked against its recorded inventory hashes.
- **Verification:** All six sources and correlations were accepted by the S2-b validators; all retained the baseline session ID and `PAGINATION_COMPLETE` at 2/2 pages. Projector results matched the private Ground Truth for each case. `case-01` projected; the five injected cases produced their expected diagnostics. See `cases/README.md` for neutral inventory and source/correlation hashes.
- **Ground Truth:** Sealed in git-ignored `private/ground-truth.json`; SHA-256 `7f8da29f99c683b68800e58f10b637a3c959c44ff85a930b063fce7a5795b94e`. Case files and the Ground Truth digest are also recorded in `identity.json`.
- **Admission:** Baseline remains `NOT_ASSESSABLE`; derivative cases do not upgrade evidence quality or establish complete/authentic Host history. Structural retrospective attribution remains a limitation.
- **Task state:** Task 1 `COMPLETED_WITH_BLOCKER / NOT_ASSESSABLE` as an admission outcome; Task 2 `COMPLETED`; Task 3–5 remain `NOT_STARTED / PENDING` pending their own authorization and workflow.
- **Report:** `task-2-report.md`.
