import { hashString } from "./hash";

const CRITICAL = /security|vulnerability|data ?loss|破壊的|重大/i;
const MAJOR = /must fix|required|bug|regression|要修正|不具合/i;
const MINOR = /nit|suggestion|optional|style|軽微|提案/i;

export type ReviewSeverity = "critical" | "major" | "minor";

export function classifySeverity(summary: string): ReviewSeverity {
  if (CRITICAL.test(summary)) return "critical";
  if (MAJOR.test(summary)) return "major";
  if (MINOR.test(summary)) return "minor";
  return "minor";
}

export function deriveItemKey(
  severity: ReviewSeverity,
  ruleId: string,
  location: string,
  evidenceHash: string,
): string {
  const cwd =
    typeof process !== "undefined" ? process.cwd().replace(/\\/g, "/") : "";
  let canonicalLocation = location.replace(/\\/g, "/").trim();
  if (cwd && (canonicalLocation.startsWith(`${cwd}/`) || canonicalLocation === cwd)) {
    canonicalLocation = canonicalLocation.slice(cwd.length);
  }
  canonicalLocation = canonicalLocation.replace(/^\/+/, "");
  if (canonicalLocation.startsWith("./")) {
    canonicalLocation = canonicalLocation.slice(2);
  }
  const locationHash = hashString(canonicalLocation).slice(
    "sha256:".length,
    "sha256:".length + 12,
  );
  return `${severity}:${ruleId}:${locationHash}:${evidenceHash}`;
}
