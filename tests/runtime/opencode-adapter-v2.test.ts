import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenCodeAdapter } from "../../src/runtime/opencode-adapter";
import { OpenCodeNotifier } from "../../src/runtime/opencode-notifier";
import { JusticePlugin } from "../../src/core/justice-plugin";
import * as pluginModule from "../../src/core/justice-plugin";
import * as writerIdModule from "../../src/runtime/writer-id";
import { fakeInit } from "../helpers/fake-opencode-init";
import { createMockFileReader, createMockFileWriter } from "../helpers/mock-file-system";

/**
 * Task 3.2 — Adapter Extension: the adapter forwards ALL tool executions
 * (excluding justice_* query tools) plus message/agent observation events into
 * JusticePlugin.handleEvent, and applies gate-advisory responses via the
 * guaranteed notifier channel (and an optional best-effort output append).
 */
describe("OpenCodeAdapter v2 — tool forwarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("(a) forwards a non-task tool (bash) as PreToolUse with callId and toolInput", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    const spy = vi.spyOn(justice, "handleEvent").mockResolvedValue({ action: "proceed" });

    await adapter.onToolExecuteBefore(
      { tool: "bash", sessionID: "s", callID: "c1" },
      { args: { command: "ls" } },
    );

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatchObject({
      type: "PreToolUse",
      sessionId: "s",
      callId: "c1",
      payload: { toolName: "bash", callId: "c1", toolInput: { command: "ls" } },
    });
  });

  it("(a) forwards a non-task tool (bash) as PostToolUse with callId/toolInput/metadata", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    const spy = vi.spyOn(justice, "handleEvent").mockResolvedValue({ action: "proceed" });

    await adapter.onToolExecuteAfter(
      { tool: "bash", sessionID: "s", callID: "c1", args: { command: "ls" } },
      { output: "file1 file2", metadata: { error: false } },
    );

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatchObject({
      type: "PostToolUse",
      sessionId: "s",
      callId: "c1",
      payload: {
        toolName: "bash",
        callId: "c1",
        toolInput: { command: "ls" },
        toolResult: "file1 file2",
        metadata: { error: false },
        error: false,
      },
    });
  });

  it("promotes a valid human-approved artifact only from exact justice_review while preserving raw metadata", async () => {
    // Given
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    const spy = vi.spyOn(justice, "handleEvent").mockResolvedValue({ action: "proceed" });
    const reviewResolutionArtifact = {
      authority: "human_approved",
      reviewScope: " task-6.3 ",
      itemKeys: [" major:parser "],
      artifactRef: " docs/reviews/task-6.3.md ",
    };

    // When
    await adapter.onToolExecuteAfter(
      { tool: "justice_review", sessionID: "s", callID: "c1", args: {} },
      { output: "resolved", metadata: { reviewResolutionArtifact, error: false } },
    );

    // Then
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toMatchObject({
      type: "PostToolUse",
      payload: {
        toolName: "justice_review",
        metadata: { reviewResolutionArtifact, error: false },
        reviewResolutionArtifact: {
          authority: "human_approved",
          reviewScope: "task-6.3",
          itemKeys: ["major:parser"],
          artifactRef: "docs/reviews/task-6.3.md",
        },
      },
    });
  });

  it.each(["justice_Review", "justice_review_extra", "justice_review "])(
    "does not forward variant %s as a trusted review-resolution source",
    async (tool) => {
      // Given
      const adapter = new OpenCodeAdapter(fakeInit());
      await adapter.ensureInitialized();
      const justice = adapter.getJustice() as JusticePlugin;
      const spy = vi.spyOn(justice, "handleEvent").mockResolvedValue({ action: "proceed" });
      const reviewResolutionArtifact = {
        authority: "human_approved",
        reviewScope: "task-6.3",
        itemKeys: ["major:parser"],
        artifactRef: "docs/reviews/task-6.3.md",
      };

      // When
      await adapter.onToolExecuteAfter(
        { tool, sessionID: "s", callID: "c1", args: {} },
        { output: "resolved", metadata: { reviewResolutionArtifact } },
      );

      // Then
      expect(spy).not.toHaveBeenCalled();
    },
  );

  it("does not promote an error-marked exact justice_review artifact", async () => {
    // Given
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    const spy = vi.spyOn(justice, "handleEvent").mockResolvedValue({ action: "proceed" });
    const reviewResolutionArtifact = {
      authority: "human_approved",
      reviewScope: "task-6.3",
      itemKeys: ["major:parser"],
      artifactRef: "docs/reviews/task-6.3.md",
    };

    // When
    await adapter.onToolExecuteAfter(
      { tool: "justice_review", sessionID: "s", callID: "c1", args: {} },
      { output: "failed", metadata: { reviewResolutionArtifact, error: true } },
    );

    // Then
    expect(spy.mock.calls[0]?.[0]).toMatchObject({
      type: "PostToolUse",
      payload: { metadata: { reviewResolutionArtifact, error: true }, error: true },
    });
    expect(spy.mock.calls[0]?.[0]).not.toHaveProperty("payload.reviewResolutionArtifact");
  });

  it("rejects malformed exact justice_review metadata without logging its contents", async () => {
    // Given
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    const eventSpy = vi.spyOn(justice, "handleEvent").mockResolvedValue({ action: "proceed" });
    const logSpy = vi.spyOn(adapter, "log").mockResolvedValue(undefined);
    const malformedArtifact = {
      authority: "human_approved",
      reviewScope: "task-6.3",
      itemKeys: [],
      artifactRef: "docs/reviews/task-6.3.md",
    };

    // When
    await adapter.onToolExecuteAfter(
      { tool: "justice_review", sessionID: "s", callID: "c1", args: {} },
      { output: "resolved", metadata: { reviewResolutionArtifact: malformedArtifact } },
    );

    // Then
    expect(eventSpy.mock.calls[0]?.[0]).not.toHaveProperty("payload.reviewResolutionArtifact");
    expect(logSpy).toHaveBeenCalledWith(
      "warn",
      "[Justice] malformed review resolution artifact ignored",
    );
    expect(JSON.stringify(logSpy.mock.calls)).not.toContain(JSON.stringify(malformedArtifact));
  });

  it.each(["bash", "task", "code_review"])(
    "forwards raw review metadata from generic %s tools without a typed artifact",
    async (tool) => {
    // Given
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    const spy = vi.spyOn(justice, "handleEvent").mockResolvedValue({ action: "proceed" });
    const reviewResolutionArtifact = {
      authority: "human_approved",
      reviewScope: "task-6.3",
      itemKeys: ["major:parser"],
      artifactRef: "docs/reviews/task-6.3.md",
    };

    // When
    await adapter.onToolExecuteAfter(
      { tool, sessionID: "s", callID: "c1", args: { command: "ls" } },
      { output: "resolved", metadata: { isCompleteSnapshot: true, reviewResolutionArtifact } },
    );

    // Then
    expect(spy.mock.calls[0]?.[0]).toMatchObject({
      type: "PostToolUse",
      payload: { metadata: { isCompleteSnapshot: true, reviewResolutionArtifact } },
    });
    expect(spy.mock.calls[0]?.[0]).not.toHaveProperty("payload.reviewResolutionArtifact");
    },
  );

  it.each([
    {
      authority: "machine_approved",
      reviewScope: "task-6.3",
      itemKeys: ["major:parser"],
      artifactRef: "docs/reviews/task-6.3.md",
    },
    {
      authority: "human_approved",
      reviewScope: " ",
      itemKeys: ["major:parser"],
      artifactRef: "docs/reviews/task-6.3.md",
    },
    {
      authority: "human_approved",
      reviewScope: "task-6.3",
      itemKeys: [],
      artifactRef: "docs/reviews/task-6.3.md",
    },
    {
      authority: "human_approved",
      reviewScope: "task-6.3",
      itemKeys: ["major:parser", ""],
      artifactRef: "docs/reviews/task-6.3.md",
    },
    {
      authority: "human_approved",
      reviewScope: "task-6.3",
      itemKeys: ["major:parser"],
      artifactRef: " ",
    },
  ])("leaves malformed generic tool metadata untyped without logging its contents", async (artifact) => {
    // Given
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    const eventSpy = vi.spyOn(justice, "handleEvent").mockResolvedValue({ action: "proceed" });
    const logSpy = vi.spyOn(adapter, "log").mockResolvedValue(undefined);

    // When
    await adapter.onToolExecuteAfter(
      { tool: "bash", sessionID: "s", callID: "c1", args: { command: "ls" } },
      { output: "resolved", metadata: { reviewResolutionArtifact: artifact } },
    );

    // Then
    expect(eventSpy.mock.calls[0]?.[0]).not.toHaveProperty("payload.reviewResolutionArtifact");
    expect(logSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(logSpy.mock.calls)).not.toContain(JSON.stringify(artifact));
  });

  it("(b) excludes justice_* query tools from forwarding (Pre and Post)", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    const spy = vi.spyOn(justice, "handleEvent");

    await adapter.onToolExecuteBefore(
      { tool: "justice_status", sessionID: "s", callID: "c1" },
      { args: {} },
    );
    await adapter.onToolExecuteAfter(
      { tool: "justice_gate", sessionID: "s", callID: "c2", args: {} },
      { output: "verdict", metadata: undefined },
    );

    expect(spy).not.toHaveBeenCalled();
  });
});

