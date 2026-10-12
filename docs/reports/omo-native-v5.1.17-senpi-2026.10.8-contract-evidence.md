# OmO Native v5.1.17 / Senpi v2026.10.8 Contract Evidence

**Status:** PROVEN — latest focused pinned-runtime run reports 32/32 contracts PROVEN
**Task:** Justice v5 Implementation Plan — Revised Task 1 Evidence Spike
**Scope:** tests / fixtures / probes / raw evidence / report only

## Pinned runtime

- OmO Native: `omo-ai@5.1.17`, source `091728d274f20d62504b0b5e1edbc3970671dd8b`
- Senpi: `@code-yeongyu/senpi@2026.10.8`, source `d56e6a260d9468418a39bc9120945cf98e06b840`
- Superpowers: `v6.4.2`, source `8ca22dba9a94f28898bbce59f2537ff4d87c747d`

The runner installed and launched these pinned versions using `omo-mock/mock-1`. It observed a successful method `read` result, a model-issued `task` call with mutable input, a `toolCallId`, and an OmO `st_` runtime task ID. Storage scans were performed before the isolated runtime, session storage, and evidence directory were cleaned up.

## Historical Task 1 evidence

```text
TASK1_RESULT: BLOCKED
```

This historical result belongs to the pre-#296 authority model:

- pre-#296 architecture / evidence contract に対する結果
- native task `tool_call` 単体には independent host-authenticated Superpowers workflow-origin field が存在しなかった
- 当時の direct-origin assertion では required provenance を証明できなかった
- historical fixture/evidence で未証明だった項目も BLOCKED として記録された

> The historical BLOCKED result belongs to the pre-#296 authority model.
> It is retained as historical evidence and is not a failure of the
> approved authenticated protocol-affiliation architecture.

Pinned native `task` tool_call exposes `input`, `toolCallId`, `toolName`, and optional `parentToolCallId`. It does **not** expose a host-independent Superpowers workflow-origin field. That absence is **not** a blocker under the approved architecture.

## Revised Task 1 evidence — approved architecture #296

```text
TASK1_RESULT: BLOCKED

REQUIRED_CONTRACTS:
32 active runtime contracts / PROVEN 27 / BLOCKED 5

AUTHENTICATED_PROTOCOL_AFFILIATION:
BLOCKED

blockedAt:
"5 required runtime contracts lack sufficient evidence"

production source changed:
NO

Tasks 2–14:
NOT_AUTHORIZED
```

Approved architecture authority:

```text
current trusted WorkflowActivationEvidence
+ valid live Justice capability
+ exact private NativeCapabilityOutboundReceipt
+ exact authorization/session/method/read-call binding
+ exact parent tool call / batch item / stripped args digest binding
+ successful capability strip/restoration
+ token-free read-back
=
authenticated protocol affiliation
```

An independent host-observed workflow-origin field is **not** a current authority requirement.

## Contract accounting

```text
BASELINE: master 0a7fa07e2aad63ebd28b403876773d2f0c831e82
BRANCH: spike/justice-v5-native-evidence-294
TASK1_SCOPE: tests / fixtures / probes / raw evidence / report only
REQUIRED_CONTRACTS: 32 active runtime contracts / PROVEN 27 / BLOCKED 5
HISTORICAL_TASK1_RESULT: BLOCKED
HISTORICAL_9_PROVEN_REGRESSION: RETAINED
ACTIVATED_PROTOCOL_AFFILIATION: BLOCKED
RAW_TOKEN_PERSISTENCE_SCAN: NO_TOKEN_FOUND; ISOLATED_TREE_SAFE; SESSION_MANAGER_ENTRIES_UNOBSERVED
PRODUCTION_SOURCE_CHANGED: NO
PACKAGE_CONFIG_CI_CHANGED: NO
TASKS_2_14: NOT_AUTHORIZED
```

The five remaining blocked contracts are:

```text
task1_authenticated_protocol_affiliation_is_bound_without_prompt_inference
task1_capability_never_enters_persisted_session_history
task1_capability_is_removed_before_assistant_tool_call_persistence
task1_message_end_fallback_prevents_token_persistence_on_error
task1_unknown_tool_capability_echo_is_sanitized_before_persistence
```

### Contract-by-contract root cause and disposition

