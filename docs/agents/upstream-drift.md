# Upstream Drift & Maintenance

> Only relevant when the upstream `oh-my-openagent` package updates. Not needed for day-to-day work on `justice`.

When the upstream package `oh-my-openagent` updates, review its retry constants and error classification logic. Check these upstream files for updates:

- `oh-my-openagent/src/hooks/runtime-fallback/constants.ts` (in upstream repo)
- `oh-my-openagent/src/hooks/runtime-fallback/error-classifier.ts` (in upstream repo)

Ensure any newly introduced transient or configuration error patterns are synced to the following local files to preserve optimal retry behavior:

- `src/core/provider-error-patterns.ts`
- `src/core/error-classifier.ts`
