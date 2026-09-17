import { describe, expect, it, vi } from "vitest";
import { SessionStateProvider } from "../../src/core/session-state-provider";
import { ObservationHandler } from "../../src/hooks/observation-handler";
import { ObservationLogStore } from "../../src/runtime/observation-log-store";
import { createMemFs } from "../helpers/mock-file-system";

describe("ObservationHandler lifecycle notifications", () => {
  it("creates a fresh authorized attempt from the active authorization", async () => {
    const { reader, writer } = createMemFs();
    const logStore = new ObservationLogStore(writer, reader, "w-1");
    const sessionStateProvider = new SessionStateProvider();
    const handler = new ObservationHandler({
      logStore,
      sessionStateProvider,
      writerId: "w-1",
      getActiveAuthorization: async () => ({
        authorizationId: "auth-1",
        sessionId: "parent-1",
        planPath: "plan.md",
        planFingerprint: { algorithm: "sha256", value: "fingerprint" },
        canonicalSnapshot: { schema: "justice-plan-v1", documentDigest: "doc", globalBodyDigest: "body", tasks: [] },
        fingerprintSchema: "justice-plan-v1",
        approvedAt: "2026-09-17T00:00:00.000Z",
        status: "active",
      }),
    });

    const response = await handler.handlePreToolUse({
      type: "PreToolUse",
      sessionId: "parent-1",
      callId: "call-1",
      payload: { toolName: "task", toolInput: { taskId: "task-1" } },
    });

    expect(response).toEqual({ action: "proceed" });
    expect((await logStore.readAll()).filter((record) => record.recordType === "observation" && record.kind === "task_lifecycle_transition")).toHaveLength(2);
    expect(sessionStateProvider.getTaskCallBinding("call-1")?.taskExecutionRef).toMatchObject({
      authorizationId: "auth-1",
      taskId: "task-1",
    });
  });

  it("returns implementation unauthorized without an active authorization", async () => {
    const { reader, writer } = createMemFs();
    const logStore = new ObservationLogStore(writer, reader, "w-1");
    const handler = new ObservationHandler({
      logStore,
      sessionStateProvider: new SessionStateProvider(),
      writerId: "w-1",
      getActiveAuthorization: async () => null,
    });

    const response = await handler.handlePreToolUse({
      type: "PreToolUse",
      sessionId: "parent-1",
      callId: "call-1",
      payload: { toolName: "task", toolInput: { taskId: "task-1" } },
    });

    expect(response).toMatchObject({ action: "inject" });
    expect((await logStore.readAll()).filter((record) => record.recordType === "observation" && record.kind === "task_lifecycle_transition")).toHaveLength(0);
  });

  it("resumes a rework-required task without recording a new authorization transition", async () => {
    const { reader, writer } = createMemFs();
    const logStore = new ObservationLogStore(writer, reader, "w-1");
    const sessionStateProvider = new SessionStateProvider();
    const handler = new ObservationHandler({
      logStore,
      sessionStateProvider,
      writerId: "w-1",
      getActiveAuthorization: async () => ({
        authorizationId: "auth-1",
        sessionId: "parent-1",
        planPath: "plan.md",
        planFingerprint: { algorithm: "sha256", value: "fingerprint" },
        canonicalSnapshot: { schema: "justice-plan-v1", documentDigest: "doc", globalBodyDigest: "body", tasks: [] },
        fingerprintSchema: "justice-plan-v1",
        approvedAt: "2026-09-17T00:00:00.000Z",
        status: "active",
      }),
      getTaskLifecycleState: async () => "rework_required",
    });

    await handler.handlePreToolUse({
      type: "PreToolUse",
      sessionId: "parent-1",
      callId: "call-1",
      payload: { toolName: "task", toolInput: { taskId: "task-1" } },
    });

    const transitions = (await logStore.readAll()).filter(
      (record) => record.recordType === "observation" && record.kind === "task_lifecycle_transition",
    );
    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toMatchObject({ from: "rework_required", to: "in_progress" });
  });

  it("fails open when a task attempt cannot start from its current lifecycle state", async () => {
    const { reader, writer } = createMemFs();
    const logStore = new ObservationLogStore(writer, reader, "w-1");
    const handler = new ObservationHandler({
      logStore,
      sessionStateProvider: new SessionStateProvider(),
      writerId: "w-1",
      getActiveAuthorization: async () => ({
        authorizationId: "auth-1",
        sessionId: "parent-1",
        planPath: "plan.md",
        planFingerprint: { algorithm: "sha256", value: "fingerprint" },
        canonicalSnapshot: { schema: "justice-plan-v1", documentDigest: "doc", globalBodyDigest: "body", tasks: [] },
        fingerprintSchema: "justice-plan-v1",
        approvedAt: "2026-09-17T00:00:00.000Z",
        status: "active",
      }),
      getTaskLifecycleState: async () => "in_progress",
    });

    const response = await handler.handlePreToolUse({
      type: "PreToolUse",
      sessionId: "parent-1",
      callId: "call-1",
      payload: { toolName: "task", toolInput: { taskId: "task-1" } },
    });

    expect(response).toEqual({ action: "proceed" });
    expect((await logStore.readAll()).filter((record) => record.recordType === "observation" && record.kind === "task_lifecycle_transition")).toHaveLength(0);
  });

  it("records a legacy task execution ref when no authorization callback is configured", async () => {
    const { reader, writer } = createMemFs();
    const logStore = new ObservationLogStore(writer, reader, "w-1");
    const sessionStateProvider = new SessionStateProvider();
    const handler = new ObservationHandler({
      logStore,
      sessionStateProvider,
      writerId: "w-1",
    });

    await handler.handlePreToolUse({
      type: "PreToolUse",
      sessionId: "parent-1",
      callId: "call-1",
      payload: {
        toolName: "task",
        toolInput: { authorizationId: "auth-1", taskId: "task-1", attemptId: "attempt-1" },
      },
    });

    expect(sessionStateProvider.getTaskCallBinding("call-1")).toMatchObject({
      authorizationId: "auth-1",
      taskExecutionRef: { taskId: "task-1", attemptId: "attempt-1" },
    });
    expect((await logStore.readAll()).filter((record) => record.recordType === "observation" && record.kind === "task_lifecycle_transition")).toHaveLength(2);
  });

  it("ignores a malformed legacy task execution ref", async () => {
    const { reader, writer } = createMemFs();
    const logStore = new ObservationLogStore(writer, reader, "w-1");
    const sessionStateProvider = new SessionStateProvider();
    const handler = new ObservationHandler({
      logStore,
      sessionStateProvider,
      writerId: "w-1",
    });

    await handler.handlePreToolUse({
      type: "PreToolUse",
      sessionId: "parent-1",
      callId: "call-1",
      payload: {
        toolName: "task",
        toolInput: { authorizationId: 42, taskId: "task-1", attemptId: "attempt-1" },
      },
    });

    expect(sessionStateProvider.getTaskCallBinding("call-1")).toBeUndefined();
    expect((await logStore.readAll()).filter((record) => record.recordType === "observation" && record.kind === "task_lifecycle_transition")).toHaveLength(0);
  });

  it("persists both finalization transitions through the real log store", async () => {
    const { reader, writer } = createMemFs();
    const logStore = new ObservationLogStore(writer, reader, "w-1");
    const handler = new ObservationHandler({
      logStore,
      sessionStateProvider: new SessionStateProvider(),
      writerId: "w-1",
    });

    const result = await handler.advanceFinalizationAfterAllTasksAccepted({
      parentSessionId: "parent-1",
      authorizationId: "auth-1",
      planPath: "plan.md",
    });
    const records = (await logStore.readAll()).filter(
      (record) => record.recordType === "observation" && record.kind === "plan_finalization_transition",
    );

    expect(result.kind).toBe("committed");
    expect(records).toHaveLength(2);
  });

  it("notifies after the durable review-pending transition", async () => {
    const { reader, writer, files } = createMemFs();
    const logStore = new ObservationLogStore(writer, reader, "w-1");
    const sessionStateProvider = new SessionStateProvider();
    const handler = new ObservationHandler({
      logStore,
      sessionStateProvider,
      writerId: "w-1",
      getActiveAuthorization: async () => ({
        authorizationId: "auth-1",
        sessionId: "parent-1",
        planPath: "plan.md",
        planFingerprint: { algorithm: "sha256", value: "fingerprint" },
        canonicalSnapshot: { schema: "justice-plan-v1", documentDigest: "doc", globalBodyDigest: "body", tasks: [] },
        fingerprintSchema: "justice-plan-v1",
        approvedAt: "2026-09-17T00:00:00.000Z",
        status: "active",
      }),
    });
    const offer = vi.fn(async (_parentSessionId: string) => undefined);
    handler.setReviewPendingCommittedHandler(offer);

    await handler.handlePreToolUse({
      type: "PreToolUse",
      sessionId: "parent-1",
      callId: "call-1",
      payload: { toolName: "task", toolInput: { taskId: "task-1" } },
    });
    await handler.handlePostToolUse({
      type: "PostToolUse",
      sessionId: "parent-1",
      callId: "call-1",
      payload: {
        toolName: "task",
        toolResult: "worker output",
        error: false,
        metadata: {},
      },
    });
    const persisted = [...files.values()].join("\n");
    const records = await logStore.readAll();
    expect(records.length).toBeGreaterThan(0);
    expect(persisted).toContain('"kind":"task_lifecycle_transition"');
    expect(offer).toHaveBeenCalledWith("parent-1");
  });

  it("persists an advisory when review notification fails after the transition", async () => {
    const { reader, writer } = createMemFs();
    const logStore = new ObservationLogStore(writer, reader, "w-1");
    const sessionStateProvider = new SessionStateProvider();
    const handler = new ObservationHandler({
      logStore,
      sessionStateProvider,
      writerId: "w-1",
      getActiveAuthorization: async () => ({
        authorizationId: "auth-1",
        sessionId: "parent-1",
        planPath: "plan.md",
        planFingerprint: { algorithm: "sha256", value: "fingerprint" },
        canonicalSnapshot: { schema: "justice-plan-v1", documentDigest: "doc", globalBodyDigest: "body", tasks: [] },
        fingerprintSchema: "justice-plan-v1",
        approvedAt: "2026-09-17T00:00:00.000Z",
        status: "active",
      }),
    });
    handler.setReviewPendingCommittedHandler(async () => {
      throw new Error("notification unavailable");
    });

    await handler.handlePreToolUse({
      type: "PreToolUse",
      sessionId: "parent-1",
      callId: "call-1",
      payload: { toolName: "task", toolInput: { taskId: "task-1" } },
    });
    await handler.handlePostToolUse({
      type: "PostToolUse",
      sessionId: "parent-1",
      callId: "call-1",
      payload: { toolName: "task", toolResult: "worker output", error: false, metadata: {} },
    });

    const records = await logStore.readAll();
    expect(records.some((record) => record.recordType === "observation" && record.kind === "task_lifecycle_transition" && record.to === "review_pending")).toBe(true);
    expect(records).toContainEqual(expect.objectContaining({
      kind: "session_error",
      sessionId: "lifecycle",
      errorKind: "lifecycle_advisory",
    }));
  });
});
