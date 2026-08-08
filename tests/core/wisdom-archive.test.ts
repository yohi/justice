import { describe, expect, it } from "vitest";
import { AtomicPersistence } from "../../src/core/atomic-persistence";
import { WisdomArchive, type ArchivedWisdom } from "../../src/core/wisdom-archive";
import { createMockFileReader, createMockFileWriter } from "../helpers/mock-file-system";

describe("WisdomArchive", () => {
  it("archives high-priority entries and environment quirks only after three hits", () => {
    const archive = new WisdomArchive(
      new AtomicPersistence<readonly ArchivedWisdom[]>(createMockFileReader({}), createMockFileWriter(), {
        filePath: "archive.json",
        conflictPath: "archive.conflict.json",
        serialize: (data) => JSON.stringify(data),
        deserialize: (raw) => JSON.parse(raw) as readonly ArchivedWisdom[],
        merge: (mine, theirs) => [...theirs, ...mine],
        emptyValue: () => [],
        sleep: async () => {},
      }),
    );

    expect(
      archive.shouldArchive({
        id: "w-1",
        taskId: "t",
        persona: "hephaestus",
        category: "failure_gotcha",
        content: "x",
        timestamp: "2026-01-01T00:00:00Z",
      }).archive,
    ).toBe(true);
    expect(
      archive.shouldArchive({
        id: "w-2",
        taskId: "t",
        persona: "hephaestus",
        category: "environment_quirk",
        content: "x",
        timestamp: "2026-01-01T00:00:00Z",
        hitCount: 2,
      }).archive,
    ).toBe(false);
  });
});
