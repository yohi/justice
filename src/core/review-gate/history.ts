/**
 * Review Gate history display DTOs (convergence Task 13, HQ1).
 *
 * Pure projection builders over a Review Gate event history. The DTO set is
 * the stable application contract for `/justice-review-history`: summary /
 * rounds / findings views plus a generations wrapper for `--all-generations`.
 *
 * Display is strictly read-only: builders never delete, compact, repair, or
 * rewrite retained event history, never expose raw events, and treat storage
 * diagnostics as non-authoritative passthrough display data.
 */

import type {
  EpochId,
  LineageId,
  RemediationRound,
  ReviewGateEpoch,
  ReviewGateEvent,
  ReviewGatePhase,
  ReviewGateStatus,
  FindingState,
} from "../review-gate-types.js";
import type { ReviewGateResumeCursor } from "./types.js";
import { computeCanonicalJsonFingerprint } from "./identity.js";
import { projectReviewGate } from "./projection.js";
import { deriveResumeCursor } from "./resume-cursor.js";

export const REVIEW_HISTORY_DTO_VERSION = 1;

export type ReviewHistoryView = "summary" | "rounds" | "findings";

/**
 * Storage diagnostics: non-authoritative display data only, filled in by the
 * runtime service when durable storage enumeration succeeds.
 */
export type ReviewHistoryStorageDiagnostics = Readonly<{
  readonly gateCount: number;
  readonly completedGates: number;
  readonly activeGates: number;
  readonly suspendedGates: number;
  readonly unreadableGates: number;
  readonly eventCount: number;
  readonly eventBytes: number;
  readonly recoveryObjectCount: number;
  readonly recoveryBytes: number;
  readonly oldestGate: Readonly<{ readonly gateId: string; readonly createdAt: string }> | null;
}>;

export type HistorySummaryDto = Readonly<{
  readonly dtoVersion: typeof REVIEW_HISTORY_DTO_VERSION;
  readonly reviewScopeId: string;
  readonly gateId: string;
  readonly status: ReviewGateStatus;
  readonly phase: ReviewGatePhase;
  readonly epochId: string;
  readonly epochStartedAt: string;
  readonly epochReason: ReviewGateEpoch["reason"];
  /** Design CLEAR authority observed in this generation's history. */
  readonly designClear: Readonly<{
    readonly epochId: EpochId;
    readonly emittedAt: string;
    readonly designProtocolFingerprint: string;
  }> | null;
  readonly blockers: Readonly<{
    readonly remediable: number;
    readonly upstream: number;
    readonly pendingRevalidation: number;
  }>;
  readonly remediationUsage: Readonly<{
    readonly design: Readonly<{ readonly used: number; readonly remaining: number }>;
    readonly plan: Readonly<{ readonly used: number; readonly remaining: number }>;
  }>;
  readonly lastTransition: Readonly<{
    readonly eventType: string;
    readonly epochId: EpochId;
    readonly emittedAt: string;
  }> | null;
  readonly resumeCursor: Readonly<{ readonly kind: ReviewGateResumeCursor["kind"] }>;
  readonly gateRevision: number;
  readonly headEventId: string;
  readonly storage: ReviewHistoryStorageDiagnostics | null;
}>;

export type HistoryRoundsDto = Readonly<{
  readonly dtoVersion: typeof REVIEW_HISTORY_DTO_VERSION;
  readonly reviewScopeId: string;
  readonly gateId: string;
  readonly designRounds: readonly number[];
  readonly planRounds: readonly number[];
}>;

export type HistoryFindingDto = Readonly<{
  readonly lineageId: LineageId;
  readonly findingId: string;
  readonly observedPhase: ReviewGatePhase;
  readonly ownerScope: FindingState["ownerScope"];
  readonly status: FindingState["status"];
  readonly remediationRound: RemediationRound | null;
  readonly reopenedBy: EpochId | null;
  readonly descriptionDigest: string;
}>;

export type HistoryFindingsDto = Readonly<{
  readonly dtoVersion: typeof REVIEW_HISTORY_DTO_VERSION;
  readonly reviewScopeId: string;
  readonly gateId: string;
  readonly findings: readonly HistoryFindingDto[];
}>;

export type HistoryGenerationEntry =
  | Readonly<{ readonly view: "summary"; readonly dto: HistorySummaryDto }>
  | Readonly<{ readonly view: "rounds"; readonly dto: HistoryRoundsDto }>
  | Readonly<{ readonly view: "findings"; readonly dto: HistoryFindingsDto }>;

export type HistoryGenerationsDto = Readonly<{
  readonly dtoVersion: typeof REVIEW_HISTORY_DTO_VERSION;
  readonly reviewScopeId: string;
  readonly view: ReviewHistoryView;
  readonly generations: readonly HistoryGenerationEntry[];
}>;

