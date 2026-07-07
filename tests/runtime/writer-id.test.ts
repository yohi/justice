// tests/runtime/writer-id.test.ts
import { describe, expect, it, vi } from "vitest";
import { allocateWriterId, generateWriterId } from "../../src/runtime/writer-id";
import { isSafeWriterId } from "../../src/core/v2/writer-id-validation";
import type { FileReader } from "../../src/core/types";

function makeReader(fileExists: FileReader["fileExists"]): FileReader {
  return {
    readFile: vi.fn(async (_path: string) => ""),
    fileExists,
    listFiles: vi.fn(async (_prefix: string) => []),
    readFileStats: vi.fn(async (_path: string) => null),
  };
}

describe("generateWriterId()", () => {
  it("produces a w- prefixed id that passes isSafeWriterId", () => {
    const id = generateWriterId();
    expect(id.startsWith("w-")).toBe(true);
    expect(isSafeWriterId(id)).toBe(true);
  });

  it("produces unique ids across calls", () => {
    expect(generateWriterId()).not.toBe(generateWriterId());
  });
});

describe("allocateWriterId()", () => {
  const shard = { agentId: "sisyphus", sessionId: "ses-1" } as const;

  it("returns the first candidate when there is no collision", async () => {
    const fileExists = vi.fn(async (_path: string) => false);
    const reader = makeReader(fileExists);
    const id = await allocateWriterId(reader, shard);
    expect(isSafeWriterId(id)).toBe(true);
    expect(fileExists).toHaveBeenCalledTimes(1);
  });

  it("retries with a new candidate on collision", async () => {
    let calls = 0;
    const fileExists = vi.fn(async (_path: string) => {
      calls += 1;
      return calls === 1; // collide once, then the next candidate is free
    });
    const reader = makeReader(fileExists);
    const id = await allocateWriterId(reader, shard);
    expect(isSafeWriterId(id)).toBe(true);
    expect(fileExists).toHaveBeenCalledTimes(2);
  });

  it("checks the physical path derived from the shard", async () => {
    const seen: string[] = [];
    const fileExists = vi.fn(async (path: string) => {
      seen.push(path);
      return false;
    });
    const reader = makeReader(fileExists);
    await allocateWriterId(reader, shard);
    expect(seen[0]).toMatch(/^\.justice\/events\/sisyphus\/.+\/w-.+\.jsonl$/);
  });

  it("throws when max attempts exceeded", async () => {
    const fileExists = vi.fn(async (_path: string) => true); // always collide
    const reader = makeReader(fileExists);
    await expect(allocateWriterId(reader, shard)).rejects.toThrow(
      /failed to allocate a unique writerId after 100 attempts/,
    );
  });
});
