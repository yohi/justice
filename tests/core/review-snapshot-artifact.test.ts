import { describe, expect, it } from "vitest";
import { parseReviewSnapshotArtifact } from "../../src/core/review-snapshot-artifact";

describe("parseReviewSnapshotArtifact", () => {
  it("returns undefined for non-object values", () => {
    expect(parseReviewSnapshotArtifact(null)).toBeUndefined();
    expect(parseReviewSnapshotArtifact(undefined)).toBeUndefined();
    expect(parseReviewSnapshotArtifact("string")).toBeUndefined();
    expect(parseReviewSnapshotArtifact(123)).toBeUndefined();
    expect(parseReviewSnapshotArtifact([])).toBeUndefined();
  });

  it("returns undefined when authority is not 'review_tool'", () => {
    expect(
      parseReviewSnapshotArtifact({
        authority: "human_approved",
        schemaVersion: 1,
        complete: true,
      }),
    ).toBeUndefined();
  });

  it("returns undefined when schemaVersion is not 1", () => {
    expect(
      parseReviewSnapshotArtifact({
        authority: "review_tool",
        schemaVersion: 2,
        complete: true,
      }),
    ).toBeUndefined();
  });

  it("returns undefined when complete is not true", () => {
    expect(
      parseReviewSnapshotArtifact({
        authority: "review_tool",
        schemaVersion: 1,
        complete: false,
      }),
    ).toBeUndefined();
  });

  it("returns the artifact for valid input", () => {
    const result = parseReviewSnapshotArtifact({
      authority: "review_tool",
      schemaVersion: 1,
      complete: true,
    });
    expect(result).toEqual({
      authority: "review_tool",
      schemaVersion: 1,
      complete: true,
    });
  });

  it("returns undefined for empty object", () => {
    expect(parseReviewSnapshotArtifact({})).toBeUndefined();
  });

  it("ignores extra properties", () => {
    const result = parseReviewSnapshotArtifact({
      authority: "review_tool",
      schemaVersion: 1,
      complete: true,
      extra: "value",
    });
    expect(result).toEqual({
      authority: "review_tool",
      schemaVersion: 1,
      complete: true,
    });
  });
});
