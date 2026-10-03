import { describe, expect, it } from "vitest";
import { extractReviewGateToolPaths } from "../../src/runtime/review-gate-tool-paths";

describe("extractReviewGateToolPaths", () => {
  it.each(["filePath", "file_path", "path"])(
    "extracts and normalizes a single %s edit target",
    (key) => {
      expect(extractReviewGateToolPaths("edit", { [key]: "./docs/plans/plan.md" })).toEqual([
        "docs/plans/plan.md",
      ]);
    },
  );

  it.each(["filesystem_edit_file", "filesystem_write_file"])(
    "extracts the target of %s",
    (toolName) => {
      expect(extractReviewGateToolPaths(toolName, { path: "./docs/plans/plan.md" })).toEqual([
        "docs/plans/plan.md",
      ]);
    },
  );

  it("extracts every file touched by a multi-file patch", () => {
    const patch = [
      "*** Begin Patch",
      "*** Update File: docs/specs/design.md",
      "@@",
      "*** Add File: docs/plans/new-plan.md",
      "*** End Patch",
    ].join("\n");

    expect(extractReviewGateToolPaths("apply_patch", { patchText: patch })).toEqual([
      "docs/specs/design.md",
      "docs/plans/new-plan.md",
    ]);
  });

  it("returns null for absolute paths, traversal, and missing mutation targets", () => {
    expect(extractReviewGateToolPaths("write", { filePath: "/tmp/plan.md" })).toBeNull();
    expect(extractReviewGateToolPaths("edit", { filePath: "../../outside.md" })).toBeNull();
    expect(extractReviewGateToolPaths("write", { content: "no path field" })).toBeNull();
    expect(extractReviewGateToolPaths("apply_patch", { patchText: "not a file patch" })).toBeNull();
  });

  it("does not classify non-mutating tools as file writes", () => {
    expect(extractReviewGateToolPaths("read", { filePath: "docs/plans/plan.md" })).toEqual([]);
  });
});
