import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  areSessionManagerHistoriesComplete,
  inspectSessionManagerHistoryReadback,
} from "./session-history-readback";
import { inspectCapabilitySessionStorage } from "./capability-session-storage";

type TestEntry = Readonly<{
  readonly type: "message" | "custom";
  readonly id: string;
  readonly parentId: string | null;
  readonly timestamp: string;
  readonly message?: Readonly<{ readonly role: "user"; readonly content: readonly Readonly<{ readonly type: "text"; readonly text: string }>[] }>;
  readonly customType?: string;
  readonly data?: Readonly<Record<string, unknown>>;
}>;

function header(sessionId: string, cwd = "/fixture/project"): Readonly<Record<string, unknown>> {
  return {
    type: "session",
    version: 3,
    id: sessionId,
    timestamp: "2026-10-11T00:00:00.000Z",
    cwd,
  };
}

function messageEntry(id: string, parentId: string | null): TestEntry {
  return {
    type: "message",
    id,
    parentId,
    timestamp: "2026-10-11T00:00:01.000Z",
    message: { role: "user", content: [{ type: "text", text: "fixture message" }] },
  };
}

function customEntry(id: string, parentId: string | null, token?: string): TestEntry {
  return {
    type: "custom",
    id,
    parentId,
    timestamp: "2026-10-11T00:00:02.000Z",
    customType: "fixture.branch-marker",
    data: token === undefined ? {} : { text: token },
  };
}

function sessionJsonl(sessionId: string, entries: readonly unknown[], firstHeader = header(sessionId)): string {
  return [firstHeader, ...entries].map((entry) => JSON.stringify(entry)).join("\n") + "\n";
}

function inspect(input: {
  readonly sessionId?: string;
  readonly memoryEntries?: readonly unknown[];
  readonly jsonl?: string;
  readonly capabilityIds?: readonly string[];
}) {
  const sessionId = input.sessionId ?? "session-parent";
  const entries = input.memoryEntries ?? [messageEntry("entry-1", null), customEntry("entry-2", "entry-1")];
  return inspectSessionManagerHistoryReadback({
    sessionId,
    sessionManagerEntries: entries,
    sessionJsonl: input.jsonl ?? sessionJsonl(sessionId, entries),
    capabilityIds: input.capabilityIds ?? [],
  });
}

