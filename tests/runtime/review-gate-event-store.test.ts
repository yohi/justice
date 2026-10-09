import { readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ReviewGateEvent } from "../../src/core/review-gate-types";
import {
  createReviewGateEventStore,
  type ReviewGateDispatchRecordV1,
} from "../../src/runtime/review-gate-event-store";

let currentRoot = "";
const tempRoots: string[] = [];

afterAll(async () => {
  for (const root of tempRoots) {
    await rm(root, { recursive: true, force: true });
  }
});

function freshRoot(): string {
  currentRoot = `${tmpdir()}/justice-task12a-events-${Math.random().toString(36).slice(2)}`;
  tempRoots.push(currentRoot);
  return currentRoot;
}

function gateCreatedEvent(gateId: string): ReviewGateEvent {
  return Object.freeze({
    eventType: "GATE_CREATED",
    gateId,
    writerId: "writer-1",
    epochId: "epoch-1",
    emittedAt: "2026-10-08T00:00:00.000Z",
    payload: Object.freeze({
      reviewScopeId: "scope-1",
      designArtifact: Object.freeze({
        canonicalPath: "docs/design.md",
        digest: "d1",
        gitMode: "100644",
      }),
      planArtifact: Object.freeze({
        canonicalPath: "docs/plan.md",
        digest: "p1",
        gitMode: "100644",
      }),
      requirementsResolution: Object.freeze({
        source: "explicit",
        canonicalPath: "requirements.md",
        digest: "r1",
      }),
      reviewProtocolFingerprint: "f".repeat(64),
    }),
  });
}

function designClearEvent(gateId: string): ReviewGateEvent {
  return Object.freeze({
    eventType: "DESIGN_CLEAR",
    gateId,
    writerId: "writer-1",
    epochId: "epoch-1",
    emittedAt: "2026-10-08T00:00:01.000Z",
    payload: Object.freeze({ designProtocolFingerprint: "e".repeat(64) }),
  });
}

function dispatchRecord(
  operationId: string,
  overrides: Partial<ReviewGateDispatchRecordV1> = {},
): ReviewGateDispatchRecordV1 {
  return Object.freeze({
    dispatchId: `dispatch-${operationId}`,
    operationId,
    operation: "review_candidates",
    phase: "design",
    dispatchedAt: "2026-10-08T00:00:00.000Z",
    completedAt: null,
    ...overrides,
  });
}

describe("ReviewGateEventStore — durable events", () => {
  it("starts empty for an unseen gate", async () => {
    const store = createReviewGateEventStore(freshRoot());

    expect(await store.readEvents("gate-a")).toEqual([]);
    store.close();
  });

  it("round-trips appended events per gate and isolates gates", async () => {
    const store = createReviewGateEventStore(freshRoot());

    await store.appendEvents("gate-a", [gateCreatedEvent("gate-a")]);
    await store.appendEvents("gate-a", [designClearEvent("gate-a")]);
    await store.appendEvents("gate-b", [gateCreatedEvent("gate-b")]);

    expect(await store.readEvents("gate-a")).toHaveLength(2);
    expect((await store.readEvents("gate-a"))[1]?.eventType).toBe("DESIGN_CLEAR");
    expect(await store.readEvents("gate-b")).toHaveLength(1);
    expect(await store.readEvents("gate-b")).not.toEqual(await store.readEvents("gate-a"));
    store.close();
  });

  it("keeps stored events independent and recursively frozen", async () => {
    const store = createReviewGateEventStore(freshRoot());
    const mutableEvent = {
      ...gateCreatedEvent("gate-a"),
      payload: {
        ...gateCreatedEvent("gate-a").payload,
        designArtifact: {
          canonicalPath: "docs/design.md",
          digest: "d1",
          gitMode: "100644" as const,
        },
      },
    };
    await store.appendEvents("gate-a", [mutableEvent]);
    mutableEvent.payload.designArtifact.canonicalPath = "changed.md";

    const firstRead = await store.readEvents("gate-a");
    const event = firstRead[0];
    expect(event?.payload.designArtifact.canonicalPath).toBe("docs/design.md");
    expect(Object.isFrozen(event?.payload.designArtifact)).toBe(true);
    expect(Object.isFrozen(event?.payload)).toBe(true);
    expect(Object.isFrozen(event)).toBe(true);
    store.close();
  });

  it("persists events durably across store instances on the same root", async () => {
    const root = freshRoot();
    const first = createReviewGateEventStore(root);
    await first.appendEvents("gate-a", [gateCreatedEvent("gate-a")]);
    first.close();

    const second = createReviewGateEventStore(root);
    expect(await second.readEvents("gate-a")).toEqual([gateCreatedEvent("gate-a")]);
    second.close();
  });

  it("writes atomically: events.jsonl exists and no temporary files survive", async () => {
    const root = freshRoot();
    const store = createReviewGateEventStore(root);
    await store.appendEvents("gate-a", [gateCreatedEvent("gate-a")]);

    const gateDir = path.join(root, ".justice", "review-gates", "gate-a");
    const files = await readdir(gateDir);
    expect(files).toContain("events.jsonl");
    expect(files.every((name) => !name.endsWith(".tmp"))).toBe(true);

    const bytes = await readFile(path.join(gateDir, "events.jsonl"), "utf8");
    expect(bytes.split("\n").filter((line) => line.length > 0)).toHaveLength(1);
    const record = JSON.parse(bytes.trim()) as ReviewGateEvent;
    expect(record.eventType).toBe("GATE_CREATED");
    store.close();
  });

  it("rejects appending an event bound to a different gate", async () => {
    const store = createReviewGateEventStore(freshRoot());

    await expect(store.appendEvents("gate-a", [gateCreatedEvent("gate-b")])).rejects.toThrow(
      "review_gate_event_gate_mismatch",
    );
    store.close();
  });

  it("rejects appending an empty batch without touching the gate directory", async () => {
    const root = freshRoot();
    const store = createReviewGateEventStore(root);

    await expect(store.appendEvents("gate-a", [])).rejects.toThrow("review_gate_event_batch_empty");
    await expect(readdir(path.join(root, ".justice", "review-gates"))).rejects.toThrow();
    store.close();
  });

  it.each(["", "a/b", "..", "/abs", "a\\b", "a\u0000b", "a..b"])(
    "rejects invalid gate id %j",
    async (gateId) => {
      const store = createReviewGateEventStore(freshRoot());
      await expect(store.appendEvents(gateId, [gateCreatedEvent("gate-x")])).rejects.toThrow(
        "review_gate_invalid_id",
      );
      await expect(store.readEvents(gateId)).rejects.toThrow("review_gate_invalid_id");
      store.close();
    },
  );

  it("rejects malformed or non-object events", async () => {
    const store = createReviewGateEventStore(freshRoot());

    await expect(
      store.appendEvents("gate-a", [null as unknown as ReviewGateEvent]),
    ).rejects.toThrow("review_gate_event_schema_invalid");
    store.close();
  });

  it("rejects operations after close", async () => {
    const store = createReviewGateEventStore(freshRoot());
    store.close();
    store.close(); // idempotent

    await expect(store.readEvents("gate-a")).rejects.toThrow("review_gate_store_closed");
    await expect(store.appendEvents("gate-a", [gateCreatedEvent("gate-a")])).rejects.toThrow(
      "review_gate_store_closed",
    );
  });
});

