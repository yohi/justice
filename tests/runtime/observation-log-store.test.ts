// tests/runtime/observation-log-store.test.ts
import { describe, expect, it } from "vitest";
import { ObservationLogStore } from "../../src/runtime/observation-log-store";
import { validateRecordSchema, validateShardSequences } from "../../src/runtime/validation";
import { toPhysicalPath } from "../../src/core/v2/shard-layout";
import { encodeSafeSegment } from "../../src/core/v2/safe-segment";
import type { FileReader, FileWriter, ShardId } from "../../src/core/types";
import type { PendingLogRecord, PersistedLogRecord } from "../../src/core/v2/observation-model";

function createMemFs(): { files: Map<string, string>; reader: FileReader; writer: FileWriter } {
  const files = new Map<string, string>();
  const reader: FileReader = {
    readFile: async (p: string) => {
      const c = files.get(p);
      if (c === undefined) {
        const e = new Error(`ENOENT: ${p}`) as NodeJS.ErrnoException;
        e.code = "ENOENT";
        throw e;
      }
      return c;
    },
    fileExists: async (p: string) => files.has(p),
    listFiles: async (prefix: string) =>
      [...files.keys()].filter((k) => k.startsWith(prefix) && k.endsWith(".jsonl")),
    readFileStats: async (p: string) => {
      const c = files.get(p);
      // Recent mtime so shard rotation (age-based) does not spuriously fire here;
      // these tests exercise append/readAll, not rotation (covered separately).
      return c === undefined ? null : { size: c.length, mtimeMs: Date.now() };
    },
  };
  const writer: FileWriter = {
    writeFile: async (p: string, content: string) => {
      files.set(p, content);
    },
    rename: async (from: string, to: string) => {
      const c = files.get(from);
      if (c === undefined) throw new Error(`rename: missing source ${from}`);
      files.set(to, c);
      files.delete(from);
    },
    mkdir: async () => {},
    rmdir: async () => {},
    deleteFile: async (p: string) => {
      files.delete(p);
    },
  };
  return { files, reader, writer };
}

const shard: ShardId = { agentId: "sisyphus", sessionId: "ses-1", writerId: "w-1" };

function msgRecord(): PendingLogRecord {
  return {
    schemaVersion: 1,
    timestamp: "2026-07-06T00:00:00.000Z",
    agentId: "sisyphus",
    sessionId: "ses-1",
    writerId: "w-1",
    recordType: "observation",
    kind: "message",
    messageID: "m1",
    role: "assistant",
    textHash: "abc",
    finalized: true,
  };
}

describe("validateRecordSchema()", () => {
  const base = {
    schemaVersion: 1,
    sequence: 1,
    timestamp: "2026-07-06T00:00:00.000Z",
    agentId: "sisyphus",
    sessionId: "s",
    writerId: "w-1",
  };

  it("accepts valid observation records for each kind", () => {
    expect(() =>
      validateRecordSchema({ ...base, recordType: "observation", kind: "tool_executed", toolName: "bash", callId: "c1", evidence: { evidenceId: "e1" } }),
    ).not.toThrow();
    expect(() =>
      validateRecordSchema({ ...base, recordType: "observation", kind: "message", role: "assistant", textHash: "h" }),
    ).not.toThrow();
    expect(() =>
      validateRecordSchema({ ...base, recordType: "observation", kind: "skill_invoked", skillName: "git-master", source: "message" }),
    ).not.toThrow();
    expect(() =>
      validateRecordSchema({
        ...base,
        recordType: "observation",
        kind: "review_observed",
        reviewScope: "src/",
        items: [{ itemKey: "k", evidenceId: "e", severity: "major", status: "open" }],
      }),
    ).not.toThrow();
  });

  it("accepts a valid decision record", () => {
    expect(() =>
      validateRecordSchema({
        ...base,
        recordType: "decision",
        gateType: "task",
        verdict: "PASS",
        reachableEnforcementLevel: "L1",
        appliedEnforcementLevel: "L0",
        ruleResults: [],
      }),
    ).not.toThrow();
  });

  it("rejects non-objects and bad envelope fields", () => {
    expect(() => validateRecordSchema(null)).toThrow(/not an object/);
    expect(() => validateRecordSchema({ ...base, schemaVersion: 2, recordType: "observation", kind: "message", role: "a", textHash: "h" })).toThrow(/schemaVersion/);
    expect(() => validateRecordSchema({ ...base, sequence: -1, recordType: "observation", kind: "message", role: "a", textHash: "h" })).toThrow(/sequence/);
    expect(() => validateRecordSchema({ ...base, writerId: 5, recordType: "observation", kind: "message", role: "a", textHash: "h" })).toThrow(/shard identifier/);
  });

  it("rejects unknown recordType and unknown observation kind", () => {
    expect(() => validateRecordSchema({ ...base, recordType: "bogus" })).toThrow(/unknown recordType/);
    expect(() => validateRecordSchema({ ...base, recordType: "observation", kind: "bogus" })).toThrow(/unknown observation kind/);
  });

  it("rejects review_observed items with invalid severity/status", () => {
    expect(() =>
      validateRecordSchema({
        ...base,
        recordType: "observation",
        kind: "review_observed",
        reviewScope: "src/",
        items: [{ itemKey: "k", evidenceId: "e", severity: "HIGH", status: "open" }],
      }),
    ).toThrow(/review_observed item/);
  });
});

