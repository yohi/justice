# justice-workflow-activation - Work Plan

## TL;DR (For humans)
<!-- Fill this LAST, after the detailed plan below is written, so it summarizes the REAL plan. -->
<!-- Plain English for a non-engineer: NO file paths, NO todo numbers, NO wave/agent/tool names. -->

**What you'll get:** A visible `/justice-start` command that initializes one Justice development workflow, guides the agent through missing design and plan artifacts, then reliably connects an existing plan to task delegation and quality observation.

**Why this approach:** The command is an explicit and discoverable OpenCode entrypoint, while the existing plugin remains responsible for context injection and observation. Quality Control Plane responsibilities remain advisory and do not become execution control.

**What it will NOT do:** It will not add a new AI-callable Justice tool, automatically dispatch a subagent, alter plan ownership, or block execution based on a Gate.

**Effort:** Medium
**Risk:** Medium - the command hook and command configuration are OpenCode-specific integration boundaries.
**Decisions to sanity-check:** `/justice-start` is the primary OpenCode entrypoint; `Justice: start workflow` remains only as a cross-harness fallback; the package documents rather than mutates user command configuration.

Your next move: run this plan in a separate implementation session with `$start-work`. Full execution detail follows below.

---

> TL;DR (machine): Medium-risk OpenCode command-hook integration adding an explicit workflow bootstrap, audited lifecycle transitions, tests, and documented setup while retaining the single public Justice tool.

## Scope
### Must have
- `/justice-start` accepts a goal plus optional safe relative `--design` and `--plan` paths.
- `command.execute.before` establishes a per-session bootstrap state and appends a structured directive to the command prompt parts.
- Existing plan files activate the existing `task()` prompt injection path without requiring an assistant-message echo.
- Missing design or plan artifacts produce deterministic guidance to use `brainstorming` or `writing-plans`, not direct subagent execution.
- Bootstrap lifecycle transitions are append-only, fail-open v2 observations and never default Gate requirements.
- README contains install/configuration, command examples, state behavior, fallback syntax, and review usage.
### Must NOT have (guardrails, anti-slop, scope boundaries)
- Do not add a tool besides `justice_review`, including a `justice_start` tool.
- Do not register or mutate OpenCode command configuration at runtime.
- Do not dispatch `task()` or invoke Superpowers skills from Justice itself.
- Do not raise v2 beyond L0 advisory or make workflow observations Gate-PASS evidence.
- Do not write workflow state to `plan.md` or treat `.justice/state.json` as source of truth.

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- Test decision: TDD + Vitest. Add failing focused tests before every production change; preserve Pure Core and fail-open boundaries.
- Evidence: `<attemptDir>/task-<N>-justice-workflow-activation.txt` (attemptDir = currentAttemptDir from `omo ulw-loop status --json`, `.omo/evidence/ulw/<session>/<goalId>/a<attempt>`; outside ulw-loop use `.omo/evidence/`). Capture the exact Devcontainer command and its result.

## Execution strategy
### Parallel execution waves
> Target 5-8 todos per wave. Fewer than 3 (except the final) means you under-split.

| Wave | Todos | Rationale |
| --- | --- | --- |
| 1 | 1, 2 | Establish the pure request contract and the stateful PlanBridge behavior independently. |
| 2 | 3, 4 | Wire the adapter/plugin command boundary and add v2 audit records after the core contract is stable. |
| 3 | 5, 6 | Exercise end-to-end behavior and document the user-visible configuration and workflow. |

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| 1 | none | 2, 3, 5 | 2 |
| 2 | 1 | 3, 5 | 1 |
| 3 | 1, 2 | 5, 6 | 4 |
| 4 | 1 | 5, 6 | 3 |
| 5 | 2, 3, 4 | 6, final wave | none |
| 6 | 3, 4, 5 | final wave | none |

## Todos
> Implementation + Test = ONE todo. Never separate.
<!-- APPEND TASK BATCHES BELOW THIS LINE WITH edit/apply_patch - never rewrite the headers above. -->
- [ ] 1. Add a pure workflow-start request contract and parser
  What to do / Must NOT do: Add immutable types for a parsed workflow-start request and phase, and pure parsing/validation for `/justice-start` arguments plus the `Justice: start workflow` fallback. Reuse the current plan-path safety rules; reject absolute paths, backslashes, traversal, unknown flags, and missing goals. Do not import OpenCode packages or perform file I/O in the core parser.
  Parallelization: Wave 1 | Blocked by: none | Blocks: 2, 3, 5
  References (executor has NO interview context - be exhaustive): `src/core/trigger-detector.ts:22-111`; `src/core/types.ts`; `tests/core/trigger-detector.test.ts`; `AGENTS.md` Pure Core and immutable-state invariants.
  Acceptance criteria (agent-executable): New parser tests cover command success, fallback success, invalid paths, unknown options, and no-match input; `bun run test tests/core/trigger-detector.test.ts` passes in Devcontainer.
  QA scenarios (name the exact tool + invocation): Happy: parser returns goal and normalized paths for valid command args. Failure: malicious or malformed arguments return no request and do not throw. Evidence `<attemptDir>/task-1-justice-workflow-activation.txt`.
  Commit: Y | `feat(core): add workflow start request parser`

