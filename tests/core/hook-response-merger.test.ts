import { describe, expect, it, vi } from "vitest";
import {
  mergePreToolUseResponses,
  mergePostToolUseResponses,
} from "../../src/core/hook-response-merger";
import type { HookResponse, InjectResponse } from "../../src/core/types";

describe("mergePreToolUseResponses", () => {
  const proceed: HookResponse = { action: "proceed" };
  const skip: HookResponse = { action: "skip" };
  const injectA: InjectResponse = {
    action: "inject",
    injectedContext: "context A",
  };
  const injectB: InjectResponse = {
    action: "inject",
    injectedContext: "context B",
  };

  it("returns skip when either response is skip", () => {
    expect(mergePreToolUseResponses(skip, proceed)).toEqual({ action: "skip" });
    expect(mergePreToolUseResponses(proceed, skip)).toEqual({ action: "skip" });
    expect(mergePreToolUseResponses(skip, skip)).toEqual({ action: "skip" });
  });

  it("merges two inject responses with concatenated contexts", () => {
    const result = mergePreToolUseResponses(injectA, injectB);
    expect(result.action).toBe("inject");
    expect((result as InjectResponse).injectedContext).toBe("context A\n\n---\n\ncontext B");
  });

  it("marks gate_advisory when either inject has variant gate_advisory", () => {
    const gate: InjectResponse = {
      action: "inject",
      injectedContext: "gate",
      variant: "gate_advisory",
    };
    const result = mergePreToolUseResponses(injectA, gate);
    expect((result as InjectResponse).variant).toBe("gate_advisory");
  });

  it("logs conflict when both have modifiedPayload", () => {
    const logFn = vi.fn();
    const modA: InjectResponse = {
      action: "inject",
      injectedContext: "A",
      modifiedPayload: { tool: "a" },
    };
    const modB: InjectResponse = {
      action: "inject",
      injectedContext: "B",
      modifiedPayload: { tool: "b" },
    };
    mergePreToolUseResponses(modA, modB, logFn);
    expect(logFn).toHaveBeenCalledWith(
      "Conflict detected in pre-tool-use modifiedPayload; using the first response",
    );
  });

  it("uses first modifiedPayload when only first has it", () => {
    const modA: InjectResponse = {
      action: "inject",
      injectedContext: "A",
      modifiedPayload: { tool: "a" },
    };
    const result = mergePreToolUseResponses(modA, injectB);
    expect((result as InjectResponse).modifiedPayload).toEqual({ tool: "a" });
  });

  it("uses second modifiedPayload when only second has it", () => {
    const modB: InjectResponse = {
      action: "inject",
      injectedContext: "B",
      modifiedPayload: { tool: "b" },
    };
    const result = mergePreToolUseResponses(injectA, modB);
    expect((result as InjectResponse).modifiedPayload).toEqual({ tool: "b" });
  });

  it("returns first inject when second is proceed", () => {
    const result = mergePreToolUseResponses(injectA, proceed);
    expect(result).toEqual(injectA);
  });

  it("returns second inject when first is proceed", () => {
    const result = mergePreToolUseResponses(proceed, injectB);
    expect(result).toEqual(injectB);
  });

  it("returns proceed when both are proceed", () => {
    expect(mergePreToolUseResponses(proceed, proceed)).toEqual({ action: "proceed" });
  });
});

describe("mergePostToolUseResponses", () => {
  const proceed: HookResponse = { action: "proceed" };
  const skip: HookResponse = { action: "skip" };
  const injectA: InjectResponse = {
    action: "inject",
    injectedContext: "context A",
  };
  const injectB: InjectResponse = {
    action: "inject",
    injectedContext: "context B",
  };

  it("returns skip when any response is skip", () => {
    expect(mergePostToolUseResponses([proceed, skip, proceed])).toEqual({ action: "skip" });
  });

  it("returns proceed when no injects", () => {
    expect(mergePostToolUseResponses([proceed, proceed])).toEqual({ action: "proceed" });
  });

  it("merges inject contexts", () => {
    const result = mergePostToolUseResponses([injectA, injectB]);
    expect(result.action).toBe("inject");
    expect((result as InjectResponse).injectedContext).toBe("context A\n\n---\n\ncontext B");
  });

  it("extracts normalInjectedContext and gateAdvisoryContext", () => {
    const normal: InjectResponse = {
      action: "inject",
      injectedContext: "normal",
      normalInjectedContext: "normal-only",
    };
    const gate: InjectResponse = {
      action: "inject",
      injectedContext: "gate",
      gateAdvisoryContext: "gate-only",
      variant: "gate_advisory",
    };
    const result = mergePostToolUseResponses([normal, gate]) as InjectResponse;
    expect(result.normalInjectedContext).toBe("normal-only");
    expect(result.gateAdvisoryContext).toBe("gate-only");
    expect(result.variant).toBe("gate_advisory");
  });

  it("infers normal context from non-gate variant", () => {
    const plain: InjectResponse = {
      action: "inject",
      injectedContext: "plain",
    };
    const result = mergePostToolUseResponses([plain]) as InjectResponse;
    expect(result.normalInjectedContext).toBe("plain");
    expect(result.gateAdvisoryContext).toBeUndefined();
  });

  it("infers gate context from gate_advisory variant", () => {
    const gate: InjectResponse = {
      action: "inject",
      injectedContext: "gate",
      variant: "gate_advisory",
    };
    const result = mergePostToolUseResponses([gate]) as InjectResponse;
    expect(result.gateAdvisoryContext).toBe("gate");
    expect(result.normalInjectedContext).toBeUndefined();
  });

  it("logs conflict when multiple modifiedPayloads exist", () => {
    const logFn = vi.fn();
    const modA: InjectResponse = {
      action: "inject",
      injectedContext: "A",
      modifiedPayload: { tool: "a" },
    };
    const modB: InjectResponse = {
      action: "inject",
      injectedContext: "B",
      modifiedPayload: { tool: "b" },
    };
    mergePostToolUseResponses([modA, modB], logFn);
    expect(logFn).toHaveBeenCalledWith(
      "Conflict detected in post-tool-use modifiedPayload; using the first response",
    );
  });

  it("uses first modifiedPayload when multiple exist", () => {
    const modA: InjectResponse = {
      action: "inject",
      injectedContext: "A",
      modifiedPayload: { tool: "a" },
    };
    const modB: InjectResponse = {
      action: "inject",
      injectedContext: "B",
      modifiedPayload: { tool: "b" },
    };
    const result = mergePostToolUseResponses([modA, modB]) as InjectResponse;
    expect(result.modifiedPayload).toEqual({ tool: "a" });
  });

  it("handles empty responses array", () => {
    expect(mergePostToolUseResponses([])).toEqual({ action: "proceed" });
  });

  it("filters out empty contexts", () => {
    const empty: InjectResponse = {
      action: "inject",
      injectedContext: "",
    };
    const nonEmpty: InjectResponse = {
      action: "inject",
      injectedContext: "real",
    };
    const result = mergePostToolUseResponses([empty, nonEmpty]) as InjectResponse;
    expect(result.injectedContext).toBe("real");
  });
});
