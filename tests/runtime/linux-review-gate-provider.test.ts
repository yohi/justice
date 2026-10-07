import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { describe, expect, it, vi } from "vitest";
import { loadJusticeLinuxNativeAddon } from "../../src/runtime/linux-native-addon";
import { createLinuxReviewGateProvider } from "../../src/runtime/linux-review-gate-provider";

async function withTemporaryRoot<T>(run: (rootDir: string) => Promise<T>): Promise<T> {
  const rootDir = await mkdtemp(join(tmpdir(), "justice-review-gate-"));
  try {
    return await run(rootDir);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
}

describe("LinuxReviewGateProvider publication", () => {
  it("publishes a provider on supported Linux x64 glibc when the native addon is built", async () => {
    await withTemporaryRoot(async (rootDir) => {
      if (process.platform !== "linux" || process.arch !== "x64") {
        expect(createLinuxReviewGateProvider(rootDir)).toBeUndefined();
        return;
      }
      expect(createLinuxReviewGateProvider(rootDir)).toBeDefined();
    });
  });

  it("returns undefined when the native gate addon is unavailable", async () => {
    await withTemporaryRoot(async (rootDir) => {
      vi.resetModules();
      vi.doMock("../../src/runtime/linux-native-addon", () => ({
        hasGlibcRuntime: (): boolean => true,
        loadJusticeLinuxNativeAddon: (): undefined => undefined,
      }));
      try {
        const { createLinuxReviewGateProvider: unavailableProvider } = await import(
          "../../src/runtime/linux-review-gate-provider"
        );
        expect(unavailableProvider(rootDir)).toBeUndefined();
      } finally {
        vi.doUnmock("../../src/runtime/linux-native-addon");
        vi.resetModules();
      }
    });
  });
});

describe("LinuxReviewGateProvider contract", () => {
  it("returns root_closed from native write methods after the root is closed", async () => {
    await withTemporaryRoot(async (rootDir) => {
      const gateAddon = loadJusticeLinuxNativeAddon()?.gate;
      expect(gateAddon).toBeDefined();
      if (gateAddon === undefined) return;

      const root = gateAddon.openReviewGateRoot(rootDir);
      root.close();

      expect(() => root.durableReplaceWriterShard("scope", "gate", "writer", null, Buffer.alloc(0)))
        .toThrow("root_closed");
      expect(() => root.publishRecoveryObject("a1b2", Buffer.alloc(0))).toThrow("root_closed");
      expect(() => root.deleteRecoveryObject("a1b2")).toThrow("root_closed");
      expect(() => root.replaceWorkspaceFileExact("docs/plan.md", "a1b2", "100644", Buffer.alloc(0), "100644"))
        .toThrow("root_closed");
    });
  });

  it("acquires and contends exclusive scope, gate, and recovery GC locks", async () => {
    await withTemporaryRoot(async (rootDir) => {
      const provider = createLinuxReviewGateProvider(rootDir);
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
      provider.close();
    });
  });

  it("contends between two providers on the same root directory", async () => {
    await withTemporaryRoot(async (rootDir) => {
      const first = createLinuxReviewGateProvider(rootDir);
      const second = createLinuxReviewGateProvider(rootDir);
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
      first.close();
      second.close();
    });
  });

  it("verifies lock descriptors are close-on-exec", async () => {
    await withTemporaryRoot(async (rootDir) => {
      const provider = createLinuxReviewGateProvider(rootDir);
      expect(provider).toBeDefined();
      if (provider === undefined) return;
      const lock = await provider.acquireScopeLock("scope-cloexec");
      expect(lock).not.toBe("occupied");
      if (lock !== "occupied") {
        expect(lock.verifyCloexec()).toBe(true);
        lock.release();
      }
      provider.close();
    });
  });

  it("rejects methods after close", async () => {
    await withTemporaryRoot(async (rootDir) => {
      const provider = createLinuxReviewGateProvider(rootDir);
      expect(provider).toBeDefined();
      if (provider === undefined) return;
      expect(() => provider.close()).not.toThrow();
      expect(() => provider.close()).not.toThrow();
      await expect(provider.listScopeIds()).rejects.toThrow("provider_closed");
    });
  });

  it.each(["", "scope/child", "..", "scope\\child"])(
    "rejects invalid scope ID %j",
    async (reviewScopeId) => withTemporaryRoot(async (rootDir) => {
      const provider = createLinuxReviewGateProvider(rootDir);
      expect(provider).toBeDefined();
      if (provider === undefined) return;
      await expect(provider.acquireScopeLock(reviewScopeId)).rejects.toThrow();
      provider.close();
    }),
  );

  it("rejects digests that are not hexadecimal", async () => {
    await withTemporaryRoot(async (rootDir) => {
      const provider = createLinuxReviewGateProvider(rootDir);
      expect(provider).toBeDefined();
      if (provider === undefined) return;
      await expect(provider.readRecoveryObject("not-a-digest")).rejects.toThrow();
      provider.close();
    });
  });
});
