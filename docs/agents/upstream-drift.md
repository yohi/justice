# Upstream Drift & Maintenance

> Only relevant when either the verified upstream `Superpowers` `main` branch or
> `oh-my-openagent` `dev` branch changes. Not needed for day-to-day work on `justice`.
>
> The local `src/core/provider-error-patterns.ts` was last synchronized from `oh-my-openagent@3.17.4`.

When the upstream package `oh-my-openagent` updates, review its retry constants and error classification logic. Before comparing constants or classifiers, verify the upstream version or commit (e.g., check `package.json` version or the relevant git tag/commit hash in the upstream repo). The local patterns were last synced from `oh-my-openagent@3.17.4`. Check these upstream files for updates:

- `oh-my-openagent/src/hooks/runtime-fallback/constants.ts` (in upstream repo)
- `oh-my-openagent/src/hooks/runtime-fallback/error-classifier.ts` (in upstream repo)

Ensure any newly introduced transient or configuration error patterns from the verified upstream version are synced to the following local files to preserve optimal retry behavior:

- `src/core/provider-error-patterns.ts`
- `src/core/error-classifier.ts`

## Compatibility Audit

The official compatibility target is OpenCode with the current `main` branch of
Superpowers and the current `dev` branch of oh-my-openagent. Older upstream
contracts do not require Justice-specific backward compatibility.

### Historical Baseline

The 2026-08-29 requirements brief recorded the following baseline for the
routing redesign:

| Component | Revision |
|---|---|
| Justice | `b23631760c3b70e543a8a5e89da47db5cd0cf3d6` |
| oh-my-openagent | `09fe012d6fe223ba71ae352fabca38c8895f5ba8` |
| Superpowers | `b36e0829c6d0140e93cfef2ca599b1b07d4a7797` / v6.3.0 |

This table is historical context, not a dependency pin. Each later audit must
record the actual upstream branch and full commit SHA used for verification in the
canonical audit record.

### Audit Scope

Review the boundary between Justice and the verified upstream revisions for:

- skill names and invocation semantics
- command names and workflow stages
- Controller/Worker delegation and category dispatch
- task payload fields and background execution
- background result retrieval and parent continuation
- lifecycle, tool, message, compaction, and loop hooks
- completion and review gates
- design, plan, and other artifact paths
- configuration files and keys
- OpenCode plugin loading and hook contracts
- README, examples, prompts, tests, fixtures, and comments

Classify every contract as compatible, requiring a Justice update, absorbed by
upstream, semantically different, or requiring additional investigation. Do not
infer compatibility from names alone; use upstream code, tests, and
documentation as evidence.

### Reverification Procedure

1. Record the Justice revision and the full SHA for Superpowers `main` and oh-my-openagent `dev`.
2. Extract Justice contract points from source, tests, prompts, Markdown, and configuration examples.
3. Compare each contract with the recorded upstream code, tests, and documentation.
4. Update only the affected adapter, documentation, tests, or configuration; avoid unrelated refactoring and new harness support.
5. Run the project verification commands inside the devcontainer: `bun run test`, `bun run typecheck`, `bun run lint`, `bun run build`, and `bun run test:dist`.
6. Exercise the OpenCode user flow from workflow start through planning, delegation, execution, and completion, including background/continuation, compaction, loop, and completion behavior where Justice still owns that responsibility.
7. Record the verified revisions, every verification command result (including `bun run test:dist`), evidence, remaining differences, and any accepted limitations in the canonical audit record [`docs/reports/upstream-compatibility-audit.md`](../reports/upstream-compatibility-audit.md), using a dated section.

The compatibility audit is not complete when only static checks pass. The
verified upstream revision and the observed user-flow evidence must remain
discoverable to a future maintainer through the canonical audit record.
