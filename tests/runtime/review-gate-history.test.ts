import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { ReviewGateEvent } from "../../src/core/review-gate-types";
import { computeReviewScopeId } from "../../src/core/review-gate/identity";
import {
  createReviewGateEventStore,
  type ReviewGateEventStore,
} from "../../src/runtime/review-gate-event-store";
import { createReviewGateRecoveryStore } from "../../src/runtime/review-gate-recovery-store";
import { createReviewGateHistoryService } from "../../src/runtime/review-gate-history";

const DESIGN_PATH = "docs/design.md";
const PLAN_PATH = "docs/plan.md";
const SCOPE_ID = computeReviewScopeId(DESIGN_PATH, PLAN_PATH);

let currentRoot = "";
const tempRoots: string[] = [];

afterAll(async () => {
  for (const root of tempRoots) {
    await rm(root, { recursive: true, force: true });
  }
});

function freshRoot(): string {
  currentRoot = `${tmpdir()}/justice-task13-history-${Math.random().toString(36).slice(2)}`;
  tempRoots.push(currentRoot);
  return currentRoot;
}

let emitted = 0;
function nextAt(): string {
  emitted += 1;
  return new Date(Date.UTC(2026, 9, 8, 0, 0, emitted)).toISOString();
}

function approvalBinding(planPath: string, digest: string): ReviewGateEvent {
  return {
    eventType: "COMPLETED_APPROVAL_BINDING",
    gateId: "filled-later",
    writerId: "writer-1",
    epochId: "epoch-c",
    emittedAt: nextAt(),
    payload: {
      approvalBinding: {
        reviewScopeId: SCOPE_ID,
        gateId: "filled-later",
        designArtifact: { canonicalPath: DESIGN_PATH, digest: "d", gitMode: "100644" },
        planArtifact: { canonicalPath: planPath, digest, gitMode: "100644" },
        requirementsResolution: { source: "explicit", canonicalPath: "requirements.md", digest: "r" },
        reviewProtocolFingerprint: "f".repeat(64),
        designProtocolFingerprint: "e".repeat(64),
        planProtocolFingerprint: "g".repeat(64),
        approvedAt: "2026-10-08T00:10:00.000Z",
      },
    },
  } as unknown as ReviewGateEvent;
}

function generatedEvents(
  gateId: string,
  scopeId: string,
  extra: readonly ReviewGateEvent[],
): readonly ReviewGateEvent[] {
  const created: ReviewGateEvent = {
    eventType: "GATE_CREATED",
    gateId,
    writerId: "writer-1",
    epochId: "epoch-1",
    emittedAt: nextAt(),
    payload: {
      reviewScopeId: scopeId,
      designArtifact: { canonicalPath: DESIGN_PATH, digest: "d", gitMode: "100644" },
      planArtifact: { canonicalPath: PLAN_PATH, digest: "p", gitMode: "100644" },
      requirementsResolution: { source: "explicit", canonicalPath: "requirements.md", digest: "r" },
      reviewProtocolFingerprint: "f".repeat(64),
    },
  } as unknown as ReviewGateEvent;
  const patched = extra.map((event) =>
    ({ ...event, gateId }) as unknown as ReviewGateEvent,
  );
  return [created, ...patched];
}

function seedGate(
  store: ReviewGateEventStore,
  gateId: string,
  scopeId: string,
  extra: readonly ReviewGateEvent[] = [],
): void {
  void store.appendEvents(gateId, generatedEvents(gateId, scopeId, extra)).then(() => {});
}

function countingProxy(store: ReviewGateEventStore): {
  readonly store: ReviewGateEventStore;
  readonly readCalls: Map<string, number>;
} {
  const readCalls = new Map<string, number>();
  const proxy: ReviewGateEventStore = {
    ...store,
    readEvents: async (gateId) => {
      readCalls.set(gateId, (readCalls.get(gateId) ?? 0) + 1);
      return store.readEvents(gateId);
    },
  };
  return { store: proxy, readCalls };
}

