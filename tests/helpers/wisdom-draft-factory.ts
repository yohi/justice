import type { WisdomEntry } from "../../src/core/types";

export function createWisdomEntry(partial: Partial<WisdomEntry> = {}): WisdomEntry {
  return {
    id: "w-test",
    taskId: "task-test",
    persona: "hephaestus",
    category: "success_pattern",
    content: "Test wisdom entry",
    timestamp: "2026-01-01T00:00:00Z",
    ...partial,
  };
}