describe("OpenCodeAdapter v2 — gate advisory application", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("(c) gate_advisory inject fires notifier.notify but leaves output.output unchanged when append disabled", async () => {
    const notifySpy = vi.spyOn(OpenCodeNotifier.prototype, "notify").mockResolvedValue(undefined);
    const adapter = new OpenCodeAdapter(fakeInit()); // enableAdvisoryOutputAppend defaults false
    await adapter.ensureInitialized();
    notifySpy.mockClear(); // discard the initialization notification
    const justice = adapter.getJustice() as JusticePlugin;
    vi.spyOn(justice, "handleEvent").mockResolvedValue({
      action: "inject",
      injectedContext: "GATE: blocked by unmet evidence",
      variant: "gate_advisory",
    });

    const output: { output: string; metadata?: Record<string, unknown> } = {
      output: "raw tool output",
    };
    await adapter.onToolExecuteAfter(
      { tool: "bash", sessionID: "s", callID: "c1", args: {} },
      output,
    );

    // Guaranteed channel fired with the justice_gate banner.
    expect(notifySpy).toHaveBeenCalledTimes(1);
    expect(notifySpy.mock.calls[0][0]).toMatchObject({
      level: "warning",
      variant: "justice_gate",
      title: "Task Gate",
      message: "GATE: blocked by unmet evidence",
      sessionId: "s",
    });
    // Best-effort channel is OFF by default: raw output is untouched.
    expect(output.output).toBe("raw tool output");
  });

  it("(c) appends the banner to output.output when enableAdvisoryOutputAppend is true", async () => {
    const adapter = new OpenCodeAdapter(fakeInit(), { enableAdvisoryOutputAppend: true });
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    vi.spyOn(justice, "handleEvent").mockResolvedValue({
      action: "inject",
      injectedContext: "GATE: blocked",
      variant: "gate_advisory",
    });

    const output: { output: string; metadata?: Record<string, unknown> } = { output: "raw" };
    await adapter.onToolExecuteAfter(
      { tool: "bash", sessionID: "s", callID: "c1", args: {} },
      output,
    );

    expect(output.output.startsWith("raw\n\n")).toBe(true);
    expect(output.output).toContain("JUSTICE NOTIFICATION");
    expect(output.output).toContain("Task Gate");
  });

  it("(c) a plain inject (no gate_advisory variant) does not notify or mutate output", async () => {
    const notifySpy = vi.spyOn(OpenCodeNotifier.prototype, "notify").mockResolvedValue(undefined);
    const adapter = new OpenCodeAdapter(fakeInit(), { enableAdvisoryOutputAppend: true });
    await adapter.ensureInitialized();
    notifySpy.mockClear();
    const justice = adapter.getJustice() as JusticePlugin;
    vi.spyOn(justice, "handleEvent").mockResolvedValue({
      action: "inject",
      injectedContext: "some other inject",
    });

    const output: { output: string; metadata?: Record<string, unknown> } = { output: "raw" };
    await adapter.onToolExecuteAfter(
      { tool: "bash", sessionID: "s", callID: "c1", args: {} },
      output,
    );

    expect(notifySpy).not.toHaveBeenCalled();
    expect(output.output).toBe("raw");
  });

  it("(c) gate_advisory notify falls back to taskId 'unknown' when input.args has no taskId", async () => {
    const notifySpy = vi.spyOn(OpenCodeNotifier.prototype, "notify").mockResolvedValue(undefined);
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    notifySpy.mockClear(); // discard the initialization notification
    const justice = adapter.getJustice() as JusticePlugin;
    vi.spyOn(justice, "handleEvent").mockResolvedValue({
      action: "inject",
      injectedContext: "GATE: blocked",
      variant: "gate_advisory",
    });

    const output: { output: string; metadata?: Record<string, unknown> } = { output: "raw" };
    // input.args intentionally omits taskId.
    await adapter.onToolExecuteAfter(
      { tool: "bash", sessionID: "s", callID: "c1", args: {} },
      output,
    );

    expect(notifySpy).toHaveBeenCalledTimes(1);
    expect(notifySpy.mock.calls[0][0]).toMatchObject({ taskId: "unknown" });
  });

  it("(c) gate_advisory notify uses input.args.taskId when present", async () => {
    const notifySpy = vi.spyOn(OpenCodeNotifier.prototype, "notify").mockResolvedValue(undefined);
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    notifySpy.mockClear(); // discard the initialization notification
    const justice = adapter.getJustice() as JusticePlugin;
    vi.spyOn(justice, "handleEvent").mockResolvedValue({
      action: "inject",
      injectedContext: "GATE: blocked",
      variant: "gate_advisory",
    });

    const output: { output: string; metadata?: Record<string, unknown> } = { output: "raw" };
    await adapter.onToolExecuteAfter(
      { tool: "bash", sessionID: "s", callID: "c1", args: { taskId: "task-42" } },
      output,
    );

    expect(notifySpy).toHaveBeenCalledTimes(1);
    expect(notifySpy.mock.calls[0][0]).toMatchObject({ taskId: "task-42" });
  });
});

