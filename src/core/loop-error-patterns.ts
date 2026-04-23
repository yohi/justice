export const LOOP_ERROR_PATTERNS: readonly RegExp[] = Object.freeze([
  /loop\s*detect/i,
  /infinite\s+loop/i,
  /repetition\s*limit/i,
  /same\s+edit\s+applied/i,
  /\brepeated\s+[^.!?\n]{0,50}\b(?:calls?|attempts?)\b/i,
  /\bstuck\s+in\s+(?:a|an)?\s*loop\b/i,
  /too\s*many\s*iterations/i,
]);

export function matchesLoopError(errorMessage: string): boolean {
  return LOOP_ERROR_PATTERNS.some((pattern) => pattern.test(errorMessage));
}
