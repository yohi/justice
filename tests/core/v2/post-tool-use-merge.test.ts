import { describe, expect, it } from "vitest";
import {
  mergePostToolUseResponses,
  mergePreToolUseResponses,
} from "../../../src/core/hook-response-merger";
import type { HookResponse } from "../../../src/core/types";

describe("D64 - PostToolUse merge rules", () => {
  it("should prioritize skip action over inject and proceed", () => {
    const responses: HookResponse[] = [
      { action: "proceed" },
      { action: "skip" },
      { action: "inject", injectedContext: "test" },
    ];
    expect(mergePostToolUseResponses(responses)).toEqual({ action: "skip" });
  });

  it("should concatenate injectedContext from multiple inject actions", () => {
    const responses: HookResponse[] = [
      { action: "inject", injectedContext: "context A" },
      { action: "proceed" },
      { action: "inject", injectedContext: "context B" },
    ];
    expect(mergePostToolUseResponses(responses)).toEqual({
      action: "inject",
      injectedContext: "context A\n\n---\n\ncontext B",
      normalInjectedContext: "context A\n\n---\n\ncontext B",
    });
  });

  it("should return proceed when no inject or skip responses are present", () => {
    const responses: HookResponse[] = [{ action: "proceed" }, { action: "proceed" }];
    expect(mergePostToolUseResponses(responses)).toEqual({ action: "proceed" });
  });

  it("should return proceed for an empty response list", () => {
    expect(mergePostToolUseResponses([])).toEqual({ action: "proceed" });
  });

  it("should skip empty injectedContext fragments when concatenating", () => {
    const responses: HookResponse[] = [
      { action: "inject", injectedContext: "" },
      { action: "inject", injectedContext: "tail" },
    ];
    expect(mergePostToolUseResponses(responses)).toEqual({
      action: "inject",
      injectedContext: "tail",
      normalInjectedContext: "tail",
    });
  });

  it("should attach the single modifiedPayload carried by an inject response", () => {
    const responses: HookResponse[] = [
      { action: "inject", injectedContext: "A", modifiedPayload: { key: "a" } },
      { action: "inject", injectedContext: "B" },
    ];
    expect(mergePostToolUseResponses(responses)).toEqual({
      action: "inject",
      injectedContext: "A\n\n---\n\nB",
      normalInjectedContext: "A\n\n---\n\nB",
      modifiedPayload: { key: "a" },
    });
  });

  it("should keep the first modifiedPayload and report a conflict", () => {
    const responses: HookResponse[] = [
      {
        action: "inject",
        injectedContext: "A",
        modifiedPayload: { toolName: "task", modified: 1 },
      },
      {
        action: "inject",
        injectedContext: "B",
        modifiedPayload: { toolName: "task", modified: 2 },
      },
    ];
    const warnings: string[] = [];

    const result = mergePostToolUseResponses(responses, (message) => warnings.push(message));

    expect(result).toEqual({
      action: "inject",
      injectedContext: "A\n\n---\n\nB",
      normalInjectedContext: "A\n\n---\n\nB",
      modifiedPayload: { toolName: "task", modified: 1 },
    });
    expect(warnings).toEqual([
      "Conflict detected in post-tool-use modifiedPayload; using the first response",
    ]);
  });

  it("preserves full injection order while splitting normal and gate advisory channels", () => {
    // Given
    const responses: HookResponse[] = [
      { action: "inject", injectedContext: "A" },
      { action: "inject", injectedContext: "B", variant: "gate_advisory" },
      { action: "inject", injectedContext: "C" },
    ];

    // When
    const merged = mergePostToolUseResponses(responses);

    // Then
    expect(merged).toEqual({
      action: "inject",
      injectedContext: "A\n\n---\n\nB\n\n---\n\nC",
      normalInjectedContext: "A\n\n---\n\nC",
      gateAdvisoryContext: "B",
      variant: "gate_advisory",
    });
  });

  it("exposes a gate advisory channel for a gate-only injection", () => {
    // Given
    const responses: HookResponse[] = [
      { action: "inject", injectedContext: "gate context", variant: "gate_advisory" },
    ];

    // When
    const merged = mergePostToolUseResponses(responses);

    // Then
    expect(merged).toEqual({
      action: "inject",
      injectedContext: "gate context",
      gateAdvisoryContext: "gate context",
      variant: "gate_advisory",
    });
  });
});

