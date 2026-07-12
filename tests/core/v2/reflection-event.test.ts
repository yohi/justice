import { describe, expect, it } from "vitest";
import { buildReflectionEvent } from "../../../src/core/v2/reflection-event";
import type { PendingEnvelope } from "../../../src/core/v2/observation-model";

function createEnvelope(): PendingEnvelope {
  return {
    schemaVersion: 1,
    timestamp: "2026-07-12T00:00:00.000Z",
    agentId: "hephaestus",
    sessionId: "session-1",
    writerId: "w-test",
    taskId: "task-1",
    recordType: "observation",
  };
}

describe("buildReflectionEvent", () => {
  it("builds a reflection record with relative plan path", () => {
    const record = buildReflectionEvent(
      createEnvelope(),
      {
        trigger: "task_succeeded",
        planRef: { path: "plan.md", taskId: "task-1" },
        intent: "check_complete",
      },
      "/workspace",
    );

    expect(record.recordType).toBe("observation");
    expect(record.kind).toBe("reflection");
    expect(record.reflection).toMatchObject({
      trigger: "task_succeeded",
      planRef: { path: "plan.md", taskId: "task-1" },
      intent: "check_complete",
    });
  });

  it("throws for absolute plan paths", () => {
    expect(() =>
      buildReflectionEvent(
        createEnvelope(),
        {
          trigger: "task_succeeded",
          planRef: { path: "/workspace/plan.md", taskId: "task-1" },
          intent: "check_complete",
        },
        "/workspace",
      ),
    ).toThrow("Invalid plan path: Absolute path or traversal detected");
  });

  it("throws for Windows drive-letter paths", () => {
    expect(() =>
      buildReflectionEvent(
        createEnvelope(),
        {
          trigger: "task_succeeded",
          planRef: { path: "C:\\workspace\\plan.md", taskId: "task-1" },
          intent: "check_complete",
        },
        "/workspace",
      ),
    ).toThrow("Invalid plan path: Absolute path or traversal detected");
  });

  it("throws for traversal via relative path", () => {
    expect(() =>
      buildReflectionEvent(
        createEnvelope(),
        {
          trigger: "task_succeeded",
          planRef: { path: "../other/plan.md", taskId: "task-1" },
          intent: "check_complete",
        },
        "/workspace",
      ),
    ).toThrow("Invalid plan path: Absolute path or traversal detected");
  });

  it("throws when workspace root is undefined", () => {
    expect(() =>
      buildReflectionEvent(
        createEnvelope(),
        {
          trigger: "task_succeeded",
          planRef: { path: "plan.md", taskId: "task-1" },
          intent: "check_complete",
        },
        undefined,
      ),
    ).toThrow("Invalid plan path: workspace root is not configured");
  });

  it("redacts absolute paths and secrets in note", () => {
    const record = buildReflectionEvent(
      createEnvelope(),
      {
        trigger: "task_error",
        planRef: { path: "plan.md", taskId: "task-1" },
        intent: "append_error_note",
        note: "Error in /home/user/project with sk-abc123",
      },
      "/workspace",
    );

    expect(record.reflection.note).toContain("REDACTED");
    expect(record.reflection.note).not.toContain("/home/user/project");
  });
});
