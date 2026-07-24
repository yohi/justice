// src/core/v2/review-types.ts
//
// Shared review-summary types, extracted from `state-projection.ts` so that
// `review-aggregator.ts` does not need to import from its own consumer.
// Both `state-projection.ts` (which builds `ReviewSummary` via
// `aggregateReviews`) and `review-aggregator.ts` (which produces it) depend
// on this module instead of on each other.
import type { FullEvidenceRef } from "../types";

export type ReviewSummaryItem = {
  readonly itemKey: string;
  readonly ref: FullEvidenceRef;
  readonly severity: "critical" | "major" | "minor";
};

export type ScopeReviewSummary = {
  readonly critical: readonly ReviewSummaryItem[];
  readonly major: readonly ReviewSummaryItem[];
  readonly minor: readonly ReviewSummaryItem[];
  readonly resolved: readonly ReviewSummaryItem[];
  readonly open: readonly ReviewSummaryItem[];
};

export type ReviewSummary = ScopeReviewSummary & {
  readonly authority: "observed_review_output";
  readonly byScope: ReadonlyMap<string, ScopeReviewSummary>;
};
