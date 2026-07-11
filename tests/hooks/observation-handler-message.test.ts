import { describe, expect, it, vi } from "vitest";
import { SessionStateProvider } from "../../src/core/session-state-provider";
import { toPhysicalPath } from "../../src/core/v2/shard-layout";
import { ObservationHandler } from "../../src/hooks/observation-handler";
import { ObservationLogStore } from "../../src/runtime/observation-log-store";
import { createMemFs } from "../helpers/mock-file-system";

describe("ObservationHandler message observation", () => {
  it("persists finalized assistant claims only after the text-complete payload", async () => {
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
    expect(files.get(path)).toBeUndefined();

    await handler.handleMessage("session-1", {
      kind: "text_complete",
      sessionId: "session-1",
      messageID: "message-1",
      partID: "part-1",
      text: "tests pass",
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
});