- [ ] 2. Establish session bootstrap state in PlanBridge
  What to do / Must NOT do: Add a minimal private per-session bootstrap state to PlanBridge. It must inspect the requested design and plan through injected FileReader, select exactly one phase (`design_required`, `plan_required`, `plan_ready`), set `activePlan` only after a readable plan is available, and return structured guidance. Ensure destroySession removes bootstrap state. Do not write any design/plan file or invoke a skill/task.
  Parallelization: Wave 1 | Blocked by: 1 | Blocks: 3, 5
  References (executor has NO interview context - be exhaustive): `src/hooks/plan-bridge.ts:89-124`; `src/hooks/plan-bridge.ts:137-233`; `src/hooks/plan-bridge.ts:235-346`; `tests/hooks/plan-bridge.test.ts`; `tests/helpers/mock-file-system.ts`.
  Acceptance criteria (agent-executable): Tests prove each artifact-state branch, active plan creation only for an existing plan, traversal rejection from the parser boundary, and session cleanup. Run `bun run test tests/hooks/plan-bridge.test.ts` in Devcontainer.
  QA scenarios (name the exact tool + invocation): Happy: existing plan yields `plan_ready` and the next `task` receives the current plan context. Failure: missing plan yields guidance only and a later task receives no stale context. Evidence `<attemptDir>/task-2-justice-workflow-activation.txt`.
  Commit: Y | `feat(bridge): add workflow bootstrap state`

- [ ] 3. Wire `/justice-start` through the OpenCode command hook
  What to do / Must NOT do: Add `onCommandExecuteBefore` to OpenCodeAdapter and expose `command.execute.before` from OpenCodePlugin. For exactly `justice-start`, parse `input.arguments`, initialize Justice fail-open, hand the request to PlanBridge, and append a typed workflow directive to `output.parts`; leave every other command untouched. Retain chat-message fallback processing. Do not add a custom tool, alter tool registration, or assume command-hook failure can stop OpenCode.
  Parallelization: Wave 2 | Blocked by: 1, 2 | Blocks: 5, 6
  References (executor has NO interview context - be exhaustive): `src/opencode-plugin.ts:5-60`; `src/runtime/opencode-adapter.ts:78-150`; `src/runtime/opencode-adapter.ts:241-269`; `src/runtime/opencode-adapter.ts:539-579`; OpenCode command hook contract from current API: `command.execute.before(input: { command, sessionID, arguments }, output: { parts })`.
  Acceptance criteria (agent-executable): Adapter and plugin integration tests prove command registration, directive appending, non-Justice command no-op, malformed-command fail-open logging, and no additional tool beyond `justice_review`. Run `bun run test tests/runtime/opencode-adapter.test.ts tests/integration/opencode-plugin.test.ts` in Devcontainer.
  QA scenarios (name the exact tool + invocation): Happy: `/justice-start --plan plan.md goal` appends a plan-ready directive and subsequent task injection receives the active plan. Failure: `other-command` leaves output parts unchanged; invalid args neither mutate state nor throw. Evidence `<attemptDir>/task-3-justice-workflow-activation.txt`.
  Commit: Y | `feat(runtime): add justice start command hook`

- [ ] 4. Record workflow lifecycle transitions as non-authoritative v2 observations
  What to do / Must NOT do: Extend the v2 observation/reflection model and builders with typed bootstrap lifecycle records. Append them through ObservationHandler with redaction, atomic logging, and fail-open behavior. Project them only for audit/read visibility; declared workflow lifecycle events must not become default Gate evidence, create task windows, or change verdict evaluation.
  Parallelization: Wave 2 | Blocked by: 1 | Blocks: 5, 6
  References (executor has NO interview context - be exhaustive): `src/hooks/observation-handler.ts:144-178`; `src/hooks/observation-handler.ts:268-453`; `src/core/v2/observation-model.ts`; `src/core/v2/state-projection.ts`; `src/runtime/observation-log-store.ts`; `SPEC.md:1270-1285`; `SPEC.md:1305-1320`; `tests/hooks/observation-handler-gate.test.ts`.
  Acceptance criteria (agent-executable): Tests prove lifecycle records persist and replay deterministically, secrets/absolute paths are redacted, log failure returns `PROCEED`, and default gates return the same result with or without lifecycle records. Run focused v2 tests plus `bun run test tests/hooks/observation-handler-gate.test.ts` in Devcontainer.
  QA scenarios (name the exact tool + invocation): Happy: a valid bootstrap produces one audit record per transition. Failure: log writer rejection is swallowed and does not prevent command processing. Evidence `<attemptDir>/task-4-justice-workflow-activation.txt`.
  Commit: Y | `feat(v2): observe workflow bootstrap lifecycle`

