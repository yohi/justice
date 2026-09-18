import { describe, it, expect, beforeEach, vi } from "vitest";
import { JusticePlugin } from "../../src/core/justice-plugin";
import { mergePostToolUseResponses } from "../../src/core/hook-response-merger";
import type {
  FileReader,
  FileWriter,
  HookResponse,
  InjectResponse,
  MessageEvent,
  PreToolUseEvent,
  PostToolUseEvent,
  EventEvent,
} from "../../src/core/types";
import { createMockFileSystem } from "../helpers/mock-file-system";
import { ObservationLogStore } from "../../src/runtime/observation-log-store";
import {
  appendTaskLifecycleTransition,
  type TaskLifecycleTransitionInput,
} from "../../src/core/task-lifecycle";
import type { ApprovedPlanBinding } from "../../src/core/plan-authorization";

describe("JusticePlugin", () => {
  let reader: FileReader;
  let writer: FileWriter;
  let plugin: JusticePlugin;

  beforeEach(() => {
    const fs = createMockFileSystem({
      "plan.md": "## Task 1: Setup\n- [ ] Init\n",
    });
    reader = fs;
    writer = fs;
    plugin = new JusticePlugin(reader, writer);
  });

  it("refreshes the projection cache during initialization", async () => {
    const observationHandler = plugin.getObservationHandler() as unknown as {
      initializeProjectionCache: () => Promise<void>;
    };
    const refresh = vi.spyOn(observationHandler, "initializeProjectionCache").mockResolvedValue();

    await plugin.initialize();

    expect(refresh).toHaveBeenCalledOnce();
  });

  it("restores authorizations before loading wisdom and projections", async () => {
    const order: string[] = [];
    vi.spyOn(plugin.getPlanBridge(), "restoreActivePlans").mockImplementation(async () => {
      order.push("authorization");
      return "authoritative";
    });
    vi.spyOn(plugin.getTieredWisdomStore(), "loadAll").mockImplementation(async () => {
      order.push("wisdom");
    });
    vi.spyOn(plugin.getObservationHandler(), "initializeProjectionCache").mockImplementation(async () => {
      order.push("projection");
    });

    await plugin.initialize();

    expect(order.slice(0, 3)).toEqual(["authorization", "wisdom", "projection"]);
  });

  it("fails open when the observation authorization lookup throws", async () => {
    const authorizationStore = (plugin as unknown as {
      authorizationStore: {
        findByAuthorizationId: (authorizationId: string) => Promise<ApprovedPlanBinding | null>;
      };
    }).authorizationStore;
    vi.spyOn(authorizationStore, "findByAuthorizationId").mockRejectedValue(
      new Error("authorization lookup failed"),
    );

    const handlerOptions = (plugin.getObservationHandler() as unknown as {
      options: {
        findAuthorizationById?: (
          authorizationId: string,
        ) => Promise<ApprovedPlanBinding | null>;
      };
    }).options;
    const findAuthorizationById = handlerOptions.findAuthorizationById;
    if (findAuthorizationById === undefined) throw new Error("authorization callback is missing");

    await expect(findAuthorizationById("auth-1")).resolves.toBeNull();
  });

  describe("mergePostToolUseResponses", () => {
    const proceed: HookResponse = { action: "proceed" };
    const skip: HookResponse = { action: "skip" };
    const inject = (injectedContext: string): HookResponse => ({
      action: "inject",
      injectedContext,
      normalInjectedContext: injectedContext,
    });

    it("should merge proceed + proceed into proceed", () => {
      const result = mergePostToolUseResponses([proceed, proceed]);

      expect(result).toEqual({ action: "proceed" });
      expect(result).not.toBe(proceed);
    });

    it("should merge inject + proceed into inject", () => {
      const a = inject("from-a");
      const result = mergePostToolUseResponses([a, proceed]);

      expect(result).toEqual(a);
      expect(result).not.toBe(a);
    });

    it("should merge proceed + inject into inject", () => {
      const b = inject("from-b");
      const result = mergePostToolUseResponses([proceed, b]);

      expect(result).toEqual(b);
      expect(result).not.toBe(b);
    });

    it("should merge inject + inject into concatenated inject", () => {
      const result = mergePostToolUseResponses([inject("from-a"), inject("from-b")]);

      expect(result).toEqual({
        action: "inject",
        injectedContext: "from-a\n\n---\n\nfrom-b",
        normalInjectedContext: "from-a\n\n---\n\nfrom-b",
      });
    });

    it("should return skip when the left response is skip", () => {
      const result = mergePostToolUseResponses([skip, inject("from-b")]);

      expect(result).toEqual({ action: "skip" });
    });

    it("should return skip when the right response is skip", () => {
      const result = mergePostToolUseResponses([inject("from-a"), skip]);

      expect(result).toEqual({ action: "skip" });
    });

    it("should preserve empty injected contexts when concatenating", () => {
      const result = mergePostToolUseResponses([inject(""), inject("tail")]);

      expect(result).toEqual({
        action: "inject",
        injectedContext: "tail",
        normalInjectedContext: "tail",
      });
    });

    it("should preserve modifiedPayload when merging a single inject response", () => {
      const a: InjectResponse = {
        action: "inject",
        injectedContext: "from-a",
        normalInjectedContext: "from-a",
        modifiedPayload: { args: { loadSkills: ["skill-a"] } },
      };
      const result = mergePostToolUseResponses([a, proceed]);

      expect(result).toEqual(a);
      expect(result).not.toBe(a);
    });

    it("should preserve modifiedPayload from left on double inject merge", () => {
      const a: InjectResponse = {
        action: "inject",
        injectedContext: "from-a",
        modifiedPayload: { key: "a" },
      };
      const b: InjectResponse = {
        action: "inject",
        injectedContext: "from-b",
      };
      const result = mergePostToolUseResponses([a, b]);

      expect(result).toEqual({
        action: "inject",
        injectedContext: "from-a\n\n---\n\nfrom-b",
        normalInjectedContext: "from-a\n\n---\n\nfrom-b",
        modifiedPayload: { key: "a" },
      });
    });

    it("should preserve modifiedPayload from right on double inject merge when left is absent", () => {
      const a: InjectResponse = {
        action: "inject",
        injectedContext: "from-a",
      };
      const b: InjectResponse = {
        action: "inject",
        injectedContext: "from-b",
        modifiedPayload: { key: "b" },
      };
      const result = mergePostToolUseResponses([a, b]);

      expect(result).toEqual({
        action: "inject",
        injectedContext: "from-a\n\n---\n\nfrom-b",
        normalInjectedContext: "from-a\n\n---\n\nfrom-b",
        modifiedPayload: { key: "b" },
      });
    });

    it("should keep the first modifiedPayload when both inject responses carry one", () => {
      const a: InjectResponse = {
        action: "inject",
        injectedContext: "from-a",
        modifiedPayload: { key: "a", extra: true },
      };
      const b: InjectResponse = {
        action: "inject",
        injectedContext: "from-b",
        modifiedPayload: { key: "b" },
      };

      expect(mergePostToolUseResponses([a, b])).toEqual({
        action: "inject",
        injectedContext: "from-a\n\n---\n\nfrom-b",
        normalInjectedContext: "from-a\n\n---\n\nfrom-b",
        modifiedPayload: { key: "a", extra: true },
      });
    });
  });

  describe("handleEvent", () => {
    it("should route Message events to PlanBridge", async () => {
      const spy = vi.spyOn(plugin.getPlanBridge(), "handleMessage");
      const event: MessageEvent = {
        type: "Message",
        payload: { role: "assistant", content: "Delegate the next task from plan.md" },
        sessionId: "s-1",
      };
      await plugin.handleEvent(event);
      expect(spy).toHaveBeenCalledWith(event);
    });

    it("should route PreToolUse events to PlanBridge", async () => {
      const spy = vi.spyOn(plugin.getPlanBridge(), "handlePreToolUse");
      const event: PreToolUseEvent = {
        type: "PreToolUse",
        payload: { toolName: "task", toolInput: {} },
        sessionId: "s-1",
      };
      await plugin.handleEvent(event);
      expect(spy).toHaveBeenCalledWith(event);
    });

    it("uses the authorization-scoped lifecycle state when resuming rework", async () => {
      const parentSessionId = "parent-1";
      const taskId = "task-1";
      const authorizationId = "auth-1";
      const writerId = "w-lifecycle";
      const binding = {
        authorizationId,
        sessionId: parentSessionId,
        planPath: "plan.md",
        planFingerprint: { algorithm: "sha256", value: "plan-fingerprint" },
        canonicalSnapshot: {
          schema: "justice-plan-v1",
          documentDigest: "document-digest",
          globalBodyDigest: "body-digest",
          tasks: [{ taskId, title: "Rework", canonicalBody: "## Task 1: Rework", digest: "digest" }],
        },
        fingerprintSchema: "justice-plan-v1",
        approvedAt: "2026-01-01T00:00:00.000Z",
        status: "active",
      } satisfies ApprovedPlanBinding;
      const fs = createMockFileSystem({
        "plan.md": "## Task 1: Rework\n- [ ] Fix\n",
        ".justice/authorizations.json": JSON.stringify([binding]),
      });
      const testPlugin = new JusticePlugin(fs, fs, { writerId });
      const logStore = new ObservationLogStore(fs, fs, writerId);
      const taskExecutionRef = { authorizationId, taskId, attemptId: "attempt-1" };
      const shardId = { agentId: "unknown" as const, sessionId: parentSessionId, writerId };
      const transitions: readonly TaskLifecycleTransitionInput[] = [
        { agentId: "unknown", sessionId: parentSessionId, writerId, parentSessionId, taskExecutionRef, from: "pending", to: "authorized" },
        { agentId: "unknown", sessionId: parentSessionId, writerId, parentSessionId, taskExecutionRef, from: "authorized", to: "in_progress" },
        { agentId: "unknown", sessionId: parentSessionId, writerId, parentSessionId, taskExecutionRef, from: "in_progress", to: "worker_reported" },
        { agentId: "unknown", sessionId: parentSessionId, writerId, parentSessionId, taskExecutionRef, from: "worker_reported", to: "evidence_pending" },
        { agentId: "unknown", sessionId: parentSessionId, writerId, parentSessionId, taskExecutionRef, from: "evidence_pending", to: "review_pending" },
        { agentId: "unknown", sessionId: parentSessionId, writerId, parentSessionId, taskExecutionRef, from: "review_pending", to: "rework_required" },
      ];

      for (const transition of transitions) {
        await appendTaskLifecycleTransition(transition, (record) => logStore.append(shardId, record));
      }

      await testPlugin.handleEvent({
        type: "PreToolUse",
        payload: { toolName: "task", toolInput: { task_id: taskId } },
        sessionId: parentSessionId,
        callId: "call-1",
      });

      const lifecycleRecords = (await logStore.readAll()).filter(
        (record) => record.recordType === "observation" && record.kind === "task_lifecycle_transition",
      );
      expect(lifecycleRecords).toHaveLength(transitions.length + 1);
      expect(lifecycleRecords[lifecycleRecords.length - 1]).toMatchObject({
        parentSessionId,
        from: "rework_required",
        to: "in_progress",
        taskExecutionRef: { authorizationId, taskId },
      });
    });

    it("should route PostToolUse events to TaskFeedbackHandler", async () => {
      const spy = vi.spyOn(plugin.getTaskFeedback(), "handlePostToolUse");
      const event: PostToolUseEvent = {
        type: "PostToolUse",
        payload: { toolName: "task", toolResult: "All tests passed", error: false },
        sessionId: "s-1",
      };
      await plugin.handleEvent(event);
      expect(spy).toHaveBeenCalledWith(event);
    });

    it("should route Event (loop-detector) to LoopDetectionHandler", async () => {
      const spy = vi.spyOn(plugin.getLoopHandler(), "handleEvent");
      const event: EventEvent = {
        type: "Event",
        payload: { eventType: "loop-detector", sessionId: "s-1", message: "Loop detected" },
        sessionId: "s-1",
      };
      await plugin.handleEvent(event);
      expect(spy).toHaveBeenCalledWith(event);
    });

    it("should route Event (compaction) to CompactionProtector", async () => {
      // First set active plan via message so compaction does something
      const msgEvent: MessageEvent = {
        type: "Message",
        payload: { role: "assistant", content: "Delegate the next task from plan.md" },
        sessionId: "s-1",
      };
      await plugin.handleEvent(msgEvent);

      const spySnapshot = vi.spyOn(plugin.getCompactionProtector(), "createSnapshot");
      const spyFormat = vi.spyOn(plugin.getCompactionProtector(), "formatForInjection");

      const event: EventEvent = {
        type: "Event",
        payload: { eventType: "compaction", sessionId: "s-1", reason: "Context too long" },
        sessionId: "s-1",
      };
      const response = await plugin.handleEvent(event);

      expect(spySnapshot).toHaveBeenCalled();
      expect(spyFormat).toHaveBeenCalled();
      expect(response.action).toBe("inject");
    });

    it("should share TieredWisdomStore across handlers", () => {
      const planBridgeStore = (plugin.getPlanBridge() as unknown as { wisdomStore: unknown })
        .wisdomStore;
      const taskFeedbackStore = (plugin.getTaskFeedback() as unknown as { wisdomStore: unknown })
        .wisdomStore;
      const protectorStore = (
        plugin.getCompactionProtector() as unknown as { wisdomStore: unknown }
      ).wisdomStore;

      const tieredStore = plugin.getTieredWisdomStore();

      expect(planBridgeStore).toBe(tieredStore);
      expect(taskFeedbackStore).toBe(tieredStore);
      expect(protectorStore).toBe(tieredStore);
    });
  });

  describe("session cleanup propagation", () => {
    it("awaits persistence during explicit session destruction", async () => {
      const tiered = plugin.getTieredWisdomStore();
      const persist = vi.spyOn(tiered, "persistAll").mockResolvedValue();
      const telemetry = (plugin as unknown as { telemetry: { save: () => Promise<void> } })
        .telemetry;
      const save = vi.spyOn(telemetry, "save").mockResolvedValue();
      const remove = vi.spyOn(plugin.getLoopHandler(), "removeSession");

      const destruction = plugin.destroySession("s-explicit");

      expect(destruction).toBeInstanceOf(Promise);
      await destruction;
      expect(persist).toHaveBeenCalledOnce();
      expect(save).toHaveBeenCalledOnce();
      expect(remove).toHaveBeenCalledWith("s-explicit");
    });

    it("propagates session removal from LoopDetectionHandler to SessionStateProvider", () => {
      const loopHandler = plugin.getLoopHandler();
      const sessionProvider = plugin.getSessionStateProvider();
      const removeSpy = vi.spyOn(sessionProvider, "removeSession");

      // MAX_SESSIONS is 50; adding 51 sessions forces cleanup of the oldest one.
      for (let i = 0; i < 51; i++) {
        loopHandler.setActivePlan(`s-${i}`, "plan.md", "task-1", "hephaestus");
      }

      expect(removeSpy).toHaveBeenCalledWith("s-0");
    });

    it("clears TaskFeedback active plans when a session is removed", () => {
      const sessionId = "s-task-feedback";
      const taskFeedback = plugin.getTaskFeedback();
      const taskFeedbackSessions = taskFeedback as unknown as {
        readonly sessions: ReadonlyMap<string, unknown>;
      };

      taskFeedback.setActivePlan(sessionId, "plan.md", "task-1");
      expect(taskFeedbackSessions.sessions.has(sessionId)).toBe(true);

      plugin.getLoopHandler().removeSession(sessionId);

      expect(taskFeedbackSessions.sessions.has(sessionId)).toBe(false);
    });
  });

  describe("wisdom store integration", () => {
    it("getWisdomStore() should return the local store (backwards compatible)", () => {
      const tiered = plugin.getTieredWisdomStore();
      expect(plugin.getWisdomStore()).toBe(tiered.getLocalStore());
    });

    it("getTieredWisdomStore() should return a TieredWisdomStore whose localStore is the same as getWisdomStore()", () => {
      const tiered = plugin.getTieredWisdomStore();
      expect(tiered.getLocalStore()).toBe(plugin.getWisdomStore());
      // Default construction uses NoOpPersistence for global, so the global store starts empty.
      expect(tiered.getGlobalStore().getAllEntries()).toHaveLength(0);
    });

    it("when no globalFileSystem is provided, global writes stay in-memory (fail-open)", () => {
      const tiered = plugin.getTieredWisdomStore();
      tiered.add({
        taskId: "t",
        category: "environment_quirk",
        content: "Bun X.Y.Z quirk",
      });
      expect(tiered.getGlobalStore().getAllEntries()).toHaveLength(1);
      // Still fine — persistAll should not throw because NoOpPersistence is used.
      return expect(tiered.persistAll()).resolves.toBeUndefined();
    });

    it("should write to the expected path when globalFileSystem is provided", async () => {
      const globalFs = createMockFileSystem();
      const options = {
        globalFileSystem: {
          fs: globalFs,
          relativePath: "global-wisdom.json",
        },
      };
      const p = new JusticePlugin(reader, writer, options);
      const tiered = p.getTieredWisdomStore();

      tiered.add({
        taskId: "t-global",
        category: "environment_quirk",
        content: "Global wisdom content",
      });

      await tiered.persistAll();

      // Check if the mock globalFs received the write
      const writtenContent = await globalFs.readFile("global-wisdom.json");
      expect(writtenContent).toContain("Global wisdom content");
      expect(writtenContent).toContain("t-global");
    });
  });

  describe("initialize", () => {
    it("should call loadAll on TieredWisdomStore during initialize", async () => {
      const tiered = plugin.getTieredWisdomStore();
      const spy = vi.spyOn(tiered, "loadAll");
      await plugin.initialize();
      expect(spy).toHaveBeenCalled();
    });

    it("restores active plans before the existing initialization path", async () => {
      const restore = vi.spyOn(plugin.getPlanBridge(), "restoreActivePlans").mockResolvedValue("authoritative");
      const loadAll = vi.spyOn(plugin.getTieredWisdomStore(), "loadAll").mockResolvedValue();
      const projection = vi
        .spyOn(plugin.getObservationHandler(), "initializeProjectionCache")
        .mockResolvedValue();

      await plugin.initialize();

      expect(restore).toHaveBeenCalledOnce();
      expect(loadAll).toHaveBeenCalledOnce();
      expect(projection).toHaveBeenCalledOnce();
    });

    it("continues initialization when active-plan restoration rejects", async () => {
      vi.spyOn(plugin.getPlanBridge(), "restoreActivePlans").mockRejectedValue(
        new Error("restore failed"),
      );
      const loadAll = vi.spyOn(plugin.getTieredWisdomStore(), "loadAll").mockResolvedValue();
      const projection = vi
        .spyOn(plugin.getObservationHandler(), "initializeProjectionCache")
        .mockResolvedValue();

      await expect(plugin.initialize()).resolves.toBeUndefined();
      expect(loadAll).toHaveBeenCalledOnce();
      expect(projection).toHaveBeenCalledOnce();
    });
  });
});
