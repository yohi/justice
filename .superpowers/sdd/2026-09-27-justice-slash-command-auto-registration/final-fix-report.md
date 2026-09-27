# Final Review Fix Report

## Round 2 — host E2E exit-event race

- Replaced direct `once(process, "exit")` waits with `waitForProcessExit()`. The helper attaches the listener before rechecking `exitCode` and `signalCode`; both graceful SIGTERM and forced SIGKILL paths use it to avoid missing an already-fired exit event.
- `devcontainer exec --workspace-folder "." bun run test tests/integration/review-artifact-linux-host-e2e.test.ts` — passed; all 5 host-only tests skipped because `JUSTICE_RUN_LIVE_HOST_E2E` was not enabled.
- `devcontainer exec --workspace-folder "." bun run test tests/runtime/command-registration.test.ts tests/integration/opencode-plugin.test.ts` — passed: 21 tests.
- `devcontainer exec --workspace-folder "." bun run lint` — passed with 0 errors and 179 warnings.
- `devcontainer exec --workspace-folder "." bun run typecheck` — passed.
