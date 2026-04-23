import { vi } from "vitest";
import type { OpenCodePluginInit } from "../../src/runtime/opencode-adapter";
import { OpenCodeAdapter } from "../../src/runtime/opencode-adapter";
import type { JusticePlugin } from "../../src/core/justice-plugin";

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

/**
 * Creates an OpenCodeAdapter with a mocked JusticePlugin injected,
 * preventing any real filesystem or initialization side effects.
 */
export function createMockedAdapter(initOverrides: Partial<OpenCodePluginInit> = {}): {
  adapter: OpenCodeAdapter;
  justice: JusticePlugin;
} {
  const init = fakeInit(initOverrides);
  const adapter = new OpenCodeAdapter(init);

  // Create a minimal mock of JusticePlugin
  // We use actual JusticePlugin type but with mocked methods to satisfy TypeScript
  const justice = {
    initialize: vi.fn().mockResolvedValue(undefined),
    handleEvent: vi.fn().mockResolvedValue({ action: "proceed" }),
  } as unknown as JusticePlugin;

  adapter.__injectJusticeForTest(justice);

  return { adapter, justice };
}