| Contract ID | Required assertion and actual runtime observation | Evidence / gap | Root cause, owner, required change, exit criterion |
| --- | --- | --- | --- |
| `task1_context_copy_delivers_fixture_capability_after_method_read` | **PROVEN.** A successful installed method read activates the parent session; a deep-copied request-local context receives the directive, the original read result object is unchanged, and the mock provider reports `context_messages` as its capability source with the environment fallback absent. | Post-delivery scan is token-free and safe across the isolated runtime tree. | **B — runtime evidence collection defect (repaired).** The scanner had treated missing `getSessionFile()` paths as unsafe despite complete isolated-tree traversal. The fixture now retains strict explicit-path checks when paths exist and verifies expected session IDs from the full tree. Exit: focused runtime assertion passes. |
| `task1_tool_call_binds_capability_session_and_call` | **PROVEN.** Assistant `message_end`, matching stripped native `tool_call`, captured private receipt, and authenticated protocol validation are joined on the same parent session and exact tool-call ID; activation read ID and method also match the delivered context. | The focused runtime assertion passes using the stricter joined evidence predicate. | **C — evaluator predicate defect (repaired).** The earlier predicate only required any capability context and any strip event. The fixture now requires the same-call/session/read/method chain. Exit: focused runtime assertion passes. |
| `task1_authenticated_protocol_affiliation_is_bound_without_prompt_inference` | **BLOCKED.** Runtime validation observes current activation, private outbound receipt, exact call binding, stripped-args digest, successful strip/restoration, and no token in the disk-tree scan; prompt semantics are not used. | The required token-free read-back is not complete because `SessionManager.getEntries()` across parent/child branches was not observed. The validator chain alone is insufficient for PROVEN. | **B — runtime evidence collection defect.** Same history collector as the preceding contract must scan `SessionManager.getEntries()` and bind results to the exact session/call/read chain. Exit: complete, token-free in-memory and persisted read-back validates the exact active protocol call. The missing host-independent workflow-origin field remains outside #296 authority. |
| `task1_capability_never_enters_persisted_session_history` | **BLOCKED.** The isolated-tree scan found no token, all required storage classes, and all 7/7 expected session IDs (`unsafeStorage=false`). | `SessionManager.getEntries()` across all parent/child branches was not observed; disk-tree scan alone does not satisfy the Plan's complete history assertion. | **B — runtime evidence collection defect.** Fixture owner must collect the public `SessionManager.getEntries()` result for parent and child histories, scan every branch, and fail closed for missing/unreadable entries. Exit: memory entries plus disk/history/log/task-state/evidence scans are complete and token-free. |
| `task1_capability_is_removed_before_assistant_tool_call_persistence` | **BLOCKED.** `message_end` sanitation and the final disk scan show no token. | No `AgentSession.subscribe` `entry_appended` observation with immediate JSONL read-back of the exact assistant ToolCall was captured. An after-the-fact scan cannot prove append ordering or the exact original-description value. | **B — runtime evidence collection defect.** Fixture owner must observe every append and immediately read the persisted entry to prove the arguments are token-free before tool execution. Exit: append observation and immediate disk read-back agree for each capability-bearing call. |
| `task1_message_end_fallback_prevents_token_persistence_on_error` | **BLOCKED.** A provider stream error was injected after a capability-bearing tool-call stream. The runtime emitted a same-role assistant error with no capability token or raw exception stack, but its content was **not minimal** (`minimalContent=false`); no failed tool call, receipt, result, or trusted execution was observed. | Required persisted same-role *minimal* fallback after capture/sanitation and receipt invalidation are not established. | **D — pinned upstream runtime limitation; Design/Plan reconciliation required.** The exact pinned runtime surfaced an assistant error retaining ToolCall content rather than the required minimal fallback, and did not produce the expected post-capture receipt path. Do not emulate the fallback in the fixture. Reconcile the approved fallback contract with pinned runtime behavior. Exit: fresh native evidence of the required minimal persisted fallback and receipt invalidation. |
| `task1_unknown_tool_capability_echo_is_sanitized_before_persistence` | **BLOCKED.** The pinned model emitted the unregistered tool call, but no matching `tool_result` or pre-persistence sanitation observation was captured (`resultCount=0`, `sanitizedCount=0`). | The synthetic unknown-tool result path is unproven. The Plan's registered-tool invalid-schema alternative has not been exercised. | **B — runtime evidence collection defect.** Fixture owner must exercise the registered fixture-tool validation-error alternative and observe its persisted synthetic result before sanitation. If the pinned runtime does not expose that result path either, classify as D and request reconciliation. Exit: actual synthetic result is observed, sanitized before append, creates no receipt/provenance, and all storage scans remain safe. |

