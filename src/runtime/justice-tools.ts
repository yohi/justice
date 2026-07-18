import { normalizeReviewResolutionArtifact } from "../core/review-resolution-artifact";
import type { ReviewResolutionArtifact } from "../core/types";
import type { PersistedLogRecord } from "../core/v2/observation-model";
import { project } from "../core/v2/state-projection";
import type { ReviewSummary, ScopeReviewSummary } from "../core/v2/review-types";

export type JusticeReviewToolArgs = {
  readonly scope?: string;
  readonly resolve?: {
    readonly itemKeys: readonly string[];
    readonly artifactRef: string;
  };
};

export type ReviewApprovalRequest = {
  readonly permission: "justice_review.resolve";
  readonly patterns: string[];
  readonly always: string[];
  readonly metadata: {
    readonly reviewScope: string;
    readonly itemKeys: readonly string[];
    readonly artifactRef: string;
  };
};

export type JusticeReviewToolResult =
  | string
  | {
      readonly output: string;
      readonly metadata: { readonly reviewResolutionArtifact: ReviewResolutionArtifact };
    };

export type JusticeReviewToolInput = {
  readonly logReader: { readonly readAll: () => Promise<readonly PersistedLogRecord[]> };
  readonly args: JusticeReviewToolArgs;
  readonly requestApproval: (approval: ReviewApprovalRequest) => Promise<void>;
};

function errorResult(reason: string): string {
  return JSON.stringify({ status: "ERROR", reason }, null, 2);
}

function serializeReviewSummary(summary: ReviewSummary, scope: string | undefined): string {
  if (scope !== undefined) {
    const scopedSummary = summary.byScope.get(scope);
    return scopedSummary === undefined
      ? errorResult(`Unknown review scope: ${scope}`)
      : JSON.stringify(scopedSummary, null, 2);
  }

  return JSON.stringify(
    {
      authority: summary.authority,
      critical: summary.critical,
      major: summary.major,
      minor: summary.minor,
      resolved: summary.resolved,
      open: summary.open,
      byScope: Object.fromEntries(summary.byScope),
    },
    null,
    2,
  );
}

function containsOpenItems(summary: ScopeReviewSummary, itemKeys: readonly string[]): boolean {
  const openItemKeys = new Set(summary.open.map((item) => item.itemKey));
  return itemKeys.every((itemKey) => openItemKeys.has(itemKey));
}

export async function executeJusticeReviewTool(
  input: JusticeReviewToolInput,
): Promise<JusticeReviewToolResult> {
  try {
    const state = project(await input.logReader.readAll(), new Date().toISOString());
    if (input.args.resolve === undefined) {
      return serializeReviewSummary(state.reviewSummary, input.args.scope);
    }

    const artifact = normalizeReviewResolutionArtifact({
      reviewScope: input.args.scope ?? "",
      itemKeys: input.args.resolve.itemKeys,
      artifactRef: input.args.resolve.artifactRef,
    });
    if (artifact === undefined) return errorResult("Invalid review resolution request.");

    const scopeSummary = state.reviewSummary.byScope.get(artifact.reviewScope);
    if (scopeSummary === undefined || !containsOpenItems(scopeSummary, artifact.itemKeys)) {
      return errorResult("Requested review items are not currently open in the specified scope.");
    }

    try {
      await input.requestApproval({
        permission: "justice_review.resolve",
        patterns: [artifact.reviewScope, ...artifact.itemKeys],
        always: [],
        metadata: {
          reviewScope: artifact.reviewScope,
          itemKeys: artifact.itemKeys,
          artifactRef: artifact.artifactRef,
        },
      });
    } catch {
      return errorResult("Review resolution was not approved.");
    }

    return {
      output: JSON.stringify({ status: "OK", reviewResolutionArtifact: artifact }, null, 2),
      metadata: { reviewResolutionArtifact: artifact },
    };
  } catch {
    return errorResult("Unable to read the current review state.");
  }
}
