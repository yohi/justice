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

  it("should route environment_quirk to globalStore by default", () => {
    tiered.add({ taskId: "t", category: "environment_quirk", content: "Bun X quirk" });

    expect(globalStore.add).toHaveBeenCalledTimes(1);
    expect(localStore.add).not.toHaveBeenCalled();
  });

  it("should route success_pattern to globalStore by default", () => {
    tiered.add({ taskId: "t", category: "success_pattern", content: "Pattern Y" });

    expect(globalStore.add).toHaveBeenCalledTimes(1);
    expect(localStore.add).not.toHaveBeenCalled();
  });

  it("should route failure_gotcha to localStore by default", () => {
    tiered.add({ taskId: "t", category: "failure_gotcha", content: "Gotcha Z" });

    expect(localStore.add).toHaveBeenCalledTimes(1);
    expect(globalStore.add).not.toHaveBeenCalled();
  });

  it("should route design_decision to localStore by default", () => {
    tiered.add({ taskId: "t", category: "design_decision", content: "Decision" });

    expect(localStore.add).toHaveBeenCalledTimes(1);
    expect(globalStore.add).not.toHaveBeenCalled();
  });

  it("should honor explicit scope=local for environment_quirk", () => {
    tiered.add(
      { taskId: "t", category: "environment_quirk", content: "Override-local" },
      { scope: "local" },
    );

    expect(localStore.add).toHaveBeenCalledTimes(1);
    expect(globalStore.add).not.toHaveBeenCalled();
  });

  it("should honor explicit scope=global for failure_gotcha", () => {
    tiered.add(
      { taskId: "t", category: "failure_gotcha", content: "Override-global" },
      { scope: "global" },
    );

    expect(globalStore.add).toHaveBeenCalledTimes(1);
    expect(localStore.add).not.toHaveBeenCalled();
  });

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
