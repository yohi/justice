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
  readonly requirementsPath?: string;
  readonly legacyRetryOption?: number;
}

/**
 * RTY1: stable, observable public diagnostic for the deprecated `--retry`
 * option. Returned by `reviewGateCommandWarnings` for any parsed request that
 * carries `legacyRetryOption`, so hosts can surface it on the Justice command
 * response rather than only in internal logs. The text itself states the
 * no-op contract: the option never alters Design 5 / Plan 3 budgets, Gate
 * identity, protocol fingerprints, epoch, admission decisions or history.
 */
export const RETRY_DEPRECATED_WARNING =
  "[JUSTICE: RETRY_DEPRECATED] The --retry option is deprecated and ignored. Remediation budgets remain the fixed Design 5 / Plan 3 absolute limits per generation; --retry never changes Gate identity, budgets, protocol fingerprints, epoch, admission decisions or history.";

/**
 * Public command-boundary warning diagnostics for a parsed Review Gate
 * request. Pure and deterministic: identical requests always yield identical
 * diagnostics, and a request without `legacyRetryOption` yields none.
 */
export function reviewGateCommandWarnings(
  request: ReviewGateRequest,
): readonly string[] {
  return request.legacyRetryOption === undefined ? [] : [RETRY_DEPRECATED_WARNING];
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
  let requirementsPath: string | null = null;
  let i = 0;

  while (i < args.length) {
    const arg = args.at(i);
    if (arg === undefined) break;

    let target: "design" | "plan" | "requirements" | "retry";
    switch (arg) {
      case "--design":
        target = "design";
        break;
      case "--plan":
        target = "plan";
        break;
      case "--requirements":
        target = "requirements";
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
    } else if (target === "plan") {
      if (planPath !== null) return null;
      planPath = normalized;
    } else {
      if (requirementsPath !== null) return null;
      requirementsPath = normalized;
    }

    i += 2;
  }

  if (designPath === null || planPath === null) return null;
  return {
    source: "command",
    designPath,
    planPath,
    ...(legacyRetryOption === undefined ? {} : { legacyRetryOption }),
    ...(requirementsPath === null ? {} : { requirementsPath }),
  };
}
