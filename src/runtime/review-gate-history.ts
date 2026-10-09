/**
 * Task 13 — durable `/justice-review-history` query service (runtime).
 *
 * Reuses the Task 12 shared runtime service graph: the ONE durable
 * `ReviewGateEventStore` per workspace plus the recovery layout constant. The
 * service is strictly read-only for Gate state — it acquires no Gate lock,
 * appends no event, performs no validator/artifact resolution, and never
 * deletes, compacts, repairs, or rewrites retained history. Failures fail
 * closed to typed display failures; a partially readable history is never
 * shown.
 *
 * Selection rules (design spec Task 13 steps):
 * - one query captures each gate's event bytes exactly once and projects one
 *   coherent prefix (attribution, selection, diagnostics, and display all
 *   consume the same captured snapshots),
 * - a unique ACTIVE/SUSPENDED tip is the default target; otherwise the newest
 *   completed chain tip; multiple ACTIVE/SUSPENDED tips, or an unreadable
 *   recorded tip, conflict and nothing is displayed,
 * - `--gate <gateId>` locates its gate namespace by enumeration (the namespace
 *   names are never decoded for membership),
 * - unknown event types surface as an unsupported-version failure (the Phase C
 *   versioned envelope seam).
 */

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type {
  ReviewGateEvent,
  ReviewGateStatus,
  ReviewScopeId,
} from "../core/review-gate-types";
import type { ReviewGateProjection } from "../core/review-gate/types";
import { canonicalizeArtifactPath, computeReviewScopeId } from "../core/review-gate/identity";
import { projectReviewGate } from "../core/review-gate/projection";
import {
  buildHistoryView,
  type HistoryGenerationEntry,
  type HistoryGenerationsDto,
  type ReviewHistoryDisplayPayload,
  type ReviewHistoryFailureKind,
  type ReviewHistoryQueryResult,
  type ReviewHistoryStorageDiagnostics,
  type ReviewHistoryView,
} from "../core/review-gate/history";
import { REVIEW_GATE_RECOVERY_DIR } from "./review-gate-recovery-store";
import type { ReviewGateEventStore } from "./review-gate-event-store";

const KNOWN_EVENT_TYPES: ReadonlySet<string> = new Set([
  "GATE_CREATED",
  "ORCHESTRATION_RESUMED",
  "DESIGN_CLEAR",
  "PLAN_CLEAR",
  "REOPEN_REQUIRED",
  "ROUND_LIMIT_EXHAUSTED",
  "REVIEW_NON_CONVERGENT",
  "EXECUTION_SUSPENDED",
  "FINDING_DISCOVERED",
  "FINDING_REMEDIATED",
  "FINDING_SELF_REVIEWED",
  "FINDING_REOPENED",
  "COMPLETED_APPROVAL_BINDING",
]);

export interface ReviewGateHistoryOptions {
  readonly rootDir: string;
  readonly eventStore: ReviewGateEventStore;
}

export interface ReviewGateHistoryService {
  /** `/justice-review-history --design <path> --plan <path> [...]` */
  readonly queryScope: (
    designPath: string,
    planPath: string,
    options: Readonly<{ readonly view: ReviewHistoryView; readonly allGenerations: boolean }>,
  ) => Promise<ReviewHistoryQueryResult>;
  /** `/justice-review-history --gate <gateId> [...]` */
  readonly queryGate: (
    gateId: string,
    options: Readonly<{ readonly view: ReviewHistoryView }>,
  ) => Promise<ReviewHistoryQueryResult>;
}

interface AttributedGate {
  readonly inspectKind: "attributed";
  readonly gateId: string;
  readonly events: readonly ReviewGateEvent[];
  readonly scopeId: ReviewScopeId;
  readonly projection: ReviewGateProjection;
}