The historical pre-#296 `TASK1_RESULT: BLOCKED` remains unchanged. JUS5-P296-RG-001/002 are not reopened. No unresolved contract is promoted from test success alone.

## Verification commands

```bash
git diff --check
bun run typecheck
bun run lint
bun run build
bun run test
bun run vitest run tests/integration/omo-native-senpi-contract-spike.test.ts
bun run vitest run tests/integration/omo-native-senpi-process-supervisor.test.ts
```

Verification was run after installing the locked dependencies and building the
Linux review-artifact native addon. The full test suite completed with:

- Full test suite: **2,291 passed, 5 skipped; 167 test files (166 passed, 1 skipped)**
- Focused Task 1: **36 passed**
- Process-supervisor: **1 passed**
- TypeScript: **PASS** (`bun run typecheck`)
- Lint: **0 errors, 286 warnings** (`bun run lint`)
- Build: **PASS** (`bun run build`)
- Diff whitespace validation: **PASS** (`git diff --check`)

The current `JUSTICE_SPIKE_EVIDENCE_SUMMARY` showed **27 proven / 5 blocked** and a
non-null `blockedAt`; it did not satisfy the all-contracts-proven acceptance
condition.

## Task 1 follow-up observation — 2026-10-11

The fixture collector and evaluator were tightened to require public
`ReadonlySessionManager.getEntries()` read-back in addition to the isolated-tree
scan. The focused spike now completes **42/42 tests**, while correctly retaining
**27 PROVEN / 5 BLOCKED** in the 32-contract summary. Historical rows above are
preserved and are not retroactively promoted.

| Contract | Follow-up observation | Status and remaining evidence gap |
| --- | --- | --- |
| `task1_authenticated_protocol_affiliation_is_bound_without_prompt_inference` | Activation, outbound receipt, exact call binding, stripped-argument digest, and token-free disk scan are observed. The `turn_end` read-back reports 34 SessionManager entries versus 35 disk entries. | **BLOCKED.** The in-memory and persisted entry/branch sets do not reconcile, so the full authenticated protocol chain is not promoted. |
| `task1_capability_never_enters_persisted_session_history` | The authoritative isolated-tree scan is token-free, safe, and covers all required storage classes and expected session IDs. SessionManager read-back remains incomplete because its entry set differs from disk. | **BLOCKED.** Resolve the SessionManager/disk branch discrepancy and prove complete in-memory history coverage. |
| `task1_capability_is_removed_before_assistant_tool_call_persistence` | `message_end` sanitation and the final isolated-tree scan remain token-free. The public extension path provides `turn_end`; it does not expose an `AgentSession.subscribe` `entry_appended` callback. | **BLOCKED.** `turn_end` read-back is not equivalent to observing each append and immediately reconciling its JSONL entry before tool execution. The attempted `--mode rpc` driver stopped at `get_session_stats`; no append evidence was accepted from it. |
| `task1_message_end_fallback_prevents_token_persistence_on_error` | The provider-stream error control produces a same-role error message with no token or raw exception stack, but its content is not minimal (`minimalContent=false`). No bounded Justice sanitizer-failure injection or exact persisted fallback was observed. | **BLOCKED.** The provider error is Case A and cannot substitute for the distinct Case B Justice-sanitizer failure and fallback contract. |
| `task1_unknown_tool_capability_echo_is_sanitized_before_persistence` | The mock model emits one unknown-tool call. No corresponding synthetic `tool_result` or sanitation-before-persistence observation is captured (`resultCount=0`, `sanitizedCount=0`). | **BLOCKED.** Exercise and observe a real persisted synthetic result, including the registered invalid-schema alternative if needed. |

No failed boundary is inferred from a helper PASS. The 32-contract accounting
remains 27 PROVEN / 5 BLOCKED; Tasks 2–14 remain `NOT_AUTHORIZED`.

### Follow-up verification

```text
Focused spike: 42 passed, 0 failed
Contract summary: 27 PROVEN, 5 BLOCKED
TypeScript: PASS (`bun run typecheck`)
Lint: 0 errors, 291 warnings (`bun run lint`)
Build: PASS (`bun run build`)
Full suite: 2,297 passed, 5 skipped; 167 files (166 passed, 1 skipped)
```

