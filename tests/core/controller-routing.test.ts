import { describe, expect, it } from "vitest";
import {
  PINNED_COMMAND_WORKFLOW_MAP,
  assessControllerConfiguration,
  resolvePinnedCommandWorkflow,
} from "../../src/core/controller-routing";
import { createControllerRoutingDecision } from "../../src/core/routing-decision";
import type { ControllerRoutingDecision, ControllerWorkflow } from "../../src/core/types";

const decisionFor = (workflow: ControllerWorkflow): ControllerRoutingDecision =>
  createControllerRoutingDecision(workflow, "workflow_rule");

describe("pinned command expectation", () => {
  it.each([
    ["justice-implement-brainstorming", "brainstorming"],
    ["justice-implement-writing-plans", "writing-plans"],
    ["justice-implement-subagent-driven-development", "subagent-driven-development"],
    ["justice-implement-executing-plans", "executing-plans"],
  ] as const)("maps %s to %s", (command, workflow) => {
    expect(resolvePinnedCommandWorkflow(command)).toBe(workflow);
    expect(PINNED_COMMAND_WORKFLOW_MAP.get(command)).toBe(workflow);
  });

  it.each([
    "/justice-implement-brainstorming",
    " justice-implement-brainstorming",
    "justice-implement-brainstorming ",
    "JUSTICE-IMPLEMENT-BRAINSTORMING",
    "justice-implement-brainstorm",
    "justice-implement",
    "justice-implement-writing-plans-x",
    "please-use-sisyphus",
  ])("rejects the non-exact command %j", (command) => {
    expect(resolvePinnedCommandWorkflow(command)).toBeUndefined();
  });

  it("exposes exactly the four pinned commands", () => {
    expect([...PINNED_COMMAND_WORKFLOW_MAP.keys()].sort()).toEqual([
      "justice-implement-brainstorming",
      "justice-implement-executing-plans",
      "justice-implement-subagent-driven-development",
      "justice-implement-writing-plans",
    ]);
  });
});

