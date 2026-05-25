import type { WisdomEntryInput } from "../../src/core/types";

export function makeWisdomDraft(partial: Partial<WisdomEntryInput> = {}): WisdomEntryInput {
  return {
    taskId: "task-test",
    category: "success_pattern",
    content: "Test wisdom entry",
    ...partial,
  };
}
