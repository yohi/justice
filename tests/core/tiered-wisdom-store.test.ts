import { describe, it, expect, vi, beforeEach } from "vitest";
import { TieredWisdomStore } from "../../src/core/tiered-wisdom-store";
import { WisdomStore } from "../../src/core/wisdom-store";
import { WisdomPersistence } from "../../src/core/wisdom-persistence";
import { SecretPatternDetector } from "../../src/core/secret-pattern-detector";
import { createMockFileReader, createMockFileWriter } from "../helpers/mock-file-system";

function makeLogger() {
  return {
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function makeTiered(opts?: {
  localStore?: WisdomStore;
  globalStore?: WisdomStore;
  globalDisplayPath?: string;
  logger?: ReturnType<typeof makeLogger>;
}) {
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

  it("should log warn when an entry with secrets is promoted to global", () => {
    tiered.add({
      taskId: "t",
      category: "success_pattern",
      content: "remember to set ANTHROPIC_API_KEY",
    });

    expect(logger.warn).toHaveBeenCalledTimes(1);
    const msg = logger.warn.mock.calls[0]?.[0] as string;
    expect(msg).toContain("may contain secrets");
    expect(msg).toContain("api_key");
    expect(msg).toContain("~/.justice/wisdom.json");
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
});

describe("TieredWisdomStore — persistence coordination", () => {
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
    tiered.getGlobalStore().add({ taskId: "t2", category: "success_pattern", content: "save-global" });

    await tiered.persistAll();

    expect(writer.writtenFiles[".justice/wisdom.json"]).toBeDefined();
    expect(writer.writtenFiles["wisdom.json"]).toBeDefined();
  });
});
