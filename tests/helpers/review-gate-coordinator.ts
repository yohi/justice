/**
 * Test harness for the Review Gate coordinator (Task 12).
 *
 * Builds a real `createReviewGateCoordinator` wired to in-memory stores so the
 * event-sourced loop is exercised end-to-end without touching the real disk.
 */

import { createHash } from "node:crypto";
import type {
  DurableReviewGateEventStore,
  ReviewGateDispatchRecordV1,
  ReviewGateEventStore,
  ReviewGateV2Journal,
} from "../../src/runtime/review-gate-event-store";
import type { AdmissionOwnedWitness } from "../../src/runtime/review-gate-admission-context";
import type { PublicationCommitInput, PublicationCommitResult } from "../../src/runtime/review-gate-witness-contracts";
import { computeArtifactDigest } from "../../src/core/review-gate/identity";
import {
  encodeReviewGateEventRecord,
  validateReviewGateEventRecord,
  type VerifiedReviewGateEvent,
} from "../../src/core/review-gate/event-schema";
import { createReviewGateLockManager } from "../../src/runtime/review-gate-lock-manager";
import { createReviewGateApprovalLookup } from "../../src/runtime/review-gate-approval";
import { createReviewGateProtocolDescriptor } from "../../src/runtime/review-gate-protocol";
import {
  createReviewGateCoordinator,
  type ReviewGateMutationSubstrate,
  type ReviewGateWorkspaceReader,
} from "../../src/runtime/review-gate-coordinator";
import type { ReviewGateEvent } from "../../src/core/review-gate-types";

type InMemoryGateData = {
  readonly events: ReviewGateEvent[];
  /** Task 18 — durable chained V2 journal records. */
  readonly v2Events: VerifiedReviewGateEvent[];
  readonly dispatches: ReviewGateDispatchRecordV1[];
};

export type InMemoryReviewGateEventStore = ReviewGateEventStore & Pick<DurableReviewGateEventStore, "prepareAdmittedGenerationPublication"> & {
  readonly writerId: string;
  readonly gates: () => ReadonlyMap<string, InMemoryGateData>;
  readonly commitPreparedPublicationCAS: (input: PublicationCommitInput) => Promise<PublicationCommitResult>;
};

