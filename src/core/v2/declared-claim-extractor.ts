// src/core/v2/declared-claim-extractor.ts
export type DeclaredClaim = {
  readonly evidenceId: string;
  readonly claimKind: "test" | "build" | "lint" | "generic";
  readonly outcome: "pass" | "fail" | "unknown";
};

// Pass/fail vocabulary for declared claims. "error(s)" is intentionally excluded from FAIL to avoid
// false positives on "no errors"/"0 errors". ✓/✗ mirror evidence-engine's OUTPUT_* marks.
const PASS_PATTERNS = /\bpass(?:es|ed|ing)?\b|✓|✅/i;
const FAIL_PATTERNS = /\bfail(?:s|ed|ing|ure|ures)?\b|✗|❌/i;
const CLAIM_PATTERNS: ReadonlyArray<readonly [DeclaredClaim["claimKind"], RegExp]> = [
  // Claim kinds match the bare keyword (coarse): an incidental mention like "the test file" still
  // yields a claim, but its outcome is "unknown" (computed below) so it carries no false signal.
  ["test", /\btests?\b/i],
  ["build", /build(?:\s+pass(?:ed)?)?|✅\s*build/i],
  ["lint", /lint(?:\s+pass(?:ed)?)?|✅\s*lint/i],
  ["generic", /declared|summary|status/i],
];

function deriveClaimOutcome(text: string): DeclaredClaim["outcome"] {
  // FAIL is checked first so a mixed report ("tests pass, lint failed") resolves to "fail"
  // (fail dominates, aligned with evidence-engine deriveOutcome).
  if (FAIL_PATTERNS.test(text)) return "fail";
  if (PASS_PATTERNS.test(text)) return "pass";
  return "unknown";
}

export function extractDeclaredClaims(sourceId: string, text: string): DeclaredClaim[] {
  const claims: DeclaredClaim[] = [];
  for (const [claimKind, pattern] of CLAIM_PATTERNS) {
    if (!pattern.test(text)) continue;
    // NOTE: outcome is derived from the WHOLE message text and applied to every claim produced from
    // it. A mixed report (e.g. "tests pass, lint failed") therefore marks ALL claims "fail" (fail
    // dominates, aligned with evidence-engine deriveOutcome). Intentional coarse signal; per-claim
    // outcome scoping (a detection window per keyword) is deferred (review #1).
    const outcome = deriveClaimOutcome(text);
    claims.push({ evidenceId: `${sourceId}-${claimKind}`, claimKind, outcome });
  }
  return claims;
}
