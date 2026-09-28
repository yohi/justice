import { normalizeCommandArtifactPath } from "./trigger-detector";

export const JUSTICE_REVIEW_GATE_COMMAND = "justice-review-gate";

export interface JusticeReviewGateRequest {
  readonly source: "command";
  readonly designPath: string | null;
  readonly planPath: string;
}

export function isJusticeReviewGateCommand(commandName: string | undefined): boolean {
  if (commandName === undefined) return false;
  const trimmed = commandName.trim();
  const withoutSlash = trimmed.startsWith("/") ? trimmed.slice(1) : trimmed;
  return withoutSlash === JUSTICE_REVIEW_GATE_COMMAND;
}

export function parseJusticeReviewGateCommandArguments(
  argumentsString: string,
): JusticeReviewGateRequest | null {
  const args = argumentsString.trim().split(/\s+/).filter(Boolean);
  let designPath: string | null = null;
  let planPath: string | null = null;
  let i = 0;

  while (i < args.length) {
    const flag = args.at(i);
    const rawValue = args.at(i + 1);
    if (flag === undefined) break;

    if (flag !== "--design" && flag !== "--plan") return null;
    if (rawValue === undefined || rawValue.startsWith("--")) return null;

    const normalized = normalizeCommandArtifactPath(rawValue);
    if (normalized === null) return null;

    if (flag === "--design") {
      if (designPath !== null) return null;
      designPath = normalized;
    } else {
      if (planPath !== null) return null;
      planPath = normalized;
    }
    i += 2;
  }

  if (planPath === null) return null;
  return { source: "command", designPath, planPath };
}
