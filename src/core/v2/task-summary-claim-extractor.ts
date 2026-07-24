import { extractDeclaredClaims, type DeclaredClaim } from "./declared-claim-extractor";

export function extractTaskSummaryClaims(sourceId: string, output: string): DeclaredClaim[] {
  return extractDeclaredClaims(sourceId, output);
}
