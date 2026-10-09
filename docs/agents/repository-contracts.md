# Repository engineering contracts

Read this guide before changing source, tests, lifecycle, or persistence.
It preserves the engineering constraints formerly embedded in root `AGENTS.md`.
Product behavior belongs in [SPEC.md](../../SPEC.md); these are change boundaries,
not claims that every normative contract is implemented. The
[contract audit](../reports/2026-10-09-documentation-contract-audit.md) records
known gaps; verify current source and production paths before asserting closure.

## Core and public boundaries

- `src/core/**` never imports `@opencode-ai/*`. Core owns business logic;
  hooks coordinate and runtime adapters own host I/O. The observation/evidence/
  gate engine is under `src/core/v2/`.
- Public state uses `readonly`, `ReadonlyArray`, and `ReadonlyMap`.
  Mutate only private internal state and return immutable resolved snapshots.
- Persist structured state as JSON with atomic temp-file-plus-rename writes;
  do not introduce external databases or binary state serialization.
  Private exact-byte recovery objects follow the separate recovery contract
  in SPEC §4.1c and are not an alternative state authority.
- `OpenCodeAdapter.getTools()` exposes only `justice_review`.
  Internal operations remain behind the trust boundary.
- Hook/adapter I/O and notifier failures degrade to `PROCEED` or safe fallback;
  plugin failure must not crash a session. This never grants approval or accepts
  uncertain evidence. The active Review Gate implementation lock and secure
  review-owned mutation boundaries enforce fail-closed behavior; unrelated
  quality verdicts remain advisory.
- `declared` provenance never satisfies Gate PASS (FF-008). Only `observed`
  and `derived` evidence may satisfy its evidence requirements.

## Bootstrap and implementation authorization

See SPEC §4.1b, §4.1d, and §4.1e for lifecycle and compatibility ownership.

- `/justice-start` and `/justice-implement` guidance never invokes a skill or
  `task()`. Bootstrap readiness is not implementation authorization.
- `handlePreToolUse` enriches implementation `task()` only under explicit
  `/justice-implement --approved` authorization; otherwise it emits
  `implementation_unauthorized`. Authorization is Plan- and session-scoped,
  not one-shot; preserve durable cancellation and revalidation.
- After a Review Gate, implementation-capable calls remain cancelled until
  explicit `/justice-implement --approved` matches the durable completed
  Requirements/Design/Plan digests and current review protocol fingerprint.
  Findings permit only scoped Design/Plan remediation and re-review; user
  messages, CLEAR alone, and unrelated tool success cannot unlock execution.
- `parseWorkflowStartFallbackMarker()` is reserved: do not connect it to
  `PlanBridge.handleMessage()` without explicit approval.

## Review Gate changes

Read SPEC §4.1c before changing Gate orchestration, storage, or projection.
Preserve these contracts while addressing known implementation gaps:

- Durable versioned events under `.justice/review-gates/` are the state
  authority; mutable retry/checkpoint files and agent session state are not.
  Restart reprojects durable history. Incomplete dispatches reuse logical
  operation identity; authoritative outcome application recovers exactly once.
- Prepared restore/commit recovers a proven source or destination state, or
  fails closed on a conflicting third state. Unknown partial changes must not
  be overwritten, restored, or chmodded.
- Design clears before Plan. Absolute remediation budgets per generation are
  **Design 5 / Plan 3**, never replenished by epochs or command reruns.
  No path may issue Design round 6 or Plan round 4. Current-phase disposition
  keeps OSC1 upstream precedence before NC1, exhaustion, and continuation;
  stale-lineage revalidation follows the detailed SPEC ordering.
- `review_mutation` is remediator-only. `review_restore` and `review_commit`
  are Justice-core-only and follow GIT1 exact-artifact literal-pathspec scope.
  Never push from Review Gate operations.
- Workspace mutation requires a proven Linux x64 + glibc native substrate:
  `openat2`, `renameat2`, non-blocking `flock`, and sync semantics.
  Missing capability suspends fail-closed; do not add unsafe write fallbacks.
- `--retry N` is deprecated `legacyRetryOption` and a semantic no-op (RTY1).
  It changes no budget, epoch, NC1 rule, protocol fingerprint, or history.
- Test production orchestration and durable reprojection, including failure and
  restart paths. A parser or pure-helper test does not prove runtime integration.

## Tests, paths, and redaction

- Inject the existing filesystem/notifier mocks for ordinary unit tests.
  Real-disk tests belong to designated real-filesystem suites.
- Inspect private fields through `unknown` casts, never `any`.
  Follow neighboring test patterns instead of copying declarations here.
- Validate relative paths with `normalizeSafeRelativePath` or `TriggerDetector`
  before dereferencing. Keep canonical identities workspace-relative.
- Never log or persist credentials, API keys, or absolute host paths.
  Apply the Review Gate ledger's stricter typed/bounded/redacted policy and
  keep private recovery payloads within their dedicated capability boundary.
- Use the commands in [AGENTS.md](../../AGENTS.md) for final verification;
  report exercised scenarios and verification limits, not just aggregate PASS.

## Maintaining agent guidance

Root `AGENTS.md` owns onboarding, commands, and navigation. This guide owns
engineering change constraints; SPEC owns product contracts. Prefer links to
existing owners and source over copied code, volatile signatures, or test counts.
Keep general user preferences in their existing global configuration.

Editorial references for this organization:

- [AI Hero: A Complete Guide To AGENTS.md](https://www.aihero.dev/a-complete-guide-to-agents-md)
- [HumanLayer: Writing a good CLAUDE.md](https://www.humanlayer.dev/blog/writing-a-good-claude-md)
