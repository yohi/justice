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
import {
  createMockFileReader,
  createMockFileWriter,
  createMockFileSystem,
} from "../helpers/mock-file-system";

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
  });
});
