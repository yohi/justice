import { describe, expect, it, vi } from "vitest";
import { createReviewArtifactReservationPort } from "../../src/core/review-artifact-reservation";
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
});
