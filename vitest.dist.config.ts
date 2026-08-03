import { defineConfig } from "vitest/config";

// FF-009: ビルド成果物（dist/）を self-reference specifier 経由で検証する。
// ビルド前提は package.json の "test:dist" script 自体が保証する（設計書 §5.4）。
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/dist/**/*.test.ts"],
  },
});
