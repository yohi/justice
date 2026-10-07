import { createHash } from "node:crypto";
import type { ArtifactDigest, ReviewScopeId } from "./review-gate-types";

export function canonicalizeArtifactPath(rawPath: string): string | null {
  if (
    rawPath.length === 0 ||
    rawPath.startsWith("/") ||
    rawPath.startsWith("./") ||
    rawPath.includes("..") ||
    rawPath.includes("\\") ||
    rawPath.includes("\0") ||
    rawPath.includes("/./")
  ) {
    return null;
  }

  const components = rawPath.split("/");
  if (components.at(-1) === "") return null;

  return components.filter((component) => component.length > 0).join("/");
}

export function isValidArtifactPath(path: string): boolean {
  return canonicalizeArtifactPath(path) !== null;
}

export function computeReviewScopeId(designPath: string, planPath: string): ReviewScopeId {
  const canonicalDesignPath = canonicalizeArtifactPath(designPath);
  const canonicalPlanPath = canonicalizeArtifactPath(planPath);
  if (canonicalDesignPath === null || canonicalPlanPath === null) {
    throw new Error("review_gate_invalid_artifact_path");
  }

  return createHash("sha256")
    .update(`justice-review-scope-v1\0${canonicalDesignPath}\0${canonicalPlanPath}`)
    .digest("hex") as ReviewScopeId;
}

export function computeArtifactDigest(bytes: Uint8Array): ArtifactDigest {
  return createHash("sha256").update(bytes).digest("hex") as ArtifactDigest;
}
