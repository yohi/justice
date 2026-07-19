import type { ObservationRecord, ReviewItem } from "./observation-model";
import type { ReviewSummary, ReviewSummaryItem, ScopeReviewSummary } from "./review-types";

type ReviewObservedRecord = Extract<ObservationRecord, { readonly kind: "review_observed" }>;

type AggregatedItem = {
  readonly item: ReviewSummaryItem;
  readonly status: ReviewItem["status"];
};

type MutableScopeState = {
  readonly items: Map<string, AggregatedItem>;
};

type MutableSummary = {
  readonly critical: ReviewSummaryItem[];
  readonly major: ReviewSummaryItem[];
  readonly minor: ReviewSummaryItem[];
  readonly resolved: ReviewSummaryItem[];
  readonly open: ReviewSummaryItem[];
};

function createMutableSummary(): MutableSummary {
  return { critical: [], major: [], minor: [], resolved: [], open: [] };
}

function projectItem(record: ReviewObservedRecord, item: ReviewItem): ReviewSummaryItem {
  return {
    itemKey: item.itemKey,
    ref: {
      agentId: record.agentId,
      sessionId: record.sessionId,
      writerId: record.writerId,
      sequence: record.sequence,
      kind: "full",
      evidenceId: item.evidenceId,
    },
    severity: item.severity,
  };
}

function resolveItem(scope: MutableScopeState, itemKey: string): void {
  const existing = scope.items.get(itemKey);
  if (existing?.status !== "open") return;
  scope.items.set(itemKey, { item: existing.item, status: "resolved" });
}

function addToSummary(target: MutableSummary, aggregated: AggregatedItem): void {
  switch (aggregated.item.severity) {
    case "critical":
      target.critical.push(aggregated.item);
      break;
    case "major":
      target.major.push(aggregated.item);
      break;
    case "minor":
      target.minor.push(aggregated.item);
      break;
    default:
      assertNever(aggregated.item.severity);
  }

  switch (aggregated.status) {
    case "open":
      target.open.push(aggregated.item);
      break;
    case "resolved":
      target.resolved.push(aggregated.item);
      break;
    default:
      assertNever(aggregated.status);
  }
}

function materializeScope(scope: MutableScopeState): ScopeReviewSummary {
  const summary = createMutableSummary();
  for (const item of scope.items.values()) addToSummary(summary, item);
  return summary;
}

function getOrCreateScope(
  scopeStates: Map<string, MutableScopeState>,
  scopeName: string,
): MutableScopeState {
  const existing = scopeStates.get(scopeName);
  if (existing) return existing;
  const created: MutableScopeState = { items: new Map<string, AggregatedItem>() };
  scopeStates.set(scopeName, created);
  return created;
}

function applyItemUpdates(scope: MutableScopeState, record: ReviewObservedRecord): void {
  for (const item of record.items) {
    scope.items.set(item.itemKey, { item: projectItem(record, item), status: "open" });
  }
}

function reconcileCompleteSnapshot(scope: MutableScopeState, record: ReviewObservedRecord): void {
  if (record.isCompleteSnapshot !== true) return;
  const observedKeys = new Set(record.items.map((item) => item.itemKey));
  for (const itemKey of [...scope.items.keys()]) {
    if (!observedKeys.has(itemKey)) resolveItem(scope, itemKey);
  }
}

function applyResolutionMarkers(scope: MutableScopeState, record: ReviewObservedRecord): void {
  for (const marker of record.resolutionMarkers ?? []) resolveItem(scope, marker.itemKey);
}

export function aggregateReviews(records: readonly ObservationRecord[]): ReviewSummary {
  const scopeStates = new Map<string, MutableScopeState>();

  for (const record of records) {
    if (record.kind !== "review_observed") continue;
    const scope = getOrCreateScope(scopeStates, record.reviewScope);

    applyItemUpdates(scope, record);
    reconcileCompleteSnapshot(scope, record);
    applyResolutionMarkers(scope, record);
  }

  const global = createMutableSummary();
  const byScope = new Map<string, ScopeReviewSummary>();
  for (const [scopeName, scopeState] of scopeStates) {
    const scopeSummary = materializeScope(scopeState);
    byScope.set(scopeName, scopeSummary);
    for (const item of scopeState.items.values()) addToSummary(global, item);
  }

  return { authority: "observed_review_output", ...global, byScope };
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected discriminant: ${String(value)}`);
}
