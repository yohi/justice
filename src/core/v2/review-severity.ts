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
  workspaceRoot?: string,
): string {
  let canonicalLocation = location.replace(/\\/g, "/").trim();
  const canonicalWorkspaceRoot = workspaceRoot?.replace(/\\/g, "/").trim().replace(/\/+$/u, "");
  if (
    canonicalWorkspaceRoot &&
    (canonicalLocation === canonicalWorkspaceRoot ||
      canonicalLocation.startsWith(`${canonicalWorkspaceRoot}/`))
  ) {
    canonicalLocation = canonicalLocation.slice(canonicalWorkspaceRoot.length);
  }
  canonicalLocation = canonicalLocation.replace(/^\/+/, "");
  if (canonicalLocation.startsWith("./")) {
    canonicalLocation = canonicalLocation.slice(2);
  }
  const locationHash = hashString(canonicalLocation)
    .replace(/^sha256:/u, "")
    .slice(0, 12);
  return `${severity}:${ruleId}:${locationHash}:${evidenceHash}`;
}
