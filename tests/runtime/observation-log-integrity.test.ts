import { describe, expect, it, vi } from "vitest";
import {
  validateRecordSchema,
  validatePhysicalFileSequenceOrder,
  validateShardSequences,
} from "../../src/runtime/validation";
import type {
  FullEvidenceRef,
  PendingLogRecord,
  PersistedLogRecord,
} from "../../src/core/v2/observation-model";
import type { ShardId } from "../../src/core/types";
import { SessionStateProvider } from "../../src/core/session-state-provider";
import { project, toSerializableProjectedState } from "../../src/core/v2/state-projection";
import { toPhysicalPath } from "../../src/core/v2/shard-layout";
import { ObservationHandler } from "../../src/hooks/observation-handler";
import { ObservationLogStore } from "../../src/runtime/observation-log-store";
import { StateProjectionCache } from "../../src/runtime/state-projection-cache";
import { createMemFs } from "../helpers/mock-file-system";

function payloadForKind(kind: string): Record<string, unknown> {
  switch (kind) {
    case "tool_executed":
      return {
        toolName: "bash",
        callId: "c1",
        evidence: [
          {
            evidenceId: "c1",
            kind: "command",
            sourceClass: "tool_output",
            provenance: "observed",
            toolOutputClass: "command_exec",
            command: "echo hi",
            rawOutput: "hi",
          },
        ],
      };
    case "message":
      return {
        messageID: "m1",
        role: "assistant",
        textHash: "sha256:x",
        textSnippet: "hi",
        declaredClaims: [],
        evidence: [],
        finalized: true,
      };
    case "skill_invoked":
      return { skillName: "writing-plans", source: "skill_tool" };
    case "review_observed":
      return { reviewScope: "scope-1", items: [] };
    case "session_error":
      return { errorKind: "unknown", message: "error" };
    case "reflection":
      return {
        reflection: {
          trigger: "task_succeeded",
          planRef: { path: "plan.md", taskId: "task-1" },
          intent: "check_complete",
        },
      };
    default:
      return {};
  }
}

function baseRecord(kind: string, sequence: number): PersistedLogRecord {
  return {
    schemaVersion: 1,
    timestamp: "2026-07-20T00:00:00.000Z",
    agentId: "atlas",
    sessionId: "session-1",
    writerId: "w-1",
    recordType: "observation",
    sequence,
    kind,
    ...payloadForKind(kind),
  } as unknown as PersistedLogRecord;
}

function baseFullRef(evidenceId: string, sequence = 1): FullEvidenceRef {
  return {
    kind: "full",
    agentId: "atlas",
    sessionId: "session-1",
    writerId: "w-1",
    sequence,
    evidenceId,
  };
}

function baseDecisionRecord(
  sequence: number,
  overrides: Partial<PersistedLogRecord> = {},
): PersistedLogRecord {
  return {
    schemaVersion: 1,
    timestamp: "2026-07-20T00:00:00.000Z",
    agentId: "atlas",
    sessionId: "session-1",
    writerId: "w-1",
    recordType: "decision",
    sequence,
    gateType: "task",
    verdict: "PASS",
    reachableEnforcementLevel: "L1",
    appliedEnforcementLevel: "L0",
    ruleResults: [
      {
        ruleId: "required-tests",
        verdict: "PASS",
        reason: "test fixture",
        evidenceRefs: [baseFullRef("c1")],
      },
    ],
    ...overrides,
  } as unknown as PersistedLogRecord;
}

describe("observation log integrity", () => {
  it("validates record schema for all supported kinds", () => {
    for (const kind of [
      "tool_executed",
      "message",
      "skill_invoked",
      "review_observed",
      "session_error",
      "reflection",
    ]) {
      expect(() => validateRecordSchema(baseRecord(kind, 1))).not.toThrow();
    }
  });

  it("throws for unknown observation kind", () => {
    expect(() => validateRecordSchema(baseRecord("unknown_kind", 1))).toThrow(
      "unknown observation kind",
    );
  });

  it("throws for missing common envelope fields", () => {
    const record = { ...baseRecord("tool_executed", 1), agentId: undefined };
    expect(() => validateRecordSchema(record)).toThrow();
  });

  it("throws for invalid tool_executed evidence", () => {
    const record = {
      ...baseRecord("tool_executed", 1),
      evidence: [
        { evidenceId: "c1", kind: "test", sourceClass: "tool_output", provenance: "observed" },
      ],
    };
    expect(() => validateRecordSchema(record)).toThrow();
  });

  it("throws for physical sequence inversion", () => {
    const records = [baseRecord("tool_executed", 2), baseRecord("tool_executed", 1)];
    expect(() => validatePhysicalFileSequenceOrder(records)).toThrow(
      "Physical sequence order violation",
    );
  });

  it("throws for duplicate sequences within a shard", () => {
    const records = [baseRecord("tool_executed", 1), baseRecord("tool_executed", 1)];
    expect(() => validateShardSequences(records)).toThrow("duplicate sequence detected");
  });

  it("throws for sequence gaps within a shard", () => {
    const records = [baseRecord("tool_executed", 2)];
    expect(() => validateShardSequences(records)).toThrow("gap detected");
  });
});

