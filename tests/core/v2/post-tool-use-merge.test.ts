import { describe, expect, it } from "vitest";
import {
  mergePostToolUseResponses,
  mergePreToolUseResponses,
} from "../../../src/core/justice-plugin";
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
      modifiedPayload: { key: "a" },
    });
  });

  it("should throw when more than one inject response carries modifiedPayload", () => {
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
    expect(() => mergePostToolUseResponses(responses)).toThrow(/modifiedPayload/);
  });

  it("should propagate the gate_advisory variant across merged inject responses", () => {
    const responses: HookResponse[] = [
      { action: "inject", injectedContext: "A" },
      { action: "inject", injectedContext: "B", variant: "gate_advisory" },
    ];
    expect(mergePostToolUseResponses(responses)).toEqual({
      action: "inject",
      injectedContext: "A\n\n---\n\nB",
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

  it("should throw when modifiedPayload conflicts occur", () => {
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
    expect(() => mergePreToolUseResponses(responses[0], responses[1])).toThrow(/modifiedPayload/);
  });
});
