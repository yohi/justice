import { Buffer } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JusticeLinuxNativeGateLockHandle } from "../../src/runtime/linux-native-addon";

const nativeAddon = vi.hoisted(() => ({ value: undefined as unknown }));

vi.mock("../../src/runtime/linux-native-addon", () => ({
  hasGlibcRuntime: () => true,
  loadJusticeLinuxNativeAddon: () => nativeAddon.value,
}));

const nativeLock: JusticeLinuxNativeGateLockHandle = {
  release: vi.fn(),
  verifyCloexec: vi.fn(() => true),
};

const nativeGateRoot = {
  acquireScopeLock: vi.fn((): JusticeLinuxNativeGateLockHandle | "occupied" => nativeLock),
  acquireGateLock: vi.fn((): JusticeLinuxNativeGateLockHandle | "occupied" => nativeLock),
  acquireRecoveryGcLock: vi.fn((): JusticeLinuxNativeGateLockHandle | "occupied" => nativeLock),
  listScopeIds: vi.fn(() => ["scope-a"]),
  listGateIds: vi.fn(() => ["gate-a"]),
  listWriterIds: vi.fn(() => ["writer-a"]),
  readWriterShard: vi.fn((): Buffer | null => Buffer.from("shard")),
  durableReplaceWriterShard: vi.fn(),
  publishRecoveryObject: vi.fn((): "created" | "exists" => "created"),
  readRecoveryObject: vi.fn((): Buffer | null => Buffer.from("recovery")),
  listRecoveryObjects: vi.fn(() => ["a1b2"]),
  deleteRecoveryObject: vi.fn(),
  readWorkspaceFile: vi.fn((): Buffer | null => Buffer.from("workspace")),
  replaceWorkspaceFileExact: vi.fn(),
  close: vi.fn(),
};

const gateAddon = {
  openReviewGateRoot: vi.fn(() => nativeGateRoot),
  probeReviewGateCapabilities: vi.fn(() => ({
    linux: true,
    x64: true,
    glibc: true,
    openat2: true,
    renameat2: true,
  })),
};

beforeEach(() => {
  vi.clearAllMocks();
  nativeAddon.value = { artifact: {}, gate: gateAddon };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  nativeAddon.value = undefined;
});

async function importProvider() {
  const { createLinuxReviewGateProvider } = await import(
    "../../src/runtime/linux-review-gate-provider"
  );
  return createLinuxReviewGateProvider;
}

