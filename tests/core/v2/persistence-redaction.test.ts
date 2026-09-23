import { describe, expect, it } from "vitest";
import { redactPendingLogRecord } from "../../../src/core/v2/persistence-redaction";
import type {
  PendingLogRecord,
  ToolOutputEvidence,
  DeclaredClaimEvidence,
} from "../../../src/core/v2/observation-model";

const baseEnvelope = {
  schemaVersion: 1 as const,
  timestamp: "2026-07-23T00:00:00.000Z",
  agentId: "sisyphus" as const,
  sessionId: "ses-1",
  writerId: "w-1",
};

describe("redactPendingLogRecord", () => {
  describe("tool_executed records", () => {
    it("redacts command and rawOutput for command_exec evidence", () => {
      const record: PendingLogRecord = {
        ...baseEnvelope,
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
          command: "/home/user/secret.txt",
          rawOutput: "GITHUB_TOKEN=ghp_1234567890",
        },
      };

      const result = redactPendingLogRecord(record);
      expect(result).toMatchObject({
        kind: "tool_executed",
        toolName: "bash",
      });
      const evidence = result.evidence as ToolOutputEvidence;
      expect(evidence.command).toBe("[REDACTED_PATH]");
      expect(evidence.rawOutput).toBe("[REDACTED_ENV]");
    });

    it("redacts file_content evidence with optional command", () => {
      const record: PendingLogRecord = {
        ...baseEnvelope,
        recordType: "observation",
        kind: "tool_executed",
        toolName: "read",
        callId: "c2",
        evidence: {
          evidenceId: "e2",
          kind: "command",
          sourceClass: "tool_output",
          provenance: "observed",
          toolOutputClass: "file_content",
          command: "/etc/passwd",
          rawOutputHash: "abc123",
          rawOutputSnippet: "SECRET_KEY=sk-12345678901234567890",
        },
      };

      const result = redactPendingLogRecord(record);
      const evidence = result.evidence as ToolOutputEvidence;
      expect(evidence.command).toBe("[REDACTED_PATH]");
      expect(evidence.rawOutputSnippet).toBe("[REDACTED_ENV]");
    });

    it("handles file_content evidence without command", () => {
      const record: PendingLogRecord = {
        ...baseEnvelope,
        recordType: "observation",
        kind: "tool_executed",
        toolName: "read",
        callId: "c3",
        evidence: {
          evidenceId: "e3",
          kind: "command",
          sourceClass: "tool_output",
          provenance: "observed",
          toolOutputClass: "file_content",
          command: undefined,
          rawOutputHash: "abc123",
        },
      };

      const result = redactPendingLogRecord(record);
      const evidence = result.evidence as ToolOutputEvidence;
      expect(evidence.command).toBeUndefined();
    });

    it("handles array evidence", () => {
      const record: PendingLogRecord = {
        ...baseEnvelope,
        recordType: "observation",
        kind: "tool_executed",
        toolName: "multi",
        callId: "c4",
        evidence: [
          {
            evidenceId: "e4a",
            kind: "command",
            sourceClass: "tool_output",
            provenance: "observed",
            toolOutputClass: "command_exec",
            command: "/home/user/file1",
            rawOutput: "output1",
          },
          {
            evidenceId: "e4b",
            kind: "command",
            sourceClass: "tool_output",
            provenance: "observed",
            toolOutputClass: "file_content",
            rawOutputHash: "hash2",
            rawOutputSnippet: "KEY=val123",
          },
        ],
      };

      const result = redactPendingLogRecord(record);
      const evidences = result.evidence as readonly ToolOutputEvidence[];
      expect(evidences).toHaveLength(2);
      expect(evidences[0].command).toBe("[REDACTED_PATH]");
      expect(evidences[1].rawOutputSnippet).toBe("[REDACTED_ENV]");
    });
  });

  describe("message records", () => {
    it("redacts declared claims and evidence", () => {
      const record: PendingLogRecord = {
        ...baseEnvelope,
        recordType: "observation",
        kind: "message",
        messageID: "m1",
        role: "assistant",
        textHash: "hash1",
        textSnippet: "/home/user/message",
        declaredClaims: [
          { evidenceId: "c1", claimKind: "test", outcome: "pass" },
          { evidenceId: "c2", claimKind: "build", outcome: "fail" },
        ],
        evidence: [
          {
            evidenceId: "e1",
            kind: "test",
            sourceClass: "declared_claim",
            provenance: "declared",
            declaredFrom: "message",
            claim: { claimKind: "test", outcome: "pass" },
          } as DeclaredClaimEvidence,
        ],
        finalized: true,
      };

      const result = redactPendingLogRecord(record);
      expect(result).toMatchObject({ kind: "message" });
      const msg = result as Extract<typeof result, { kind: "message" }>;
      expect(msg.textSnippet).toBe("[REDACTED_PATH]");
      expect(msg.declaredClaims[0].claimKind).toBe("test");
      expect(msg.declaredClaims[1].claimKind).toBe("build");
    });

    it("handles message without textSnippet", () => {
      const record: PendingLogRecord = {
        ...baseEnvelope,
        recordType: "observation",
        kind: "message",
        messageID: "m2",
        role: "assistant",
        textHash: "hash2",
        declaredClaims: [],
        evidence: [],
        finalized: true,
      };

      const result = redactPendingLogRecord(record);
      const msg = result as Extract<typeof result, { kind: "message" }>;
      expect(msg.textSnippet).toBeUndefined();
    });

    it("handles generic claimKind via default case", () => {
      const record: PendingLogRecord = {
        ...baseEnvelope,
        recordType: "observation",
        kind: "message",
        messageID: "m3",
        role: "assistant",
        textHash: "hash3",
        declaredClaims: [{ evidenceId: "c-generic", claimKind: "generic", outcome: "pass" }],
        evidence: [
          {
            evidenceId: "e-generic",
            kind: "generic",
            sourceClass: "declared_claim",
            provenance: "declared",
            declaredFrom: "message",
            claim: { claimKind: "generic", outcome: "pass" },
          } as DeclaredClaimEvidence,
        ],
        finalized: true,
      };

      const result = redactPendingLogRecord(record);
      const msg = result as Extract<typeof result, { kind: "message" }>;
      expect(msg.declaredClaims[0].claimKind).toBe("generic");
      expect(msg.evidence[0].claim.claimKind).toBe("generic");
    });
  });

  describe("skill_invoked records", () => {
    it("redacts skill name", () => {
      const record: PendingLogRecord = {
        ...baseEnvelope,
        recordType: "observation",
        kind: "skill_invoked",
        skillName: "/home/user/skill.json",
        source: "skill_tool",
      };

      const result = redactPendingLogRecord(record);
      expect(result).toMatchObject({
        kind: "skill_invoked",
        skillName: "[REDACTED_PATH]",
      });
    });
  });

  describe("session_error records", () => {
    it("redacts error kind and message", () => {
      const record: PendingLogRecord = {
        ...baseEnvelope,
        recordType: "observation",
        kind: "session_error",
        errorKind: "/home/user/error",
        message: "TOKEN=secret123",
      };

      const result = redactPendingLogRecord(record);
      expect(result).toMatchObject({
        kind: "session_error",
        errorKind: "[REDACTED_PATH]",
        message: "[REDACTED_ENV]",
      });
    });
  });

  describe("reflection records", () => {
    it("redacts planRef path and optional note", () => {
      const record: PendingLogRecord = {
        ...baseEnvelope,
        recordType: "observation",
        kind: "reflection",
        reflection: {
          trigger: "task_succeeded",
          planRef: { path: "/home/user/plan.md", taskId: "t1" },
          intent: "check_complete",
          note: "KEY=secret",
        },
      };

      const result = redactPendingLogRecord(record);
      const reflection = (result as Extract<typeof result, { kind: "reflection" }>).reflection;
      expect(reflection.planRef.path).toBe("[REDACTED_PATH]");
      expect(reflection.planRef.taskId).toBe("t1");
      expect(reflection.note).toBe("[REDACTED_ENV]");
    });

    it("handles reflection without note", () => {
      const record: PendingLogRecord = {
        ...baseEnvelope,
        recordType: "observation",
        kind: "reflection",
        reflection: {
          trigger: "task_error",
          planRef: { path: "/home/user/plan.md", taskId: "t2" },
          intent: "append_error_note",
        },
      };

      const result = redactPendingLogRecord(record);
      const reflection = (result as Extract<typeof result, { kind: "reflection" }>).reflection;
      expect(reflection.note).toBeUndefined();
    });
  });

  describe("review_observed records", () => {
    it("redacts items and resolution markers", () => {
      const record: PendingLogRecord = {
        ...baseEnvelope,
        recordType: "observation",
        kind: "review_observed",
        reviewScope: "scope1",
        items: [
          {
            itemKey: "i1",
            evidenceId: "e1",
            severity: "critical",
            summary: "/home/user/summary",
            location: "/home/user/location",
            status: "open",
          },
        ],
        resolutionMarkers: [
          {
            itemKey: "i1",
            resolution: "explicit_marker",
            artifactRef: "/home/user/artifact.md",
          },
        ],
      };

      const result = redactPendingLogRecord(record);
      const review = result as Extract<typeof result, { kind: "review_observed" }>;
      expect(review.items[0].summary).toBe("[REDACTED_PATH]");
      expect(review.items[0].location).toBe("[REDACTED_PATH]");
      expect(review.resolutionMarkers?.[0].artifactRef).toBe("[REDACTED_PATH]");
    });

    it("handles review without resolutionMarkers", () => {
      const record: PendingLogRecord = {
        ...baseEnvelope,
        recordType: "observation",
        kind: "review_observed",
        reviewScope: "scope2",
        items: [
          {
            itemKey: "i2",
            evidenceId: "e2",
            severity: "major",
            summary: "summary2",
            location: "location2",
            status: "resolved",
          },
        ],
      };

      const result = redactPendingLogRecord(record);
      const review = result as Extract<typeof result, { kind: "review_observed" }>;
      expect(review.resolutionMarkers).toBeUndefined();
    });

    it("handles resolution markers without artifactRef", () => {
      const record: PendingLogRecord = {
        ...baseEnvelope,
        recordType: "observation",
        kind: "review_observed",
        reviewScope: "scope3",
        items: [],
        resolutionMarkers: [
          {
            itemKey: "i3",
            resolution: "snapshot_absence",
          },
        ],
      };

      const result = redactPendingLogRecord(record);
      const review = result as Extract<typeof result, { kind: "review_observed" }>;
      expect(review.resolutionMarkers?.[0].artifactRef).toBeUndefined();
    });
  });

  describe("error_annotation records", () => {
    it("redacts the plan path without changing annotation identity", () => {
      const record: PendingLogRecord = {
        ...baseEnvelope,
        agentId: "system",
        recordType: "observation",
        kind: "error_annotation",
        provenance: "observed",
        planPath: "/home/user/plan.md",
        planSnapshotDigest: "sha256:snapshot",
        target: {
          lineNumber: 3,
          occurrence: 1,
          normalizedLineDigest: "sha256:line",
        },
      };

      const result = redactPendingLogRecord(record);

      expect(result).toMatchObject({
        kind: "error_annotation",
        planPath: "[REDACTED_PATH]",
        planSnapshotDigest: "sha256:snapshot",
        target: {
          lineNumber: 3,
          occurrence: 1,
          normalizedLineDigest: "sha256:line",
        },
      });
    });
  });

  describe("task lifecycle transition records", () => {
    it("redacts the optional reason without changing transition identity", () => {
      const record: PendingLogRecord = {
        ...baseEnvelope,
        recordType: "observation",
        kind: "task_lifecycle_transition",
        parentSessionId: "parent-1",
        taskExecutionRef: {
          authorizationId: "auth-1",
          taskId: "task-1",
          attemptId: "attempt-1",
        },
        from: "in_progress",
        to: "worker_reported",
        reason: "worker output at /home/user/output",
      };

      const result = redactPendingLogRecord(record);

      expect(result).toMatchObject({
        kind: "task_lifecycle_transition",
        parentSessionId: "parent-1",
        taskExecutionRef: {
          authorizationId: "auth-1",
          taskId: "task-1",
          attemptId: "attempt-1",
        },
        reason: "worker output at [REDACTED_PATH]",
      });
    });

    it("preserves a task transition without an optional reason", () => {
      const record: PendingLogRecord = {
        ...baseEnvelope,
        recordType: "observation",
        kind: "task_lifecycle_transition",
        parentSessionId: "parent-1",
        taskExecutionRef: {
          authorizationId: "auth-1",
          taskId: "task-1",
          attemptId: "attempt-1",
        },
        from: "in_progress",
        to: "worker_reported",
      };

      const result = redactPendingLogRecord(record);

      expect(result).toEqual(record);
    });
  });

  describe("plan finalization transition records", () => {
    it("redacts the plan path and optional reason without changing transition identity", () => {
      const record: PendingLogRecord = {
        ...baseEnvelope,
        recordType: "observation",
        kind: "plan_finalization_transition",
        parentSessionId: "parent-1",
        authorizationId: "auth-1",
        planPath: "/home/user/plan.md",
        finalizationAttemptId: "final-1",
        finalReviewRound: 2,
        from: "final_review_pending",
        to: "final_gate_pending",
        reason: "review output at /home/user/report",
      };

      const result = redactPendingLogRecord(record);

      expect(result).toMatchObject({
        kind: "plan_finalization_transition",
        parentSessionId: "parent-1",
        authorizationId: "auth-1",
        planPath: "[REDACTED_PATH]",
        finalizationAttemptId: "final-1",
        finalReviewRound: 2,
        reason: "review output at [REDACTED_PATH]",
      });
    });

    it("preserves a plan transition without an optional reason", () => {
      const record: PendingLogRecord = {
        ...baseEnvelope,
        recordType: "observation",
        kind: "plan_finalization_transition",
        parentSessionId: "parent-1",
        authorizationId: "auth-1",
        planPath: "plan.md",
        finalizationAttemptId: "final-1",
        finalReviewRound: 1,
        from: "tasks_pending",
        to: "all_tasks_accepted",
      };

      const result = redactPendingLogRecord(record);

      expect(result).toEqual(record);
    });
  });

  it("preserves review dispatch transitions without redacting identity fields", () => {
    const record: PendingLogRecord = {
      ...baseEnvelope,
      recordType: "observation",
      kind: "review_dispatch_transition",
      transitionId: "review-transition-1",
      parentSessionId: "parent-1",
      correlation: {
        reviewKind: "task-review",
        taskExecutionRef: {
          authorizationId: "auth-1",
          taskId: "task-1",
          attemptId: "attempt-1",
        },
        reviewRound: 1,
      },
      expectedCategory: "sp-review",
      from: null,
      to: "pending",
    };

    expect(redactPendingLogRecord(record)).toBe(record);
  });

  it("redacts finding summary and location in staged and terminal review artifacts", () => {
    const correlation = {
      reviewKind: "task-review" as const,
      taskExecutionRef: { authorizationId: "auth-1", taskId: "task-1", attemptId: "attempt-1" },
      reviewRound: 1,
    };
    const observedExecution = {
      schemaVersion: 1 as const,
      provenance: "observed" as const,
      reviewExecutionEventId: "event-1",
      parentSessionId: "parent-1",
      callId: "call-1",
      childSessionId: "child-1",
      correlation,
    };
    const reviewArtifact = {
      schemaVersion: 1 as const,
      reviewKind: "task-review" as const,
      reviewSource: "sp-review" as const,
      correlation,
      observedExecution,
      complete: true,
      findings: [{ itemKey: "finding-1", severity: "major" as const, summary: "token /home/user/key", location: "GITHUB_TOKEN=ghp_1234567890" }],
    };
    const staged: PendingLogRecord = {
      ...baseEnvelope,
      recordType: "observation",
      kind: "review_completion_staged",
      parentSessionId: "parent-1",
      staging: {
        callId: "call-1",
        correlation,
        artifactConsumption: { artifactId: "artifact-1", digest: "sha256:digest" },
        reviewArtifact,
        observedExecution,
      },
    };
    const terminal: PendingLogRecord = {
      ...baseEnvelope,
      recordType: "observation",
      kind: "review_dispatch_transition",
      transitionId: "transition-1",
      parentSessionId: "parent-1",
      correlation,
      expectedCategory: "sp-review",
      from: "claimed",
      to: "terminal",
      callId: "call-1",
      terminalReason: "completed_with_findings",
      reviewArtifact,
    };

    expect(redactPendingLogRecord(staged)).toMatchObject({
      staging: { reviewArtifact: { findings: [{ summary: "token [REDACTED_PATH]", location: "[REDACTED_ENV]" }] } },
    });
    expect(redactPendingLogRecord(terminal)).toMatchObject({
      reviewArtifact: { findings: [{ summary: "token [REDACTED_PATH]", location: "[REDACTED_ENV]" }] },
    });
  });

  it("drops extra properties from review_observed items", () => {
    const item = {
      itemKey: "finding-1",
      evidenceId: "evidence-1",
      severity: "major" as const,
      summary: "summary",
      location: "src/file.ts",
      status: "open" as const,
    };
    Reflect.set(item, "injected", "untrusted extra property");
    const record: PendingLogRecord = {
      ...baseEnvelope,
      recordType: "observation",
      kind: "review_observed",
      reviewScope: "task:task-1",
      items: [item],
    };

    const result = redactPendingLogRecord(record);

    expect(result).toMatchObject({
      kind: "review_observed",
      items: [{
        itemKey: "finding-1",
        evidenceId: "evidence-1",
        severity: "major",
        summary: "summary",
        location: "src/file.ts",
        status: "open",
      }],
    });
    expect(result).not.toHaveProperty("items.0.injected");
  });

  it("rejects an unknown record kind at the runtime boundary", () => {
    const record: PendingLogRecord = {
      ...baseEnvelope,
      recordType: "observation",
      kind: "session_error",
      errorKind: "unknown",
      message: "unexpected",
    };
    Reflect.set(record, "kind", "unsupported");

    expect(() => Reflect.apply(redactPendingLogRecord, undefined, [record])).toThrow(TypeError);
  });

  describe("decision records", () => {
    it("redacts rule result reasons", () => {
      const record: PendingLogRecord = {
        ...baseEnvelope,
        recordType: "decision",
        ruleResults: [
          {
            ruleName: "rule1",
            outcome: "permit",
            reason: "path /home/user/file",
          },
          {
            ruleName: "rule2",
            outcome: "deny",
          },
        ],
      };

      const result = redactPendingLogRecord(record);
      expect(result.recordType).toBe("decision");
      const decision = result as Extract<typeof result, { recordType: "decision" }>;
      expect(decision.ruleResults[0].reason).toBe("path [REDACTED_PATH]");
      expect(decision.ruleResults[1].reason).toBeUndefined();
    });
  });
});
