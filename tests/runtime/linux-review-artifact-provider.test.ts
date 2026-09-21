import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createLinuxOpenat2ReviewArtifactProvider,
  isSupportedLinuxOpenat2Environment,
  type LinuxOpenat2RuntimeEnvironment,
} from "../../src/runtime/linux-review-artifact-provider";

describe("LinuxOpenat2ReviewArtifactProvider publication", () => {
  it("rejects every unsupported runtime shape", () => {
    const runtimes = [
      { platform: "darwin", arch: "x64", glibc: true, openat2: true, renameat2: true },
      { platform: "linux", arch: "arm64", glibc: true, openat2: true, renameat2: true },
      { platform: "linux", arch: "x64", glibc: false, openat2: true, renameat2: true },
      { platform: "linux", arch: "x64", glibc: true, openat2: false, renameat2: true },
      { platform: "linux", arch: "x64", glibc: true, openat2: true, renameat2: false },
    ] as const satisfies readonly LinuxOpenat2RuntimeEnvironment[];

    for (const runtime of runtimes) {
      expect(isSupportedLinuxOpenat2Environment(runtime)).toBe(false);
    }
  });

  it("publishes a provider when the native addon is available", async () => {
    if (process.platform !== "linux" || process.arch !== "x64") return;

    const rootDir = await mkdtemp(join(tmpdir(), "justice-review-artifact-"));
    try {
      expect(createLinuxOpenat2ReviewArtifactProvider(rootDir)).toBeDefined();
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