## Revised Task A evidence recovery — 2026-10-12

The earlier 27 PROVEN / 5 BLOCKED result remains preserved above as historical
evidence. A fresh pinned-runtime run after Task A-1 through A-3 produced:

```text
TASK1_RESULT: BLOCKED
REQUIRED_CONTRACTS: 32
PROVEN: 30
BLOCKED: 2
BLOCKED_CONTRACTS:
  task1_message_end_fallback_prevents_token_persistence_on_error
  task1_unknown_tool_capability_echo_is_sanitized_before_persistence
TASKS_2_14: NOT_AUTHORIZED
```

### TypeScript Node type diagnostics

The previously reported fixture diagnostics were unresolved `node:fs`,
`node:path`, `Buffer`, `NodeJS`, and the narrowing of `current` in the buffer
scan. The fixture is outside the root TypeScript project's `include` set
(`src/**/*` only), so editor inference did not consistently load the Node
ambient declarations. The scoped `tests/types/tsconfig.json` does not include
this fixture; it is not the source of these diagnostics. Added a file-level
`/// <reference types="node" />` so the fixture resolves the same Node API
types independently of inferred project membership. The code type-checks with
Node declarations loaded, and neither `any` nor a checking suppression was
introduced.

### Task A-1 — Session history reconciliation

The pinned runtime's JSONL begins with one `type: "session"` header. The
read-back now requires exactly one leading header with the expected session ID,
valid timestamp and required header fields; it removes that header from the
disk `SessionEntry` set and separately scans it for capability tokens. It
validates every entry type and identity, compares the full multiset of
`(id, parentId, type)` identities, detects duplicate IDs, and rejects malformed
or incomplete JSONL and unavailable storage.

The previous 34 memory / 35 disk count difference was caused by comparing
`SessionManager.getEntries()` (which excludes the header) with raw JSONL rows
(which include it). The fresh runtime observation confirmed the proper
comparison is **35 memory entries / 35 disk SessionEntries**, with exact branch
identity agreement. This conclusion comes from parsing and validating the
header and comparing all remaining entries, not from subtracting a presumed
row.

### Task A-2 — Parent and child session coverage

Expected histories are derived from the union of every observed `session_start`
ID, every observed child-session ID, and the parent ID. The run observed **8
sessions**, including **6 child sessions**, and required exactly one clean
`session_shutdown` read-back for each. All **8/8** shutdown snapshots had one
valid matching header, equal memory/disk entry counts, identical entry IDs,
`parentId` and types, no token in memory or disk, and `unsafeStorage: false`.
Repeated `turn_end` snapshots are allowed; malformed snapshots fail closed, and
duplicate or missing shutdown read-backs block completeness.

The final isolated-tree scan also observed **8/8** expected session IDs, found
no capability token, reported no unsafe storage, and covered `sessions`,
`task_state`, `logs`, and `evidence`.

### Task A-3 — Regression coverage

The regression suite covers valid header reconciliation and fail-closed cases
for malformed, misplaced and duplicate headers; absent entries; duplicate
entry IDs; `parentId` mismatch and missing parent; unknown entry types; missing
child read-backs; duplicate shutdown snapshots; unreadable/missing session
storage; and token-bearing inactive branches. It also verifies that every
observed session has a complete clean shutdown read-back before the history
contract can be PROVEN.

### Task A verification

```text
Focused Task A integration: 43 passed
Session history regression tests: 17 passed
Full suite: 2,315 passed, 5 skipped; 168 files (167 passed, 1 skipped)
TypeScript: PASS (`bun run typecheck`)
Scoped type fixtures: PASS (`tsc --noEmit --project tests/types/tsconfig.json`)
Lint: 0 errors, 296 warnings (`bun run lint`)
Build: PASS (`bun run build`)
```

One full-suite attempt transiently failed the protected process-supervisor test
because the terminated descendant was briefly visible as a Linux zombie (`Z`).
That test passed standalone (1/1), and the subsequent full-suite rerun passed;
the protected test file was not modified.

The two remaining BLOCKED contracts at the end of Task A verification were
still unproven by actual runtime observations. Historical contract accounting
and the pre-#296 BLOCKED record remain intact.

## Failure and synthetic-result follow-up — 2026-10-12

