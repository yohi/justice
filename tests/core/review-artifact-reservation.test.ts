import { describe, expect, it, vi } from "vitest";
import {
  createReviewArtifactReservationPort,
  MAX_ARTIFACT_RESERVATION_ATTEMPTS,
} from "../../src/core/review-artifact-reservation";
import type { ReservedReviewArtifactIo } from "../../src/core/types";
import { createMockFileSystem } from "../helpers/mock-file-system";

const artifactIo: ReservedReviewArtifactIo = {
  writeExisting: vi.fn(async () => undefined),
  readOnce: vi.fn(async () => "{}"),
  cleanup: vi.fn(async () => "removed" as const),
};

describe("createReviewArtifactReservationPort", () => {
  it("returns unusable without an exclusive marker capability", async () => {
    const files = createMockFileSystem();
    const reserve = createReviewArtifactReservationPort(
      files,
      files,
      artifactIo,
      vi.fn(async () => undefined),
      () => "artifact-1",
    ).reserve;

    await expect(reserve()).resolves.toEqual({
      status: "unusable",
      reason: "artifact_storage_unavailable",
    });
    expect(files.fileExists).not.toHaveBeenCalled();
    expect(files.writeFile).not.toHaveBeenCalled();
  });

  it("reserves the exact marker-backed artifact path", async () => {
    const files = createMockFileSystem();
    files.createExclusiveMarker = vi.fn(async () => ({
      kind: "created" as const,
      leasePath: ".justice/reviews/.leases/artifact-1.lease",
      artifactIdentity: { device: "1", inode: "2" },
    }));
    const reserve = createReviewArtifactReservationPort(
      files,
      files,
      artifactIo,
      vi.fn(async () => undefined),
      () => "artifact-1",
    ).reserve;

    await expect(reserve()).resolves.toEqual({
      status: "usable",
      artifactId: "artifact-1",
      artifactPath: ".justice/reviews/artifact-1.json",
      leasePath: ".justice/reviews/.leases/artifact-1.lease",
      artifactIdentity: { device: "1", inode: "2" },
    });
  });

  it("retries occupied markers before returning the created reservation", async () => {
    const files = createMockFileSystem();
    const marker = vi
      .fn()
      .mockResolvedValueOnce({ kind: "occupied" as const })
      .mockResolvedValueOnce({
        kind: "created" as const,
        leasePath: ".justice/reviews/.leases/artifact-2.lease",
        artifactIdentity: { device: "2", inode: "3" },
      });
    files.createExclusiveMarker = marker;
    const ids = ["artifact-1", "artifact-2"];
    const reserve = createReviewArtifactReservationPort(
      files,
      files,
      artifactIo,
      vi.fn(async () => undefined),
      () => ids.shift() ?? "artifact-fallback",
    ).reserve;

    await expect(reserve()).resolves.toMatchObject({
      status: "usable",
      artifactId: "artifact-2",
      artifactPath: ".justice/reviews/artifact-2.json",
    });
    expect(marker).toHaveBeenCalledTimes(2);
  });

  it("returns collision exhaustion after the maximum attempts", async () => {
    const files = createMockFileSystem();
    files.createExclusiveMarker = vi.fn(async () => ({ kind: "occupied" as const }));
    const recordAdvisory = vi.fn(async () => undefined);
    const reserve = createReviewArtifactReservationPort(
      files,
      files,
      artifactIo,
      recordAdvisory,
      () => "same-artifact",
    ).reserve;

    await expect(reserve()).resolves.toEqual({
      status: "unusable",
      reason: "artifact_path_collision_exhausted",
    });
    expect(files.createExclusiveMarker).toHaveBeenCalledTimes(MAX_ARTIFACT_RESERVATION_ATTEMPTS);
    expect(recordAdvisory).toHaveBeenCalledTimes(MAX_ARTIFACT_RESERVATION_ATTEMPTS);
  });

  it.each([
    ["invalid path", (): string => "../escape", "artifact_path_invalid" as const],
    [
      "ID generation",
      (): string => {
        throw new Error("ID unavailable");
      },
      "reservation_internal_error" as const,
    ],
  ] as const)(
    "returns an unusable result for %s",
    async (
      _label: string,
      generateId: () => string,
      reason: "artifact_path_invalid" | "reservation_internal_error",
    ) => {
      const files = createMockFileSystem();
      files.createExclusiveMarker = vi.fn(async () => ({
        kind: "created" as const,
        leasePath: ".justice/reviews/.leases/artifact.lease",
        artifactIdentity: { device: "1", inode: "2" },
      }));
      const recordAdvisory = vi.fn(async () => undefined);
      const reserve = createReviewArtifactReservationPort(
        files,
        files,
        artifactIo,
        recordAdvisory,
        generateId,
      ).reserve;

      await expect(reserve()).resolves.toEqual({ status: "unusable", reason });
      expect(files.createExclusiveMarker).not.toHaveBeenCalled();
    },
  );

  it("converts marker failures and advisory failures to a fail-open result", async () => {
    const files = createMockFileSystem();
    files.createExclusiveMarker = vi.fn(async () => {
      throw new Error("storage unavailable");
    });
    const recordAdvisory = vi.fn(async () => {
      throw new Error("advisory unavailable");
    });
    const reserve = createReviewArtifactReservationPort(
      files,
      files,
      artifactIo,
      recordAdvisory,
      () => "artifact-1",
    ).reserve;

    await expect(reserve()).resolves.toEqual({
      status: "unusable",
      reason: "artifact_storage_unavailable",
    });
    expect(recordAdvisory).toHaveBeenCalledWith(
      "review_artifact_storage_unavailable",
      expect.any(Error),
    );
  });
});
