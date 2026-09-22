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
  PlanFinalizationState,
  ReviewItem,
  TaskProgressState,
} from "../../../src/core/v2/observation-model";
import type { ReviewCorrelation, TaskExecutionRef } from "../../../src/core/types";

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

function messageEvent(
  sequence: number,
  timestamp: string,
  taskId: string,
  outcome: "pass" | "fail",
  partID?: string,
): ObservationRecord {
  const claimSource = partID === undefined ? "message-1" : JSON.stringify(["message-1", partID]);
  const evidenceId = `${claimSource}-test`;
  return {
    schemaVersion: 1,
    sequence,
    timestamp,
    agentId: "atlas",
    sessionId: "s1",
    writerId: "w1",
    recordType: "observation",
    taskId,
    kind: "message",
    messageID: "message-1",
    ...(partID === undefined ? {} : { partID }),
    role: "assistant",
    textHash: `hash-${sequence}`,
    declaredClaims: [{ evidenceId, claimKind: "test", outcome }],
    evidence: [
      {
        evidenceId,
        kind: "test",
        sourceClass: "declared_claim",
        provenance: "declared",
        declaredFrom: "message",
        claim: { claimKind: "test", outcome },
      },
    ],
    finalized: true,
  };
}

function taskLifecycleEvent(
  sequence: number,
  from: TaskProgressState,
  to: TaskProgressState,
  taskExecutionRef: TaskExecutionRef = {
    authorizationId: "auth-1",
    taskId: "task-1",
    attemptId: "attempt-1",
  },
  parentSessionId = "s1",
): ObservationRecord {
  return {
    schemaVersion: 1,
    sequence,
    timestamp: `2026-07-06T00:00:${String(sequence).padStart(2, "0")}Z`,
    agentId: "atlas",
    sessionId: parentSessionId,
    writerId: "w1",
    recordType: "observation",
    taskId: "task-1",
    kind: "task_lifecycle_transition",
    parentSessionId,
    taskExecutionRef,
    from,
    to,
  };
}

type PlanFinalizationEventOptions = {
  readonly parentSessionId?: string;
  readonly authorizationId?: string;
  readonly planPath?: string;
  readonly finalizationAttemptId?: string;
  readonly finalReviewRound?: number;
};

function planFinalizationEvent(
  sequence: number,
  from: PlanFinalizationState,
  to: PlanFinalizationState,
  options: PlanFinalizationEventOptions = {},
): ObservationRecord {
  const parentSessionId = options.parentSessionId ?? "s1";
  const authorizationId = options.authorizationId ?? "auth-1";
  const planPath = options.planPath ?? "plan.md";
  const finalizationAttemptId = options.finalizationAttemptId ?? "final-1";
  const finalReviewRound = options.finalReviewRound ?? 1;
  return {
    schemaVersion: 1,
    sequence,
    timestamp: `2026-07-06T00:01:${String(sequence).padStart(2, "0")}Z`,
    agentId: "atlas",
    sessionId: parentSessionId,
    writerId: "w1",
    recordType: "observation",
    kind: "plan_finalization_transition",
    parentSessionId,
    authorizationId,
    planPath,
    finalizationAttemptId,
    finalReviewRound,
    from,
    to,
  };
}

const REBUILT_AT = "2026-07-06T00:00:00.000Z";