describe("validateShardSequences()", () => {
  const mk = (seq: number, writerId = "w-1"): PersistedLogRecord => ({
    schemaVersion: 1,
    timestamp: "t",
    agentId: "sisyphus",
    sessionId: "s",
    writerId,
    recordType: "observation",
    kind: "skill_invoked",
    sequence: seq,
  });

  it("accepts unique, monotonic sequences per shard", () => {
    expect(() => validateShardSequences([mk(1), mk(2), mk(3)])).not.toThrow();
  });

  it("accepts independent sequence spaces across different shards", () => {
    expect(() => validateShardSequences([mk(1, "w-1"), mk(1, "w-2"), mk(2, "w-1")])).not.toThrow();
  });

  it("throws on duplicate sequence within a shard", () => {
    expect(() => validateShardSequences([mk(1), mk(2), mk(2)])).toThrow(/duplicate sequence/);
  });
});

describe("ObservationLogStore", () => {
  it("appends records and reads them back with monotonic sequences", async () => {
    const { reader, writer } = createMemFs();
    const store = new ObservationLogStore(writer, reader, "w-1");

    const seqs = [await store.append(shard, msgRecord()), await store.append(shard, msgRecord()), await store.append(shard, msgRecord())];
    expect(seqs).toEqual([1, 2, 3]);

    const all = await store.readAll();
    expect(all).toHaveLength(3);
    expect(all.map((r) => r.sequence)).toEqual([1, 2, 3]);
  });

  it("persists to the shard's physical path and exposes its writerId", async () => {
    const { files, reader, writer } = createMemFs();
    const store = new ObservationLogStore(writer, reader, "w-1");
    await store.append(shard, msgRecord());
    expect(files.has(toPhysicalPath(shard))).toBe(true);
    expect(store.getWriterId()).toBe("w-1");
  });

  it("degrades fail-open when an event file contains malformed JSON", async () => {
    const { files, reader, writer } = createMemFs();
    const store = new ObservationLogStore(writer, reader, "w-1");
    await store.append(shard, msgRecord());
    files.set(".justice/events/sisyphus/other/w-9.jsonl", "not-json\n");

    const all = await store.readAll();
    expect(all).toHaveLength(1);
  });

  it("continues sequence numbering across an archived segment (rotation continuity)", async () => {
    const { files, reader, writer } = createMemFs();
    const enc = encodeSafeSegment("ses-1");
    const archivePath = `.justice/archive/events/sisyphus/${enc}/w-1.20260101T000000Z.jsonl`;
    files.set(archivePath, `${JSON.stringify({ ...msgRecord(), sequence: 5 })}\n`);

    const store = new ObservationLogStore(writer, reader, "w-1");
    const next = await store.append(shard, msgRecord());
    expect(next).toBe(6);
  });
});
