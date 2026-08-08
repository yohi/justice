import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { TieredWisdomStore } from "../../src/core/tiered-wisdom-store";
import { WisdomStore } from "../../src/core/wisdom-store";
import { WisdomPersistence } from "../../src/core/wisdom-persistence";
import { SecretPatternDetector } from "../../src/core/secret-pattern-detector";
import { AtomicPersistence } from "../../src/core/atomic-persistence";
import { WisdomArchive, type ArchivedWisdom } from "../../src/core/wisdom-archive";
import { createMockFileReader, createMockFileWriter, createMockFileSystem } from "../helpers/mock-file-system";

function makeLogger(): { warn: Mock; error: Mock } {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    warn: vi.fn() as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    error: vi.fn() as any,
  };
}

function makeTiered(opts?: {
  localStore?: WisdomStore;
  globalStore?: WisdomStore;
  globalDisplayPath?: string;
  logger?: ReturnType<typeof makeLogger>;
}): {
  tiered: TieredWisdomStore;
  localStore: WisdomStore;
  globalStore: WisdomStore;
  localPersistence: WisdomPersistence;
  globalPersistence: WisdomPersistence;
  logger: ReturnType<typeof makeLogger>;
} {
  const localStore = opts?.localStore ?? new WisdomStore(100);
  const globalStore = opts?.globalStore ?? new WisdomStore(500);
  const localPersistence = new WisdomPersistence(
    createMockFileReader({}),
    createMockFileWriter(),
    ".justice/wisdom.json",
  );
  const globalPersistence = new WisdomPersistence(
    createMockFileReader({}),
    createMockFileWriter(),
    "wisdom.json",
  );
  const logger = opts?.logger ?? makeLogger();

  const tiered = new TieredWisdomStore({
    localStore,
    globalStore,
    localPersistence,
    globalPersistence,
    secretDetector: new SecretPatternDetector(),
    globalDisplayPath: opts?.globalDisplayPath ?? "~/.justice/wisdom.json",
    logger,
  });
  return { tiered, localStore, globalStore, localPersistence, globalPersistence, logger };
}

describe("TieredWisdomStore — routing (add)", () => {
  let tiered: TieredWisdomStore;
  let localStore: WisdomStore;
  let globalStore: WisdomStore;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    const setup = makeTiered();
    tiered = setup.tiered;
    localStore = setup.localStore;
    globalStore = setup.globalStore;
    logger = setup.logger;

    vi.spyOn(localStore, "add");
    vi.spyOn(globalStore, "add");
  });

  it.each([
    { category: "environment_quirk", expected: "global" },
    { category: "success_pattern", expected: "global" },
    { category: "failure_gotcha", expected: "local" },
    { category: "design_decision", expected: "local" },
  ] as const)("should route $category to $expected store by default", ({ category, expected }) => {
    tiered.add({ taskId: "t", category, content: "content" });

    if (expected === "global") {
      expect(globalStore.add).toHaveBeenCalledTimes(1);
      expect(localStore.add).not.toHaveBeenCalled();
    } else {
      expect(localStore.add).toHaveBeenCalledTimes(1);
      expect(globalStore.add).not.toHaveBeenCalled();
    }
  });

  it.each([
    { category: "environment_quirk", scope: "local", expected: "local" },
    { category: "failure_gotcha", scope: "global", expected: "global" },
  ] as const)(
    "should honor explicit scope=$scope for $category",
    ({ category, scope, expected }) => {
      tiered.add({ taskId: "t", category, content: "content" }, { scope });

      if (expected === "global") {
        expect(globalStore.add).toHaveBeenCalledTimes(1);
        expect(localStore.add).not.toHaveBeenCalled();
      } else {
        expect(localStore.add).toHaveBeenCalledTimes(1);
        expect(globalStore.add).not.toHaveBeenCalled();
      }
    },
  );

  it("should log warn and cancel promotion when an entry with secrets is targeted for global", () => {
    tiered.add({
      taskId: "t",
      category: "success_pattern",
      content: "remember to set ANTHROPIC_API_KEY",
    });

    expect(logger.warn).toHaveBeenCalledTimes(1);
    const msg = logger.warn.mock.calls[0]?.[0] as string;
    expect(msg).toContain("potential secrets detected");
    expect(msg).toContain("api_key");
    expect(msg).toContain("Promotion canceled");

    // Ensure it was redirected to the local store
    expect(globalStore.add).not.toHaveBeenCalled();
    expect(localStore.add).toHaveBeenCalledTimes(1);
  });

  it("should NOT log warn when entry stays local even if it looks like a secret", () => {
    tiered.add({
      taskId: "t",
      category: "failure_gotcha",
      content: "API_KEY not set — but this is local scope",
    });

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("should expose getLocalStore() and getGlobalStore() for direct access", () => {
    expect(tiered.getLocalStore()).toBe(localStore);
    expect(tiered.getGlobalStore()).toBe(globalStore);
  });
});

