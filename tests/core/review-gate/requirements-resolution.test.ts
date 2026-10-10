import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  parseDesignRequirementsDeclaration,
  selectRequirementsSource,
} from "../../../src/core/review-gate/requirements-resolution";

const VALID_MARKER = '<!-- justice-review-gate:requirements="docs/requirements/feature.md" -->';

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

describe("parseDesignRequirementsDeclaration", () => {
  it("selects the single valid preamble marker after the optional first H1", () => {
    const design = [
      "# Feature Design",
      "",
      VALID_MARKER,
      "",
      "## Overview",
      "",
      "Body text.",
      "",
    ].join("\n");

    expect(parseDesignRequirementsDeclaration(design)).toEqual({
      kind: "selected",
      canonicalPath: "docs/requirements/feature.md",
      line: 3,
      markerDigest: sha256(VALID_MARKER),
    });
  });

  it("rejects a marker placed before the first H1 heading (Design §10.2.2)", () => {
    const design = [VALID_MARKER, "", "# Feature Design", "", "## Overview"].join("\n");

    expect(parseDesignRequirementsDeclaration(design).kind).toBe("invalid");
  });

  it("accepts a marker between the first H1 and the first unfenced H2", () => {
    const design = ["# Feature Design", "", VALID_MARKER, "", "## Overview"].join("\n");

    expect(parseDesignRequirementsDeclaration(design)).toMatchObject({
      kind: "selected",
      canonicalPath: "docs/requirements/feature.md",
      line: 3,
    });
  });

  it("normalizes the declared path through the shared safe-path rules", () => {
    const design = [
      '<!-- justice-review-gate:requirements="docs/./requirements/../requirements/feature.md" -->',
      "",
      "## Overview",
    ].join("\n");

    const parsed = parseDesignRequirementsDeclaration(design);
    // `docs/./x` collapses during normalization but `..` segments are rejected.
    expect(parsed.kind).toBe("invalid");
  });

  it("returns none for a document without any marker", () => {
    const design = ["# Feature Design", "", "## Overview", "", "Body."].join("\n");

    expect(parseDesignRequirementsDeclaration(design)).toEqual({ kind: "none" });
  });

  it("returns none for an empty document", () => {
    expect(parseDesignRequirementsDeclaration("")).toEqual({ kind: "none" });
  });

  it("returns none when the marker appears only inside a fenced code block", () => {
    const design = [
      "# Feature Design",
      "",
      "```md",
      VALID_MARKER,
      "```",
      "",
      "## Overview",
    ].join("\n");

    expect(parseDesignRequirementsDeclaration(design)).toEqual({ kind: "none" });
  });

  it("does not let a fenced pseudo heading bound the preamble", () => {
    const design = [
      "```text",
      "## Not a real heading",
      "```",
      "",
      VALID_MARKER,
      "",
      "## Overview",
    ].join("\n");

    expect(parseDesignRequirementsDeclaration(design)).toMatchObject({
      kind: "selected",
      canonicalPath: "docs/requirements/feature.md",
      line: 5,
    });
  });

  it("rejects a marker placed after the first unfenced H2", () => {
    const design = [
      "# Feature Design",
      "",
      "## Overview",
      "",
      VALID_MARKER,
    ].join("\n");

    expect(parseDesignRequirementsDeclaration(design).kind).toBe("invalid");
  });

  it("rejects a marker placed after the first unfenced H3", () => {
    const design = ["# Feature Design", "", "### Details", "", VALID_MARKER].join("\n");

    expect(parseDesignRequirementsDeclaration(design).kind).toBe("invalid");
  });

  it("accepts a marker on physical line 64 of the preamble window", () => {
    const lines: string[] = Array.from({ length: 63 }, () => "preamble note");
    lines.push(VALID_MARKER);
    lines.push("## Overview");

    const parsed = parseDesignRequirementsDeclaration(lines.join("\n"));
    expect(parsed).toMatchObject({ kind: "selected", canonicalPath: "docs/requirements/feature.md", line: 64 });
  });

  it("rejects a marker on physical line 65 (outside the 64-line preamble window)", () => {
    const lines: string[] = Array.from({ length: 64 }, () => "preamble note");
    lines.push(VALID_MARKER);
    lines.push("## Overview");

    expect(parseDesignRequirementsDeclaration(lines.join("\n")).kind).toBe("invalid");
  });

  it("rejects two identical declarations even with the same declared path", () => {
    const design = [VALID_MARKER, "", VALID_MARKER, "", "## Overview"].join("\n");

    expect(parseDesignRequirementsDeclaration(design).kind).toBe("invalid");
  });

  it("rejects a valid preamble marker combined with a second late declaration", () => {
    const design = [VALID_MARKER, "", "## Overview", "", VALID_MARKER].join("\n");

    expect(parseDesignRequirementsDeclaration(design).kind).toBe("invalid");
  });

  it.each([
    '<!-- justice-review-gate:requirements=docs/requirements/feature.md -->',
    '<!-- justice-review-gate:requirements="docs/requirements/feature.md"-->',
    '<!-- justice-review-gate:requirements="docs/requirements/feature.md" --> trailing',
    '<!-- justice-review-gate:requirements="" -->',
    '<!-- justice-review-gate:requirements="docs/requirements/feature.txt" -->',
    '<!-- justice-review-gate:requirements="docs%20requirements/feature.md" -->',
    '<!-- justice-review-gate:requirements="@docs/requirements/feature.md" -->',
    '<!-- justice-review-gate:requirements="/etc/passwd.md" -->',
    '<!-- justice-review-gate:requirements="docs/../secret.md" -->',
    '<!-- justice-review-gate:requirements="docs\\secret.md" -->',
  ])("rejects the malformed reserved marker: %s", (markerLine) => {
    const design = [markerLine, "", "## Overview"].join("\n");

    expect(parseDesignRequirementsDeclaration(design).kind).toBe("invalid");
  });

  it("rejects a declared path longer than 4096 bytes", () => {
    const longPath = `${"a/".repeat(2047)}r.md`;
    expect(longPath.length).toBeGreaterThan(4096);
    const design = [
      `<!-- justice-review-gate:requirements="${longPath}" -->`,
      "",
      "## Overview",
    ].join("\n");

    expect(parseDesignRequirementsDeclaration(design).kind).toBe("invalid");
  });

  it("treats issue URL prose and other references as non-selectors", () => {
    const design = [
      "# Feature Design",
      "",
      "See https://github.com/yohi/justice/issues/310 for the requirements.",
      "Requirements: docs/requirements/feature.md",
      "[Requirements](docs/requirements/feature.md)",
      "<-- justice-review-gate:requirements=docs/r.md -->",
      "",
      "## Overview",
    ].join("\n");

    expect(parseDesignRequirementsDeclaration(design)).toEqual({ kind: "none" });
  });

  it("treats LF and CRLF equivalently and digests the line without its terminator", () => {
    const lf = parseDesignRequirementsDeclaration([VALID_MARKER, "", "## Overview"].join("\n"));
    const crlf = parseDesignRequirementsDeclaration([VALID_MARKER, "", "## Overview"].join("\r\n"));

    expect(crlf).toEqual(lf);
    expect(lf).toMatchObject({
      kind: "selected",
      canonicalPath: "docs/requirements/feature.md",
      line: 1,
      markerDigest: sha256(VALID_MARKER),
    });
  });

  it("is deterministic for identical input", () => {
    const design = [VALID_MARKER, "", "## Overview"].join("\n");

    expect(parseDesignRequirementsDeclaration(design)).toEqual(
      parseDesignRequirementsDeclaration(design),
    );
  });
});

