import { describe, expect, it, vi } from "vitest";
import { PlanBridge } from "../../src/hooks/plan-bridge";
import {
  AuthorizationStore,
  createAuthorizationReviewBoundary,
  type AuthorizationReviewBoundary,
} from "../../src/core/plan-authorization";
import { createMockFileSystem } from "../helpers/mock-file-system";
import * as planFingerprintModule from "../../src/core/plan-fingerprint";

const plan = "## Task 1: Approved\n- [ ] implement\n";

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value?: T) => void } {
  let resolve: ((value: T) => void) | undefined;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve: (value) => resolve?.(value as T) };
}

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
  it("fails closed when implementation arm is requested before wiring", async () => {
    const files = createMockFileSystem({ "docs/plan.md": plan });
    const bridge = new PlanBridge(files);

    await expect(
      bridge.handleImplementationArm("s1", {
        source: "command",
        planPath: "docs/plan.md",
        approved: true,
      }),
    ).resolves.toMatchObject({ armed: false, planPath: null });
  });

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

  it("returns uncertain when authoritative hydration fails", async () => {
    const { bridge, store } = createFixture();
    vi.spyOn(store, "hydrate").mockRejectedValueOnce(new Error("hydrate failed"));

    await expect(bridge.restoreActivePlans()).resolves.toBe("uncertain");
    expect(bridge.getActivePlan("s1")).toBeNull();
  });

  it("returns uncertain without mutation when fingerprint calculation fails", async () => {
    const { bridge, store, files } = createFixture();
    const approved = await bridge.handleImplementationArm("s1", {
      source: "command",
      planPath: "docs/plan.md",
      approved: true,
    });
    expect(approved.armed).toBe(true);
    vi.spyOn(planFingerprintModule, "computePlanFingerprint").mockImplementationOnce(() => {
      throw new Error("fingerprint failed");
    });
    files.fileExists = vi.fn(async () => true);

    await expect(bridge.restoreActivePlans()).resolves.toBe("uncertain");
    expect(bridge.getActivePlan("s1")).toBeNull();
    expect((await store.hydrate()).some((binding) => binding.status === "active")).toBe(true);
  });

  it("does not arm when the authoritative approval reread fails", async () => {
    const { bridge, files, store } = createFixture();
    let saved = false;
    const originalRead = files.readFile.bind(files);
    const originalRename = files.rename.bind(files);
    files.rename = async (from, to) => {
      await originalRename(from, to);
      if (to === ".justice/authorizations.json") saved = true;
    };
    files.readFile = async (path) => {
      if (saved && path === ".justice/authorizations.json") {
        throw new Error("authoritative reread failed");
      }
      return originalRead(path);
    };

    await expect(
      bridge.handleImplementationArm("s1", {
        source: "command",
        planPath: "docs/plan.md",
        approved: true,
      }),
    ).resolves.toMatchObject({ armed: false, planPath: null });
    expect(bridge.getActivePlan("s1")).toBeNull();
    saved = false;
    await expect(store.hydrate()).resolves.toEqual(expect.any(Array));
  });

  it("propagates malformed authoritative persistence through restoration", async () => {
    const files = createMockFileSystem({ ".justice/authorizations.json": "{" });
    const boundary = createAuthorizationReviewBoundary();
    const store = new AuthorizationStore(files, files, boundary);
    const bridge = new PlanBridge(files);
    bridge.setAuthorizationDependencies({ authorizationStore: store, authorizationReviewBoundary: boundary });

    await expect(bridge.restoreActivePlans()).resolves.toBe("uncertain");
    expect(bridge.getActivePlan("s1")).toBeNull();
  });

  it("does not probe an unsafe persisted plan path", async () => {
    const files = createMockFileSystem();
    const boundary = createAuthorizationReviewBoundary();
    const store = new AuthorizationStore(files, files, boundary);
    const bridge = new PlanBridge(files);
    bridge.setAuthorizationDependencies({ authorizationStore: store, authorizationReviewBoundary: boundary });
    const unsafe = { ...((await store.approve({
      sessionId: "s1",
      planPath: "../secret.md",
      planFingerprint: { algorithm: "sha256", value: "x" },
      canonicalSnapshot: { schema: "justice-plan-v1", documentDigest: "x", globalBodyDigest: "x", tasks: [] },
      approvedAt: "2026-09-05T00:00:00.000Z",
    })) ?? {}), status: "active" as const };
    const read = vi.spyOn(files, "readFile");
    vi.spyOn(store, "hydrate").mockResolvedValue([unsafe]);

    await expect(bridge.restoreActivePlans()).resolves.toBe("uncertain");
    expect(read).not.toHaveBeenCalledWith("../secret.md");
  });

  it("returns unauthorized when the durable active binding is missing", async () => {
    const { bridge, store } = createFixture();
    const armed = await bridge.handleImplementationArm("s1", {
      source: "command",
      planPath: "docs/plan.md",
      approved: true,
    });
    expect(armed.armed).toBe(true);
    const binding = (await store.hydrate()).find((candidate) => candidate.status === "active");
    expect(binding).toBeDefined();
    await store.release(binding?.authorizationId ?? "missing", "2026-09-05T00:00:00.000Z");

    const response = await bridge.handlePreToolUse({
      type: "PreToolUse",
      sessionId: "s1",
      callId: "call-1",
      payload: { toolName: "task", toolInput: { prompt: "run" } },
    });

    expect(response).toMatchObject({ action: "inject" });
    expect(bridge.getActivePlan("s1")).toBeNull();
  });

  it("returns unauthorized and durably invalidates a binding after a semantic plan change", async () => {
    const { bridge, store, files } = createFixture();
    const armed = await bridge.handleImplementationArm("s1", {
      source: "command",
      planPath: "docs/plan.md",
      approved: true,
    });
    expect(armed.armed).toBe(true);
    files.writtenFiles["docs/plan.md"] = "## Task 1: Changed\n- [ ] implement\n";

    const response = await bridge.handlePreToolUse({
      type: "PreToolUse",
      sessionId: "s1",
      callId: "call-1",
      payload: { toolName: "task", toolInput: { prompt: "run" } },
    });

    expect(response).toMatchObject({ action: "inject" });
    expect(bridge.getActivePlan("s1")).toBeNull();
    expect((await store.hydrate()).find((binding) => binding.sessionId === "s1")).toMatchObject({
      status: "invalidated",
    });
  });

  it("returns unauthorized when the active plan file is missing", async () => {
    const { bridge, files } = createFixture();
    const armed = await bridge.handleImplementationArm("s1", {
      source: "command",
      planPath: "docs/plan.md",
      approved: true,
    });
    expect(armed.armed).toBe(true);
    delete files.writtenFiles["docs/plan.md"];

    const response = await bridge.handlePreToolUse({
      type: "PreToolUse",
      sessionId: "s1",
      callId: "call-1",
      payload: { toolName: "task", toolInput: { prompt: "run" } },
    });

    expect(response).toMatchObject({ action: "inject" });
    expect(bridge.getActivePlan("s1")).toBeNull();
  });

  it("enriches task input when the durable binding and plan fingerprint are unchanged", async () => {
    const { bridge } = createFixture();
    const armed = await bridge.handleImplementationArm("s1", {
      source: "command",
      planPath: "docs/plan.md",
      approved: true,
    });
    expect(armed.armed).toBe(true);

    const response = await bridge.handlePreToolUse({
      type: "PreToolUse",
      sessionId: "s1",
      callId: "call-1",
      payload: { toolName: "task", toolInput: { prompt: "run" } },
    });

    expect(response).toMatchObject({
      action: "inject",
      modifiedPayload: { args: { task_id: "task-1" } },
    });
  });

  it("serializes startup restoration with concurrent same-session approval", async () => {
    const files = createMockFileSystem({ "docs/plan.md": plan });
    const baseBoundary = createAuthorizationReviewBoundary();
    const restorationEntered = deferred<void>();
    const releaseRestoration = deferred<void>();
    let activeOperations = 0;
    let maximumActiveOperations = 0;
    let holdNextOperation = false;
    const boundary: AuthorizationReviewBoundary = {
      withParentSession: async <T>(parentSessionId: string, operation: () => Promise<T>) => {
        return baseBoundary.withParentSession(parentSessionId, async () => {
          activeOperations += 1;
          maximumActiveOperations = Math.max(maximumActiveOperations, activeOperations);
          try {
            if (holdNextOperation) {
              holdNextOperation = false;
              restorationEntered.resolve();
              await releaseRestoration.promise;
            }
            return await operation();
          } finally {
            activeOperations -= 1;
          }
        });
      },
    };
    const store = new AuthorizationStore(files, files, boundary);
    const bridge = new PlanBridge(files);
    bridge.setAuthorizationDependencies({
      authorizationStore: store,
      authorizationReviewBoundary: boundary,
    });
    const initialApproval = await bridge.handleImplementationArm("s1", {
      source: "command",
      planPath: "docs/plan.md",
      approved: true,
    });
    expect(initialApproval.armed).toBe(true);

    holdNextOperation = true;
    const restoration = bridge.restoreActivePlans();
    await restorationEntered.promise;
    const concurrentApproval = bridge.handleImplementationArm("s1", {
      source: "command",
      planPath: "docs/plan.md",
      approved: true,
    });
    releaseRestoration.resolve();
    await Promise.all([restoration, concurrentApproval]);

    expect(maximumActiveOperations).toBe(1);
    expect((await store.hydrate()).filter((binding) => binding.sessionId === "s1" && binding.status === "active"))
      .toHaveLength(1);
  });
});
