import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canonicalizeArtifactPath,
  computeArtifactDigest,
  computeReviewScopeId,
  isValidArtifactPath,
} from "../../src/core/review-gate-identity";

describe("canonicalizeArtifactPath", () => {
  it("normalizes repeated slashes in relative paths", () => {
    expect(canonicalizeArtifactPath("docs//design.md")).toBe("docs/design.md");
  });

  it("allows safe names containing double dots", () => {
    expect(canonicalizeArtifactPath("release..md")).toBe("release..md");
    expect(canonicalizeArtifactPath("docs/re..lease.md")).toBe("docs/re..lease.md");
  });

  it.each([
    "",
    "/etc/passwd",
    "../secret",
    ".",
    "docs/.",
    "docs/../secret",
    "docs\\design.md",
    "docs/./design.md",
    "./docs/design.md",
    "docs//",
    "docs/\0design.md",
  ])("rejects unsafe or non-normalized path %j", (path) => {
    expect(canonicalizeArtifactPath(path)).toBeNull();
  });

  it("validates paths using canonicalization", () => {
    expect(isValidArtifactPath("docs/design.md")).toBe(true);
    expect(isValidArtifactPath("docs//design.md")).toBe(true);
    expect(isValidArtifactPath("../design.md")).toBe(false);
  });
});

describe("computeReviewScopeId", () => {
  it("returns the deterministic SHA-256 of canonical, ordered paths", () => {
    const expected = createHash("sha256")
      .update("justice-review-scope-v1\0docs/design.md\0docs/plan.md")
      .digest("hex");

    expect(computeReviewScopeId("docs//design.md", "docs/plan.md")).toBe(expected);
  });

  it("throws for invalid artifact paths", () => {
    expect(() => computeReviewScopeId("../design.md", "docs/plan.md")).toThrow(
      "review_gate_invalid_artifact_path",
    );
    expect(() => computeReviewScopeId("docs/design.md", "/plan.md")).toThrow(
      "review_gate_invalid_artifact_path",
    );
  });

  it("distinguishes different and swapped path pairs", () => {
    const original = computeReviewScopeId("docs/design.md", "docs/plan.md");
    expect(computeReviewScopeId("spec/design.md", "docs/plan.md")).not.toBe(original);
    expect(computeReviewScopeId("docs/plan.md", "docs/design.md")).not.toBe(original);
  });
});

describe("computeArtifactDigest", () => {
  it("returns a lowercase SHA-256 digest for bytes", () => {
    const expected = createHash("sha256").update(new Uint8Array([0, 1, 255])).digest("hex");
    const digest = computeArtifactDigest(new Uint8Array([0, 1, 255]));

    expect(digest).toBe(expected);
    expect(digest).toMatch(/^[0-9a-f]{64}$/u);
  });
});
