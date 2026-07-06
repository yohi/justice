// tests/runtime/state-projection-cache-read.test.ts
import { describe, expect, it, vi } from "vitest";
import {
  StateProjectionCache,
  validateProjectionCacheAgainstEvents,
} from "../../src/runtime/state-projection-cache";
import { project } from "../../src/core/v2/state-projection";
import type { ProjectedState } from "../../src/core/v2/state-projection";
import type { FileReader, FileWriter } from "../../src/core/types";
import type { ObservationRecord } from "../../src/core/v2/observation-model";

function createMemFs(): { files: Map<string, string>; reader: FileReader; writer: FileWriter } {
  const files = new Map<string, string>();
  const reader: FileReader = {
    readFile: async (p) => {
      const c = files.get(p);
      if (c === undefined) throw new Error(`ENOENT: ${p}`);
      return c;
    },
    fileExists: async (p) => files.has(p),
    listFiles: async (prefix) => [...files.keys()].filter((k) => k.startsWith(prefix)),
    readFileStats: async (p) => {
      const c = files.get(p);
      return c === undefined ? null : { size: c.length, mtimeMs: 0 };
    },
  };
  const writer: FileWriter = {
    writeFile: async (p, content) => {
      files.set(p, content);
    },
    rename: async (from, to) => {
      const c = files.get(from);
      if (c === undefined) throw new Error(`rename: missing ${from}`);
      files.set(to, c);
      files.delete(from);
    },
    mkdir: async () => {},
    rmdir: async () => {},
    deleteFile: async (p) => {
      files.delete(p);
    },
  };
  return { files, reader, writer };
}

function toolEvent(seq: number, taskId: string, writerId = "w1"): ObservationRecord {
  return {
    schemaVersion: 1,
    sequence: seq,
    timestamp: `2026-07-06T00:00:0${seq}Z`,
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

  it("reconstructs a valid persisted state", async () => {
    const { reader, writer } = createMemFs();
    const cache = new StateProjectionCache(writer, reader);
    await cache.write(project([toolEvent(1, "task-1")], REBUILT_AT));
    const restored = await cache.read();
    expect(restored?.tasks.get("task-1")?.evidence).toHaveLength(1);
  });
});

describe("validateProjectionCacheAgainstEvents()", () => {
  it("reports valid when the cache matches the event log exactly", () => {
    const events = [toolEvent(1, "task-1"), toolEvent(2, "task-1")];
    const state = project(events, REBUILT_AT);
    expect(validateProjectionCacheAgainstEvents(state, events)).toEqual({ valid: true, reason: "valid" });
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

  it("reports mismatch_seq when the shard set differs", () => {
    const events = [toolEvent(1, "task-1", "w1")];
    const state = project(events, REBUILT_AT);
    const withExtraShard = [...events, toolEvent(1, "task-1", "w2")];
    expect(validateProjectionCacheAgainstEvents(state, withExtraShard)).toEqual({
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

  it("reports structural when the cache integrity block is missing", () => {
    const state = project([toolEvent(1, "task-1")], REBUILT_AT);
    const broken = { ...state, integrity: undefined } as unknown as ProjectedState;
    expect(validateProjectionCacheAgainstEvents(broken, [toolEvent(1, "task-1")])).toEqual({
      valid: false,
      reason: "structural",
    });
  });
});
