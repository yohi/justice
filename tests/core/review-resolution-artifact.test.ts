import { describe, expect, it } from "vitest";
import { normalizeReviewResolutionArtifact } from "../../src/core/review-resolution-artifact";

describe("normalizeReviewResolutionArtifact", () => {
  it("rejects duplicate item keys after normalization", () => {
    // Given
    const artifact = {
      reviewScope: "task-6.3",
      itemKeys: ["major:parser", " major:parser "],
      artifactRef: "docs/reviews/task-6.3.md",
    };

    // When
    const result = normalizeReviewResolutionArtifact(artifact);

    // Then
    expect(result).toBeUndefined();
  });
});
