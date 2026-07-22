// tests/runtime/state-projection-cache-read.test.ts
import { describe, expect, it, vi } from "vitest";
import {
  StateProjectionCache,
  validateProjectionCacheAgainstEvents,
} from "../../src/runtime/state-projection-cache";
import { project, toSerializableProjectedState } from "../../src/core/v2/state-projection";
import type { ProjectedState } from "../../src/core/v2/state-projection";
import { createMemFs } from "../helpers/mock-file-system";
import type { ObservationRecord } from "../../src/core/v2/observation-model";

function toolEvent(seq: number, taskId: string, writerId = "w1"): ObservationRecord {
  return {
    schemaVersion: 1,
    sequence: seq,
    timestamp: new Date(Date.UTC(2026, 6, 6, 0, 0, seq)).toISOString(),
    agentId: "atlas",
    sessionId: "s1",
    writerId,
    recordType: "observation",
    taskId,
    kind: "tool_executed",
    toolName: "bash",
    callId: `c-${seq}`,
    evidence: {
      evidenceId: `ev-${seq}`,
      kind: "test",
      sourceClass: "tool_output",
      provenance: "observed",
      toolOutputClass: "command_exec",
      command: "bun run test",
      rawOutput: "ok",
    },
  };
}

const REBUILT_AT = "2026-07-06T00:00:00.000Z";
const PATH = ".justice/state.json";

describe("StateProjectionCache.read() fail-open", () => {
  it("returns undefined when the cache file is absent", async () => {
    const { reader, writer } = createMemFs();
    const cache = new StateProjectionCache(writer, reader);
    expect(await cache.read()).toBeUndefined();
  });

  it("returns undefined and warns on malformed JSON", async () => {
    const { files, reader, writer } = createMemFs();
    files.set(PATH, "{not valid json");
    const warn = vi.fn();
    const cache = new StateProjectionCache(writer, reader, PATH, { warn });
    expect(await cache.read()).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it("returns undefined and warns on a structurally invalid cache", async () => {
    const { files, reader, writer } = createMemFs();
    files.set(PATH, JSON.stringify({ schemaVersion: 1, tasks: {} }));
    const warn = vi.fn();
    const cache = new StateProjectionCache(writer, reader, PATH, { warn });
    expect(await cache.read()).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("structure invalid"));
  });

  it.each([
    ["a missing sourceHash", { maxSequenceByShard: {} }],
    ["a non-string sourceHash", { sourceHash: 42, maxSequenceByShard: {} }],
    ["an array maxSequenceByShard", { sourceHash: "hash", maxSequenceByShard: [] }],
    [
      "a non-number maxSequenceByShard entry",
      { sourceHash: "hash", maxSequenceByShard: { shard: "1" } },
    ],
    [
      "a negative maxSequenceByShard entry",
      { sourceHash: "hash", maxSequenceByShard: { shard: -1 } },
    ],
  ])("returns undefined and warns when integrity metadata has %s", async (_case, integrity) => {
    // Given
    const { files, reader, writer } = createMemFs();
    const validState = toSerializableProjectedState(project([toolEvent(1, "task-1")], REBUILT_AT));
    files.set(PATH, JSON.stringify({ ...validState, integrity }));
    const warn = vi.fn();
    const cache = new StateProjectionCache(writer, reader, PATH, { warn });

    // When
    const restored = await cache.read();

    // Then
    expect(restored).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("structure invalid"));
  });

  it("returns undefined and warns on a non-finite maxSequenceByShard entry", async () => {
    // Given
    const { files, reader, writer } = createMemFs();
    const validState = toSerializableProjectedState(project([toolEvent(1, "task-1")], REBUILT_AT));
    const contentWithMarker = JSON.stringify({
      ...validState,
      integrity: { sourceHash: "hash", maxSequenceByShard: "MAX_SEQUENCE_MARKER" },
    });
    files.set(PATH, contentWithMarker.replace('"MAX_SEQUENCE_MARKER"', '{"shard":1e400}'));
    const warn = vi.fn();
    const cache = new StateProjectionCache(writer, reader, PATH, { warn });

    // When
    const restored = await cache.read();

    // Then
    expect(restored).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("structure invalid"));
  });

  it("reconstructs a valid persisted state", async () => {
    const { reader, writer } = createMemFs();
    const cache = new StateProjectionCache(writer, reader);
    await cache.write(project([toolEvent(1, "task-1")], REBUILT_AT));
    const restored = await cache.read();
    expect(restored?.tasks.get("task-1")?.evidence).toHaveLength(1);
  });

  it("rejects a schema version 1 cache after the D32 projection semantics change", async () => {
    const { files, reader, writer } = createMemFs();
    const staleState = {
      ...toSerializableProjectedState(project([toolEvent(1, "task-1")], REBUILT_AT)),
      schemaVersion: 1,
    };
    files.set(PATH, JSON.stringify(staleState));
    const warn = vi.fn();
    const cache = new StateProjectionCache(writer, reader, PATH, { warn });

    expect(await cache.read()).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("structure invalid"));
  });

  it("rejects a cache with a malformed review summary scope", async () => {
    const { files, reader, writer } = createMemFs();
    const validState = toSerializableProjectedState(project([toolEvent(1, "task-1")], REBUILT_AT));
    files.set(
      PATH,
      JSON.stringify({
        ...validState,
        reviewSummary: {
          ...validState.reviewSummary,
          byScope: {
            "scope-a": { critical: [], major: [], minor: [], resolved: [], open: null },
          },
        },
      }),
    );
    const warn = vi.fn();
    const cache = new StateProjectionCache(writer, reader, PATH, { warn });

    expect(await cache.read()).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("structure invalid"));
  });
});