describe("OpenCodeAdapter v2 — message / agent observation forwarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("(d) forwards both the legacy content Message and an observation message_updated for an assistant", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    const spy = vi.spyOn(justice, "handleEvent").mockResolvedValue({ action: "proceed" });

    await adapter.onEvent({
      event: {
        type: "message.updated",
        properties: {
          sessionID: "sess-1",
          info: { id: "msg-1", role: "assistant", content: "done", time: { completed: 123 } },
        },
      },
    });

    const events = spy.mock.calls.map((c) => c[0]);
    expect(spy).toHaveBeenCalledTimes(2);

    // Legacy plan-bridge delegation path preserved.
    const contentMsg = events.find((e) => e.type === "Message" && "content" in e.payload);
    expect(contentMsg).toMatchObject({
      type: "Message",
      sessionId: "sess-1",
      payload: { role: "assistant", content: "done" },
    });

    // New observation message_updated with finalized derived from time.completed.
    const obsMsg = events.find(
      (e) => e.type === "Message" && "kind" in e.payload && e.payload.kind === "message_updated",
    );
    expect(obsMsg).toMatchObject({
      type: "Message",
      sessionId: "sess-1",
      payload: {
        kind: "message_updated",
        sessionId: "sess-1",
        messageID: "msg-1",
        role: "assistant",
        finalized: true,
      },
    });
  });

  it("(d) does not forward an observation message_updated when messageID is absent (unroutable)", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    const spy = vi.spyOn(justice, "handleEvent").mockResolvedValue({ action: "proceed" });

    await adapter.onEvent({
      event: {
        type: "message.updated",
        properties: {
          sessionID: "sess-1",
          info: { role: "assistant", content: "no id here" },
        },
      },
    });

    // Only the legacy content path fires; the observation is dropped without a messageID.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatchObject({
      type: "Message",
      payload: { role: "assistant", content: "no id here" },
    });
  });

  it("(d) still forwards the observation message_updated when the legacy delegation dispatch throws", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    const logSpy = vi.spyOn(adapter, "log").mockResolvedValue(undefined);
    const spy = vi.spyOn(justice, "handleEvent").mockImplementation(async (event) => {
      if (event.type === "Message" && "content" in event.payload) {
        throw new Error("delegation dispatch boom");
      }
      return { action: "proceed" };
    });

    await adapter.onEvent({
      event: {
        type: "message.updated",
        properties: {
          sessionID: "sess-1",
          info: { id: "msg-1", role: "assistant", content: "done", time: { completed: 123 } },
        },
      },
    });

    const events = spy.mock.calls.map((c) => c[0]);

    // The failing delegation dispatch was still attempted...
    const contentMsg = events.find((e) => e.type === "Message" && "content" in e.payload);
    expect(contentMsg).toBeDefined();

    // ...and its failure was logged rather than crashing the handler.
    expect(logSpy).toHaveBeenCalledWith(
      "error",
      "[Justice] plan-bridge delegation dispatch failed",
      expect.any(Error),
    );

    // Critically, the observation message_updated must still be dispatched (3)
    // even though the legacy delegation dispatch (2) threw.
    const obsMsg = events.find(
      (e) => e.type === "Message" && "kind" in e.payload && e.payload.kind === "message_updated",
    );
    expect(obsMsg).toMatchObject({
      type: "Message",
      sessionId: "sess-1",
      payload: {
        kind: "message_updated",
        sessionId: "sess-1",
        messageID: "msg-1",
        role: "assistant",
        finalized: true,
      },
    });
  });

  it("(e) forwards an AgentMapped event when an agent property is present", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    const spy = vi.spyOn(justice, "handleEvent").mockResolvedValue({ action: "proceed" });

    await adapter.onEvent({
      event: {
        type: "message.updated",
        properties: {
          sessionID: "sess-1",
          info: { id: "msg-1", role: "assistant", content: "", agent: "hephaestus" },
        },
      },
    });

    const events = spy.mock.calls.map((c) => c[0]);
    const agentMapped = events.find((e) => e.type === "AgentMapped");
    expect(agentMapped).toMatchObject({
      type: "AgentMapped",
      payload: { sessionId: "sess-1", agentName: "hephaestus" },
    });
  });

  it("forwards chat.message content and chat.params agent mapping", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    const spy = vi.spyOn(justice, "handleEvent").mockResolvedValue({ action: "proceed" });

    await adapter.onEvent({
      event: {
        type: "chat.params",
        properties: { sessionID: "sess-chat", agent: "atlas" },
      },
    });
    await adapter.onEvent({
      event: {
        type: "chat.message",
        properties: {
          sessionID: "sess-chat",
          message: { role: "user", content: "delegate next task" },
        },
      },
    });

    expect(spy).toHaveBeenCalledWith({
      type: "AgentMapped",
      sessionId: "sess-chat",
      payload: { sessionId: "sess-chat", agentName: "atlas" },
    });
    expect(spy).toHaveBeenCalledWith({
      type: "Message",
      sessionId: "sess-chat",
      payload: { role: "user", content: "delegate next task" },
    });
  });

  it("(g) still dispatches the plan-bridge Message when AgentMapped dispatch throws", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    // Reject ONLY the AgentMapped dispatch; Message dispatches must still succeed.
    const spy = vi.spyOn(justice, "handleEvent").mockImplementation(async (event) => {
      if (event.type === "AgentMapped") {
        throw new Error("agent mapping boom");
      }
      return { action: "proceed" };
    });

    await adapter.onEvent({
      event: {
        type: "message.updated",
        properties: {
          sessionID: "sess-1",
          info: {
            id: "msg-1",
            role: "assistant",
            content: "delegate next task",
            agent: "hephaestus",
          },
        },
      },
    });

    const events = spy.mock.calls.map((c) => c[0]);
    // The failing AgentMapped dispatch was attempted...
    expect(events.some((e) => e.type === "AgentMapped")).toBe(true);
    // ...but the plan-bridge delegation Message still fired despite it throwing.
    const contentMsg = events.find((e) => e.type === "Message" && "content" in e.payload);
    expect(contentMsg).toMatchObject({
      type: "Message",
      sessionId: "sess-1",
      payload: { role: "assistant", content: "delegate next task" },
    });
  });

  it("wires message.part.updated into an observation message_part_updated payload", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    const spy = vi.spyOn(justice, "handleEvent").mockResolvedValue({ action: "proceed" });

    await adapter.onEvent({
      event: {
        type: "message.part.updated",
        properties: {
          sessionID: "sess-1",
          part: { id: "part-1", messageID: "msg-1", text: "partial text" },
        },
      },
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatchObject({
      type: "Message",
      sessionId: "sess-1",
      payload: {
        kind: "message_part_updated",
        sessionId: "sess-1",
        messageID: "msg-1",
        partID: "part-1",
        text: "partial text",
      },
    });
  });

  it("drops a message part without an identifier or text", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    const spy = vi.spyOn(justice, "handleEvent").mockResolvedValue({ action: "proceed" });

    await adapter.onEvent({
      event: {
        type: "message.part.updated",
        properties: { sessionID: "sess-1", part: { messageID: "msg-1" } },
      },
    });

    expect(spy).not.toHaveBeenCalled();
  });

  it("forwards experimental text completion as a text_complete observation payload", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    const spy = vi.spyOn(justice, "handleEvent").mockResolvedValue({ action: "proceed" });

    await adapter.onTextComplete(
      { sessionID: "sess-1", messageID: "msg-1", partID: "part-1" },
      { text: "final text" },
    );

    expect(spy).toHaveBeenCalledWith({
      type: "Message",
      sessionId: "sess-1",
      payload: {
        kind: "text_complete",
        sessionId: "sess-1",
        messageID: "msg-1",
        partID: "part-1",
        text: "final text",
      },
    });
  });

  it("forwards every session error to the plugin before loop-specific processing", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    const spy = vi.spyOn(justice, "handleEvent").mockResolvedValue({ action: "proceed" });

    await adapter.onEvent({
      event: {
        type: "session.error",
        properties: { sessionID: "sess-1", error: { message: "ordinary provider failure" } },
      },
    });

    expect(spy).toHaveBeenCalledWith({
      type: "Event",
      sessionId: "sess-1",
      payload: {
        eventType: "session_error",
        sessionId: "sess-1",
        message: "ordinary provider failure",
      },
    });
  });

  it("keeps failing open when message.updated handling throws", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    vi.spyOn(justice, "handleEvent").mockRejectedValue(new Error("boom"));

    await expect(
      adapter.onEvent({
        event: {
          type: "message.updated",
          properties: { sessionID: "sess-1", info: { id: "m", role: "assistant", content: "x" } },
        },
      }),
    ).resolves.toBeUndefined();
  });
});

