import { describe, expect, it } from "vitest";

describe("package export map", () => {
  it("resolves the core entry through the package self-reference", async () => {
    const core = await import("@yohi/justice/core");

    expect(core.PlanParser).toBeDefined();
    expect(core.TaskPackager).toBeDefined();
    expect(core.createWorkerRoutingDecision).toBeDefined();
  });
});
