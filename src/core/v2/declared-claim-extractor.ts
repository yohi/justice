// src/core/v2/declared-claim-extractor.ts
export type DeclaredClaim = {
  readonly evidenceId: string;
  readonly claimKind: "test" | "build" | "lint" | "generic";
  readonly outcome: "pass" | "fail" | "unknown";
};

const PASS_PATTERNS = /\bpass(?:ed|ing)?\b|✅/i;
const FAIL_PATTERNS = /\bfail(?:ed|ing)?\b|❌/i;
const CLAIM_PATTERNS: ReadonlyArray<readonly [DeclaredClaim["claimKind"], RegExp]> = [
  ["test", /\btests?\b/i],
  ["build", /build(?:\s+pass(?:ed)?)?|✅\s*build/i],
  ["lint", /lint(?:\s+pass(?:ed)?)?|✅\s*lint/i],
  ["generic", /declared|summary|status/i],
];

export function extractDeclaredClaims(sourceId: string, text: string): DeclaredClaim[] {
  const claims: DeclaredClaim[] = [];
  for (const [claimKind, pattern] of CLAIM_PATTERNS) {
    if (!pattern.test(text)) continue;
    const outcome = FAIL_PATTERNS.test(text) ? "fail" : PASS_PATTERNS.test(text) ? "pass" : "unknown"; // fail dominates a mixed report (aligned with evidence-engine deriveOutcome)
    claims.push({ evidenceId: `${sourceId}-${claimKind}`, claimKind, outcome });
  }
  return claims;
}
