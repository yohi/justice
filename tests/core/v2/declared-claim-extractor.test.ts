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

  it("generates a test claim with fail outcome for test failure messages (Issue 1)", () => {
    for (const text of ["tests failed", "tests fail", "test failing"]) {
      const claims = extractDeclaredClaims("src-tf", text);
      const testClaim = claims.find((c) => c.claimKind === "test");
      expect(testClaim).toBeDefined();
      expect(testClaim?.outcome).toBe("fail");
    }
  });

  it("derives a pass outcome from past-tense 'passed' claims (Issue 2)", () => {
    const build = extractDeclaredClaims("src-bp", "build passed").find((c) => c.claimKind === "build");
    expect(build?.outcome).toBe("pass");
    const lint = extractDeclaredClaims("src-lp", "lint passed").find((c) => c.claimKind === "lint");
    expect(lint?.outcome).toBe("pass");
  });

  it("does not treat substrings like 'latest' as a test claim", () => {
    const claims = extractDeclaredClaims("src-sub", "the latest greatest release");
    expect(claims.find((c) => c.claimKind === "test")).toBeUndefined();
  });

  it("resolves mixed pass+fail text to fail (fail dominates, aligned with evidence-engine)", () => {
    const claims = extractDeclaredClaims("src-mix", "tests pass but build failed");
    expect(claims.length).toBeGreaterThan(0);
    for (const c of claims) {
      expect(c.outcome).toBe("fail");
    }
  });

  it("matches additional pass/fail inflections: passes, failures (Issue 4 review)", () => {
    const passClaim = extractDeclaredClaims("src-inf-p", "the test suite passes").find((c) => c.claimKind === "test");
    expect(passClaim?.outcome).toBe("pass");
    const failClaim = extractDeclaredClaims("src-inf-f", "build has 2 failures").find((c) => c.claimKind === "build");
    expect(failClaim?.outcome).toBe("fail");
  });
});