describe("controller configuration assessment", () => {
  const brainstormingDecision = decisionFor("brainstorming");
  const brainstormingCommand = "justice-implement-brainstorming" as const;

  it("returns unsupported before consulting any definition when the effective config is unavailable", () => {
    expect(
      assessControllerConfiguration({
        decision: brainstormingDecision,
        pinnedCommand: brainstormingCommand,
        effectiveConfigAvailable: false,
      }),
    ).toEqual({
      workflow: "brainstorming",
      desiredController: "sisyphus",
      pinnedCommand: brainstormingCommand,
      status: "unsupported",
      reason: "effective_config_unsupported",
    });
  });

  it("returns unsupported even when a definition is present", () => {
    const assessment = assessControllerConfiguration({
      decision: brainstormingDecision,
      pinnedCommand: brainstormingCommand,
      effectiveConfigAvailable: false,
      effectiveDefinition: { kind: "valid", agent: "sisyphus" },
    });
    expect(assessment.status).toBe("unsupported");
    expect(assessment.reason).toBe("effective_config_unsupported");
    expect(assessment.configuredController).toBeUndefined();
  });

  it("returns missing when the pinned command has no effective definition", () => {
    expect(
      assessControllerConfiguration({
        decision: brainstormingDecision,
        pinnedCommand: brainstormingCommand,
        effectiveConfigAvailable: true,
      }),
    ).toEqual({
      workflow: "brainstorming",
      desiredController: "sisyphus",
      pinnedCommand: brainstormingCommand,
      status: "missing",
      reason: "command_missing",
    });
  });

  it("returns misconfigured/invalid_command_definition for a normalized invalid definition", () => {
    const assessment = assessControllerConfiguration({
      decision: brainstormingDecision,
      pinnedCommand: brainstormingCommand,
      effectiveConfigAvailable: true,
      effectiveDefinition: { kind: "invalid" },
    });
    expect(assessment.status).toBe("misconfigured");
    expect(assessment.reason).toBe("invalid_command_definition");
    expect(assessment.configuredController).toBeUndefined();
  });

  it("returns misconfigured/agent_missing when the valid definition has no agent", () => {
    const assessment = assessControllerConfiguration({
      decision: brainstormingDecision,
      pinnedCommand: brainstormingCommand,
      effectiveConfigAvailable: true,
      effectiveDefinition: { kind: "valid" },
    });
    expect(assessment.status).toBe("misconfigured");
    expect(assessment.reason).toBe("agent_missing");
    expect(assessment.configuredController).toBeUndefined();
  });

  it("returns misconfigured/agent_invalid for a custom configured agent", () => {
    const assessment = assessControllerConfiguration({
      decision: brainstormingDecision,
      pinnedCommand: brainstormingCommand,
      effectiveConfigAvailable: true,
      effectiveDefinition: { kind: "valid", agent: "my-custom-agent" },
    });
    expect(assessment.status).toBe("misconfigured");
    expect(assessment.reason).toBe("agent_invalid");
    expect(assessment.configuredController).toBe("my-custom-agent");
  });

  it("returns misconfigured/agent_invalid for a recognized agent unequal to the desired controller", () => {
    const assessment = assessControllerConfiguration({
      decision: brainstormingDecision,
      pinnedCommand: brainstormingCommand,
      effectiveConfigAvailable: true,
      effectiveDefinition: { kind: "valid", agent: "oracle" },
    });
    expect(assessment.status).toBe("misconfigured");
    expect(assessment.reason).toBe("agent_invalid");
    expect(assessment.configuredController).toBe("oracle");
  });

  it("rejects exact-equality-adjacent agent spellings", () => {
    for (const agent of [" sisyphus", "sisyphus ", "Sisyphus", "sisyphus/"]) {
      const assessment = assessControllerConfiguration({
        decision: brainstormingDecision,
        pinnedCommand: brainstormingCommand,
        effectiveConfigAvailable: true,
        effectiveDefinition: { kind: "valid", agent },
      });
      expect(assessment.status).toBe("misconfigured");
      expect(assessment.reason).toBe("agent_invalid");
    }
  });

  it.each([
    ["brainstorming", "justice-implement-brainstorming", "sisyphus"],
    ["writing-plans", "justice-implement-writing-plans", "sisyphus"],
    ["subagent-driven-development", "justice-implement-subagent-driven-development", "atlas"],
    ["executing-plans", "justice-implement-executing-plans", "sisyphus"],
  ] as const)(
    "returns configured for %s when the desired agent is configured exactly",
    (workflow, command, controller) => {
      const assessment = assessControllerConfiguration({
        decision: decisionFor(workflow),
        pinnedCommand: command,
        effectiveConfigAvailable: true,
        effectiveDefinition: { kind: "valid", agent: controller },
      });
      expect(assessment).toEqual({
        workflow,
        desiredController: controller,
        pinnedCommand: command,
        configuredController: controller,
        status: "configured",
      });
    },
  );

  it("configured carries no runtime-applied, execution, or identity field", () => {
    const assessment = assessControllerConfiguration({
      decision: brainstormingDecision,
      pinnedCommand: brainstormingCommand,
      effectiveConfigAvailable: true,
      effectiveDefinition: { kind: "valid", agent: "sisyphus" },
    });
    expect(Object.keys(assessment).sort()).toEqual([
      "configuredController",
      "desiredController",
      "pinnedCommand",
      "status",
      "workflow",
    ]);
    expect(assessment).not.toHaveProperty("routingStatus");
    expect(assessment).not.toHaveProperty("executionOutcome");
    expect(assessment).not.toHaveProperty("actualController");
    expect(assessment).not.toHaveProperty("terminalEnvelope");
    expect(assessment).not.toHaveProperty("sessionId");
    expect(assessment).not.toHaveProperty("messageId");
    expect(assessment).not.toHaveProperty("eventId");
  });

  it("consumes no session, message, event, or execution state from its input", () => {
    const baseInput = {
      decision: brainstormingDecision,
      pinnedCommand: brainstormingCommand,
      effectiveConfigAvailable: true,
      effectiveDefinition: { kind: "valid", agent: "sisyphus" } as const,
    };
    const polluted = {
      ...baseInput,
      sessionId: "session-1",
      messageId: "msg-1",
      eventId: "evt-1",
      execution: { outcome: "success" },
      terminalEnvelope: { kind: "matched" },
    } as typeof baseInput;

    expect(assessControllerConfiguration(polluted)).toEqual(
      assessControllerConfiguration(baseInput),
    );
  });

  it("rejects a pinned command that does not correspond to the decision workflow", () => {
    expect(() =>
      assessControllerConfiguration({
        decision: brainstormingDecision,
        pinnedCommand: "justice-implement-executing-plans",
        effectiveConfigAvailable: true,
        effectiveDefinition: { kind: "valid", agent: "sisyphus" },
      }),
    ).toThrow("does not correspond");
  });

  it("rejects a decision whose controller is not the desired controller for the workflow", () => {
    const mismatchedDecision: ControllerRoutingDecision = {
      kind: "controller",
      workflow: "brainstorming",
      controller: "atlas",
      reason: "workflow_rule",
    };

    expect(() =>
      assessControllerConfiguration({
        decision: mismatchedDecision,
        pinnedCommand: brainstormingCommand,
        effectiveConfigAvailable: true,
        effectiveDefinition: { kind: "valid", agent: "atlas" },
      }),
    ).toThrow("desired controller");
  });
});