describe("D64 - PreToolUse merge rules", () => {
  it("should prioritize skip over inject", () => {
    const skip: HookResponse = { action: "skip" };
    const inject: HookResponse = { action: "inject", injectedContext: "ctx" };
    expect(mergePreToolUseResponses(skip, inject)).toEqual({ action: "skip" });
    expect(mergePreToolUseResponses(inject, skip)).toEqual({ action: "skip" });
  });

  it("should concatenate two inject responses", () => {
    const a: HookResponse = { action: "inject", injectedContext: "obs" };
    const b: HookResponse = { action: "inject", injectedContext: "plan" };
    expect(mergePreToolUseResponses(a, b)).toEqual({
      action: "inject",
      injectedContext: "obs\n\n---\n\nplan",
    });
  });

  it("should return the single inject when only one side injects", () => {
    const inject: HookResponse = { action: "inject", injectedContext: "plan" };
    const proceed: HookResponse = { action: "proceed" };
    expect(mergePreToolUseResponses(proceed, inject)).toEqual({
      action: "inject",
      injectedContext: "plan",
    });
    expect(mergePreToolUseResponses(inject, proceed)).toEqual({
      action: "inject",
      injectedContext: "plan",
    });
  });

  it("should return proceed when neither side injects", () => {
    expect(mergePreToolUseResponses({ action: "proceed" }, { action: "proceed" })).toEqual({
      action: "proceed",
    });
  });

  it("should propagate the gate_advisory variant when either side carries it", () => {
    const a: HookResponse = { action: "inject", injectedContext: "obs", variant: "gate_advisory" };
    const b: HookResponse = { action: "inject", injectedContext: "plan" };
    expect(mergePreToolUseResponses(a, b)).toEqual({
      action: "inject",
      injectedContext: "obs\n\n---\n\nplan",
      variant: "gate_advisory",
    });
  });

  it("should keep a modifiedPayload and report a conflict with a-priority", () => {
    const a: HookResponse = {
      action: "inject",
      injectedContext: "A",
      modifiedPayload: { toolName: "task", modified: 1 },
    };
    const b: HookResponse = {
      action: "inject",
      injectedContext: "B",
      modifiedPayload: { toolName: "task", modified: 2 },
    };
    const warnings: string[] = [];

    const result = mergePreToolUseResponses(a, b, (message) => warnings.push(message));

    expect(result).toEqual({
      action: "inject",
      injectedContext: "A\n\n---\n\nB",
      modifiedPayload: { toolName: "task", modified: 1 },
    });
    expect(warnings).toEqual([
      "Conflict detected in pre-tool-use modifiedPayload; using the first response",
    ]);
  });
  it("should attach modifiedPayload from the first inject when only the first side carries one", () => {
    const a: HookResponse = {
      action: "inject",
      injectedContext: "A",
      modifiedPayload: { key: "a" },
    };
    const b: HookResponse = { action: "inject", injectedContext: "B" };
    expect(mergePreToolUseResponses(a, b)).toEqual({
      action: "inject",
      injectedContext: "A\n\n---\n\nB",
      modifiedPayload: { key: "a" },
    });
  });

  it("should attach modifiedPayload from the second inject when only the second side carries one", () => {
    const a: HookResponse = { action: "inject", injectedContext: "A" };
    const b: HookResponse = {
      action: "inject",
      injectedContext: "B",
      modifiedPayload: { key: "b" },
    };
    expect(mergePreToolUseResponses(a, b)).toEqual({
      action: "inject",
      injectedContext: "A\n\n---\n\nB",
      modifiedPayload: { key: "b" },
    });
  });
});