export type ReviewHistoryDisplayPayload =
  | HistoryGenerationEntry
  | Readonly<{
      readonly view: "generations";
      readonly dto: HistoryGenerationsDto;
    }>;

export type ReviewHistoryFailureKind =
  | "not_found"
  | "conflict"
  | "unsupported_version"
  | "unavailable";

export type ReviewHistoryQueryResult =
  | Readonly<{
      readonly kind: "display";
      readonly payload: ReviewHistoryDisplayPayload;
    }>
  | Readonly<{
      readonly kind: "failure";
      readonly failure: ReviewHistoryFailureKind;
      readonly message: string;
    }>;

const DESIGN_ROUND_LIMIT = 5;
const PLAN_ROUND_LIMIT = 3;

/**
 * Build the stable summary DTO Design defines for HQ1: IDs / status / phase /
 * epoch, Design CLEAR authority, blocker counts, pending revalidation,
 * absolute remediation usage/remaining, last transition, ResumeCursor, and
 * gateRevision/headEventId. Invalid histories throw from the projection, so
 * callers (runtime services) own failure mapping — this builder is pure.
 */
export function buildHistorySummaryDto(options: {
  readonly events: readonly ReviewGateEvent[];
  readonly storage?: ReviewHistoryStorageDiagnostics | undefined;
}): HistorySummaryDto {
  const projection = projectReviewGate(options.events);
  const lastEvent = options.events.at(-1) ?? null;
  const designUsed = projection.designRemediationRounds.length;
  const planUsed = projection.planRemediationRounds.length;

  return Object.freeze({
    dtoVersion: REVIEW_HISTORY_DTO_VERSION,
    reviewScopeId: projection.reviewScopeId,
    gateId: projection.gateId,
    status: projection.status,
    phase: projection.phase,
    epochId: projection.epoch.epochId,
    epochStartedAt: projection.epoch.startedAt,
    epochReason: projection.epoch.reason,
    designClear: projection.effectiveDesignClear,
    blockers: Object.freeze({
      remediable: projection.currentRemediableBlockers.length,
      upstream: projection.currentUpstreamBlockers.length,
      pendingRevalidation: projection.pendingRevalidationBlockers.length,
    }),
    remediationUsage: Object.freeze({
      design: Object.freeze({ used: designUsed, remaining: DESIGN_ROUND_LIMIT - designUsed }),
      plan: Object.freeze({ used: planUsed, remaining: PLAN_ROUND_LIMIT - planUsed }),
    }),
    lastTransition:
      lastEvent === null
        ? null
        : Object.freeze({
            eventType: lastEvent.eventType,
            epochId: lastEvent.epochId,
            emittedAt: lastEvent.emittedAt,
          }),
    resumeCursor: Object.freeze({ kind: deriveResumeCursor(projection).kind }),
    gateRevision: options.events.length,
    headEventId: lastEvent === null ? "" : computeCanonicalJsonFingerprint(lastEvent),
    storage: options.storage ?? null,
  });
}

export function buildHistoryRoundsDto(options: {
  readonly events: readonly ReviewGateEvent[];
}): HistoryRoundsDto {
  const projection = projectReviewGate(options.events);
  return Object.freeze({
    dtoVersion: REVIEW_HISTORY_DTO_VERSION,
    reviewScopeId: projection.reviewScopeId,
    gateId: projection.gateId,
    designRounds: Object.freeze(projection.designRemediationRounds.map((round) => round.ordinal)),
    planRounds: Object.freeze(projection.planRemediationRounds.map((round) => round.ordinal)),
  });
}

export function buildHistoryFindingsDto(options: {
  readonly events: readonly ReviewGateEvent[];
}): HistoryFindingsDto {
  const projection = projectReviewGate(options.events);
  const findings = [...projection.findings.values()].sort((left, right) =>
    left.lineageId.localeCompare(right.lineageId),
  );
  return Object.freeze({
    dtoVersion: REVIEW_HISTORY_DTO_VERSION,
    reviewScopeId: projection.reviewScopeId,
    gateId: projection.gateId,
    findings: Object.freeze(
      findings.map((finding) =>
        Object.freeze({
          lineageId: finding.lineageId,
          findingId: finding.findingId,
          observedPhase: finding.observedPhase,
          ownerScope: finding.ownerScope,
          status: finding.status,
          remediationRound: finding.remediationRound,
          reopenedBy: finding.reopenedBy,
          descriptionDigest: finding.descriptionDigest,
        }),
      ),
    ),
  });
}

/**
 * Build the view-selected DTO for one gate history.
 */
