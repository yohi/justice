import { describe, expect, it } from "vitest";
import { parseGateYaml } from "../../../src/core/v2/gate-yaml-parser";

describe("parseGateYaml", () => {
  it("parses a valid YAML configuration into gate rules", () => {
    const result = parseGateYaml(`
schemaVersion: 1
authority: human_approved
authorship: null
gates:
  - id: require-tests
    gateType: task
    trigger:
      on: task_complete
    check:
      type: evidence_outcome
      evidenceKind: test
      requireOutcome: pass
    onViolation: fail
    onMissingEvidence: warn
`);

    expect(result).toEqual([
      {
        id: "require-tests",
        gateType: "task",
        trigger: { on: "task_complete" },
        check: {
          type: "evidence_outcome",
          evidenceKind: "test",
          requireOutcome: "pass",
        },
        onViolation: "fail",
        onMissingEvidence: "warn",
        enabled: true,
      },
    ]);
  });

  it.each([
    ["schemaVersion", "schemaVersion: 2\nauthority: human_approved"],
    ["authority", "schemaVersion: 1\nauthority: generated"],
  ])("rejects an invalid %s", (_field, header) => {
    expect(() =>
      parseGateYaml(`${header}
gates: []
`),
    ).toThrow();
  });

  it("throws for malformed YAML", () => {
    expect(() => parseGateYaml("schemaVersion: [1\nauthority: human_approved")).toThrow();
  });

  it("parses multiple gates in declaration order", () => {
    const result = parseGateYaml(`
schemaVersion: 1
authority: human_approved
gates:
  - id: require-build
    gateType: task
    trigger:
      on: tool_observed
    check:
      type: evidence_present
      evidenceKind: build
    onViolation: warn
    onMissingEvidence: fail
  - id: review-items
    gateType: task
    trigger:
      on: task_complete
    check:
      type: review_open_items
      minimumSeverity: critical
    onViolation: fail
    onMissingEvidence: pass
    enabled: false
`);

    expect(result).toHaveLength(2);
    expect(result.map((gate) => gate.id)).toEqual(["require-build", "review-items"]);
    expect(result[1]?.check).toEqual({
      type: "review_open_items",
      minimumSeverity: "critical",
    });
    expect(result[1]?.enabled).toBe(false);
  });
});