describe("OpenCodeAdapter v2 — writerId bootstrap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("(f) allocates a writerId and threads it into JusticePluginOptions at init", async () => {
    const allocSpy = vi
      .spyOn(writerIdModule, "allocateWriterId")
      .mockResolvedValue("w-sentinel-1234");
    const ctorSpy = vi.spyOn(pluginModule, "JusticePlugin");

    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();

    // Allocation happens once with the system shard identity.
    expect(allocSpy).toHaveBeenCalledTimes(1);
    expect(allocSpy.mock.calls[0][1]).toEqual({ agentId: "system", sessionId: "system" });

    // The resolved writerId is threaded into the JusticePlugin constructor options.
    expect(ctorSpy).toHaveBeenCalled();
    const options = ctorSpy.mock.calls[0][2];
    expect(options).toMatchObject({ writerId: "w-sentinel-1234" });
  });
});

describe("JusticePlugin.handleEvent — v2 routing guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns PROCEED for AgentMapped events (persona mapping deferred to Task 3.4)", async () => {
    const plugin = new JusticePlugin(createMockFileReader({}), createMockFileWriter());
    const res = await plugin.handleEvent({
      type: "AgentMapped",
      sessionId: "s",
      payload: { sessionId: "s", agentName: "atlas" },
    });
    expect(res).toEqual({ action: "proceed" });
  });

  it("returns PROCEED for observation-kind Message payloads without invoking plan-bridge", async () => {
    const plugin = new JusticePlugin(createMockFileReader({}), createMockFileWriter());
    const spy = vi.spyOn(plugin.getPlanBridge(), "handleMessage");
    const res = await plugin.handleEvent({
      type: "Message",
      sessionId: "s",
      payload: {
        kind: "message_updated",
        sessionId: "s",
        messageID: "m1",
        role: "assistant",
        finalized: true,
      },
    });
    expect(res).toEqual({ action: "proceed" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns PROCEED for non-task PreToolUse/PostToolUse without invoking handlers", async () => {
    const plugin = new JusticePlugin(createMockFileReader({}), createMockFileWriter());
    const preSpy = vi.spyOn(plugin.getPlanBridge(), "handlePreToolUse");
    const postPlanSpy = vi.spyOn(plugin.getPlanBridge(), "handlePostToolUse");
    const postFeedbackSpy = vi.spyOn(plugin.getTaskFeedback(), "handlePostToolUse");

    const pre = await plugin.handleEvent({
      type: "PreToolUse",
      sessionId: "s",
      payload: { toolName: "bash", toolInput: { command: "ls" } },
    });
    const post = await plugin.handleEvent({
      type: "PostToolUse",
      sessionId: "s",
      payload: { toolName: "bash", toolResult: "out", error: false },
    });

    expect(pre).toEqual({ action: "proceed" });
    expect(post).toEqual({ action: "proceed" });
    expect(preSpy).not.toHaveBeenCalled();
    expect(postPlanSpy).not.toHaveBeenCalled();
    expect(postFeedbackSpy).not.toHaveBeenCalled();
  });

  it("keeps a task window available while its PostToolUse observation is handled", async () => {
    const plugin = new JusticePlugin(createMockFileReader({}), createMockFileWriter());
    const observedTaskIds: (string | undefined)[] = [];
    vi.spyOn(plugin.getObservationHandler(), "handlePostToolUse").mockImplementation(
      async (event) => {
        observedTaskIds.push(plugin.getSessionStateProvider().getActiveTaskId(event.callId ?? ""));
        return { action: "proceed" };
      },
    );

    await plugin.handleEvent({
      type: "PreToolUse",
      sessionId: "s",
      callId: "call-1",
      payload: { toolName: "task", toolInput: { taskId: "task-1" } },
    });
    await plugin.handleEvent({
      type: "PostToolUse",
      sessionId: "s",
      callId: "call-1",
      payload: {
        toolName: "task",
        toolInput: { taskId: "task-1" },
        toolResult: "done",
        error: false,
      },
    });

    expect(observedTaskIds).toEqual(["task-1"]);
    expect(plugin.getSessionStateProvider().getActiveTaskId("call-1")).toBeUndefined();
  });
});
