import { describe, expect, it, vi } from "vitest";
import { SessionStateProvider } from "../../src/core/session-state-provider";
import { toPhysicalPath } from "../../src/core/v2/shard-layout";
import { ObservationHandler } from "../../src/hooks/observation-handler";
import { ObservationLogStore } from "../../src/runtime/observation-log-store";
import { createMemFs } from "../helpers/mock-file-system";

describe("ObservationHandler message observation", () => {
  it("persists text_complete after the assistant role is known without a message finalization signal", async () => {
    const { files, reader, writer } = createMemFs();
    const sessionState = new SessionStateProvider();
    sessionState.setAgentMapping("session-1", "atlas");
    const handler = new ObservationHandler({
      logStore: new ObservationLogStore(writer, reader, "w-handler"),
      sessionStateProvider: sessionState,
      writerId: "w-handler",
    });

    await handler.handleMessage("session-1", {
      kind: "message_updated",
      sessionId: "session-1",
      messageID: "message-1",
      role: "assistant",
      finalized: false,
    });
    await handler.handleMessage("session-1", {
      kind: "text_complete",
      sessionId: "session-1",
      messageID: "message-1",
      partID: "part-1",
      text: "tests pass",
    });

    const path = toPhysicalPath({
      agentId: "atlas",
      sessionId: "session-1",
      writerId: "w-handler",
    });
    expect(files.get(path)).toContain('"kind":"message"');
  });

  it("persists finalized assistant claims when message_updated carries the finish signal", async () => {
    const { files, reader, writer } = createMemFs();
    const sessionState = new SessionStateProvider();
    sessionState.setAgentMapping("session-1", "atlas");
    const store = new ObservationLogStore(writer, reader, "w-handler");
    const handler = new ObservationHandler({
      logStore: store,
      sessionStateProvider: sessionState,
      writerId: "w-handler",
    });

    await handler.handleMessage("session-1", {
      kind: "message_part_updated",
      sessionId: "session-1",
      messageID: "message-1",
      partID: "part-1",
      text: "tests pass",
    });
    await handler.handleMessage("session-1", {
      kind: "message_updated",
      sessionId: "session-1",
      messageID: "message-1",
      role: "assistant",
      finalized: true,
    });

    const path = toPhysicalPath({
      agentId: "atlas",
      sessionId: "session-1",
      writerId: "w-handler",
    });
    const content = files.get(path);

    expect(content).toBeDefined();
    const record = JSON.parse(content ?? "") as {
      readonly kind: string;
      readonly declaredClaims: readonly { readonly claimKind: string; readonly outcome: string }[];
      readonly evidence: readonly { readonly provenance: string; readonly declaredFrom: string }[];
    };
    expect(record.kind).toBe("message");
    expect(record.declaredClaims).toEqual([
      { evidenceId: "message-1-test", claimKind: "test", outcome: "pass" },
    ]);
    expect(record.evidence).toEqual([
      expect.objectContaining({ provenance: "declared", declaredFrom: "message" }),
    ]);
  });

  it("runs buffer GC after persisting a finalized assistant message (D65)", async () => {
    const { files, reader, writer } = createMemFs();
    const sessionState = new SessionStateProvider();
    sessionState.setAgentMapping("session-1", "atlas");
    const store = new ObservationLogStore(writer, reader, "w-handler");
    const handler = new ObservationHandler({
      logStore: store,
      sessionStateProvider: sessionState,
      writerId: "w-handler",
    });

    // finalizable message -> append -> GC runs
    await handler.handleMessage("session-1", {
      kind: "text_complete",
      sessionId: "session-1",
      messageID: "message-1",
      partID: "part-1",
      text: "tests pass",
    });
    await handler.handleMessage("session-1", {
      kind: "message_updated",
      sessionId: "session-1",
      messageID: "message-1",
      role: "assistant",
      finalized: true,
    });

    const path = toPhysicalPath({
      agentId: "atlas",
      sessionId: "session-1",
      writerId: "w-handler",
    });
    expect(files.get(path)).toBeDefined();
  });

  it("evicts stale buffer entries via GC after a finalized message (D65)", async () => {
    const { reader, writer } = createMemFs();
    const sessionState = new SessionStateProvider();
    sessionState.setAgentMapping("session-1", "atlas");
    const store = new ObservationLogStore(writer, reader, "w-handler");

    let clock = 0;
    const handler = new ObservationHandler({
      logStore: store,
      sessionStateProvider: sessionState,
      writerId: "w-handler",
    });

    // Access the internal buffer and swap the clock for deterministic aging.
    const buffer = (
      handler as unknown as {
        messageRoleBuffer: { now: () => number; gc: (ms: number, n: number) => void };
      }
    ).messageRoleBuffer;
    const originalNow = buffer.now;
    buffer.now = (): number => clock;

    try {
      await handler.handleMessage("session-1", {
        kind: "text_complete",
        sessionId: "session-1",
        messageID: "stale-message",
        partID: "part-1",
        text: "tests pass",
      });
      await handler.handleMessage("session-1", {
        kind: "message_updated",
        sessionId: "session-1",
        messageID: "stale-message",
        role: "assistant",
        finalized: true,
      });

      clock += 11 * 60 * 1000; // 11 minutes idle

      await handler.handleMessage("session-1", {
        kind: "text_complete",
        sessionId: "session-1",
        messageID: "fresh-message",
        partID: "part-1",
        text: "build ok",
      });
      await handler.handleMessage("session-1", {
        kind: "message_updated",
        sessionId: "session-1",
        messageID: "fresh-message",
        role: "assistant",
        finalized: true,
      });

      // The internal buffer should have dropped stale-message and kept fresh-message.
      expect(
        (
          handler as unknown as { messageRoleBuffer: { buffer: Map<string, unknown> } }
        ).messageRoleBuffer.buffer.has(JSON.stringify(["session-1", "stale-message"])),
      ).toBe(false);
      expect(
        (
          handler as unknown as { messageRoleBuffer: { buffer: Map<string, unknown> } }
        ).messageRoleBuffer.buffer.has(JSON.stringify(["session-1", "fresh-message"])),
      ).toBe(true);
    } finally {
      buffer.now = originalNow;
    }
  });

  it("runs buffer GC even when logStore append fails (D65 fail-open)", async () => {
    const sessionState = new SessionStateProvider();
    sessionState.setAgentMapping("session-1", "atlas");
    const logger = { warn: vi.fn() };
    const handler = new ObservationHandler({
      logStore: {
        append: async (): Promise<number> => {
          throw new Error("append failed");
        },
      } as unknown as ObservationLogStore,
      sessionStateProvider: sessionState,
      writerId: "w-handler",
      logger,
    });

    await handler.handleMessage("session-1", {
      kind: "text_complete",
      sessionId: "session-1",
      messageID: "message-1",
      partID: "part-1",
      text: "tests pass",
    });
    await handler.handleMessage("session-1", {
      kind: "message_updated",
      sessionId: "session-1",
      messageID: "message-1",
      role: "assistant",
      finalized: true,
    });

    expect(logger.warn).toHaveBeenCalledWith(
      "observation-handler message failed",
      expect.any(Error),
    );

    // The handler must still PROCEED despite the append failure.
    expect(
      await handler.handleMessage("session-1", {
        kind: "message_part_updated",
        sessionId: "session-1",
        messageID: "other",
        partID: "part-1",
        text: "ok",
      }),
    ).toEqual({ action: "proceed" });
  });

  it("skips re-persisting an already-persisted finalized message (D65)", async () => {
    const { files, reader, writer } = createMemFs();
    const sessionState = new SessionStateProvider();
    sessionState.setAgentMapping("session-1", "atlas");
    const store = new ObservationLogStore(writer, reader, "w-handler");
    const handler = new ObservationHandler({
      logStore: store,
      sessionStateProvider: sessionState,
      writerId: "w-handler",
    });

    await handler.handleMessage("session-1", {
      kind: "text_complete",
      sessionId: "session-1",
      messageID: "message-1",
      partID: "part-1",
      text: "tests pass",
    });
    await handler.handleMessage("session-1", {
      kind: "message_updated",
      sessionId: "session-1",
      messageID: "message-1",
      role: "assistant",
      finalized: true,
    });

    const path = toPhysicalPath({
      agentId: "atlas",
      sessionId: "session-1",
      writerId: "w-handler",
    });
    const firstContent = files.get(path);
    expect(firstContent).toBeDefined();

    // Re-running the same finalized message should not append a duplicate.
    await handler.handleMessage("session-1", {
      kind: "message_updated",
      sessionId: "session-1",
      messageID: "message-1",
      role: "assistant",
      finalized: true,
    });

    expect(files.get(path)).toBe(firstContent);
  });

  it("re-pends a revised part and replaces its claim after the next finish signal", async () => {
    const { files, reader, writer } = createMemFs();
    const sessionState = new SessionStateProvider();
    sessionState.setAgentMapping("session-1", "atlas");
    const handler = new ObservationHandler({
      logStore: new ObservationLogStore(writer, reader, "w-handler"),
      sessionStateProvider: sessionState,
      writerId: "w-handler",
    });

    await handler.handleMessage("session-1", {
      kind: "message_part_updated",
      sessionId: "session-1",
      messageID: "message-1",
      partID: "part-1",
      text: "tests pass",
    });
    await handler.handleMessage("session-1", {
      kind: "message_updated",
      sessionId: "session-1",
      messageID: "message-1",
      role: "assistant",
      finalized: true,
    });

    const path = toPhysicalPath({ agentId: "atlas", sessionId: "session-1", writerId: "w-handler" });
    const firstContent = files.get(path);
    await handler.handleMessage("session-1", {
      kind: "message_part_updated",
      sessionId: "session-1",
      messageID: "message-1",
      partID: "part-1",
      text: "tests fail",
    });
    expect(files.get(path)).toBe(firstContent);

    await handler.handleMessage("session-1", {
      kind: "message_updated",
      sessionId: "session-1",
      messageID: "message-1",
      role: "assistant",
      finalized: true,
    });

    const records = (files.get(path) ?? "")
      .split("\n")
      .filter(Boolean)
      .map(
        (line) =>
          JSON.parse(line) as {
            readonly declaredClaims: readonly {
              readonly evidenceId: string;
              readonly outcome: string;
            }[];
          },
      );
    expect(records).toHaveLength(2);
    expect(records[0]?.declaredClaims[0]).toMatchObject({
      evidenceId: "message-1-test",
      outcome: "pass",
    });
    expect(records[1]?.declaredClaims[0]).toMatchObject({
      evidenceId: "message-1-test",
      outcome: "fail",
    });
  });

  it("clears persisted IDs and buffered parts when a session ends", async () => {
    const { reader, writer } = createMemFs();
    const sessionState = new SessionStateProvider();
    sessionState.setAgentMapping("session-1", "atlas");
    const handler = new ObservationHandler({
      logStore: new ObservationLogStore(writer, reader, "w-handler"),
      sessionStateProvider: sessionState,
      writerId: "w-handler",
    });

    // Given: a finalized message has both persisted and buffered state.
    await handler.handleMessage("session-1", {
      kind: "text_complete",
      sessionId: "session-1",
      messageID: "message-1",
      partID: "part-1",
      text: "tests pass",
    });
    await handler.handleMessage("session-1", {
      kind: "message_updated",
      sessionId: "session-1",
      messageID: "message-1",
      role: "assistant",
      finalized: true,
    });
    const internal = handler as unknown as {
      readonly messageRoleBuffer: { readonly buffer: ReadonlyMap<string, unknown> };
      readonly persistedMessageHashes: ReadonlyMap<string, ReadonlyMap<string, string>>;
    };
    expect(internal.persistedMessageHashes.get("session-1")?.has("message-1")).toBe(true);
    expect(internal.messageRoleBuffer.buffer.has(JSON.stringify(["session-1", "message-1"]))).toBe(
      true,
    );

    // When: the session is removed.
    handler.destroySession("session-1");

    // Then: no session-scoped observation state remains.
    expect(internal.persistedMessageHashes.has("session-1")).toBe(false);
    expect(internal.messageRoleBuffer.buffer.has(JSON.stringify(["session-1", "message-1"]))).toBe(
      false,
    );
  });

  it("logs a warning when buffer GC throws during a repeated finalized message (fail-open D65)", async () => {
    const { reader, writer } = createMemFs();
    const sessionState = new SessionStateProvider();
    sessionState.setAgentMapping("session-1", "atlas");
    const store = new ObservationLogStore(writer, reader, "w-handler");
    const logger = { warn: vi.fn() };
    const handler = new ObservationHandler({
      logStore: store,
      sessionStateProvider: sessionState,
      writerId: "w-handler",
      logger,
    });

    // First observation persists the message.
    await handler.handleMessage("session-1", {
      kind: "text_complete",
      sessionId: "session-1",
      messageID: "message-gc-fail",
      partID: "part-1",
      text: "tests pass",
    });
    await handler.handleMessage("session-1", {
      kind: "message_updated",
      sessionId: "session-1",
      messageID: "message-gc-fail",
      role: "assistant",
      finalized: true,
    });

    // Force the internal GC to throw on the repeated observation path.
    const buffer = (handler as unknown as { messageRoleBuffer: { gc: () => void } })
      .messageRoleBuffer;
    const gcError = new Error("gc exploded");
    vi.spyOn(buffer, "gc").mockImplementation(() => {
      throw gcError;
    });

    const response = await handler.handleMessage("session-1", {
      kind: "text_complete",
      sessionId: "session-1",
      messageID: "message-gc-fail",
      partID: "part-1",
      text: "tests pass",
    });

    expect(response).toEqual({ action: "proceed" });
    expect(logger.warn).toHaveBeenCalledWith("observation-handler gc failed", gcError);
  });
});
