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

  let planPath: string | null = null;
  let approved = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args.at(i);
    if (arg === undefined) break;

    if (arg === "--plan") {
      if (planPath !== null) return null; // duplicate flag
      const next = args.at(i + 1);
      if (next === undefined) return null; // missing value
      if (next.startsWith("--")) return null;
      planPath = normalizeSafeRelativePath(next);
      if (planPath === null) return null; // unsafe path
      i++; // consume value
      continue;
    }

    if (arg.startsWith("--plan=")) {
      return null; // unsupported value-attached form
    }

    if (arg === "--approved") {
      if (approved) return null; // duplicate flag
      approved = true;
      continue;
    }

    // Unknown flag or positional argument: reject strictly.
    return null;
  }

  if (planPath === null) return null;

  return {
    source: "command",
    planPath,
    approved,
  };
}
