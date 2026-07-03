// src/core/v2/redaction.ts
import { SecretPatternDetector } from "../secret-pattern-detector";

const DEFAULT_DETECTOR = new SecretPatternDetector();

export function redactEvidenceCommand(command: string): string {
  return redactForPersistence(command, DEFAULT_DETECTOR);
}

export function redactRawOutput(rawOutput: string): string {
  return redactForPersistence(rawOutput, DEFAULT_DETECTOR);
}

export function redactMessageSnippet(snippet: string): string {
  return redactForPersistence(snippet, DEFAULT_DETECTOR);
}

export function redactAbsolutePaths(text: string): string {
  return text
    .replace(/(^|[\s=])((?:\/|~\/|[A-Za-z]:\\|\\\\)[^\s"']+)/g, "$1[REDACTED_PATH]")
    .replace(/(["'])(?:(?:\/|~\/|[A-Za-z]:\\|\\\\)[^"']+)\1/g, "$1[REDACTED_PATH]$1");
}

export function redactEnvironmentValues(text: string): string {
  // Known gap (spec-faithful): [A-Z_]{3,} intentionally skips env var names containing
  // digits (e.g. HTTP2_PROXY, S3_BUCKET, NODE_V8_COVERAGE). Secret-shaped values are still
  // caught by SecretPatternDetector.redact; this pass only redacts plain NAME=value pairs.
  return text.replace(/\b[A-Z_]{3,}=[^\s"']+/g, "[REDACTED_ENV]");
}
export function redactTokenUrls(text: string): string {
  // Redact the entire token URL to prevent leaking userinfo (user:token) credentials (D61)
  return text.replace(/https?:\/\/[^@\s]+@[^\s"']+/g, "[REDACTED_TOKEN_URL]");
}

export function redactForPersistence(text: string, detector = DEFAULT_DETECTOR): string {
  // Structural passes run FIRST: they rely on NAME=value / path / URL shapes that
  // detector.redact() would otherwise destroy by masking keyword-like names (e.g.
  // GITHUB_TOKEN matches the `token` pattern), which would let the value leak past
  // redactEnvironmentValues. Applying detector.redact() LAST still catches bare
  // secret-shaped values (sk-…) that have no NAME= structure.
  const structured = redactTokenUrls(redactEnvironmentValues(redactAbsolutePaths(text)));
  return truncate(detector.redact(structured), 4096);
}

/**
 * Surrogate-safe prefix slice: returns the first `maxLength` UTF-16 code units without
 * splitting a surrogate pair at the boundary (a lone high surrogate would yield ill-formed
 * UTF-16). Shared by truncate() and by evidence snippet generation (evidence-engine).
 */
export function sliceCodeUnitsSafe(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  let end = maxLength;
  const lastCode = text.charCodeAt(end - 1);
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) end -= 1;
  return text.slice(0, end);
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return sliceCodeUnitsSafe(text, maxLength) + "\n…[truncated]";
}
