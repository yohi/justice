import { describe, expect, it } from "vitest";
import { validateRecordSchema, validateShardSequences } from "../../src/runtime/validation";
import type { PersistedLogRecord } from "../../src/core/v2/observation-model";

function validBase(recordType: "observation" | "decision"): Record<string, unknown> {
  return {
    schemaVersion: 1,
    sequence: 1,
    timestamp: "2026-07-11T12:00:00.000Z",
    agentId: "atlas",
    sessionId: "ses-1",
    writerId: "w-1",
    recordType,
  };
}

function validDecision(): Record<string, unknown> {
  return {
    ...validBase("decision"),
    gateType: "task",
    taskId: "task-1",
    verdict: "PASS",
    reachableEnforcementLevel: "L1",
    appliedEnforcementLevel: "L0",
    ruleResults: [
      {
        ruleId: "r-1",
        verdict: "PASS",
        reason: "ok",
        evidenceRefs: [
          {
            kind: "full",
            agentId: "atlas",
            sessionId: "ses-1",
            writerId: "w-1",
            sequence: 1,
            evidenceId: "e-1",
          },
        ],
      },
    ],
  };
}

function validDecisionVariants(): readonly Record<string, unknown>[] {
  return [
    {
      ...validDecision(),
      taskExecutionRef: { authorizationId: "auth-1", taskId: "task-1", attemptId: "attempt-1" },
    },
    {
      ...validBase("decision"),
      gateType: "plan",
      authorizationId: "auth-1",
      planPath: "docs/plans/example.md",
      finalizationAttemptId: "final-1",
      finalReviewRound: 1,
      verdict: "PASS",
      reachableEnforcementLevel: "L1",
      appliedEnforcementLevel: "L0",
      ruleResults: [],
    },
    {
      ...validBase("decision"),
      kind: "task-acceptance",
      taskId: "task-1",
      taskExecutionRef: { authorizationId: "auth-1", taskId: "task-1", attemptId: "attempt-1" },
      verdict: "accepted",
    },
    {
      ...validBase("decision"),
      kind: "plan-acceptance",
      authorizationId: "auth-1",
      planPath: "docs/plans/example.md",
      finalizationAttemptId: "final-1",
      finalReviewRound: 1,
      verdict: "complete",
    },
  ];
}

function validReviewObserved(): Record<string, unknown> {
  return {
    ...validBase("observation"),
    kind: "review_observed",
    reviewScope: "code-review",
    items: [
      {
        itemKey: "i-1",
        evidenceId: "i-1",
        severity: "critical",
        summary: "bad",
        location: "file.ts:1",
        status: "open",
      },
    ],
  };
}

function validErrorAnnotation(): Record<string, unknown> {
  return {
    ...validBase("observation"),
    kind: "error_annotation",
    provenance: "observed",
    planPath: "docs/plans/example.md",
    planPathDigest: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    planSnapshotDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    target: {
      lineNumber: 3,
      occurrence: 1,
      normalizedLineDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    },
  };
}

function validToolExecuted(): Record<string, unknown> {
  return {
    ...validBase("observation"),
    kind: "tool_executed",
    toolName: "test",
    callId: "call-1",
    evidence: {
      evidenceId: "e-1",
      kind: "test",
      sourceClass: "tool_output",
      provenance: "observed",
      toolOutputClass: "command_exec",
      command: "bun test",
      rawOutput: "ok",
    },
  };
}

function validMessage(): Record<string, unknown> {
  return {
    ...validBase("observation"),
    kind: "message",
    messageID: "msg-1",
    role: "assistant",
    textHash: "h1",
    finalized: true,
    declaredClaims: [],
    evidence: [],
  };
}

function validTaskLifecycleTransition(): Record<string, unknown> {
  return {
    ...validBase("observation"),
    kind: "task_lifecycle_transition",
    parentSessionId: "ses-1",
    taskExecutionRef: {
      authorizationId: "auth-1",
      taskId: "task-1",
      attemptId: "attempt-1",
    },
    from: "authorized",
    to: "in_progress",
  };
}

function validPlanFinalizationTransition(): Record<string, unknown> {
  return {
    ...validBase("observation"),
    kind: "plan_finalization_transition",
    parentSessionId: "ses-1",
    authorizationId: "auth-1",
    planPath: "docs/plans/example.md",
    finalizationAttemptId: "final-1",
    finalReviewRound: 1,
    from: "all_tasks_accepted",
    to: "final_review_pending",
  };
}