function listWorkspaceFiles(rootDir: string): {
  readonly paths: ReadonlyMap<string, string>;
} {
  const paths = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) walk(full);
      else paths.set(full, readFileSync(full, "utf8"));
    }
  };
  walk(rootDir);
  return { paths };
}

const failureOf = (result: { kind: string }) => result;

import { OpenCodeAdapter } from "../../src/runtime/opencode-adapter";
import { fakeInit } from "../helpers/fake-opencode-init";

describe("OpenCodeAdapter — /justice-review-history wiring", () => {
  it("replaces host parts with the durable history display", async () => {
    const root = freshRoot();
    const store = createReviewGateEventStore(root);
    seedGate(store, "gate-adapter", SCOPE_ID);
    await store.writeScopeIndex(SCOPE_ID, "gate-adapter");

    const adapter = new OpenCodeAdapter(fakeInit({ directory: root, worktree: root }));
    const output = { parts: [{ type: "text", text: "$ARGUMENTS expanded" } as never] };
    await adapter.onCommandExecuteBefore(
      {
        command: "/justice-review-history",
        sessionID: "session-adapter",
        arguments: "--design docs/design.md --plan docs/plan.md",
      },
      output as never,
    );

    expect(output.parts).toHaveLength(1);
    const text = (output.parts[0] as unknown as { text: string }).text;
    expect(text).toContain("[JUSTICE: REVIEW HISTORY]");
    expect(text).toContain("gateId: gate-adapter");
    store.close();
  });

  it("replaces rejected arguments with the canonical rejected directive", async () => {
    const root = freshRoot();
    const adapter = new OpenCodeAdapter(fakeInit({ directory: root, worktree: root }));
    const output = { parts: [{ type: "text", text: "$ARGUMENTS expanded" } as never] };

    await adapter.onCommandExecuteBefore(
      {
        command: "justice-review-history",
        sessionID: "session-adapter",
        arguments: "--gate ../escape",
      },
      output as never,
    );

    const text = (output.parts[0] as unknown as { text: string }).text;
    expect(text).toContain("[JUSTICE: COMMAND REJECTED]");
    expect(text).toContain("/justice-review-history");
  });
});

