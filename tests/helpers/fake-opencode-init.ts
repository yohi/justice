import { vi } from "vitest";
import type { OpenCodePluginInit } from "../../src/runtime/opencode-adapter";

export function fakeInit(overrides: Partial<OpenCodePluginInit> = {}): OpenCodePluginInit {
  const base: OpenCodePluginInit = {
    project: { name: "test", root: "/tmp/test-workspace" },
    client: { app: { log: vi.fn().mockResolvedValue(undefined) } },
    $: vi.fn(),
    directory: "/tmp/test-workspace",
    worktree: "/tmp/test-workspace",
  };

  return { ...base, ...overrides };
}
