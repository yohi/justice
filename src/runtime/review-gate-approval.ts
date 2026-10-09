/**
 * Task 14 — durable approval lookup for implementation authorization.
 *
 * `/justice-implement --approved` is bound to the durable completed approval:
 * the lookup enumerates completed Gate candidates from the Task 12 SHARED
 * durable event store (no second Review Gate store/provider is ever created —
 * the store instance is injected by the shared runtime graph), re-reads the
 * persisted Requirements/Design/Plan canonical paths, computes current SHA-256
 * digests plus the Task 12 production `reviewProtocolFingerprint`, and retains
 * only exact structured-binding matches. A plan is approved only when exactly
 * one exact current match exists; more than one exact match across scope
 * namespaces is an identity conflict; drifting bindings fail closed.
 *
 * The lookup is strictly read-only: a binding mismatch never appends an
 * invalidation event to the stale completed Gate.
 */

import type { GateId, ReviewGateEvent } from "../core/review-gate-types";
import { canonicalizeArtifactPath, computeArtifactDigest } from "../core/review-gate/identity";
import type { ReviewGateWorkspaceReader } from "./review-gate-coordinator";
import type { ReviewGateEventStore } from "./review-gate-event-store";
import type { ReviewGateProtocolDescriptor } from "./review-gate-protocol";
import type { ReviewApprovalBindingV1 } from "../core/review-gate-types";

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
}

/**
 * Create the durable approval lookup. `eventStore` MUST be the one shared
 * Review Gate event store of the workspace graph (Task 12); this factory never
 * constructs a store of its own.
 */
export function createReviewGateApprovalLookup(
  options: ReviewGateApprovalOptions,
): ReviewGateApprovalLookup {
  const { eventStore, workspaceReader, protocol } = options;

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

  return {
    findCurrentCompletedApproval: async (planPath) => {
      const canonicalPlan = canonicalizeArtifactPath(planPath);
      if (canonicalPlan === null) return Object.freeze({ kind: "not_approved" as const });

      let candidates: readonly CompletedApprovalCandidate[];
      try {
        candidates = await enumerateCandidates(canonicalPlan);
      } catch {
        return Object.freeze({ kind: "history_unavailable" as const });
      }

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

    listCompletedApprovalCandidates: (planPath) => {
      const canonicalPlan = canonicalizeArtifactPath(planPath);
      if (canonicalPlan === null) return Promise.resolve([]);
      return enumerateCandidates(canonicalPlan);
    },
  };
}
