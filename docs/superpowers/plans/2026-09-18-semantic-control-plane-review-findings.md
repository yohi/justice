# Semantic Control Plane Review Findings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the six validated semantic control-plane review findings while preserving existing public contracts, fail-open behavior, and legacy observation replay.

**Architecture:** Keep the existing core and hook boundaries. Extend plan decision identity with an optional digest, normalize only task gate YAML input, correlate terminal reviews by scope, and inject the plugin-owned authorization queue into `ObservationHandler`. Resolve task execution references from the `callId`-owned binding rather than global projected state.

**Tech Stack:** TypeScript, Zod, Bun, Vitest, ESLint, TypeScript compiler.

## Global Constraints

- Preserve fail-open behavior: hook and adapter failures degrade to `PROCEED` or a safe blocked result.
- Preserve immutable public state and JSON-only atomic persistence.
- Declared provenance never satisfies a gate PASS; only observed and derived evidence can.
- Keep the one-public-tool contract unchanged.
- Do not add runtime files, databases, configuration formats, or public tools.
- Use injected mocks in ordinary unit tests; do not access real disk except in designated real-fs suites.
- Do not use CodeRabbit CLI.
- Completion gate: `bun run test`, `bun run typecheck`, `bun run lint`, and `bun run build` from `.devcontainer/`.

---

### Task 1: Scope-Aware Terminal Review Correlation

**Files:**
- Modify: `src/core/acceptance-decision.ts:103-351`
- Test: `tests/core/acceptance-decision.test.ts`

**Interfaces:**
- Consumes: `ReviewCorrelation`, `PersistedLogRecord`, `GatePendingAttemptContext`.
- Produces: scope-aware `hasTerminalReview` behavior used by the existing gate-pending evaluator.

- [ ] **Step 1: Write failing regression tests**

Add cases proving that an unrelated task review and an unrelated session review do not satisfy a task gate, while a plan review must use the current session and `reviewScope: "final"`.

```typescript
expect(hasTerminalReview(records, taskCorrelation)).toBe(false);
expect(hasTerminalReview(records, planCorrelation)).toBe(true);
```

- [ ] **Step 2: Run the focused test file**

Run: `bun test tests/core/acceptance-decision.test.ts`

Expected: the new correlation tests fail against the current implementation.

- [ ] **Step 3: Implement the smallest scope branch**

Update `hasTerminalReview` so task scope matches session and task identity, and plan scope matches session plus the established final review scope. Keep the existing authorization, path, finalization-attempt, and review-round matching for plan decisions.

- [ ] **Step 4: Run the focused test file again**

Run: `bun test tests/core/acceptance-decision.test.ts`

Expected: all tests pass.

- [ ] **Step 5: Commit the atomic change**

```bash
git add src/core/acceptance-decision.ts tests/core/acceptance-decision.test.ts
git commit -m "fix: レビュー相関をスコープ単位で検証"
```

### Task 2: Distinguish SKIP from Insufficient Evidence

**Files:**
- Modify: `src/core/acceptance-decision.ts:21-25, 353-500`
- Test: `tests/core/acceptance-decision.test.ts`

**Interfaces:**
- Consumes: `GateRuleEvaluation` with `verdict: "SKIP"` and `kind: "insufficient_evidence"`.
- Produces: existing `GatePendingAttemptResult` values without changing its public union.

- [ ] **Step 1: Add failing evaluator tests**

Cover both branches: `SKIP` returns `not_applicable` and does not call `appendDecision` or `recordAdvisory`; insufficient evidence returns the existing blocked result and advisory.

```typescript
expect(result).toEqual({ kind: "not_applicable" });
expect(appendDecision).not.toHaveBeenCalled();
```

- [ ] **Step 2: Run the focused tests**

Run: `bun test tests/core/acceptance-decision.test.ts`

Expected: the `SKIP` test fails because it currently reaches the generic blocked path.

- [ ] **Step 3: Branch before the generic no-record blocked path**

Handle `verdict: "SKIP"` before decision persistence and advisory generation. Preserve the current fail-open handling for append failures and insufficient evidence.

- [ ] **Step 4: Run focused and hook regression tests**

Run: `bun test tests/core/acceptance-decision.test.ts tests/hooks/observation-handler-tool.test.ts`

Expected: all tests pass.

- [ ] **Step 5: Commit the atomic change**

```bash
git add src/core/acceptance-decision.ts tests/core/acceptance-decision.test.ts
git commit -m "fix: ゲートのSKIPを非適用として扱う"
```

