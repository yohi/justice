import { describe, expect, it, vi } from "vitest";
import { PlanBridge } from "../../src/hooks/plan-bridge";
import {
  AuthorizationStore,
  createAuthorizationReviewBoundary,
} from "../../src/core/plan-authorization";
import { createMockFileSystem } from "../helpers/mock-file-system";

const plan = "## Task 1: Approved\n- [ ] implement\n";

function createFixture() {
  const files = createMockFileSystem({ "docs/plan.md": plan });
  const boundary = createAuthorizationReviewBoundary();
  const store = new AuthorizationStore(files, files, boundary);
  const bridge = new PlanBridge(files);
  bridge.setAuthorizationDependencies({
    authorizationStore: store,
    authorizationReviewBoundary: boundary,
  });
  return { files, store, bridge };
}

describe("PlanBridge authorization restoration", () => {
  it("arms only after durable authorization succeeds", async () => {
    const { bridge, store } = createFixture();
    const result = await bridge.handleImplementationArm("s1", {
      source: "command",
      planPath: "docs/plan.md",
      approved: true,
    });

    expect(result).toMatchObject({ armed: true, planPath: "docs/plan.md" });
    expect(bridge.getActivePlan("s1")).toBe("docs/plan.md");
    expect((await store.hydrate()).some((binding) => binding.status === "active")).toBe(true);
  });

  it("restores an unchanged semantic plan after fingerprint validation", async () => {
    const { bridge, store } = createFixture();
    const approved = await bridge.handleImplementationArm("s1", {
      source: "command",
      planPath: "docs/plan.md",
      approved: true,
    });
    expect(approved.armed).toBe(true);
    bridge.setActivePlan("s1", null);

    await expect(bridge.restoreActivePlans()).resolves.toBe("authoritative");
    expect(bridge.getActivePlan("s1")).toBe("docs/plan.md");
    expect(bridge.isImplementationArmed("s1")).toBe(false);
    expect((await store.hydrate()).filter((binding) => binding.status === "active")).toHaveLength(1);
  });

  it("returns uncertain and preserves authority when the plan probe fails", async () => {
    const { bridge, store, files } = createFixture();
    await bridge.handleImplementationArm("s1", {
      source: "command",
      planPath: "docs/plan.md",
      approved: true,
    });
    files.fileExists = vi.fn(async () => {
      throw new Error("probe failed");
    });

    await expect(bridge.restoreActivePlans()).resolves.toBe("uncertain");
    expect(bridge.getActivePlan("s1")).toBeNull();
    expect((await store.hydrate()).some((binding) => binding.status === "active")).toBe(true);
  });

  it("invalidates a confirmed missing plan without a superseded reason", async () => {
    const { bridge, store, files } = createFixture();
    await bridge.handleImplementationArm("s1", {
      source: "command",
      planPath: "docs/plan.md",
      approved: true,
    });
    delete files.writtenFiles["docs/plan.md"];
    bridge.setReviewDispatchCancellation(async () => undefined);

    await expect(bridge.restoreActivePlans()).resolves.toBe("authoritative");
    const binding = (await store.hydrate()).find((candidate) => candidate.sessionId === "s1");
    expect(binding).toMatchObject({ status: "invalidated" });
    expect(binding).not.toHaveProperty("invalidationReason");
    expect(bridge.getActivePlan("s1")).toBeNull();
  });
});
