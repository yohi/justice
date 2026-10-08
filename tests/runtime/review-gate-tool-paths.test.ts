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

  it("extracts read tool targets for CAP1 scope enforcement", () => {
    expect(extractReviewGateToolPaths("read", { filePath: "docs/design.md" })).toEqual([
      "docs/design.md",
    ]);
    expect(extractReviewGateToolPaths("read", { path: "./requirements.md" })).toEqual([
      "requirements.md",
    ]);
  });

  it("returns null for a read with an unsafe path", () => {
    expect(extractReviewGateToolPaths("read", { filePath: "/tmp/plan.md" })).toBeNull();
    expect(extractReviewGateToolPaths("read", { filePath: "../../outside.md" })).toBeNull();
  });

  it("returns null for absolute paths, traversal, and missing mutation targets", () => {
    expect(extractReviewGateToolPaths("write", { filePath: "/tmp/plan.md" })).toBeNull();
    expect(extractReviewGateToolPaths("edit", { filePath: "../../outside.md" })).toBeNull();
    expect(extractReviewGateToolPaths("write", { content: "no path field" })).toBeNull();
    expect(extractReviewGateToolPaths("apply_patch", { patchText: "not a file patch" })).toBeNull();
  });

  it("does not classify non-mutating non-read tools as file writes", () => {
    expect(extractReviewGateToolPaths("bash", { command: "echo docs/plans/plan.md" })).toEqual([]);
    expect(extractReviewGateToolPaths("task", { filePath: "docs/plans/plan.md" })).toEqual([]);
  });
});
