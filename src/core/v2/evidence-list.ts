import type { Evidence } from "./observation-model";

export function toEvidenceArray(
  evidence: Evidence | readonly Evidence[] | undefined,
): readonly Evidence[] {
  if (evidence === undefined) return [];
  return isEvidenceArray(evidence) ? evidence : [evidence];
}

function isEvidenceArray(value: Evidence | readonly Evidence[]): value is readonly Evidence[] {
  return Array.isArray(value);
}
