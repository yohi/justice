import { describe, expect, it } from "vitest";
import {
  isJusticeReviewGateCommand,
  parseJusticeReviewGateCommandArguments,
} from "../../src/core/review-gate-command";

describe("isJusticeReviewGateCommand", () => {
  it("accepts the command with or without a leading slash", () => {
    expect(isJusticeReviewGateCommand("/justice-review-gate")).toBe(true);
    expect(isJusticeReviewGateCommand("justice-review-gate")).toBe(true);
  });

  it("rejects unrelated commands", () => {
    expect(isJusticeReviewGateCommand("justice-start")).toBe(false);
  });
});

describe("parseJusticeReviewGateCommandArguments", () => {
  it("parses design and plan using OpenCode @path references", () => {
    expect(
      parseJusticeReviewGateCommandArguments(
        "--design @docs/superpowers/specs/feature-design.md --plan @docs/superpowers/plans/feature-plan.md",
      ),
    ).toEqual({
      source: "command",
      designPath: "docs/superpowers/specs/feature-design.md",
      planPath: "docs/superpowers/plans/feature-plan.md",
    });
  });

  it("allows a plan-only review gate", () => {
    expect(
      parseJusticeReviewGateCommandArguments("--plan docs/superpowers/plans/feature-plan.md"),
    ).toEqual({
      source: "command",
      designPath: null,
      planPath: "docs/superpowers/plans/feature-plan.md",
    });
  });

  it.each([
    "",
    "--design docs/design.md",
    "--plan",
    "--plan /etc/passwd",
    "--plan @../secret.md",
    "--plan @@docs/plan.md",
    "--plan docs/a.md --plan docs/b.md",
    "--design docs/a.md --design docs/b.md --plan docs/p.md",
    "--plan docs/p.md extra",
    "--unknown docs/p.md",
  ])("rejects malformed or unsafe arguments: %s", (value) => {
    expect(parseJusticeReviewGateCommandArguments(value)).toBeNull();
  });
});
