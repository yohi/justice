export const REVIEW_REJECTION_PATTERNS: readonly RegExp[] = Object.freeze([
  /\breject(?:ed)?\b/i,
  /\bcannot\s+approve\b/i,
  /\bapproval\s+denied\b/i,
  /\brequested\s+changes\b/i,
  /\bMUST\s+FIX\s*:/,
  /\bBLOCKER\s*:/,
  /\b(blocking|critical)\s+(issue|concern|problem)s?\b/i,
  /❌/u,
  /\bdo\s+not\s+merge\b/i,
  /(不承認|却下|要修正|致命的|ブロッカー)/u,
  /(請求された変更|レビュー却下)/u,
]);

export function matchesReviewRejection(text: string): boolean {
  return REVIEW_REJECTION_PATTERNS.some((pattern) => pattern.test(text));
}
