export const LOOP_ERROR_PATTERNS: readonly RegExp[] = Object.freeze([
  /loop\s*detect/i,
  /infinite\s+loop/i,
  /repetition\s*limit/i,
  /same\s+edit\s+applied/i,
  // eslint-disable-next-line security/detect-unsafe-regex
  /\brepeated\b.*\b(calls?|attempts?)\b/i,
  /stuck\s*in\s*(an?\s+)?loop/i,
  /too\s*many\s*iterations/i,
]);

export function matchesLoopError(errorMessage: string): boolean {
  return LOOP_ERROR_PATTERNS.some((pattern) => pattern.test(errorMessage));
}