describe("ReviewGateHistoryService — scope tip selection", () => {
  it("selects a unique ACTIVE tip by default", async () => {
    const root = freshRoot();
    const store = createReviewGateEventStore(root);
    seedGate(store, "gate-gen1", SCOPE_ID, [approvalBinding(PLAN_PATH, "p")]);
    seedGate(store, "gate-gen2", SCOPE_ID);
    await store.writeScopeIndex(SCOPE_ID, "gate-gen2");

    const service = createReviewGateHistoryService({ eventStore: store, rootDir: root });
    const result = await service.queryScope(DESIGN_PATH, PLAN_PATH, { view: "summary", allGenerations: false });

    expect(result.kind).toBe("display");
    if (result.kind !== "display" || result.payload.view !== "summary") throw new Error("unexpected");
    expect(result.payload.dto.gateId).toBe("gate-gen2");
    expect(result.payload.dto.status).toBe("active");
    store.close();
  });

  it("selects the unique completed chain tip when no active/suspended tip exists", async () => {
    const root = freshRoot();
    const store = createReviewGateEventStore(root);
    seedGate(store, "gate-old", SCOPE_ID, [approvalBinding(PLAN_PATH, "older")]);
    seedGate(store, "gate-new", SCOPE_ID, [approvalBinding(PLAN_PATH, "p")]);
    await store.writeScopeIndex(SCOPE_ID, "gate-new");

    const service = createReviewGateHistoryService({ eventStore: store, rootDir: root });
    const result = await service.queryScope(DESIGN_PATH, PLAN_PATH, { view: "summary", allGenerations: false });

    if (result.kind !== "display" || result.payload.view !== "summary") throw new Error(failureOf(result));
    expect(result.payload.dto.gateId).toBe("gate-new");
    expect(result.payload.dto.status).toBe("completed");
    store.close();
  });

  it("reports a conflict for two simultaneous ACTIVE tips of one scope", async () => {
    const root = freshRoot();
    const store = createReviewGateEventStore(root);
    seedGate(store, "gate-a", SCOPE_ID);
    seedGate(store, "gate-b", SCOPE_ID);
    await store.writeScopeIndex(SCOPE_ID, "gate-a");

    const service = createReviewGateHistoryService({ eventStore: store, rootDir: root });
    const result = await service.queryScope(DESIGN_PATH, PLAN_PATH, { view: "summary", allGenerations: false });

    expect(result.kind).toBe("failure");
    expect(result.kind === "failure" ? result.failure : "").toBe("conflict");
    store.close();
  });

  it("returns not_found when no gate namespace exists for the scope", async () => {
    const root = freshRoot();
    const store = createReviewGateEventStore(root);

    const service = createReviewGateHistoryService({ eventStore: store, rootDir: root });
    const result = await service.queryScope(DESIGN_PATH, PLAN_PATH, { view: "summary", allGenerations: false });

    expect(result.kind === "failure" ? result.failure : "").toBe("not_found");
    store.close();
  });

  it("fails closed with a conflict when the scope index points at an unreadable gate", async () => {
    const root = freshRoot();
    const store = createReviewGateEventStore(root);
    await store.writeScopeIndex(SCOPE_ID, "gate-broken");
    // Break the gate ledger with trailing partial bytes.
    const brokenDir = path.join(root, ".justice", "review-gates", "gate-broken");
    mkdirSync(brokenDir, { recursive: true });
    writeFileSync(path.join(brokenDir, "events.jsonl"), '{"eventType": "GATE", "partial"');

    const service = createReviewGateHistoryService({ eventStore: store, rootDir: root });
    const result = await service.queryScope(DESIGN_PATH, PLAN_PATH, { view: "summary", allGenerations: false });

    expect(result.kind).toBe("failure");
    expect(result.kind === "failure" ? result.failure : "").toBe("conflict");
    store.close();
  });
});

describe("ReviewGateHistoryService — gate query", () => {
  it("--gate locates the gate namespace without decoding genesis for membership", async () => {
    const root = freshRoot();
    const store = createReviewGateEventStore(root);
    seedGate(store, "gate-iso", SCOPE_ID);

    const spy = countingProxy(store);
    const service = createReviewGateHistoryService({ eventStore: spy.store, rootDir: root });
    const result = await service.queryGate("gate-iso", { view: "summary" });

    if (result.kind !== "display" || result.payload.view !== "summary") throw new Error(failureOf(result));
    expect(result.payload.dto.gateId).toBe("gate-iso");
    // The query captured the gate shard bytes once and projected one coherent prefix.
    expect(spy.readCalls.get("gate-iso")).toBe(1);
    store.close();
  });

  it("returns not_found for an unknown gate id", async () => {
    const root = freshRoot();
    const store = createReviewGateEventStore(root);
    const service = createReviewGateHistoryService({ eventStore: store, rootDir: root });

    const result = await service.queryGate("gate-missing", { view: "summary" });
    expect(result.kind === "failure" ? result.failure : "").toBe("not_found");
    store.close();
  });

  it("reports a conflict when the gate history is empty", async () => {
    const root = freshRoot();
    const store = createReviewGateEventStore(root);
    mkdirSync(path.join(root, ".justice", "review-gates", "gate-empty"), { recursive: true });

    const service = createReviewGateHistoryService({ eventStore: store, rootDir: root });
    const result = await service.queryGate("gate-empty", { view: "summary" });
    expect(result.kind === "failure" ? result.failure : "").toBe("conflict");
    store.close();
  });
});

