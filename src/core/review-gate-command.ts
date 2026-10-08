import { normalizeCommandArtifactPath } from "./trigger-detector";

export const JUSTICE_REVIEW_GATE_COMMAND = "justice-review-gate";
export const MAX_REVIEW_GATE_RETRIES = 10;

/**
 * RTY1: `--retry N` stays parser-compatible but is deprecated and a no-op.
 * The parsed value is retained as `legacyRetryOption` for compatibility
 * assertions only; it never alters Design/Plan budgets, creates an epoch,
 * bypasses NON_CONVERGENT, alters protocol fingerprints, or mutates history.
 */
export interface ReviewGateRequest {
  readonly source: "command";
  readonly designPath: string;
  readonly planPath: string;
  readonly legacyRetryOption?: number;
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
  let legacyRetryOption: number | undefined;
  let i = 0;

  while (i < args.length) {
    const arg = args.at(i);
    if (arg === undefined) break;

    let target: "design" | "plan" | "retry";
    switch (arg) {
      case "--design":
        target = "design";
        break;
      case "--plan":
        target = "plan";
        break;
      case "--retry":
        target = "retry";
        break;
      default:
        return null;
    }

    const value = args.at(i + 1);
    if (value === undefined || value.startsWith("-")) return null;

    if (target === "retry") {
      if (legacyRetryOption !== undefined || !/^\d+$/u.test(value)) return null;
      const parsedLegacyRetryOption = Number(value);
      if (
        !Number.isSafeInteger(parsedLegacyRetryOption) ||
        parsedLegacyRetryOption > MAX_REVIEW_GATE_RETRIES
      ) {
        return null;
      }
      legacyRetryOption = parsedLegacyRetryOption;
      i += 2;
      continue;
    }

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
  return {
    source: "command",
    designPath,
    planPath,
    ...(legacyRetryOption === undefined ? {} : { legacyRetryOption }),
  };
}
