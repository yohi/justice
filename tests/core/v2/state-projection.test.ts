// tests/core/v2/state-projection.test.ts
import { describe, expect, it } from "vitest";
import {
  fromSerializableProjectedState,
  project,
  toSerializableProjectedState,
} from "../../../src/core/v2/state-projection";
import type {
  ObservationRecord,
  DecisionRecord,
  ReviewItem,
} from "../../../src/core/v2/observation-model";

function toolEvent(
  seq: number,
  ts: string,
  taskId: string,
  evidenceId: string,
  writerId = "w1",
): ObservationRecord {
  return {
    schemaVersion: 1,
    sequence: seq,
    timestamp: ts,
    agentId: "atlas",
    sessionId: "s1",
    writerId,
    recordType: "observation",
    taskId,
    kind: "tool_executed",
    toolName: "bash",
    callId: `c-${seq}`,
    evidence: {
      evidenceId,
      kind: "test",
      sourceClass: "tool_output",
      provenance: "observed",
      toolOutputClass: "command_exec",
      command: "bun run test",
      rawOutput: "1 passed",
    },
  };
}

function reviewItem(
  itemKey: string,
  severity: ReviewItem["severity"],
  status: ReviewItem["status"],
): ReviewItem {
  return {
    itemKey,
    evidenceId: `ev-${itemKey}`,
    severity,
    summary: "s",
    location: "src/x.ts",
    status,
  };
}

function reviewEvent(
  seq: number,
  ts: string,
  taskId: string,
  scope: string,
  items: readonly ReviewItem[],
): ObservationRecord {
  return {
    schemaVersion: 1,
    sequence: seq,
    timestamp: ts,
    agentId: "atlas",
    sessionId: "s1",
    writerId: "w1",
    recordType: "observation",
    taskId,
    kind: "review_observed",
    reviewScope: scope,
    items,
  };
}

function decisionEvent(
  seq: number,
  ts: string,
  taskId: string,
  verdict: DecisionRecord["verdict"],
): DecisionRecord {
  return {
    schemaVersion: 1,
    sequence: seq,
    timestamp: ts,
    agentId: "atlas",
    sessionId: "s1",
    writerId: "w1",
    recordType: "decision",
    taskId,
    gateType: "task",
    verdict,
    reachableEnforcementLevel: "L1",
    appliedEnforcementLevel: "L0",
    ruleResults: [],
  };
}

const REBUILT_AT = "2026-07-06T00:00:00.000Z";

describe("project() task fold", () => {
  it("collects tool evidence per task and applies decision verdict as status", () => {
    const events = [
      toolEvent(1, "2026-07-06T00:00:01Z", "task-1", "ev-1"),
      toolEvent(2, "2026-07-06T00:00:02Z", "task-1", "ev-2"),
      decisionEvent(3, "2026-07-06T00:00:03Z", "task-1", "PASS"),
    ];
    const state = project(events, REBUILT_AT);
    const task = state.tasks.get("task-1");
    expect(task).toBeDefined();
    expect(task?.evidence.map((e) => e.ref.evidenceId)).toEqual(["ev-1", "ev-2"]);
    expect(task?.evidence[0]?.ref.kind).toBe("full");
    expect(task?.status).toBe("PASS");
    expect(task?.lastVerdict).toBe("PASS");
  });

  it("ignores observation records without a taskId", () => {
    const noTask: ObservationRecord = {
      ...toolEvent(1, "2026-07-06T00:00:01Z", "x", "ev"),
      taskId: undefined,
    };
    const state = project([noTask], REBUILT_AT);
    expect(state.tasks.size).toBe(0);
  });

  it("records maxSequenceByShard per shard", () => {
    const events = [
      toolEvent(1, "2026-07-06T00:00:01Z", "task-1", "ev-1", "w1"),
      toolEvent(5, "2026-07-06T00:00:02Z", "task-1", "ev-2", "w1"),
      toolEvent(2, "2026-07-06T00:00:03Z", "task-1", "ev-3", "w2"),
    ];
    const state = project(events, REBUILT_AT);
    expect(state.integrity.maxSequenceByShard.get("atlas:s1:w1")).toBe(5);
    expect(state.integrity.maxSequenceByShard.get("atlas:s1:w2")).toBe(2);
  });
});

