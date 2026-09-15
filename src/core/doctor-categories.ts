import type { SpCategory } from "./types";

export const ALL_SP_CATEGORIES: readonly SpCategory[] = [
  "sp-mechanical",
  "sp-implementation",
  "sp-integration",
  "sp-review",
  "sp-final-review",
  "sp-deep",
  "sp-architecture",
] as const;

export type SpCategoryPresenceResult = {
  readonly missing: readonly SpCategory[];
  readonly ok: boolean;
};

export function checkSpCategoryPresence(
  categoryNames: readonly string[],
): SpCategoryPresenceResult {
  const available = new Set(categoryNames);
  const missing = ALL_SP_CATEGORIES.filter((category) => !available.has(category));
  return { missing, ok: missing.length === 0 };
}
