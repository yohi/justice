import { describe, expect, it } from "vitest";
import {
  RETRY_DEPRECATED_WARNING,
  isJusticeReviewGateCommand,
  parseJusticeReviewGateCommandArguments,
  reviewGateCommandWarnings,
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
    });
  });

  it.each([0, 1, 10])(
    "parses --retry %i as deprecated RTY1 parser compatibility (no-op)",
    (legacyRetryOption) => {
      expect(
        parseJusticeReviewGateCommandArguments(
          `--design docs/specs/design.md --plan docs/plans/implementation-plan.md --retry ${legacyRetryOption}`,
        ),
      ).toEqual({
        source: "command",
        designPath: "docs/specs/design.md",
        planPath: "docs/plans/implementation-plan.md",
        legacyRetryOption,
        retryDeprecatedWarning: RETRY_DEPRECATED_WARNING,
      });
    },
  );

  it("does not synthesize a legacy retry option when --retry is absent", () => {
    const parsed = parseJusticeReviewGateCommandArguments(
      "--design docs/specs/design.md --plan docs/plans/implementation-plan.md",
    );
    expect(parsed).not.toHaveProperty("legacyRetryOption");
    expect(parsed).not.toHaveProperty("retryBudget");
    expect(parsed).not.toHaveProperty("retryDeprecatedWarning");
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

describe("parseJusticeReviewGateCommandArguments --requirements", () => {
  it("parses an optional Requirements path", () => {
    expect(
      parseJusticeReviewGateCommandArguments(
        "--design docs/specs/design.md --plan docs/plans/implementation-plan.md --requirements docs/requirements/feature.md",
      ),
    ).toEqual({
      source: "command",
      designPath: "docs/specs/design.md",
      planPath: "docs/plans/implementation-plan.md",
      requirementsPath: "docs/requirements/feature.md",
    });
  });

  it("accepts OpenCode @path file references for Requirements", () => {
    expect(
      parseJusticeReviewGateCommandArguments(
        "--design docs/specs/design.md --plan docs/plans/implementation-plan.md --requirements @docs/requirements/feature.md",
      ),
    ).toEqual({
      source: "command",
      designPath: "docs/specs/design.md",
      planPath: "docs/plans/implementation-plan.md",
      requirementsPath: "docs/requirements/feature.md",
    });
  });

  it("keeps flag order independence for --requirements", () => {
    expect(
      parseJusticeReviewGateCommandArguments(
        "--requirements docs/requirements/feature.md --plan docs/plans/implementation-plan.md --design docs/specs/design.md",
      ),
    ).toEqual({
      source: "command",
      designPath: "docs/specs/design.md",
      planPath: "docs/plans/implementation-plan.md",
      requirementsPath: "docs/requirements/feature.md",
    });
  });

  it("omits requirementsPath when the flag is absent", () => {
    const parsed = parseJusticeReviewGateCommandArguments(
      "--design docs/specs/design.md --plan docs/plans/implementation-plan.md",
    );
    expect(parsed).not.toHaveProperty("requirementsPath");
  });

  it.each([
    "--design docs/d.md --plan docs/p.md --requirements",
    "--design docs/d.md --plan docs/p.md --requirements docs/r.md --requirements docs/s.md",
    "--design docs/d.md --plan docs/p.md --requirements=docs/r.md",
    "--design docs/d.md --plan docs/p.md --requirements ../r.md",
    "--design docs/d.md --plan docs/p.md --requirements /etc/r.md",
    "--design docs/d.md --plan docs/p.md --requirements docs\\r.md",
    "--design docs/d.md --plan docs/p.md --requirements @@docs/r.md",
    "--design docs/d.md --plan docs/p.md --requirements @../r.md",
  ])("rejects malformed or unsafe --requirements arguments: %s", (argumentsString) => {
    expect(parseJusticeReviewGateCommandArguments(argumentsString)).toBeNull();
  });
});

describe("deprecated --retry warning diagnostics (RTY1)", () => {
  it.each([0, 5, 10])(
    "exposes the observable RETRY_DEPRECATED warning for --retry %i on the command response",
    (legacyRetryOption) => {
      const parsed = parseJusticeReviewGateCommandArguments(
        `--design docs/specs/design.md --plan docs/plans/implementation-plan.md --retry ${legacyRetryOption}`,
      );
      expect(parsed).toEqual({
        source: "command",
        designPath: "docs/specs/design.md",
        planPath: "docs/plans/implementation-plan.md",
        legacyRetryOption,
        retryDeprecatedWarning: RETRY_DEPRECATED_WARNING,
      });
      expect(reviewGateCommandWarnings(parsed)).toEqual([RETRY_DEPRECATED_WARNING]);
      expect(parsed?.retryDeprecatedWarning).toBe(RETRY_DEPRECATED_WARNING);
      expect(RETRY_DEPRECATED_WARNING).toContain("RETRY_DEPRECATED");
    },
  );

  it("emits no warning when --retry is absent", () => {
    const parsed = parseJusticeReviewGateCommandArguments(
      "--design docs/specs/design.md --plan docs/plans/implementation-plan.md",
    );
    expect(reviewGateCommandWarnings(parsed)).toEqual([]);
    expect(parsed).not.toHaveProperty("retryDeprecatedWarning");
  });

  it("keeps the legacy retry option inert at the command boundary", () => {
    const withRetry = parseJusticeReviewGateCommandArguments(
      "--design docs/specs/design.md --plan docs/plans/implementation-plan.md --retry 5",
    );
    const withoutRetry = parseJusticeReviewGateCommandArguments(
      "--design docs/specs/design.md --plan docs/plans/implementation-plan.md",
    );

    // The artifact selection is identical; the only delta is the inert
    // legacyRetryOption value. No budget/epoch/admission authority fields
    // exist on the request for the legacy option to feed.
    expect(withRetry?.designPath).toBe(withoutRetry?.designPath);
    expect(withRetry?.planPath).toBe(withoutRetry?.planPath);
    expect(withRetry).not.toHaveProperty("retryBudget");
    expect(withRetry).not.toHaveProperty("designRetryBudget");
    expect(withRetry).not.toHaveProperty("planRetryBudget");
    expect(withRetry).not.toHaveProperty("epoch");
    expect(Object.keys(withRetry ?? {}).sort()).toEqual([
      "designPath",
      "legacyRetryOption",
      "planPath",
      "retryDeprecatedWarning",
      "source",
    ]);
    expect(Object.keys(withoutRetry ?? {}).sort()).toEqual([
      "designPath",
      "planPath",
      "source",
    ]);
  });
});
