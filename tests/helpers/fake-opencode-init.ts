import { vi } from "vitest";
import type { OpenCodePluginInit } from "../../src/runtime/opencode-adapter";
import { OpenCodeAdapter } from "../../src/runtime/opencode-adapter";
import type { JusticePlugin } from "../../src/core/justice-plugin";

/**
 * Simple deep merge to preserve nested default fields in OpenCodePluginInit
 */
function isPlainObject(item: unknown): item is Record<string, unknown> {
  return !!item && typeof item === "object" && !Array.isArray(item) && item.constructor === Object;
}

function deepMerge<T extends object>(base: T, overrides: Partial<T>): T {
  const result = { ...base } as Record<string, unknown>;
  for (const key in overrides) {
    if (Object.hasOwn(overrides, key)) {
      const val = overrides[key];
      const existing = result[key];

      if (isPlainObject(val) && isPlainObject(existing)) {
        result[key] = deepMerge(existing, val);
      } else {
        result[key] = val;
      }
    }
  }
  return result as T;
}

export function fakeInit(overrides: Partial<OpenCodePluginInit> = {}): OpenCodePluginInit {
  const base = {
    project: { name: "test", root: "/tmp/test-workspace" },
    client: { app: { log: vi.fn().mockResolvedValue(undefined) } },
    $: vi.fn(),
    directory: "/tmp/test-workspace",
    worktree: "/tmp/test-workspace",
    serverUrl: new URL("http://localhost"),
    experimental_workspace: { register: vi.fn() },
  } as unknown as OpenCodePluginInit;

  return deepMerge(base as unknown as Record<string, unknown>, overrides as Record<string, unknown>) as OpenCodePluginInit;
}

/**
 * Creates an OpenCodeAdapter with a mocked JusticePlugin injected,
 * preventing any real filesystem or initialization side effects.
 */
export function createMockedAdapter(initOverrides: Partial<OpenCodePluginInit> = {}): {
  adapter: OpenCodeAdapter;
  justice: Pick<JusticePlugin, "initialize" | "handleEvent">;
} {
  const init = fakeInit(initOverrides);
  const adapter = new OpenCodeAdapter(init);

  // Create a minimal mock of JusticePlugin
  const justice: Pick<JusticePlugin, "initialize" | "handleEvent"> = {
    initialize: vi.fn().mockResolvedValue(undefined),
    handleEvent: vi.fn().mockResolvedValue({ action: "proceed" }),
  };

  adapter.__injectJusticeForTest(justice as unknown as JusticePlugin);

  return { adapter, justice };
}