- [ ] 5. Add end-to-end workflow-bootstrap regression coverage
  What to do / Must NOT do: Create integration coverage from command hook through bootstrap phase selection, existing PlanBridge PreToolUse task injection, and v2 observation. Test design-missing, plan-missing, and plan-ready workflows. Do not require real OpenCode services or real disk; use existing injected mocks only.
  Parallelization: Wave 3 | Blocked by: 2, 3, 4 | Blocks: 6, final wave
  References (executor has NO interview context - be exhaustive): `tests/integration/opencode-plugin.test.ts`; `tests/integration/plan-bridge-flow.test.ts`; `tests/integration/atlas-orchestration-flow.test.ts:1-75`; `tests/helpers/fake-opencode-init.ts`; `tests/helpers/mock-file-system.ts`; `AGENTS.md` testing constraints.
  Acceptance criteria (agent-executable): Focused integration suite verifies all three transitions and proves plan-ready injection without relying on assistant-message echo. Run the new test file and `bun run test tests/integration/opencode-plugin.test.ts` in Devcontainer.
  QA scenarios (name the exact tool + invocation): Happy: plan-ready session injects the next task and emits an audit record. Failure: missing design/plan cannot cause task dispatch or stale state reuse across session IDs. Evidence `<attemptDir>/task-5-justice-workflow-activation.txt`.
  Commit: Y | `test(integration): cover justice workflow bootstrap`

- [ ] 6. Document and package the OpenCode command entrypoint
  What to do / Must NOT do: Update README installation/usage with an opt-in `justice-start` command configuration template, argument grammar, artifact-state table, fallback marker, expected notifier/log signal, and `justice_review` usage after execution. State that command configuration is user-owned and is not modified by the plugin. Do not create a project OpenCode configuration file, embed local absolute paths, or claim v2 advisory UI visibility is verified.
  Parallelization: Wave 3 | Blocked by: 3, 4, 5 | Blocks: final wave
  References (executor has NO interview context - be exhaustive): `README.md` Quick Start, Installation, and Usage sections; `SPEC.md:1216-1219`; `SPEC.md:1331-1337`; `SPEC.md:1365-1372`; `AGENTS.md` documentation and no-new-agent-config rules.
  Acceptance criteria (agent-executable): Markdown lint passes if configured; documentation examples match parser tests exactly; search confirms no documentation claims that Justice auto-dispatches tasks or blocks Gates. Run `bun run lint` and the repository markdown checker if present, inside Devcontainer.
  QA scenarios (name the exact tool + invocation): Happy: an example lets an agent identify the required command, artifacts, and post-run review action. Failure: source-build instructions contain no machine-specific absolute path. Evidence `<attemptDir>/task-6-justice-workflow-activation.txt`.
  Commit: Y | `docs: document justice workflow command`

## Final verification wave
> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.
- [ ] F1. Plan compliance audit
  Verify every Must-have and Must-NOT-have item against changed files, then record gaps and evidence in `<attemptDir>/final-plan-compliance.txt`.
- [ ] F2. Core and boundary quality review
  Review Pure Core imports, readonly public APIs, fail-open catches, path validation, redaction, and D50 tool exposure; run `bun run typecheck` and `bun run lint` in Devcontainer. Evidence `<attemptDir>/final-quality.txt`.
- [ ] F3. Full regression verification
  Run `bun run test` and `bun run build` in Devcontainer. Confirm no focused-test-only success masks a full-suite failure. Evidence `<attemptDir>/final-regression.txt`.
- [ ] F4. OpenCode command contract QA
  With the SDK type contract, exercise the command hook test double for `/justice-start` and a non-Justice command; assert only the former appends parts and neither creates a custom tool. Evidence `<attemptDir>/final-command-contract.txt`.

## Commit strategy
- Commit each numbered todo independently using the listed Conventional Commit message.
- Do not commit generated `.justice/` runtime artifacts or user OpenCode configuration.
- Create reviewable stacked Draft PRs only when the user explicitly requests GitHub operations; never commit or push directly to `master`.

## Success criteria
- A user can intentionally begin an OpenCode workflow with `/justice-start` and receive deterministic planning or plan-ready guidance.
- Existing `task()` execution receives active-plan context without an assistant echo prerequisite.
- `justice_review` remains the only registered Justice tool.
- Bootstrap events are auditable but cannot satisfy a Gate PASS or block work.
- The full Devcontainer test, typecheck, lint, and build commands pass.
