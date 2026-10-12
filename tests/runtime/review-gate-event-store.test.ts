import { createHash, randomUUID } from "node:crypto";
import { appendFile, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ReviewGateEvent } from "../../src/core/review-gate-types";
import {
  encodeReviewGateEventRecord,
  validateReviewGateEventRecord,
  type VerifiedReviewGateEvent,
} from "../../src/core/review-gate/event-schema";
import {
  createLegacyReviewGateEventStore as createReviewGateEventStore,
  type ReviewGateDispatchRecordV1,
  type ReviewGateJournalEventInput,
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

const DIGEST64 = "a".repeat(64);
const SHA256_OF_EMPTY = createHash("sha256").update("").digest("hex");

function eventsFilePath(root: string, gateId: string): string {
  return path.join(root, ".justice", "review-gates", gateId, "events.jsonl");
}

/** Raw V2 typed event (Task 4c FINDING_VALIDATION_COMPLETED) before codec validation. */
function rawV2FindingValidationEvent(gateId: string, eventId = "v2-event-1"): unknown {
  return {
    schemaVersion: 2,
    eventId,
    parentEventId: "v2-parent-0",
    emittedAt: "2026-10-08T00:00:02.000Z",
    gateId,
    epochId: "epoch-1",
    generationId: "generation-1",
    writerId: "writer-1",
    eventType: "FINDING_VALIDATION_COMPLETED",
    payload: {
      eventType: "FINDING_VALIDATION_COMPLETED",
      operationId: "op-v2-1",
      validationEventId: "validation-1",
      disposition: "ALREADY_RESOLVED",
      relation: "EXISTING",
      lineageId: "lineage-1",
      priorCommittedResolutionEventId: "resolution-1",
      pinnedBaselineDigest: DIGEST64,
      semanticContextFingerprint: DIGEST64,
      validatedAbsenceProofDigest: DIGEST64,
      witnessedFrontierHash: DIGEST64,
    },
  };
}

function verifiedV2Event(gateId: string, eventId = "v2-event-1"): VerifiedReviewGateEvent {
  return validateReviewGateEventRecord(rawV2FindingValidationEvent(gateId, eventId));
}

/** Clone one verified event and inject an unknown top-level field. */
function withRogueField(event: VerifiedReviewGateEvent): VerifiedReviewGateEvent {
  const clone = structuredClone(event);
  (clone as { rogueField?: string }).rogueField = "rogue";
  return clone;
}

/** Codec-invalid V1 event: GATE_CREATED payload misses every required field. */
function brokenPayloadV1Event(gateId: string): ReviewGateEvent {
  return { ...gateCreatedEvent(gateId), payload: {} } as unknown as ReviewGateEvent;
}

/** Codec-invalid V1 event: payload carries an unsafe absolute path string. */
function unsafePathV1Event(gateId: string): ReviewGateEvent {
  const base = gateCreatedEvent(gateId);
  return {
    ...base,
    payload: {
      ...base.payload,
      designArtifact: { canonicalPath: "/etc/passwd", digest: "d1", gitMode: "100644" },
    },
  } as unknown as ReviewGateEvent;
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

describe("ReviewGateEventStore — durable canonical journal bytes (Task 6)", () => {
  it("writes newline-terminated canonical codec lines", async () => {
    const root = freshRoot();
    const store = createReviewGateEventStore(root);
    await store.appendEvents("gate-a", [gateCreatedEvent("gate-a")]);

    const bytes = await readFile(eventsFilePath(root, "gate-a"), "utf8");
    expect(bytes.endsWith("\n")).toBe(true);
    const lines = bytes.split("\n").filter((line) => line.length > 0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(
      encodeReviewGateEventRecord(validateReviewGateEventRecord(gateCreatedEvent("gate-a"))),
    );
    store.close();
  });
});

describe("ReviewGateEventStore — protected publication CAS (Task 6)", () => {
  it("reads the unseen-journal frontier as the sha256 of empty content", async () => {
    const store = createReviewGateEventStore(freshRoot());
    expect(await store.readFrontierHash("gate-a")).toBe(SHA256_OF_EMPTY);
    store.close();
  });

  it("commits a publication when the expected frontier matches and advances it", async () => {
    const store = createReviewGateEventStore(freshRoot());
    const expected = await store.readFrontierHash("gate-a");

    const result = await store.publishEvents("gate-a", [gateCreatedEvent("gate-a")], expected);

    expect(result.eventCount).toBe(1);
    expect(result.frontierHash).not.toBe(expected);
    expect(result.frontierHash).not.toBe(SHA256_OF_EMPTY);
    expect(await store.readFrontierHash("gate-a")).toBe(result.frontierHash);
    expect(await store.readEvents("gate-a")).toHaveLength(1);
    store.close();
  });

  it("rejects an empty publication batch", async () => {
    const store = createReviewGateEventStore(freshRoot());
    await expect(
      store.publishEvents("gate-a", [], await store.readFrontierHash("gate-a")),
    ).rejects.toThrow("review_gate_event_batch_empty");
    store.close();
  });

  it("rejects a stale frontier and leaves the journal byte-identical", async () => {
    const root = freshRoot();
    const store = createReviewGateEventStore(root);
    const genesisFrontier = await store.readFrontierHash("gate-a");
    const first = await store.publishEvents("gate-a", [gateCreatedEvent("gate-a")], genesisFrontier);
    const bytesAfterFirst = await readFile(eventsFilePath(root, "gate-a"), "utf8");

    await expect(
      store.publishEvents("gate-a", [designClearEvent("gate-a")], genesisFrontier),
    ).rejects.toThrow("review_gate_publication_cas_conflict");

    expect(await readFile(eventsFilePath(root, "gate-a"), "utf8")).toBe(bytesAfterFirst);
    expect(await store.readFrontierHash("gate-a")).toBe(first.frontierHash);
    expect(await store.readEvents("gate-a")).toHaveLength(1);
    const files = await readdir(path.join(root, ".justice", "review-gates", "gate-a"));
    expect(files.every((name) => !name.endsWith(".tmp"))).toBe(true);
    store.close();
  });

  it("rejects a foreign expected frontier without creating the gate directory", async () => {
    const root = freshRoot();
    const store = createReviewGateEventStore(root);

    await expect(
      store.publishEvents("gate-a", [gateCreatedEvent("gate-a")], "0".repeat(64)),
    ).rejects.toThrow("review_gate_publication_cas_conflict");
    await expect(readdir(path.join(root, ".justice", "review-gates"))).rejects.toThrow();
    store.close();
  });

  it("resolves two racing publications with the same expected frontier to exactly one commit", async () => {
    const store = createReviewGateEventStore(freshRoot());
    const expected = await store.readFrontierHash("gate-a");

    const results = await Promise.allSettled([
      store.publishEvents("gate-a", [gateCreatedEvent("gate-a")], expected),
      store.publishEvents("gate-a", [designClearEvent("gate-a")], expected),
    ]);

    expect(results[0]?.status).toBe("fulfilled");
    expect(results[1]?.status).toBe("rejected");
    if (results[1]?.status === "rejected") {
      expect(String(results[1].reason)).toContain("review_gate_publication_cas_conflict");
    }
    expect(await store.readEvents("gate-a")).toHaveLength(1);
    expect((await store.readEvents("gate-a"))[0]?.eventType).toBe("GATE_CREATED");
    store.close();
  });

  it("keeps the published frontier stable across store restarts", async () => {
    const root = freshRoot();
    const first = createReviewGateEventStore(root);
    const published = await first.publishEvents(
      "gate-a",
      [gateCreatedEvent("gate-a")],
      await first.readFrontierHash("gate-a"),
    );
    first.close();

    const second = createReviewGateEventStore(root);
    expect(await second.readFrontierHash("gate-a")).toBe(published.frontierHash);
    expect(await second.readEvents("gate-a")).toHaveLength(1);
    second.close();
  });

  it("treats a retried publication after a lost acknowledgement as a CAS conflict, not a duplicate", async () => {
    const root = freshRoot();
    const store = createReviewGateEventStore(root);
    const expected = await store.readFrontierHash("gate-a");
    await store.publishEvents("gate-a", [gateCreatedEvent("gate-a")], expected);
    store.close(); // simulated crash before the caller saw the acknowledgement

    const restarted = createReviewGateEventStore(root);
    await expect(
      restarted.publishEvents("gate-a", [gateCreatedEvent("gate-a")], expected),
    ).rejects.toThrow("review_gate_publication_cas_conflict");
    expect(await restarted.readVerifiedEvents("gate-a")).toHaveLength(1);
    restarted.close();
  });
});

describe("ReviewGateEventStore — V1/V2 codec journal (Task 6)", () => {
  it("round-trips a V2 typed event through the protected publication path", async () => {
    const store = createReviewGateEventStore(freshRoot());
    const verified = verifiedV2Event("gate-a");

    const result = await store.publishEvents(
      "gate-a",
      [verified],
      await store.readFrontierHash("gate-a"),
    );

    expect(result.eventCount).toBe(1);
    const readBack = await store.readVerifiedEvents("gate-a");
    expect(readBack).toHaveLength(1);
    expect(readBack[0]).toEqual(verified);
    store.close();
  });

  it("returns V1 and V2 events in commit order on a mixed journal", async () => {
    const store = createReviewGateEventStore(freshRoot());
    await store.appendEvents("gate-a", [gateCreatedEvent("gate-a")]);
    const verified = verifiedV2Event("gate-a");
    await store.publishEvents("gate-a", [verified], await store.readFrontierHash("gate-a"));

    const events = await store.readVerifiedEvents("gate-a");
    expect(events.map((event) => ("schemaVersion" in event ? "v2" : "v1"))).toEqual(["v1", "v2"]);
    store.close();
  });

  it("round-trips V1 legacy events through the verified read", async () => {
    const store = createReviewGateEventStore(freshRoot());
    await store.appendEvents("gate-a", [gateCreatedEvent("gate-a")]);
    expect(await store.readVerifiedEvents("gate-a")).toEqual([gateCreatedEvent("gate-a")]);
    store.close();
  });

  it("fails closed on the legacy read when the journal contains a V2 event", async () => {
    const store = createReviewGateEventStore(freshRoot());
    await store.publishEvents(
      "gate-a",
      [verifiedV2Event("gate-a")],
      await store.readFrontierHash("gate-a"),
    );
    await expect(store.readEvents("gate-a")).rejects.toThrow("review_gate_event_unsupported_v2");
    await expect(
      store.appendEvents("gate-a", [designClearEvent("gate-a")]),
    ).rejects.toThrow("review_gate_event_unsupported_v2");
    store.close();
  });

  it("rejects codec-invalid V1 events on append", async () => {
    const store = createReviewGateEventStore(freshRoot());
    await expect(store.appendEvents("gate-a", [brokenPayloadV1Event("gate-a")])).rejects.toThrow(
      "review_gate_event_schema_invalid",
    );
    store.close();
  });

  it("rejects events whose payload carries an unsafe absolute path", async () => {
    const store = createReviewGateEventStore(freshRoot());
    await expect(store.appendEvents("gate-a", [unsafePathV1Event("gate-a")])).rejects.toThrow(
      "review_gate_event_unsafe_string",
    );
    store.close();
  });

  it("rejects codec-invalid V2 events on publication", async () => {
    const store = createReviewGateEventStore(freshRoot());
    const broken: ReviewGateJournalEventInput = withRogueField(verifiedV2Event("gate-a"));
    await expect(
      store.publishEvents("gate-a", [broken], await store.readFrontierHash("gate-a")),
    ).rejects.toThrow("review_gate_event_schema_invalid");
    expect(await store.readVerifiedEvents("gate-a")).toHaveLength(0);
    store.close();
  });

  it("rejects a publication bound to a different gate", async () => {
    const store = createReviewGateEventStore(freshRoot());
    await expect(
      store.publishEvents("gate-a", [gateCreatedEvent("gate-b")], await store.readFrontierHash("gate-a")),
    ).rejects.toThrow("review_gate_event_gate_mismatch");
    store.close();
  });
});

describe("ReviewGateEventStore — torn-append and crash recovery (Task 6)", () => {
  it("fails closed on a torn trailing append", async () => {
    const root = freshRoot();
    const store = createReviewGateEventStore(root);
    await store.appendEvents("gate-a", [gateCreatedEvent("gate-a")]);
    store.close();
    await appendFile(eventsFilePath(root, "gate-a"), '{"eventType":"DESIGN_CL');

    const reopened = createReviewGateEventStore(root);
    await expect(reopened.readEvents("gate-a")).rejects.toThrow("review_gate_journal_torn_tail");
    await expect(reopened.appendEvents("gate-a", [designClearEvent("gate-a")])).rejects.toThrow(
      "review_gate_journal_torn_tail",
    );
    await expect(reopened.readFrontierHash("gate-a")).rejects.toThrow("review_gate_journal_torn_tail");
    reopened.close();
  });

  it("recovers a torn tail, keeps committed events, and re-enables publication", async () => {
    const root = freshRoot();
    const store = createReviewGateEventStore(root);
    await store.appendEvents("gate-a", [gateCreatedEvent("gate-a")]);
    const committedFrontier = await store.readFrontierHash("gate-a");
    store.close();
    await appendFile(eventsFilePath(root, "gate-a"), '{"eventType":"DESIGN_CL');

    const reopened = createReviewGateEventStore(root);
    const recovery = await reopened.recoverJournal("gate-a");
    expect(recovery.status).toBe("recovered");
    expect(recovery.eventCount).toBe(1);
    expect(recovery.frontierHash).toBe(committedFrontier);

    expect(await reopened.readEvents("gate-a")).toHaveLength(1);
    const healedBytes = await readFile(eventsFilePath(root, "gate-a"), "utf8");
    expect(healedBytes).toBe(
      `${encodeReviewGateEventRecord(validateReviewGateEventRecord(gateCreatedEvent("gate-a")))}\n`,
    );

    const published = await reopened.publishEvents(
      "gate-a",
      [designClearEvent("gate-a")],
      committedFrontier,
    );
    expect(published.eventCount).toBe(2);
    reopened.close();
  });

  it("reports a healthy journal as clean without rewriting it", async () => {
    const root = freshRoot();
    const store = createReviewGateEventStore(root);
    await store.appendEvents("gate-a", [gateCreatedEvent("gate-a")]);
    const bytesBefore = await readFile(eventsFilePath(root, "gate-a"), "utf8");
    const frontier = await store.readFrontierHash("gate-a");

    const recovery = await store.recoverJournal("gate-a");

    expect(recovery).toEqual({ status: "clean", eventCount: 1, frontierHash: frontier });
    expect(await readFile(eventsFilePath(root, "gate-a"), "utf8")).toBe(bytesBefore);
    store.close();
  });

  it("recovers an unseen gate as a clean empty journal", async () => {
    const store = createReviewGateEventStore(freshRoot());
    expect(await store.recoverJournal("gate-a")).toEqual({
      status: "clean",
      eventCount: 0,
      frontierHash: SHA256_OF_EMPTY,
    });
    store.close();
  });

  it("fails closed on a corrupt complete line and never repairs it", async () => {
    const root = freshRoot();
    const store = createReviewGateEventStore(root);
    await store.appendEvents("gate-a", [gateCreatedEvent("gate-a")]);
    store.close();
    const ledger = eventsFilePath(root, "gate-a");
    const bytesBefore = await readFile(ledger, "utf8");
    await writeFile(ledger, `${bytesBefore}{corrupt bytes\n`, "utf8");

    const reopened = createReviewGateEventStore(root);
    await expect(reopened.readEvents("gate-a")).rejects.toThrow("review_gate_journal_corrupt");
    await expect(reopened.recoverJournal("gate-a")).rejects.toThrow("review_gate_journal_corrupt");
    // Fail-closed recovery leaves the corrupt bytes untouched.
    expect(await readFile(ledger, "utf8")).toBe(`${bytesBefore}{corrupt bytes\n`);
    reopened.close();
  });

  it("never promotes a crashed temporary file and sweeps it during recovery", async () => {
    const root = freshRoot();
    const store = createReviewGateEventStore(root);
    await store.appendEvents("gate-a", [gateCreatedEvent("gate-a")]);
    store.close();
    const gateDir = path.join(root, ".justice", "review-gates", "gate-a");
    // Simulate a crash between the temp write and the atomic rename.
    await writeFile(path.join(gateDir, `events.jsonl.${randomUUID()}.tmp`), '{"partial', "utf8");

    const reopened = createReviewGateEventStore(root);
    // The journal itself was never touched by the crashed write.
    expect(await reopened.readEvents("gate-a")).toHaveLength(1);
    const recovery = await reopened.recoverJournal("gate-a");
    expect(recovery.status).toBe("clean");
    const files = await readdir(gateDir);
    expect(files.filter((name) => name.endsWith(".tmp"))).toEqual([]);
    reopened.close();
  });
});
