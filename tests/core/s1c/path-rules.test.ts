import { describe, expect, test } from "vitest";
import { compareCandidatePaths, inspectChangeSet, validateAllowedPaths } from "../../../src/core/s1c/path-rules.js";

describe("S1-c path rules", () => {
  test("exactAndDirectoryPrefixAreCaseSensitive", () => {
    const allowlist = ["src/core/s1c/**", "docs/plan.md"];
    expect(validateAllowedPaths(allowlist)).toEqual(allowlist);
    expect(compareCandidatePaths(allowlist, ["src/core/s1c/rules.ts", "docs/plan.md"]).comparison)
      .toBe("WITHIN_CANDIDATE_SCOPE");
    expect(compareCandidatePaths(allowlist, ["src/core/s1b/rules.ts", "src/core/s1c", "SRC/core/s1c/rules.ts"])).toEqual({
      comparison: "OUTSIDE_CANDIDATE_SCOPE",
      outsidePaths: ["SRC/core/s1c/rules.ts", "src/core/s1b/rules.ts", "src/core/s1c"],
    });
  });

  test("renameChecksBothEndpoints", () => {
    const result = inspectChangeSet({ availability: "PRESENT", changes: [{ kind: "RENAME", oldPath: "src/core/s1b/x.ts", newPath: "src/core/s1c/x.ts" }] });
    expect(result).toEqual({ state: "PRESENT", touchedPaths: ["src/core/s1b/x.ts", "src/core/s1c/x.ts"] });
    expect(compareCandidatePaths(["src/core/s1c/**"], result.state === "PRESENT" ? result.touchedPaths : []).outsidePaths)
      .toEqual(["src/core/s1b/x.ts"]);
  });

  test("emptyAllowlistDiffersFromUnavailablePolicy", () => {
    expect(compareCandidatePaths([], ["src/core/s1c/x.ts"]).comparison).toBe("OUTSIDE_CANDIDATE_SCOPE");
    expect(compareCandidatePaths([], []).comparison).toBe("WITHIN_CANDIDATE_SCOPE");
    expect(inspectChangeSet({ availability: "UNAVAILABLE" })).toEqual({ state: "UNAVAILABLE" });
  });

  test("changeSetRejectsWholeCollection", () => {
    const valid = { kind: "ADD", path: "src/core/s1c/x.ts" };
    for (const invalid of [
      { kind: "ADD", path: "../secret" },
      { kind: "ADD", path: "/etc/passwd" },
      { kind: "ADD", path: "src/x", unexpected: true },
    ]) {
      expect(inspectChangeSet({ availability: "PRESENT", changes: [valid, invalid] })).toEqual({ state: "INVALID" });
    }
    const sparse = new Array(1);
    expect(inspectChangeSet({ availability: "PRESENT", changes: sparse })).toEqual({ state: "INVALID" });
  });

  test("limitsAndPathSafety", () => {
    expect(inspectChangeSet({ availability: "PRESENT", changes: Array.from({ length: 129 }, (_, i) => ({ kind: "ADD", path: `file${i}` })) })).toEqual({ state: "INVALID" });
    expect(validateAllowedPaths(Array.from({ length: 129 }, (_, i) => `file${i}`))).toBeNull();
    for (const path of ["a".repeat(1025), ".", "a/.", "a/..", "a//b", "a\\b", "/a", "https://x", "C:/x", "a/*", "a/**/b"]) {
      expect(validateAllowedPaths([path]), path).toBeNull();
      expect(inspectChangeSet({ availability: "PRESENT", changes: [{ kind: "ADD", path }] }), path).toEqual({ state: "INVALID" });
    }
  });

  test("permutationAndDuplicatePaths", () => {
    const left = compareCandidatePaths([], ["z.ts", "a.ts", "z.ts"]);
    const right = compareCandidatePaths([], ["z.ts", "z.ts", "a.ts"]);
    expect(left).toEqual(right);
    expect(left.outsidePaths).toEqual(["a.ts", "z.ts"]);
    expect(Object.isFrozen(left.outsidePaths)).toBe(true);
  });
});