describe("SessionManager history read-back", () => {
  it("excludes the validated leading header and matches every SessionEntry", () => {
    const result = inspect({});

    expect(result).toMatchObject({
      headerValid: true,
      headerCount: 1,
      sessionEntriesObserved: 2,
      diskEntriesObserved: 2,
      entryIdsAndBranchesMatch: true,
      unsafeStorage: false,
    });
  });

  it("read-backs the exact provider stream-error message from memory and JSONL", () => {
    const sessionId = "session-provider-error";
    const callId = "justice-spike-task-fallback";
    const providerErrorEntry = {
      type: "message",
      id: "entry-provider-error",
      parentId: null,
      timestamp: "2026-10-11T00:00:03.000Z",
      message: {
        role: "assistant",
        stopReason: "error",
        errorMessage: "justice-spike-provider-stream-failure",
        content: [{ type: "toolCall", id: callId, name: "task", arguments: { description: "safe-label" } }],
      },
    };
    const entries = [messageEntry("entry-1", null), providerErrorEntry];
    const result = inspectSessionManagerHistoryReadback({
      sessionId,
      sessionManagerEntries: entries,
      sessionJsonl: sessionJsonl(sessionId, entries),
      capabilityIds: [],
      providerStreamErrorCallId: callId,
    });

    expect(result).toMatchObject({
      providerStreamErrorMemoryEntries: 1,
      providerStreamErrorDiskEntries: 1,
      providerStreamErrorTokenFreeInMemory: true,
      providerStreamErrorTokenFreeInDisk: true,
      entryIdsAndBranchesMatch: true,
    });
  });

  it("keeps the selected-method read result in matched memory and JSONL history", () => {
    const sessionId = "session-selected-method";
    const toolCallId = "justice-spike-case-b-reauthorizing-read";
    const readResultEntry = {
      type: "message",
      id: "entry-selected-method",
      parentId: null,
      timestamp: "2026-10-11T00:00:03.000Z",
      message: {
        role: "toolResult",
        toolCallId,
        toolName: "read",
        isError: false,
        content: [{ type: "text", text: "selected method content" }],
      },
    };
    const entries = [messageEntry("entry-1", null), readResultEntry];
    const result = inspectSessionManagerHistoryReadback({
      sessionId,
      sessionManagerEntries: entries,
      sessionJsonl: sessionJsonl(sessionId, entries),
      capabilityIds: [],
      selectedMethodReadToolCallId: toolCallId,
    });

    expect(result).toMatchObject({
      selectedMethodReadMemoryEntries: 1,
      selectedMethodReadDiskEntries: 1,
      selectedMethodReadPersistedInMemory: true,
      selectedMethodReadPersistedInDisk: true,
    });
  });

  it("rejects a getEntries result that incorrectly includes the header", () => {
    const sessionId = "session-parent";
    const entries = [messageEntry("entry-1", null)];
    const result = inspect({
      sessionId,
      memoryEntries: [header(sessionId), ...entries],
      jsonl: sessionJsonl(sessionId, entries),
    });

    expect(result.entryIdsAndBranchesMatch).toBe(false);
    expect(result.unsafeStorage).toBe(true);
  });

  it("fails closed when one persisted branch entry is absent from getEntries", () => {
    const sessionId = "session-parent";
    const first = messageEntry("entry-1", null);
    const second = customEntry("entry-2", "entry-1");
    const result = inspect({
      sessionId,
      memoryEntries: [first],
      jsonl: sessionJsonl(sessionId, [first, second]),
    });

    expect(result.entryIdsAndBranchesMatch).toBe(false);
  });

  it("fails closed when a branch parent differs between memory and JSONL", () => {
    const sessionId = "session-parent";
    const memory = [messageEntry("entry-1", null), customEntry("entry-2", "entry-1")];
    const disk = [messageEntry("entry-1", null), customEntry("entry-2", null)];
    const result = inspect({ sessionId, memoryEntries: memory, jsonl: sessionJsonl(sessionId, disk) });

    expect(result.entryIdsAndBranchesMatch).toBe(false);
  });

  it("rejects duplicate entry IDs even when the sorted identities otherwise appear present", () => {
    const sessionId = "session-parent";
    const duplicate = [messageEntry("entry-1", null), customEntry("entry-1", null)];
    const result = inspect({ sessionId, memoryEntries: duplicate, jsonl: sessionJsonl(sessionId, duplicate) });

    expect(result.entryIdsAndBranchesMatch).toBe(false);
    expect(result.unsafeStorage).toBe(true);
  });

  it("rejects a malformed or misplaced session header", () => {
    const sessionId = "session-parent";
    const entry = messageEntry("entry-1", null);
    const malformedHeader = { ...header(sessionId), id: "other-session" };
    const result = inspect({ sessionId, memoryEntries: [entry], jsonl: sessionJsonl(sessionId, [entry], malformedHeader) });

    expect(result.headerValid).toBe(false);
    expect(result.unsafeStorage).toBe(true);
  });

  it("rejects a session header that is not the first JSONL row", () => {
    const sessionId = "session-parent";
    const entry = messageEntry("entry-1", null);
    const result = inspect({
      sessionId,
      memoryEntries: [entry],
      jsonl: [entry, header(sessionId)].map((value) => JSON.stringify(value)).join("\n"),
    });

    expect(result.headerValid).toBe(false);
    expect(result.unsafeStorage).toBe(true);
  });

  it("rejects duplicate session headers instead of treating one as an entry", () => {
    const sessionId = "session-parent";
    const entry = messageEntry("entry-1", null);
    const jsonl = [header(sessionId), header(sessionId), entry].map((value) => JSON.stringify(value)).join("\n");
    const result = inspect({ sessionId, memoryEntries: [entry], jsonl });

    expect(result.headerValid).toBe(false);
    expect(result.headerCount).toBe(2);
    expect(result.unsafeStorage).toBe(true);
  });

  it("rejects unknown entry types rather than omitting them from the comparison", () => {
    const sessionId = "session-parent";
    const unknownEntry = { ...customEntry("entry-unknown", null), type: "future_entry_type" };
    const result = inspect({
      sessionId,
      memoryEntries: [unknownEntry],
      jsonl: sessionJsonl(sessionId, [unknownEntry]),
    });

    expect(result.entryIdsAndBranchesMatch).toBe(false);
    expect(result.unsafeStorage).toBe(true);
  });

  it("rejects malformed JSONL after the header", () => {
    const sessionId = "session-parent";
    const result = inspect({ sessionId, jsonl: `${JSON.stringify(header(sessionId))}\n{"type":` });

    expect(result.headerValid).toBe(false);
    expect(result.unsafeStorage).toBe(true);
  });

  it("rejects a parent reference absent from the session history", () => {
    const sessionId = "session-parent";
    const orphan = messageEntry("entry-orphan", "missing-parent");
    const result = inspect({ sessionId, memoryEntries: [orphan], jsonl: sessionJsonl(sessionId, [orphan]) });

    expect(result.entryIdsAndBranchesMatch).toBe(false);
    expect(result.unsafeStorage).toBe(true);
  });

  it("scans the session header for capability tokens", () => {
    const sessionId = "session-parent";
    const token = "fixture-capability-token";
    const entry = messageEntry("entry-1", null);
    const result = inspect({
      sessionId,
      memoryEntries: [entry],
      jsonl: sessionJsonl(sessionId, [entry], header(sessionId, `/fixture/${token}`)),
      capabilityIds: [token],
    });

    expect(result.tokenFoundInDiskEntries).toBe(true);
  });

  it("scans inactive branch entries held by SessionManager and disk", () => {
    const sessionId = "session-parent";
    const token = "fixture-capability-token";
    const entries = [
      messageEntry("entry-root", null),
      messageEntry("entry-active", "entry-root"),
      customEntry("entry-inactive-branch", "entry-root", token),
    ];
    const result = inspect({ sessionId, memoryEntries: entries, jsonl: sessionJsonl(sessionId, entries), capabilityIds: [token] });

    expect(result.tokenFoundInMemoryEntries).toBe(true);
    expect(result.tokenFoundInDiskEntries).toBe(true);
  });

  it("requires complete parent and child read-backs rather than accepting one matching session", () => {
    const parent = inspect({ sessionId: "session-parent" });
    const child = inspect({ sessionId: "session-child" });
    const secondChild = inspect({ sessionId: "session-child-2" });
    const parentShutdown = { ...parent, phase: "session_shutdown" };
    const childShutdown = { ...child, phase: "session_shutdown" };
    const secondChildShutdown = { ...secondChild, phase: "session_shutdown" };

    expect(areSessionManagerHistoriesComplete([parentShutdown], ["session-parent", "session-child"])).toBe(false);
    expect(areSessionManagerHistoriesComplete([parentShutdown, childShutdown], ["session-parent", "session-child"])).toBe(true);
    expect(
      areSessionManagerHistoriesComplete(
        [parentShutdown, childShutdown],
        ["session-parent", "session-child", "session-child-2"],
      ),
    ).toBe(false);
    expect(
      areSessionManagerHistoriesComplete(
        [parentShutdown, childShutdown, secondChildShutdown],
        ["session-parent", "session-child", "session-child-2"],
      ),
    ).toBe(true);
  });

  it("accepts repeated turn-end snapshots but requires exactly one valid shutdown snapshot per session", () => {
    const parent = inspect({ sessionId: "session-parent" });
    const child = inspect({ sessionId: "session-child" });
    const parentTurnEnd = { ...parent, phase: "turn_end" };
    const parentShutdown = { ...parent, phase: "session_shutdown" };
    const childTurnEnd = { ...child, phase: "turn_end" };
    const childShutdown = { ...child, phase: "session_shutdown" };

    expect(
      areSessionManagerHistoriesComplete(
        [parentTurnEnd, parentShutdown, childTurnEnd, childShutdown],
        ["session-parent", "session-child"],
      ),
    ).toBe(true);
    expect(
      areSessionManagerHistoriesComplete(
        [parentShutdown, parentShutdown, childShutdown],
        ["session-parent", "session-child"],
      ),
    ).toBe(false);
  });

  it("blocks unsafe storage read-backs and token-bearing inactive branches", () => {
    const parent = inspect({ sessionId: "session-parent" });
    const child = inspect({ sessionId: "session-child" });
    const parentShutdown = { ...parent, phase: "session_shutdown" };
    const childShutdown = { ...child, phase: "session_shutdown" };
    const unreadableChild = { ...childShutdown, unsafeStorage: true };
    const inactiveTokenBranch = inspect({
      sessionId: "session-child",
      capabilityIds: ["fixture-capability-token"],
      memoryEntries: [
        messageEntry("entry-root", null),
        messageEntry("entry-active", "entry-root"),
        customEntry("entry-inactive", "entry-root", "fixture-capability-token"),
      ],
    });
    const tokenBearingChildShutdown = {
      ...childShutdown,
      tokenFoundInMemoryEntries: inactiveTokenBranch.tokenFoundInMemoryEntries,
      tokenFoundInDiskEntries: inactiveTokenBranch.tokenFoundInDiskEntries,
    };

    expect(areSessionManagerHistoriesComplete([parentShutdown, unreadableChild], ["session-parent", "session-child"])).toBe(false);
    expect(
      areSessionManagerHistoriesComplete(
        [parentShutdown, tokenBearingChildShutdown],
        ["session-parent", "session-child"],
      ),
    ).toBe(false);
  });

  it("fails closed when an explicitly expected session file is missing", async () => {
    const root = mkdtempSync(join(tmpdir(), "justice-session-history-test-"));
    try {
      const result = await inspectCapabilitySessionStorage({
        isolatedRoot: root,
        sessionFiles: [join(root, "sessions/session-parent.jsonl")],
        sessionIds: ["session-parent"],
        capabilityIds: [],
      });

      expect(result.unsafeStorage).toBe(true);
      expect(result.unsafeReasons).toContain("explicit_session_file_unavailable");
      expect(result.sessionIdsObserved).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
