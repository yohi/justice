import { normalizeSafeRelativePath } from "./trigger-detector";
import type {
  FileReader,
  FileWriter,
  ReservedReviewArtifactIo,
  ReviewArtifactReservation,
} from "./types";

export const MAX_ARTIFACT_RESERVATION_ATTEMPTS = 3;

export type ReviewArtifactReservationPort = {
  readonly reserve: () => Promise<ReviewArtifactReservation>;
  readonly artifactIo?: ReservedReviewArtifactIo;
};

export function createReviewArtifactReservationPort(
  _fileReader: FileReader,
  fileWriter: FileWriter,
  artifactIo: ReservedReviewArtifactIo | undefined,
  recordAdvisory: (advisory: string, cause?: unknown) => Promise<void>,
  generateId: () => string = () => {
    throw new Error("review artifact ID factory unavailable");
  },
): ReviewArtifactReservationPort {
  return {
    ...(artifactIo === undefined ? {} : { artifactIo }),
    async reserve(): Promise<ReviewArtifactReservation> {
      if (fileWriter.createExclusiveMarker === undefined || artifactIo === undefined) {
        return { status: "unusable", reason: "artifact_storage_unavailable" };
      }
      for (let attempt = 0; attempt < MAX_ARTIFACT_RESERVATION_ATTEMPTS; attempt += 1) {
        let artifactId: string;
        try {
          artifactId = generateId();
        } catch (cause) {
          await recordSafely(recordAdvisory, "review_artifact_reservation_internal_error", cause);
          return { status: "unusable", reason: "reservation_internal_error" };
        }
        const artifactPath = normalizeSafeRelativePath(`.justice/reviews/${artifactId}.json`);
        if (artifactPath === null) {
          await recordSafely(recordAdvisory, "review_artifact_path_invalid");
          return { status: "unusable", reason: "artifact_path_invalid" };
        }
        try {
          const marker = await fileWriter.createExclusiveMarker(artifactPath);
          if (marker.kind === "occupied") {
            await recordSafely(recordAdvisory, "review_unexpected_existing_artifact");
            continue;
          }
          return {
            status: "usable",
            artifactId,
            artifactPath,
            leasePath: marker.leasePath,
            artifactIdentity: marker.artifactIdentity,
          };
        } catch (cause) {
          await recordSafely(recordAdvisory, "review_artifact_storage_unavailable", cause);
          return { status: "unusable", reason: "artifact_storage_unavailable" };
        }
      }
      return { status: "unusable", reason: "artifact_path_collision_exhausted" };
    },
  };
}

async function recordSafely(
  recordAdvisory: (advisory: string, cause?: unknown) => Promise<void>,
  advisory: string,
  cause?: unknown,
): Promise<void> {
  try {
    await recordAdvisory(advisory, cause);
  } catch {
    return;
  }
}
