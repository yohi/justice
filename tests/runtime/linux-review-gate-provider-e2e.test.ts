import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import process from "node:process";
import { describe, expect, it } from "vitest";
import { createLinuxReviewGateProvider } from "../../src/runtime/linux-review-gate-provider";

describe("LinuxReviewGateProvider E2E (Linux x64 native)", () => {
  it("exercises the native gate lifecycle against a real temp root", async () => {
    if (process.platform !== "linux" || process.arch !== "x64") {
      return; // Skip: the native gate addon only targets Linux x64 glibc.
    }

    const rootDir = await mkdtemp(`${tmpdir()}/justice-gate-e2e-`);
    try {
      const provider = createLinuxReviewGateProvider(rootDir);
      expect(provider).toBeDefined();
      if (provider === undefined) {
        throw new Error(
          "native gate addon unavailable; run `bun run build:native:review-artifact` on Linux x64 glibc with openat2 and renameat2",
        );
      }

      const lock = await provider.acquireScopeLock("scope-e2e");
      expect(lock).not.toBe("occupied");
      if (lock === "occupied") {
        throw new Error("scope-e2e lock was unexpectedly occupied on a fresh root");
      }
      expect(lock.verifyCloexec()).toBe(true);
      lock.release();

      await expect(provider.listScopeIds()).resolves.toEqual([]);
      await expect(provider.listGateIds("scope-e2e")).resolves.toEqual([]);
      await expect(provider.listWriterIds("scope-e2e", "gate-e2e")).resolves.toEqual([]);
      await expect(provider.listRecoveryObjects()).resolves.toEqual([]);

      provider.close();
      await expect(provider.listScopeIds()).rejects.toThrow("provider_closed");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
