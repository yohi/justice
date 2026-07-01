// src/core/v2/declared-claim-extractor.ts
export type DeclaredClaim = {
  readonly evidenceId: string;
  readonly claimKind: "test" | "build" | "lint" | "generic";
  readonly outcome: "pass" | "fail" | "unknown";
};

const PASS_PATTERNS = /tests? pass|passing|✅\s*tests?/i;
const FAIL_PATTERNS = /tests? fail|failing|❌\s*tests?/i;
const CLAIM_PATTERNS: ReadonlyArray<readonly [DeclaredClaim["claimKind"], RegExp]> = [
  ["test", /tests? pass|passing|✅\s*tests?/i],
  ["build", /build(?:\s+pass(?:ed)?)?|✅\s*build/i],
  ["lint", /lint(?:\s+pass(?:ed)?)?|✅\s*lint/i],
  ["generic", /declared|summary|status/i],
];

export function extractDeclaredClaims(sourceId: string, text: string): DeclaredClaim[] {
  const claims: DeclaredClaim[] = [];
  for (const [claimKind, pattern] of CLAIM_PATTERNS) {
    if (!pattern.test(text)) continue;
    const outcome = PASS_PATTERNS.test(text) ? "pass" : FAIL_PATTERNS.test(text) ? "fail" : "unknown";
    claims.push({ evidenceId: `${sourceId}-${claimKind}`, claimKind, outcome });
  }
  return claims;
}
