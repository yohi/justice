import { describe, expect, it } from "vitest";
import {
  buildRequirementsSectionInventory as buildRequirementsSectionInventoryFromBytes,
  diffRequirementsSectionInventories,
  REQUIREMENTS_HEADING_ANCHOR_VERSION,
  resolveSectionByAnchor,
  validateRequirementsGoverningDeltaProof,
  type RequirementsGoverningDeltaProofV1,
} from "../../../src/core/review-gate/requirements-section-inventory";

const SOURCE_GIT_BLOB_OID = "a".repeat(40);
const buildRequirementsSectionInventory = (
  markdown: string,
  sourceGitBlobOid = SOURCE_GIT_BLOB_OID,
  parserVersion = REQUIREMENTS_HEADING_ANCHOR_VERSION,
) => buildRequirementsSectionInventoryFromBytes(
  new TextEncoder().encode(markdown),
  sourceGitBlobOid,
  parserVersion,
);

describe("buildRequirementsSectionInventory", () => {
  it("records the exact Design §8 inventory DTO from byte/blob input", () => {
    const bytes = new TextEncoder().encode("Preamble\n## Authentication {#authentication}\nMFA\n");
    const inventory = buildRequirementsSectionInventoryFromBytes(
      bytes,
      "b".repeat(40),
      REQUIREMENTS_HEADING_ANCHOR_VERSION,
    );

    expect(Object.keys(inventory.inventory).sort()).toEqual([
      "atomicSectionCount",
      "completeSectionTreeDigest",
      "normalizedByteLength",
      "normalizedDocumentDigest",
      "parserVersion",
      "preambleDigest",
      "sourceGitBlobOid",
      "sourceSpanCoverageDigest",
    ]);
    expect(inventory.inventory).toMatchObject({
      sourceGitBlobOid: "b".repeat(40),
      parserVersion: REQUIREMENTS_HEADING_ANCHOR_VERSION,
      atomicSectionCount: 1,
      normalizedByteLength: bytes.length,
    });
  });

  it("resolves a terminal explicit anchor without inventing one for a plain heading", () => {
    const inventory = buildRequirementsSectionInventory([
      "Preamble.",
      "",
      "## Authentication {#authentication}",
      "Use MFA.",
      "",
      "## Authorization",
      "Use RBAC.",
    ].join("\n"));

    expect(resolveSectionByAnchor(inventory, "#authentication")?.title).toBe("Authentication");
    expect(resolveSectionByAnchor(inventory, "#authorization")).toBeNull();
  });

  it.each([
    ["## One {#duplicate}\n### Two {#duplicate}", "duplicate explicit IDs"],
    ["## One {#Uppercase}", "uppercase IDs"],
    ["## One {#naïve}", "non-ASCII IDs"],
    ["## One { #one}", "whitespace within an attribute"],
    ["## One {#one} trailing", "trailing attributes"],
    ["## One {#one} #", "closing hashes after an attribute"],
    ["## One {#one#two}", "extra fragments"],
    ["## One {#one", "missing attribute delimiter"],
    ["## One  {#one}", "ambiguous spacing"],
    ["## One\t{#one}", "tab-delimited attribute"],
    ["## {#one}", "missing title"],
    ["## One {#one%20two}", "encoded IDs"],
    [`## One {#${"a".repeat(65)}}`, "overlong IDs"],
  ])("rejects %s", (markdown) => {
    expect(() => buildRequirementsSectionInventory(markdown)).toThrow();
  });

  it("keeps the preamble and all heading depths while ignoring fenced pseudo-headings", () => {
    const inventory = buildRequirementsSectionInventory([
      "Introduction.",
      "",
      "```md",
      "## Fenced {#not-real}",
      "```",
      "# Top {#top}",
      "## Child",
      "### Grandchild {#grandchild}",
      "#### Fourth",
      "##### Fifth",
      "###### Deep",
    ].join("\n"));

    expect(inventory.preamble.text).toContain("Introduction.");
    expect(inventory.sections.map((section) => section.depth)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(resolveSectionByAnchor(inventory, "#not-real")).toBeNull();
    expect(resolveSectionByAnchor(inventory, "#grandchild")?.headingLine).toBe(8);
  });

  it("normalizes CRLF before determining bytes and digests", () => {
    const lf = "Preamble\n## Authentication {#authentication}\nUse MFA.\n";
    const crlf = lf.replaceAll("\n", "\r\n");

    expect(buildRequirementsSectionInventory(crlf)).toEqual(buildRequirementsSectionInventory(lf));
  });

  it("retains complete UTF-8 byte coverage and descendant governing spans", () => {
    const markdown = "序文\n# Parent {#parent}\nBody.\n## Child {#rq-1}\nChild body.\n# End\n";
    const inventory = buildRequirementsSectionInventory(markdown);
    const reconstructed = inventory.preamble.text + inventory.sections.map((section) =>
      section.headingSpan.text + section.bodySpan.text).join("");

    expect(reconstructed).toBe(markdown);
    expect(inventory.preamble).toMatchObject({ startByte: 0, endByte: 7 });
    expect(inventory.inventory.normalizedByteLength).toBe(new TextEncoder().encode(markdown).length);
    expect(resolveSectionByAnchor(inventory, "#parent")?.governingSpan.text).toBe(
      "# Parent {#parent}\nBody.\n## Child {#rq-1}\nChild body.\n",
    );
    expect(resolveSectionByAnchor(inventory, "#rq-1")?.title).toBe("Child");
    expect(Object.isFrozen(inventory.sections)).toBe(true);
    expect(Object.isFrozen(inventory.sections.at(0)?.bodySpan)).toBe(true);
  });

  it.each(["", "Only preamble.\n", "## Heading without newline"]) (
    "covers a document without synthetic bytes: %s", (markdown) => {
      const inventory = buildRequirementsSectionInventory(markdown);

      expect(inventory.preamble.text + inventory.sections.map((section) =>
        section.headingSpan.text + section.bodySpan.text).join("")).toBe(markdown);
    },
  );

  it("rejects ambiguous unanchored sibling identities", () => {
    expect(() => buildRequirementsSectionInventory("## Same\nA\n## Same\nB")).toThrow();
  });

  it.each(["#rq%2D1", "#RQ-1", "##rq-1", "#rq-1#other", "#rq-1-1", " #rq-1"]) (
    "does not decode or guess a governing anchor: %s", (anchor) => {
      const inventory = buildRequirementsSectionInventory("## Request R1 {#rq-1}");

      expect(resolveSectionByAnchor(inventory, anchor)).toBeNull();
    },
  );
});

describe("diffRequirementsSectionInventories", () => {
  it("detects sibling reordering without losing the same section identity", () => {
    const oldInventory = buildRequirementsSectionInventory("## A\nA body.\n## B\nB body.\n");
    const currentInventory = buildRequirementsSectionInventory("## B\nB body.\n## A\nA body.\n");

    const diff = diffRequirementsSectionInventories(oldInventory, currentInventory);

    expect(diff.counts).toEqual({ unchanged: 0, added: 0, removed: 0, moved: 2, modified: 0 });
    expect(diff.changes.every((change) => !change.contentChanged)).toBe(true);
  });

  it("includes preamble-only changes in the full diff digest", () => {
    const oldInventory = buildRequirementsSectionInventory("Before\n## Plain\nSame\n");
    const currentInventory = buildRequirementsSectionInventory("After\n## Plain\nSame\n");

    const diff = diffRequirementsSectionInventories(oldInventory, currentInventory);

    expect(diff.preambleChanged).toBe(true);
    expect(diff.counts.unchanged).toBe(1);
    expect(diff.fullDiffDigest).not.toBe(diffRequirementsSectionInventories(oldInventory, oldInventory).fullDiffDigest);
  });

  it("rejects a parser-version mismatch rather than accepting a partial inventory", () => {
    const inventory = buildRequirementsSectionInventory("## Authentication {#authentication}");

    expect(() => diffRequirementsSectionInventories(inventory, buildRequirementsSectionInventory("## Authentication {#authentication}", SOURCE_GIT_BLOB_OID, "V0"))).toThrow();
    expect(() => diffRequirementsSectionInventories(inventory, { ...inventory, sections: [] })).toThrow();
  });

  it("classifies a removed governing ID without implicitly reusing the title", () => {
    const oldInventory = buildRequirementsSectionInventory("## Authentication {#authentication}\nMFA\n");
    const currentInventory = buildRequirementsSectionInventory("## Authentication\nMFA\n");

    const diff = diffRequirementsSectionInventories(oldInventory, currentInventory);

    expect(diff.counts).toEqual({ unchanged: 0, added: 1, removed: 1, moved: 0, modified: 0 });
    expect(resolveSectionByAnchor(currentInventory, "#authentication")).toBeNull();
  });
  it("classifies added, deleted, modified, moved, and unchanged sections", () => {
    const oldInventory = buildRequirementsSectionInventory([
      "# Root {#root}",
      "## Stable {#stable}",
      "Original.",
      "## Modified {#modified}",
      "Before.",
      "## Deleted {#deleted}",
      "Old only.",
      "## Moved {#moved}",
      "Same body.",
      "## Parent {#parent}",
      "### Nested {#nested}",
      "Nested body.",
    ].join("\n"));
    const currentInventory = buildRequirementsSectionInventory([
      "# Root {#root}",
      "## Stable {#stable}",
      "Original.",
      "## Modified {#modified}",
      "After.",
      "## Parent {#parent}",
      "### Moved {#moved}",
      "Same body.",
      "### Nested {#nested}",
      "Nested body.",
      "## Added {#added}",
      "New only.",
    ].join("\n"));

    const diff = diffRequirementsSectionInventories(oldInventory, currentInventory);

    expect(diff.counts).toEqual({ unchanged: 2, added: 1, removed: 1, moved: 3, modified: 1 });
    expect(diff.changes.map((change) => change.kind).sort()).toEqual([
      "ADDED",
      "MODIFIED",
      "MOVED",
      "MOVED",
      "MOVED",
      "REMOVED",
      "UNCHANGED",
      "UNCHANGED",
    ]);
  });

  it("does not accept an unchanged governing/full-document claim when a sibling was added", () => {
    const oldInventory = buildRequirementsSectionInventory([
      "## Authentication {#authentication}",
      "Use MFA.",
      "",
    ].join("\n"));
    const currentInventory = buildRequirementsSectionInventory([
      "## Authentication {#authentication}",
      "Use MFA.",
      "## Security Restrictions",
      "No shared accounts.",
    ].join("\n"));

    const diff = diffRequirementsSectionInventories(oldInventory, currentInventory);

    expect(diff.counts).toEqual({ unchanged: 1, added: 1, removed: 0, moved: 0, modified: 0 });
    expect(diff.oldFullDocumentDigest).not.toBe(diff.newFullDocumentDigest);
    const proof: RequirementsGoverningDeltaProofV1 = {
      nc1StopEventId: "stop", oldAuthorityEventId: "old", newAuthorityEventId: "new",
      oldGitBlobOid: "old-blob", newGitBlobOid: "new-blob", verifiedExternalCommitOid: "commit",
      oldManifestDigest: "a".repeat(64), newManifestDigest: "a".repeat(64),
      oldFullDocumentDigest: oldInventory.inventory.normalizedDocumentDigest,
      newFullDocumentDigest: oldInventory.inventory.normalizedDocumentDigest,
      oldSectionInventoryDigest: diff.oldInventoryDigest, newSectionInventoryDigest: diff.newInventoryDigest,
      completeSectionDiffDigest: diff.fullDiffDigest, sectionDiffCoverageDigest: diff.fullDiffCoverageDigest,
      canonicalMappingDigest: "b".repeat(64), coveredLineageSetDigest: "c".repeat(64),
      affectedReferenceSetDigest: "d".repeat(64), observedChangeEventId: "change",
    };
    expect(() => validateRequirementsGoverningDeltaProof(proof, diff)).toThrow();
  });
});
