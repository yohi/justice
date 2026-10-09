# Documentation transfer and implementation audit

## Conclusion and scope

The transfer in `5dec10d` omitted normative contracts and conflated design
requirements with implemented behavior. The remediation restores the canonical
contracts in [SPEC.md](../../SPEC.md), corrects README usage, and records the
implementation differences below. **The current implementation is not fully
conformant with the preserved Convergence design.**

Inspected baseline: `5dec10d0c7af74ec2ce38d2c6d843f47e732a889`, version 4.3.1.
This is a dated evidence report, not another normative specification. No product
code or test behavior was changed by this documentation remediation.

## Historical source mapping

Read the following paths at `5dec10d^` using `git show <revision>:<path>`:

- `docs/superpowers/specs/2026-09-03-semantic-control-plane-design.md`
  and `docs/superpowers/plans/2026-09-05-semantic-control-plane-implementation.md`:
  authorization, semantic roles, transactional acceptance, mandatory review,
  and production composition are preserved in SPEC §4.1e. Controller
  configuration authority remains in §5.27; secure artifact I/O is in §15.14.
- `docs/superpowers/specs/2026-09-27-v4-superpowers-6.4.2-omo-4.19.4-compatibility-bridge-design.md`
  and `docs/superpowers/plans/2026-09-28-v4-superpowers-6.4.2-omo-4.19.4-compatibility-bridge.md`:
  task body, final prompt, identities, routing, conservative dependencies, and
  live-smoke limitations are preserved in SPEC §4.1d.
- `docs/superpowers/specs/2026-10-06-review-gate-convergence-design.md`
  and `docs/superpowers/plans/2026-10-07-review-gate-convergence.md`:
  named Review Gate contracts are preserved in SPEC §4.1c, including normative
  event identities and explicit implementation exceptions.

Completed task checklists, illustrative implementation listings, historical
rejected controller-attribution alternatives, and old test-count targets remain
Git history rather than current normative requirements.

## Confirmed implementation and exercised behavior

The full suite below executed these existing tests, not just their names.
Source inspection follows the production path as well as its pure helpers.

- **Original task bodies and prompt ownership:**
  `src/core/plan-parser.ts` slices original bodies and recognizes fenced task
  boundaries; `src/hooks/plan-bridge.ts::buildTaskPrompt` builds the ordered
  prompt; `src/runtime/opencode-adapter.ts::onToolExecuteBefore` applies the
  authoritative prompt once. Evidence: `tests/core/plan-parser.test.ts`,
  `tests/hooks/plan-bridge.test.ts`, and
  `tests/runtime/opencode-adapter.test.ts`.
- **Internal IDs and routing boundary:**
  `src/core/task-packager.ts` separates Justice normalization from final
  continuation-only wire IDs. The adapter's `#finalizeTaskToolInput` restores
  named subagents and removes category. Evidence:
  `tests/core/task-packager.test.ts` and the adapter suite.
- **Conservative task selection:**
  `src/core/dependency-analyzer.ts::getParallelizable` limits Interfaces plans
  to the first incomplete task. Evidence:
  `tests/core/dependency-analyzer.test.ts` and bridge tests.
- **Durable continuous authorization:**
  `src/core/plan-authorization.ts`, `src/core/plan-fingerprint.ts`, and PlanBridge
  implement durable approval, cancellation, terminal-state precedence, startup
  revalidation, and unchanged-plan reuse. Evidence:
  `tests/core/plan-authorization.test.ts`,
  `tests/hooks/plan-bridge-authorization.test.ts`, and
  `tests/integration/plan-authorization-handoff.test.ts` (including next-task
  execution under the same approval).
- **Seven semantic roles:** `src/core/omo-category-mapper.ts` maps deep and
  architecture to `sp-deep` and `sp-architecture`. Evidence:
  `tests/unit/core/omo-category-mapper.test.ts` and routing suites.
- **Acceptance before progress:** `src/core/progress-updater.ts` requires an
  accepted decision for the exact task. Mandatory reviews route through
  `src/core/justice-plugin.ts` before ordinary implementation. Evidence:
  `tests/core/progress-updater.test.ts`, acceptance/lifecycle suites, and
  `tests/integration/plan-authorization-handoff.test.ts`.
- **Staged Gate and absolute budgets:** coordinator/orchestrator, projection,
  and convergence modules preserve Design-before-Plan and generation-wide
  limits. Evidence: `tests/integration/review-gate-event-sourced-flow.test.ts`
  and `tests/integration/review-gate-restart-recovery.test.ts`, including
  no Design round 6 / Plan round 4 and zero-capacity clean completion.
- **Read-only implementation approval and safe mutation primitives:**
  `src/runtime/review-gate-approval.ts::findCurrentCompletedApproval` checks
  current artifacts and protocol. `review-gate-git.ts` implements exact literal
  target and prepared recovery primitives. Evidence:
  `tests/runtime/review-gate-approval.test.ts`,
  `tests/runtime/review-gate-git.test.ts`, native provider tests, and restart
  recovery's real-Git cases. This does not prove all coordinator crash windows.

## Confirmed gaps and verification limits

1. **P1 / DA1 / SV1 / PR1 — ledger integrity and persistence policy.**
   `src/runtime/review-gate-event-store.ts::assertEventShape` checks generic
   strings and an object payload, not a strict event-specific schema, bounded
   redaction policy, version envelope, or causal hash chain. Storage is
   `<gateId>/events.jsonl`, `<gateId>/dispatches.jsonl`, and `scope-index.json`.
   Atomic replacement/round-trip tests establish persistence, not the preserved
   writer-sharded, scope-discoverable, hash-linked ledger contract. There is no
   Review Gate ledger prune API, but absence of a prune API is not a complete
   retention-policy enforcement test.
