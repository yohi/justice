import { scanMarkdownFenceLines } from "../markdown-fence-scanner.js";
import { computeArtifactDigest, computeCanonicalJsonFingerprint } from "./identity.js";

export const REQUIREMENTS_HEADING_ANCHOR_VERSION = "REQUIREMENTS_HEADING_ANCHOR_V1";
export type SectionSpan = Readonly<{ startByte: number; endByte: number; text: string }>;
export type VerifiedSection = Readonly<{
  headingLine: number;
  depth: number;
  title: string;
  explicitAnchorId: string | null;
  sectionKey: string;
  parentKey: string | null;
  siblingPosition: number;
  headingSpan: SectionSpan;
  bodySpan: SectionSpan;
  governingSpan: SectionSpan;
  sectionDigest: string;
}>;
export type RequirementsSectionInventoryV1 = Readonly<{
  sourceGitBlobOid: string;
  parserVersion: string;
  normalizedDocumentDigest: string;
  normalizedByteLength: number;
  preambleDigest: string;
  completeSectionTreeDigest: string;
  atomicSectionCount: number;
  sourceSpanCoverageDigest: string;
}>;
export type VerifiedSectionInventory = Readonly<{
  inventory: RequirementsSectionInventoryV1;
  preamble: SectionSpan;
  sections: readonly VerifiedSection[];
  inventoryDigest: string;
}>;
export type SectionChange = Readonly<{
  sectionKey: string;
  kind: "ADDED" | "REMOVED" | "MODIFIED" | "MOVED" | "UNCHANGED";
  oldSection: VerifiedSection | null;
  currentSection: VerifiedSection | null;
  contentChanged: boolean;
}>;
export type RequirementsSectionDiffV1 = Readonly<{
  oldInventoryDigest: string;
  newInventoryDigest: string;
  oldFullDocumentDigest: string;
  newFullDocumentDigest: string;
  fullDiffDigest: string;
  fullDiffCoverageDigest: string;
  changedSectionKeysDigest: string;
  preambleChanged: boolean;
  counts: Readonly<{ unchanged: number; added: number; removed: number; moved: number; modified: number }>;
  changes: readonly SectionChange[];
}>;
/** Inert references: this DTO does not authenticate Git, manifests, or commit evidence. */
export type RequirementsGoverningDeltaProofV1 = Readonly<{
  nc1StopEventId: string;
  oldAuthorityEventId: string;
  newAuthorityEventId: string;
  oldGitBlobOid: string;
  newGitBlobOid: string;
  verifiedExternalCommitOid: string;
  oldManifestDigest: string;
  newManifestDigest: string;
  oldFullDocumentDigest: string;
  newFullDocumentDigest: string;
  oldSectionInventoryDigest: string;
  newSectionInventoryDigest: string;
  completeSectionDiffDigest: string;
  sectionDiffCoverageDigest: string;
  canonicalMappingDigest: string;
  coveredLineageSetDigest: string;
  affectedReferenceSetDigest: string;
  observedChangeEventId: string;
}>;

export class RequirementsSectionInventoryError extends Error {
  constructor(readonly reason: "invalid_anchor" | "ambiguous_key" | "invalid_inventory" | "invalid_proof" | "limit_exceeded") {
    super(`requirements_section_${reason}`);
    this.name = "RequirementsSectionInventoryError";
  }
}
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const verifiedInventories = new WeakSet<VerifiedSectionInventory>();
const verifiedDiffs = new WeakSet<RequirementsSectionDiffV1>();
function isAnchorId(id: string): boolean {
  return id.length <= 64 && /^[a-z][a-z0-9-]*$/.test(id) && !id.endsWith("-") && !id.includes("--");
}
const hash = (text: string): string => computeArtifactDigest(encoder.encode(text));

