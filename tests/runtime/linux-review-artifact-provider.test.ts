import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
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

  it("supports an exclusive reservation lifecycle", async () => {
    if (process.platform !== "linux" || process.arch !== "x64") return;

    const rootDir = await mkdtemp(join(tmpdir(), "justice-review-artifact-"));
    const provider = createLinuxOpenat2ReviewArtifactProvider(rootDir);
    try {
      expect(provider).toBeDefined();
      if (provider === undefined) return;

      const artifactPath = ".justice/reviews/review.json";
      const marker = await provider.createExclusiveMarker(artifactPath);
      expect(marker.kind).toBe("created");
      if (marker.kind !== "created") return;

      await expect(provider.createExclusiveMarker(artifactPath)).resolves.toEqual({
        kind: "occupied",
      });

      const reservation = {
        status: "usable" as const,
        artifactId: "review",
        artifactPath,
        leasePath: marker.leasePath,
        artifactIdentity: marker.artifactIdentity,
      };
      await expect(
        provider.reservedReviewArtifactIo.writeExisting(reservation, '{"ok":true}'),
      ).resolves.toBeUndefined();
      await expect(provider.reservedReviewArtifactIo.readOnce(reservation)).resolves.toBe(
        '{"ok":true}',
      );
      await expect(provider.reservedReviewArtifactIo.cleanup(reservation)).resolves.toBe("removed");

      provider.close();
      provider.close();
    } finally {
      provider?.close();
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("maps native path failures and closed roots to safe errors", async () => {
    if (process.platform !== "linux" || process.arch !== "x64") return;

    const rootDir = await mkdtemp(join(tmpdir(), "justice-review-artifact-"));
    const provider = createLinuxOpenat2ReviewArtifactProvider(rootDir);
    try {
      expect(provider).toBeDefined();
      if (provider === undefined) return;

      const invalidReservation = {
        status: "usable" as const,
        artifactId: "invalid",
        artifactPath: ".justice/reviews/invalid.txt",
        leasePath: ".justice/reviews/.leases/invalid.lease",
        artifactIdentity: { device: "0", inode: "0" },
      };
      await expect(
        provider.createExclusiveMarker(".justice/reviews/invalid.txt"),
      ).rejects.toThrow("artifact_path_invalid");
      await expect(
        provider.reservedReviewArtifactIo.writeExisting(invalidReservation, "content"),
      ).rejects.toThrow("artifact_path_invalid");
      await expect(provider.reservedReviewArtifactIo.readOnce(invalidReservation)).rejects.toThrow(
        "artifact_path_invalid",
      );
      await expect(provider.reservedReviewArtifactIo.cleanup(invalidReservation)).rejects.toThrow(
        "artifact_path_invalid",
      );

      provider.close();
      await expect(
        provider.createExclusiveMarker(".justice/reviews/closed.json"),
      ).rejects.toThrow("root_closed");
    } finally {
      provider?.close();
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("retains a replacement artifact during cleanup", async () => {
    if (process.platform !== "linux" || process.arch !== "x64") return;

    const rootDir = await mkdtemp(join(tmpdir(), "justice-review-artifact-"));
    const provider = createLinuxOpenat2ReviewArtifactProvider(rootDir);
    try {
      expect(provider).toBeDefined();
      if (provider === undefined) return;

      const artifactPath = ".justice/reviews/review.json";
      const marker = await provider.createExclusiveMarker(artifactPath);
      expect(marker.kind).toBe("created");
      if (marker.kind !== "created") return;

      const reservation = {
        status: "usable" as const,
        artifactId: "review",
        artifactPath,
        leasePath: marker.leasePath,
        artifactIdentity: marker.artifactIdentity,
      };
      await rm(join(rootDir, artifactPath));
      // The path is rooted in a mkdtemp directory and uses a fixed artifact name.
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      await writeFile(join(rootDir, artifactPath), "replacement");

      await expect(provider.reservedReviewArtifactIo.cleanup(reservation)).resolves.toBe(
        "replacement_retained",
      );
    } finally {
      provider?.close();
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("returns replacement_retained when the artifact quarantine destination exists", async () => {
    if (process.platform !== "linux" || process.arch !== "x64") return;

    const rootDir = await mkdtemp(join(tmpdir(), "justice-review-artifact-"));
    const provider = createLinuxOpenat2ReviewArtifactProvider(rootDir);
    try {
      expect(provider).toBeDefined();
      if (provider === undefined) return;

      const artifactPath = ".justice/reviews/review.json";
      const marker = await provider.createExclusiveMarker(artifactPath);
      expect(marker.kind).toBe("created");
      if (marker.kind !== "created") return;

      const reservation = {
        status: "usable" as const,
        artifactId: "review",
        artifactPath,
        leasePath: marker.leasePath,
        artifactIdentity: marker.artifactIdentity,
      };
      await writeFile(
        join(rootDir, ".justice/reviews/.quarantine/review.artifact"),
        "existing quarantine artifact",
      );

      await expect(provider.reservedReviewArtifactIo.cleanup(reservation)).resolves.toBe(
        "replacement_retained",
      );
    } finally {
      provider?.close();
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("fails when cleanup cannot move the lease to quarantine", async () => {
    if (process.platform !== "linux" || process.arch !== "x64") return;

    const rootDir = await mkdtemp(join(tmpdir(), "justice-review-artifact-"));
    const provider = createLinuxOpenat2ReviewArtifactProvider(rootDir);
    try {
      expect(provider).toBeDefined();
      if (provider === undefined) return;

      const artifactPath = ".justice/reviews/review.json";
      const marker = await provider.createExclusiveMarker(artifactPath);
      expect(marker.kind).toBe("created");
      if (marker.kind !== "created") return;

      const reservation = {
        status: "usable" as const,
        artifactId: "review",
        artifactPath,
        leasePath: marker.leasePath,
        artifactIdentity: marker.artifactIdentity,
      };
      await rm(join(rootDir, marker.leasePath));

      await expect(provider.reservedReviewArtifactIo.cleanup(reservation)).rejects.toThrow(
        "artifact_cleanup_failed",
      );
    } finally {
      provider?.close();
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("returns undefined when the runtime report cannot be read", () => {
    if (process.platform !== "linux" || process.arch !== "x64" || process.report === undefined) {
      return;
    }

    const reportSpy = vi.spyOn(process.report, "getReport").mockImplementationOnce(() => {
      throw new Error("runtime report unavailable");
    });
    try {
      expect(createLinuxOpenat2ReviewArtifactProvider("/tmp")).toBeUndefined();
    } finally {
      reportSpy.mockRestore();
    }
  });

  it("returns undefined when the native root cannot be opened", async () => {
    if (process.platform !== "linux" || process.arch !== "x64") return;

    const parentDir = await mkdtemp(join(tmpdir(), "justice-review-artifact-"));
    const missingRoot = join(parentDir, "missing");
    await rm(parentDir, { recursive: true, force: true });

    expect(createLinuxOpenat2ReviewArtifactProvider(missingRoot)).toBeUndefined();
  });
});
