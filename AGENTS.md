# Justice — Agent Guide

Justice is an OpenCode quality-control plugin connecting Superpowers planning
with oh-my-openagent execution to prevent false completion: task success is not
feature success. Justice observes evidence and controls review approval; it does
not perform production implementation itself.

## Start here

- Read [README.md](./README.md) for user-facing behavior. Use `package.json`
  and `.devcontainer/devcontainer.json` as command/environment sources of truth.
- Domain logic is in `src/core/`; hooks coordinate in `src/hooks/`; host I/O
  is in `src/runtime/`; `native/` supplies Linux filesystem capabilities.
- Read the relevant contracts before editing. Use current source and
  production-path tests to establish actual behavior: a requirement, test name,
  or helper-only PASS is not proof of implementation. Record gaps explicitly.

## Development and verification

Use **Bun inside the configured devcontainer**, with its configured `remoteUser`.
Direct `docker exec` defaults may differ from that user. Do not hard-code a
container ID or assume the image user has workspace write access.

Before declaring any task complete, run all four commands fresh with zero errors:

```bash
bun run test
bun run typecheck
bun run lint
bun run build
```

Use deterministic checks rather than manual style inspection. Report warnings,
skipped tests, and blocked host verification separately from passing checks.

## Trust boundaries

- Keep core host-independent and public state immutable. Ordinary hook/adapter
  I/O is fail-open; approval, evidence, and scoped mutation authority fail closed.
- Agent declarations cannot satisfy Gate PASS. A Review Gate implementation
  lock requires explicit `/justice-implement --approved` and an exact current
  durable approval binding; a new message alone never unlocks execution.
- Validate relative paths before use; keep credentials and absolute host paths
  out of logs and persisted data. Preserve the detailed contracts linked below.

## Read when relevant

- **Source, tests, lifecycle, or persistence changes:**
  [repository contracts](./docs/agents/repository-contracts.md).
- **Architecture or structural changes:** [SPEC.md](./SPEC.md).
  Review Gate, compatibility, and acceptance contracts are in §4.1c–§4.1e.
- **Review Gate changes or implementation claims:**
  [contract audit](./docs/reports/2026-10-09-documentation-contract-audit.md)
  and [Issue #310](https://github.com/yohi/justice/issues/310).
  The audit is dated evidence, not a replacement specification.
- **Upstream error handling:**
  [upstream drift](./docs/agents/upstream-drift.md).
- **Native I/O or review artifacts:**
  [Linux provider contracts](./docs/agents/review-artifact-linux-provider.md).

Use CodeGraph or symbol navigation for exact source and call paths. Keep this
entry point short; maintain task-specific detail in its linked owner document.
