import { describe, expect, it } from "bun:test";
import {
  isJusticeImplementCommand,
  parseJusticeImplementCommandArguments,
} from "../../src/core/implement-command";

describe("isJusticeImplementCommand", () => {
  it("returns true for justice-implement with leading slash", () => {
    expect(isJusticeImplementCommand("/justice-implement")).toBe(true);
  });

  it("returns true for justice-implement without leading slash", () => {
    expect(isJusticeImplementCommand("justice-implement")).toBe(true);
  });

  it("returns false for unrelated command", () => {
    expect(isJusticeImplementCommand("justice-start")).toBe(false);
  });
});

describe("parseJusticeImplementCommandArguments", () => {
  it("parses --plan and --approved", () => {
    const result = parseJusticeImplementCommandArguments(
      "--plan docs/plans/feature.md --approved",
    );
    expect(result).toEqual({
      source: "command",
      planPath: "docs/plans/feature.md",
      approved: true,
    });
  });

  it("rejects missing --plan", () => {
    expect(parseJusticeImplementCommandArguments("--approved")).toBeNull();
  });

  it("rejects missing value for --plan", () => {
    expect(parseJusticeImplementCommandArguments("--plan")).toBeNull();
  });

  it("rejects absolute paths", () => {
    expect(parseJusticeImplementCommandArguments("--plan /etc/passwd")).toBeNull();
  });

  it("rejects path traversal", () => {
    expect(parseJusticeImplementCommandArguments("--plan ../other.md")).toBeNull();
  });
});