describe("ReviewGateEventStore — dispatch records", () => {
  it("records, lists, and marks dispatches completed", async () => {
    const store = createReviewGateEventStore(freshRoot());
    await store.recordDispatch("gate-a", dispatchRecord("op-1"));
    await store.recordDispatch("gate-a", dispatchRecord("op-2"));

    expect(await store.listDispatches("gate-a")).toHaveLength(2);
    await store.markDispatchCompleted("gate-a", "op-1");

    const dispatches = await store.listDispatches("gate-a");
    const op1 = dispatches[0];
    const op2 = dispatches[1];
    expect(op1?.operationId).toBe("op-1");
    expect(op1?.completedAt).toBeTypeOf("string");
    expect(op2?.completedAt).toBeNull();
    store.close();
  });

  it("persists dispatch completion across store instances", async () => {
    const root = freshRoot();
    const first = createReviewGateEventStore(root);
    await first.recordDispatch("gate-a", dispatchRecord("op-1"));
    await first.markDispatchCompleted("gate-a", "op-1");
    first.close();

    const second = createReviewGateEventStore(root);
    const dispatches = await second.listDispatches("gate-a");
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]?.completedAt).toBeTypeOf("string");
    second.close();
  });

  it("keeps completion idempotent: re-marking a completed dispatch is a no-op", async () => {
    const store = createReviewGateEventStore(freshRoot());
    await store.recordDispatch("gate-a", dispatchRecord("op-1"));
    await store.markDispatchCompleted("gate-a", "op-1");
    const after = await store.listDispatches("gate-a");
    await store.markDispatchCompleted("gate-a", "op-1");

    expect(await store.listDispatches("gate-a")).toEqual(after);
    store.close();
  });

  it("rejects completion of an unknown dispatch", async () => {
    const store = createReviewGateEventStore(freshRoot());
    await store.recordDispatch("gate-a", dispatchRecord("op-1"));

    await expect(store.markDispatchCompleted("gate-a", "op-missing")).rejects.toThrow(
      "review_gate_dispatch_unknown",
    );
    store.close();
  });

  it("rejects re-recording an existing operation id with different content", async () => {
    const store = createReviewGateEventStore(freshRoot());
    await store.recordDispatch("gate-a", dispatchRecord("op-1"));

    await expect(
      store.recordDispatch("gate-a", dispatchRecord("op-1", { phase: "plan" })),
    ).rejects.toThrow("review_gate_dispatch_conflict");
    // identical re-record stays idempotent
    await store.recordDispatch("gate-a", dispatchRecord("op-1"));
    expect(await store.listDispatches("gate-a")).toHaveLength(1);
    store.close();
  });

  it("keeps dispatch records isolated per gate", async () => {
    const store = createReviewGateEventStore(freshRoot());
    await store.recordDispatch("gate-a", dispatchRecord("op-1"));
    await store.recordDispatch("gate-b", dispatchRecord("op-1", { phase: "plan" }));

    const gateA = await store.listDispatches("gate-a");
    const gateB = await store.listDispatches("gate-b");
    expect(gateA).toHaveLength(1);
    expect(gateA[0]?.phase).toBe("design");
    expect(gateB).toHaveLength(1);
    expect(gateB[0]?.phase).toBe("plan");
    store.close();
  });
});