/** UTF-8 byte spans are half-open and refer to the CRLF-normalized document. */
export function buildRequirementsSectionInventory(
  sourceBytes: Uint8Array,
  sourceGitBlobOid: string,
  parserVersion: string,
): VerifiedSectionInventory {
  let text: string;
  try {
    text = decoder.decode(sourceBytes).replaceAll("\r\n", "\n");
  } catch (error) {
    if (error instanceof TypeError) throw new RequirementsSectionInventoryError("invalid_inventory");
    throw error;
  }
  const normalizedBytes = encoder.encode(text);
  if (normalizedBytes.length > 4 * 1024 * 1024) throw new RequirementsSectionInventoryError("limit_exceeded");
  const span = (startByte: number, endByte: number): SectionSpan => Object.freeze({
    startByte, endByte, text: decoder.decode(normalizedBytes.subarray(startByte, endByte)),
  });
  // Private parser accumulators; the published section list and nested spans are frozen.
  const headings: Omit<VerifiedSection, "bodySpan" | "governingSpan" | "sectionDigest">[] = [];
  const stack: typeof headings = [];
  const keys = new Set<string>();
  const anchors = new Set<string>();
  const siblings = new Map<string | null, number>();
  let offset = 0;
  for (const { line, lineNumber, insideFence } of scanMarkdownFenceLines(text)) {
    const start = offset;
    const lineLength = encoder.encode(line).length;
    offset += lineLength + (offset + lineLength < normalizedBytes.length ? 1 : 0);
    if (insideFence) continue;
    const match = /^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*$/.exec(line);
    if (match === null || match[1] === undefined || match[2] === undefined) continue;
    const depth = match[1].length;
    const rawTitle = match[2];
    let title = rawTitle.replace(/[ \t]+#+[ \t]*$/, "");
    let explicitAnchorId: string | null = null;
    if (/[{}]/.test(rawTitle)) {
      const attributeStart = rawTitle.lastIndexOf(" {#");
      const candidateTitle = rawTitle.slice(0, attributeStart);
      const candidateId = rawTitle.slice(attributeStart + 3, -1);
      if (attributeStart <= 0 || !rawTitle.endsWith("}") || /[{}]/.test(candidateTitle) ||
          /[ \t]$/.test(candidateTitle) || !isAnchorId(candidateId)) {
        throw new RequirementsSectionInventoryError("invalid_anchor");
      }
      title = candidateTitle;
      explicitAnchorId = candidateId;
      if (anchors.has(explicitAnchorId)) throw new RequirementsSectionInventoryError("invalid_anchor");
      anchors.add(explicitAnchorId);
    }
    while (stack.at(-1) !== undefined && (stack.at(-1)?.depth ?? 0) >= depth) stack.pop();
    const parentKey = stack.at(-1)?.sectionKey ?? null;
    const sectionKey = explicitAnchorId === null ? `${parentKey ?? ""}/title:${encodeURIComponent(title)}` : `/#${explicitAnchorId}`;
    if (keys.has(sectionKey)) throw new RequirementsSectionInventoryError("ambiguous_key");
    keys.add(sectionKey);
    const siblingPosition = siblings.get(parentKey) ?? 0;
    siblings.set(parentKey, siblingPosition + 1);
    const heading = { headingLine: lineNumber, depth, title, explicitAnchorId, sectionKey, parentKey,
      siblingPosition, headingSpan: span(start, offset) };
    headings.push(heading);
    stack.push(heading);
    if (headings.length > 4096) throw new RequirementsSectionInventoryError("limit_exceeded");
  }
  const sections = Object.freeze(headings.map((heading, index): VerifiedSection => {
    const next = headings.at(index + 1)?.headingSpan.startByte ?? normalizedBytes.length;
    const governingEnd = headings.slice(index + 1).find((entry) => entry.depth <= heading.depth)?.headingSpan.startByte ?? normalizedBytes.length;
    const bodySpan = span(heading.headingSpan.endByte, next);
    return Object.freeze({ ...heading, bodySpan, governingSpan: span(heading.headingSpan.startByte, governingEnd),
      sectionDigest: hash(heading.headingSpan.text + bodySpan.text) });
  }));
  const preamble = span(0, headings.at(0)?.headingSpan.startByte ?? normalizedBytes.length);
  const coverage = [preamble, ...sections.map((section) => span(section.headingSpan.startByte, section.bodySpan.endByte))];
  const inventory = Object.freeze({ sourceGitBlobOid, parserVersion, normalizedDocumentDigest: hash(text),
    normalizedByteLength: normalizedBytes.length, preambleDigest: hash(preamble.text),
    completeSectionTreeDigest: computeCanonicalJsonFingerprint(sections),
    atomicSectionCount: sections.length,
    sourceSpanCoverageDigest: computeCanonicalJsonFingerprint(coverage.map(({ startByte, endByte, text: source }) => ({ startByte, endByte, digest: hash(source) }))) });
  const verifiedInventory = Object.freeze({ inventory, preamble, sections,
    inventoryDigest: computeCanonicalJsonFingerprint({ inventory, sections }) });
  verifiedInventories.add(verifiedInventory);
  return verifiedInventory;
}

function requireInventory(inventory: VerifiedSectionInventory): void {
  if (!verifiedInventories.has(inventory) || inventory.inventory.parserVersion !== REQUIREMENTS_HEADING_ANCHOR_VERSION) {
    throw new RequirementsSectionInventoryError("invalid_inventory");
  }
}

export function resolveSectionByAnchor(inventory: VerifiedSectionInventory, anchorId: string): VerifiedSection | null {
  requireInventory(inventory);
  const id = anchorId.startsWith("#") ? anchorId.slice(1) : anchorId;
  if (!isAnchorId(id)) return null;
  return inventory.sections.find((section) => section.explicitAnchorId === id) ?? null;
}

export function diffRequirementsSectionInventories(old: VerifiedSectionInventory, current: VerifiedSectionInventory): RequirementsSectionDiffV1 {
  requireInventory(old);
  requireInventory(current);
  const before = new Map(old.sections.map((section) => [section.sectionKey, section]));
  const after = new Map(current.sections.map((section) => [section.sectionKey, section]));
  const changes = Object.freeze([...new Set([...before.keys(), ...after.keys()])].sort().map((sectionKey): SectionChange => {
    const oldSection = before.get(sectionKey) ?? null;
    const currentSection = after.get(sectionKey) ?? null;
    const contentChanged = oldSection?.sectionDigest !== currentSection?.sectionDigest;
    const kind = oldSection === null ? "ADDED" : currentSection === null ? "REMOVED" :
      oldSection.parentKey !== currentSection.parentKey || oldSection.siblingPosition !== currentSection.siblingPosition ? "MOVED" :
      contentChanged ? "MODIFIED" : "UNCHANGED";
    return Object.freeze({ sectionKey, kind, oldSection, currentSection, contentChanged });
  }));
  const counts = Object.freeze({ unchanged: changes.filter((entry) => entry.kind === "UNCHANGED").length,
    added: changes.filter((entry) => entry.kind === "ADDED").length,
    removed: changes.filter((entry) => entry.kind === "REMOVED").length,
    moved: changes.filter((entry) => entry.kind === "MOVED").length,
    modified: changes.filter((entry) => entry.kind === "MODIFIED").length });
  const preambleChanged = old.inventory.preambleDigest !== current.inventory.preambleDigest;
  const diff = Object.freeze({ oldInventoryDigest: old.inventoryDigest, newInventoryDigest: current.inventoryDigest,
    oldFullDocumentDigest: old.inventory.normalizedDocumentDigest, newFullDocumentDigest: current.inventory.normalizedDocumentDigest,
    fullDiffDigest: computeCanonicalJsonFingerprint({ changes, oldPreamble: old.inventory.preambleDigest, newPreamble: current.inventory.preambleDigest }),
    fullDiffCoverageDigest: computeCanonicalJsonFingerprint([old.inventory.sourceSpanCoverageDigest, current.inventory.sourceSpanCoverageDigest]),
    changedSectionKeysDigest: computeCanonicalJsonFingerprint(changes.filter((entry) => entry.kind !== "UNCHANGED").map((entry) => entry.sectionKey)),
    preambleChanged, counts, changes });
  verifiedDiffs.add(diff);
  return diff;
}

/** Checks only locally recomputable bindings; external reference authentication belongs to Runtime. */
export function validateRequirementsGoverningDeltaProof(proof: RequirementsGoverningDeltaProofV1, diff: RequirementsSectionDiffV1): void {
  const bindings = [[proof.oldFullDocumentDigest, diff.oldFullDocumentDigest], [proof.newFullDocumentDigest, diff.newFullDocumentDigest],
    [proof.oldSectionInventoryDigest, diff.oldInventoryDigest], [proof.newSectionInventoryDigest, diff.newInventoryDigest],
    [proof.completeSectionDiffDigest, diff.fullDiffDigest], [proof.sectionDiffCoverageDigest, diff.fullDiffCoverageDigest]];
  if (!verifiedDiffs.has(diff) || bindings.some(([claimed, actual]) => claimed !== actual) ||
      [proof.oldManifestDigest, proof.newManifestDigest, proof.canonicalMappingDigest, proof.coveredLineageSetDigest,
        proof.affectedReferenceSetDigest].some((digest) => !/^[a-f0-9]{64}$/.test(digest))) {
    throw new RequirementsSectionInventoryError("invalid_proof");
  }
}
