import { describe, expect, it, vi } from "vitest";
import { admitExecutionEvidence } from "../../src/core/acceptance-decision";
import type { ApprovedPlanBinding } from "../../src/core/plan-authorization";
import { SessionStateProvider } from "../../src/core/session-state-provider";
import { ObservationHandler } from "../../src/hooks/observation-handler";
import { ObservationLogStore } from "../../src/runtime/observation-log-store";
import { createMemFs } from "../helpers/mock-file-system";

const canonicalTask = {
  taskId: "task-1",
  title: "Task 1",
  canonicalBody: "## Task 1",
  digest: "digest",
} as const;

function activeAuthorization(): ApprovedPlanBinding {
  return {
    authorizationId: "auth-1",
    sessionId: "parent-1",
    planPath: "plan.md",
    planFingerprint: { algorithm: "sha256", value: "fingerprint" },
    canonicalSnapshot: {
      schema: "justice-plan-v1",
      documentDigest: "doc",
      globalBodyDigest: "body",
      tasks: [canonicalTask],
    },
    fingerprintSchema: "justice-plan-v1",
    approvedAt: "2026-09-17T00:00:00.000Z",
    status: "active",
  } as unknown as ApprovedPlanBinding;
}

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
        canonicalSnapshot: { schema: "justice-plan-v1", documentDigest: "doc", globalBodyDigest: "body", tasks: [canonicalTask] },
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

  it("persists implementation call binding after initial lifecycle", async () => {
    const { reader, writer } = createMemFs();
    const logStore = new ObservationLogStore(writer, reader, "w-1");
    const handler = new ObservationHandler({
      logStore,
      sessionStateProvider: new SessionStateProvider(),
      writerId: "w-1",
      getActiveAuthorization: async () => activeAuthorization(),
    });

    const response = await handler.handlePreToolUse({
      type: "PreToolUse",
      sessionId: "parent-1",
      callId: "call-1",
      payload: { toolName: "task", toolInput: { taskId: "task-1" } },
    });

    expect(response).toEqual({ action: "proceed" });
    const records = await logStore.readAll();
    const kinds = records.map((record) => ("kind" in record ? record.kind : undefined));
    expect(kinds).toEqual([
      "task_lifecycle_transition",
      "task_lifecycle_transition",
      "implementation_call_binding",
    ]);
    const lifecycle = records[1];
    const binding = records[2];
    if (
      lifecycle?.recordType !== "observation" ||
      lifecycle.kind !== "task_lifecycle_transition" ||
      binding?.recordType !== "observation" ||
      binding.kind !== "implementation_call_binding"
    ) {
      throw new Error("expected lifecycle then binding");
    }
    expect(binding).toMatchObject({
      sessionId: "parent-1",
      parentSessionId: "parent-1",
      callId: "call-1",
      authorizationId: "auth-1",
      taskExecutionRef: lifecycle.taskExecutionRef,
    });
    expect(binding.sequence).toBeGreaterThan(lifecycle.sequence);
    expect(Object.keys(binding)).not.toContain("toolInput");
    expect(Object.keys(binding)).not.toContain("rawOutput");
  });

  it("does not admit evidence when binding append fails", async () => {
    const { reader, writer } = createMemFs();
    const realStore = new ObservationLogStore(writer, reader, "w-1");
    const append = vi.fn(async (...args: Parameters<ObservationLogStore["append"]>) => {
      const [, record] = args;
      if (record.recordType === "observation" && record.kind === "implementation_call_binding") {
        throw new Error("binding append failed");
      }
      return realStore.append(...args);
    });
    const logStore = {
      append,
      readAll: () => realStore.readAll(),
    } as unknown as ObservationLogStore;
    const sessionStateProvider = new SessionStateProvider();
    const handler = new ObservationHandler({
      logStore,
      sessionStateProvider,
      writerId: "w-1",
      getActiveAuthorization: async () => activeAuthorization(),
    });

    const response = await handler.handlePreToolUse({
      type: "PreToolUse",
      sessionId: "parent-1",
      callId: "call-1",
      payload: { toolName: "task", toolInput: { taskId: "task-1" } },
    });

    // Partial success: the existing tool flow is not changed by the binding failure.
    expect(response).toEqual({ action: "proceed" });
    const records = await realStore.readAll();
    expect(
      records.filter((record) => record.recordType === "observation" && record.kind === "implementation_call_binding"),
    ).toHaveLength(0);
    const ref = sessionStateProvider.getTaskCallBinding("call-1")?.taskExecutionRef;
    if (ref === undefined) throw new Error("expected the in-memory workflow binding");
    // Even with an in-memory binding and same-call tool evidence, the durable
    // readback has no binding, so the evidence stays UNATTRIBUTED.
    await realStore.append(
      { agentId: "unknown", sessionId: "parent-1", writerId: "w-1" },
      {
        schemaVersion: 1,
        timestamp: "2026-09-17T00:00:10.000Z",
        agentId: "unknown",
        sessionId: "parent-1",
        writerId: "w-1",
        taskId: "task-1",
        recordType: "observation",
        kind: "tool_executed",
        toolName: "bash",
        callId: "call-1",
        evidence: {
          evidenceId: "e-1",
          kind: "test",
          sourceClass: "tool_output",
          provenance: "observed",
          toolOutputClass: "command_exec",
          command: "bun test",
          rawOutput: "pass",
        },
      },
    );
    const admission = admitExecutionEvidence(
      { parentSessionId: "parent-1", taskExecutionRef: ref },
      await realStore.readAll(),
    );
    expect(admission).toMatchObject({ status: "unattributed", admitted: [] });
  });

  it("rejects a task absent from an empty canonical snapshot before lifecycle persistence", async () => {
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
        canonicalSnapshot: {
          schema: "justice-plan-v1",
          documentDigest: "doc",
          globalBodyDigest: "body",
          tasks: [],
        },
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

    expect(response).toMatchObject({ action: "inject" });
    expect(sessionStateProvider.getTaskCallBinding("call-1")).toBeUndefined();
    expect((await logStore.readAll()).filter((record) => record.recordType === "observation" && record.kind === "task_lifecycle_transition")).toHaveLength(0);
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
        canonicalSnapshot: { schema: "justice-plan-v1", documentDigest: "doc", globalBodyDigest: "body", tasks: [canonicalTask] },
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
        canonicalSnapshot: { schema: "justice-plan-v1", documentDigest: "doc", globalBodyDigest: "body", tasks: [canonicalTask] },
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

  it("writes lifecycle record envelopes with the resolved shard identifiers", async () => {
    const { reader, writer } = createMemFs();
    const logStore = new ObservationLogStore(writer, reader, "w-1");
    const handler = new ObservationHandler({
      logStore,
      sessionStateProvider: new SessionStateProvider(),
      writerId: "w-1",
    });

    await handler.appendTaskLifecycleTransition({
      parentSessionId: "parent-1",
      taskExecutionRef: { authorizationId: "auth-1", taskId: "task-1", attemptId: "attempt-1" },
      from: "review_pending",
      to: "rework_required",
    });
    await handler.appendPlanFinalizationTransition({
      parentSessionId: "parent-1",
      authorizationId: "auth-1",
      planPath: "plan.md",
      finalizationAttemptId: "final-1",
      finalReviewRound: 2,
      from: "final_review_pending",
      to: "final_rework_required",
    });

    const records = await logStore.readAll();
    const lifecycleRecords = records.filter(
      (record) => record.recordType === "observation" &&
        (record.kind === "task_lifecycle_transition" || record.kind === "plan_finalization_transition"),
    );
    expect(lifecycleRecords).toHaveLength(2);
    expect(lifecycleRecords.every(
      (record) => record.agentId === "system" && record.sessionId === "parent-1" && record.writerId === "w-1",
    )).toBe(true);
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
        canonicalSnapshot: { schema: "justice-plan-v1", documentDigest: "doc", globalBodyDigest: "body", tasks: [canonicalTask] },
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
        canonicalSnapshot: { schema: "justice-plan-v1", documentDigest: "doc", globalBodyDigest: "body", tasks: [canonicalTask] },
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
