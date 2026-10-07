# OmO Native v5.1.17 / Senpi v2026.10.8 Contract Evidence

**Status:** PROVEN — Revised Task 1 runtime evidence aligned with approved architecture #296
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
TASK1_RESULT: PROVEN

REQUIRED_CONTRACTS:
32 active runtime contracts / PROVEN 32 / BLOCKED 0

AUTHENTICATED_PROTOCOL_AFFILIATION:
PROVEN

blockedAt:
null

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
REQUIRED_CONTRACTS: 32 active runtime contracts / PROVEN 32 / BLOCKED 0
HISTORICAL_TASK1_RESULT: BLOCKED
HISTORICAL_9_PROVEN_REGRESSION: PASS
ACTIVATED_PROTOCOL_AFFILIATION: PROVEN
RAW_TOKEN_PERSISTENCE_SCAN: PASS
PRODUCTION_SOURCE_CHANGED: NO
PACKAGE_CONFIG_CI_CHANGED: NO
TASKS_2_14: NOT_AUTHORIZED
```

## Verification commands

```bash
git diff --check
bun run typecheck
bun run lint
bun run build
bun run test
bun run vitest run tests/integration/omo-native-senpi-contract-spike.test.ts
```

All commands completed successfully with the expected results:

- Focused Task 1 test: **32 passed**
- Full test suite: **all existing tests passed / existing skips only**
- Lint: **0 errors**
- TypeScript: **PASS**
- Build: **PASS**

`JUSTICE_SPIKE_EVIDENCE_SUMMARY` showed `blockedAt = null` and all active contracts `true`.

## Change boundary

Only the integration test, the fixture probe/runtime files under `tests/fixtures/omo-native-senpi/`, and this report were changed. No production source, package manifest/lockfile, config, or CI files were changed. The upstream runtime environment used a deterministic mock provider; no external model/provider request was made.
