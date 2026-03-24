import { describe, it, expect } from "vitest";
import { WisdomStore } from "../../src/core/wisdom-store";
import type { WisdomEntry } from "../../src/core/types";

describe("WisdomStore", () => {
  describe("add", () => {
    it("should add a wisdom entry and auto-generate id and timestamp", () => {
      const store = new WisdomStore();
      const entry = store.add({
        taskId: "task-1",
        category: "success_pattern",
        content: "Used Promise.all for parallel fetching",
      });

      expect(entry.id).toBeTypeOf("string");
      expect(entry.id.length).toBeGreaterThan(0);
      expect(entry.timestamp).toBeTypeOf("string");
      expect(entry.taskId).toBe("task-1");
      expect(entry.category).toBe("success_pattern");
      expect(entry.content).toBe("Used Promise.all for parallel fetching");
      
      const entries = store.getByTaskId("task-1");
      expect(entries).toHaveLength(1);
      expect(entries[0]).toEqual(entry);
    });

    it("should limit entries to maxEntries and evict oldest first", () => {
      const store = new WisdomStore(2); // max 2 entries
      
      store.add({ taskId: "t1", category: "success_pattern", content: "first" });
      store.add({ taskId: "t2", category: "failure_gotcha", content: "second" });
      expect(store.getRelevant()).toHaveLength(2);

      // This should evict the first one
      store.add({ taskId: "t3", category: "design_decision", content: "third" });
      
      const all = store.getRelevant();
      expect(all).toHaveLength(2);
      expect(all.some(e => e.taskId === "t1")).toBe(false); // First is gone
      expect(all.some(e => e.taskId === "t2")).toBe(true);
      expect(all.some(e => e.taskId === "t3")).toBe(true);
    });
  });

  describe("getByTaskId", () => {
    it("should return entries for a specific task", () => {
      const store = new WisdomStore();
      store.add({ taskId: "common-task", category: "success_pattern", content: "A" });
      store.add({ taskId: "other-task", category: "failure_gotcha", content: "B" });
      store.add({ taskId: "common-task", category: "design_decision", content: "C" });

      const results = store.getByTaskId("common-task");
      expect(results).toHaveLength(2);
      expect(results.every(r => r.taskId === "common-task")).toBe(true);
    });

    it("should return empty array for unknown task", () => {
      const store = new WisdomStore();
      expect(store.getByTaskId("unknown")).toHaveLength(0);
    });
  });

  describe("getRelevant", () => {
    it("should return all entries when no options are specified", () => {
      const store = new WisdomStore();
      store.add({ taskId: "t1", category: "success_pattern", content: "A" });
      store.add({ taskId: "t2", category: "failure_gotcha", content: "B", errorClass: "syntax_error" });
      
      expect(store.getRelevant()).toHaveLength(2);
    });

    it("should return entries matching the given errorClass", () => {
      const store = new WisdomStore();
      store.add({ taskId: "t1", category: "failure_gotcha", content: "A", errorClass: "syntax_error" });
      store.add({ taskId: "t2", category: "failure_gotcha", content: "B", errorClass: "type_error" });
      store.add({ taskId: "t3", category: "success_pattern", content: "C" });

      const results = store.getRelevant({ errorClass: "syntax_error" });
      expect(results).toHaveLength(1);
      expect(results[0]?.errorClass).toBe("syntax_error");
    });

    it("should limit results to options.maxEntries", () => {
      const store = new WisdomStore();
      store.add({ taskId: "t1", category: "success_pattern", content: "A" });
      store.add({ taskId: "t2", category: "success_pattern", content: "B" });
      store.add({ taskId: "t3", category: "success_pattern", content: "C" });

      // Gets most recent 2
      const results = store.getRelevant({ maxEntries: 2 });
      expect(results).toHaveLength(2);
      expect(results[0]?.taskId).toBe("t2");
      expect(results[1]?.taskId).toBe("t3");
    });
  });

  describe("formatForInjection", () => {
    it("should format entries as Markdown for prompt injection", () => {
      const store = new WisdomStore();
      const entry: WisdomEntry = {
        id: "w-123",
        taskId: "task-test",
        category: "failure_gotcha",
        content: "Don't forget to await the database connection.",
        errorClass: "type_error",
        timestamp: "2024-01-01T00:00:00Z"
      };

      const formatted = store.formatForInjection([entry]);
      
      expect(formatted).toContain("Failure/Gotcha");    // human-readable label
      expect(formatted).toContain("Don't forget to await");
      expect(formatted).toContain("type_error");
      expect(formatted).toContain("task-test");
    });

    it("should return empty string for no entries", () => {
      const store = new WisdomStore();
      expect(store.formatForInjection([])).toBe("");
    });
  });

  describe("serialize / deserialize", () => {
    it("should round-trip through JSON serialization", () => {
      const original = new WisdomStore(50);
      original.add({ taskId: "t1", category: "success_pattern", content: "Great code" });
      original.add({ taskId: "t2", category: "failure_gotcha", content: "Bad code", errorClass: "syntax_error" });

      const json = original.serialize();
      expect(typeof json).toBe("string");

      const restored = WisdomStore.deserialize(json);
      
      const allRestored = restored.getRelevant();
      expect(allRestored).toHaveLength(2);
      expect(allRestored[0]?.content).toBe("Great code");
      expect(allRestored[1]?.errorClass).toBe("syntax_error");
      
      // Check maxEntries was restored or kept
      restored.add({ taskId: "t3", category: "design_decision", content: "New code" });
      expect(restored.getRelevant()).toHaveLength(3);
    });

    it("should handle empty store during deserialize", () => {
      const store = WisdomStore.deserialize("");
      expect(store.getRelevant()).toHaveLength(0);

      const store2 = WisdomStore.deserialize("{}");
      expect(store2.getRelevant()).toHaveLength(0);
    });
  });
});
