import { REVIEW_REJECTION_PATTERNS } from "./review-rejection-patterns";
import type { ReviewItem } from "./v2/observation-model";
import { hashString } from "./v2/hash";
import { classifySeverity, deriveItemKey } from "./v2/review-severity";

export type { ReviewItem } from "./v2/observation-model";

const MAX_EXCERPTS = 3;
const MAX_EXCERPT_LENGTH = 200;
const MAX_SUMMARY_LENGTH = 300;

export interface ReviewRejectionSignal {
  readonly matched: boolean;
  readonly excerpts: readonly string[];
  readonly summary: string;
}

export class ReviewRejectionDetector {
  detect(text: string): ReviewRejectionSignal {
    if (text.length === 0) {
      return { matched: false, excerpts: [], summary: "" };
    }

    const excerpts = this.extractExcerpts(text);
    if (excerpts.length === 0) {
      return { matched: false, excerpts: [], summary: "" };
    }

    const joined = excerpts.join("\n");
    const isTruncated = joined.length > MAX_SUMMARY_LENGTH;
    const summary = isTruncated ? `${joined.slice(0, MAX_SUMMARY_LENGTH - 3)}...` : joined;

    return {
      matched: true,
      excerpts,
      summary,
    };
  }

  detectMultiple(
    text: string,
    _metadata?: Readonly<Record<string, unknown>>,
  ): readonly ReviewItem[] {
    const items = new Map<string, ReviewItem>();
    for (const line of text.split(/\r?\n/u)) {
      const summary = line.trim().slice(0, MAX_EXCERPT_LENGTH);
      const patternIndex = REVIEW_REJECTION_PATTERNS.findIndex((pattern) => pattern.test(summary));
      if (summary.length === 0 || patternIndex < 0) continue;

      const severity = classifySeverity(summary);
      const location = extractReviewLocation(summary);
      const normalizedSummary = summary.toLowerCase().replace(/\s+/gu, " ");
      const itemKey = deriveItemKey(
        severity,
        `review-rejection-${patternIndex + 1}`,
        location,
        hashString(normalizedSummary),
      );
      items.set(itemKey, {
        itemKey,
        evidenceId: itemKey,
        severity,
        summary,
        location,
        status: "open",
      });
    }
    return [...items.values()];
  }

  isCompleteSnapshot(_text: string, metadata?: Readonly<Record<string, unknown>>): boolean {
    return metadata?.isCompleteSnapshot === true;
  }

  private extractExcerpts(text: string): readonly string[] {
    const excerpts: string[] = [];

    for (const line of text.split(/\r?\n/u)) {
      if (excerpts.length >= MAX_EXCERPTS) {
        break;
      }

      if (REVIEW_REJECTION_PATTERNS.some((pattern) => pattern.test(line))) {
        excerpts.push(line.trim().slice(0, MAX_EXCERPT_LENGTH));
      }
    }

    return excerpts;
  }
}

function extractReviewLocation(summary: string): string {
  for (const token of summary.split(/\s+/u)) {
    const candidate = token.replace(/^[([{'"`]+/u, "").replace(/[\])},;'"`]+$/u, "");
    const separatorIndex = Math.max(candidate.lastIndexOf("/"), candidate.lastIndexOf("\\"));
    if (separatorIndex < 0) continue;
    const filePart = candidate.slice(separatorIndex + 1).split(":")[0] ?? "";
    if (filePart.lastIndexOf(".") > 0) return candidate;
  }
  return "unknown";
}
