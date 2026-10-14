/**
 * Task 14/16 — durable approval lookup for implementation authorization.
 *
 * `/justice-implement --approved` is bound to the durable completed approval:
 * the lookup enumerates completed Gate candidates from the shared durable
 * event store (no second Review Gate store/provider is ever created — the
 * store instance is injected by the shared runtime graph). When the injected
 * store exposes the Task 6 verified surface (`readVerifiedScope`), the
 * outcome is decided exclusively by the Task 7 Core admission planner
 * `planReviewGateAdmission` over a Task 16 verified admission snapshot; the
 * runtime never performs an independent equality decision in that path.
 * Stores without the verified surface — and verified-enumerated candidates
 * whose entire completed history is legacy-schema — keep the Task 14 exact
 * structured-binding comparison unchanged.
 *
 * A plan is approved only when exactly one exact current match exists; more
 * than one exact match across scope namespaces is an identity conflict;
 * drifting bindings fail closed.
 *
 * The lookup is strictly read-only: it never appends or publishes events,
 * never records dispatches and never takes a Gate, scope or workspace lock.
 */

import type {
  GateId,
  ReviewApprovalBindingV1,
  ReviewGateEvent,
  ReviewScopeId,
} from "../core/review-gate-types";
import type { VerifiedReviewGateEvent } from "../core/review-gate/event-schema";
import type { VerifiedAdmissionSnapshot } from "../core/review-gate/admission";
import { planReviewGateAdmission } from "../core/review-gate/admission";
import { canonicalizeArtifactPath, computeArtifactDigest } from "../core/review-gate/identity";
import type { ReviewGateWorkspaceReader } from "./review-gate-coordinator";
import type { DurableReviewGateEventStore, ReviewGateEventStore } from "./review-gate-event-store";
import type { ReviewGateProtocolDescriptor } from "./review-gate-protocol";
import { observeVerifiedAdmissionSnapshot } from "./review-gate-admission-snapshot";

/**
 * The durable completed approval binding (the `approvalBinding` payload of a
 * `COMPLETED_APPROVAL_BINDING` event; design spec §CompletedApprovalBindingV1).
 */
export type CompletedApprovalBindingV1 = ReviewApprovalBindingV1;

export type ReviewGateApprovalOutcome =
  | Readonly<{
      readonly kind: "approved";
      readonly gateId: GateId;
      readonly binding: CompletedApprovalBindingV1;
    }>
  | Readonly<{ readonly kind: "not_approved" }>
  | Readonly<{ readonly kind: "identity_conflict" }>
  | Readonly<{ readonly kind: "history_unavailable" }>;

export type CompletedApprovalCandidate = Readonly<{
  readonly gateId: GateId;
  readonly binding: CompletedApprovalBindingV1;
}>;

export interface ReviewGateApprovalLookup {
  /**
   * The design-spec lookup: the exact current match of the durable completed
   * approval binding for one Plan path.
   */
  readonly findCurrentCompletedApproval: (planPath: string) => Promise<ReviewGateApprovalOutcome>;
  /**
   * Arm-gating seam (Task 14 step 3): enumerate the persisted completed
   * approval bindings whose Plan canonical path matches, BEFORE the
   * current-match filter. The implementation-arm flow distinguishes "no
   * Review Gate ever completed for this plan" (legacy flow continues) from
   * "completed history exists but drifts" (fail closed). Throws when durable
   * history enumeration fails so callers fail closed.
   */
  readonly listCompletedApprovalCandidates: (planPath: string) => Promise<
    readonly CompletedApprovalCandidate[]
  >;
}

export interface ReviewGateApprovalOptions {
  readonly eventStore: ReviewGateEventStore;
  readonly workspaceReader: ReviewGateWorkspaceReader;
  readonly protocol: ReviewGateProtocolDescriptor;
  /**
   * Absolute workspace root of the shared runtime graph. Required only for
   * the Task 16 verified admission path over durable stores (Task 18 wires
   * the production graph); without it a verified V2 history fails closed
   * instead of falling back to the legacy comparison.
   */
  readonly workspaceRoot?: string;
}

/** Structural probe: the Task 6 verified surface identifies durable stores. */
const isDurableEventStore = (
  store: ReviewGateEventStore,
): store is DurableReviewGateEventStore =>
  "readVerifiedScope" in store && typeof store.readVerifiedScope === "function";

type VerifiedV2GateEvent = Extract<VerifiedReviewGateEvent, { readonly schemaVersion: 2 }>;

const isV2VerifiedEvent = (event: VerifiedReviewGateEvent): event is VerifiedV2GateEvent =>
  "schemaVersion" in event;

/**
 * One completed Gate candidate enumerated from verified event history.
 * `gateId`/`scopeId` stay plain strings for V2 events (Task 4c envelopes are
 * unbranded) and are branded only at the legacy-contract boundary.
 */
type VerifiedCompletedGateRecord = Readonly<{
  readonly gateId: string;
  readonly scopeId: ReviewScopeId;
  readonly events: readonly VerifiedReviewGateEvent[];
  readonly binding: CompletedApprovalBindingV1;
  readonly isV2History: boolean;
}>;

