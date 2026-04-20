import { describe, it, expect, beforeEach, vi } from "vitest";
import { JusticePlugin } from "../../src/core/justice-plugin";
import type {
  FileReader,
  FileWriter,
  MessageEvent,
  PreToolUseEvent,
  PostToolUseEvent,
  EventEvent,
} from "../../src/core/types";
import { createMockFileReader, createMockFileWriter } from "../helpers/mock-file-system";

describe("JusticePlugin", () => {
  let reader: FileReader;
  let writer: FileWriter;
  let plugin: JusticePlugin;

  beforeEach(() => {
    reader = createMockFileReader({
      "plan.md": "## Task 1: Setup\n- [ ] Init\n",
    });
    writer = createMockFileWriter();
    plugin = new JusticePlugin(reader, writer);
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

    it("should share WisdomStore across handlers", () => {
      // Access store via JusticePlugin, and indirectly via handlers if exposed.
      // Since handlers don't expose getWisdomStore(), we test using JusticePlugin's accessor
      // which we know passes it to handlers. We can verify sharing by testing the global WisdomStore.
      // The instructions say: "fetch the WisdomStore from the PlanBridge and from TaskFeedback ... and assert strict equality"
      // Wait, PlanBridge and TaskFeedback don't have getWisdomStore() accessors.
      // We will access them by casting to any to satisfy the prompt's spirit, or just rely on the fact
      // they share the instance created in the constructor. Let's cast to any to prove equality.
      const planBridgeStore = (plugin.getPlanBridge() as unknown as { wisdomStore: unknown })
        .wisdomStore;
      const taskFeedbackStore = (plugin.getTaskFeedback() as unknown as { wisdomStore: unknown })
        .wisdomStore;
      const protectorStore = (
        plugin.getCompactionProtector() as unknown as { wisdomStore: unknown }
      ).wisdomStore;

      const mainStore = plugin.getWisdomStore();

      expect(planBridgeStore).toBe(mainStore);
      expect(taskFeedbackStore).toBe(mainStore);
      expect(protectorStore).toBe(mainStore);
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
  });
});