describe("project() task fold", () => {
  it("projects a claimed review slot into a durable task call binding", () => {
    const correlation = {
      reviewKind: "task-review",
      taskExecutionRef: { authorizationId: "auth-1", taskId: "task-1", attemptId: "attempt-1" },
      reviewRound: 1,
    } as const satisfies ReviewCorrelation;
    const pending = {
      schemaVersion: 1 as const,
      sequence: 1,
      timestamp: "2026-07-06T00:00:01Z",
      agentId: "atlas" as const,
      sessionId: "s1",
      writerId: "w1",
      recordType: "observation" as const,
      kind: "review_dispatch_transition" as const,
      transitionId: "pending-1",
      parentSessionId: "s1",
      correlation,
      expectedCategory: "sp-review" as const,
      from: null,
      to: "pending" as const,
    } satisfies ObservationRecord;
    const claimed = {
      ...pending,
      sequence: 2,
      timestamp: "2026-07-06T00:00:02Z",
      transitionId: "claimed-1",
      from: "pending" as const,
      to: "claimed" as const,
      callId: "call-1",
      artifactReservation: {
        status: "usable" as const,
        artifactId: "artifact-1",
        artifactPath: ".justice/reviews/artifact-1.json",
        leasePath: ".justice/reviews/.leases/artifact-1.lease",
        artifactIdentity: { device: "1", inode: "2" },
      },
    } satisfies ObservationRecord;

    const state = project([claimed, pending], REBUILT_AT);

    expect(state.reviewDispatchSlots).toMatchObject([
      { state: "claimed", callId: "call-1", key: { parentSessionId: "s1", correlation } },
    ]);
    expect(state.taskCallBindings).toMatchObject([
      { purpose: "task_review", callId: "call-1", expectedCategory: "sp-review", correlation },
    ]);
  });

  it("projects lifecycle records without aborting later records", () => {
    const invalidRecord = {
      schemaVersion: 1 as const,
      sequence: 1,
      timestamp: "2026-07-06T00:00:01Z",
      agentId: "atlas" as const,
      sessionId: "s1",
      writerId: "w1",
      recordType: "observation" as const,
      kind: "task_lifecycle_transition" as const,
      taskId: "task-1",
      parentSessionId: "s1",
      authorizationId: "auth-1",
      taskExecutionRef: {
        authorizationId: "auth-1",
        taskId: "task-1",
        attemptId: "attempt-1",
      },
      from: "accepted" as const,
      to: "pending" as const,
    };
    const validRecord = {
      ...invalidRecord,
      sequence: 2,
      from: "pending" as const,
      to: "authorized" as const,
    };
    const finalRecord = {
      ...invalidRecord,
      sequence: 3,
      from: "authorized" as const,
      to: "in_progress" as const,
    };

    const state = project([invalidRecord, validRecord, finalRecord], REBUILT_AT);

    expect(state.lifecycle.taskStates.get(JSON.stringify(["s1", "auth-1", "task-1"]))).toBe(
      "in_progress",
    );
  });

  it("replays all transitions for one task attempt and retains its identity", () => {
    const ref = { authorizationId: "auth-1", taskId: "task-1", attemptId: "attempt-1" } as const;
    const states = [
      ["pending", "authorized"],
      ["authorized", "in_progress"],
      ["in_progress", "worker_reported"],
      ["worker_reported", "evidence_pending"],
      ["evidence_pending", "review_pending"],
    ] as const;
    const events = states.map(([from, to], index) => ({
      schemaVersion: 1 as const,
      sequence: index + 1,
      timestamp: `2026-07-06T00:00:0${index + 1}Z`,
      agentId: "atlas" as const,
      sessionId: "s1",
      writerId: "w1",
      recordType: "observation" as const,
      taskId: "task-1",
      kind: "task_lifecycle_transition" as const,
      parentSessionId: "s1",
      taskExecutionRef: ref,
      from,
      to,
    }));

    const state = project(events, REBUILT_AT);
    const key = JSON.stringify(["s1", "auth-1", "task-1"]);
    expect(state.lifecycle.taskStates.get(key)).toBe("review_pending");
    expect(state.lifecycle.currentTaskExecutionRefs.get(key)).toEqual(ref);
  });

  it("ignores a new execution reference before the task enters rework", () => {
    const firstRef = {
      authorizationId: "auth-1",
      taskId: "task-1",
      attemptId: "attempt-1",
    } as const;
    const first = taskLifecycleEvent(1, "pending", "authorized", firstRef);
    const stale = taskLifecycleEvent(2, "authorized", "in_progress", {
      authorizationId: "auth-1",
      taskId: "task-1",
      attemptId: "attempt-2",
    });

    const state = project([first, stale], REBUILT_AT);

    const key = JSON.stringify(["s1", "auth-1", "task-1"]);
    expect(state.lifecycle.taskStates.get(key)).toBe("authorized");
    expect(state.lifecycle.currentTaskExecutionRefs.get(key)).toEqual(firstRef);
  });

  it("accepts a new execution reference after rework", () => {
    const ref1 = {
      authorizationId: "auth-1",
      taskId: "task-1",
      attemptId: "attempt-1",
    } as const;
    const ref2 = { ...ref1, attemptId: "attempt-2" } as const;
    const events = [
      taskLifecycleEvent(1, "pending", "authorized", ref1),
      taskLifecycleEvent(2, "authorized", "in_progress", ref1),
      taskLifecycleEvent(3, "in_progress", "worker_reported", ref1),
      taskLifecycleEvent(4, "worker_reported", "evidence_pending", ref1),
      taskLifecycleEvent(5, "evidence_pending", "review_pending", ref1),
      taskLifecycleEvent(6, "review_pending", "rework_required", ref1),
      taskLifecycleEvent(7, "rework_required", "in_progress", ref2),
    ];

    const state = project(events, REBUILT_AT);

    const key = JSON.stringify(["s1", "auth-1", "task-1"]);
    expect(state.lifecycle.taskStates.get(key)).toBe("in_progress");
    expect(state.lifecycle.currentTaskExecutionRefs.get(key)).toEqual(ref2);
  });

  it("keeps task lifecycle state independent across parent and authorization scopes", () => {
    const state = project(
      [
        taskLifecycleEvent(
          1,
          "pending",
          "authorized",
          { authorizationId: "auth-a", taskId: "task-1", attemptId: "attempt-a" },
          "parent-1",
        ),
        taskLifecycleEvent(
          2,
          "pending",
          "authorized",
          { authorizationId: "auth-b", taskId: "task-1", attemptId: "attempt-b" },
          "parent-1",
        ),
        taskLifecycleEvent(
          3,
          "pending",
          "authorized",
          { authorizationId: "auth-a", taskId: "task-1", attemptId: "attempt-c" },
          "parent-2",
        ),
      ],
      REBUILT_AT,
    );

    expect(state.lifecycle.taskStates.size).toBe(3);
    expect(state.lifecycle.taskStates.get(JSON.stringify(["parent-1", "auth-a", "task-1"]))).toBe(
      "authorized",
    );
    expect(state.lifecycle.taskStates.get(JSON.stringify(["parent-1", "auth-b", "task-1"]))).toBe(
      "authorized",
    );
    expect(state.lifecycle.taskStates.get(JSON.stringify(["parent-2", "auth-a", "task-1"]))).toBe(
      "authorized",
    );
  });

  it("compares task execution references by fixed field order", () => {
    const firstRef = {
      authorizationId: "auth-1",
      taskId: "task-1",
      attemptId: "attempt-1",
    } as const;
    const equivalentRef = {
      taskId: "task-1",
      attemptId: "attempt-1",
      authorizationId: "auth-1",
    } as const;

    const state = project(
      [
        taskLifecycleEvent(1, "pending", "authorized", firstRef),
        taskLifecycleEvent(2, "authorized", "in_progress", equivalentRef),
      ],
      REBUILT_AT,
    );

    const key = JSON.stringify(["s1", "auth-1", "task-1"]);
    expect(state.lifecycle.taskStates.get(key)).toBe("in_progress");
    expect(state.lifecycle.currentTaskExecutionRefs.get(key)).toEqual(equivalentRef);
  });

  it("projects valid and invalid plan finalization transitions", () => {
    const state = project(
      [
        planFinalizationEvent(1, "tasks_pending", "all_tasks_accepted"),
        planFinalizationEvent(2, "tasks_pending", "final_review_pending"),
      ],
      REBUILT_AT,
    );

    expect(state.lifecycle.finalization.get(JSON.stringify(["s1", "auth-1", "plan.md"]))).toEqual({
      parentSessionId: "s1",
      authorizationId: "auth-1",
      planPath: "plan.md",
      finalizationAttemptId: "final-1",
      finalReviewRound: 1,
      state: "all_tasks_accepted",
    });
  });

  it("keeps legacy task GateDecision records in compatibility projection", () => {
    const state = project(
      [decisionEvent(1, "2026-07-06T00:00:01Z", "task-1", "PASS")],
      REBUILT_AT,
    );

    expect(state.tasks.get("task-1")?.lastVerdict).toBe("PASS");
  });

  it("replays final Gate transitions to the terminal plan state", () => {
    const state = project(
      [
        planFinalizationEvent(1, "tasks_pending", "all_tasks_accepted"),
        planFinalizationEvent(2, "all_tasks_accepted", "final_review_pending"),
        planFinalizationEvent(3, "final_review_pending", "final_gate_pending"),
        planFinalizationEvent(4, "final_gate_pending", "complete"),
      ],
      REBUILT_AT,
    );

    expect(state.lifecycle.finalization.get(JSON.stringify(["s1", "auth-1", "plan.md"]))?.state).toBe(
      "complete",
    );
  });

  it("keeps finalization progress independent for each composite plan scope", () => {
    const planA = {
      parentSessionId: "parent-1",
      authorizationId: "auth-a",
      planPath: "plans/a.md",
      finalizationAttemptId: "final-a",
    } as const;
    const planB = {
      parentSessionId: "parent-1",
      authorizationId: "auth-b",
      planPath: "plans/b.md",
      finalizationAttemptId: "final-b",
    } as const;
    const state = project(
      [
        planFinalizationEvent(1, "tasks_pending", "all_tasks_accepted", planA),
        planFinalizationEvent(2, "tasks_pending", "all_tasks_accepted", planB),
        planFinalizationEvent(3, "all_tasks_accepted", "final_review_pending", planA),
        planFinalizationEvent(4, "all_tasks_accepted", "final_review_pending", planB),
      ],
      REBUILT_AT,
    );

    expect(state.lifecycle.finalization.size).toBe(2);
    expect(
      state.lifecycle.finalization.get(JSON.stringify(["parent-1", "auth-a", "plans/a.md"]))?.state,
    ).toBe("final_review_pending");
    expect(
      state.lifecycle.finalization.get(JSON.stringify(["parent-1", "auth-b", "plans/b.md"]))?.state,
    ).toBe("final_review_pending");
  });

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

  it("keeps only the latest finalized message claim for each evidence identity", () => {
    const state = project(
      [
        messageEvent(1, "2026-07-06T00:00:01Z", "task-1", "pass"),
        messageEvent(2, "2026-07-06T00:00:02Z", "task-1", "fail"),
      ],
      REBUILT_AT,
    );

    expect(state.tasks.get("task-1")?.evidence).toEqual([
      expect.objectContaining({
        evidence: expect.objectContaining({
          evidenceId: "message-1-test",
          claim: expect.objectContaining({ outcome: "fail" }),
        }),
        ref: expect.objectContaining({ sequence: 2, evidenceId: "message-1-test" }),
      }),
    ]);
  });

  it("keeps independent parts while replacing only the corrected part revision", () => {
    const state = project(
      [
        messageEvent(1, "2026-07-06T00:00:01Z", "task-1", "pass", "part-1"),
        messageEvent(2, "2026-07-06T00:00:02Z", "task-1", "pass", "part-2"),
        messageEvent(3, "2026-07-06T00:00:03Z", "task-1", "fail", "part-1"),
      ],
      REBUILT_AT,
    );

    expect(state.tasks.get("task-1")?.evidence).toEqual([
      expect.objectContaining({
        evidence: expect.objectContaining({
          evidenceId: '["message-1","part-2"]-test',
          claim: expect.objectContaining({ outcome: "pass" }),
        }),
      }),
      expect.objectContaining({
        evidence: expect.objectContaining({
          evidenceId: '["message-1","part-1"]-test',
          claim: expect.objectContaining({ outcome: "fail" }),
        }),
      }),
    ]);
  });

  it("removes claims absent from the latest message revision while retaining other evidence", () => {
    const firstRevision: ObservationRecord = {
      ...messageEvent(1, "2026-07-06T00:00:01Z", "task-1", "pass"),
      declaredClaims: [
        { evidenceId: "message-1-test", claimKind: "test", outcome: "pass" },
        { evidenceId: "message-1-build", claimKind: "build", outcome: "pass" },
      ],
      evidence: [
        {
          evidenceId: "message-1-test",
          kind: "test",
          sourceClass: "declared_claim",
          provenance: "declared",
          declaredFrom: "message",
          claim: { claimKind: "test", outcome: "pass" },
        },
        {
          evidenceId: "message-1-build",
          kind: "build",
          sourceClass: "declared_claim",
          provenance: "declared",
          declaredFrom: "message",
          claim: { claimKind: "build", outcome: "pass" },
        },
      ],
    };
    const latestRevision: ObservationRecord = {
      ...firstRevision,
      sequence: 3,
      timestamp: "2026-07-06T00:00:03Z",
      textHash: "hash-latest-revision",
      declaredClaims: [{ evidenceId: "message-1-test", claimKind: "test", outcome: "fail" }],
      evidence: [
        {
          evidenceId: "message-1-test",
          kind: "test",
          sourceClass: "declared_claim",
          provenance: "declared",
          declaredFrom: "message",
          claim: { claimKind: "test", outcome: "fail" },
        },
      ],
    };
    const otherMessage: ObservationRecord = {
      ...messageEvent(4, "2026-07-06T00:00:04Z", "task-1", "pass"),
      messageID: "message-2",
      textHash: "hash-message-2",
      declaredClaims: [{ evidenceId: "message-2-test", claimKind: "test", outcome: "pass" }],
      evidence: [
        {
          evidenceId: "message-2-test",
          kind: "test",
          sourceClass: "declared_claim",
          provenance: "declared",
          declaredFrom: "message",
          claim: { claimKind: "test", outcome: "pass" },
        },
      ],
    };

    const state = project(
      [
        firstRevision,
        toolEvent(2, "2026-07-06T00:00:02Z", "task-1", "tool-evidence"),
        latestRevision,
        otherMessage,
      ],
      REBUILT_AT,
    );

    expect(state.tasks.get("task-1")?.evidence.map((entry) => entry.ref.evidenceId)).toEqual([
      "tool-evidence",
      "message-1-test",
      "message-2-test",
    ]);
    expect(state.tasks.get("task-1")?.evidence[1]?.evidence).toMatchObject({
      claim: { outcome: "fail" },
    });
  });

  it("records maxSequenceByShard per shard", () => {
    const events = [
      toolEvent(1, "2026-07-06T00:00:01Z", "task-1", "ev-1", "w1"),
      toolEvent(5, "2026-07-06T00:00:02Z", "task-1", "ev-2", "w1"),
      toolEvent(2, "2026-07-06T00:00:03Z", "task-1", "ev-3", "w2"),
    ];
    const state = project(events, REBUILT_AT);
    expect(state.integrity.maxSequenceByShard.get('["atlas","s1","w1"]')).toBe(5);
    expect(state.integrity.maxSequenceByShard.get('["atlas","s1","w2"]')).toBe(2);
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
    expect(rs).not.toHaveProperty("authorship");
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
      taskLifecycleEvent(3, "pending", "authorized"),
      planFinalizationEvent(4, "tasks_pending", "all_tasks_accepted"),
    ];
    const state = project(events, REBUILT_AT);

    const serialized = toSerializableProjectedState(state);
    const json = JSON.parse(JSON.stringify(serialized)) as unknown;
    // Serialized maps must be plain objects, not arrays.
    expect(Array.isArray(serialized.integrity.maxSequenceByShard)).toBe(false);
    expect(Array.isArray(serialized.reviewSummary.byScope)).toBe(false);
    expect(serialized.reviewSummary).not.toHaveProperty("authorship");

    const restored = fromSerializableProjectedState(json);
    expect(restored.integrity.maxSequenceByShard.get('["atlas","s1","w1"]')).toBe(4);
    expect(restored.tasks.get("task-1")?.evidence).toHaveLength(1);
    expect(restored.reviewSummary.byScope.get("src/api")?.critical).toHaveLength(1);
    expect(restored.reviewSummary).not.toHaveProperty("authorship");
    expect(restored.integrity.sourceHash).toBe(state.integrity.sourceHash);
    expect(restored.lifecycle.taskStates.get(JSON.stringify(["s1", "auth-1", "task-1"]))).toBe(
      "authorized",
    );
    expect(
      restored.lifecycle.finalization.get(JSON.stringify(["s1", "auth-1", "plan.md"]))?.state,
    ).toBe("all_tasks_accepted");
  });

  it("reads a legacy schema-v2 cache that still carries authorship:null", () => {
    const state = project(
      [
        toolEvent(1, "2026-07-06T00:00:01Z", "task-1", "ev-1"),
        reviewEvent(2, "2026-07-06T00:00:02Z", "task-1", "src/api", [
          reviewItem("a", "critical", "open"),
        ]),
      ],
      REBUILT_AT,
    );
    const serialized = toSerializableProjectedState(state);
    // Simulate a state.json written by an earlier build that persisted authorship:null.
    const legacy = {
      ...serialized,
      reviewSummary: { ...serialized.reviewSummary, authorship: null },
    };
    const json = JSON.parse(JSON.stringify(legacy)) as unknown;

    const restored = fromSerializableProjectedState(json);

    // The legacy cache remains readable: its projected content is fully restored.
    expect(restored.reviewSummary.byScope.get("src/api")?.critical).toHaveLength(1);
    expect(restored.reviewSummary.open.map((i) => i.itemKey)).toEqual(["a"]);
    // ...but the legacy authorship:null is not retained in newly produced state.
    expect(restored.reviewSummary).not.toHaveProperty("authorship");
  });
});
