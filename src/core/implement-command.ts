import type { ImplementationArmRequest } from "./types";
import { normalizeSafeRelativePath } from "./trigger-detector";

export const JUSTICE_IMPLEMENT_COMMAND = "justice-implement";

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

  const planFlagIndex = args.indexOf("--plan");
  if (planFlagIndex === -1) {
    return null;
  }

  const planPathRaw = args[planFlagIndex + 1];
  if (planPathRaw === undefined) return null;

  const planPath = normalizeSafeRelativePath(planPathRaw);
  if (planPath === null) return null;

  const approved = args.includes("--approved");

  return {
    source: "command",
    planPath,
    approved,
  };
}
