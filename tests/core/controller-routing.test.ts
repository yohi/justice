import { describe, expect, it } from "vitest";
import {
  PINNED_COMMAND_WORKFLOW_MAP,
  assessControllerConfiguration,
  resolvePinnedCommandForWorkflow,
  resolvePinnedCommandWorkflow,
} from "../../src/core/controller-routing";
import { createControllerRoutingDecision } from "../../src/core/routing-decision";
import { WorkflowRouter } from "../../src/core/workflow-router";
import type {
  ControllerAgent,
  ControllerPinnedCommand,
  ControllerWorkflow,
  DoctorEffectiveCommandDefinition,
} from "../../src/core/types";

const CASES: readonly [
  ControllerWorkflow,
  ControllerAgent,
  ControllerPinnedCommand,
][] = [
  ["brainstorming", "sisyphus", "justice-implement-brainstorming"],
  ["writing-plans", "sisyphus", "justice-implement-writing-plans"],
  [
    "subagent-driven-development",
    "atlas",
    "justice-implement-subagent-driven-development",
  ],
  ["executing-plans", "sisyphus", "justice-implement-executing-plans"],
];

function decision(
  workflow: ControllerWorkflow,
  controller: ControllerAgent,
): ReturnType<typeof createControllerRoutingDecision> {
  return createControllerRoutingDecision(workflow, controller, "workflow_rule");
}

function assess(
  workflow: ControllerWorkflow,
  controller: ControllerAgent,
  pinnedCommand: ControllerPinnedCommand,
  effectiveDefinition: DoctorEffectiveCommandDefinition | undefined,
  effectiveConfigAvailable = true,
): ReturnType<typeof assessControllerConfiguration> {
  return assessControllerConfiguration({
    decision: decision(workflow, controller),
    pinnedCommand,
    effectiveDefinition,
    effectiveConfigAvailable,
  });
}

describe("controller configuration assurance", () => {
  it.each(CASES)(
    "maps %s to desired controller %s and exact pinned command %s",
    (workflow, controller, pinnedCommand) => {
      const router = new WorkflowRouter();
      expect(router.resolveController(workflow)).toBe(controller);
      expect(resolvePinnedCommandForWorkflow(workflow)).toBe(pinnedCommand);
      expect(resolvePinnedCommandWorkflow(pinnedCommand)).toBe(workflow);
      expect(PINNED_COMMAND_WORKFLOW_MAP.get(pinnedCommand)).toBe(workflow);
    },
  );

  it.each([
    "/justice-implement-brainstorming",
    "prefix justice-implement-brainstorming",
    "justice-implement-brainstorming-extra",
    "Justice-Implement-Brainstorming",
    "__proto__",
  ])("rejects non-exact pinned command %s", (command) => {
    expect(resolvePinnedCommandWorkflow(command)).toBeUndefined();
  });

  it("rejects a controller decision that violates the canonical workflow mapping", () => {
    expect(() =>
      assessControllerConfiguration({
        decision: {
          kind: "controller",
          workflow: "subagent-driven-development",
          controller: "sisyphus",
          reason: "workflow_rule",
        },
        pinnedCommand: "justice-implement-subagent-driven-development",
        effectiveDefinition: { kind: "valid", agent: "sisyphus" },
        effectiveConfigAvailable: true,
      }),
    ).toThrow("Invalid controller decision");
  });

  it("rejects a pinned command that does not belong to the decision workflow", () => {
    expect(() =>
      assessControllerConfiguration({
        decision: decision("brainstorming", "sisyphus"),
        pinnedCommand: "justice-implement-executing-plans",
        effectiveDefinition: { kind: "valid", agent: "sisyphus" },
        effectiveConfigAvailable: true,
      }),
    ).toThrow("Invalid pinned command");
  });

  it("reports configured only for exact desired-controller equality", () => {
    expect(
      assess("brainstorming", "sisyphus", "justice-implement-brainstorming", {
        kind: "valid",
        agent: "sisyphus",
      }),
    ).toEqual({
      workflow: "brainstorming",
      desiredController: "sisyphus",
      pinnedCommand: "justice-implement-brainstorming",
      configuredController: "sisyphus",
      status: "configured",
    });
  });

  it("reports missing when the exact command is absent", () => {
    expect(
      assess("brainstorming", "sisyphus", "justice-implement-brainstorming", undefined),
    ).toEqual({
      workflow: "brainstorming",
      desiredController: "sisyphus",
      pinnedCommand: "justice-implement-brainstorming",
      status: "missing",
      reason: "command_missing",
    });
  });

  it("reports an invalid normalized definition as misconfigured", () => {
    expect(
      assess("brainstorming", "sisyphus", "justice-implement-brainstorming", {
        kind: "invalid",
      }),
    ).toMatchObject({ status: "misconfigured", reason: "invalid_command_definition" });
  });

  it("reports an absent agent as misconfigured", () => {
    expect(
      assess("brainstorming", "sisyphus", "justice-implement-brainstorming", {
        kind: "valid",
      }),
    ).toMatchObject({ status: "misconfigured", reason: "agent_missing" });
  });

  it("reports an unrecognized agent as diagnostic-safe misconfigured", () => {
    expect(
      assess("brainstorming", "sisyphus", "justice-implement-brainstorming", {
        kind: "valid",
        agent: "custom-controller",
      }),
    ).toEqual({
      workflow: "brainstorming",
      desiredController: "sisyphus",
      pinnedCommand: "justice-implement-brainstorming",
      configuredController: "custom-controller",
      status: "misconfigured",
      reason: "agent_invalid",
    });
  });

  it("reports a recognized but different agent as misconfigured", () => {
    expect(
      assess("brainstorming", "sisyphus", "justice-implement-brainstorming", {
        kind: "valid",
        agent: "atlas",
      }),
    ).toMatchObject({
      configuredController: "atlas",
      status: "misconfigured",
      reason: "agent_mismatch",
    });
  });

  it("gives unsupported precedence before canonical input validation", () => {
    expect(
      assessControllerConfiguration({
        decision: {
          kind: "controller",
          workflow: "subagent-driven-development",
          controller: "sisyphus",
          reason: "workflow_rule",
        },
        pinnedCommand: "justice-implement-brainstorming",
        effectiveDefinition: { kind: "valid", agent: "sisyphus" },
        effectiveConfigAvailable: false,
      }),
    ).toEqual({
      workflow: "subagent-driven-development",
      desiredController: "sisyphus",
      pinnedCommand: "justice-implement-brainstorming",
      status: "unsupported",
      reason: "effective_config_unsupported",
    });
  });

  it("gives unsupported precedence over an otherwise valid definition", () => {
    expect(
      assess(
        "brainstorming",
        "sisyphus",
        "justice-implement-brainstorming",
        { kind: "valid", agent: "sisyphus" },
        false,
      ),
    ).toEqual({
      workflow: "brainstorming",
      desiredController: "sisyphus",
      pinnedCommand: "justice-implement-brainstorming",
      status: "unsupported",
      reason: "effective_config_unsupported",
    });
  });

  it("contains no runtime-application or lifecycle fields", () => {
    const result = assess("brainstorming", "sisyphus", "justice-implement-brainstorming", {
      kind: "valid",
      agent: "sisyphus",
    });

    expect(result).not.toHaveProperty("routingStatus");
    expect(result).not.toHaveProperty("executionOutcome");
    expect(result).not.toHaveProperty("actualController");
    expect(result).not.toHaveProperty("sessionId");
    expect(result).not.toHaveProperty("messageId");
  });
});