function validReviewDispatchTransition(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...validBase("observation"),
    kind: "review_dispatch_transition",
    transitionId: "transition-1",
    parentSessionId: "ses-1",
    correlation: {
      reviewKind: "task-review",
      taskExecutionRef: { authorizationId: "auth-1", taskId: "task-1", attemptId: "attempt-1" },
      reviewRound: 1,
    },
    expectedCategory: "sp-review",
    from: null,
    to: "pending",
    ...overrides,
  };
}

function validDelegatedExecutionBinding(): Record<string, unknown> {
  const relation = {
    kind: "delegated_execution_relation_observed",
    provenance: "observed",
    runtimeEventId: "runtime-event-1",
    parentSessionId: "ses-1",
    parentCallId: "call-1",
    childSessionId: "child-1",
    category: "sp-review",
  };
  const taskExecutionRef = {
    authorizationId: "auth-1",
    taskId: "task-1",
    attemptId: "attempt-1",
  };

  return {
    ...validBase("observation"),
    kind: "delegated_execution_binding",
    relation,
    binding: {
      relationId: relation.runtimeEventId,
      parentSessionId: relation.parentSessionId,
      parentCallId: relation.parentCallId,
      childSessionId: relation.childSessionId,
      scope: { kind: "task", taskExecutionRef, reviewRound: 1 },
      correlation: { reviewKind: "task-review", taskExecutionRef, reviewRound: 1 },
    },
  };
}

