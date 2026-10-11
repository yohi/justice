# OmO Native v5.1.17 / Senpi v2026.10.8 Contract Evidence

**Status:** BLOCKED — Revised Task 1 runtime evidence does not prove all required contracts
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

## Change boundary

Only the Task 1 contract integration test, fixture probe/runtime files under `tests/fixtures/omo-native-senpi/`, and this report are included in the repair. No production source, package manifest/lockfile, config, or CI files are changed. The upstream runtime environment used a deterministic mock provider; no external model/provider request was made.
