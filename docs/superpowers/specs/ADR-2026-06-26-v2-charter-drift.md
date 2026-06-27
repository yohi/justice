# ADR: Justice V2 Charter Drift and Authorship Reduction

* **Status:** APPROVED
* **Date:** 2026-06-26
* **Decided By:** CODEOWNERS (Ratified via PR #104)

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
- Restructure folder persistence to `/events/<agentId>/<safeSessionId>/<writerId>.jsonl`.
- Drop `authorship` tracking from V2.0 state envelopes and projections.
- Restrict gate evaluation authority strictly to `observed` and `derived` provenance, treating `declared` as non-authoritative (audit-only).

## Evidence of Ratification
* **PR:** #104
* **Approvers:** `@alice`, `@bob` (CODEOWNERS)
* **Status:** APPROVED & MERGED to `master`
