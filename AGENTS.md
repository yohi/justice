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

---

## Bun Specific Guidelines (Integrated from CLAUDE.md)

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun run test` (this project uses Vitest) instead of `bun test` directly unless you're writing simple local tests.
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Bun automatically loads .env, so don't use dotenv.

### APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`. Note: `Bun.redis` Pub/Sub is experimental (since 1.2.23) and features like Redis Cluster, Sentinel, and MULTI/EXEC are not supported. Use a dedicated client if needed.
- `Bun.sql` for Postgres (production-ready). Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

### Testing

Use `bun run test` to run tests (this project uses Vitest).

```ts#index.test.ts
import { describe, it, expect } from "vitest";

describe("hello world", () => {
  it("should work", () => {
    expect(1).toBe(1);
  });
});
```

### Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";

// import .css files directly and it works
import './index.css';

import { createRoot } from "react-dom/client";

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.md`.