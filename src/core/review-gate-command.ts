import { normalizeCommandArtifactPath } from "./trigger-detector";

export const JUSTICE_REVIEW_GATE_COMMAND = "justice-review-gate";

export interface ReviewGateRequest {
  readonly source: "command";
  readonly designPath: string;
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
): ReviewGateRequest | null {
  const args = argumentsString.trim().split(/\s+/).filter(Boolean);

  let designPath: string | null = null;
  let planPath: string | null = null;
  let i = 0;

  while (i < args.length) {
    const arg = args.at(i);
    if (arg === undefined) break;

    let target: "design" | "plan";
    switch (arg) {
      case "--design":
        target = "design";
        break;
      case "--plan":
        target = "plan";
        break;
      default:
        return null;
    }

    const value = args.at(i + 1);
    if (value === undefined || value.startsWith("-")) return null;
    const normalized = normalizeCommandArtifactPath(value);
    if (normalized === null) return null;

    if (target === "design") {
      if (designPath !== null) return null;
      designPath = normalized;
    } else {
      if (planPath !== null) return null;
      planPath = normalized;
    }

    i += 2;
  }

  if (designPath === null || planPath === null) return null;
  return { source: "command", designPath, planPath };
}