type ReuseWinner = Readonly<{
  readonly gateId: GateId;
  readonly binding: CompletedApprovalBindingV1;
}>;

/**
 * Create the durable approval lookup. `eventStore` MUST be the one shared
 * Review Gate event store of the workspace graph (Task 12); this factory never
 * constructs a store of its own.
 */
export function createReviewGateApprovalLookup(
  options: ReviewGateApprovalOptions,
): ReviewGateApprovalLookup {
  const { eventStore, workspaceReader, protocol, workspaceRoot } = options;
  const durableStore = isDurableEventStore(eventStore) ? eventStore : null;

  const completedBindingOf = (
    events: readonly ReviewGateEvent[],
  ): CompletedApprovalBindingV1 | null => {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (event === undefined) return null;
      if (event.eventType !== "COMPLETED_APPROVAL_BINDING") continue;
      const binding = event.payload.approvalBinding;
      if (binding === null || binding === undefined) return null;
      return binding;
    }
    return null;
  };

  const completedBindingOfVerified = (
    events: readonly VerifiedReviewGateEvent[],
  ): CompletedApprovalBindingV1 | null => {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (event === undefined) return null;
      if (event.eventType !== "COMPLETED_APPROVAL_BINDING") continue;
      return event.payload.approvalBinding;
    }
    return null;
  };

  const currentDigestMatches = async (persisted: {
    readonly canonicalPath: string;
    readonly digest: string;
  }): Promise<boolean> => {
    const bytes = await workspaceReader.readWorkspaceFile(persisted.canonicalPath);
    if (bytes === null) return false;
    return computeArtifactDigest(bytes) === persisted.digest;
  };

  const exactCurrentMatch = async (binding: CompletedApprovalBindingV1): Promise<boolean> => {
    if (binding.reviewProtocolFingerprint !== protocol.reviewProtocolFingerprint) return false;
    if (!(await currentDigestMatches(binding.requirementsResolution))) return false;
    if (!(await currentDigestMatches(binding.designArtifact))) return false;
    return await currentDigestMatches(binding.planArtifact);
  };

  /** Legacy-store enumeration (Task 14): V1 journals only. */
  const enumerateCandidates = async (
    canonicalPlan: string,
  ): Promise<CompletedApprovalCandidate[]> => {
    const gateIds = await eventStore.listGateIds();
    const candidates: CompletedApprovalCandidate[] = [];
    for (const gateId of gateIds) {
      const events = await eventStore.readEvents(gateId);
      const binding = completedBindingOf(events);
      if (binding === null) continue;
      const bindingPlan = canonicalizeArtifactPath(binding.planArtifact.canonicalPath);
      if (bindingPlan === null || bindingPlan !== canonicalPlan) continue;
      candidates.push(Object.freeze({ gateId: gateId as GateId, binding }));
    }
    return candidates;
  };

  /** Read-only verified enumeration across V1 and V2 completed histories. */
  const enumerateVerifiedCandidates = async (
    store: DurableReviewGateEventStore,
    canonicalPlan: string,
  ): Promise<VerifiedCompletedGateRecord[]> => {
    const gateIds = await store.listGateIds();
    const records: VerifiedCompletedGateRecord[] = [];
    for (const gateId of gateIds) {
      const events = await store.readVerifiedEvents(gateId);
      const genesis = events[0];
      if (genesis === undefined || genesis.eventType !== "GATE_CREATED") continue;
      if (genesis.payload.planArtifact.canonicalPath !== canonicalPlan) continue;
      const binding = completedBindingOfVerified(events);
      if (binding === null) continue;
      records.push(
        Object.freeze({
          gateId: genesis.gateId,
          scopeId: genesis.payload.reviewScopeId,
          events,
          binding,
          isV2History: events.some(isV2VerifiedEvent),
        }),
      );
    }
    return records;
  };

  const toCompletedCandidate = (record: VerifiedCompletedGateRecord): CompletedApprovalCandidate =>
    Object.freeze({ gateId: record.gateId as GateId, binding: record.binding });

  /**
   * The faithful completed-approval binding for one reused Gate: located by
   * its durable V2 approval event id, so `reviewScopeId`, artifacts,
   * requirements, fingerprints, `approvedAt` and gate id are preserved
   * exactly as the witness-committed payload recorded them.
   */
  const approvalBindingById = (
    events: readonly VerifiedReviewGateEvent[],
    approvalEventId: string,
  ): CompletedApprovalBindingV1 | null => {
    for (const event of events) {
      if (event.eventType !== "COMPLETED_APPROVAL_BINDING") continue;
      if (isV2VerifiedEvent(event) && event.eventId === approvalEventId) {
        return event.payload.approvalBinding;
      }
    }
    return null;
  };

  /**
   * Task 16 core path: the Core admission planner decides over the verified
   * admission snapshot; this mapping only translates the Core decision into
   * the legacy lookup outcome kinds.
   */
  const decideWithCorePlanner = async (
    store: DurableReviewGateEventStore,
    records: readonly VerifiedCompletedGateRecord[],
  ): Promise<ReviewGateApprovalOutcome> => {
    if (workspaceRoot === undefined) {
      // A verified V2 history cannot be observed without a workspace root;
      // fail closed instead of silently using the legacy comparison.
      return Object.freeze({ kind: "history_unavailable" as const });
    }

    const verifiableScopes = [
      ...new Set(records.filter((record) => record.isV2History).map((record) => record.scopeId)),
    ].sort();
    const reuses: ReuseWinner[] = [];
    let conflicts = false;
    let failClosed = false;

    for (const scopeId of verifiableScopes) {
      let snapshot: VerifiedAdmissionSnapshot | null;
      try {
        snapshot = await observeVerifiedAdmissionSnapshot({
          workspaceRoot,
          scopeId,
          protocol,
          eventStore: store,
          workspaceReader,
        });
      } catch {
        failClosed = true;
        continue;
      }
      if (snapshot === null) {
        failClosed = true;
        continue;
      }

      const decision = planReviewGateAdmission(snapshot);
      switch (decision.kind) {
        case "REUSE_COMPLETED": {
          const record = records.find((candidate) => candidate.gateId === decision.gateId);
          const binding =
            record === undefined ? null : approvalBindingById(record.events, decision.approvalEventId);
          if (binding === null) {
            failClosed = true;
            break;
          }
          reuses.push(Object.freeze({ gateId: decision.gateId as GateId, binding }));
          break;
        }
        case "CREATE_SUCCESSOR":
        case "REVALIDATE_OR_BLOCK":
          // Drifted or mid-flight tips leave no unique current approval.
          conflicts = true;
          break;
        case "BLOCK":
          if (decision.reason === "conflicting_current_tips") conflicts = true;
          else failClosed = true;
          break;
        case "CREATE_GENESIS":
        case "UPSTREAM_PRECEDENCE_REQUIRED":
        case "STALE_LINEAGE_REVALIDATION_REQUIRED":
        case "INSPECT_NC1_ELIGIBLE_CHANGE":
        case "REENTRY_CANDIDATE":
        case "RESUME":
        case "STAY_SUSPENDED":
          // Other non-reuse decisions are not approvals.
          break;
      }
    }

    // Legacy-parity composition: one exact reuse approves even when unrelated
    // scopes fail closed; two reuses (or a conflicting scope with no reuse)
    // are an identity conflict; unreachable verified history is unavailable.
    if (reuses.length > 1) return Object.freeze({ kind: "identity_conflict" as const });
    const winner = reuses[0];
    if (winner !== undefined) {
      return Object.freeze({
        kind: "approved" as const,
        gateId: winner.gateId,
        binding: winner.binding,
      });
    }
    if (conflicts) return Object.freeze({ kind: "identity_conflict" as const });
    if (failClosed) return Object.freeze({ kind: "history_unavailable" as const });
    return Object.freeze({ kind: "not_approved" as const });
  };

  return {
    findCurrentCompletedApproval: async (planPath: string) => {
      const canonicalPlan = canonicalizeArtifactPath(planPath);
      if (canonicalPlan === null) return Object.freeze({ kind: "not_approved" as const });

      let candidates: readonly CompletedApprovalCandidate[];
      let verifiedRecords: readonly VerifiedCompletedGateRecord[] | null = null;
      try {
        if (durableStore === null) {
          candidates = await enumerateCandidates(canonicalPlan);
        } else {
          verifiedRecords = await enumerateVerifiedCandidates(durableStore, canonicalPlan);
          candidates = verifiedRecords.map(toCompletedCandidate);
        }
      } catch {
        return Object.freeze({ kind: "history_unavailable" as const });
      }
      if (candidates.length === 0) return Object.freeze({ kind: "not_approved" as const });

      if (
        durableStore !== null &&
        verifiedRecords !== null &&
        verifiedRecords.some((record) => record.isV2History)
      ) {
        return await decideWithCorePlanner(durableStore, verifiedRecords);
      }

      // Task 14 exact structured-binding comparison (legacy stores and
      // legacy-schema completed histories).
      const exact: CompletedApprovalCandidate[] = [];
      for (const candidate of candidates) {
        if (await exactCurrentMatch(candidate.binding)) exact.push(candidate);
      }
      if (exact.length === 0) return Object.freeze({ kind: "not_approved" as const });
      if (exact.length > 1) return Object.freeze({ kind: "identity_conflict" as const });

      const winner = exact[0];
      if (winner === undefined) return Object.freeze({ kind: "not_approved" as const });
      return Object.freeze({
        kind: "approved" as const,
        gateId: winner.gateId,
        binding: winner.binding,
      });
    },

    listCompletedApprovalCandidates: async (planPath: string) => {
      const canonicalPlan = canonicalizeArtifactPath(planPath);
      if (canonicalPlan === null) return [];
      const records = durableStore === null
        ? await enumerateCandidates(canonicalPlan)
        : (await enumerateVerifiedCandidates(durableStore, canonicalPlan)).map(toCompletedCandidate);
      return records;
    },
  };
}