### Task 3: Normalize Task Gate YAML Scope

**Files:**
- Modify: `src/core/v2/gate-yaml-parser.ts:5-18`
- Test: `tests/core/v2/gate-yaml-parser.test.ts`

**Interfaces:**
- Consumes: raw YAML gate objects before `GateConfigSchema.parse`.
- Produces: `parseGateYaml(content): readonly GateRule[]` with task-only defaulting.

- [ ] **Step 1: Add failing parser tests**

Add a YAML fixture whose task gate omits `trigger.scope`, expecting `scope: "task"`; add plan fixtures that omit or mismatch scope and expect validation failure.

```typescript
expect(parseGateYaml(taskYaml)[0]?.trigger.scope).toBe("task");
expect(() => parseGateYaml(planWithoutScopeYaml)).toThrow();
```

- [ ] **Step 2: Run the parser tests**

Run: `bun test tests/core/v2/gate-yaml-parser.test.ts`

Expected: the omitted task scope case fails before normalization exists.

- [ ] **Step 3: Normalize only task entries before Zod parsing**

Map raw `gates` entries, adding `trigger.scope: "task"` only when the raw entry is a task gate and scope is omitted. Leave explicit values and strict unknown-field rejection unchanged; never default plan scope.

- [ ] **Step 4: Run parser and loader tests**

Run: `bun test tests/core/v2/gate-yaml-parser.test.ts tests/runtime/gate-loader.test.ts`

Expected: all tests pass, including fail-open loader fallback behavior.

- [ ] **Step 5: Commit the atomic change**

```bash
git add src/core/v2/gate-yaml-parser.ts tests/core/v2/gate-yaml-parser.test.ts
git commit -m "fix: タスクゲートのスコープ省略を補完"
```

### Task 4: Add Redacted Plan Path Digest Identity

**Files:**
- Modify: `src/core/v2/decision-model.ts:40-65`
- Modify: `src/core/v2/persistence-redaction.ts:96-196`
- Modify: `src/core/acceptance-decision.ts` plan lookup and correlation helpers
- Test: `tests/core/v2/persistence-redaction.test.ts`
- Test: `tests/core/acceptance-decision.test.ts`

**Interfaces:**
- Consumes: plan decision payloads with raw `planPath` and optional `planPathDigest`.
- Produces: idempotently redacted plan decisions with stable digest identity and legacy raw-path lookup fallback.

- [ ] **Step 1: Add failing type and persistence tests**

Cover digest creation when absent, preservation when present, redaction of the stored path, idempotence, and legacy records without a digest.

```typescript
expect(redacted.planPath).toBe("[REDACTED_PATH]");
expect(redacted.planPathDigest).toMatch(/^[a-f0-9]+$/);
expect(redactPendingLogRecord(redacted)).toEqual(redacted);
```

- [ ] **Step 2: Run the focused tests**

Run: `bun test tests/core/v2/persistence-redaction.test.ts tests/core/acceptance-decision.test.ts`

Expected: digest and lookup tests fail before the model and boundary changes.

- [ ] **Step 3: Extend plan payload types and redaction**

Add `readonly planPathDigest?: string` to `PlanGateDecisionPayload` and `PlanAcceptanceDecisionPayload`. At the decision redaction boundary, compute the digest from the raw path only when missing, then redact the path while preserving an existing digest. Reuse the repository’s existing stable hashing utility rather than introducing a second algorithm.

- [ ] **Step 4: Update decision lookup comparisons**

Compare digest identity when both records provide it. For legacy records without a digest, retain raw-path comparison so replay and current records continue to resolve.

- [ ] **Step 5: Run focused and replay tests**

Run: `bun test tests/core/v2/persistence-redaction.test.ts tests/core/acceptance-decision.test.ts tests/core/observation-log-replay.test.ts tests/core/record-reference-resolution.test.ts`

Expected: all tests pass.

- [ ] **Step 6: Commit the atomic change**

```bash
git add src/core/v2/decision-model.ts src/core/v2/persistence-redaction.ts src/core/acceptance-decision.ts tests/core/v2/persistence-redaction.test.ts tests/core/acceptance-decision.test.ts
git commit -m "fix: 計画決定のパス識別子を永続化"
```

### Task 5: Share the Authorization Review Boundary

**Files:**
- Modify: `src/hooks/observation-handler.ts:115-194`
- Modify: `src/core/justice-plugin.ts:334-390`
- Test: `tests/hooks/observation-handler-gate.test.ts`
- Test: `tests/core/justice-plugin-routing.test.ts`

