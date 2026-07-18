import { describe, expect, it } from "vitest";
import { type ReviewItem } from "../../src/core/review-rejection-detector";
import { hashString } from "../../src/core/v2/hash";
import { classifySeverity, deriveItemKey } from "../../src/core/v2/review-severity";

describe("classifySeverity", () => {
  it.each([
    ["security issue", "critical"],
    ["vulnerability found", "critical"],
    ["data loss is possible", "critical"],
    ["破壊的な変更", "critical"],
    ["重大な問題", "critical"],
    ["must fix before merge", "major"],
    ["required change", "major"],
    ["bug in the parser", "major"],
    ["regression detected", "major"],
    ["要修正です", "major"],
    ["不具合があります", "major"],
    ["nit: rename this variable", "minor"],
    ["suggestion for readability", "minor"],
    ["optional cleanup", "minor"],
    ["style only", "minor"],
    ["軽微な指摘", "minor"],
    ["改善の提案", "minor"],
    ["general review feedback", "minor"],
  ] as const)("classifies %s as %s", (summary, expected) => {
    expect(classifySeverity(summary)).toBe(expected);
  });

  it("uses critical severity when multiple severity vocabularies match", () => {
    expect(classifySeverity("security bug: must fix")).toBe("critical");
  });

  it("uses major severity when major and minor vocabularies match", () => {
    expect(classifySeverity("must fix this style issue")).toBe("major");
  });
});

describe("deriveItemKey", () => {
  it("normalizes a repository-relative location before hashing it", () => {
    const location = "./src/core/review-rejection-detector.ts";
    const locationHash = hashString("src/core/review-rejection-detector.ts")
      .replace(/^sha256:/u, "")
      .slice(0, 12);

    expect(deriveItemKey("major", "rule-1", location, "sha256:evidence")).toBe(
      `major:rule-1:${locationHash}:sha256:evidence`,
    );
  });

  it("uses the same key for equivalent absolute and relative locations", () => {
    const workspaceRoot = "/workspace/project";
    const relativeLocation = "src/core/review-rejection-detector.ts";
    const absoluteLocation = `${workspaceRoot}/${relativeLocation}`;

    expect(
      deriveItemKey("critical", "rule-1", absoluteLocation, "evidence-hash", workspaceRoot),
    ).toBe(deriveItemKey("critical", "rule-1", relativeLocation, "evidence-hash", workspaceRoot));
  });

  it("does not implicitly strip the current working directory", () => {
    const relativeLocation = "src/core/review-rejection-detector.ts";
    const absoluteLocation = `${process.cwd()}/${relativeLocation}`;

    expect(deriveItemKey("critical", "rule-1", absoluteLocation, "evidence-hash")).not.toBe(
      deriveItemKey("critical", "rule-1", relativeLocation, "evidence-hash"),
    );
  });

  it("normalizes Windows separators before hashing a location", () => {
    const location = "src\\core\\review-rejection-detector.ts";
    const locationHash = hashString("src/core/review-rejection-detector.ts")
      .replace(/^sha256:/u, "")
      .slice(0, 12);

    expect(deriveItemKey("minor", "rule-1", location, "evidence-hash")).toBe(
      `minor:rule-1:${locationHash}:evidence-hash`,
    );
  });

  it("uses exactly twelve hexadecimal characters for the location hash segment", () => {
    const itemKey = deriveItemKey("major", "rule-1", "src/example.ts", "evidence-hash");
    const locationHash = itemKey.split(":")[2];

    expect(locationHash).toMatch(/^[0-9a-f]{12}$/u);
  });
});

describe("ReviewItem", () => {
  it("describes an immutable review item shape", () => {
    const item: ReviewItem = {
      itemKey: "major:rule-1:location:evidence",
      severity: "major",
      summary: "Must fix the parser bug",
      status: "open",
      evidenceId: "major:rule-1:location:evidence",
      location: "src/parser.ts:10",
    };

    expect(item.status).toBe("open");
  });
});
