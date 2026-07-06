// tests/core/v2/shard-layout.test.ts
import { describe, expect, it } from "vitest";
import { encodeSafeSegment } from "../../../src/core/v2/safe-segment";
import { toArchivePath, toPhysicalPath } from "../../../src/core/v2/shard-layout";
import { isSafeWriterId } from "../../../src/core/v2/writer-id-validation";
import type { ShardId } from "../../../src/core/types";

const shard: ShardId = {
  agentId: "sisyphus",
  sessionId: "ses_abc/123",
  writerId: "w-1234-5678",
};

describe("isSafeWriterId()", () => {
  it("accepts a w- prefixed alphanumeric/hyphen id", () => {
    expect(isSafeWriterId("w-1234-5678")).toBe(true);
    expect(isSafeWriterId("w-abcDEF0")).toBe(true);
    expect(isSafeWriterId("w-123e4567-e89b-12d3-a456-426614174000")).toBe(true);
  });

  it("rejects the reserved w-system id", () => {
    expect(isSafeWriterId("w-system")).toBe(false);
  });

  it("rejects ids without the w- prefix", () => {
    expect(isSafeWriterId("system")).toBe(false);
    expect(isSafeWriterId("x-1234")).toBe(false);
  });

  it("rejects ids with unsafe characters (path traversal / separators / underscore)", () => {
    expect(isSafeWriterId("w-../etc")).toBe(false);
    expect(isSafeWriterId("w-a/b")).toBe(false);
    expect(isSafeWriterId("w-a.b")).toBe(false);
    expect(isSafeWriterId("w-a_b")).toBe(false);
  });

  it("rejects the empty string and the bare prefix", () => {
    expect(isSafeWriterId("")).toBe(false);
    expect(isSafeWriterId("w-")).toBe(false);
  });
});

describe("toPhysicalPath()", () => {
  it("builds .justice/events/<agentId>/<encodedSession>/<writerId>.jsonl", () => {
    expect(toPhysicalPath(shard)).toBe(
      `.justice/events/sisyphus/${encodeSafeSegment("ses_abc/123")}/w-1234-5678.jsonl`,
    );
  });

  it("does not encode the constrained agentId segment", () => {
    const s: ShardId = { agentId: "system", sessionId: "s", writerId: "w-x" };
    expect(toPhysicalPath(s)).toBe(
      `.justice/events/system/${encodeSafeSegment("s")}/w-x.jsonl`,
    );
  });

  it("throws when writerId is unsafe", () => {
    const bad: ShardId = { agentId: "sisyphus", sessionId: "s", writerId: "../evil" };
    expect(() => toPhysicalPath(bad)).toThrow(/unsafe writerId/);
  });

  it("throws when agentId is unsafe", () => {
    const bad = { agentId: "evil", sessionId: "s", writerId: "w-x" } as unknown as ShardId;
    expect(() => toPhysicalPath(bad)).toThrow(/unsafe agentId/);
  });
});

describe("toArchivePath()", () => {
  it("builds .justice/archive/events/<agentId>/<encodedSession>/<writerId>.<ts>.jsonl", () => {
    expect(toArchivePath(shard, "20260706T000000Z")).toBe(
      `.justice/archive/events/sisyphus/${encodeSafeSegment("ses_abc/123")}/w-1234-5678.20260706T000000Z.jsonl`,
    );
  });

  it("throws when writerId is unsafe", () => {
    const bad: ShardId = { agentId: "sisyphus", sessionId: "s", writerId: "../evil" };
    expect(() => toArchivePath(bad, "t")).toThrow(/unsafe writerId/);
  });

  it("throws when timestamp is unsafe (contains non-alphanumeric)", () => {
    expect(() => toArchivePath(shard, "2026-07-06")).toThrow(/unsafe timestamp/);
    expect(() => toArchivePath(shard, "../evil")).toThrow(/unsafe timestamp/);
    expect(() => toArchivePath(shard, "t@t")).toThrow(/unsafe timestamp/);
  });

  it("throws when agentId is unsafe", () => {
    const bad = { agentId: "evil", sessionId: "s", writerId: "w-x" } as unknown as ShardId;
    expect(() => toArchivePath(bad, "20260706T000000Z")).toThrow(/unsafe agentId/);
  });
});
