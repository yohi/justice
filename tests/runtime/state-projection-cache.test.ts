// tests/runtime/state-projection-cache.test.ts
import { describe, expect, it } from "vitest";
import { StateProjectionCache } from "../../src/runtime/state-projection-cache";
import { project } from "../../src/core/v2/state-projection";
import { createMemFs } from "../helpers/mock-file-system";
import type { ObservationRecord } from "../../src/core/v2/observation-model";

function reviewEvent(seq: number, taskId: string, scope: string): ObservationRecord {
  return {
    schemaVersion: 1,
    sequence: seq,
    timestamp: new Date(Date.UTC(2026, 6, 6, 0, 0, seq)).toISOString(),
    agentId: "atlas",
    sessionId: "s1",
    writerId: "w1",
    recordType: "observation",
    taskId,
    kind: "review_observed",
    reviewScope: scope,
    items: [{ itemKey: "a", evidenceId: "ev-a", severity: "critical", summary: "s", location: "l", status: "open" }],
  };
}

const sampleEvents: ObservationRecord[] = [reviewEvent(1, "task-1", "src/api")];
const REBUILT_AT = "2026-07-06T00:00:00.000Z";

describe("StateProjectionCache serialization", () => {
  it("serializes ReadonlyMap fields to JSON objects (not arrays)", async () => {
    const { files, reader, writer } = createMemFs();
    const cache = new StateProjectionCache(writer, reader);
    const state = project(sampleEvents, REBUILT_AT);

    await cache.write(state);

    const written = files.get(".justice/state.json");
    expect(written).toBeDefined();
    const parsed = JSON.parse(written ?? "") as {
      integrity: { maxSequenceByShard: Record<string, number> };
      reviewSummary: { byScope: unknown };
    };
    expect(parsed.integrity.maxSequenceByShard).toBeDefined();
    expect(Object.keys(parsed.integrity.maxSequenceByShard).length).toBeGreaterThan(0);
    expect(parsed.reviewSummary.byScope).toBeDefined();
    expect(typeof parsed.reviewSummary.byScope).toBe("object");
    expect(Array.isArray(parsed.reviewSummary.byScope)).toBe(false);
    // No temp file should leak after the atomic rename.
    expect([...files.keys()].filter((k) => k.includes(".tmp."))).toHaveLength(0);
  });

  it("writes atomically and reads back an equivalent ProjectedState", async () => {
    const { reader, writer } = createMemFs();
    const cache = new StateProjectionCache(writer, reader);
    const state = project(sampleEvents, REBUILT_AT);

    await cache.write(state);
    const restored = await cache.read();

    expect(restored).toBeDefined();
    expect(restored?.integrity.sourceHash).toBe(state.integrity.sourceHash);
    expect(restored?.integrity.maxSequenceByShard.get("atlas:s1:w1")).toBe(1);
    expect(restored?.reviewSummary.byScope.get("src/api")?.critical).toHaveLength(1);
    expect(restored?.tasks.get("task-1")?.observedReviewScopes).toEqual(["src/api"]);
  });
});
