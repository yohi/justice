# Task 5 Admission Payload Extension Report

## Scope

Extended the Core admission decision payloads and Runtime admission observation
types/producers only. Executor routes, handoff/terminal application, NC1 outcome
application, and protocol-release activation remain out of scope.

## Changes

- `REVALIDATE_OR_BLOCK` now carries phase, the verified effective binding, the
  current observed context, triggering authority event ID, and before/after
  round counters. Since planning does not mutate rounds, both counter values
  are the verified current counters.
- `REENTRY_CANDIDATE` retains the existing Gate/generation/stop/change/frontier
  IDs and now also carries `nc1EvidenceEventId`, referencing the verified
  change-observation event.
- Runtime exports `VerifiedNC1EvidenceBundleV1` and
  `RuntimeVerifiedAdmissionSnapshot`. Admission observations expose the bundle
  both inside the runtime snapshot and at top level, alongside the top-level
  `lastVerifiedBinding` for unfinished tips. The second NC1 observation pass
  updates the bundle with its inspected change and current frontier.
- The shared validation outcome shape is named and exported from the pure Core
  reentry module for Runtime observation typing. It introduces no Runtime
  imports into Core.
- Added planner payload assertions and first-use Runtime observation assertions.

## Regression evidence

- RED: the admission planner tests failed on the missing revalidation fields
  and missing `nc1EvidenceEventId`.
- GREEN focused: 38 tests passed across admission, NC1 admission, and admission
  context suites.
- Full suite: 225 test files passed, 2 skipped; 3,570 tests passed, 2 expected
  failures, 7 skipped.
- `bun run typecheck`: passed.
- `bun run lint`: exited successfully with 773 warnings and zero errors.
- `bun run build`: passed.

## Preserved constraints

Core remains Runtime-independent. This change does not alter Legacy event
bytes, implement executor routes, or change the protocol-release BLOCK stub.
