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
32 active runtime contracts / PROVEN 25 / BLOCKED 7

AUTHENTICATED_PROTOCOL_AFFILIATION:
BLOCKED

blockedAt:
"7 required runtime contracts lack sufficient evidence"

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
REQUIRED_CONTRACTS: 32 active runtime contracts / PROVEN 25 / BLOCKED 7
HISTORICAL_TASK1_RESULT: BLOCKED
HISTORICAL_9_PROVEN_REGRESSION: RETAINED
ACTIVATED_PROTOCOL_AFFILIATION: BLOCKED
RAW_TOKEN_PERSISTENCE_SCAN: NO_TOKEN_FOUND; SESSION_FILE_COVERAGE_UNPROVEN
PRODUCTION_SOURCE_CHANGED: NO
PACKAGE_CONFIG_CI_CHANGED: NO
TASKS_2_14: NOT_AUTHORIZED
```

The seven blocked contracts are:

```text
task1_authenticated_protocol_affiliation_is_bound_without_prompt_inference
task1_capability_is_removed_before_assistant_tool_call_persistence
task1_capability_never_enters_persisted_session_history
task1_context_copy_delivers_fixture_capability_after_method_read
task1_message_end_fallback_prevents_token_persistence_on_error
task1_tool_call_binds_capability_session_and_call
task1_unknown_tool_capability_echo_is_sanitized_before_persistence
```

The isolated-root scan found no capability token, and the capability environment
variable was absent. However, the runtime provided no explicit parent/child
session-file paths (`explicitSessionFilesRequired=0`,
`explicitSessionFilesObserved=0`), so persisted-session coverage is unproven and
the scan cannot establish the required no-persistence contract. The fallback
failure injection also did not establish persisted same-role fallback behavior
with no receipt and no trusted execution. Context-copy delivery and persisted
assistant tool-call/result sanitation likewise lack the required runtime proof.
These evidence gaps keep Task 1 BLOCKED; they do not alter the historical
pre-#296 result or reopen JUS5-P296-RG-001/002.

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

- Full test suite: **2,289 passed, 5 skipped; 167 test files (166 passed, 1 skipped)**
- Focused Task 1 and process-supervisor tests: **35 passed**
- TypeScript: **PASS** (`bun run typecheck`)
- Lint: **0 errors, 284 warnings** (`bun run lint`)
- Build: **PASS** (`bun run build`)
- Diff whitespace validation: **PASS** (`git diff --check`)

The current `JUSTICE_SPIKE_EVIDENCE_SUMMARY` showed **25 proven / 7 blocked** and a
non-null `blockedAt`; it did not satisfy the all-contracts-proven acceptance
condition.

## Change boundary

Only the integration test, the fixture probe/runtime files under `tests/fixtures/omo-native-senpi/`, and this report were changed. No production source, package manifest/lockfile, config, or CI files were changed. The upstream runtime environment used a deterministic mock provider; no external model/provider request was made.
