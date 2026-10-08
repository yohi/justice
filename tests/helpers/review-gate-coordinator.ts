/**
 * Test harness for the Review Gate coordinator (Task 12).
 *
 * Builds a real `createReviewGateCoordinator` wired to in-memory stores so the
 * event-sourced loop is exercised end-to-end without touching the real disk.
 */

import type {
  ReviewGateDispatchRecordV1,
  ReviewGateEventStore,
} from "../../src/runtime/review-gate-event-store";
import { createReviewGateLockManager } from "../../src/runtime/review-gate-lock-manager";
import { createReviewGateProtocolDescriptor } from "../../src/runtime/review-gate-protocol";
import {
  createReviewGateCoordinator,
  type ReviewGateMutationSubstrate,
  type ReviewGateWorkspaceReader,
} from "../../src/runtime/review-gate-coordinator";
import type { ReviewGateEvent } from "../../src/core/review-gate-types";

type InMemoryGateData = {
  readonly events: ReviewGateEvent[];
  readonly dispatches: ReviewGateDispatchRecordV1[];
};

export type InMemoryReviewGateEventStore = ReviewGateEventStore & {
  readonly gates: () => ReadonlyMap<string, InMemoryGateData>;
};

export function createInMemoryReviewGateEventStore(): InMemoryReviewGateEventStore {
  const gates = new Map<string, InMemoryGateData>();
  const scopeIndex = new Map<string, string>();

  const store: InMemoryReviewGateEventStore = {
    gates: () => gates,
    appendEvents: async (gateId, events) => {
      const data = gates.get(gateId) ?? { events: [], dispatches: [] };
      gates.set(gateId, { ...data, events: [...data.events, ...events] });
    },
    readEvents: async (gateId) => gates.get(gateId)?.events ?? [],
    recordDispatch: async (gateId, dispatch) => {
      const data = gates.get(gateId) ?? { events: [], dispatches: [] };
      const existing = data.dispatches.find((record) => record.operationId === dispatch.operationId);
      if (existing !== undefined) {
        if (
          existing.dispatchId !== dispatch.dispatchId ||
          existing.operation !== dispatch.operation ||
          existing.phase !== dispatch.phase ||
          existing.dispatchedAt !== dispatch.dispatchedAt
        ) {
          throw new Error("review_gate_dispatch_conflict");
        }
        return;
      }
      gates.set(gateId, { ...data, dispatches: [...data.dispatches, dispatch] });
    },
    markDispatchCompleted: async (gateId, operationId) => {
      const data = gates.get(gateId);
      if (data === undefined) throw new Error("review_gate_dispatch_unknown");
      let completed = false;
      const next = data.dispatches.map((record) => {
        if (record.operationId !== operationId) return record;
        if (record.completedAt !== null) {
          completed = true;
          return record;
        }
        completed = true;
        return { ...record, completedAt: "2026-10-08T00:09:00.000Z" };
      });
      if (!completed) throw new Error("review_gate_dispatch_unknown");
      gates.set(gateId, { ...data, dispatches: next });
    },
    listDispatches: async (gateId) => gates.get(gateId)?.dispatches ?? [],
    readScopeIndex: async (reviewScopeId) => scopeIndex.get(reviewScopeId) ?? null,
    writeScopeIndex: async (reviewScopeId, gateId) => {
      scopeIndex.set(reviewScopeId, gateId);
    },
    close: () => undefined,
  };
  return store;
}

/** Files-backed reader over an in-memory map; no real disk access. */
export function createMapReviewWorkspaceReader(
  files: Map<string, string>,
): ReviewGateWorkspaceReader {
  return {
    readWorkspaceFile: async (path) => {
      const content = files.get(path);
      return content === undefined ? null : Buffer.from(content, "utf8");
    },
  };
}

let idCounter = 0;

export type TestReviewGateCoordinatorOptions = {
  readonly files: Map<string, string>;
  readonly inspectTargets?: (
    paths: readonly string[],
  ) => Promise<ReadonlyMap<string, "clean_committed" | "known_dirty" | "mutation_in_flight">>;
  readonly mutationSubstrate?: ReviewGateMutationSubstrate | null;
};

export function createTestReviewGateCoordinator(options: TestReviewGateCoordinatorOptions) {
  idCounter += 1;
  const prefix = `test${idCounter}`;
  let serial = 0;
  return createReviewGateCoordinator({
    eventStore: createInMemoryReviewGateEventStore(),
    lockManager: createReviewGateLockManager(`/nonexistent-justice-test-root-${prefix}`, {
      provider: null,
    }),
    protocol: createReviewGateProtocolDescriptor(),
    workspaceReader: createMapReviewWorkspaceReader(options.files),
    mutationSubstrate: options.mutationSubstrate ?? null,
    inspectTargets:
      options.inspectTargets ??
      (async (paths) => new Map(paths.map((path) => [path, "clean_committed" as const]))),
    now: () => {
      serial += 1;
      return new Date(Date.UTC(2026, 9, 8, 0, 0, serial)).toISOString();
    },
    newId: (() => {
      let n = 0;
      return () => {
        n += 1;
        return `${prefix}-id-${n}`;
      };
    })(),
    newWriterId: () => `${prefix}-writer`,
  });
}

/** Parse the operation payload object appended after the packet marker. */
export function parsePacketPayload(
  workerPrompt: string,
): Record<string, unknown> {
  const markerIndex = workerPrompt.indexOf("[JUSTICE: REVIEW GATE OPERATION PAYLOAD]");
  if (markerIndex < 0) throw new Error("packet payload marker not found");
  const payloadStart = workerPrompt.indexOf("{", markerIndex);
  const payloadEnd = workerPrompt.indexOf("\n", payloadStart);
  const payloadText = (
    payloadEnd < 0 ? workerPrompt.slice(payloadStart) : workerPrompt.slice(payloadStart, payloadEnd)
  ).trim();
  const parsed: unknown = JSON.parse(payloadText);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("packet payload is not an object");
  }
  return parsed as Record<string, unknown>;
}

/** Parse the `\[JUSTICE: REVIEW GATE NEXT OPERATION\]/NEXT TASK` JSON arguments. */
export function parseNextTaskArgs(
  raw: string,
): Record<string, unknown> {
  const markerIndex = raw.lastIndexOf("[JUSTICE: REVIEW GATE NEXT TASK]");
  if (markerIndex < 0) throw new Error("next task marker not found");
  const jsonLine = raw
    .slice(markerIndex + "[JUSTICE: REVIEW GATE NEXT TASK]".length)
    .trim()
    .split("\n")
    .filter((line) => line.trim().length > 0)[0];
  if (jsonLine === undefined) throw new Error("next task payload not found");
  const parsed: unknown = JSON.parse(jsonLine);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("next task payload is not an object");
  }
  return parsed as Record<string, unknown>;
}
