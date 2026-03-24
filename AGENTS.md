# Justice Plugin

## What This Is
Justice is an OpenCode plugin (hook-first architecture) that bridges
Superpowers (declarative planning via Markdown) with oh-my-openagent
(event-driven execution).

## Architecture
- `src/core/` — Pure business logic, no OmO dependency
- `src/hooks/` — OmO lifecycle hook implementations
- `tests/` — Vitest tests (mirrors src structure)

## Key Patterns
- All core classes are stateless where possible
- Hooks delegate to core logic immediately
- Types are readonly to enforce immutability
- Error classification uses pattern matching rules

## Commands
- `bun run test` — Run all tests
- `bun run test:watch` — Watch mode
- `bun run typecheck` — Type checking
- `bun run lint` — Linting
- `bun run build` — Build to dist/