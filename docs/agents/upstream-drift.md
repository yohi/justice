# Upstream Drift & Maintenance

> Only relevant when the upstream `oh-my-openagent` package updates. Not needed for day-to-day work on `justice`.
>
> The local `src/core/provider-error-patterns.ts` was last synchronized from `oh-my-openagent@3.17.4`.

When the upstream package `oh-my-openagent` updates, review its retry constants and error classification logic. Before comparing constants or classifiers, verify the upstream version or commit (e.g., check `package.json` version or the relevant git tag/commit hash in the upstream repo). The local patterns were last synced from `oh-my-openagent@3.17.4`. Check these upstream files for updates:

- `oh-my-openagent/src/hooks/runtime-fallback/constants.ts` (in upstream repo)
- `oh-my-openagent/src/hooks/runtime-fallback/error-classifier.ts` (in upstream repo)

Ensure any newly introduced transient or configuration error patterns from the verified upstream version are synced to the following local files to preserve optimal retry behavior:

- `src/core/provider-error-patterns.ts`
- `src/core/error-classifier.ts`