type GateInspection =
  | AttributedGate
  | Readonly<{ inspectKind: "empty"; gateId: string }>
  | Readonly<{
      readonly inspectKind: "unreadable";
      readonly gateId: string;
    }>
  | Readonly<{
      readonly inspectKind: "unknown_event_type";
      readonly gateId: string;
      readonly events: readonly ReviewGateEvent[];
      readonly scopeId: ReviewScopeId;
    }>
  | Readonly<{
      readonly inspectKind: "broken";
      readonly gateId: string;
      readonly events: readonly ReviewGateEvent[];
      readonly scopeId: ReviewScopeId | null;
    }>;

function failure(
  failureKind: ReviewHistoryFailureKind,
  message: string,
): ReviewHistoryQueryResult {
  return Object.freeze({ kind: "failure" as const, failure: failureKind, message });
}

/**
 * Create the shared Review Gate history service. Every read goes through the
 * injected event store — this factory never constructs a store of its own.
 */
export function createReviewGateHistoryService(
  options: ReviewGateHistoryOptions,
): ReviewGateHistoryService {
  const { rootDir, eventStore } = options;

  const inspectGate = async (gateId: string): Promise<GateInspection> => {
    let events: readonly ReviewGateEvent[];
    try {
      events = await eventStore.readEvents(gateId);
    } catch {
      return Object.freeze({ inspectKind: "unreadable" as const, gateId });
    }
    if (events.length === 0) return Object.freeze({ inspectKind: "empty" as const, gateId });
    const genesis = events[0];
    if (genesis === undefined || genesis.eventType !== "GATE_CREATED") {
      return Object.freeze({ inspectKind: "broken" as const, gateId, events, scopeId: null });
    }
    const scopeId = genesis.payload.reviewScopeId;
    if (events.some((event) => !KNOWN_EVENT_TYPES.has(event.eventType))) {
      return Object.freeze({
        inspectKind: "unknown_event_type" as const,
        gateId,
        events,
        scopeId,
      });
    }
    try {
      const projection = projectReviewGate(events);
      return Object.freeze({
        inspectKind: "attributed" as const,
        gateId,
        events,
        scopeId,
        projection,
      });
    } catch {
      return Object.freeze({ inspectKind: "broken" as const, gateId, events, scopeId });
    }
  };

  const inspectAllGates = async (): Promise<{
    readonly gateIds: readonly string[];
    readonly inspections: ReadonlyMap<string, GateInspection>;
  }> => {
    const gateIds = await eventStore.listGateIds();
    const inspections = new Map<string, GateInspection>();
    for (const gateId of gateIds) {
      inspections.set(gateId, await inspectGate(gateId));
    }
    return Object.freeze({ gateIds, inspections });
  };

  const genesisAt = (
    inspections: ReadonlyMap<string, GateInspection>,
    gateId: string,
  ): string => {
    const events = inspectableEvents(inspections, gateId);
    return events[0]?.emittedAt ?? "";
  };

  const inspectableEvents = (
    inspections: ReadonlyMap<string, GateInspection>,
    gateId: string,
  ): readonly ReviewGateEvent[] => {
    const inspection = inspections.get(gateId);
    if (inspection === undefined || inspection.inspectKind === "empty") return [];
    if (inspection.inspectKind === "unreadable") return [];
    return inspection.events;
  };

  const paneFor = (
    view: ReviewHistoryView,
    events: readonly ReviewGateEvent[],
    storage: ReviewHistoryStorageDiagnostics,
  ): HistoryGenerationEntry => buildHistoryView(view, { events, storage });

  const computeStorageDiagnostics = (
    gateIds: readonly string[],
    inspections: ReadonlyMap<string, GateInspection>,
  ): ReviewHistoryStorageDiagnostics => {
    let eventCount = 0;
    let eventBytes = 0;
    let completed = 0;
    let active = 0;
    let suspended = 0;
    let unreadable = 0;
    let oldestGate: Readonly<{ readonly gateId: string; readonly createdAt: string }> | null = null;

    for (const gateId of gateIds) {
      const inspection = inspections.get(gateId);
      if (inspection === undefined || inspection.inspectKind === "empty") {
        unreadable += 1;
        continue;
      }
      if (inspection.inspectKind === "unreadable") {
        unreadable += 1;
        continue;
      }
      for (const event of inspection.events) {
        eventCount += 1;
        eventBytes += Buffer.byteLength(JSON.stringify(event), "utf8");
      }
      const status =
        inspection.inspectKind === "attributed"
          ? inspection.projection.status
          : "unreadable";
      if (status === "unreadable") unreadable += 1;
      else if (status === "completed") completed += 1;
      else if (status === "active") active += 1;
      else suspended += 1;

      const genesis = inspection.events[0];
      if (
        genesis?.eventType === "GATE_CREATED" &&
        (oldestGate === null || genesis.emittedAt < oldestGate.createdAt)
      ) {
        oldestGate = Object.freeze({ gateId, createdAt: genesis.emittedAt });
      }
    }

    let recoveryObjectCount: number;
    let recoveryBytes: number;
    try {
      const recoveryDir = join(rootDir, REVIEW_GATE_RECOVERY_DIR);
      const entries = readdirSync(recoveryDir);
      recoveryObjectCount = entries.length;
      recoveryBytes = 0;
      for (const name of entries) {
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- entries come from readdirSync over the recovery layout
        const stat = statSync(join(recoveryDir, name));
        if (stat.isFile()) recoveryBytes += stat.size;
      }
    } catch {
      recoveryObjectCount = 0;
      recoveryBytes = 0;
    }

    return Object.freeze({
      gateCount: gateIds.length,
      completedGates: completed,
      activeGates: active,
      suspendedGates: suspended,
      unreadableGates: unreadable,
      eventCount,
      eventBytes,
      recoveryObjectCount,
      recoveryBytes,
      oldestGate: oldestGate === null ? null : Object.freeze(oldestGate),
    });
  };

  const displayFor = (pane: HistoryGenerationEntry): ReviewHistoryQueryResult =>
    Object.freeze({ kind: "display" as const, payload: pane });

  return {
    queryGate: async (gateId, { view }) => {
      let gateIds: readonly string[];
      let inspections: ReadonlyMap<string, GateInspection>;
      try {
        const enumerated = await inspectAllGates();
        gateIds = enumerated.gateIds;
        inspections = enumerated.inspections;
      } catch {
        return failure("unavailable", "review_history_enumeration_failed");
      }
      if (!gateIds.includes(gateId)) {
        return failure("not_found", `review_history_gate_not_found: ${gateId}`);
      }
      const inspection = inspections.get(gateId);
      if (inspection === undefined || inspection.inspectKind === "empty") {
        return failure("conflict", "review_history_gate_empty");
      }
      if (inspection.inspectKind === "unreadable") {
        return failure("conflict", "review_history_tip_unreadable");
      }
      if (inspection.inspectKind === "unknown_event_type") {
        return failure("unsupported_version", "review_history_event_type_not_supported");
      }
      if (inspection.inspectKind === "broken") {
        return failure("conflict", "review_history_projection_broken");
      }
      const pane = paneFor(
        view,
        inspection.events,
        computeStorageDiagnostics(gateIds, inspections),
      );
      return displayFor(pane);
    },

    queryScope: async (designPath, planPath, { view, allGenerations }) => {
      const canonicalDesign = canonicalizeArtifactPath(designPath);
      const canonicalPlan = canonicalizeArtifactPath(planPath);
      if (canonicalDesign === null || canonicalPlan === null) {
        return failure("conflict", "review_history_invalid_scope_path");
      }

      let gateIds: readonly string[];
      let inspections: ReadonlyMap<string, GateInspection>;
      try {
        const enumerated = await inspectAllGates();
        gateIds = enumerated.gateIds;
        inspections = enumerated.inspections;
      } catch {
        return failure("unavailable", "review_history_enumeration_failed");
      }

      const scopeId: ReviewScopeId = computeReviewScopeId(canonicalDesign, canonicalPlan);
      let primaryGateId: string | null;
      try {
        primaryGateId = await eventStore.readScopeIndex(scopeId);
      } catch {
        primaryGateId = null;
      }

      // Attributable generations of this scope, captured already above.
      const scopedOrder: string[] = [];
      const scopedEvents = new Map<string, readonly ReviewGateEvent[]>();
      for (const gateId of gateIds) {
        const inspection = inspections.get(gateId);
        if (inspection === undefined || inspection.inspectKind === "empty") {
          if (gateId === primaryGateId) {
            return failure("conflict", "review_history_tip_unreadable");
          }
          continue;
        }
        if (inspection.inspectKind === "unreadable") {
          if (gateId === primaryGateId) {
            return failure("conflict", "review_history_tip_unreadable");
          }
          continue;
        }
        const inspectionScopeId: ReviewScopeId | null =
          inspection.inspectKind === "attributed" ||
          inspection.inspectKind === "unknown_event_type"
            ? inspection.scopeId
            : inspection.inspectKind === "broken"
              ? inspection.scopeId
              : null;

        if (inspection.inspectKind === "unknown_event_type") {
          if (inspectionScopeId === scopeId) {
            return failure(
              "unsupported_version",
              "review_history_event_type_not_supported",
            );
          }
          continue;
        }
        if (inspection.inspectKind === "broken") {
          if (inspectionScopeId === null || inspectionScopeId === scopeId || gateId === primaryGateId) {
            return failure("conflict", "review_history_projection_broken");
          }
          continue;
        }
        if (inspectionScopeId === scopeId) {
          scopedOrder.push(gateId);
          scopedEvents.set(gateId, inspection.events);
        }
      }

      if (scopedOrder.length === 0) {
        return failure("not_found", `review_history_no_gate_for_scope: ${scopeId}`);
      }

      // Deterministic oldest → newest chain order (genesis emission time,
      // gateId tie-break).
      scopedOrder.sort((left, right) => {
        const leftAt = genesisAt(inspections, left);
        const rightAt = genesisAt(inspections, right);
        if (leftAt === rightAt) return left.localeCompare(right);
        return leftAt < rightAt ? -1 : 1;
      });

      if (allGenerations) {
        const storage = computeStorageDiagnostics(gateIds, inspections);
        const dto: HistoryGenerationsDto = Object.freeze({
          dtoVersion: 1,
          reviewScopeId: scopeId,
          view,
          generations: Object.freeze(
            scopedOrder
              .map((gateId) => scopedEvents.get(gateId))
              .filter((events): events is readonly ReviewGateEvent[] => events !== undefined)
              .map((events) => paneFor(view, events, storage)),
          ),
        });
        const payload: ReviewHistoryDisplayPayload = Object.freeze({
          view: "generations" as const,
          dto,
        });
        return Object.freeze({ kind: "display" as const, payload });
      }

      const liveStatuses = new Set<ReviewGateStatus>(["active", "suspended"]);
      const liveTips: string[] = [];
      const completedTips: string[] = [];
      for (const gateId of scopedOrder) {
        const inspection = inspections.get(gateId);
        if (inspection === undefined || inspection.inspectKind !== "attributed") continue;
        const status = inspection.projection.status;
        if (liveStatuses.has(status)) liveTips.push(gateId);
        else completedTips.push(gateId);
      }

      if (liveTips.length > 1) {
        return failure("conflict", "review_history_multiple_live_tips");
      }

      // scopedOrder is oldest → newest (genesis emittedAt order); completed
      // tips preserve that order, so the last one is the completed chain tip.
      const targetGateId = liveTips.length === 1 ? liveTips[0] : completedTips.at(-1);
      if (targetGateId === undefined) {
        return liveTips.length === 1
          ? failure("conflict", "review_history_projection_broken")
          : failure("conflict", "review_history_no_selectable_tip");
      }
      const targetEvents = scopedEvents.get(targetGateId);
      if (targetEvents === undefined) {
        return failure("conflict", "review_history_projection_broken");
      }
      const pane = paneFor(view, targetEvents, computeStorageDiagnostics(gateIds, inspections));
      return displayFor(pane);
    },
  };
}
