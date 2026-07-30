import type { ImplementationArmRequest } from "./types";
import { normalizeSafeRelativePath } from "./trigger-detector";

export const JUSTICE_IMPLEMENT_COMMAND = "justice-implement";

interface ParsedPlanFlag {
  readonly planPath: string;
  readonly nextIndex: number;
}

function parsePlanFlag(
  args: readonly string[],
  flagIndex: number,
  currentPlanPath: string | null,
): ParsedPlanFlag | null {
  if (currentPlanPath !== null) return null;

  const value = args.at(flagIndex + 1);
  if (value === undefined) return null;
  if (value.startsWith("--")) return null;

  const planPath = normalizeSafeRelativePath(value);
  if (planPath === null) return null;

  return { planPath, nextIndex: flagIndex + 1 };
}

export function isJusticeImplementCommand(commandName: string | undefined): boolean {
  if (commandName === undefined) return false;
  const trimmed = commandName.trim();
  const withoutSlash = trimmed.startsWith("/") ? trimmed.slice(1) : trimmed;
  return withoutSlash === JUSTICE_IMPLEMENT_COMMAND;
}

export function parseJusticeImplementCommandArguments(
  argumentsString: string,
): ImplementationArmRequest | null {
  const args = argumentsString.trim().split(/\s+/).filter(Boolean);

  let planPath: string | null = null;
  let approved = false;
  let i = 0;

  while (i < args.length) {
    const arg = args.at(i);
    if (arg === undefined) break;

    switch (arg) {
      case "--plan": {
        const parsedPlan = parsePlanFlag(args, i, planPath);
        if (parsedPlan === null) return null;
        planPath = parsedPlan.planPath;
        i = parsedPlan.nextIndex + 1;
        continue;
      }
      case "--approved":
        if (approved) return null;
        approved = true;
        i += 1;
        continue;
      default:
        return null;
    }
  }

  if (planPath === null) return null;

  return {
    source: "command",
    planPath,
    approved,
  };
}