describe("validateProjectionCacheAgainstEvents()", () => {
  it("reports valid when the cache matches the event log exactly", () => {
    const events = [toolEvent(1, "task-1"), toolEvent(2, "task-1")];
    const state = project(events, REBUILT_AT);
    expect(validateProjectionCacheAgainstEvents(state, events)).toEqual({
      valid: true,
      reason: "valid",
    });
  });

  it("reports stale_append when new records were appended to a known shard", () => {
    const events = [toolEvent(1, "task-1")];
    const state = project(events, REBUILT_AT);
    const appended = [...events, toolEvent(2, "task-1")];
    expect(validateProjectionCacheAgainstEvents(state, appended)).toEqual({
      valid: false,
      reason: "stale_append",
    });
  });

  it("reports stale_append when a new writer shard appears in the event log", () => {
    const events = [toolEvent(1, "task-1", "w1")];
    const state = project(events, REBUILT_AT);
    const withExtraShard = [...events, toolEvent(1, "task-1", "w2")];
    expect(validateProjectionCacheAgainstEvents(state, withExtraShard)).toEqual({
      valid: false,
      reason: "stale_append",
    });
  });

  it("reports mismatch_seq when the cache references more shards than the event log", () => {
    const cacheEvents = [toolEvent(1, "task-1", "w1"), toolEvent(1, "task-1", "w2")];
    const state = project(cacheEvents, REBUILT_AT);
    const fewerShards = [toolEvent(1, "task-1", "w1")];
    expect(validateProjectionCacheAgainstEvents(state, fewerShards)).toEqual({
      valid: false,
      reason: "mismatch_seq",
    });
  });

  it("reports mismatch_seq when the cache is ahead of the event log", () => {
    const cacheEvents = [toolEvent(1, "task-1"), toolEvent(2, "task-1")];
    const state = project(cacheEvents, REBUILT_AT);
    const fewerEvents = [toolEvent(1, "task-1")];
    expect(validateProjectionCacheAgainstEvents(state, fewerEvents)).toEqual({
      valid: false,
      reason: "mismatch_seq",
    });
  });

  it("treats a source hash mismatch with matching sequences as a stale cache", () => {
    const events = [toolEvent(1, "task-1"), toolEvent(2, "task-1")];
    const state = project(events, REBUILT_AT);
    // Tamper only the cached sourceHash; maxSequenceByShard still matches the
    // event log exactly, so this must fall through to the hash-mismatch branch
    // at the end of validateProjectionCacheAgainstEvents (not the maxSequence
    // checks earlier in the function).
    const tampered: ProjectedState = {
      ...state,
      integrity: { ...state.integrity, sourceHash: "tampered-hash" },
    };
    expect(validateProjectionCacheAgainstEvents(tampered, events)).toEqual({
      valid: false,
      reason: "stale_append",
    });
  });

  it("rejects a cache whose projected payload was altered without changing integrity metadata", () => {
    const events = [toolEvent(1, "task-1")];
    const state = project(events, REBUILT_AT);
    const task = state.tasks.get("task-1");
    if (task === undefined) throw new Error("test fixture must include task-1");
    const tampered: ProjectedState = {
      ...state,
      tasks: new Map([["task-1", { ...task, evidence: [] }]]),
    };

    expect(validateProjectionCacheAgainstEvents(tampered, events)).toEqual({
      valid: false,
      reason: "mismatch_payload",
    });
  });

  it("reports structural when the cache integrity block is missing", () => {
    const state = project([toolEvent(1, "task-1")], REBUILT_AT);
    const broken = { ...state, integrity: undefined } as unknown as ProjectedState;
    expect(validateProjectionCacheAgainstEvents(broken, [toolEvent(1, "task-1")])).toEqual({
      valid: false,
      reason: "structural",
    });
  });
});
