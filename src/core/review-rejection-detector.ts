import { REVIEW_REJECTION_PATTERNS } from "./review-rejection-patterns";
import type { ReviewSeverity } from "./v2/review-severity";

const MAX_EXCERPTS = 3;
const MAX_EXCERPT_LENGTH = 200;
const MAX_SUMMARY_LENGTH = 300;

export interface ReviewRejectionSignal {
  readonly matched: boolean;
  readonly excerpts: readonly string[];
  readonly summary: string;
}

export type ReviewItem = {
  readonly itemKey: string;
  readonly severity: ReviewSeverity;
  readonly summary: string;
  readonly status: "open" | "resolved";
  readonly evidenceId: string;
  readonly location: string;
};

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
