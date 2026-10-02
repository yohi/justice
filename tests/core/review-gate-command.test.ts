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
    expect(isJusticeReviewGateCommand("justice-review")).toBe(false);
    expect(isJusticeReviewGateCommand("justice-start")).toBe(false);
  });
});

describe("parseJusticeReviewGateCommandArguments", () => {
  it("parses Design and Plan paths", () => {
    expect(
      parseJusticeReviewGateCommandArguments(
        "--design docs/specs/design.md --plan docs/plans/implementation-plan.md",
      ),
    ).toEqual({
      source: "command",
      designPath: "docs/specs/design.md",
      planPath: "docs/plans/implementation-plan.md",
      retryBudget: 0,
    });
  });

  it.each([0, 1, 10])("parses --retry %i as the additional cycle budget", (retryBudget) => {
    expect(
      parseJusticeReviewGateCommandArguments(
        `--design docs/specs/design.md --plan docs/plans/implementation-plan.md --retry ${retryBudget}`,
      ),
    ).toEqual({
      source: "command",
      designPath: "docs/specs/design.md",
      planPath: "docs/plans/implementation-plan.md",
      retryBudget,
    });
  });

  it("accepts OpenCode @path file references", () => {
    expect(
      parseJusticeReviewGateCommandArguments(
        "--design @docs/superpowers/specs/2026-09-28-idle-closed-child-session-reopen-design.md --plan @docs/superpowers/plans/2026-09-28-idle-closed-child-session-reopen.md",
      ),
    ).toEqual({
      source: "command",
      designPath:
        "docs/superpowers/specs/2026-09-28-idle-closed-child-session-reopen-design.md",
      planPath:
        "docs/superpowers/plans/2026-09-28-idle-closed-child-session-reopen.md",
      retryBudget: 0,
    });
  });

  it.each([
    "",
    "--design docs/design.md",
    "--plan docs/plan.md",
    "--design",
    "--plan",
    "--design --plan docs/plan.md",
    "--design docs/design.md --plan",
    "--design docs/a.md --design docs/b.md --plan docs/p.md",
    "--design docs/a.md --plan docs/a.md --plan docs/b.md",
    "--design docs/a.md --plan docs/p.md extra",
    "--design=docs/a.md --plan docs/p.md",
    "--design docs/a.md --plan=docs/p.md",
    "--unknown docs/a.md --design docs/d.md --plan docs/p.md",
    "--design @/etc/passwd --plan docs/p.md",
    "--design @../secret.md --plan docs/p.md",
    "--design @@docs/d.md --plan docs/p.md",
    "--design docs/d.md --plan @../secret.md",
    "--design docs/d.md --plan docs/p.md --retry",
    "--design docs/d.md --plan docs/p.md --retry -1",
    "--design docs/d.md --plan docs/p.md --retry 1.5",
    "--design docs/d.md --plan docs/p.md --retry nope",
    "--design docs/d.md --plan docs/p.md --retry 11",
    "--design docs/d.md --plan docs/p.md --retry 9007199254740992",
    "--design docs/d.md --plan docs/p.md --retry 1 --retry 2",
  ])("rejects malformed or unsafe arguments: %s", (argumentsString) => {
    expect(parseJusticeReviewGateCommandArguments(argumentsString)).toBeNull();
  });
});