describe("validateRecordSchema", () => {
  it("accepts a valid tool_executed record", () => {
    expect(() => validateRecordSchema(validToolExecuted())).not.toThrow();
  });

  it("accepts a valid message record", () => {
    expect(() => validateRecordSchema(validMessage())).not.toThrow();
  });

  it("accepts lifecycle transition records", () => {
    expect(() => validateRecordSchema(validTaskLifecycleTransition())).not.toThrow();
    expect(() => validateRecordSchema(validPlanFinalizationTransition())).not.toThrow();
  });

  it("accepts a pending review dispatch transition", () => {
    expect(() => validateRecordSchema(validReviewDispatchTransition())).not.toThrow();
  });

  it("accepts a claimed review dispatch transition with an artifact reservation", () => {
    expect(
      () =>
        validateRecordSchema(
          validReviewDispatchTransition({
            transitionId: "claimed-1",
            from: "pending",
            to: "claimed",
            callId: "call-1",
            artifactReservation: { status: "unusable", reason: "artifact_storage_unavailable" },
          }),
        ),
    ).not.toThrow();
  });

  it("accepts a terminal final-review dispatch transition without a call ID", () => {
    expect(
      () =>
        validateRecordSchema(
          validReviewDispatchTransition({
            transitionId: "terminal-1",
            correlation: {
              reviewKind: "final-review",
              planPath: "docs/plans/example.md",
              authorizationId: "auth-1",
              planFingerprint: { algorithm: "sha256", value: "fingerprint" },
              finalizationAttemptId: "final-1",
              finalReviewRound: 1,
            },
            expectedCategory: "sp-final-review",
            from: "claimed",
            to: "terminal",
            terminalReason: "completed",
          }),
        ),
    ).not.toThrow();
  });

  it.each([
    { name: "missing transition ID", override: { transitionId: undefined } },
    { name: "missing correlation", override: { correlation: undefined } },
    { name: "invalid expected category", override: { expectedCategory: "sp-reviewer" } },
  ])("rejects malformed review dispatch envelopes: $name", ({ override }) => {
    expect(() => validateRecordSchema(validReviewDispatchTransition(override))).toThrow(
      "Invalid review_dispatch_transition record",
    );
  });

  it("rejects a claimed review dispatch without its call ID or artifact reservation", () => {
    expect(() =>
      validateRecordSchema(
        validReviewDispatchTransition({ from: "pending", to: "claimed" }),
      ),
    ).toThrow("Invalid claimed review_dispatch_transition record");
  });

  it("rejects an invalid review dispatch state transition", () => {
    expect(() =>
      validateRecordSchema(
        validReviewDispatchTransition({ from: "pending", to: "complete" }),
      ),
    ).toThrow("Invalid review_dispatch_transition state");
  });

  it("accepts a delegated execution binding with a task review scope", () => {
    expect(() => validateRecordSchema(validDelegatedExecutionBinding())).not.toThrow();
  });

  it("rejects a delegated execution binding whose relation and binding disagree", () => {
    expect(() =>
      validateRecordSchema({
        ...validDelegatedExecutionBinding(),
        binding: {
          relationId: "different-runtime-event",
          parentSessionId: "ses-1",
          parentCallId: "call-1",
          childSessionId: "child-1",
          scope: {
            kind: "task",
            taskExecutionRef: { authorizationId: "auth-1", taskId: "task-1", attemptId: "attempt-1" },
            reviewRound: 1,
          },
          correlation: {
            reviewKind: "task-review",
            taskExecutionRef: { authorizationId: "auth-1", taskId: "task-1", attemptId: "attempt-1" },
            reviewRound: 1,
          },
        },
      }),
    ).toThrow("Invalid delegated_execution_binding record");
  });

  it.each([
    { name: "missing execution ref", override: { taskExecutionRef: undefined } },
    { name: "invalid from state", override: { from: "started" } },
    { name: "invalid to state", override: { to: "finished" } },
  ])("rejects malformed task lifecycle transitions: $name", ({ override }) => {
    expect(() => validateRecordSchema({ ...validTaskLifecycleTransition(), ...override })).toThrow(
      "Invalid task_lifecycle_transition record",
    );
  });

  it.each([
    { name: "missing finalization attempt", override: { finalizationAttemptId: undefined } },
    { name: "zero final review round", override: { finalReviewRound: 0 } },
    { name: "negative final review round", override: { finalReviewRound: -1 } },
    { name: "fractional final review round", override: { finalReviewRound: 1.5 } },
    { name: "unsafe final review round", override: { finalReviewRound: Number.MAX_SAFE_INTEGER + 1 } },
    { name: "invalid from state", override: { from: "started" } },
    { name: "invalid to state", override: { to: "finished" } },
  ])("rejects malformed plan finalization transitions: $name", ({ override }) => {
    expect(() => validateRecordSchema({ ...validPlanFinalizationTransition(), ...override })).toThrow(
      "Invalid plan_finalization_transition record",
    );
  });

  it("accepts a valid observed error_annotation record", () => {
    expect(() => validateRecordSchema(validErrorAnnotation())).not.toThrow();
  });

  it.each([
    { name: "missing path", override: { planPath: undefined } },
    { name: "empty path", override: { planPath: "" } },
    { name: "unsafe path", override: { planPath: "../plan.md" } },
    { name: "invalid path digest", override: { planPathDigest: "bad" } },
    { name: "non-positive line number", override: { target: { lineNumber: 0, occurrence: 1, normalizedLineDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" } } },
    { name: "non-positive occurrence", override: { target: { lineNumber: 3, occurrence: 0, normalizedLineDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" } } },
    { name: "invalid snapshot digest", override: { planSnapshotDigest: "bad" } },
    { name: "invalid line digest", override: { target: { lineNumber: 3, occurrence: 1, normalizedLineDigest: "bad" } } },
    { name: "malformed provenance", override: { provenance: "manual" } },
  ])("rejects error_annotation with $name", ({ override }) => {
    expect(() => validateRecordSchema({ ...validErrorAnnotation(), ...override })).toThrow(
      "Invalid error_annotation record",
    );
  });

  it("accepts a valid decision record", () => {
    expect(() => validateRecordSchema(validDecision())).not.toThrow();
  });

  it("accepts all four authoritative decision variants", () => {
    for (const variant of validDecisionVariants())
      expect(() => validateRecordSchema(variant)).not.toThrow();
  });

  it("accepts a schemaVersion 1 legacy task Gate record without taskExecutionRef", () => {
    expect(() => validateRecordSchema(validDecision())).not.toThrow();
  });

  it("rejects a legacy task GateDecision without a non-empty taskId", () => {
    expect(() => validateRecordSchema({ ...validDecision(), taskId: undefined })).toThrow(
      "Invalid legacy task GateDecision",
    );
  });

  it("rejects a malformed present taskExecutionRef instead of reading it as legacy", () => {
    expect(() => validateRecordSchema({ ...validDecision(), taskExecutionRef: { attemptId: "attempt-1" } })).toThrow(
      "Invalid task GateDecision identity",
    );
  });

  it("rejects a task GateDecision with plan-scoped fields", () => {
    expect(() =>
      validateRecordSchema({
        ...validDecision(),
        planPath: "plan.md",
      }),
    ).toThrow("Invalid task GateDecision scope");
  });

  it("rejects a malformed plan GateDecision", () => {
    expect(() =>
      validateRecordSchema({
        ...validDecisionVariants()[1],
        finalReviewRound: 0,
      }),
    ).toThrow("Invalid plan GateDecision identity");
  });

  it("rejects malformed task and plan AcceptanceDecision records", () => {
    expect(() =>
      validateRecordSchema({
        ...validDecisionVariants()[2],
        taskId: "different-task",
      }),
    ).toThrow("Invalid task AcceptanceDecision");
    expect(() =>
      validateRecordSchema({
        ...validDecisionVariants()[3],
        verdict: "invalid",
      }),
    ).toThrow("Invalid plan AcceptanceDecision");
  });

  it("rejects an unknown AcceptanceDecision kind", () => {
    expect(() =>
      validateRecordSchema({
        ...validDecisionVariants()[2],
        kind: "unknown-acceptance",
      }),
    ).toThrow("Invalid decision record: unknown acceptance kind");
  });

  it("rejects a non-object record", () => {
    expect(() => validateRecordSchema("not-object")).toThrow("Invalid record: not an object");
  });

  it("rejects unsupported schemaVersion", () => {
    expect(() => validateRecordSchema({ ...validToolExecuted(), schemaVersion: 2 })).toThrow(
      "Invalid record: unsupported schemaVersion 2",
    );
  });

  it("rejects a negative sequence", () => {
    expect(() => validateRecordSchema({ ...validToolExecuted(), sequence: -1 })).toThrow(
      "Invalid record: sequence must be a non-negative number",
    );
  });

  it("rejects a missing timestamp", () => {
    const executed = validToolExecuted();
    const rest = { ...executed };
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { timestamp, ...restWithoutTimestamp } = rest;
    expect(() => validateRecordSchema(restWithoutTimestamp)).toThrow(
      "Invalid record: timestamp must be a string",
    );
  });

  it("rejects invalid shard identifier fields", () => {
    expect(() => validateRecordSchema({ ...validToolExecuted(), agentId: undefined })).toThrow(
      "Invalid record: missing or invalid shard identifier fields",
    );
  });

  it.each([
    ["unsafe agentId", { agentId: "attacker" }],
    ["reserved writerId", { writerId: "w-system" }],
    ["unsafe writerId segment", { writerId: "w-a/b" }],
  ])("rejects an envelope with %s", (_caseName, override) => {
    expect(() => validateRecordSchema({ ...validToolExecuted(), ...override })).toThrow(
      "Invalid record: unsafe shard identifier fields",
    );
  });

  it("rejects unknown recordType", () => {
    expect(() => validateRecordSchema({ ...validToolExecuted(), recordType: "learning" })).toThrow(
      "Invalid record: unknown recordType: learning",
    );
  });

  it("rejects invalid tool_executed evidence structure", () => {
    expect(() =>
      validateRecordSchema({
        ...validToolExecuted(),
        evidence: { evidenceId: "e-1" },
      }),
    ).toThrow("Invalid tool_executed record");
  });

  it("rejects tool_output evidence with unsupported toolOutputClass", () => {
    expect(() =>
      validateRecordSchema({
        ...validToolExecuted(),
        evidence: {
          evidenceId: "e-1",
          kind: "test",
          sourceClass: "tool_output",
          provenance: "observed",
          toolOutputClass: "unsupported",
        },
      }),
    ).toThrow("Invalid tool_executed record");
  });

  it("rejects evidence with unsupported sourceClass", () => {
    expect(() =>
      validateRecordSchema({
        ...validToolExecuted(),
        evidence: {
          evidenceId: "e-1",
          kind: "test",
          sourceClass: "unsupported",
          provenance: "observed",
        },
      }),
    ).toThrow("Invalid tool_executed record");
  });

  it("rejects file_content evidence with non-string rawOutputHash", () => {
    expect(() =>
      validateRecordSchema({
        ...validToolExecuted(),
        evidence: {
          evidenceId: "e-1",
          kind: "test",
          sourceClass: "tool_output",
          provenance: "observed",
          toolOutputClass: "file_content",
          rawOutputHash: 123,
        },
      }),
    ).toThrow("Invalid tool_executed record");
  });

  it("rejects declared_claim evidence with non-claimed provenance", () => {
    expect(() =>
      validateRecordSchema({
        ...validMessage(),
        declaredClaims: [
          {
            evidenceId: "msg-1-test",
            claimKind: "test",
            outcome: "pass",
          },
        ],
        evidence: [
          {
            evidenceId: "msg-1-test",
            kind: "test",
            sourceClass: "declared_claim",
            provenance: "declared",
            declaredFrom: "message",
            claim: { claimKind: "test", outcome: "pass" },
            claimRef: "not-object",
          },
        ],
      }),
    ).toThrow("Invalid message record");
  });

  it("rejects a message record with mismatched claims and evidence", () => {
    expect(() =>
      validateRecordSchema({
        ...validMessage(),
        declaredClaims: [
          {
            evidenceId: "msg-1-test",
            claimKind: "test",
            outcome: "pass",
          },
        ],
        evidence: [],
      }),
    ).toThrow("Invalid message record");
  });

  it("rejects a message record with non-array claims", () => {
    expect(() =>
      validateRecordSchema({
        ...validMessage(),
        declaredClaims: "not-array",
        evidence: [],
      }),
    ).toThrow("Invalid message record");
  });

  it("rejects a message record with only-empty-but-mismatched lists", () => {
    expect(() =>
      validateRecordSchema({
        ...validMessage(),
        declaredClaims: [],
        evidence: [
          {
            evidenceId: "msg-1-test",
            kind: "test",
            sourceClass: "declared_claim",
            provenance: "declared",
            declaredFrom: "message",
            claim: { claimKind: "test", outcome: "pass" },
          },
        ],
      }),
    ).toThrow("Invalid message record");
  });

  it("rejects a decision record with non-array ruleResults", () => {
    expect(() => validateRecordSchema({ ...validDecision(), ruleResults: "not-array" })).toThrow(
      "Invalid decision record",
    );
  });

  it("rejects a decision ruleResult with non-array evidenceRefs", () => {
    expect(() =>
      validateRecordSchema({
        ...validDecision(),
        ruleResults: [
          {
            ruleId: "r-1",
            verdict: "PASS",
            reason: "test fixture",
            evidenceRefs: "not-array",
          },
        ],
      }),
    ).toThrow("Invalid decision ruleResult");
  });

  it("rejects a decision evidenceRef with non-finite sequence", () => {
    expect(() =>
      validateRecordSchema({
        ...validDecision(),
        ruleResults: [
          {
            ruleId: "r-1",
            verdict: "PASS",
            reason: "test fixture",
            evidenceRefs: [
              {
                kind: "full",
                agentId: "atlas",
                sessionId: "ses-1",
                writerId: "w-1",
                sequence: Number.POSITIVE_INFINITY,
                evidenceId: "e-1",
              },
            ],
          },
        ],
      }),
    ).toThrow("Invalid decision evidenceRef");
  });
  it("accepts a legacy message record with both fields undefined (normalized)", () => {
    expect(() =>
      validateRecordSchema({
        ...validMessage(),
        declaredClaims: undefined,
        evidence: undefined,
      }),
    ).not.toThrow();
  });

  it("rejects a decision evidenceRef with negative sequence", () => {
    expect(() =>
      validateRecordSchema({
        ...validDecision(),
        ruleResults: [
          {
            ruleId: "r-1",
            verdict: "PASS",
            reason: "test fixture",
            evidenceRefs: [
              {
                kind: "full",
                agentId: "atlas",
                sessionId: "ses-1",
                writerId: "w-1",
                sequence: -1,
                evidenceId: "e-1",
              },
            ],
          },
        ],
      }),
    ).toThrow("Invalid decision evidenceRef");
  });

  it("rejects tool_output evidence with non-string kind", () => {
    expect(() =>
      validateRecordSchema({
        ...validToolExecuted(),
        evidence: {
          evidenceId: "e-1",
          kind: 123,
          sourceClass: "tool_output",
          provenance: "observed",
          toolOutputClass: "command_exec",
          command: "bun test",
          rawOutput: "ok",
        },
      }),
    ).toThrow("Invalid tool_executed record");
  });

  it("rejects tool_output evidence with non-string provenance", () => {
    expect(() =>
      validateRecordSchema({
        ...validToolExecuted(),
        evidence: {
          evidenceId: "e-1",
          kind: "test",
          sourceClass: "tool_output",
          provenance: 123,
          toolOutputClass: "command_exec",
          command: "bun test",
          rawOutput: "ok",
        },
      }),
    ).toThrow("Invalid tool_executed record");
  });

  it("rejects tool_output evidence with non-object interpretation", () => {
    expect(() =>
      validateRecordSchema({
        ...validToolExecuted(),
        evidence: {
          evidenceId: "e-1",
          kind: "test",
          sourceClass: "tool_output",
          provenance: "observed",
          toolOutputClass: "command_exec",
          command: "bun test",
          rawOutput: "ok",
          interpretation: "not-object",
        },
      }),
    ).toThrow("Invalid tool_executed record");
  });

  it("accepts file_content evidence without optional fields", () => {
    expect(() =>
      validateRecordSchema({
        ...validToolExecuted(),
        evidence: {
          evidenceId: "e-1",
          kind: "test",
          sourceClass: "tool_output",
          provenance: "observed",
          toolOutputClass: "file_content",
          rawOutputHash: "h1",
        },
      }),
    ).not.toThrow();
  });

  it("rejects declared_claim evidence with invalid kind", () => {
    expect(() =>
      validateRecordSchema({
        ...validMessage(),
        declaredClaims: [
          {
            evidenceId: "msg-1-test",
            claimKind: "test",
            outcome: "pass",
          },
        ],
        evidence: [
          {
            evidenceId: "msg-1-test",
            kind: "invalid",
            sourceClass: "declared_claim",
            provenance: "declared",
            declaredFrom: "message",
            claim: { claimKind: "test", outcome: "pass" },
          },
        ],
      }),
    ).toThrow("Invalid message record");
  });

  it("rejects declared_claim evidence with wrong provenance", () => {
    expect(() =>
      validateRecordSchema({
        ...validMessage(),
        declaredClaims: [
          {
            evidenceId: "msg-1-test",
            claimKind: "test",
            outcome: "pass",
          },
        ],
        evidence: [
          {
            evidenceId: "msg-1-test",
            kind: "test",
            sourceClass: "declared_claim",
            provenance: "observed",
            declaredFrom: "message",
            claim: { claimKind: "test", outcome: "pass" },
          },
        ],
      }),
    ).toThrow("Invalid message record");
  });

  it("rejects declared_claim evidence with non-object claim", () => {
    expect(() =>
      validateRecordSchema({
        ...validMessage(),
        declaredClaims: [
          {
            evidenceId: "msg-1-test",
            claimKind: "test",
            outcome: "pass",
          },
        ],
        evidence: [
          {
            evidenceId: "msg-1-test",
            kind: "test",
            sourceClass: "declared_claim",
            provenance: "declared",
            declaredFrom: "message",
            claim: "not-object",
          },
        ],
      }),
    ).toThrow("Invalid message record");
  });

  it("rejects declared_claim evidence with invalid claim outcome", () => {
    expect(() =>
      validateRecordSchema({
        ...validMessage(),
        declaredClaims: [
          {
            evidenceId: "msg-1-test",
            claimKind: "test",
            outcome: "pass",
          },
        ],
        evidence: [
          {
            evidenceId: "msg-1-test",
            kind: "test",
            sourceClass: "declared_claim",
            provenance: "declared",
            declaredFrom: "message",
            claim: { claimKind: "test", outcome: "invalid" },
          },
        ],
      }),
    ).toThrow("Invalid message record");
  });

  it("rejects declared_claim evidence with invalid declaredFrom", () => {
    expect(() =>
      validateRecordSchema({
        ...validMessage(),
        declaredClaims: [
          {
            evidenceId: "msg-1-test",
            claimKind: "test",
            outcome: "pass",
          },
        ],
        evidence: [
          {
            evidenceId: "msg-1-test",
            kind: "test",
            sourceClass: "declared_claim",
            provenance: "declared",
            declaredFrom: "invalid",
            claim: { claimKind: "test", outcome: "pass" },
          },
        ],
      }),
    ).toThrow("Invalid message record");
  });

  it("accepts a valid message record with declared claims and evidence", () => {
    expect(() =>
      validateRecordSchema({
        ...validMessage(),
        declaredClaims: [
          {
            evidenceId: "msg-1-test",
            claimKind: "test",
            outcome: "pass",
          },
        ],
        evidence: [
          {
            evidenceId: "msg-1-test",
            kind: "test",
            sourceClass: "declared_claim",
            provenance: "declared",
            declaredFrom: "message",
            claim: { claimKind: "test", outcome: "pass" },
          },
        ],
      }),
    ).not.toThrow();
  });

  it("rejects a message record with non-matching evidenceId between claim and evidence", () => {
    expect(() =>
      validateRecordSchema({
        ...validMessage(),
        declaredClaims: [
          {
            evidenceId: "msg-1-test",
            claimKind: "test",
            outcome: "pass",
          },
        ],
        evidence: [
          {
            evidenceId: "different",
            kind: "test",
            sourceClass: "declared_claim",
            provenance: "declared",
            declaredFrom: "message",
            claim: { claimKind: "test", outcome: "pass" },
          },
        ],
      }),
    ).toThrow("Invalid message record");
  });

  it("rejects a message record with non-declared_claim evidence", () => {
    expect(() =>
      validateRecordSchema({
        ...validMessage(),
        declaredClaims: [
          {
            evidenceId: "msg-1-test",
            claimKind: "test",
            outcome: "pass",
          },
        ],
        evidence: [
          {
            evidenceId: "msg-1-test",
            kind: "test",
            sourceClass: "tool_output",
            provenance: "observed",
            toolOutputClass: "command_exec",
            command: "bun test",
            rawOutput: "ok",
          },
        ],
      }),
    ).toThrow("Invalid message record");
  });

  it("accepts a valid review_observed record", () => {
    expect(() =>
      validateRecordSchema({
        ...validReviewObserved(),
        isCompleteSnapshot: true,
        resolutionMarkers: [
          {
            itemKey: "i-1",
            resolution: "human_artifact",
            artifactRef: "reviews/i-1.md",
          },
        ],
      }),
    ).not.toThrow();
  });

  it("rejects a review_observed record with non-array items", () => {
    expect(() =>
      validateRecordSchema({
        ...validReviewObserved(),
        items: "not-array",
      }),
    ).toThrow("Invalid review_observed record");
  });

  it("rejects a review_observed item with invalid severity", () => {
    expect(() =>
      validateRecordSchema({
        ...validReviewObserved(),
        items: [
          {
            itemKey: "i-1",
            evidenceId: "e-1",
            severity: "invalid",
            summary: "bad",
            location: "file.ts:1",
            status: "open",
          },
        ],
      }),
    ).toThrow("Invalid review_observed item");
  });

  it("rejects a review_observed item whose evidenceId does not equal its itemKey", () => {
    expect(() =>
      validateRecordSchema({
        ...validReviewObserved(),
        items: [
          {
            itemKey: "i-1",
            evidenceId: "different-evidence-id",
            severity: "critical",
            summary: "bad",
            location: "file.ts:1",
            status: "open",
          },
        ],
      }),
    ).toThrow("Invalid review_observed item");
  });

  it("rejects a review_observed item with invalid status", () => {
    expect(() =>
      validateRecordSchema({
        ...validReviewObserved(),
        items: [
          {
            itemKey: "i-1",
            evidenceId: "e-1",
            severity: "critical",
            summary: "bad",
            location: "file.ts:1",
            status: "invalid",
          },
        ],
      }),
    ).toThrow("Invalid review_observed item");
  });

  it.each([
    { resolutionMarkers: "not-array" },
    { resolutionMarkers: [null] },
    { resolutionMarkers: [{ itemKey: 1, resolution: "explicit_marker" }] },
    { resolutionMarkers: [{ itemKey: "i-1", resolution: "bogus" }] },
    {
      resolutionMarkers: [{ itemKey: "i-1", resolution: "human_artifact", artifactRef: 42 }],
    },
    { resolutionMarkers: [{ itemKey: "i-1", resolution: "human_artifact" }] },
    {
      resolutionMarkers: [{ itemKey: "i-1", resolution: "human_artifact", artifactRef: "" }],
    },
    {
      resolutionMarkers: [
        { itemKey: "", resolution: "human_artifact", artifactRef: "reviews/i-1.md" },
      ],
    },
  ])("rejects malformed review_observed resolution markers: %j", (invalidFields) => {
    expect(() =>
      validateRecordSchema({
        ...validReviewObserved(),
        ...invalidFields,
      }),
    ).toThrow("Invalid review_observed resolution marker");
  });

  it("rejects a non-boolean review_observed complete-snapshot flag", () => {
    expect(() =>
      validateRecordSchema({
        ...validReviewObserved(),
        isCompleteSnapshot: "true",
      }),
    ).toThrow("Invalid review_observed record");
  });

  it("accepts a complete skill_invoked record", () => {
    expect(() =>
      validateRecordSchema({
        ...validBase("observation"),
        kind: "skill_invoked",
        skillName: "programming",
        source: "skill_tool",
        callId: "call-1",
      }),
    ).not.toThrow();
  });

  it("rejects a skill_invoked record without invocation details", () => {
    expect(() =>
      validateRecordSchema({
        ...validBase("observation"),
        kind: "skill_invoked",
      }),
    ).toThrow("Invalid skill_invoked record");
  });

  it("rejects a session_error record without error details", () => {
    expect(() =>
      validateRecordSchema({
        ...validBase("observation"),
        kind: "session_error",
      }),
    ).toThrow("Invalid session_error record");

    // Verify it's specifically a TypeError
    expect(() =>
      validateRecordSchema({
        ...validBase("observation"),
        kind: "session_error",
      }),
    ).toThrow(TypeError);
  });

  it("rejects a reflection record without reflection details", () => {
    expect(() =>
      validateRecordSchema({
        ...validBase("observation"),
        kind: "reflection",
      }),
    ).toThrow("Invalid reflection record");
  });

  it("accepts complete session_error and workspace-relative reflection records", () => {
    expect(() =>
      validateRecordSchema({
        ...validBase("observation"),
        kind: "session_error",
        errorKind: "provider",
        message: "request failed",
      }),
    ).not.toThrow();
    expect(() =>
      validateRecordSchema({
        ...validBase("observation"),
        kind: "reflection",
        reflection: {
          trigger: "task_succeeded",
          planRef: { path: "docs/plan.md", taskId: "task-1" },
          intent: "check_complete",
        },
      }),
    ).not.toThrow();
  });

  it("rejects an unknown observation kind", () => {
    expect(() =>
      validateRecordSchema({
        ...validBase("observation"),
        kind: "unknown_kind",
      }),
    ).toThrow("Invalid record: unknown observation kind: unknown_kind");
  });
});

describe("validateShardSequences", () => {
  it("accepts a single valid shard sequence", () => {
    const records = [
      { ...validBase("observation"), kind: "skill_invoked" },
    ] as unknown as readonly PersistedLogRecord[];
    expect(() => validateShardSequences(records)).not.toThrow();
  });

  it("detects duplicate sequences in a shard", () => {
    const records = [
      { ...validBase("observation"), kind: "skill_invoked", sequence: 1 },
      { ...validBase("observation"), kind: "skill_invoked", sequence: 1 },
    ] as unknown as readonly PersistedLogRecord[];
    expect(() => validateShardSequences(records)).toThrow("duplicate sequence detected");
  });

  it("detects a missing sequence at the start of a shard", () => {
    const records = [
      { ...validBase("observation"), kind: "skill_invoked", sequence: 2 },
    ] as unknown as readonly PersistedLogRecord[];
    expect(() => validateShardSequences(records)).toThrow("missing sequence before 2");
  });

  it("detects a gap between sequences in a shard", () => {
    const records = [
      { ...validBase("observation"), kind: "skill_invoked", sequence: 1 },
      { ...validBase("observation"), kind: "skill_invoked", sequence: 3 },
    ] as unknown as readonly PersistedLogRecord[];
    expect(() => validateShardSequences(records)).toThrow("missing sequence between 1 and 3");
  });

  it("handles empty records", () => {
    expect(() => validateShardSequences([])).not.toThrow();
  });
});