describe("selectRequirementsSource", () => {
  const selectedDeclaration = {
    kind: "selected",
    canonicalPath: "docs/requirements/feature.md",
    line: 3,
    markerDigest: sha256(VALID_MARKER),
  } as const;

  it("selects the explicit CLI path when no declaration exists", () => {
    expect(
      selectRequirementsSource({
        explicitPath: "docs/requirements/feature.md",
        declaration: { kind: "none" },
      }),
    ).toEqual({
      kind: "selected",
      source: "explicit",
      canonicalPath: "docs/requirements/feature.md",
    });
  });

  it("blocks when neither an explicit path nor a declaration exists", () => {
    expect(selectRequirementsSource({ declaration: { kind: "none" } })).toEqual({
      kind: "blocked",
      reason: "REQUIREMENTS_RESOLUTION_REQUIRED",
    });
  });

  it("selects the declared reference when no explicit path is given", () => {
    expect(selectRequirementsSource({ declaration: selectedDeclaration })).toEqual({
      kind: "selected",
      source: "design_declared_reference",
      canonicalPath: "docs/requirements/feature.md",
    });
  });

  it("records the explicit source when the CLI path and declaration agree", () => {
    expect(
      selectRequirementsSource({
        explicitPath: "docs/requirements/feature.md",
        declaration: selectedDeclaration,
      }),
    ).toEqual({
      kind: "selected",
      source: "explicit",
      canonicalPath: "docs/requirements/feature.md",
    });
  });

  it("blocks on disagreement between the explicit path and the declaration", () => {
    expect(
      selectRequirementsSource({
        explicitPath: "docs/requirements/other.md",
        declaration: selectedDeclaration,
      }),
    ).toEqual({ kind: "blocked", reason: "REQUIREMENTS_RESOLUTION_REQUIRED" });
  });

  it("blocks when the declaration is invalid even when an explicit path is supplied", () => {
    expect(
      selectRequirementsSource({
        explicitPath: "docs/requirements/feature.md",
        declaration: { kind: "invalid", reason: "malformed marker" },
      }),
    ).toEqual({ kind: "blocked", reason: "REQUIREMENTS_RESOLUTION_REQUIRED" });
  });

  it("blocks when the declaration is invalid and no explicit path is supplied", () => {
    expect(
      selectRequirementsSource({
        declaration: { kind: "invalid", reason: "malformed marker" },
      }),
    ).toEqual({ kind: "blocked", reason: "REQUIREMENTS_RESOLUTION_REQUIRED" });
  });

  it("blocks unsafe explicit paths", () => {
    for (const unsafePath of [
      "/etc/requirements.md",
      "../requirements.md",
      "docs/requirements.md/../secret.md",
      "docs\\requirements.md",
      "",
      "@docs/requirements.md",
    ]) {
      expect(
        selectRequirementsSource({ explicitPath: unsafePath, declaration: { kind: "none" } }),
      ).toEqual({ kind: "blocked", reason: "REQUIREMENTS_RESOLUTION_REQUIRED" });
    }
  });
});