describe("decision log integrity", () => {
  it("validates a complete decision record", () => {
    expect(() => validateRecordSchema(baseDecisionRecord(1))).not.toThrow();
  });

  it("throws for missing decision payload fields", () => {
    for (const key of [
      "gateType",
      "verdict",
      "reachableEnforcementLevel",
      "appliedEnforcementLevel",
      "ruleResults",
    ]) {
      const record = { ...baseDecisionRecord(1), [key]: undefined };
      expect(() => validateRecordSchema(record)).toThrow("Invalid decision record");
    }
  });

  it("throws for invalid verdict", () => {
    const record = baseDecisionRecord(1, { verdict: "UNKNOWN" });
    expect(() => validateRecordSchema(record)).toThrow("Invalid decision record");
  });

  it("throws for invalid ruleResult shape", () => {
    const record = baseDecisionRecord(1, {
      ruleResults: [{ ruleId: 123, verdict: "PASS", reason: "test fixture", evidenceRefs: [] }],
    });
    expect(() => validateRecordSchema(record)).toThrow("Invalid decision ruleResult");
  });

  it("throws for invalid evidenceRef in decision ruleResult", () => {
    const record = baseDecisionRecord(1, {
      ruleResults: [
        {
          ruleId: "required-tests",
          verdict: "PASS",
          reason: "test fixture",
          evidenceRefs: [{ evidenceId: "c1" }],
        },
      ],
    });
    expect(() => validateRecordSchema(record)).toThrow("Invalid decision evidenceRef");
  });

  it("throws for negative evidenceRef sequence", () => {
    const record = baseDecisionRecord(1, {
      ruleResults: [
        {
          ruleId: "required-tests",
          verdict: "PASS",
          reason: "test fixture",
          evidenceRefs: [baseFullRef("c1", -1)],
        },
      ],
    });
    expect(() => validateRecordSchema(record)).toThrow("Invalid decision evidenceRef");
  });

  it("throws for physical sequence inversion including decision records", () => {
    const records = [baseDecisionRecord(2), baseRecord("tool_executed", 1)];
    expect(() => validatePhysicalFileSequenceOrder(records)).toThrow(
      "Physical sequence order violation",
    );
  });

  it("detects duplicate sequences across mixed record types in the same shard", () => {
    const records = [baseDecisionRecord(1), baseRecord("tool_executed", 1)];
    expect(() => validateShardSequences(records)).toThrow("duplicate sequence detected");
  });
});

