import { describe, expect, it } from "vitest";
import { DEFAULT_GATES } from "../../../src/core/v2/default-gates";

describe("DEFAULT_GATES", () => {
  it("defines exactly three built-in gates", () => {
    expect(DEFAULT_GATES).toHaveLength(3);
  });

  it("exposes the expected gate ids in declaration order", () => {
    expect(DEFAULT_GATES.map((gate) => gate.id)).toEqual([
      "required-tests",
      "build-green",
      "review-clean",
    ]);
  });

  it("enables every default gate", () => {
    for (const gate of DEFAULT_GATES) {
      expect(gate.enabled).toBe(true);
    }
  });

  it("uses warn for both onViolation and onMissingEvidence on every gate", () => {
    for (const gate of DEFAULT_GATES) {
      expect(gate.onViolation).toBe("warn");
      expect(gate.onMissingEvidence).toBe("warn");
    }
  });

  it("matches the exact field values from the Task 5.3 brief", () => {
    expect(DEFAULT_GATES).toEqual([
      {
        id: "required-tests",
        description: "タスク完了前にテストが pass していること",
        gateType: "task",
        trigger: { on: "task_complete" },
        check: { type: "evidence_outcome", evidenceKind: "test", requireOutcome: "pass" },
        onViolation: "warn",
        onMissingEvidence: "warn",
        enabled: true,
      },
      {
        id: "build-green",
        description: "タスク完了前にビルドが pass していること",
        gateType: "task",
        trigger: { on: "task_complete" },
        check: { type: "evidence_outcome", evidenceKind: "build", requireOutcome: "pass" },
        onViolation: "warn",
        onMissingEvidence: "warn",
        enabled: true,
      },
      {
        id: "review-clean",
        description: "未解決レビュー指摘（minimumSeverity 以上）が無いこと",
        gateType: "task",
        trigger: { on: "task_complete" },
        check: { type: "review_open_items", minimumSeverity: "major" },
        onViolation: "warn",
        onMissingEvidence: "warn",
        enabled: true,
      },
    ]);
  });
});