describe("LinuxReviewGateProvider native adapter", () => {
  it("publishes the typed provider surface from the shared loader", async () => {
    const createLinuxReviewGateProvider = await importProvider();
    const provider = createLinuxReviewGateProvider("/workspace");

    expect(provider).toBeDefined();
    expect(gateAddon.openReviewGateRoot).toHaveBeenCalledWith("/workspace");
    expect(Object.keys(provider ?? {}).sort()).toEqual(
      [
        "acquireGateLock",
        "acquireRecoveryGcLock",
        "acquireScopeLock",
        "close",
        "deleteRecoveryObject",
        "durableReplaceWriterShard",
        "listGateIds",
        "listRecoveryObjects",
        "listScopeIds",
        "listWriterIds",
        "publishRecoveryObject",
        "readRecoveryObject",
        "readWorkspaceFile",
        "readWriterShard",
        "replaceWorkspaceFileExact",
      ].sort(),
    );
  });

  it("passes shard read arguments to the native gate addon", async () => {
    const createLinuxReviewGateProvider = await importProvider();
    const provider = createLinuxReviewGateProvider("/workspace");
    expect(provider).toBeDefined();
    if (provider === undefined) return;

    await expect(provider.readWriterShard("scope-a", "gate-a", "writer-a")).resolves.toEqual(
      Buffer.from("shard"),
    );
    expect(nativeGateRoot.readWriterShard).toHaveBeenCalledWith("scope-a", "gate-a", "writer-a");
  });

  it("translates workspace replace into flattened native arguments", async () => {
    const createLinuxReviewGateProvider = await importProvider();
    const provider = createLinuxReviewGateProvider("/workspace");
    expect(provider).toBeDefined();
    if (provider === undefined) return;

    const replacementBytes = Buffer.from("next");
    await provider.replaceWorkspaceFileExact(
      "docs/plan.md",
      { digest: "a1b2", gitMode: "100644" },
      { bytes: replacementBytes, gitMode: "100755" },
    );
    expect(nativeGateRoot.replaceWorkspaceFileExact).toHaveBeenCalledWith(
      "docs/plan.md",
      "a1b2",
      "100644",
      replacementBytes,
      "100755",
    );
  });

  it("translates durable shard replace including a null previous digest", async () => {
    const createLinuxReviewGateProvider = await importProvider();
    const provider = createLinuxReviewGateProvider("/workspace");
    expect(provider).toBeDefined();
    if (provider === undefined) return;

    const bytes = Buffer.from("shard-next");
    await provider.durableReplaceWriterShard("scope-a", "gate-a", "writer-a", null, bytes);
    expect(nativeGateRoot.durableReplaceWriterShard).toHaveBeenCalledWith(
      "scope-a",
      "gate-a",
      "writer-a",
      null,
      bytes,
    );

    await provider.durableReplaceWriterShard("scope-a", "gate-a", "writer-a", "c0ffee", bytes);
    expect(nativeGateRoot.durableReplaceWriterShard).toHaveBeenLastCalledWith(
      "scope-a",
      "gate-a",
      "writer-a",
      "c0ffee",
      bytes,
    );
  });

  it("propagates recovery object outcomes and discovery lists", async () => {
    const createLinuxReviewGateProvider = await importProvider();
    const provider = createLinuxReviewGateProvider("/workspace");
    expect(provider).toBeDefined();
    if (provider === undefined) return;

    await expect(provider.publishRecoveryObject("a1b2", Buffer.from("bytes"))).resolves.toBe(
      "created",
    );
    expect(nativeGateRoot.publishRecoveryObject).toHaveBeenCalledWith("a1b2", Buffer.from("bytes"));
    await expect(provider.listRecoveryObjects()).resolves.toEqual(["a1b2"]);
    await expect(provider.readRecoveryObject("a1b2")).resolves.toEqual(Buffer.from("recovery"));
    await expect(provider.listScopeIds()).resolves.toEqual(["scope-a"]);
    await expect(provider.listGateIds("scope-a")).resolves.toEqual(["gate-a"]);
    await expect(provider.listWriterIds("scope-a", "gate-a")).resolves.toEqual(["writer-a"]);
  });

  it("returns occupied from the native outcome and wraps acquired handles", async () => {
    const createLinuxReviewGateProvider = await importProvider();
    const provider = createLinuxReviewGateProvider("/workspace");
    expect(provider).toBeDefined();
    if (provider === undefined) return;

    nativeGateRoot.acquireScopeLock.mockReturnValueOnce("occupied");
    await expect(provider.acquireScopeLock("scope-a")).resolves.toBe("occupied");
    expect(nativeGateRoot.acquireScopeLock).toHaveBeenCalledWith("scope-a");

    const lock = await provider.acquireScopeLock("scope-b");
    expect(lock).not.toBe("occupied");
    if (lock === "occupied") throw new Error("unexpected occupied outcome");
    expect(lock.verifyCloexec()).toBe(true);
    expect(nativeLock.verifyCloexec).toHaveBeenCalledTimes(1);
    lock.release();
    expect(nativeLock.release).toHaveBeenCalledTimes(1);
  });

  it("validates arguments before touching the native addon", async () => {
    const createLinuxReviewGateProvider = await importProvider();
    const provider = createLinuxReviewGateProvider("/workspace");
    expect(provider).toBeDefined();
    if (provider === undefined) return;

    await expect(provider.acquireScopeLock("scope/child")).rejects.toThrow(
      "review_gate_invalid_id",
    );
    await expect(provider.readRecoveryObject("not-a-digest")).rejects.toThrow(
      "review_gate_invalid_digest",
    );
    await expect(provider.readWorkspaceFile("../escape.md")).rejects.toThrow(
      "review_gate_invalid_path",
    );
    await expect(provider.readWorkspaceFile("/etc/passwd")).rejects.toThrow(
      "review_gate_invalid_path",
    );
    expect(nativeGateRoot.acquireScopeLock).not.toHaveBeenCalled();
    expect(nativeGateRoot.readRecoveryObject).not.toHaveBeenCalled();
    expect(nativeGateRoot.readWorkspaceFile).not.toHaveBeenCalled();
  });

  it("closes held locks, then the root, and rejects later calls", async () => {
    const createLinuxReviewGateProvider = await importProvider();
    const provider = createLinuxReviewGateProvider("/workspace");
    expect(provider).toBeDefined();
    if (provider === undefined) return;

    await provider.acquireScopeLock("scope-a");
    provider.close();
    expect(nativeLock.release).toHaveBeenCalledTimes(1);
    expect(nativeGateRoot.close).toHaveBeenCalledTimes(1);
    expect(() => provider.close()).not.toThrow();
    expect(nativeGateRoot.close).toHaveBeenCalledTimes(1);
    await expect(provider.listScopeIds()).rejects.toThrow("provider_closed");
    expect(nativeGateRoot.listScopeIds).not.toHaveBeenCalled();
  });
});
