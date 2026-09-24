import { describe, expect, it } from "vitest";
import {
  ALL_SP_CATEGORIES,
  DOCTOR_CONTROLLER_COMMAND_EXPECTATIONS,
  checkSpCategoryPresence,
  formatControllerRemediationLines,
} from "../../src/core/doctor-categories";
import { projectDoctorEffectiveConfig } from "../../src/core/doctor-config";
import { scanConfigContent } from "../../src/core/doctor-config";
import {
  PINNED_COMMAND_WORKFLOW_MAP,
  WORKFLOW_DESIRED_CONTROLLERS,
} from "../../src/core/workflow-router";

describe("checkSpCategoryPresence()", () => {
  it("reports exactly the missing required categories from a resolved host snapshot", () => {
    const projected = projectDoctorEffectiveConfig({
      category: { "sp-mechanical": {} },
      command: {},
    });
    expect(projected.kind).toBe("available");
    if (projected.kind !== "available") throw new Error("expected available");
    expect(checkSpCategoryPresence(projected.view.effectiveCategoryNames)).toEqual({
      ok: false,
      missing: [
        "sp-implementation",
        "sp-integration",
        "sp-review",
        "sp-final-review",
        "sp-deep",
        "sp-architecture",
      ],
    });
  });

  it("accepts all seven categories from a resolved host snapshot", () => {
    const projected = projectDoctorEffectiveConfig({
      category: Object.fromEntries(ALL_SP_CATEGORIES.map((name) => [name, {}])),
      command: {},
    });
    expect(projected).toMatchObject({ kind: "available" });
  });

  it("does not promote local source scans to effective-config authority", () => {
    const local = scanConfigContent(
      "project",
      '{ "category": { "sp-review": {} }, "command": { "justice-implement-brainstorming": { "agent": "sisyphus" } } }',
    );
    expect(local).toBeDefined();
    // There is intentionally no API from SourceScanResult -> DoctorEffectiveConfigView.
  });

  it("reports a missing category only once when the input repeats it", () => {
    expect(checkSpCategoryPresence(["sp-mechanical", "sp-mechanical"])).toEqual({
      ok: false,
      missing: [
        "sp-implementation",
        "sp-integration",
        "sp-review",
        "sp-final-review",
        "sp-deep",
        "sp-architecture",
      ],
    });
  });
});

describe("DOCTOR_CONTROLLER_COMMAND_EXPECTATIONS", () => {
  it("exposes exactly the four pinned commands with their desired controllers in order", () => {
    expect(DOCTOR_CONTROLLER_COMMAND_EXPECTATIONS).toEqual([
      { pinnedCommand: "justice-implement-brainstorming", desiredController: "sisyphus" },
      { pinnedCommand: "justice-implement-writing-plans", desiredController: "sisyphus" },
      {
        pinnedCommand: "justice-implement-subagent-driven-development",
        desiredController: "atlas",
      },
      { pinnedCommand: "justice-implement-executing-plans", desiredController: "sisyphus" },
    ]);
  });

  it("is derived from the controller-routing SSOT maps without local duplication", () => {
    expect(DOCTOR_CONTROLLER_COMMAND_EXPECTATIONS.map((e) => e.pinnedCommand)).toEqual([
      ...PINNED_COMMAND_WORKFLOW_MAP.keys(),
    ]);
    for (const expectation of DOCTOR_CONTROLLER_COMMAND_EXPECTATIONS) {
      const workflow = PINNED_COMMAND_WORKFLOW_MAP.get(expectation.pinnedCommand);
      if (workflow === undefined) throw new Error("missing workflow mapping");
      expect(WORKFLOW_DESIRED_CONTROLLERS.get(workflow)).toBe(expectation.desiredController);
    }
  });
});

describe("formatControllerRemediationLines()", () => {
  it("emits the exact four-command template lines with only agent assignments", () => {
    expect(formatControllerRemediationLines()).toEqual([
      `    "justice-implement-brainstorming": { "agent": "sisyphus" }`,
      `    "justice-implement-writing-plans": { "agent": "sisyphus" }`,
      `    "justice-implement-subagent-driven-development": { "agent": "atlas" }`,
      `    "justice-implement-executing-plans": { "agent": "sisyphus" }`,
    ]);
  });

  it("never carries command bodies, provider options, or credentials", () => {
    const rendered = JSON.stringify(formatControllerRemediationLines());
    expect(rendered).not.toContain("template");
    expect(rendered).not.toContain("model");
    expect(rendered).not.toContain("apiKey");
  });
});
