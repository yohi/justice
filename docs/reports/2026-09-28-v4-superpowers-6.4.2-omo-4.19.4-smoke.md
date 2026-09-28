# Justice v4 upstream compatibility smoke — 2026-09-28

Justice commit: cdea9d6 (bridge baseline; verifier/report committed after this measurement)
OpenCode version: 1.18.32 (required: 1.18.29)
Justice plugin source: local dist/opencode-plugin.js
OmO plugin specifier: oh-my-openagent@4.19.4
Superpowers plugin specifier: superpowers@git+https://github.com/obra/superpowers.git#v6.4.2
JUSTICE_HOST_TEST_MODEL configured: NO

Deterministic verification:
- typecheck: `bun run typecheck` exit 0; no TypeScript errors.
- test: `bun run test` initial exit 1 (2260 passed, 15 failed, 5 skipped; 15 failures exclusively from unavailable native review-artifact addon). After `bun run build:native:review-artifact` exit 0, repeated `bun run test` exit 0 (2275 passed, 5 skipped, 164 files passed, 1 skipped).
- lint: `bun run lint` exit 0, 0 errors; baseline 181 warnings (194 after verifier added).
- build: `bun run build` exit 0; production bundle created.
- adapter task-id boundary tests: `bun run vitest run tests/runtime/opencode-adapter.test.ts` exit 0 (51 passed; includes task-id wire assertions).
- adapter routing exclusivity tests: same adapter command exit 0 (51 passed; exact final routing assertions are adapter-only evidence).
- adapter final-prompt tests: same adapter command exit 0 (51 passed; exact final prompt assertions are adapter-only evidence).

Fresh delegation:
- activation exit: NOT RUN — model unset and host version mismatch.
- execution exit: NOT RUN.
- task accepted: NOT EVALUATED.
- rawBody sentinel exact match: NOT EVALUATED.
- later task remained unexecuted: NOT EVALUATED.

Caller-owned routing:
- activation exit: NOT RUN — model unset and host version mismatch.
- execution exit: NOT RUN.
- task accepted: NOT EVALUATED.
- acceptance sentinel observed: NOT EVALUATED.

Final classification:
SETUP / UPSTREAM BLOCKED — real-host capability not evaluated

The verifier was exercised with the model absent and with a non-secret dummy model; both prerequisites fail closed without running `--auto`. A post-review PATH-without-OpenCode run also classified as setup/upstream blocked without printing host output. No real-host claim is made about hidden final wire fields. Re-run with exact OpenCode 1.18.29, `JUSTICE_HOST_TEST_MODEL=provider/model`, and a provider credential name allowlist in `JUSTICE_HOST_CREDENTIAL_NAMES` to evaluate both isolated workspaces. Only the locally generated OpenCode config and a host-resolved external-directory policy permit a real-host run; otherwise it stops without delegation.
