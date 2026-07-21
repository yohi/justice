/* eslint-disable security/detect-object-injection -- Test file intentionally indexes mock writer by computed fixture path. */
import { describe, expect, it } from "vitest";
import { ObservationHandler } from "../../../src/hooks/observation-handler";
import { SessionStateProvider } from "../../../src/core/session-state-provider";
import { ObservationLogStore } from "../../../src/runtime/observation-log-store";
import { createMockFileReader, createMockFileWriter } from "../../helpers/mock-file-system";
import { toPhysicalPath } from "../../../src/core/v2/shard-layout";
import { hashString } from "../../../src/core/v2/hash";
import type { PostToolUseEvent } from "../../../src/core/types";

function buildHandler(writerId: string): { handler: ObservationHandler; writer: ReturnType<typeof createMockFileWriter> } {
  const writer = createMockFileWriter();
  const reader = createMockFileReader({});
  const store = new ObservationLogStore(writer, reader, writerId);
  const sessionState = new SessionStateProvider();
  sessionState.setAgentMapping("session-1", "atlas");

  const handler = new ObservationHandler({
    logStore: store,
    sessionStateProvider: sessionState,
    writerId,
  });

  return { handler, writer };
}

function buildPostToolUseEvent(
  toolName: string,
  toolResult: string,
  toolInput: Record<string, unknown>,
): PostToolUseEvent {
  return {
    type: "PostToolUse",
    sessionId: "session-1",
    callId: "c1",
    payload: {
      toolName,
      toolResult,
      error: false,
      toolInput,
    },
  };
}

function parseJsonl(written: string): unknown[] {
  return written
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

function findFirstRecord(written: string): unknown {
  const records = parseJsonl(written);
  expect(records.length).toBeGreaterThan(0);
  return records[0]!;
}

describe("redaction integration", () => {
  it("redacts secrets, absolute paths, env vars, and token URLs before append via observation-handler", async () => {
    const writerId = "w-redact-1";
    const { handler, writer } = buildHandler(writerId);

    const rawCommand = 'echo /home/alice/project/secret ~/secret_tilde \\\\server\\share\\secret_unc "/home/alice/quoted_path" /tmp/foo /workspace/src /Users/bob/project C:\\Users\\carol\\project GITHUB_TOKEN=ghp_xxx https://user:token@example.com';
    const secretKey = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890";

    await handler.handlePostToolUse(
      buildPostToolUseEvent("execute_command", secretKey, { command: rawCommand }),
    );

    const physicalPath = toPhysicalPath({ agentId: "atlas", sessionId: "session-1", writerId });
    const written = writer.writtenFiles[physicalPath];
    expect(written).toBeDefined();

    const record = findFirstRecord(written) as Record<string, unknown>;
    expect(record.recordType).toBe("observation");
    expect(record.kind).toBe("tool_executed");
    const evidence = (record.evidence as Record<string, unknown>[])[0]!;
    const command = evidence.command as string;
    const rawOutput = evidence.rawOutput as string;

    expect(command).not.toContain("/home/alice/project");
    expect(command).not.toContain("~/secret_tilde");
    expect(command).not.toContain("quoted_path");
    expect(command).not.toContain("/tmp/foo");
    expect(command).not.toContain("/workspace/src");
    expect(command).not.toContain("/Users/bob/project");
    expect(command).not.toContain("C:\\Users\\carol\\project");
    expect(command).not.toContain("\\\\server\\share\\secret_unc");
    expect(command).not.toContain("GITHUB_TOKEN=ghp_xxx");
    expect(command).not.toContain("https://user:token@example.com");
    expect(command).not.toContain("user:token");
    expect(command).toContain("[REDACTED_PATH]");
    expect(command).toContain("[REDACTED_ENV]");
    expect(command).toContain("[REDACTED_TOKEN_URL]");

    expect(rawOutput).not.toContain(secretKey);
    expect(rawOutput).toContain("[REDACTED_SECRET]");
  });

  it("stores file_content reads as rawOutputHash plus minimal snippet", async () => {
    const writerId = "w-redact-2";
    const { handler, writer } = buildHandler(writerId);
    const rawOutput = "this is the content of plan.md";
    await handler.handlePostToolUse(
      buildPostToolUseEvent("bash", rawOutput, { command: "cat plan.md" }),
    );

    const physicalPath = toPhysicalPath({ agentId: "atlas", sessionId: "session-1", writerId });
    const written = writer.writtenFiles[physicalPath];
    expect(written).toBeDefined();

    const record = findFirstRecord(written) as Record<string, unknown>;
    expect(record.recordType).toBe("observation");
    expect(record.kind).toBe("tool_executed");
    const evidence = (record.evidence as Record<string, unknown>[])[0]!;
    expect(evidence.toolOutputClass).toBe("file_content");
    expect(evidence.rawOutput).toBeUndefined();
    expect(evidence.rawOutputHash).toBe(hashString(rawOutput));
    expect(evidence.rawOutputSnippet).toBe("this is the content of plan.md");
    expect(written).not.toContain('"rawOutput"');
  });
});
