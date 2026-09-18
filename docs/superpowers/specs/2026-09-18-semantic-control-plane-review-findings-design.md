# Semantic Control Plane Review Findings Design

Date: 2026-09-18

## Goal

Correct the six validated review findings on the semantic control plane without
changing the public tool contract or introducing a new persistence system.

The implementation must preserve fail-open behavior, immutable public state,
JSON-only persistence, and compatibility with existing observation records.

## Scope

The change covers:

1. Plan terminal-review correlation in `acceptance-decision.ts`.
2. `SKIP` handling in the gate-pending evaluator.
3. Optional task gate trigger-scope normalization in YAML parsing.
4. Plan decision path redaction with a stable digest identity.
5. Sharing the plugin-level `AuthorizationReviewBoundary` with
   `ObservationHandler`.
6. Exact task execution binding lookup during PostToolUse gate evaluation.

## Design

### Terminal Review Correlation

`hasTerminalReview` will branch by scope.

- Task scope requires the observed record to belong to the current session and
  to carry the current task ID.
- Plan scope requires the current session and the established `final` review
  scope. The plan decision itself remains correlated by authorization ID, plan
  path identity, finalization attempt ID, and final review round.

This keeps the existing review record shape while preventing an unrelated
session or task review from satisfying a plan gate.

### Gate Evaluation Results

The evaluator will distinguish the two non-decision results:

- `verdict: "SKIP"` returns `{ kind: "not_applicable" }` and writes nothing.
- `kind: "insufficient_evidence"` retains the existing blocked AcceptanceDecision
  behavior.

The distinction is made before the generic no-`recordType` blocked branch.

### Gate YAML Normalization

`parseGateYaml` will normalize only raw task gate entries that omit
`trigger.scope`, assigning `scope: "task"` before `GateConfigSchema.parse`.
Plan entries must still provide `scope: "plan"`; omission or mismatch remains a
validation error. Existing explicit scopes and strict unknown-field rejection
remain unchanged.

### Plan Path Persistence Identity

Plan Gate and Plan Acceptance decision payloads will accept an optional
`planPathDigest`.

At the persistence redaction boundary:

- A missing digest is computed from the raw path.
- The path is passed through the existing redactor.
- An existing digest is preserved.

Decision lookup compares the digest when present and falls back to raw path
comparison for legacy records without a digest. This allows redaction without
breaking replay or current-record lookup.

### Shared Authorization Boundary

`JusticePlugin` will pass its existing boundary instance into
`ObservationHandler`. The gate evaluator will use that injected
`withParentSession` callback, so authorization mutations and gate decisions for
the same parent session share one serialized queue.

### Exact Task Binding

`evaluateGateIfTriggered` will use `callId` to read `TaskCallBinding` and use
its `taskExecutionRef` only when the binding belongs to the current session
and task ID. Missing or mismatched bindings return `PROCEED`; the current
state-wide task ID fallback is removed.

## Error Handling

- Existing catch boundaries remain unchanged and continue to degrade to
  `PROCEED` or a safe blocked result.
- YAML parse errors continue to fall back through `FileGateLoader`.
- Redaction remains idempotent and does not remove existing optional digests.
- No new runtime files, databases, configuration formats, or public tools are added.

## Tests

Regression coverage will be added for:

- unrelated task and plan review snapshots;
- plan final review scope acceptance;
- `SKIP` versus `insufficient_evidence` outcomes;
- task scope defaulting and plan scope rejection;
- plan decision path redaction, digest creation, and legacy lookup;
- exact call binding, missing binding, and session mismatch;
- plugin-level boundary identity shared with `ObservationHandler`.

The completion gate is `bun run test`, `bun run typecheck`, `bun run lint`, and
`bun run build`.