export function buildHistoryView(
  view: ReviewHistoryView,
  options: {
    readonly events: readonly ReviewGateEvent[];
    readonly storage?: ReviewHistoryStorageDiagnostics | undefined;
  },
): HistoryGenerationEntry {
  switch (view) {
    case "summary":
      return Object.freeze({ view, dto: buildHistorySummaryDto(options) });
    case "rounds":
      return Object.freeze({ view, dto: buildHistoryRoundsDto(options) });
    case "findings":
      return Object.freeze({ view, dto: buildHistoryFindingsDto(options) });
  }
}

const truncateId = (value: string, chars: number): string =>
  value.length <= chars ? value : value.slice(0, chars);

function renderSummaryBlock(dto: HistorySummaryDto): string {
  const storage = dto.storage;
  const storageLine =
    storage === null
      ? "storage: unavailable"
      : [
          `storage: gates=${storage.gateCount}`,
          `(active ${storage.activeGates}, suspended ${storage.suspendedGates}, completed ${storage.completedGates}, unreadable ${storage.unreadableGates})`,
          `events=${storage.eventCount}/${storage.eventBytes}B`,
          `recovery=${storage.recoveryObjectCount}/${storage.recoveryBytes}B`,
          storage.oldestGate === null
            ? "oldest=none"
            : `oldest=${storage.oldestGate.gateId}`,
        ].join(" ");

  return [
    SA_HEADER,
    `gateId: ${dto.gateId}`,
    `reviewScopeId: ${dto.reviewScopeId}`,
    `status: ${dto.status}`,
    `phase: ${dto.phase}`,
    `epoch: ${dto.epochId} (${dto.epochReason}, started ${dto.epochStartedAt})`,
    dto.designClear === null
      ? "designClear: none"
      : `designClear: epoch ${dto.designClear.epochId} at ${dto.designClear.emittedAt}`,
    `blockers: remediable=${dto.blockers.remediable}, upstream=${dto.blockers.upstream}`,
    `revalidation pending: ${dto.blockers.pendingRevalidation}`,
    `remediation: design ${dto.remediationUsage.design.used}/${DESIGN_ROUND_LIMIT} (${dto.remediationUsage.design.remaining} remaining), plan ${dto.remediationUsage.plan.used}/${PLAN_ROUND_LIMIT} (${dto.remediationUsage.plan.remaining} remaining)`,
    dto.lastTransition === null
      ? "lastTransition: none"
      : `lastTransition: ${dto.lastTransition.eventType} at ${dto.lastTransition.emittedAt}`,
    `resumeCursor: ${dto.resumeCursor.kind}`,
    `events: ${dto.gateRevision} (head ${truncateId(dto.headEventId, 12)})`,
    storageLine,
  ].join("\n");
}

function renderRoundsBlock(dto: HistoryRoundsDto): string {
  return [
    SA_HEADER,
    `gateId: ${dto.gateId}`,
    `reviewScopeId: ${dto.reviewScopeId}`,
    ...dto.designRounds.map((ordinal) => `design round ${ordinal}`),
    ...dto.planRounds.map((ordinal) => `plan round ${ordinal}`),
  ].join("\n");
}

function renderFindingsBlock(dto: HistoryFindingsDto): string {
  const findingLines =
    dto.findings.length === 0
      ? ["no findings"]
      : dto.findings.map((finding) =>
          [
            `finding ${finding.findingId} (lineage ${finding.lineageId})`,
            `  observed: ${finding.observedPhase}; owner: ${finding.ownerScope}; status: ${finding.status}`,
            `  remediationRound: ${finding.remediationRound === null ? "none" : `${finding.remediationRound.phase} ${finding.remediationRound.ordinal}`}`,
            `  reopenedBy: ${finding.reopenedBy ?? "none"}`,
          ].join("\n"),
        );
  return [
    SA_HEADER,
    `gateId: ${dto.gateId}`,
    `reviewScopeId: ${dto.reviewScopeId}`,
    ...findingLines,
  ].join("\n");
}

const SA_HEADER = "[JUSTICE: REVIEW HISTORY]";

function renderGenerationEntry(entry: HistoryGenerationEntry): string {
  switch (entry.view) {
    case "summary":
      return renderSummaryBlock(entry.dto);
    case "rounds":
      return renderRoundsBlock(entry.dto);
    case "findings":
      return renderFindingsBlock(entry.dto);
  }
}

/**
 * Deterministic read-only display text for one history query result.
 * Generations render one block per generation, in the supplied order.
 */
export function renderHistoryDisplayText(payload: ReviewHistoryDisplayPayload): string {
  switch (payload.view) {
    case "summary":
      return renderSummaryBlock(payload.dto);
    case "rounds":
      return renderRoundsBlock(payload.dto);
    case "findings":
      return renderFindingsBlock(payload.dto);
    case "generations":
      return payload.dto.generations.map((generation) => renderGenerationEntry(generation)).join("\n");
  }
}