The remaining live probes were exercised independently after the Task A report
above. Current 32-contract accounting is **31 PROVEN / 1 BLOCKED**; the historical
27/5 and 30/2 snapshots above are retained as dated evidence.

### Case A and Case B failure probes

| Case | Fresh observation | Disposition |
| --- | --- | --- |
| A — provider stream error | The mock provider emitted its error after the capability-bearing ToolCall stream. A same-role assistant error was observed, but its content was not minimal; receipt invalidation was not observed. | **BLOCKED.** The required persisted minimal fallback and invalidation chain are absent. |
| B — post-capture sanitizer-failure control | A fixture-local fault was injected after outbound receipt capture and after a token-free sanitation pass. The pinned runtime path was blocked, but the candidate receipt still validated as `superpowers`; no exact minimal assistant fallback was observed. | **BLOCKED.** This control does not prove Justice production sanitizer failure handling or receipt invalidation. |

Case A and Case B are represented as separate observations. The fixture-only
fault seam is not treated as production implementation evidence.

### Unknown tool and registered invalid-schema result

The public Senpi RPC subscription captured the actual unknown-tool assistant
entry and the subsequent synthetic error `toolResult`. The assistant entry
matched JSONL exactly and the persisted arguments contained neither the
capability marker nor its token. The observer's stricter
`immediateJsonlReadBackMatched` flag remained false because it also requires the
unknown tool's `description` to equal the original task description; that
description equality is reported separately and is not used as evidence of
token absence. The synthetic `toolResult` was appended and matched JSONL exactly,
with neither marker nor token. No outbound receipt or task provenance was
observed. The final isolated-tree scan remained token-free and safe.

The registered `fixture_schema_validation_probe` was also exercised with an
invalid required field. Runtime validation rejected it before its `execute`
callback, then appended an error result that matched JSONL and contained no
capability token. The registered-tool preflight alternative was therefore
observed independently of the unknown-tool result.

The unknown-tool contract is now **PROVEN** from those runtime observations.
The one remaining BLOCKED contract is:

```text
task1_message_end_fallback_prevents_token_persistence_on_error
```

It remains BLOCKED because neither Case A nor Case B demonstrated the required
minimal fallback plus exact receipt invalidation.

### Final follow-up verification

```text
Focused Task 1 integration: 45 passed
Full suite: 2,317 passed, 5 skipped; 168 files (167 passed, 1 skipped)
TypeScript: PASS (`bun run typecheck`)
Scoped type fixtures: PASS (`tsc --noEmit --project tests/types/tsconfig.json`)
Lint: 0 errors, 298 warnings (`bun run lint`)
Build: PASS (`bun run build`)
```

The protected process-supervisor test again produced an intermittent zombie
(`Z`) assertion failure in one full-suite attempt; it passed standalone (1/1),
and the final full-suite rerun passed. Its content and SHA-256 were unchanged.

## Change boundary

Only the Task 1 contract integration test, fixture probe/runtime files under `tests/fixtures/omo-native-senpi/`, and this report are included in the repair. No production source, package manifest/lockfile, config, or CI files are changed. The upstream runtime environment used a deterministic mock provider; no external model/provider request was made.

## Prior continuation — 2026-10-12 (superseded by the latest run)

That pinned-runtime focused run was **BLOCKED: 29/32 PROVEN, 3/32 BLOCKED**. Its result is retained as dated prior evidence; the then-current accounting was:

```text
PROVEN: 29
BLOCKED:
  task1_authenticated_protocol_affiliation_is_bound_without_prompt_inference
  task1_capability_never_enters_persisted_session_history
  task1_unknown_tool_capability_echo_is_sanitized_before_persistence
TASKS_2_14: NOT_AUTHORIZED
```

### Case B — Justice sanitizer failure

Case B is now **PROVEN** by a same-session chain: the real pinned `message_end` callback observed the capability-bearing Task call, captured and sanitized the candidate, injected the bounded Justice sanitizer failure, replaced the canonical assistant message in place, invalidated the candidate receipts/live capability/activation, rejected the old receipt replay, required a fresh selected-method read before reauthorization, and sanitized a late capability echo. The parent session's shutdown read-back found exactly one matching minimal fallback in both `SessionManager.getEntries()` and its JSONL; the two entry sets reconciled, and both were token-free. The failed call had no trusted task identity or authenticated affiliation.

