import type { ReviewSnapshotArtifact } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parses the only complete-review snapshot contract trusted by the runtime.
 * The adapter additionally restricts promotion to the exact `code_review` tool.
 */
export function parseReviewSnapshotArtifact(value: unknown): ReviewSnapshotArtifact | undefined {
  if (!isRecord(value)) return undefined;
  if (
    value.authority !== "review_tool" ||
    value.schemaVersion !== 1 ||
    value.complete !== true
  ) {
    return undefined;
  }
  return { authority: "review_tool", schemaVersion: 1, complete: true };
}
