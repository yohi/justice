// tests/core/v2/declared-claim-extractor.test.ts
import { describe, expect, it } from "vitest";
import { extractDeclaredClaims } from "../../../src/core/v2/declared-claim-extractor";

describe("extractDeclaredClaims", () => {
  it("extracts declared claims for build lint and generic summaries", () => {
    expect(extractDeclaredClaims("test-source-1", "build passed ✅").map((c) => c.claimKind)).toContain("build");
    expect(extractDeclaredClaims("test-source-2", "lint failed ❌").map((c) => c.claimKind)).toContain("lint");
    expect(extractDeclaredClaims("test-source-3", "declared summary: all checks green").map((c) => c.claimKind)).toContain("generic");
  });

  it("derives a pass outcome from a passing test claim", () => {
    const claims = extractDeclaredClaims("source-pass", "all tests pass");
    const testClaim = claims.find((c) => c.claimKind === "test");
    expect(testClaim).toBeDefined();
    expect(testClaim?.outcome).toBe("pass");
    expect(testClaim?.evidenceId).toBe("source-pass-test");
  });

  it("derives a fail outcome from a failing claim", () => {
    const claims = extractDeclaredClaims("source-fail", "build failing");
    const buildClaim = claims.find((c) => c.claimKind === "build");
    expect(buildClaim).toBeDefined();
    expect(buildClaim?.outcome).toBe("fail");
    expect(buildClaim?.evidenceId).toBe("source-fail-build");
  });

  it("returns an empty list when no claim patterns match", () => {
    expect(extractDeclaredClaims("source-none", "just some prose with no signals")).toEqual([]);
  });
});
