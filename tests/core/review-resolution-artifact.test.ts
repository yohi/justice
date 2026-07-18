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

  it("accepts the maximum number of item keys", () => {
    const result = normalizeReviewResolutionArtifact({
      reviewScope: "task-6.3",
      itemKeys: Array.from({ length: 256 }, (_, index) => `major:item-${index}`),
      artifactRef: "docs/reviews/task-6.3.md",
    });

    expect(result?.itemKeys).toHaveLength(256);
  });

  it("rejects more than the maximum number of item keys", () => {
    const result = normalizeReviewResolutionArtifact({
      reviewScope: "task-6.3",
      itemKeys: Array.from({ length: 257 }, (_, index) => `major:item-${index}`),
      artifactRef: "docs/reviews/task-6.3.md",
    });

    expect(result).toBeUndefined();
  });
});
