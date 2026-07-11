import { describe, expect, it } from "vitest";
import { extractTaskSummaryClaims } from "../../../src/core/v2/task-summary-claim-extractor";

describe("extractTaskSummaryClaims", () => {
  it("preserves declared claims extracted from a task summary", () => {
    const claims = extractTaskSummaryClaims("call-1", "Tests passed and the build passed");

    expect(claims).toEqual([
      { evidenceId: "call-1-test", claimKind: "test", outcome: "pass" },
      { evidenceId: "call-1-build", claimKind: "build", outcome: "pass" },
    ]);
  });

  it("returns no claims when the task summary declares no result", () => {
    expect(extractTaskSummaryClaims("call-2", "Implementation details only")).toEqual([]);
  });
});
