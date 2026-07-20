/* eslint-disable security/detect-object-injection -- Test file intentionally indexes mock writer by computed fixture path. */
import { describe, expect, it } from "vitest";
import { ObservationHandler } from "../../../src/hooks/observation-handler";
import { SessionStateProvider } from "../../../src/core/session-state-provider";
import { ObservationLogStore } from "../../../src/runtime/observation-log-store";
import { createMockFileReader, createMockFileWriter } from "../../helpers/mock-file-system";
import { toPhysicalPath } from "../../../src/core/v2/shard-layout";
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

    expect(written).not.toContain("/home/alice/project");
    expect(written).not.toContain("~/secret_tilde");
    expect(written).not.toContain("quoted_path");
    expect(written).not.toContain("/tmp/foo");
    expect(written).not.toContain("/workspace/src");
    expect(written).not.toContain("/Users/bob/project");
    expect(written).not.toContain("C:\\Users\\carol\\project");
    expect(written).not.toContain("GITHUB_TOKEN=ghp_xxx");
    expect(written).not.toContain("https://user:token@example.com");
    expect(written).not.toContain("user:token");
    expect(written).not.toContain(secretKey);
    expect(written).toContain("[REDACTED_PATH]");
    expect(written).toContain("[REDACTED_ENV]");
    expect(written).toContain("[REDACTED_TOKEN_URL]");
    expect(written).toContain("[REDACTED_SECRET]");
  });

  it("stores file_content reads as rawOutputHash plus minimal snippet", async () => {
    const writerId = "w-redact-2";
    const { handler, writer } = buildHandler(writerId);

    await handler.handlePostToolUse(
      buildPostToolUseEvent("bash", "this is the content of plan.md", { command: "cat plan.md" }),
    );

    const physicalPath = toPhysicalPath({ agentId: "atlas", sessionId: "session-1", writerId });
    const written = writer.writtenFiles[physicalPath];
    expect(written).toBeDefined();
    expect(written).toContain("rawOutputHash");
    expect(written).not.toContain('"rawOutput"');
  });
});
