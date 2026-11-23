# Justice v6 S5 — D-S5-08 / OpenCode 2.3.2 Bounded Design Addendum

**Repository:** `yohi/justice`  
**Issues:** [#358](https://github.com/yohi/justice/issues/358) / [#388](https://github.com/yohi/justice/issues/388)  
**Branch:** `feature/justice-v6-s5-d08-host-v232-design-20261123`  
**Reference baseline:** `master@d644734090aa4ad8cadbefd2d78908067fe36931`  
**Reviewed addendum commit:** `b428d38c3d94a631b10df8a0be7181df4f1038ff`  
**Inputs:** S5 Brainstorming Requirements R0.1 (D-S5-01〜07), Owner-provided local Design R0.1 and Host Execution Manifest R0.1, D-S5-08 (existing Ubuntu Host), and selected Approach A  
**Historical scope of earlier Addendum-only remediation:** RG-S5-D08-001/002/003, without Source/Test/CI changes. Later tracked-document reconciliation and a separate Owner-authorized Source/Test commit took place. This current reconciliation changes only seven tracked S5 documents; the two local untracked drafts remain untouched.  
**Current disposition (2026-11-23 after Source commit `204567a` and Test commit `fa90f9d`):** `D08_DESIGN_ADDENDUM_ADOPTED / S2B_V232_SOURCE_TEST_COMMITTED_NOT_VERIFIED / P04_TEST_ADDED_EXECUTION_NOT_VERIFIED / TRACKED_DOWNSTREAM_DOCS_RECONCILED / LOCAL_UNTRACKED_DRAFTS_HOLD / FURTHER_SOURCE_TEST_WORK_NOT_AUTHORIZED / HOST_GO_HOLD / AC_H01_H03_NOT_RUN / RELEASE_NOT_AUTHORIZED`  
**Authority, chronological:** Human Owner adopted D-S5-08/Approach A **as design policy**, subsequently approved tracked-document alignment and **separately approved the bounded Source/Test implementation and its Commit/Push**, recorded at `204567a`. The present approval authorizes **only seven-document P-04 status reconciliation and its Commit/Push**; it gives no further Source/Test/CI or test-execution authority and no Host Session, credentials/settings, Gate/HOLD, Completion, Release, PR or Merge authority.

## 1. Purpose, agreed scope, and alternatives

Use the **existing Ubuntu Host** and its **existing OpenCode V2.3.2** to obtain bounded real-Host acceptance evidence for the adopted S1/S2/S3 scope. Reuse S1-d, the S2-b READ_ONLY Offline Adapter, and the adopted **single-process** S3-b Decision/Lifecycle consistency recovery. The Owner separately decides `BOUNDED_COMPLETE` and environment-specific `RELEASE_APPROVED`.

D-S5-01〜04/06〜07 remain unchanged. D-S5-05's formerly proposed **independent isolated Host** is **superseded for this S5 acceptance environment by D-S5-08**, which selects logical separation on the existing Host. This is a reduction of isolation assurance, not a claim of VM-equivalent isolation or a retroactive amendment of other adopted records.

### Approaches considered

- **A — selected:** Keep 2.3.2; verify the precise Source/Session/Message/Tool/pagination contract; propose explicit support for **only 2.2.5 and 2.3.2**, with positive/negative tests and fail-closed unknown versions. Any source change requires a **separate** Owner implementation authorization.
- **B — rejected:** Preserve the existing 2.2.5-only gate without extension. A truthful 2.3.2 Source remains rejected and AC-H01 cannot PASS.
- **C — rejected:** Downgrade existing Host V2 to 2.2.5. This modifies the user's working environment and conflicts with D-S5-08.

**Non-goals:** new VM/libvirt/Docker Sandbox, new Collector, general Version framework, S3-c Host Enforcement, S4 Router, multi-process recovery, arbitrary Semantic Recovery, external Tool replay, proof of full Session history, Native-only comparison benefit, all-Finding-zero completion, and automated release.

## 2. RG-S5-D08-001 — Host and authority reconciliation

### 2.1 Fixed / observed / unknown Host identity

| Property | Status / bounded rule |
| --- | --- |
| Host | Owner-observed Ubuntu hostname `coreultra7-270k`; stronger Host identity **NOT_VERIFIED** |
| Launcher | `~/.local/bin/opencode2`; launcher SHA-256 Owner-observed `cb68ec584b3e5e81ca7c2c2ca6a612d56a44672154bf510bf7a1468adee450d1` |
| Binary / Version | Owner-observed native executable version `opencode v2.3.2`; exact binary digest **NOT_MEASURED** |
| Justice | Owner-observed checkout HEAD `d644734090aa4ad8cadbefd2d78908067fe36931`; execution Artifact/Commit still to be fixed before GO |
| Existing Host V2 state | Private XDG Config/Data/Cache/State; `--standalone`; project config disabled by default; inspected JSON has 0 explicit `plugin` and `plugins` entries; other plugin loading **NOT_VERIFIED** |
| Worktree | Two untracked S5 Markdown files observed; preserve them and any other user changes unchanged |
| Dedicated test identity | Workdir, isolated Session and dedicated Task/Plan, Revision, Attempt, Round, Correlation, single Writer, disposable Fixture, Evidence directory: **NOT_FIXED** |
| Credentials and Network | Inherited provider environment variables, Host sockets/services, filesystem access and effective network controls: **NOT_VERIFIED**, not assumed absent or denied |
| Cleanup / rollback | Exact per-AC allowlist, safe stop/readback and non-destructive rollback: **NOT_FIXED** |

The launcher isolates OpenCode V1/V2 XDG paths and uses `--standalone`, but it does **not** isolate V2 sessions from other V2 sessions, OS user permissions, inherited credentials, or permitted network/tool operations. No existing OpenCode V2 settings, Session, credentials, user repository, Gate/HOLD, or unrelated data may be modified. Operate only on Owner-approved dedicated inputs and output paths; shared-state mutation or unbounded side effects cause the affected AC to remain `HOLD`.

### 2.2 Exact downstream reconciliation boundary (not executed here)

This table records historical inconsistencies **before** the subsequent Owner-authorized tracked-document alignment. Requirements, Plan and the three PR #394 deliverables are now document-aligned to D-S5-08. The two **local untracked** Design/Host Manifest R0.1 drafts are not modified and remain Host GO HOLD until safely reconciled or explicitly superseded.

| Existing artifact/section | Old assumption or constraint | Limited change required before Host GO |
| --- | --- | --- |
| S5 Brainstorming Requirements R0.1 §2 D-S5-05, §4, §11 | Independent isolated Host is required | Record D-S5-08 as the Owner-approved exception for **this** acceptance; clarify weaker logical boundary, permissions and shared data risks |
| Existing local S5 Design R0.1 §1, §2.1–2.2, §3–7, §10 | Disposable isolated Host, 2.2.5 binary and wrapper, secrets 0, Host deletion/cleanup | Reconcile existing Ubuntu Host, exact 2.3.2 identity, no Host deletion, dedicated paths, inherited secrets and no overclaimed network denial |
| Existing local Host Execution Manifest R0.1 §1, §2, §5–6 | Independent Host and 2.2.5-only GO/Source contract; ambiguous adopted-Design text | Fix the D-S5-08 target, measured binary digest, read-only Source collection scope, per-AC side effects/stop/cleanup and **Design adoption PENDING** unless independently approved |
| Existing S5 Plan R0.1, Global Constraints / Host-GO Step (incl. Version gate) / Tasks 3–5 | Isolated Host and `hostVersion=2.2.5`; strict `SOURCE_VERSION_UNSUPPORTED` rejection; offline adapter READ_ONLY | Separate **read-only input processing** from any later authorized **source-code compatibility change**, fix targeted Host/version/method and per-AC safe execution; do not broaden Plan GO implicitly |
| PR #394 Acceptance Evidence Record, Intro / Target / AC-H01–H03 | Independent Host required; no measured Host/Version/Operation, ACs `NOT_RUN` | After authorization, reconcile the selected existing Host and measured binary, restrict permitted evidence, and record real results only after execution |
| PR #394 Minimal Operation Runbook, Preconditions / Opt-in / Stop/Rollback | Independent Host, secrets not transferred, network scope unset, no enable/rollback procedure | Replace independent Host prerequisite **only after approved reconciliation** with logical-only boundary and explicit inherited-credential/network/Host-state constraints; define narrowly scoped stop and rollback before GO |
| PR #394 Owner Completion Decision, Target / Completion | Host/Version/Scope unset; Owner decisions `PENDING` | Preserve `PENDING` now. Only Owner may adopt completion/release based on AC evidence later |

**Plan/source authority separation (current):** `S1aReadOnlySource` and `runS2bOfflineAdapter` describe READ_ONLY **input processing**, not code-edit permissions. The original proposal was unapproved at the earlier checkpoint; Human Owner **later separately approved** its bounded Source/Test implementation and Push. At reviewed Source HEAD `204567a696bc68ce9c906b3a74fec1f84c816496`, the Owner-approved bounded S2-b Source/Test change is **committed**, not verified: `S2B_SUPPORTED_HOST_VERSIONS=["2.2.5","2.3.2"]` is checked by exact literal membership in `validateWrapper()`; the legacy singular 2.2.5 export remains. Related tests are present, but **Vitest, typecheck, lint, and TDD RED→GREEN are NOT_RUN / unconfirmed**. This is not real-Host evidence, AC PASS, Owner Completion or Release authority. Further Source/Test/CI work and test execution require separate Owner approval; **Host GO HOLD, AC-H01/H02/H03 NOT_RUN**. The old untracked Design/Host Manifest and actual Host operation are unaffected.

**Security requirements unchanged:** no credential export or reading sensitive values; only explicit network destinations/protocols/durations if needed; no assumption of OS-enforced deny from application flags; dedicated writable locations only; no unapproved external Tool calls, process/network/shared-state changes or cleanup; private raw Evidence with sanitized public references and digests. If a boundary cannot be verified without changing shared Host settings, keep that operation HOLD.

## 3. RG-S5-D08-002 — OpenCode 2.2.5/2.3.2 bounded compatibility contract

### 3.1 Fixed-tag evidence and exact claims

The fixed OpenCode tags used here are [`v2.2.5`](https://github.com/anomalyco/opencode/tree/v2.2.5) and [`v2.3.2`](https://github.com/anomalyco/opencode/tree/v2.3.2). Evidence is from *Git Blob identity*, not inference from version numbering:

| Source file | v2.2.5 Git Blob | v2.3.2 Git Blob | Scope of conclusion |
| --- | --- | --- | --- |
| `packages/protocol/src/groups/message.ts` | `a50080af09562f89fb6a8a5cbc2f0fe840ad2d3b` | Same | Message API query and response contract, including cursor handling, unchanged in this file |
| `packages/schema/src/session.ts` | `b03d42cf29656393254843dd70eb68dc8caf4029` | Same | Shared Session schema unchanged in this file |
| `packages/schema/src/session-message.ts` | `639ad0472eafddc7358c526064bd22748c370aa9` | `5c1755c45ec1c5b952ab95f70574e4e172c3d696` | Assistant message `time.firstToken` is a new **optional** timestamp; no claim that every runtime response contains it |
| `packages/protocol/src/groups/session.ts` | `a1249ce905468f0dbb4292b51c1f851c8a45f0f5` | `1ac6b5bb460ac443f6f4c214129c0f212764581a` | Whole route file **not** identical, although inspected `session.get` path and response declaration are unchanged |
| `packages/schema/src/tool.ts` | `06dec1c0c57c1a6c5809eae1bd61a89e1b9cd8c1` | `c2f9f017d29e19f6165d3b7153fd08fe7b58286b` | Tool schema file changed: **do not** infer all Tool structures and semantics are identical without bounded validation |

**Historical baseline `d6447340...`:** the `S2B_SUPPORTED_HOST_VERSION = "2.2.5"` equality gate rejected other versions. **Source at `204567a`:** the legacy singular export is retained, but `validateWrapper()` uses the new exact `S2B_SUPPORTED_HOST_VERSIONS = ["2.2.5", "2.3.2"] as const` allowlist. This is a code inspection result only; the new behavior is **NOT_VERIFIED by executed tests**. 

**Design target now implemented in code, but not verified:** exact literal `2.2.5` and `2.3.2` admission is committed at `204567a`. Its behavior and preservation of the bounded contracts still require execution evidence. Reject `"2.2.6"`, `"2.3.3"`, empty/unknown/future versions or a missing/non-string version with existing fail-closed diagnostics. Do not accept a range/prefix such as `2.x`, do not change a real 2.3.2 wrapper to pretend it is 2.2.5, and do not treat the wrapper's self-declared `hostVersion` as independent binary attestation.

### 3.2 Accepted acquisition and offline contracts (proposal)

Use the tagged API only through a **separately approved bounded read path**, with a dedicated Session and no unapproved Host/service/config changes:

1. `GET /api/session/:sessionID` (`session.get`) returns `{ data: SessionInfo }` and supplies the saved `session.response` raw JSON. It must match the same Session ID and the fixed measured Host. Optional second read may populate `sessionAfter` only if approved.
2. `GET /api/session/:sessionID/message` (`session.messages`) returns `{ data: PublicSessionMessage[], cursor: { previous?, next? } }`. First request uses `order=asc` and a fixed `limit` from 1 to 200; following requests omit `order` and provide the preceding non-empty opaque `cursor.next`. Do not use the API `type` filter, even though upstream supports it, because S2-b rejects filtered Source collections.
3. Save the *actual response bytes* inside a `justice-s2b-source-v1` wrapper, together with collection metadata, page index, request metadata, timestamp, and the **actual** `hostVersion="2.3.2"`. Preserve the raw response spans without JSON normalization/re-serialization that would erase byte identity; keep raw content private. Create an independent `justice-s2b-correlation-v1` with verified Message/Tool ID-to-Task/Revision/Scope/AC bindings. Acquisition and Correlation provenance must be recorded separately.
4. The existing **offline-only** `runS2bOfflineAdapter(request: S2bRequest, source: S1aReadOnlySource, runS1d?)` uses `request.loaderInput`, `sourcePath`, `correlationPath`; it calls `validateS2bSource()`, `validateS2bCorrelation()`, `projectS2bEvidence()` and, only for non-REJECTED projection, `runS1dDiagnostic()` via its virtual source. No network or Session collection is implemented in S2-b.
5. S2-b retains wrapper/schema/response strictness, size limits, distinct input paths, TaskIntent snapshot consistency, page and cursor continuity, duplicate Message-ID rejection, conflict-aware selected Binding handling (with REJECTED/LIMITED outcomes where applicable), Tool part ID confirmation, `coverageCompleteness="NOT_ESTABLISHED"`, `provenanceClass="UNVERIFIED_EXTERNAL"`, and `reportedOutcome="UNKNOWN"`. A `LIMITED`/`PROJECTED` result is not automatic AC-H01 PASS.

Source limits remain those in `S2B_LIMITS` (e.g. max 64 pages, 200 Messages/page, 4,096 Messages/collection, 75,497,472 wrapper bytes). Missing/ambiguous Tool identity, unexpected message shape, broken cursor chain, filtered collection, or incomplete required evidence cannot be silently treated as full coverage. For 2.3.2 Assistant Messages, `time.firstToken` is **optional** in the upstream schema. The existing Justice `isMessage()` (`src/runtime/s2b-input.ts`) checks `time.created` and optional `time.completed` but **does not inspect or validate `time.firstToken`**. Thus a present value of the wrong type is **not, by itself, a reason for the current validator to reject or limit a Source**. If all fields actually checked by Justice are valid, the existing parser may accept that Message; this does **not** establish upstream schema conformance or timestamp validity. The bounded 2.3.2 compatibility design must not claim such validation. Adding validation for present `firstToken` (without making it mandatory or changing 2.2.5 behavior) is a **separate, currently unauthorized Source/Test change**; until authorized and verified, any acceptance claim depending on first-token correctness remains `NOT_VERIFIED` and cannot independently establish AC-H01 PASS. Other invalid Tool/Message fields **that are actually checked** retain the existing REJECTED/incomplete behavior. The changed upstream `tool.ts` Git Blob requires a focused review of the **Assistant Content `type="tool"` and Tool state** fields actually consumed by S2-b, not an assumption that arbitrary tool usage is compatible.

**Foreign Correlation admission:** `validateS2bCorrelation()` performs structural checks; `projectS2bEvidence()` distinguishes selected Task/Scope bindings from foreign bindings. A **well-formed, non-conflicting foreign-only** Correlation is counted as `FOREIGN_TASK_EXCLUDED`, but its presence does not itself force `REJECTED`/`LIMITED`: with a complete valid collection and no selected failures, the existing projector can return `PROJECTED` with **zero selected EvidenceRefs**. This is an adapter status, **not** proof that the intended Task/AC was accepted or that AC-H01 passed. Malformed binding structures reject at validation, while selected conflicts/missing Message/Tool candidates retain their existing `REJECTED`/`LIMITED` outcomes depending on whether independently valid selected Evidence survives; do not mix foreign Evidence into the selected Task. Do not change these semantics merely to achieve a preferred test outcome.

**Evidence-origin choice:** Keep the established deterministic prefix **`oc225-msg-`** for existing EvidenceRef `originId` *in this bounded design*, to protect the 2.2.5 identity contract. This is a historical opaque identifier format, **not** a declaration of OpenCode version, verified Source authenticity, or Host provenance. Store actual `hostVersion`, fixed binary digest and acquisition provenance **separately** in the private Evidence record. Never infer Version from `originId`; any proposed rename/versioned origin scheme requires explicit compatibility/identity analysis and separate authorization. Preserve existing Evidence ID digest inputs and collision rejection.

### 3.3 Required positive and negative test matrix — specification; execution NOT_RUN

| ID | Scenario / fixture | Expected bounded result |
| --- | --- | --- |
| P-01 | Existing valid 2.2.5 Source, unchanged schema, valid correlation and complete page chain | Existing accepted projection/S1-d behavior and Evidence/Origin identity are unchanged (regression) |
| P-02 | Realistic 2.3.2 Source, truthful `hostVersion`, compatible Session and normal Assistant Tool, valid correlation, one complete ascending page | After the separately authorized **code commit**, expected but **not verified by execution**: non-REJECTED projection and S1-d; correct Task/Revision/Scope/AC attribution; no unjustified coverage guarantee |
| P-03 | 2.3.2 Assistant time **with and without** optional `firstToken` | Both accepted when all **currently validated** fields are valid; `firstToken` presence is not required and its value is **not validated by existing `isMessage()`**; no type/meaning assurance is inferred |
| P-04 | 2.3.2 two-page Session with valid opaque `cursor.next`, no type filter, no duplicate Message | Test code **ADDED** as `v232PositiveTwoPageCursorChainCompletes` at `fa90f9d` (+20 lines); expected `PAGINATION_COMPLETE`. Test execution **NOT_RUN**, result **NOT_VERIFIED**; real-Host acceptance **NOT_RUN** |
| N-01 | Unknown or missing/non-string `hostVersion`, including `2.2.6`, `2.3.3`, `2.x` | `REJECTED`, appropriate fail-closed diagnostic; no S1-d invocation |
| N-02 | Actual Host 2.3.2 with wrapper falsely claiming 2.2.5, or mismatched binary digest | Host evidence **not admitted**; AC-H01 HOLD regardless of offline adapter acceptance |
| N-03A | Present but malformed `time.firstToken` (e.g. string rather than timestamp), while every currently validated field is valid | **Existing `isMessage()` does not validate `firstToken`**: Source may still be accepted; do **not** expect automatic `REJECTED`/`LIMITED`, infer timestamp validity, or count this as AC-H01 PASS evidence. Stricter checking needs separately authorized Source/Test work; otherwise the timestamp validity claim stays NOT_VERIFIED |
| N-03B | Unsupported Assistant Tool shape or duplicate/ambiguous **selected** Tool ID | Preserve existing checked Tool/Message schema and projector diagnostics; `REJECTED`/`LIMITED` according to surviving selected Evidence and collection status; no false attribution or AC PASS |
| N-04 | Filtered Message collection (`type` present), wrong Session ID, malformed first request, broken/looping cursor, page/byte/count overflow, duplicate Message IDs | Existing rejection/incomplete policy and limit diagnostics preserved; no optimistic completeness |
| N-05A | Complete valid Source and **only well-formed, non-conflicting Foreign Bindings** for a different Task/Scope; no selected Binding | `FOREIGN_TASK_EXCLUDED` is diagnosed; existing projection **may be `PROJECTED` with zero selected EvidenceRefs** when collection is complete. Do not interpret `PROJECTED`, zero Evidence or S1-d invocation as target AC PASS; no foreign Task Evidence is admitted |
| N-05B | Structurally invalid or absent required Correlation, duplicated/conflicting **selected** Binding or Tool ID, selected AC mismatch, or missing selected Message/Tool | Preserve structural `REJECTED` and selected-candidate `REJECTED`/`LIMITED` outcomes according to surviving valid selected Evidence and Collection status. A well-formed Task/Revision/Scope mismatch is a **Foreign Binding** evaluated under N-05A, not automatically a rejection; no cross-Task Evidence or false acceptance |
| N-06 | A collection rejected before projection | `s1d` absent; `runS1dDiagnostic` not invoked (existing guarantee) |

**Test authority/status:** Human Owner **separately authorized and committed** the bounded Source/Test change at `204567a`, but no Vitest/typecheck/lint or RED→GREEN has been executed/confirmed. P-04 test `v232PositiveTwoPageCursorChainCompletes` was **ADDED** in `fa90f9d`, not executed (NOT_RUN / NOT_VERIFIED). The earlier missing-test addition instruction is fulfilled; do not duplicate it. This document-only task does not authorize further tests or test executions. Any compatibility FAIL, incomplete API/Tool/response evidence, or unproven Host-version attribution leaves **AC-H01 HOLD**, not PASS.

## 4. RG-S5-D08-003 — Existing interfaces, acceptance and failure boundaries

### AC-H01 — bounded real OpenCode Source to S1 diagnostic

**Existing interfaces:** OpenCode native `session.get`/`session.messages` API described in §3.2; Justice `S2bRequest`/`S1aReadOnlySource`, `validateS2bSource`, `validateS2bCorrelation`, `projectS2bEvidence`, `runS2bOfflineAdapter` and S1-d diagnostic. The **read mechanism** and its auth, endpoint/socket exposure, Source capture method and exact read-only impact on the existing Host are **NOT_VERIFIED**: the launcher uses a private `--standalone` server, not an automatically authorized shared API endpoint. No speculative CLI flags, process startup, new Collector or shared config modifications are permitted.

**Future bounded flow:** Owner-approved dedicated Session → actual GET response bytes with observed Host identity/digests → saved source wrapper + independent Correlation → READ_ONLY Offline Adapter → S1-d result → private evidence ledger and sanitized public summary. A stored/declared `hostVersion` is never independent Host evidence. An optional diff cannot substitute for missing required Message/Tool Evidence. PASS is limited to observed Source capture and end-to-end attributable diagnostic, and never proves full history or Native-only superiority.

### AC-H02 — Authority / Evidence negative controls

**Existing interfaces:** offline S2-b validators, Evidence projection into S1-d and adopted Justice Authority/Acceptance/Decision boundaries. Use separate, disposable **copies** of the approved dedicated H01 inputs for mismatch (Task/Revision/Scope/Correlation), missing Message/Tool/Evidence, and absent/expired/unmatched/self-declared Authorization. Tie expected non-acceptance to a concrete Decision/State transition observation point **before GO**; do not equate an S1-d diagnostic with runtime enforcement. Existing unrelated Task/Plan/Session data are read neither for mutation nor as negative-fixture inputs.

**PASS requires:** genuine target-specific rejection or HOLD, explicit `UNKNOWN`/`NOT_VERIFIED` where appropriate, and demonstrated non-interference for independent normal work. Unexpected false admission is `FAIL`; inability to observe the binding or prove non-interference is `NOT_VERIFIED`. Justice-internal non-acceptance **does not demonstrate Host pre-execution denial**, which is not implemented/verified.

### AC-H03 — single-process S3-b Decision/Lifecycle consistency recovery

**Existing interfaces:** `JusticePlugin.initialize()` calls `planBridge.restoreActivePlans()` and, **only if that recovery is authoritative**, `recoverPendingFinalizations()`, `reviewCompletionDomain.recoverStagedReviewCompletionsAfterRestart()`, `recoverAcceptedTaskProgress()` for active bindings, and `reviewDispatchState.recoverReviewDispatchesAfterRestart()`; backing interfaces include `ObservationLogStore` durable readback, S3-b `inspectDurableLifecycleTransition`/Acceptance decisions and staged Review completion. Initialization can load persistence and global state; **do not invoke a default instance on existing shared Host data** merely to satisfy AC-H03.

**Future GO prerequisites:** a demonstrated dedicated FileReader/FileWriter and workspace/private/global-store boundary, one durable Writer and process, replay-safe staged Task/Plan fixtures with authoritative binding, provably bounded restart/stop mechanism, independent durable log readback and a reversible partial-failure injection at the Decision-persisted/Lifecycle-not-yet-appended boundary. These are **NOT_VERIFIED**, not observed failures. If any require modifying user/global State, real credentials, existing Session data, or unbounded process failure, H03 remains HOLD.

**Proposed bounded cases:** (N) normal staged terminal Decision and matching Lifecycle, independent readback/projection and no duplicate on repeat; (R) authorized, reversible missing-Lifecycle partial failure and single recovery transition after restart, with no early Task/Plan progression; (C) duplicate/competing transition fail-closed without cross-task side effects; (W) Rework only if separately fixed in the adopted Task/Plan scope. Preserve distinctions between Task and Plan coverage; do not claim untested cases. An observed incorrect progression/side effect is `FAIL`, and an unobservable or unsafe injection/restart is `NOT_VERIFIED` (or `NOT_RUN` if not attempted), never PASS.

## 5. Safety, stop, evidence, and completion contract

- **Host/Version gate:** before any AC execution, Owner fixes Host instance, actual executable and binary SHA-256, Justice Commit/build, dedicated Session/Task/Plan identity, exact Source method and collection caps, permissions, and readback paths. Missing or mismatched identity leaves applicable AC `NOT_RUN`/HOLD.
- **Network/Secrets:** shared-Host OpenCode may inherit credentials and network access. Do not copy, inspect or expose existing secrets. No blanket 'network denied' claim without effective enforcement. Bound allowed endpoints, times, process environment and billing-sensitive model/tool calls; if unavoidable unapproved access or side effect exists, HOLD that operation.
- **Writes/non-interference:** only specifically approved dedicated files/fixtures and ephemeral process state; no shared Host config, existing Session, repository modifications or historical Gate/HOLD changes. Keep raw Session/Message/Tool private, public records sanitized, with digest and separate independently observed provenance. No cleanup outside the explicit disposable allowlist or of original Evidence.
- **Stop/rollback:** on surprising external write, credential leak, wrong version, unverifiable Authority/Correlation, mismatched durable readback, duplicate transition, premature Task/Plan progress or unbounded failure injection, stop **affected** operations, retain evidence, report uncertainty, and perform no destructive cleanup or replay. Independent safe work may continue only if independence is demonstrated.
- **Outcome taxonomy:** `NOT_RUN` (not executed), `NOT_VERIFIED` (executed or inspected but required evidence insufficient), `FAIL` (required condition demonstrably false), `PASS` (bounded, positively evidenced). S2-b `REJECTED`/`LIMITED`/`PROJECTED` is a separate adapter status, not an AC outcome. No automatic inference from mock/CI, fixed-tag source inspection, or self-declaration to real-Host PASS.

Completion still requires **all** AC-H01/H02/H03 to PASS on the fixed Host/Version/Scope/Operation, attributable evidence and Owner Authority, disclosed residuals, proven adequate stop/rollback and the Owner's explicit `BOUNDED_COMPLETE`. `RELEASE_APPROVED` is a **separate explicit** environment-specific opt-in approval. Both remain `PENDING`; no release or automatic enablement. Major inherited limitations remain: logical-only isolation, no Host pre-execution enforcement, S2-c `COMPARISON_NOT_ESTABLISHED`, S3-a M-2, legacy Staging gaps, unproven external Writer durability/multi-process recovery and other Versions.

## 6. Traceability and Human Owner checkpoint

**Historical checkpoint (earlier Addendum-only remediation):** The previous §6 described the time **before** the separately Owner-approved downstream document reconciliation. At that earlier checkpoint, Requirements, Plan, Acceptance Record, Runbook, and Owner Completion Decision had not yet been edited; the earlier `DESIGN_ADOPTION_PENDING` and "single-document limited remediation" wording is **historical, not the current approval status**.

| Finding | Design coverage in this Addendum | Current state and remaining HOLD |
| --- | --- | --- |
| RG-S5-D08-001 | §2 records the change from independent isolated Host / 2.2.5 assumptions to D-S5-08 existing Ubuntu Host / OpenCode V2.3.2 with logical-only separation, plus the Source READ_ONLY vs code-change authority distinction | **Tracked** Requirements, Plan, Acceptance Evidence Record, Minimal Operation Runbook and Owner Completion Decision are now **document-aligned** under separate Owner approval. The **local untracked** S5 Design R0.1 and Host Execution Manifest R0.1 are **not reconciled or superseded** and remain a **Host GO blocker**; do not overwrite them |
| RG-S5-D08-002 | §3 fixes bounded Version allowlist, Session/Message/Tool/pagination, optional `firstToken`, foreign Correlation and test expectations | **Source/Test code committed** at `204567a`: 2.2.5/2.3.2 exact guard. **P-04 `v232PositiveTwoPageCursorChainCompletes` ADDED in `fa90f9d`; Vitest/typecheck/lint NOT_RUN, result NOT_VERIFIED; no AC PASS** |
| RG-S5-D08-003 | §4–5 identify existing S2-b and `JusticePlugin.initialize()` interfaces, AC-H01/H02/H03 observation boundaries, non-interference, and stop/restart/readback conditions | Real Host Source GET, dedicated durable-state/restart/injection safety, binary digest, and AC-H01/H02/H03 execution remain **NOT_VERIFIED or NOT_RUN as applicable**; no real-Host PASS has been recorded |

**Current Owner checkpoint (after tracked-document reconciliation, 2026-11-23):** `D-S5-08_DESIGN_POLICY_ADOPTED` (**only this bounded Addendum and Approach A**), tracked Requirements/Plan/three deliverables **document-aligned**, **Implementation Readiness BLOCKED**. Document alignment does not certify real Host safety, alter the Owner's Completion Decision, or resolve the two untracked local drafts. Their older Host/version conditions remain **HOLD until explicit safe reconciliation or supersession before Host GO**.

**Present gates (after separately approved source commit):** further Source/Test/CI changes and test execution **NOT_AUTHORIZED**; `HOST_GO_HOLD`, `AC-H01/H02/H03=NOT_RUN`, `BOUNDED_COMPLETE=PENDING`, `RELEASE_APPROVED=PENDING`. The earlier `SOURCE_IMPLEMENTATION_NOT_AUTHORIZED` label was a historical pre-commit checkpoint. This present approval authorizes **only seven-document reconciliation and its Commit/Push**, not Host GET/Probe, shared settings or Credentials, Gate/HOLD changes, Release, PR or further Task.

## 7. Owner adoption and downstream alignment (2026-11-23)

- The Owner explicitly adopted **the bounded D-S5-08/Approach A Addendum**, not AC execution, Completion or Release.
- The **earlier** document-only alignment updated Requirements, Plan, Acceptance Evidence Record, Minimal Operation Runbook, Owner Completion Decision and this Addendum. Separately approved Source/Test files were later committed at `204567a` **without executed tests**. This current update is seven tracked S5 documents only.
- Existing local untracked `justice-v6-s5-operation-completion-design-r0.1.md` and `docs/superpowers/operations/justice-v6-s5-host-execution-manifest.md` were **not accessed, overwritten, uploaded or recreated**. Old isolated-Host/2.2.5 assumptions require explicit reconciliation/supersession before Host GO; preserve original worktree.
- Current S2-b Source includes an exact 2.2.5/2.3.2 allowlist and added tests at `204567a`; **test execution NOT_RUN**, positive 2.3.2 multi-page test `v232PositiveTwoPageCursorChainCompletes` **ADDED in `fa90f9d`, NOT_RUN / NOT_VERIFIED**. Historical `oc225-msg-` and `issuerId="opencode-v225-record"` are not independent Host Version attestations.
- `AC-H01/H02/H03=NOT_RUN`, `BOUNDED_COMPLETE=PENDING`, `RELEASE_APPROVED=PENDING`, and Host GO HOLD remain unchanged. Subsequent tasks require separate Owner approval.

## 7. Immutable read-only references

- [OpenCode v2.2.5 Message API](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/protocol/src/groups/message.ts) / [v2.3.2](https://github.com/anomalyco/opencode/blob/v2.3.2/packages/protocol/src/groups/message.ts)
- [OpenCode v2.2.5 Session schema](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/schema/src/session.ts) / [v2.3.2](https://github.com/anomalyco/opencode/blob/v2.3.2/packages/schema/src/session.ts)
- [OpenCode v2.2.5 Message schema](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/schema/src/session-message.ts) / [v2.3.2](https://github.com/anomalyco/opencode/blob/v2.3.2/packages/schema/src/session-message.ts)
- [Justice S2-b contract](https://github.com/yohi/justice/blob/d644734090aa4ad8cadbefd2d78908067fe36931/src/runtime/s2b-contract.ts), [validator](https://github.com/yohi/justice/blob/d644734090aa4ad8cadbefd2d78908067fe36931/src/runtime/s2b-input.ts), [projector](https://github.com/yohi/justice/blob/d644734090aa4ad8cadbefd2d78908067fe36931/src/runtime/s2b-projector.ts), [adapter](https://github.com/yohi/justice/blob/d644734090aa4ad8cadbefd2d78908067fe36931/src/runtime/s2b-offline-adapter.ts)
- [JusticePlugin.initialize](https://github.com/yohi/justice/blob/d644734090aa4ad8cadbefd2d78908067fe36931/src/core/justice-plugin.ts), [S5 Candidate Plan](https://github.com/yohi/justice/blob/d644734090aa4ad8cadbefd2d78908067fe36931/docs/superpowers/plans/2026-11-17-justice-v6-s5-operation-completion.md)
