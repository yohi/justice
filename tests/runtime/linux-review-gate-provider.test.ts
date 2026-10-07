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
  it("acquires and contends exclusive scope, gate, and recovery GC locks", async () => {
    const provider = createLinuxReviewGateProvider("/tmp");
    expect(provider).toBeDefined();
    if (provider === undefined) return;

    const scopeLock = await provider.acquireScopeLock("scope-flock-a");
    expect(scopeLock).not.toBe("occupied");
    if (scopeLock === "occupied") return;
    await expect(provider.acquireScopeLock("scope-flock-a")).resolves.toBe("occupied");
    scopeLock.release();
    const scopeReacquired = await provider.acquireScopeLock("scope-flock-a");
    expect(scopeReacquired).not.toBe("occupied");
    if (scopeReacquired !== "occupied") scopeReacquired.release();

    const gateLock = await provider.acquireGateLock("gate-flock-a");
    expect(gateLock).not.toBe("occupied");
    if (gateLock === "occupied") return;
    await expect(provider.acquireGateLock("gate-flock-a")).resolves.toBe("occupied");
    gateLock.release();
    const gateReacquired = await provider.acquireGateLock("gate-flock-a");
    expect(gateReacquired).not.toBe("occupied");
    if (gateReacquired !== "occupied") gateReacquired.release();

    const gcLock = await provider.acquireRecoveryGcLock();
    expect(gcLock).not.toBe("occupied");
    if (gcLock === "occupied") return;
    await expect(provider.acquireRecoveryGcLock()).resolves.toBe("occupied");
    gcLock.release();
    const gcReacquired = await provider.acquireRecoveryGcLock();
    expect(gcReacquired).not.toBe("occupied");
    if (gcReacquired !== "occupied") gcReacquired.release();
  });

  it("contends between two providers on the same root directory", async () => {
    const first = createLinuxReviewGateProvider("/tmp");
    const second = createLinuxReviewGateProvider("/tmp");
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (first === undefined || second === undefined) return;

    const held = await first.acquireScopeLock("scope-flock-contend");
    expect(held).not.toBe("occupied");
    if (held === "occupied") return;
    await expect(second.acquireScopeLock("scope-flock-contend")).resolves.toBe("occupied");
    held.release();
    const reacquired = await second.acquireScopeLock("scope-flock-contend");
    expect(reacquired).not.toBe("occupied");
    if (reacquired !== "occupied") reacquired.release();
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