describe("ReviewGateHistoryService — views and generations", () => {
  it("renders the requested views without changings shape", async () => {
    const root = freshRoot();
    const store = createReviewGateEventStore(root);
    seedGate(store, "gate-a", SCOPE_ID);

    const service = createReviewGateHistoryService({ eventStore: store, rootDir: root });
    const rounds = await service.queryGate("gate-a", { view: "rounds" });
    const findings = await service.queryGate("gate-a", { view: "findings" });

    expect(rounds.kind === "display" ? rounds.payload.view : "").toBe("rounds");
    expect(findings.kind === "display" ? findings.payload.view : "").toBe("findings");
    store.close();
  });

  it("lists every generation of the scope oldest → newest with --all-generations", async () => {
    const root = freshRoot();
    const store = createReviewGateEventStore(root);
    seedGate(store, "gate-gen1", SCOPE_ID, [approvalBinding(PLAN_PATH, "older")]);
    seedGate(store, "gate-gen2", SCOPE_ID);
    await store.writeScopeIndex(SCOPE_ID, "gate-gen2");

    const service = createReviewGateHistoryService({ eventStore: store, rootDir: root });
    const result = await service.queryScope(DESIGN_PATH, PLAN_PATH, { view: "summary", allGenerations: true });

    expect(result.kind === "display" ? result.payload.view : "").toBe("generations");
    if (result.kind === "display" && result.payload.view === "generations") {
      expect(
        result.payload.dto.generations.map(
          (generation) => (generation as { dto: { gateId: string } }).dto.gateId,
        ),
      ).toEqual(["gate-gen1", "gate-gen2"]);
    }
    store.close();
  });

  it("never mutates durable history across a query", async () => {
    const root = freshRoot();
    const store = createReviewGateEventStore(root);
    seedGate(store, "gate-a", SCOPE_ID);
    await store.writeScopeIndex(SCOPE_ID, "gate-a");
    const before = listWorkspaceFiles(root);

    const service = createReviewGateHistoryService({ eventStore: store, rootDir: root });
    await service.queryScope(DESIGN_PATH, PLAN_PATH, { view: "summary", allGenerations: true });
    await service.queryGate("gate-a", { view: "findings" });

    const after = listWorkspaceFiles(root);
    expect([...after.paths.keys()].sort()).toEqual([...before.paths.keys()].sort());
    for (const [file, bytes] of before.paths) {
      expect(after.paths.get(file)).toBe(bytes);
    }
    store.close();
  });
});

describe("ReviewGateHistoryService — storage diagnostics", () => {
  it("reports non-authoritative counts, bytes, and recovery objects", async () => {
    const root = freshRoot();
    const store = createReviewGateEventStore(root);
    seedGate(store, "gate-a", SCOPE_ID, [approvalBinding(PLAN_PATH, "p")]);
    seedGate(store, "gate-b", computeReviewScopeId("docs/design.md", "docs/other.md"));
    await store.writeScopeIndex(SCOPE_ID, "gate-a");
    const recovery = createReviewGateRecoveryStore(root);
    const bytesOne = Buffer.from("recovery-bytes-1");
    const bytesTwo = Buffer.from("recovery-bytes-22");
    const decodeHex = (bytes: Buffer): string =>
      createHash("sha256").update(bytes).digest("hex");
    await Promise.all([
      recovery.publish(decodeHex(bytesOne), bytesOne),
      recovery.publish(decodeHex(bytesTwo), bytesTwo),
    ]);

    const service = createReviewGateHistoryService({ eventStore: store, rootDir: root });
    const result = await service.queryGate("gate-a", { view: "summary" });

    if (result.kind !== "display" || result.payload.view !== "summary") throw new Error(failureOf(result));
    const storage = result.payload.dto.storage;
    expect(storage).toMatchObject({
      gateCount: 2,
      activeGates: 1,
      completedGates: 1,
      suspendedGates: 0,
      unreadableGates: 0,
      eventCount: 3,
      recoveryObjectCount: 2,
    });
    expect(storage?.eventBytes).toBeGreaterThan(0);
    expect(storage?.recoveryBytes).toBeGreaterThan(0);
    expect(storage?.oldestGate).toMatchObject({ gateId: "gate-a" });
    recovery.close();
    store.close();
  });
});
