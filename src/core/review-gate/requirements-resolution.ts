/**
 * Requirements source selection (Design §10.2.1–§10.2.3, DEP-04).
 *
 * Pure, host-independent parser/selector: no I/O, no Git access, no workspace
 * reads. Git-tracked, clean, committed verification of the selected artifact
 * happens later under admission ownership; this module only fixes the
 * authoritative *selector* so admission can fail closed with
 * `REQUIREMENTS_RESOLUTION_REQUIRED` before `GATE_CREATED`.
 */

import { scanMarkdownFenceLines } from "../markdown-fence-scanner.js";
import { normalizeCommandArtifactPath } from "../trigger-detector.js";
import { computeArtifactDigest } from "./identity.js";

/** Maximum UTF-8 bytes for a declared Requirements path. The ASCII marker grammar guarantees one byte per character. */
const MAX_DECLARED_PATH_BYTES = 4096;

/** The declaration must live within the first N physical lines of the document. */
const PREAMBLE_MAX_PHYSICAL_LINES = 64;

/**
 * The first unfenced ATX H2/H3 bounds the Design preamble. The optional H1 and
 * deeper (H4+) headings do not bound it; fenced pseudo headings never do.
 */
const H2_H3_HEADING_REGEX = /^ {0,3}#{2,3}(?:[ \t]|$)/;

/**
 * Reserved declaration prefix. Any unfenced line whose horizontal-trimmed
 * content starts with this exact (case-sensitive) prefix is a marker
 * occurrence and must satisfy the full grammar; anything else is prose.
 */
const MARKER_PREFIX = "<!-- justice-review-gate:requirements=";

/**
 * Full reserved marker grammar. Exact case, ASCII punctuation and internal
 * spaces; the declared path matches the ASCII workspace-relative `.md` rule.
 * Quotes, spaces, `%`/URL escaping, `@`, `~`, fragments, queries and shell
 * expansions are not supported inside a marker.
 */
const MARKER_REGEX =
  /^<!-- justice-review-gate:requirements="([A-Za-z0-9][A-Za-z0-9._/-]*\.md)" -->$/;

/**
 * Design Requirements declaration outcome.
 *
 * - `none`: no unfenced reserved marker occurs anywhere in the document.
 * - `selected`: exactly one grammar-valid unfenced marker inside the preamble
 *   window (first 64 physical lines before the first unfenced H2/H3).
 * - `invalid`: any unfenced reserved-marker occurrence is malformed, placed
 *   outside the preamble window, or duplicated (even with an identical value).
 *   No first/last/nearest fallback is applied.
 */
export type DesignRequirementsDeclaration =
  | Readonly<{ kind: "none" }>
  | Readonly<{
      kind: "selected";
      canonicalPath: string;
      line: number;
      markerDigest: string;
    }>
  | Readonly<{ kind: "invalid"; reason: string }>;

/** Authoritative Requirements source selection outcome (fail closed). */
export type RequirementsSourceSelection =
  | Readonly<{
      kind: "selected";
      source: "explicit" | "design_declared_reference";
      canonicalPath: string;
    }>
  | Readonly<{ kind: "blocked"; reason: "REQUIREMENTS_RESOLUTION_REQUIRED" }>;

/** Input to `selectRequirementsSource`. */
export interface RequirementsSourceInput {
  /** Canonical workspace-relative Requirements path from the explicit CLI selector, if any. */
  readonly explicitPath?: string;
  /** Parsed Design declaration from `parseDesignRequirementsDeclaration`. */
  readonly declaration: DesignRequirementsDeclaration;
}

const textEncoder = new TextEncoder();

function trimHorizontalWhitespace(line: string): string {
  return line.replace(/^[ \t]+/, "").replace(/[ \t]+$/, "");
}

function isMarkerOccurrence(line: string): boolean {
  return trimHorizontalWhitespace(line).startsWith(MARKER_PREFIX);
}

interface ParsedMarkerLine {
  readonly ok: true;
  readonly canonicalPath: string;
}

interface RejectedMarkerLine {
  readonly ok: false;
  readonly reason: string;
}

function parseMarkerLine(line: string): ParsedMarkerLine | RejectedMarkerLine {
  const match = MARKER_REGEX.exec(trimHorizontalWhitespace(line));
  if (match === null) {
    return {
      ok: false,
      reason: "does not match the exact reserved marker grammar",
    };
  }

  const declaredPath = match[1];
  if (declaredPath === undefined) {
    return { ok: false, reason: "declared path is missing" };
  }

  if (declaredPath.length > MAX_DECLARED_PATH_BYTES) {
    return { ok: false, reason: "declared path exceeds 4096 bytes" };
  }

  const canonicalPath = normalizeCommandArtifactPath(declaredPath);
  if (canonicalPath === null) {
    return {
      ok: false,
      reason: "declared path is not a safe canonical workspace-relative path",
    };
  }

  return { ok: true, canonicalPath };
}

