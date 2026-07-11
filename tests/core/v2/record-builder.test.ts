import { describe, expect, it } from "vitest";
import { buildToolExecutedRecord } from "../../../src/core/v2/record-builder";
import type { PendingEnvelope } from "../../../src/core/v2/observation-model";

const envelope: PendingEnvelope = {
  schemaVersion: 1,
  timestamp: "2026-07-11T00:00:00.000Z",
  agentId: "hephaestus",
  sessionId: "session-1",
  writerId: "writer-1",
  taskId: "task-1",
  recordType: "observation",
};

describe("buildToolExecutedRecord", () => {
  it("builds redacted command evidence from a tool execution", () => {
    const record = buildToolExecutedRecord({
      envelope,
      toolName: "bash",
      toolInput: { command: "bun test /home/example/private.test.ts GITHUB_TOKEN=secret-value" },
      toolOutput: { output: "PASS /home/example/private.txt GITHUB_TOKEN=secret-value" },
      callId: "call-1",
    });

    expect(record).toMatchObject({
      kind: "tool_executed",
      toolName: "bash",
      callId: "call-1",
      evidence: [
        {
          evidenceId: "call-1",
          sourceClass: "tool_output",
          provenance: "observed",
          toolOutputClass: "command_exec",
        },
      ],
    });
    const observed = record.evidence[0];
    expect(observed?.sourceClass).toBe("tool_output");
    if (observed?.sourceClass !== "tool_output" || observed.toolOutputClass !== "command_exec") {
      throw new Error("expected command execution evidence");
    }
    expect(observed.command).not.toContain("/home/example");
    expect(observed.command).not.toContain("secret-value");
    expect(observed.rawOutput).not.toContain("/home/example");
    expect(observed.rawOutput).not.toContain("secret-value");
  });

  it("adds task-summary claims as declared evidence after observed evidence", () => {
    const record = buildToolExecutedRecord({
      envelope,
      toolName: "task",
      toolInput: { taskId: "task-1" },
      toolOutput: { output: "Tests pass" },
      callId: "call-2",
      summaryClaims: [{ evidenceId: "summary-test", claimKind: "test", outcome: "pass" }],
    });

    expect(record.evidence).toEqual([
      expect.objectContaining({
        evidenceId: "call-2",
        provenance: "observed",
      }),
      {
        evidenceId: "summary-test",
        kind: "test",
        sourceClass: "declared_claim",
        provenance: "declared",
        declaredFrom: "task_summary",
        claim: { claimKind: "test", outcome: "pass" },
      },
    ]);
  });

  it("stores file content as a redacted snippet and hash without raw output", () => {
    const record = buildToolExecutedRecord({
      envelope,
      toolName: "read",
      toolInput: {},
      toolOutput: { output: "contents from /home/example/private.txt" },
      callId: "call-3",
    });

    const observed = record.evidence[0];
    expect(observed?.sourceClass).toBe("tool_output");
    if (observed?.sourceClass !== "tool_output" || observed.toolOutputClass !== "file_content") {
      throw new Error("expected file content evidence");
    }
    expect(observed.rawOutputHash).toMatch(/^sha256:/);
    expect(observed.rawOutputSnippet).not.toContain("/home/example");
    expect("rawOutput" in observed).toBe(false);
  });
});
