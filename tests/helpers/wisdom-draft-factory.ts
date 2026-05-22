import { randomBytes } from "node:crypto";
import type { WisdomEntry } from "../../src/core/types";

export function createWisdomEntry(partial: Partial<WisdomEntry> = {}): WisdomEntry {
  const uniqueSuffix = randomBytes(4).toString("hex");
  return {
    id: `w-test-${uniqueSuffix}`,
    taskId: "task-test",
    persona: "hephaestus",
    category: "success_pattern",
    content: "Test wisdom entry",
    timestamp: "2026-01-01T00:00:00Z",
    ...partial,
  };
}
