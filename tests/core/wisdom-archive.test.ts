import { describe, expect, it, vi } from "vitest";
import { AtomicPersistence } from "../../src/core/atomic-persistence";
import { JusticePlugin } from "../../src/core/justice-plugin";
import { WisdomArchive, type ArchivedWisdom } from "../../src/core/wisdom-archive";
import {
  createMockFileReader,
  createMockFileWriter,
  createMockFileSystem,
} from "../helpers/mock-file-system";

describe("WisdomArchive", () => {
  it("archives high-priority entries and environment quirks only after three hits", () => {
    const archive = new WisdomArchive(
      new AtomicPersistence<readonly ArchivedWisdom[]>(
        createMockFileReader({}),
        createMockFileWriter(),
        {
          filePath: "archive.json",
          conflictPath: "archive.conflict.json",
          serialize: (data) => JSON.stringify(data),
          deserialize: (raw) => JSON.parse(raw) as readonly ArchivedWisdom[],
          merge: (mine, theirs) => [...theirs, ...mine],
          emptyValue: () => [],
          sleep: async () => {},
        },
      ),
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
        id: "w-design",
        taskId: "t",
        persona: "hephaestus",
        category: "design_decision",
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
    const thresholdDecision = archive.shouldArchive({
      id: "w-3",
      taskId: "t",
      persona: "hephaestus",
      category: "environment_quirk",
      content: "x",
      timestamp: "2026-01-01T00:00:00Z",
      hitCount: 3,
    });
    expect(thresholdDecision.archive).toBe(true);
    if (thresholdDecision.archive) {
      expect(thresholdDecision.reason).toBe("hit_count_threshold");
    }
  });

  it("appends and reloads an archived entry through persistence", async () => {
    const files = createMockFileSystem();
    const archive = new WisdomArchive(
      new AtomicPersistence<readonly ArchivedWisdom[]>(files, files, {
        filePath: "archive.json",
        conflictPath: "archive.conflict.json",
        serialize: (data) => JSON.stringify(data),
        deserialize: (raw) => JSON.parse(raw) as readonly ArchivedWisdom[],
        merge: (mine, theirs) => [...theirs, ...mine],
        emptyValue: () => [],
        sleep: async () => {},
      }),
    );
    const entry = {
      id: "w-archive",
      taskId: "task",
      persona: "hephaestus" as const,
      category: "failure_gotcha" as const,
      content: "persisted",
      timestamp: "2026-01-01T00:00:00Z",
    };

    const result = await archive.append(entry, "high_priority_category");

    expect(result.status).toBe("saved");
    const archived = (await archive.loadAll())[0];
    expect(archived).toMatchObject({
      id: "w-archive",
      taskId: "task",
      category: "failure_gotcha",
      content: "persisted",
      archiveReason: "high_priority_category",
    });
    expect(archived?.archivedAt).toEqual(expect.any(String));
    expect(archived).not.toHaveProperty("hitCount");
  });

  it("merges concurrent production archive appends by id and archivedAt", async () => {
    const files = createMockFileSystem();
    const firstPlugin = new JusticePlugin(files, files);
    const secondPlugin = new JusticePlugin(files, files);
    type TieredStoreWithLocalArchive = { readonly localArchive?: WisdomArchive };
    const firstArchive = (
      firstPlugin.getTieredWisdomStore() as unknown as TieredStoreWithLocalArchive
    ).localArchive;
    const secondArchive = (
      secondPlugin.getTieredWisdomStore() as unknown as TieredStoreWithLocalArchive
    ).localArchive;
    if (firstArchive === undefined || secondArchive === undefined) {
      throw new Error("expected JusticePlugin to create local archives");
    }

    const toISOString = vi
      .spyOn(Date.prototype, "toISOString")
      .mockImplementationOnce(() => "2026-01-01T00:00:00.001Z")
      .mockImplementationOnce(() => "2026-01-01T00:00:00.002Z");
    try {
      const [firstResult, secondResult] = await Promise.all([
        firstArchive.append(
          {
            id: "shared-id",
            taskId: "task-a",
            persona: "hephaestus",
            category: "failure_gotcha",
            content: "first archive record",
            timestamp: "2026-01-01T00:00:00Z",
          },
          "high_priority_category",
        ),
        secondArchive.append(
          {
            id: "shared-id",
            taskId: "task-b",
            persona: "hephaestus",
            category: "failure_gotcha",
            content: "second archive record",
            timestamp: "2026-01-01T00:00:01Z",
          },
          "high_priority_category",
        ),
      ]);

      expect(firstResult.status).toBe("saved");
      expect(secondResult.status).toBe("saved");
    } finally {
      toISOString.mockRestore();
    }

    const archived = await firstArchive.loadAll();
    expect(archived).toHaveLength(2);
    expect(new Set(archived.map((entry) => `${entry.id}:${entry.archivedAt}`))).toEqual(
      new Set([
        "shared-id:2026-01-01T00:00:00.001Z",
        "shared-id:2026-01-01T00:00:00.002Z",
      ]),
    );
  });

  it("replaces an existing archived entry with the same id", async () => {
    const files = createMockFileSystem();
    const archive = new WisdomArchive(
      new AtomicPersistence<readonly ArchivedWisdom[]>(files, files, {
        filePath: "archive.json",
        conflictPath: "archive.conflict.json",
        serialize: (data) => JSON.stringify(data),
        deserialize: (raw) => JSON.parse(raw) as readonly ArchivedWisdom[],
        merge: (mine, theirs) => [...theirs, ...mine],
        emptyValue: () => [],
        sleep: async () => {},
      }),
    );
    const entry = {
      id: "w-duplicate",
      taskId: "task",
      persona: "hephaestus" as const,
      category: "failure_gotcha" as const,
      content: "first",
      timestamp: "2026-01-01T00:00:00Z",
    };

    await archive.append(entry, "high_priority_category");
    await archive.append({ ...entry, content: "updated" }, "high_priority_category");

    const archived = await archive.loadAll();
    expect(archived).toHaveLength(1);
    expect(archived[0]?.content).toBe("updated");
  });
});
