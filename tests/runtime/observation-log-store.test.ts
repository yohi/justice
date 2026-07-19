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
      // `size` (small here) governs size-based rotation. `mtimeMs` is required by
      // the FileReader contract but unused by rotation; age is measured from the
      // oldest record's `timestamp` (msgRecord keeps it recent), so none fires.
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
    timestamp: new Date().toISOString(),
    agentId: "sisyphus",
    sessionId: "ses-1",
    writerId: "w-1",
    recordType: "observation",
    kind: "message",
    messageID: "m1",
    role: "assistant",
    textHash: "abc",
    declaredClaims: [],
    evidence: [],
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
        declaredClaims: [],
        evidence: [],
        finalized: true,
      }),
    ).not.toThrow();
    expect(() =>
      validateRecordSchema({
        ...base,
        recordType: "observation",
        kind: "skill_invoked",
        skillName: "git-master",
        source: "skill_tool",
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
                kind: "full",
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
                kind: "full",
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

  it('rejects a decision evidenceRef missing kind:"full"', () => {
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

  it("accepts a legacy message record without declaredClaims/evidence (normalized)", () => {
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
  });

  it("rejects a message record with mismatched declaredClaims/evidence arrays", () => {
    expect(() =>
      validateRecordSchema({
        ...base,
        recordType: "observation",
        kind: "message",
        messageID: "m1",
        role: "assistant",
        textHash: "h",
        finalized: true,
        declaredClaims: [{ evidenceId: "e1", claimKind: "generic", outcome: "unknown" }],
        evidence: [],
      }),
    ).toThrow(/message record/);
  });

  it("rejects a message record with non-array declaredClaims", () => {
    expect(() =>
      validateRecordSchema({
        ...base,
        recordType: "observation",
        kind: "message",
        messageID: "m1",
        role: "assistant",
        textHash: "h",
        finalized: true,
        declaredClaims: "not-an-array",
        evidence: [],
      }),
    ).toThrow(/message record/);
  });

  it("rejects a message record with non-array evidence", () => {
    expect(() =>
      validateRecordSchema({
        ...base,
        recordType: "observation",
        kind: "message",
        messageID: "m1",
        role: "assistant",
        textHash: "h",
        finalized: true,
        declaredClaims: [],
        evidence: "not-an-array",
      }),
    ).toThrow(/message record/);
  });

  it("accepts a message record with empty declaredClaims and evidence arrays", () => {
    expect(() =>
      validateRecordSchema({
        ...base,
        recordType: "observation",
        kind: "message",
        messageID: "m1",
        role: "assistant",
        textHash: "h",
        finalized: true,
        declaredClaims: [],
        evidence: [],
      }),
    ).not.toThrow();
  });

  it("rejects a message record with evidence array missing", () => {
    expect(() =>
      validateRecordSchema({
        ...base,
        recordType: "observation",
        kind: "message",
        messageID: "m1",
        role: "assistant",
        textHash: "h",
        finalized: true,
        declaredClaims: [],
      }),
    ).toThrow(/message record/);
  });

  it("rejects a message record with declaredClaims array missing", () => {
    expect(() =>
      validateRecordSchema({
        ...base,
        recordType: "observation",
        kind: "message",
        messageID: "m1",
        role: "assistant",
        textHash: "h",
        finalized: true,
        evidence: [],
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
    skillName: "fixture-skill",
    source: "skill_tool",
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

  it("throws when a shard's sequence starts above 1 (leading gap)", () => {
    expect(() => validateShardSequences([mk(2), mk(3)])).toThrow(/gap detected/);
  });

  it("throws when a shard's sequence skips a number (mid-stream gap)", () => {
    expect(() => validateShardSequences([mk(1), mk(3)])).toThrow(/gap detected/);
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

  it("excludes only the corrupted shard from readAll when one shard has a sequence gap", async () => {
    const { files, reader, writer } = createMemFs();
    // Healthy shard: writer w-1 (the default `shard` writerId used elsewhere in this file).
    const store = new ObservationLogStore(writer, reader, "w-1");
    await store.append(shard, msgRecord());
    await store.append(shard, msgRecord());
    // Corrupted shard: a different writer whose on-disk log has a gap (seq 1 then 3, missing 2).
    const gappyPath = ".justice/events/sisyphus/other/w-9.jsonl";
    const gappyLine1 = `${JSON.stringify({ ...msgRecord(), writerId: "w-9", sequence: 1 })}\n`;
    const gappyLine2 = `${JSON.stringify({ ...msgRecord(), writerId: "w-9", sequence: 3 })}\n`;
    files.set(gappyPath, gappyLine1 + gappyLine2);

    const all = await store.readAll();

    // The healthy shard's 2 records survive; the gappy shard's 2 records are excluded
    // entirely (not silently returned as if seq 1/3 were the whole shard).
    expect(all).toHaveLength(2);
    expect(all.every((r) => r.writerId === "w-1")).toBe(true);
  });

  it("excludes a shard when one physical file stores its sequences out of order", async () => {
    // Given: one healthy shard and one physical JSONL file whose line order is sequence 2 then 1.
    const { files, reader, writer } = createMemFs();
    const store = new ObservationLogStore(writer, reader, "w-1");
    await store.append(shard, msgRecord());
    const reorderedPath = ".justice/events/sisyphus/other/w-9.jsonl";
    const sequence2 = `${JSON.stringify({ ...msgRecord(), writerId: "w-9", sequence: 2 })}\n`;
    const sequence1 = `${JSON.stringify({ ...msgRecord(), writerId: "w-9", sequence: 1 })}\n`;
    files.set(reorderedPath, sequence2 + sequence1);

    // When: all physical files are read and validated.
    const all = await store.readAll();

    // Then: the tampered shard is excluded while the healthy shard remains available.
    expect(all).toHaveLength(1);
    expect(all.every((record) => record.writerId === "w-1")).toBe(true);
  });

  it("excludes a shard entirely when only one of several physical files for that shard has out-of-order sequences", async () => {
    // Given: shard w-1 has TWO physical files sharing the same shard identity -
    // a healthy archived segment (in-order) and an active file whose physical
    // line order is reversed (seq 3 recorded before seq 2).
    const { files, reader, writer } = createMemFs();
    const enc = encodeSafeSegment("ses-1");
    const archivePath = `.justice/archive/events/sisyphus/${enc}/w-1.20260101T000000Z.jsonl`;
    files.set(archivePath, `${JSON.stringify({ ...msgRecord(), sequence: 1 })}\n`);
    files.set(
      toPhysicalPath(shard),
      `${JSON.stringify({ ...msgRecord(), sequence: 3 })}\n${JSON.stringify({ ...msgRecord(), sequence: 2 })}\n`,
    );

    const store = new ObservationLogStore(writer, reader, "w-1");

    // When: all physical files are read and validated.
    const all = await store.readAll();

    // Then: the healthy archive segment's record shares shard identity with the
    // tainted active file, so the whole shard is excluded rather than partially
    // returned.
    expect(all).toHaveLength(0);
  });

  it("rejects append when shardId.writerId does not match the store writerId", async () => {
    const { reader, writer } = createMemFs();
    const store = new ObservationLogStore(writer, reader, "w-1");
    const mismatched: ShardId = { agentId: "sisyphus", sessionId: "ses-1", writerId: "w-2" };
    await expect(store.append(mismatched, msgRecord())).rejects.toThrow(/writerId/);
  });
});

describe("ObservationLogStore.destroySession()", () => {
  it("releases the write queue's cache for the session's shard so a later append re-reads from disk", async () => {
    const { reader, writer } = createMemFs();
    let readCount = 0;
    const countingReader: FileReader = {
      ...reader,
      readFile: async (p: string) => {
        readCount += 1;
        return reader.readFile(p);
      },
    };
    const store = new ObservationLogStore(writer, countingReader, "w-1");

    await store.append(shard, msgRecord());
    await store.append(shard, msgRecord());
    const readsBeforeDestroy = readCount;

    store.destroySession(shard.sessionId);

    await store.append(shard, msgRecord());
    // The contents/shardCreatedAtMs caches were released, so the post-destroy append must
    // re-derive existing state from disk, causing at least one additional readFile call.
    expect(readCount).toBeGreaterThan(readsBeforeDestroy);

    const all = await store.readAll();
    expect(all.map((r) => r.sequence)).toEqual([1, 2, 3]);
  });

  it("only releases shards belonging to the destroyed session, leaving other sessions' correctness intact", async () => {
    const { reader, writer } = createMemFs();
    const store = new ObservationLogStore(writer, reader, "w-1");
    const shardA: ShardId = { agentId: "sisyphus", sessionId: "ses-a", writerId: "w-1" };
    const shardB: ShardId = { agentId: "sisyphus", sessionId: "ses-b", writerId: "w-1" };
    const recordFor = (sessionId: string): PendingLogRecord => ({ ...msgRecord(), sessionId });

    await store.append(shardA, recordFor("ses-a"));
    await store.append(shardB, recordFor("ses-b"));

    store.destroySession("ses-a");

    // ses-b's shard cache was never touched; its sequence continues normally.
    expect(await store.append(shardB, recordFor("ses-b"))).toBe(2);
    // ses-a's shard cache was released but still re-derives the correct next sequence.
    expect(await store.append(shardA, recordFor("ses-a"))).toBe(2);

    const all = await store.readAll();
    expect(all).toHaveLength(4);
  });

  it("is a safe no-op for a sessionId with no known shards", () => {
    const { reader, writer } = createMemFs();
    const store = new ObservationLogStore(writer, reader, "w-1");
    expect(() => store.destroySession("unknown-session")).not.toThrow();
  });
});

it("readAll merges archived segments before active segments", async () => {
  const { files, reader, writer } = createMemFs();
  const enc = encodeSafeSegment("ses-1");
  const archivePath = `.justice/archive/events/sisyphus/${enc}/w-1.20260101T000000Z.jsonl`;
  files.set(
    archivePath,
    `${JSON.stringify({ ...msgRecord(), sequence: 1 })}
`,
  );

  const store = new ObservationLogStore(writer, reader, "w-1");
  await store.append(shard, msgRecord());

  const all = await store.readAll();
  expect(all).toHaveLength(2);
  expect(all.map((r) => r.sequence)).toEqual([1, 2]);
});

it("validates physical sequence order independently for each file", async () => {
  // Given: traversal encounters sequence 2 in archive before sequence 1 in active,
  // while each physical file is internally ordered.
  const { files, reader, writer } = createMemFs();
  const enc = encodeSafeSegment("ses-1");
  const archivePath = `.justice/archive/events/sisyphus/${enc}/w-1.20260101T000000Z.jsonl`;
  files.set(archivePath, `${JSON.stringify({ ...msgRecord(), sequence: 2 })}\n`);
  files.set(toPhysicalPath(shard), `${JSON.stringify({ ...msgRecord(), sequence: 1 })}\n`);
  const store = new ObservationLogStore(writer, reader, "w-1");

  // When: archive and active files are merged.
  const all = await store.readAll();

  // Then: cross-file traversal order is not treated as physical-file corruption.
  expect(all.map((record) => record.sequence)).toEqual([2, 1]);
});

describe("rotateIfNeeded() defensive guard", () => {
  it("returns false without rotating when the path has no registered shard", async () => {
    const { reader, writer } = createMemFs();
    const store = new ObservationLogStore(writer, reader, "w-1");

    // `rotateIfNeeded` runs as the write queue's `onAppendComplete`, keyed by a
    // `shardsByPath` entry that `append()` registers before enqueueing. A path
    // that never went through `append()` has no such entry; this exercises
    // that defensive early-return branch directly (never reachable through the
    // public `append()` API, which always registers the shard first).
    const internal = store as unknown as {
      rotateIfNeeded(path: string): Promise<boolean>;
    };

    await expect(internal.rotateIfNeeded("unregistered/path.jsonl")).resolves.toBe(false);
  });
});

describe("ReadOnlyObservationLog interface", () => {
  it("ObservationLogStore satisfies ReadOnlyObservationLog structurally", () => {
    const { reader, writer } = createMemFs();
    const store = new ObservationLogStore(writer, reader, "w-1");
    // Structural typing check: the store should be assignable to ReadOnlyObservationLog
    const readOnly: import("../../src/runtime/observation-log-store").ReadOnlyObservationLog =
      store;
    expect(readOnly).toBeDefined();
    expect(typeof readOnly.readAll).toBe("function");
  });

  it("readAll returns readonly records through the ReadOnlyObservationLog interface", async () => {
    const { reader, writer } = createMemFs();
    const store = new ObservationLogStore(writer, reader, "w-1");
    await store.append(shard, msgRecord());

    const readOnly: import("../../src/runtime/observation-log-store").ReadOnlyObservationLog =
      store;
    const records = await readOnly.readAll();
    expect(records).toHaveLength(1);
    expect(records[0].sequence).toBe(1);
  });
});