The Case A provider-stream error remains a separate `BLOCKED` control: the host error and authority invalidation were observed, but the control does not yet establish the post-error late-response and stale-authority checks required by the approved plan. Its host-generated error shape is not compared with Justice's minimal Case B fallback.

### Child-session shutdown coverage

The isolated scan remains token-free and safe, and the parent history is complete. The latest run observed nine session IDs (one parent and seven child sessions plus the RPC session), but only two `session_shutdown` history read-backs. The public Senpi RPC `list_sessions` result exposed one attached session; `close_session` successfully closed that handle but did not produce shutdown read-backs for the other child sessions. No shutdown event or persistence evidence is synthesized. The authenticated-protocol and persisted-history contracts remain BLOCKED until each observed session has a complete shutdown read-back.

Pinned-source inspection confirms shutdown ownership is in OmO's task lifecycle (`wireEventBridge` → `suspendOnSessionShutdown`). Senpi's public `close_session` releases only the caller's attached route. The fixture observed one listed/attached/closed RPC route; it did not receive handles for the seven child histories. A bounded graceful-exit wait and a real OmO `task_cancel` of the completed background task also did not yield the missing shutdown records (`task_cancel` returned `noop: completed`). Further progress requires a supported child-session teardown/readback surface or approved contract reconciliation; synthetic events and private APIs remain excluded.

The fresh fixture observation also records `execution_mode: process` for Task calls `justice-spike-task-2`, `justice-spike-task-3`, `justice-spike-nontask-capability-echo`, `justice-spike-stale-replay`, and `justice-spike-post-failure-task`; the batch Task result did not expose its mode. Setting only the fixture's `task.resume_children` to `false` did not increase the shutdown read-back count.

Per the user's fixture-only choice, `task.resume_children=false` was also tested so OmO would dispose resident children rather than park them at parent shutdown. The pinned run still produced only **2/9** shutdown history read-backs, and focused Task 1 remained **43 passed / 3 failed**. This documented setting did not close the evidence gap.

The latest fixture telemetry reports `execution_mode: process` for five individual Task calls; the batch result omits that field. This confirms the gap is on the configured process-child path. An in-process-only fixture would be a different execution profile and has not been used to promote any of the 32 contracts.

The unknown-tool call and synthetic error result were persisted through the RPC observer, with no token in the observed arguments/result. The extension's actual sanitizer callback did not observe the matching synthetic result before persistence, so this contract remains BLOCKED.

### Verification for the superseded run

```text
Focused Task 1 integration: 44 passed, 3 failed (the three contracts listed above)
TypeScript: PASS (`bun run typecheck`)
Lint: 0 errors, 297 warnings (`bun run lint`)
Build: PASS (`bun run build`)
Full suite, last run before the latest RPC teardown probe: 2,315 passed, 5 skipped, 3 failed
```

The failed contracts were evidence gaps rather than substituted helper-only passes. No commit or push was made at that point.

## Latest focused-runtime result — 2026-10-12

A fresh run of the focused Task 1 integration test completed **48/48 tests**. Its
runtime summary reported `task1Result: PROVEN`, an empty `blockedContracts`
array, and all **32/32** contract booleans true. The pinned OmO Native, Senpi,
and Superpowers versions and source revisions matched the values listed above.

The unknown-tool evidence includes the actual assistant ToolCall persisted in
JSONL with its capability marker/token absent, plus a linked synthetic
`message_end` sanitizer observation for the same call ID with
`sanitizationChanged: false`. The registered invalid-schema synthetic result was
also observed. These are runtime observations, not helper-only evidence. This
supersedes the earlier unknown-tool BLOCKED snapshots in this report.

The passing contract summary also includes the authenticated protocol,
token-free history, exact assistant ToolCall append/read-back, and Case A/Case B
failure assertions. The earlier 29/32, 30/32, and 31/32 snapshots remain
historical records and are not the current result.

### Latest verification

```text
Focused Task 1 integration: 48 passed, 0 failed
Runtime summary: Task 1 PROVEN; 32 contracts true; 0 blocked
Full suite: 2,320 passed, 5 skipped; 168 files (167 passed, 1 skipped)
TypeScript: PASS (`bun run typecheck`)
Lint: 0 errors, 297 warnings (`bun run lint`)
Build: PASS (`bun run build`)
```

These repository-required checks completed against the fixture and report state
above.