describe("TieredWisdomStore — persona propagation on add", () => {
  it("should auto-classify persona when add is called without persona", () => {
    const { tiered, globalStore } = makeTiered();

    const entry = tiered.add({
      taskId: "t",
      category: "environment_quirk",
      content: "quirk",
    });

    expect(entry.persona).toBe("sisyphus");
    expect(globalStore.getAllEntries()[0]?.persona).toBe("sisyphus");
  });

  it("should preserve an explicit persona instead of reclassifying it", () => {
    const { tiered, globalStore } = makeTiered();

    const entry = tiered.add({
      taskId: "t",
      category: "environment_quirk",
      content: "quirk",
      persona: "atlas",
    });

    expect(entry.persona).toBe("atlas");
    expect(globalStore.getAllEntries()[0]?.persona).toBe("atlas");
  });
});

describe("TieredWisdomStore — read merge (getRelevant)", () => {
  it("should return only local entries when local already satisfies maxEntries", () => {
    const localStore = new WisdomStore(100);
    for (let i = 0; i < 12; i++) {
      localStore.add({ taskId: `lt${i}`, category: "failure_gotcha", content: `local ${i}` });
    }
    const globalStore = new WisdomStore(500);
    for (let i = 0; i < 5; i++) {
      globalStore.add({ taskId: `gt${i}`, category: "success_pattern", content: `global ${i}` });
    }

    const { tiered } = makeTiered({ localStore, globalStore });
    const merged = tiered.getRelevant({ maxEntries: 10 });
    expect(merged).toHaveLength(10);
    for (const e of merged) expect(e.content.startsWith("local")).toBe(true);
  });

  it("should merge local + global when local has fewer than maxEntries", () => {
    const localStore = new WisdomStore(100);
    for (let i = 0; i < 3; i++) {
      localStore.add({ taskId: `lt${i}`, category: "failure_gotcha", content: `local ${i}` });
    }
    const globalStore = new WisdomStore(500);
    for (let i = 0; i < 20; i++) {
      globalStore.add({ taskId: `gt${i}`, category: "success_pattern", content: `global ${i}` });
    }

    const { tiered } = makeTiered({ localStore, globalStore });
    const merged = tiered.getRelevant({ maxEntries: 10 });

    expect(merged).toHaveLength(10);
    const localCount = merged.filter((e) => e.content.startsWith("local")).length;
    const globalCount = merged.filter((e) => e.content.startsWith("global")).length;
    expect(localCount).toBe(3);
    expect(globalCount).toBe(7);
  });

  it("should apply errorClass filter to both stores before merging", () => {
    const localStore = new WisdomStore(100);
    localStore.add({
      taskId: "lt1",
      category: "failure_gotcha",
      content: "local-tf",
      errorClass: "test_failure",
    });
    localStore.add({
      taskId: "lt2",
      category: "failure_gotcha",
      content: "local-timeout",
      errorClass: "timeout",
    });
    const globalStore = new WisdomStore(500);
    globalStore.add({
      taskId: "gt1",
      category: "success_pattern",
      content: "global-tf",
      errorClass: "test_failure",
    });

    const { tiered } = makeTiered({ localStore, globalStore });
    const merged = tiered.getRelevant({ maxEntries: 10, errorClass: "test_failure" });

    expect(merged).toHaveLength(2);
    for (const e of merged) expect(e.errorClass).toBe("test_failure");
  });

  it("should filter by persona across local and global stores", () => {
    const localStore = new WisdomStore(100);
    localStore.add({
      taskId: "lt1",
      category: "failure_gotcha",
      content: "local-hephaestus",
      persona: "hephaestus",
    });
    localStore.add({
      taskId: "lt2",
      category: "failure_gotcha",
      content: "local-atlas",
      persona: "atlas",
    });

    const globalStore = new WisdomStore(500);
    globalStore.add({
      taskId: "gt1",
      category: "success_pattern",
      content: "global-hephaestus",
      persona: "hephaestus",
    });
    globalStore.add({
      taskId: "gt2",
      category: "success_pattern",
      content: "global-sisyphus",
      persona: "sisyphus",
    });

    const { tiered } = makeTiered({ localStore, globalStore });
    const merged = tiered.getRelevant({ maxEntries: 10, persona: "hephaestus" });

    expect(merged).toHaveLength(2);
    expect(merged.map((e) => e.persona)).toEqual(["hephaestus", "hephaestus"]);
    expect(merged.map((e) => e.content)).toEqual(["local-hephaestus", "global-hephaestus"]);
  });

  it("should default maxEntries to 10 when omitted", () => {
    const localStore = new WisdomStore(100);
    for (let i = 0; i < 5; i++) {
      localStore.add({ taskId: `lt${i}`, category: "failure_gotcha", content: `l${i}` });
    }
    const globalStore = new WisdomStore(500);
    for (let i = 0; i < 20; i++) {
      globalStore.add({ taskId: `gt${i}`, category: "success_pattern", content: `g${i}` });
    }
    const { tiered } = makeTiered({ localStore, globalStore });
    expect(tiered.getRelevant()).toHaveLength(10);
  });
});