describe("observation log projection rebuild integration", () => {
  const INTEGRATION_SHARD: ShardId = {
    agentId: "atlas",
    sessionId: "session-1",
    writerId: "w-1",
  };
  const STATE_PATH = ".justice/state.json";
  const REBUILT_AT = "2026-07-20T00:00:00.000Z";

  function pendingToolRecord(): PendingLogRecord {
    return {
      schemaVersion: 1,
      timestamp: "2026-07-20T00:00:00.000Z",
      agentId: INTEGRATION_SHARD.agentId,
      sessionId: INTEGRATION_SHARD.sessionId,
      writerId: INTEGRATION_SHARD.writerId,
      recordType: "observation",
      kind: "tool_executed",
      toolName: "bash",
      callId: "c1",
      evidence: [
        {
          evidenceId: "c1",
          kind: "command",
          sourceClass: "tool_output",
          provenance: "observed",
          toolOutputClass: "command_exec",
          command: "echo hi",
          rawOutput: "hi",
        },
      ],
    } as unknown as PendingLogRecord;
  }

  async function seedValidShard(store: ObservationLogStore, count: number): Promise<void> {
    for (let index = 0; index < count; index += 1) {
      await store.append(INTEGRATION_SHARD, pendingToolRecord());
    }
  }

  function integrationLines(files: Map<string, string>): string[] {
    const content = files.get(toPhysicalPath(INTEGRATION_SHARD));
    if (content === undefined) throw new Error("expected a seeded shard file");
    return content.split("\n").filter((line) => line.trim().length > 0);
  }

  function makeHandler(
    store: ObservationLogStore,
    cache: StateProjectionCache,
    logger: { warn: ReturnType<typeof vi.fn> },
  ): ObservationHandler {
    return new ObservationHandler({
      logStore: store,
      sessionStateProvider: new SessionStateProvider(),
      projectionCache: cache,
      writerId: INTEGRATION_SHARD.writerId,
      logger,
    });
  }

  function parseState(files: Map<string, string>): {
    readonly schemaVersion?: number;
    readonly integrity: { readonly maxSequenceByShard: Record<string, number> };
  } {
    const content = files.get(STATE_PATH);
    if (content === undefined) throw new Error("expected state.json to be rebuilt");
    return JSON.parse(content) as {
      schemaVersion?: number;
      integrity: { maxSequenceByShard: Record<string, number> };
    };
  }

  it("rebuilds state.json and warns on physical sequence inversion", async () => {
    const { files, reader, writer } = createMemFs();
    const store = new ObservationLogStore(writer, reader, INTEGRATION_SHARD.writerId);
    await seedValidShard(store, 3);
    const [first, second, third] = integrationLines(files);
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error("expected three seeded records");
    }
    // Physical order 1, 3, 2 breaks monotonic sequence at the final record.
    files.set(toPhysicalPath(INTEGRATION_SHARD), `${first}\n${third}\n${second}\n`);

    const logger = { warn: vi.fn() };
    const cache = new StateProjectionCache(writer, reader, STATE_PATH, { warn: vi.fn() });
    await makeHandler(store, cache, logger).initializeProjectionCache();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("log integrity violation"),
      expect.any(Error),
    );
    const written = parseState(files);
    expect(written.schemaVersion).toBe(2);
    // The corrupted shard is excluded fail-open, so the rebuilt cache holds no shards.
    expect(Object.keys(written.integrity.maxSequenceByShard)).toEqual([]);
  });

  it("rebuilds state.json and warns on a duplicate sequence within a shard", async () => {
    const { files, reader, writer } = createMemFs();
    const store = new ObservationLogStore(writer, reader, INTEGRATION_SHARD.writerId);
    await seedValidShard(store, 2);
    const [first, second] = integrationLines(files);
    if (first === undefined || second === undefined) {
      throw new Error("expected two seeded records");
    }
    // A duplicate sequence 2 corrupts the shard's per-shard integrity.
    files.set(toPhysicalPath(INTEGRATION_SHARD), `${first}\n${second}\n${second}\n`);

    const logger = { warn: vi.fn() };
    const cache = new StateProjectionCache(writer, reader, STATE_PATH, { warn: vi.fn() });
    await makeHandler(store, cache, logger).initializeProjectionCache();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("log integrity violation"),
      expect.any(Error),
    );
    expect(Object.keys(parseState(files).integrity.maxSequenceByShard)).toEqual([]);
  });

  it("rebuilds state.json and warns on a maxSequenceByShard discrepancy", async () => {
    const { files, reader, writer } = createMemFs();
    const store = new ObservationLogStore(writer, reader, INTEGRATION_SHARD.writerId);
    await seedValidShard(store, 3);
    const serialized = toSerializableProjectedState(project(await store.readAll(), REBUILT_AT));
    const [shardKey] = Object.keys(serialized.integrity.maxSequenceByShard);
    if (shardKey === undefined) throw new Error("expected one shard in the seeded log");
    // The cache claims sequence 10 while the append-only log only reaches 3.
    const tampered = {
      ...serialized,
      integrity: {
        ...serialized.integrity,
        maxSequenceByShard: { ...serialized.integrity.maxSequenceByShard, [shardKey]: 10 },
      },
    };
    files.set(STATE_PATH, JSON.stringify(tampered));

    const logger = { warn: vi.fn() };
    const cache = new StateProjectionCache(writer, reader, STATE_PATH, { warn: vi.fn() });
    await makeHandler(store, cache, logger).initializeProjectionCache();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("mismatch_seq"),
      expect.any(Error),
    );
    // The rebuilt cache reflects the log's real maximum sequence, not the stale 10.
    expect(Object.values(parseState(files).integrity.maxSequenceByShard)).toEqual([3]);
  });

  it("rebuilds state.json silently on a normal stale append", async () => {
    const { files, reader, writer } = createMemFs();
    const store = new ObservationLogStore(writer, reader, INTEGRATION_SHARD.writerId);
    await seedValidShard(store, 2);
    const cachedState = toSerializableProjectedState(project(await store.readAll(), REBUILT_AT));
    files.set(STATE_PATH, JSON.stringify(cachedState));
    // A normal subsequent append makes the cache stale without any corruption.
    await store.append(INTEGRATION_SHARD, pendingToolRecord());

    const logger = { warn: vi.fn() };
    const cache = new StateProjectionCache(writer, reader, STATE_PATH, { warn: vi.fn() });
    await makeHandler(store, cache, logger).initializeProjectionCache();

    // stale_append is a benign, expected condition and must rebuild silently.
    expect(logger.warn).not.toHaveBeenCalled();
    expect(Object.values(parseState(files).integrity.maxSequenceByShard)).toEqual([3]);
  });
});
