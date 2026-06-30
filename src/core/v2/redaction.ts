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

export function redactForPersistence(text: string, detector = new SecretPatternDetector()): string {
  const redacted = detector.redact(text); // covers API keys / secrets
  return truncate(
    redactTokenUrls(redactEnvironmentValues(redactAbsolutePaths(redacted))),
    4096,
  );
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "\n…[truncated]";
}