export function createInMemoryReviewGateEventStore(): InMemoryReviewGateEventStore {
  const gates = new Map<string, InMemoryGateData>();
  const scopeIndex = new Map<string, string>();
  const preparedEvents = new Map<string, Readonly<{
    readonly events: readonly VerifiedReviewGateEvent[];
    readonly expectedGlobalFrontier: string;
    readonly expectedWriterHash: string;
  }>>();
  const committedPublications = new Set<string>();

  const store: InMemoryReviewGateEventStore = {
    writerId: "test-writer-authority",
    gates: () => gates,
    appendEvents: async (gateId, events) => {
      const data = gates.get(gateId) ?? { events: [], v2Events: [], dispatches: [] };
      gates.set(gateId, { ...data, events: [...data.events, ...events] });
    },
    /** Task 18 — chained V2 journal append with the same fail-closed rules. */
    appendV2Events: async (gateId, batch) => {
      if (batch.length === 0) throw new Error("review_gate_event_batch_empty");
      const data = gates.get(gateId) ?? { events: [], v2Events: [], dispatches: [] };
      const seen = new Set(data.v2Events.map((event) => event.eventId));
      const next: VerifiedReviewGateEvent[] = [];
      const tailEventId = data.v2Events.at(-1)?.eventId ?? null;
      for (const event of batch) {
        const verified = validateReviewGateEventRecord(structuredClone(event));
        if (!("schemaVersion" in verified) || verified.schemaVersion !== 2) {
          throw new Error("review_gate_event_v2_required");
        }
        if (verified.gateId !== gateId) {
          throw new Error("review_gate_event_gate_mismatch");
        }
        if (seen.has(verified.eventId)) {
          throw new Error("review_gate_v2_journal_event_id_conflict");
        }
        if (next.length === 0 && tailEventId !== null && verified.parentEventId !== tailEventId) {
          throw new Error("review_gate_v2_journal_chain_invalid");
        }
        if (next.length > 0) {
          const prior = next.at(-1) as VerifiedReviewGateEvent;
          if (verified.parentEventId !== prior.eventId) {
            throw new Error("review_gate_v2_journal_chain_invalid");
          }
        }
        seen.add(verified.eventId);
        next.push(verified);
      }
      gates.set(gateId, { ...data, v2Events: [...data.v2Events, ...next] });
    },
    readV2Journal: async (gateId): Promise<ReviewGateV2Journal> => {
      const data = gates.get(gateId);
      const events = data?.v2Events ?? Object.freeze([]);
      const frontierHash = events.length === 0
        ? createHash("sha256").update("").digest("hex")
        : createHash("sha256")
          .update(`${events.map(encodeReviewGateEventRecord).join("\n")}\n`)
          .digest("hex");
      return Object.freeze({
        events,
        frontierHash,
        tailEventId: events.at(-1)?.eventId ?? null,
        eventCount: events.length,
      });
    },
    readEvents: async (gateId) => gates.get(gateId)?.events ?? [],
    readVerifiedEvents: async (gateId) => gates.get(gateId)?.v2Events ?? [],
    recordDispatch: async (gateId, dispatch) => {
      const data = gates.get(gateId) ?? { events: [], v2Events: [], dispatches: [] };
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
    listGateIds: async () => [...gates.keys()].sort((left, right) => left.localeCompare(right)),
    prepareAdmittedGenerationPublication: async (input, owned: AdmissionOwnedWitness) => {
      const frontier = await owned.readVerifiedFrontier();
      const scope = input.membership.authorization.scope;
      const event = input.canonicalEvents[0];
      if (event === undefined || event.eventType !== "GATE_CREATED" || !("schemaVersion" in event) || event.schemaVersion !== 2) {
        throw new Error("review_gate_test_admitted_creation_event_invalid");
      }
      const writerHeadHash = computeArtifactDigest(
        Buffer.from(`${encodeReviewGateEventRecord(event)}\n`, "utf8"),
      );
      if (writerHeadHash !== input.membership.writerHead.hash) {
        throw new Error("review_gate_test_admitted_creation_writer_hash_invalid");
      }
      preparedEvents.set(input.operationId, {
        events: input.canonicalEvents,
        expectedGlobalFrontier: input.membership.authorization.expectedWorkspaceFrontier,
        expectedWriterHash: "0".repeat(64),
      });
      return {
        installationId: input.membership.authorization.installationId,
        workspaceIdentity: input.membership.authorization.workspaceIdentity,
        scopeId: input.scopeId,
        gateId: input.gateId,
        writerId: input.writerId,
        operationId: input.operationId,
        publicationId: input.operationId,
        expectedInstallationFrontier: frontier.globalFrontierHash,
        expectedGlobalFrontier: input.membership.authorization.expectedWorkspaceFrontier,
        expectedWriterSequence: 0,
        expectedWriterHash: "0".repeat(64),
        newWriterSequence: input.membership.writerHead.sequence,
        newWriterHash: input.membership.writerHead.hash,
        canonicalShardPath: `${input.scopeId}/${input.gateId}/${input.writerId}`,
        newTailLength: Buffer.byteLength(`${encodeReviewGateEventRecord(event)}\n`, "utf8"),
        newTailDigest: writerHeadHash,
        newGlobalFrontier: frontier.globalFrontierHash,
        firstEnrollmentAuthorizationId: input.decision.kind === "CREATE_GENESIS" ? input.decision.enrollmentAuthorizationEventId : null,
        payloadSchemaVersion: 1,
        nextFrontier: {
          ...frontier,
          scopes: [...frontier.scopes.filter((entry) => entry.scopeId !== scope.scopeId), scope],
          writerHeads: [...frontier.writerHeads, {
            scopeId: input.scopeId,
            gateId: input.gateId,
            writerId: input.writerId,
            sequence: input.membership.writerHead.sequence,
            hash: input.membership.writerHead.hash,
          }],
        },
      };
    },
    commitPreparedPublicationCAS: async ({ publicationId, expectedGlobalFrontier, expectedWriterHash }) => {
      if (committedPublications.has(publicationId)) return "already_committed";
      const prepared = preparedEvents.get(publicationId);
      if (
        prepared === undefined ||
        prepared.expectedGlobalFrontier !== expectedGlobalFrontier ||
        prepared.expectedWriterHash !== expectedWriterHash
      ) return "blocked";
      const batch = prepared.events;
      const first = batch[0];
      if (first === undefined || first.eventType !== "GATE_CREATED" || !("schemaVersion" in first) || first.schemaVersion !== 2) {
        return "blocked";
      }
      await store.appendV2Events(first.gateId, batch);
      await store.appendEvents(first.gateId, [{
        eventType: "GATE_CREATED",
        gateId: first.gateId as ReviewGateEvent["gateId"],
        writerId: first.writerId as ReviewGateEvent["writerId"],
        epochId: first.epochId as ReviewGateEvent["epochId"],
        emittedAt: first.emittedAt,
        payload: {
          reviewScopeId: first.payload.reviewScopeId,
          designArtifact: first.payload.designArtifact,
          planArtifact: first.payload.planArtifact,
          requirementsResolution: {
            source: first.payload.requirementsResolution.source === "design_declared_reference" ? "auto_design_reference" : "explicit",
            canonicalPath: first.payload.requirementsResolution.canonicalPath,
            digest: first.payload.requirementsResolution.digest,
          },
          reviewProtocolFingerprint: first.payload.reviewProtocolFingerprint,
        },
      }]);
      committedPublications.add(publicationId);
      preparedEvents.delete(publicationId);
      return "advanced";
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

export type TestReviewGateServices = {
  /** The ONE shared in-memory event store behind both services. */
  readonly eventStore: InMemoryReviewGateEventStore;
  readonly coordinator: ReturnType<typeof createReviewGateCoordinator>;
  readonly approval: ReturnType<typeof createReviewGateApprovalLookup>;
};

/**
 * Task 14 harness: build the coordinator and the durable approval lookup over
 * the SAME in-memory event store — never a second store — mirroring the
 * shared runtime graph assembled by the OpenCode adapter.
 */
export function createTestReviewGateServices(
  options: TestReviewGateCoordinatorOptions,
): TestReviewGateServices {
  idCounter += 1;
  const prefix = `test${idCounter}`;
  let serial = 0;
  const eventStore = createInMemoryReviewGateEventStore();
  const protocol = createReviewGateProtocolDescriptor();
  const workspaceReader = createMapReviewWorkspaceReader(options.files);
  const coordinator = createReviewGateCoordinator({
    eventStore,
    lockManager: createReviewGateLockManager(`/nonexistent-justice-test-root/${prefix}`, {
      provider: null,
    }),
    protocol,
    workspaceReader,
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
  const approval = createReviewGateApprovalLookup({
    eventStore,
    workspaceReader,
    protocol,
  });
  return { eventStore, coordinator, approval };
}

export function createTestReviewGateCoordinator(options: TestReviewGateCoordinatorOptions) {
  return createTestReviewGateServices(options).coordinator;
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
