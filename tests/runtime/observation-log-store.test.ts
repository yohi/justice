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
      return c === undefined ? null : { size: c.length, mtimeMs: 0 };
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
      validateRecordSchema({
        ...base,
        recordType: "observation",
        kind: "tool_executed",
        toolName: "bash",
        callId: "c1",
        evidence: {
          evidenceId: "e1",
          kind: "command",
          sourceClass: "tool_output",
          provenance: "observed",
          toolOutputClass: "command_exec",
          command: "ls",
          rawOutput: "",
        },
      }),
    ).not.toThrow();
    expect(() =>
      validateRecordSchema({
        ...base,
        recordType: "observation",
        kind: "message",
        messageID: "m1",
        role: "assistant",
        textHash: "h",
        finalized: true,
      }),
    ).not.toThrow();
    expect(() =>
      validateRecordSchema({
        ...base,
        recordType: "observation",
        kind: "skill_invoked",
        skillName: "git-master",
        source: "message",
      }),
    ).not.toThrow();
    expect(() =>
      validateRecordSchema({
        ...base,
        recordType: "observation",
        kind: "review_observed",
        reviewScope: "src/",
        items: [
          {
            itemKey: "k",
            evidenceId: "e",
            severity: "major",
            summary: "s",
            location: "src/foo.ts:1",
            status: "open",
          },
        ],
      }),
    ).not.toThrow();
  });

  it("accepts tool_executed with CommandExecEvidence", () => {
    expect(() =>
      validateRecordSchema({
        ...base,
        recordType: "observation",
        kind: "tool_executed",
        toolName: "bash",
        callId: "c1",
        evidence: {
          evidenceId: "e1",
          kind: "command",
          sourceClass: "tool_output",
          provenance: "observed",
          toolOutputClass: "command_exec",
          command: "ls",
          rawOutput: "",
        },
      }),
    ).not.toThrow();
  });

  it("accepts tool_executed with FileContentEvidence", () => {
    expect(() =>
      validateRecordSchema({
        ...base,
        recordType: "observation",
        kind: "tool_executed",
        toolName: "read",
        callId: "c1",
        evidence: {
          evidenceId: "e1",
          kind: "generic",
          sourceClass: "tool_output",
          provenance: "observed",
          toolOutputClass: "file_content",
          rawOutputHash: "deadbeef",
        },
      }),
    ).not.toThrow();
  });

  it("accepts tool_executed with DeclaredClaimEvidence", () => {
    expect(() =>
      validateRecordSchema({
        ...base,
        recordType: "observation",
        kind: "tool_executed",
        toolName: "message",
        callId: "c1",
        evidence: {
          evidenceId: "e1",
          kind: "test",
          sourceClass: "declared_claim",
          provenance: "declared",
          declaredFrom: "message",
          claim: { claimKind: "tests", outcome: "pass" },
        },
      }),
    ).not.toThrow();
  });

  it("rejects tool_executed with missing evidence", () => {
    expect(() =>
      validateRecordSchema({
        ...base,
        recordType: "observation",
        kind: "tool_executed",
        toolName: "bash",
        callId: "c1",
      }),
    ).toThrow(/tool_executed/);
  });

  it("rejects tool_executed with non-object evidence", () => {
    expect(() =>
      validateRecordSchema({
        ...base,
        recordType: "observation",
        kind: "tool_executed",
        toolName: "bash",
        callId: "c1",
        evidence: "not-an-object",
      }),
    ).toThrow(/tool_executed/);
    expect(() =>
      validateRecordSchema({
        ...base,
        recordType: "observation",
        kind: "tool_executed",
        toolName: "bash",
        callId: "c1",
        evidence: 42,
      }),
    ).toThrow(/tool_executed/);
  });

  it("rejects tool_executed with evidence missing discriminant fields", () => {
    expect(() =>
      validateRecordSchema({
        ...base,
        recordType: "observation",
        kind: "tool_executed",
        toolName: "bash",
        callId: "c1",
        evidence: { evidenceId: "e1" },
      }),
    ).toThrow(/tool_executed/);
  });

  it("rejects tool_executed with an unknown sourceClass discriminant", () => {
    expect(() =>
      validateRecordSchema({
        ...base,
        recordType: "observation",
        kind: "tool_executed",
        toolName: "bash",
        callId: "c1",
        evidence: {
          evidenceId: "e1",
          kind: "command",
          sourceClass: "bogus",
          provenance: "observed",
          toolOutputClass: "command_exec",
          command: "ls",
          rawOutput: "",
        },
      }),
    ).toThrow(/tool_executed/);
  });

  it("rejects tool_executed with an unknown toolOutputClass discriminant", () => {
    expect(() =>
      validateRecordSchema({
        ...base,
        recordType: "observation",
        kind: "tool_executed",
        toolName: "bash",
        callId: "c1",
        evidence: {
          evidenceId: "e1",
          kind: "command",
          sourceClass: "tool_output",
          provenance: "observed",
          toolOutputClass: "bogus",
          command: "ls",
          rawOutput: "",
        },
      }),
    ).toThrow(/tool_executed/);
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

  it("accepts a decision record with valid evidenceRefs", () => {
    expect(() =>
      validateRecordSchema({
        ...base,
        recordType: "decision",
        gateType: "task",
        verdict: "PASS",
        reachableEnforcementLevel: "L1",
        appliedEnforcementLevel: "L0",
        ruleResults: [
          {
            ruleId: "r1",
            verdict: "PASS",
            evidenceRefs: [
              {
                agentId: "sisyphus",
                sessionId: "s",
                writerId: "w-1",
                sequence: 0,
                evidenceId: "e1",
              },
            ],
          },
        ],
      }),
    ).not.toThrow();
  });

  it("rejects a decision evidenceRef with a non-finite (NaN) sequence", () => {
    expect(() =>
      validateRecordSchema({
        ...base,
        recordType: "decision",
        gateType: "task",
        verdict: "PASS",
        reachableEnforcementLevel: "L1",
        appliedEnforcementLevel: "L0",
        ruleResults: [
          {
            ruleId: "r1",
            verdict: "PASS",
            evidenceRefs: [
              {
                agentId: "sisyphus",
                sessionId: "s",
                writerId: "w-1",
                sequence: NaN,
                evidenceId: "e1",
              },
            ],
          },
        ],
      }),
    ).toThrow(/evidenceRef/);
  });

  it("rejects non-objects and bad envelope fields", () => {
    expect(() => validateRecordSchema(null)).toThrow(/not an object/);
    expect(() =>
      validateRecordSchema({
        ...base,
        schemaVersion: 2,
        recordType: "observation",
        kind: "message",
        role: "a",
        textHash: "h",
      }),
    ).toThrow(/schemaVersion/);
    expect(() =>
      validateRecordSchema({
        ...base,
        sequence: -1,
        recordType: "observation",
        kind: "message",
        role: "a",
        textHash: "h",
      }),
    ).toThrow(/sequence/);
    expect(() =>
      validateRecordSchema({
        ...base,
        writerId: 5,
        recordType: "observation",
        kind: "message",
        role: "a",
        textHash: "h",
      }),
    ).toThrow(/shard identifier/);
  });

  it("rejects a non-finite (NaN) sequence", () => {
    expect(() =>
      validateRecordSchema({
        ...base,
        sequence: NaN,
        recordType: "observation",
        kind: "message",
        role: "a",
        textHash: "h",
      }),
    ).toThrow(/sequence/);
  });

  it("rejects a message record missing messageID or finalized", () => {
    expect(() =>
      validateRecordSchema({
        ...base,
        recordType: "observation",
        kind: "message",
        role: "assistant",
        textHash: "h",
        finalized: true,
      }),
    ).toThrow(/message record/);
    expect(() =>
      validateRecordSchema({
        ...base,
        recordType: "observation",
        kind: "message",
        messageID: "m1",
        role: "assistant",
        textHash: "h",
      }),
    ).toThrow(/message record/);
  });

  it("rejects unknown recordType and unknown observation kind", () => {
    expect(() => validateRecordSchema({ ...base, recordType: "bogus" })).toThrow(
      /unknown recordType/,
    );
    expect(() =>
      validateRecordSchema({ ...base, recordType: "observation", kind: "bogus" }),
    ).toThrow(/unknown observation kind/);
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

  it("rejects review_observed items missing summary or location", () => {
    expect(() =>
      validateRecordSchema({
        ...base,
        recordType: "observation",
        kind: "review_observed",
        reviewScope: "src/",
        items: [
          {
            itemKey: "k",
            evidenceId: "e",
            severity: "major",
            location: "src/foo.ts:1",
            status: "open",
          },
        ],
      }),
    ).toThrow(/review_observed item/);
    expect(() =>
      validateRecordSchema({
        ...base,
        recordType: "observation",
        kind: "review_observed",
        reviewScope: "src/",
        items: [{ itemKey: "k", evidenceId: "e", severity: "major", summary: "s", status: "open" }],
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

  it("keeps shards distinct when identifier fields contain colons (no false duplicate)", () => {
    // Two logically distinct shards whose `agentId:sessionId:writerId` colon-join
    // collides to the same string, but which must remain separate shards.
    const shardA: PersistedLogRecord = { ...mk(1), sessionId: "a:b", writerId: "c" };
    const shardB: PersistedLogRecord = { ...mk(1), sessionId: "a", writerId: "b:c" };
    expect(() => validateShardSequences([shardA, shardB])).not.toThrow();
  });
});

describe("ObservationLogStore", () => {
  it("appends records and reads them back with monotonic sequences", async () => {
    const { reader, writer } = createMemFs();
    const store = new ObservationLogStore(writer, reader, "w-1");

    const seqs = [
      await store.append(shard, msgRecord()),
      await store.append(shard, msgRecord()),
      await store.append(shard, msgRecord()),
    ];
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

  it("rejects append when shardId.writerId does not match the store writerId", async () => {
    const { reader, writer } = createMemFs();
    const store = new ObservationLogStore(writer, reader, "w-1");
    const mismatched: ShardId = { agentId: "sisyphus", sessionId: "ses-1", writerId: "w-2" };
    await expect(store.append(mismatched, msgRecord())).rejects.toThrow(/writerId/);
  });
});
