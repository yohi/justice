import { vi } from "vitest";
import type { OpenCodePluginInit } from "../../src/runtime/opencode-adapter";
import { OpenCodeAdapter } from "../../src/runtime/opencode-adapter";
import type { JusticePlugin } from "../../src/core/justice-plugin";

/**
 * Simple deep merge to preserve nested default fields in OpenCodePluginInit
 */
function deepMerge<T extends object>(base: T, overrides: Partial<T>): T {
  const result = { ...base } as Record<string, unknown>;
  for (const key in overrides) {
    if (Object.hasOwn(overrides, key)) {
      const val = overrides[key];
      // eslint-disable-next-line security/detect-object-injection
      const existing = result[key];
      if (
        val &&
        typeof val === "object" &&
        !Array.isArray(val) &&
        existing &&
        typeof existing === "object" &&
        !Array.isArray(existing)
      ) {
        // eslint-disable-next-line security/detect-object-injection
        result[key] = deepMerge(existing as object, val as object);
      } else {
        // eslint-disable-next-line security/detect-object-injection
        result[key] = val;
      }
    }
  }
  return result as T;
}

export function fakeInit(overrides: Partial<OpenCodePluginInit> = {}): OpenCodePluginInit {
  const base: OpenCodePluginInit = {
    project: { name: "test", root: "/tmp/test-workspace" },
    client: { app: { log: vi.fn().mockResolvedValue(undefined) } },
    $: vi.fn() as unknown as OpenCodePluginInit["$"],
    directory: "/tmp/test-workspace",
    worktree: "/tmp/test-workspace",
  };

  return deepMerge(base, overrides);
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
