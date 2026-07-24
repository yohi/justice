# ADR: Justice V2 Charter Drift and Authorship Reduction

* **Status:** PENDING HUMAN CODEOWNERS RATIFICATION
* **Date:** 2026-06-26
* **Decided By:** `@yohi` (Repository Owner; self-merged — human CODEOWNERS ratification remains pending)

## Context
During the spike Phase 0 and detail design of Justice V2, several deviations from the original Charter requirements were identified:
1. **Hook Bindings (D44):** The original list of event hooks was updated to match the actual `@opencode-ai/plugin` interface. Specifically, message observations now consume `message.part.updated` / `experimental.text.complete` (for assistant message body) + `message.updated` (for lifecycle: role & finalized confirmation) + `session.error` + `tool.execute`, rather than simply relying on `message.updated`.
2. **Storage Paths (§4.5):** The storage layout was detailed to support per-writer serialization (`events/<agentId>/<sessionId>/<writerId>.jsonl`).
3. **Exit Code Degraded Verdict (D5):** The fallback exit code logic is treated as a degraded observation rather than a direct gate verdict.
4. **Artifact Authorship Reduction (§8.3 / D54 / D63):** In V2.0, the `authorship` metadata (creation context tracking) is omitted from the state projection and event logs, retaining only the `authority` parameter, as multi-agent handoff dynamics are deferred to V2.5.
5. **Declared Evidence Limitation (INV-004 / §5.3 M4):** Asserts that `declared` claims (self-proclaimed test passes by assistant or task summaries) are only used for L0 advisory outputs, and only `observed` or `derived` evidence can be used as authoritative data for gate PASS / L1+ deny decisions.

## Decision
We modify and ratify the Charter with the following adjustments:
- Ratify the updated hook event matrix.
- Restructure folder persistence to `.justice/events/<agentId>/<sessionId>/<writerId>.jsonl` and `.justice/archive/events/<agentId>/<sessionId>/<writerId>.<timestamp>.jsonl`.
- Drop `authorship` tracking from V2.0 state envelopes and projections.
- Restrict gate evaluation authority strictly to `observed` and `derived` provenance. Treat `declared` as non-authoritative for gate evaluation, but still allow it for L0 advisory outputs and other non-gating display surfaces.

## Approval Evidence and Remaining Requirement
* **PR:** #116 (`feature/phase0-task0-preflight`, merged 2026-07-02)
* **Approvers:** `@yohi` (Author, self-merged)
* **Approval Trail Note:** GitHub's `reviewDecision=APPROVED` on PR #116 was driven solely by an automated bot review (`coderabbitai`, `state=APPROVED`, 2026-07-01). `@yohi`'s own review submissions were all `state=COMMENTED` — no human `APPROVED` review was recorded. No CODEOWNERS branch-protection rule required a human sign-off on this repository at merge time, so the self-merge proceeded without manual CODEOWNERS approval. Verified via `gh pr view 116 --json reviewDecision,reviews,author,mergedBy` (2026-07-06).
* **Current status:** The automated review and self-merge are recorded above, but they do not satisfy the human CODEOWNERS approval prerequisite declared by the v2.0 design and plan.
* **Required action:** Obtain an explicit human CODEOWNERS `APPROVED` review for this ADR before treating the Charter deviations as ratified.