describe("ReviewGateEventStore — scope index", () => {
  it("round-trips the review scope to gate mapping", async () => {
    const root = freshRoot();
    const store = createReviewGateEventStore(root);

    expect(await store.readScopeIndex("scope-1")).toBeNull();
    await store.writeScopeIndex("scope-1", "gate-a");
    expect(await store.readScopeIndex("scope-1")).toBe("gate-a");
    store.close();

    // Durable across instances
    const second = createReviewGateEventStore(root);
    expect(await second.readScopeIndex("scope-1")).toBe("gate-a");
    await second.writeScopeIndex("scope-1", "gate-b");
    expect(await second.readScopeIndex("scope-1")).toBe("gate-b");
    second.close();
  });

  it("returns null for inherited scope-index keys", async () => {
    const root = freshRoot();
    const store = createReviewGateEventStore(root);
    await store.writeScopeIndex("scope-1", "gate-a");
    expect(await store.readScopeIndex("toString")).toBeNull();
    store.close();
  });

  it("persists the scope index as JSON under .justice/review-gates/", async () => {
    const root = freshRoot();
    const store = createReviewGateEventStore(root);
    await store.writeScopeIndex("scope-1", "gate-a");

    const bytes = await readFile(
      path.join(root, ".justice", "review-gates", "scope-index.json"),
      "utf8",
    );
    expect(JSON.parse(bytes)).toEqual({ "scope-1": "gate-a" });
    store.close();
  });

  it.each(["", "a/b", "..", "/abs"])("rejects invalid scope id %j", async (reviewScopeId) => {
    const store = createReviewGateEventStore(freshRoot());
    await expect(store.readScopeIndex(reviewScopeId)).rejects.toThrow("review_gate_invalid_id");
    await expect(store.writeScopeIndex(reviewScopeId, "gate-a")).rejects.toThrow(
      "review_gate_invalid_id",
    );
    store.close();
  });

  it("rejects writing a scope index entry with an invalid gate id", async () => {
    const store = createReviewGateEventStore(freshRoot());
    await expect(store.writeScopeIndex("scope-1", "a/b")).rejects.toThrow("review_gate_invalid_id");
    store.close();
  });
});

describe("ReviewGateEventStore — gate namespace enumeration (Task 13/14)", () => {
  it("lists gate namespaces without decoding events", async () => {
    const root = freshRoot();
    const store = createReviewGateEventStore(root);

    expect(await store.listGateIds()).toEqual([]);

    await store.appendEvents("gate-b", [gateCreatedEvent("gate-b")]);
    await store.writeScopeIndex("scope-1", "gate-b");
    await store.appendEvents("gate-a", [gateCreatedEvent("gate-a")]);

    expect(await store.listGateIds()).toEqual(["gate-a", "gate-b"]);

    // The recovery base directory is never a Gate namespace.
    const { mkdir } = await import("node:fs/promises");
    await mkdir(path.join(root, ".justice", "review-gates", "recovery"), { recursive: true });
    expect(await store.listGateIds()).toEqual(["gate-a", "gate-b"]);
    store.close();
  });

  it("keeps enumeration available after stores are reopened on the same root", async () => {
    const root = freshRoot();
    const first = createReviewGateEventStore(root);
    await first.appendEvents("gate-a", [gateCreatedEvent("gate-a")]);
    first.close();

    const second = createReviewGateEventStore(root);
    expect(await second.listGateIds()).toEqual(["gate-a"]);
    second.close();
  });

  it("rejects enumeration after close", async () => {
    const store = createReviewGateEventStore(freshRoot());
    store.close();
    await expect(store.listGateIds()).rejects.toThrow("review_gate_store_closed");
  });
});

describe("ReviewGateEventStore — concurrent append interleaving", () => {
  it("serializes interleaved appends for one gate without losing events", async () => {
    const store = createReviewGateEventStore(freshRoot());

    await Promise.all([
      store.appendEvents("gate-a", [gateCreatedEvent("gate-a")]),
      store.appendEvents("gate-a", [designClearEvent("gate-a")]),
    ]);

    expect(await store.readEvents("gate-a")).toHaveLength(2);
    store.close();
  });
});