describe("TieredWisdomStore — getByTaskId / formatForInjection", () => {
  it("should aggregate entries from both stores when the same taskId appears in both", () => {
    const localStore = new WisdomStore(100);
    localStore.add({ taskId: "shared-task", category: "failure_gotcha", content: "L" });
    const globalStore = new WisdomStore(500);
    globalStore.add({ taskId: "shared-task", category: "environment_quirk", content: "G" });

    const { tiered } = makeTiered({ localStore, globalStore });
    const entries = tiered.getByTaskId("shared-task");

    expect(entries).toHaveLength(2);
    const contents = entries.map((e) => e.content).sort();
    expect(contents).toEqual(["G", "L"]);
  });

  it("should format merged entries for injection using the local store's formatter", () => {
    const localStore = new WisdomStore(100);
    localStore.add({ taskId: "t1", category: "failure_gotcha", content: "Gotcha" });
    const globalStore = new WisdomStore(500);
    globalStore.add({ taskId: "t2", category: "environment_quirk", content: "Quirk" });

    const { tiered } = makeTiered({ localStore, globalStore });
    const entries = tiered.getRelevant({ maxEntries: 10 });
    const formatted = tiered.formatForInjection(entries);

    expect(formatted).toContain("Past Learnings");
    expect(formatted).toContain("Gotcha");
    expect(formatted).toContain("Quirk");
  });
  it("should use standard header for single persona (Issue 2 fix)", () => {
    const localStore = new WisdomStore(100);
    localStore.add({
      taskId: "t1",
      category: "failure_gotcha",
      content: "Gotcha",
      persona: "hephaestus",
    });

    const { tiered } = makeTiered({ localStore, globalStore: new WisdomStore(500) });
    const entries = tiered.getRelevant({ maxEntries: 10 });
    const formatted = tiered.formatForInjection(entries);

    expect(formatted).toContain("**[JUSTICE AI: Past Learnings & Gotchas]**");
    expect(formatted).not.toContain("Past Learnings for hephaestus");
  });

  it("should NOT duplicate headers when multiple personas are present (Issue 1 fix)", () => {
    const localStore = new WisdomStore(100);
    localStore.add({
      taskId: "t1",
      category: "failure_gotcha",
      content: "Gotcha",
      persona: "hephaestus",
    });
    localStore.add({
      taskId: "t2",
      category: "environment_quirk",
      content: "Quirk",
      persona: "sisyphus",
    });

    const { tiered } = makeTiered({ localStore, globalStore: new WisdomStore(500) });
    const entries = tiered.getRelevant({ maxEntries: 10 });
    const formatted = tiered.formatForInjection(entries);

    const headerMatches = formatted.match(/\*\*\[JUSTICE AI: Past Learnings/g) ?? [];
    expect(headerMatches).toHaveLength(2);

    expect(formatted).toContain("**[JUSTICE AI: Past Learnings for hephaestus]**");
    expect(formatted).toContain("**[JUSTICE AI: Past Learnings for sisyphus]**");
  });

  it("should format global entries without delegating to localStore formatter (Issue 3 fix)", () => {
    const globalStore = new WisdomStore(500);
    globalStore.add({
      taskId: "t1",
      category: "environment_quirk",
      content: "Quirk",
      persona: "atlas",
    });

    const { tiered } = makeTiered({ localStore: new WisdomStore(100), globalStore });
    const entries = tiered.getRelevant({ maxEntries: 10 });
    const formatted = tiered.formatForInjection(entries);

    expect(formatted).toContain("**[JUSTICE AI: Past Learnings & Gotchas]**");
    expect(formatted).toContain("Quirk");
  });
});

describe("TieredWisdomStore — persistence coordination", () => {
  it("records hits in the store that owns the entry", () => {
    const { tiered } = makeTiered();
    const local = tiered.add({ taskId: "local", category: "failure_gotcha", content: "local" });
    const global = tiered.add({ taskId: "global", category: "success_pattern", content: "global" });

    expect(tiered.recordHit?.(local.id)?.hitCount).toBe(1);
    expect(tiered.recordHit?.(global.id)?.hitCount).toBe(1);
  });

  it("archives evicted high-priority local wisdom", async () => {
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
    const localStore = new WisdomStore(1);
    const { tiered } = makeTiered({ localStore });
    const archivedTiered = new TieredWisdomStore({
      localStore,
      globalStore: new WisdomStore(500),
      localPersistence: tiered.getLocalPersistence(),
      globalPersistence: tiered.getGlobalPersistence(),
      localArchive: archive,
    });

    archivedTiered.add({ taskId: "first", category: "failure_gotcha", content: "first" });
    archivedTiered.add({ taskId: "second", category: "failure_gotcha", content: "second" });
    await archivedTiered.persistAll();

    expect((await archive.loadAll()).map((entry) => entry.content)).toEqual(["first"]);
  });

  it("loadAll should replace both stores from their persistence backends", async () => {
    const localJson = JSON.stringify({
      entries: [
        {
          id: "w-l",
          taskId: "t1",
          category: "failure_gotcha",
          content: "loaded-local",
          timestamp: "2026-01-01T00:00:00Z",
        },
      ],
      maxEntries: 100,
    });
    const globalJson = JSON.stringify({
      entries: [
        {
          id: "w-g",
          taskId: "t2",
          category: "environment_quirk",
          content: "loaded-global",
          timestamp: "2026-01-02T00:00:00Z",
        },
      ],
      maxEntries: 500,
    });
    const localPersistence = new WisdomPersistence(
      createMockFileReader({ [".justice/wisdom.json"]: localJson }),
      createMockFileWriter(),
      ".justice/wisdom.json",
    );
    const globalPersistence = new WisdomPersistence(
      createMockFileReader({ "wisdom.json": globalJson }),
      createMockFileWriter(),
      "wisdom.json",
    );

    const tiered = new TieredWisdomStore({
      localStore: new WisdomStore(100),
      globalStore: new WisdomStore(500),
      localPersistence,
      globalPersistence,
    });

    await tiered.loadAll();

    const localEntries = tiered.getLocalStore().getRelevant();
    const globalEntries = tiered.getGlobalStore().getRelevant();
    expect(localEntries).toHaveLength(1);
    expect(localEntries[0]?.content).toBe("loaded-local");
    expect(globalEntries).toHaveLength(1);
    expect(globalEntries[0]?.content).toBe("loaded-global");
  });

  it("persistAll should save both stores via their persistence backends", async () => {
    const writer = createMockFileWriter();
    const localPersistence = new WisdomPersistence(
      createMockFileReader({}),
      writer,
      ".justice/wisdom.json",
    );
    const globalPersistence = new WisdomPersistence(
      createMockFileReader({}),
      writer,
      "wisdom.json",
    );

    const tiered = new TieredWisdomStore({
      localStore: new WisdomStore(100),
      globalStore: new WisdomStore(500),
      localPersistence,
      globalPersistence,
    });

    tiered.getLocalStore().add({ taskId: "t1", category: "failure_gotcha", content: "save-local" });
    tiered
      .getGlobalStore()
      .add({ taskId: "t2", category: "success_pattern", content: "save-global" });

    await tiered.persistAll();

    expect(writer.writtenFiles[".justice/wisdom.json"]).toBeDefined();
    expect(writer.writtenFiles["wisdom.json"]).toBeDefined();
  });
});
