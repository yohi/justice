import { defineConfig } from "vitest/config";

// 実 FS / 実モジュールを対象とする統合テスト（設計書 §12）。
// ビルド前提は package.json の "test:integration" script 自体が保証する。
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/real-fs/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"],
    },
  },
});