2. **R1 / G1 / E1 — admission and generation continuity.**
   Coordinator `startOrResume` uses the scope index and compares current paths
   and digests. A changed non-completed Gate falls through to `createNewGate`;
   the old suspended generation's capacity is not the admission authority.
   Artifact reads/clean inspection precede scope-lock acquisition. Resume mints
   a new epoch. These differ from same-generation changed-baseline admission,
   locked identity reread, and same-epoch crash resume.
3. **CB1 — completed command reuse versus implementation approval.**
   Completed command reuse checks artifact paths/digests but not protocol
   identity. The separate implementation approval lookup checks the protocol.
   The restart test named protocol-fingerprint reuse checks that lookup, not
   a changed-protocol `startOrResume` call; do not generalize its PASS.
4. **IP1 / XG1 / XGR1 — cross-generation authority.**
   `src/core/review-gate/projection.ts` explicitly leaves inherited Design CLEAR
   unimplemented; initial `supersedesGateId` remains null. The coordinator
   rejects cross-generation reconciliation as `UNSUPPORTED_OPERATION`. Plan-only
   drift tests prove fresh generation creation, not Design CLEAR inheritance.
5. **LNR1 / AR1 / RSL1 — persistent semantic finding history.**
   `validatedFindingFromResult` correctly hashes the five-field semantic basis.
   However, durable findings retain reduced state, and
   `src/core/review-gate/lineage.ts::projectLineages` stubs regression and
   already-resolved observation counters at zero. The coordinator discards
   ALREADY_RESOLVED outcomes; it does not persist occurrence/resolution evidence
   or translate a rediscovered resolved defect into full regression authority.
6. **NC1 — trigger semantics.**
   `src/core/review-gate/convergence.ts::evaluateNonConvergence` uses reopened
   status/round predicates and reduced counters rather than the normative
   fingerprint oscillation, consecutive-cycle history, and conflict-group
   rules. Current-event projection cannot supply all six trigger authorities.
   The restart suite explicitly labels seam-stubbed cases and checks only
   event-reachable predicates. Its PASS does not validate the restored NC1 table.
7. **N1 — end-to-end reentry.**
   The packet parser and pure planner expose MATERIAL_PROGRESS. Coordinator
   session state initializes `materialProgressObserved=false` and sets it only
   after a reentry response; there is no complete eligible-change admission
   path to initiate that validation. The N1 test manually supplies material
   progress to the pure planner, not an actual coordinator rerun after change.
8. **SRF1 / RSL1 — self-review discoveries and commit-bound resolution.**
   Coordinator's self-review handler checks targets and emits
   `FINDING_SELF_REVIEWED`, but does not reconcile `discoveredFindings`.
   Unresolved targets suspend rather than follow the full known-dirty
   carry-forward disposition. Full commit/digest-bound resolution events are
   absent from the durable union. Parser/core tests are not runtime closure.
9. **VAL1 / VSC1 — stage wiring and durable reuse.**
   The validator library implements stage, environment/cache, and DVF1 rules.
   Coordinator wiring schedules PRE_CLEAR; it does not wire all mandatory
   admission/post-remediation stages. Validation cache is session-local, not
   reconstructed from typed durable validation/reuse events.
10. **Compatibility boundary exceptions.**
    Authorized PlanBridge treats `subagent_type="general"` as Justice-managed
    rather than any-string caller-owned routing. Interfaces fence detection
    accepts bare fences only, unlike the parser's opening fences with language
    info. Existing tests cover several fence cases but not full grammar parity.
11. **Live-host proof.**
    Five opt-in host E2E tests are skipped by the default suite. The retained
    [compatibility smoke](2026-09-28-v4-superpowers-6.4.2-omo-4.19.4-smoke.md)
    is BLOCKED and its task-body sentinel is not evaluated. No new live-model
    invocation or provider-backed host smoke was performed in this audit.

## Verification

Executed in the existing `.devcontainer` as its configured `remoteUser=root`:

```bash
bun run test
bun run typecheck
bun run lint
bun run build
```

- Tests: **195 files passed, 1 file skipped; 2883 tests passed, 5 skipped**.
- Typecheck: exit 0.
- ESLint: exit 0; **0 errors, 429 existing warnings**.
- Build: exit 0; 404 modules bundled.
- Markdownlint v0.20.0: the new report has 0 errors. Against the unchanged
  `HEAD` document baseline, README/SPEC diagnostics decreased from 740 to 676,
  with **0 newly introduced diagnostics**. Existing documents are not globally
  Markdownlint-clean; unrelated legacy formatting was not rewritten.
- Repository-relative links and new SPEC section anchors resolve.
- The first execution used the image's default `bun` user instead of the
  configured remoteUser. Existing root-owned build files produced build EACCES;
  three approval-dependent tests also failed under that user. Reexecuting the
  affected suites as root passed all eight tests, and the full run above passed.
  No permission or product-code change was needed. The exact persistence call
  behind the test failures was not instrumented; user-dependent failure and
  recovery were observed, not full syscall-level causal proof.

Passing these checks is regression evidence for the documentation change and
existing scenarios. It does not close the implementation gaps listed above.
