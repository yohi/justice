import { describe, expect, it } from "vitest";
import { ALL_SP_CATEGORIES, checkSpCategoryPresence } from "../../src/core/doctor-categories";
import { projectDoctorEffectiveConfig } from "../../src/core/doctor-config";
import { scanConfigContent } from "../../src/core/doctor-config";

describe("checkSpCategoryPresence()", () => {
  it("reports exactly the missing required categories from a resolved host snapshot", () => {
    const projected = projectDoctorEffectiveConfig({
      category: { "sp-mechanical": {} },
      command: {},
    });
    expect(projected.kind).toBe("available");
    if (projected.kind !== "available") throw new Error("expected available");
    expect(checkSpCategoryPresence(projected.view.effectiveCategoryNames)).toEqual({
      ok: false,
      missing: [
        "sp-implementation",
        "sp-integration",
        "sp-review",
        "sp-final-review",
        "sp-deep",
        "sp-architecture",
      ],
    });
  });

  it("accepts all seven categories from a resolved host snapshot", () => {
    const projected = projectDoctorEffectiveConfig({
      category: Object.fromEntries(ALL_SP_CATEGORIES.map((name) => [name, {}])),
      command: {},
    });
    expect(projected).toMatchObject({ kind: "available" });
  });

  it("does not promote local source scans to effective-config authority", () => {
    const local = scanConfigContent(
      "project",
      '{ "category": { "sp-review": {} }, "command": { "justice-implement-brainstorming": { "agent": "sisyphus" } } }',
    );
    expect(local).toBeDefined();
    // There is intentionally no API from SourceScanResult -> DoctorEffectiveConfigView.
  });

  it("reports a missing category only once when the input repeats it", () => {
    expect(checkSpCategoryPresence(["sp-mechanical", "sp-mechanical"])).toEqual({
      ok: false,
      missing: [
        "sp-implementation",
        "sp-integration",
        "sp-review",
        "sp-final-review",
        "sp-deep",
        "sp-architecture",
      ],
    });
  });
});