function isInPreamble(
  lineNumber: number,
  firstUnfencedH2H3Line: number | null,
): boolean {
  return (
    lineNumber <= PREAMBLE_MAX_PHYSICAL_LINES &&
    (firstUnfencedH2H3Line === null || lineNumber < firstUnfencedH2H3Line)
  );
}

/**
 * Parse the Design document for the exactly-one Requirements declaration.
 *
 * The whole document is scanned with the shared fence-aware scanner so fenced
 * marker-looking lines are never selectors and fenced pseudo headings never
 * bound the preamble. `markerDigest` is the SHA-256 digest of the exact marker
 * line without its LF/CRLF terminator (line endings are equivalent).
 */
export function parseDesignRequirementsDeclaration(
  design: string,
): DesignRequirementsDeclaration {
  const scannedLines = scanMarkdownFenceLines(design);

  let firstUnfencedH2H3Line: number | null = null;
  for (const entry of scannedLines) {
    if (!entry.insideFence && H2_H3_HEADING_REGEX.test(entry.line)) {
      firstUnfencedH2H3Line = entry.lineNumber;
      break;
    }
  }

  const candidates: {
    readonly line: number;
    readonly canonicalPath: string;
    readonly markerLine: string;
  }[] = [];
  for (const entry of scannedLines) {
    if (entry.insideFence || !isMarkerOccurrence(entry.line)) continue;

    const parsedMarkerLine = parseMarkerLine(entry.line);
    if (!parsedMarkerLine.ok) {
      return {
        kind: "invalid",
        reason: `malformed reserved Requirements declaration at line ${entry.lineNumber}: ${parsedMarkerLine.reason}`,
      };
    }
    candidates.push({
      line: entry.lineNumber,
      canonicalPath: parsedMarkerLine.canonicalPath,
      markerLine: entry.line,
    });
  }

  if (candidates.length === 0) return { kind: "none" };

  if (candidates.length > 1) {
    return {
      kind: "invalid",
      reason: `multiple reserved Requirements declarations (${candidates.length} occurrences); the Design must contain exactly one`,
    };
  }

  const declaration = candidates[0];
  if (declaration === undefined) return { kind: "none" };

  if (!isInPreamble(declaration.line, firstUnfencedH2H3Line)) {
    return {
      kind: "invalid",
      reason: "reserved Requirements declaration outside the Design preamble (first 64 physical lines before the first unfenced H2/H3)",
    };
  }

  return {
    kind: "selected",
    canonicalPath: declaration.canonicalPath,
    line: declaration.line,
    markerDigest: computeArtifactDigest(textEncoder.encode(declaration.markerLine)),
  };
}

/**
 * Resolve the authoritative Requirements selector with explicit precedence and
 * mandatory agreement (Design §10.2.3 rule 3):
 *
 * - An invalid declaration blocks even when an explicit CLI path is supplied.
 * - Explicit CLI path only selects `explicit`.
 * - A unique valid declaration without a CLI path selects
 *   `design_declared_reference`.
 * - When both exist, the explicit source is kept only if the canonical paths
 *   agree; disagreement blocks instead of silently preferring either side.
 * - Unsafe explicit paths block; the canonical serialization must already be
 *   exact (the CLI parser normalizes before this selector runs).
 */
export function selectRequirementsSource(
  input: RequirementsSourceInput,
): RequirementsSourceSelection {
  const { declaration } = input;
  const explicitPath = input.explicitPath;

  if (declaration.kind === "invalid") {
    return { kind: "blocked", reason: "REQUIREMENTS_RESOLUTION_REQUIRED" };
  }

  if (explicitPath !== undefined) {
    const canonicalExplicitPath = normalizeCommandArtifactPath(explicitPath);
    if (canonicalExplicitPath === null || canonicalExplicitPath !== explicitPath) {
      return { kind: "blocked", reason: "REQUIREMENTS_RESOLUTION_REQUIRED" };
    }
  }

  if (declaration.kind === "none") {
    if (explicitPath === undefined) {
      return { kind: "blocked", reason: "REQUIREMENTS_RESOLUTION_REQUIRED" };
    }
    return { kind: "selected", source: "explicit", canonicalPath: explicitPath };
  }

  if (explicitPath === undefined) {
    return {
      kind: "selected",
      source: "design_declared_reference",
      canonicalPath: declaration.canonicalPath,
    };
  }

  if (explicitPath !== declaration.canonicalPath) {
    return { kind: "blocked", reason: "REQUIREMENTS_RESOLUTION_REQUIRED" };
  }

  return { kind: "selected", source: "explicit", canonicalPath: explicitPath };
}