**Interfaces:**
- Consumes: plugin-owned `AuthorizationReviewBoundary` instance.
- Produces: `ObservationHandler` gate evaluation serialized through the same `withParentSession` callback as authorization mutations.

- [ ] **Step 1: Add a failing identity/wiring test**

Construct the plugin with injected persistence, trigger a gate evaluation, and assert that the callback supplied to `ObservationHandler` is the same plugin-owned boundary callback used by authorization dependencies. Keep assertions on behavior or identity, not private implementation details except through the repository’s `unknown` cast convention.

```typescript
expect(observationBoundary).toBe(pluginBoundary);
```

- [ ] **Step 2: Run the focused hook/plugin tests**

Run: `bun test tests/hooks/observation-handler-gate.test.ts tests/core/justice-plugin-routing.test.ts`

Expected: the test fails because `ObservationHandler` currently creates a second boundary.

- [ ] **Step 3: Add boundary injection without changing the legacy constructor shape**

Add an optional `authorizationReviewBoundary` option to `ObservationHandler`, defaulting only for direct standalone test construction. Pass `JusticePlugin`’s existing instance into the handler and keep `PlanBridge` wiring unchanged.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `bun test tests/hooks/observation-handler-gate.test.ts tests/core/justice-plugin-routing.test.ts && bun run typecheck`

Expected: tests and typecheck pass.

- [ ] **Step 5: Commit the atomic change**

```bash
git add src/hooks/observation-handler.ts src/core/justice-plugin.ts tests/hooks/observation-handler-gate.test.ts tests/core/justice-plugin-routing.test.ts
git commit -m "fix: 認証レビュー境界を観測ハンドラと共有"
```

### Task 6: Bind Task Gate Evaluation to callId

**Files:**
- Modify: `src/hooks/observation-handler.ts:1008-1045`
- Test: `tests/hooks/observation-handler-gate.test.ts`

**Interfaces:**
- Consumes: `callId`, current session ID, task ID, and `SessionStateProvider.getTaskCallBinding(callId)`.
- Produces: `PROCEED` for missing, stale, or mismatched bindings; gate evaluation using the exact bound `taskExecutionRef` otherwise.

- [ ] **Step 1: Add failing binding tests**

Cover exact binding use, missing binding, session mismatch, and task mismatch. Ensure a valid projected task with no matching call binding no longer triggers evaluation.

```typescript
expect(evaluator).toHaveBeenCalledWith(expect.objectContaining({ taskExecutionRef: boundRef }));
expect(response).toEqual(PROCEED);
```

- [ ] **Step 2: Run the focused hook test**

Run: `bun test tests/hooks/observation-handler-gate.test.ts`

Expected: missing and mismatch cases fail because the current code searches all projected task references.

- [ ] **Step 3: Replace the state-wide fallback**

Use `_callId` as `callId`, read `getTaskCallBinding(callId)`, and require both `parentSessionId === sessionId` and `taskId === taskId`. Pass the binding’s `taskExecutionRef` to the evaluator; return `PROCEED` when no valid binding exists.

- [ ] **Step 4: Run focused tests**

Run: `bun test tests/hooks/observation-handler-gate.test.ts tests/hooks/observation-handler-tool.test.ts`

Expected: all hook tests pass.

- [ ] **Step 5: Commit the atomic change**

```bash
git add src/hooks/observation-handler.ts tests/hooks/observation-handler-gate.test.ts
git commit -m "fix: タスクゲートを呼び出し結合に限定"
```

### Task 7: Full Verification and Push

**Files:**
- Modify: none unless a quality gate exposes an implementation defect.

**Interfaces:**
- Consumes: all implementation commits from Tasks 1-6.
- Produces: verified branch state and remote branch update.

- [ ] **Step 1: Run the complete quality gate suite from `.devcontainer/`**

Run:

```bash
bun run test
bun run typecheck
bun run lint
bun run build
```

Expected: all commands pass; lint must report zero errors.

- [ ] **Step 2: Inspect the final diff and repository state**

Run:

```bash
GIT_MASTER=1 git status --short --branch
GIT_MASTER=1 git diff origin/semantic-control-plane/gate-evaluation...HEAD --stat
GIT_MASTER=1 git log --oneline -10
```

Expected: only the design, plan, and six implementation commits are present; no secrets, generated artifacts, or unrelated files are included.

- [ ] **Step 3: Push the verified branch**

```bash
GIT_MASTER=1 git push origin semantic-control-plane/gate-evaluation
```

Expected: push succeeds and the remote branch contains the verified commits.
