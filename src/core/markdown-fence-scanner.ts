/**
 * Shared Markdown fenced-code scanner (ARCH-10).
 *
 * Grammar, with LF and CRLF treated equivalently:
 * - Opening fence: 0..3 leading spaces, then a run of 3+ backticks or 3+ tildes,
 *   then an optional language info string. A backtick fence's info string must
 *   not contain a backtick ("language info where valid"); tilde info is free-form.
 * - Closing fence: 0..3 leading spaces, then a run of the same character that is
 *   at least as long as the opening run, followed only by horizontal whitespace.
 *
 * `insideFence` is true for the opening delimiter and every line up to (but not
 * including) the matching closing delimiter, so fenced headings and
 * `**Interfaces:**` markers never create tasks or dependencies.
 */

/** A single physical line annotated with its shared fence state. */
export interface MarkdownFenceLine {
  /** Line content without its LF/CRLF terminator. */
  readonly line: string;
  /** 1-based physical line number. */
  readonly lineNumber: number;
  /** Whether the line belongs to an open fenced code block. */
  readonly insideFence: boolean;
}

const FENCE_OPEN_REGEX = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE_REGEX = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

interface OpenFence {
  readonly marker: "`" | "~";
  readonly length: number;
}

function parseOpeningFence(line: string): OpenFence | null {
  const match = FENCE_OPEN_REGEX.exec(line);
  if (match === null) return null;

  const run = match[1];
  const info = match[2];
  if (run === undefined || info === undefined) return null;

  const marker = run[0];
  if (marker !== "`" && marker !== "~") return null;

  // A backtick opening fence's info string may not contain a backtick.
  if (marker === "`" && info.includes("`")) return null;

  return { marker, length: run.length };
}

function isClosingFence(line: string, fence: OpenFence): boolean {
  const match = FENCE_CLOSE_REGEX.exec(line);
  if (match === null) return false;

  const run = match[1];
  if (run === undefined) return false;

  return run[0] === fence.marker && run.length >= fence.length;
}

/**
 * Scan Markdown text and report each physical line with its fence state.
 *
 * @param text Markdown source; LF and CRLF are both accepted.
 * @returns One entry per physical line, in order.
 */
export function scanMarkdownFenceLines(text: string): ReadonlyArray<MarkdownFenceLine> {
  const lines = text.split(/\r?\n/);
  const result: MarkdownFenceLine[] = [];
  let fence: OpenFence | null = null;

  for (let i = 0; i < lines.length; i++) {
    // eslint-disable-next-line security/detect-object-injection -- index is bounded by the loop.
    const line = lines[i] ?? "";
    const lineNumber = i + 1;

    if (fence !== null) {
      if (isClosingFence(line, fence)) {
        fence = null;
        result.push({ line, lineNumber, insideFence: false });
      } else {
        result.push({ line, lineNumber, insideFence: true });
      }
      continue;
    }

    const opening = parseOpeningFence(line);
    if (opening !== null) {
      fence = opening;
      result.push({ line, lineNumber, insideFence: true });
    } else {
      result.push({ line, lineNumber, insideFence: false });
    }
  }

  return result;
}
