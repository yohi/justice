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
  const canonicalLocation = location.replace(/\\/g, "/").trim();
  const strippedRoot = stripTrailingSlashes(
    workspaceRoot?.replace(/\\/g, "/").trim(),
  );
  const rootStrippedLocation =
    strippedRoot &&
    (canonicalLocation === strippedRoot ||
      canonicalLocation.startsWith(`${strippedRoot}/`))
      ? canonicalLocation.slice(strippedRoot.length)
      : canonicalLocation;
  const leadingSlashStrippedLocation = rootStrippedLocation.replace(/^\/+/, "");
  const finalLocation = leadingSlashStrippedLocation.startsWith("./")
    ? leadingSlashStrippedLocation.slice(2)
    : leadingSlashStrippedLocation;
  const locationHash = hashString(finalLocation)
    .replace(/^sha256:/u, "")
    .slice(0, 12);
  return `${severity}:${ruleId}:${locationHash}:${evidenceHash}`;
}

function stripTrailingSlashes(value: string | undefined): string | undefined {
  if (!value) return value;
  let result = value;
  while (result.endsWith("/")) {
    result = result.slice(0, -1);
  }
  return result;
}
