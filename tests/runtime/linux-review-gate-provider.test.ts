import process from "node:process";
import { describe, expect, it, vi } from "vitest";
import { createLinuxReviewGateProvider } from "../../src/runtime/linux-review-gate-provider";

describe("LinuxReviewGateProvider publication", () => {
  it("publishes a provider on supported Linux x64 glibc when the native addon is built", () => {
    if (process.platform !== "linux" || process.arch !== "x64") {
      expect(createLinuxReviewGateProvider("/tmp")).toBeUndefined();
      return;
    }
    expect(createLinuxReviewGateProvider("/tmp")).toBeDefined();
  });

  it("returns undefined when the native gate addon is unavailable", async () => {
    vi.resetModules();
    vi.doMock("../../src/runtime/linux-native-addon", () => ({
      hasGlibcRuntime: () => true,
      loadJusticeLinuxNativeAddon: () => undefined,
    }));
    try {
      const { createLinuxReviewGateProvider: unavailableProvider } = await import(
        "../../src/runtime/linux-review-gate-provider"
      );
      expect(unavailableProvider("/tmp")).toBeUndefined();
    } finally {
      vi.doUnmock("../../src/runtime/linux-native-addon");
      vi.resetModules();
    }
  });
});

describe("LinuxReviewGateProvider contract", () => {
  it("acquires exclusive scope, gate, and recovery GC locks", async () => {
    const provider = createLinuxReviewGateProvider("/tmp");
    expect(provider).toBeDefined();
    if (provider === undefined) return;

    const scopeLock = await provider.acquireScopeLock("scope-a");
    expect(scopeLock).not.toBe("occupied");
    if (scopeLock !== "occupied") scopeLock.release();
    await expect(provider.acquireScopeLock("scope-a")).resolves.toBe("occupied");

    const gateLock = await provider.acquireGateLock("gate-a");
    expect(gateLock).not.toBe("occupied");
    if (gateLock !== "occupied") gateLock.release();
    await expect(provider.acquireGateLock("gate-a")).resolves.toBe("occupied");

    const gcLock = await provider.acquireRecoveryGcLock();
    expect(gcLock).not.toBe("occupied");
    if (gcLock !== "occupied") gcLock.release();
    await expect(provider.acquireRecoveryGcLock()).resolves.toBe("occupied");
  });

  it("verifies lock descriptors are close-on-exec", async () => {
    const provider = createLinuxReviewGateProvider("/tmp");
    expect(provider).toBeDefined();
    if (provider === undefined) return;
    const lock = await provider.acquireScopeLock("scope-cloexec");
    expect(lock).not.toBe("occupied");
    if (lock !== "occupied") {
      expect(lock.verifyCloexec()).toBe(true);
      lock.release();
    }
  });

  it("rejects methods after close", async () => {
    const provider = createLinuxReviewGateProvider("/tmp");
    expect(provider).toBeDefined();
    if (provider === undefined) return;
    expect(() => provider.close()).not.toThrow();
    expect(() => provider.close()).not.toThrow();
    await expect(provider.listScopeIds()).rejects.toThrow("provider_closed");
  });

  it.each(["", "scope/child", "..", "scope\\child"])(
    "rejects invalid scope ID %j",
    async (reviewScopeId) => {
      const provider = createLinuxReviewGateProvider("/tmp");
      expect(provider).toBeDefined();
      if (provider === undefined) return;
      await expect(provider.acquireScopeLock(reviewScopeId)).rejects.toThrow();
    },
  );

  it("rejects digests that are not hexadecimal", async () => {
    const provider = createLinuxReviewGateProvider("/tmp");
    expect(provider).toBeDefined();
    if (provider === undefined) return;
    await expect(provider.readRecoveryObject("not-a-digest")).rejects.toThrow();
  });
});
