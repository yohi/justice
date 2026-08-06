# ADR: Justice V2 Charter Drift and Authorship Reduction

* **Status:** APPROVED
* **Date:** 2026-06-26（ratified 2026-08-02）
* **Decided By:** `@yohi` (Repository Owner)

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

## Ratification (2026-08-02)

- **Structural constraint discovered:** `.github/CODEOWNERS` is `* @yohi` and the repository
  collaborator is `@yohi` alone (admin). The human CODEOWNERS required by the original
  ratification clause is therefore `@yohi` themself, and GitHub structurally forbids
  self-`APPROVED` reviews on one's own PRs. The original requirement — "obtain an explicit
  human CODEOWNERS `APPROVED` review" — was **structurally unachievable**.
- **Evidence:** PR #116's `reviewDecision=APPROVED` was driven solely by the automated
  `coderabbitai` bot review; all of `@yohi`'s review submissions were `state=COMMENTED`
  (verified 2026-07-06 via `gh pr view 116 --json reviewDecision,reviews,author,mergedBy`).
- **Re-definition of ratification evidence:** the ratification evidence is re-defined as
  "**a commit to this ADR by the CODEOWNER themself, stating the date, the ratified subject,
  and the rationale**". This commit (dated 2026-08-02, ratifying the five Charter deviations
  listed in Context: hook bindings / storage paths / exit code degraded verdict /
  artifact authorship reduction / declared evidence limitation) constitutes that evidence.
- **This is not a removal of the requirement but its re-definition into an achievable form.**
  The five Charter deviations themselves are unchanged and remain the ratified subject.
- **Status change:** `PENDING HUMAN CODEOWNERS RATIFICATION` → `APPROVED`.
