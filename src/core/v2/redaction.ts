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
  const redacted = detector.redact(text); // covers API keys / secrets
  return truncate(
    redactTokenUrls(redactEnvironmentValues(redactAbsolutePaths(redacted))),
    4096,
  );
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  let end = maxLength;
  // Avoid splitting a surrogate pair at the boundary, which would leave a lone high
  // surrogate and yield ill-formed UTF-16. Preserves the code-unit budget.
  const lastCode = text.charCodeAt(end - 1);
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) end -= 1;
  return text.slice(0, end) + "\n…[truncated]";
}
