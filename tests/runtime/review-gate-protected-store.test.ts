import { link, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProtectedWitnessStore } from "../../src/runtime/review-gate-protected-store.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, link: vi.fn(actual.link) };
});

describe("ProtectedWitnessStore immutable writes", () => {
  let directory: string | undefined;
  afterEach(async () => {
    vi.restoreAllMocks();
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  it("publishes through a temporary file and removes it when atomic link fails", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "justice-protected-store-"));
    const store = new ProtectedWitnessStore(directory);
    vi.mocked(link).mockRejectedValueOnce(new Error("forced link failure"));

    await expect(store.writeBytes("immutable.bin", Buffer.from("complete"), true))
      .rejects.toMatchObject({ code: "durability" });

    expect(link).toHaveBeenCalledOnce();
    expect(await readdir(directory)).toEqual([]);
  });

  it("accepts an identical immutable retry and rejects different existing bytes", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "justice-protected-store-"));
    const store = new ProtectedWitnessStore(directory);
    const bytes = Buffer.from("stable");

    await store.writeBytes("immutable.bin", bytes, true);
    await expect(store.writeBytes("immutable.bin", bytes, true)).resolves.toBeUndefined();
    await expect(store.writeBytes("immutable.bin", Buffer.from("changed"), true))
      .rejects.toMatchObject({ code: "durability" });
    await expect(store.readBytes("immutable.bin")).resolves.toEqual(bytes);
    expect((await readdir(directory)).filter((name) => name.startsWith("tmp-"))).toEqual([]);
  });
});
