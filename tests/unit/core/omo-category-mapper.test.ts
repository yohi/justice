import { describe, expect, it } from "vitest";
import type { ExecutionRole, SpCategory } from "../../../src/core/types";
import { OmoCategoryMapper } from "../../../src/core/omo-category-mapper";

describe("OmoCategoryMapper", () => {
  const mapper = new OmoCategoryMapper();

  const roleCategories: readonly (readonly [ExecutionRole, SpCategory])[] = [
    ["mechanical", "sp-mechanical"],
    ["implementation", "sp-implementation"],
    ["integration", "sp-integration"],
    ["review", "sp-review"],
    ["final-review", "sp-final-review"],
  ];

  it.each(roleCategories)("maps %s to %s", (role, expected) => {
    expect(mapper.map(role)).toBe(expected);
  });

  it("returns undefined for deep and architecture", () => {
    expect(mapper.map("deep")).toBeUndefined();
    expect(mapper.map("architecture")).toBeUndefined();
  });

  it("guards SpCategory values", () => {
    expect(mapper.isSpCategory("sp-implementation")).toBe(true);
    expect(mapper.isSpCategory("quick")).toBe(false);
  });
});