describe("project() review summary fold", () => {
  it("aggregates review items into global and byScope buckets with observed items open", () => {
    const events = [
      reviewEvent(1, "2026-07-06T00:00:01Z", "task-1", "src/api", [
        reviewItem("a", "critical", "open"),
        reviewItem("b", "major", "resolved"),
      ]),
      reviewEvent(2, "2026-07-06T00:00:02Z", "task-1", "src/ui", [
        reviewItem("c", "minor", "open"),
      ]),
    ];
    const state = project(events, REBUILT_AT);
    const rs = state.reviewSummary;

    expect(rs.authority).toBe("observed_review_output");
    expect(rs.critical.map((i) => i.itemKey)).toEqual(["a"]);
    expect(rs.major.map((i) => i.itemKey)).toEqual(["b"]);
    expect(rs.minor.map((i) => i.itemKey)).toEqual(["c"]);
    expect(rs.open.map((i) => i.itemKey).sort()).toEqual(["a", "b", "c"]);
    expect(rs.resolved).toEqual([]);

    expect(rs.byScope.get("src/api")?.critical.map((i) => i.itemKey)).toEqual(["a"]);
    expect(rs.byScope.get("src/ui")?.minor.map((i) => i.itemKey)).toEqual(["c"]);
    expect(state.tasks.get("task-1")?.observedReviewScopes).toEqual(["src/api", "src/ui"]);
  });

  it("records each observed review scope once in first-seen order", () => {
    const events = [
      reviewEvent(1, "2026-07-06T00:00:01Z", "task-1", "src/api", []),
      reviewEvent(2, "2026-07-06T00:00:02Z", "task-1", "src/ui", []),
      reviewEvent(3, "2026-07-06T00:00:03Z", "task-1", "src/api", []),
    ];

    const state = project(events, REBUILT_AT);

    expect(state.tasks.get("task-1")?.observedReviewScopes).toEqual(["src/api", "src/ui"]);
  });

  it("handles empty-string reviewScope consistently across foldReviewSummary and project()", () => {
    // reviewScope is a required string, but the empty string is a valid runtime
    // value. foldReviewSummary creates a byScope bucket unconditionally, while
    // project()'s task fold skips falsy scopes for observedReviewScopes.
    const events = [
      reviewEvent(1, "2026-07-06T00:00:01Z", "task-1", "", [reviewItem("a", "critical", "open")]),
    ];
    const state = project(events, REBUILT_AT);

    // Global buckets aggregate the item regardless of scope.
    expect(state.reviewSummary.critical.map((i) => i.itemKey)).toEqual(["a"]);
    // foldReviewSummary records an empty-string byScope bucket...
    expect(state.reviewSummary.byScope.has("")).toBe(true);
    expect(state.reviewSummary.byScope.get("")?.critical.map((i) => i.itemKey)).toEqual(["a"]);
    // ...but project() skips falsy scopes, so the task observes none.
    expect(state.tasks.get("task-1")?.observedReviewScopes).toEqual([]);
  });

  it("ignores undefined reviewScope for observedReviewScopes (runtime type-drift guard)", () => {
    // reviewScope is required by the type, so undefined can only arrive via schema
    // drift / external data. project() must not push it as an observed scope.
    const base = reviewEvent(1, "2026-07-06T00:00:01Z", "task-1", "x", [
      reviewItem("a", "major", "open"),
    ]);
    const drifted = { ...base, reviewScope: undefined } as unknown as typeof base;
    const state = project([drifted], REBUILT_AT);

    expect(state.tasks.get("task-1")?.observedReviewScopes).toEqual([]);
    // The item is still aggregated into the global buckets.
    expect(state.reviewSummary.major.map((i) => i.itemKey)).toEqual(["a"]);
  });
});

describe("project() determinism and ordering", () => {
  it("produces identical state (incl. sourceHash) for the same events", () => {
    const events = [
      toolEvent(2, "2026-07-06T00:00:02Z", "task-1", "ev-2", "w2"),
      toolEvent(1, "2026-07-06T00:00:01Z", "task-1", "ev-1", "w1"),
      decisionEvent(3, "2026-07-06T00:00:03Z", "task-1", "WARN"),
    ];
    const a = project(events, REBUILT_AT);
    const b = project([...events].reverse(), REBUILT_AT);
    expect(a.integrity.sourceHash).toBe(b.integrity.sourceHash);
    expect(a).toEqual(b);
  });

  it("is deterministic even when timestamps are unparseable (NaN guarded, F1)", () => {
    const events = [
      toolEvent(1, "not-a-valid-date", "task-1", "ev-1", "w1"),
      toolEvent(1, "also-not-a-date", "task-1", "ev-2", "w2"),
    ];
    const a = project(events, REBUILT_AT);
    const b = project([...events].reverse(), REBUILT_AT);
    expect(a.integrity.sourceHash).toBe(b.integrity.sourceHash);
    expect(a).toEqual(b);
  });
});

describe("ProjectedState JSON round-trip", () => {
  it("serializes ReadonlyMap fields to plain objects and restores them", () => {
    const events = [
      toolEvent(1, "2026-07-06T00:00:01Z", "task-1", "ev-1"),
      reviewEvent(2, "2026-07-06T00:00:02Z", "task-1", "src/api", [
        reviewItem("a", "critical", "open"),
      ]),
    ];
    const state = project(events, REBUILT_AT);

    const serialized = toSerializableProjectedState(state);
    const json = JSON.parse(JSON.stringify(serialized)) as unknown;
    // Serialized maps must be plain objects, not arrays.
    expect(Array.isArray(serialized.integrity.maxSequenceByShard)).toBe(false);
    expect(Array.isArray(serialized.reviewSummary.byScope)).toBe(false);

    const restored = fromSerializableProjectedState(json);
    expect(restored.integrity.maxSequenceByShard.get("atlas:s1:w1")).toBe(2);
    expect(restored.tasks.get("task-1")?.evidence).toHaveLength(1);
    expect(restored.reviewSummary.byScope.get("src/api")?.critical).toHaveLength(1);
    expect(restored.integrity.sourceHash).toBe(state.integrity.sourceHash);
  });
});
