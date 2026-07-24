import { hashString } from "./hash";

const CRITICAL = /security|vulnerability|data ?loss|破壊的|重大|blocker|blocking|ブロッカー/i;
const MAJOR = /must fix|required|bug|regression|要修正|不具合/i;
const MINOR = /nit|suggestion|optional|style|軽微|提案/i;

export type ReviewSeverity = "critical" | "major" | "minor";

export function classifySeverity(summary: string, heading?: string): ReviewSeverity {
  const source = heading ?? summary;
  if (CRITICAL.test(source)) return "critical";
  if (MAJOR.test(source)) return "major";
  if (MINOR.test(source)) return "minor";
  return "minor";
}

export function deriveItemKey(
  severity: ReviewSeverity,
  ruleId: string,
  location: string,
  evidenceHash: string,
  workspaceRoot?: string,
): string {
  const finalLocation = normalizeLocationForKey(location, workspaceRoot);
  const locationHash = hashString(finalLocation)
    .replace(/^sha256:/u, "")
    .slice(0, 12);
  return `${severity}:${ruleId}:${locationHash}:${evidenceHash}`;
}

export function normalizeLocationForKey(location: string, workspaceRoot?: string): string {
  const canonicalLocation = location.replace(/\\/g, "/").trim();
  const strippedRoot = stripTrailingSlashes(workspaceRoot?.replace(/\\/g, "/").trim());
  const rootStrippedLocation =
    strippedRoot &&
    (canonicalLocation === strippedRoot || canonicalLocation.startsWith(`${strippedRoot}/`))
      ? canonicalLocation.slice(strippedRoot.length)
      : canonicalLocation;
  const leadingSlashStrippedLocation = rootStrippedLocation.replace(/^\/+/, "");
  return leadingSlashStrippedLocation.startsWith("./")
    ? leadingSlashStrippedLocation.slice(2)
    : leadingSlashStrippedLocation;
}

function stripTrailingSlashes(value: string | undefined): string | undefined {
  if (!value) return value;
  let result = value;
  while (result.endsWith("/")) {
    result = result.slice(0, -1);
  }
  return result;
}
