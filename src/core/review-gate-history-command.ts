/**
 * `/justice-review-history` command parser and result executor
 * (convergence Task 13).
 *
 * Grammar:
 * ```
 * /justice-review-history --design <path> --plan <path> [--view summary|rounds|findings] [--all-generations]
 * /justice-review-history --gate <gateId> [--view summary|rounds|findings]
 * ```
 *
 * `--gate` and `--design`+`--plan` are mutually exclusive; `--all-generations`
 * is valid only on the scope form. Paths use the shared artifact path
 * normalization (absolute / traversal / backslash paths are rejected).
 *
 * This module is pure: it parses arguments and renders the canonical guidance
 * text from a `ReviewHistoryQueryResult`. It performs no I/O and neither
 * acquires a Gate lock, appends events, nor resolves validators/artifacts.
 */

import { normalizeCommandArtifactPath } from "./trigger-detector";
import { validateStorageGateId } from "./review-gate/identity";
import {
  renderHistoryDisplayText,
  type ReviewHistoryFailureKind,
  type ReviewHistoryQueryResult,
  type ReviewHistoryView,
} from "./review-gate/history";

export const JUSTICE_REVIEW_HISTORY_COMMAND = "justice-review-history";

export type ReviewHistoryRequest =
  | Readonly<{
      readonly kind: "scope";
      readonly designPath: string;
      readonly planPath: string;
      readonly view: ReviewHistoryView;
      readonly allGenerations: boolean;
    }>
  | Readonly<{
      readonly kind: "gate";
      readonly gateId: string;
      readonly view: ReviewHistoryView;
    }>;

const VIEW_VALUES: readonly string[] = ["summary", "rounds", "findings"];

export function isJusticeReviewHistoryCommand(commandName: string | undefined): boolean {
  if (commandName === undefined) return false;
  const trimmed = commandName.trim();
  const withoutSlash = trimmed.startsWith("/") ? trimmed.slice(1) : trimmed;
  return withoutSlash === JUSTICE_REVIEW_HISTORY_COMMAND;
}

interface ReviewHistoryParseState {
  readonly kind: "scope" | "gate" | "unset";
  readonly designPath: string | null;
  readonly planPath: string | null;
  readonly gateId: string | null;
  readonly view: ReviewHistoryView;
  readonly allGenerations: boolean;
}

export function parseJusticeReviewHistoryCommandArguments(
  argumentsString: string,
): ReviewHistoryRequest | null {
  const args = argumentsString.trim().split(/\s+/).filter(Boolean);

  let state: ReviewHistoryParseState = {
    kind: "unset",
    designPath: null,
    planPath: null,
    gateId: null,
    view: "summary",
    allGenerations: false,
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === undefined) break;

    switch (arg) {
      case "--design":
      case "--plan": {
        if (state.kind === "gate") return null;
        const value = args[i + 1];
        if (value === undefined || value.startsWith("-")) return null;
        const normalized = normalizeCommandArtifactPath(value);
        if (normalized === null) return null;
        if (arg === "--design") {
          if (state.designPath !== null) return null;
          state = { ...state, kind: "scope", designPath: normalized };
        } else {
          if (state.planPath !== null) return null;
          state = { ...state, kind: "scope", planPath: normalized };
        }
        i += 2;
        continue;
      }
      case "--gate": {
        if (state.designPath !== null || state.planPath !== null || state.gateId !== null) {
          return null;
        }
        const value = args[i + 1];
        if (value === undefined || value.startsWith("-")) return null;
        if (!validateStorageGateId(value)) return null;
        state = { ...state, kind: "gate", gateId: value };
        i += 2;
        continue;
      }
      case "--view": {
        const value = args[i + 1];
        if (value === undefined || value.startsWith("-")) return null;
        const parsedView = VIEW_VALUES.find((candidate) => candidate === value);
        if (parsedView === undefined) return null;
        state = { ...state, view: parsedView as ReviewHistoryView };
        i += 2;
        continue;
      }
      case "--all-generations": {
        if (state.kind === "gate") return null;
        if (state.allGenerations) return null;
        state = { ...state, allGenerations: true };
        i += 1;
        continue;
      }
      default:
        return null;
    }
  }

  if (state.kind === "gate") {
    if (state.gateId === null) return null;
    return Object.freeze({
      kind: "gate",
      gateId: state.gateId,
      view: state.view,
    });
  }

  if (state.designPath === null || state.planPath === null) return null;
  return Object.freeze({
    kind: "scope",
    designPath: state.designPath,
    planPath: state.planPath,
    view: state.view,
    allGenerations: state.allGenerations,
  });
}

const FAILURE_HEADINGS: Readonly<Record<ReviewHistoryFailureKind, string>> = {
  not_found: "NOT FOUND",
  conflict: "CONFLICT",
  unsupported_version: "VERSION NOT SUPPORTED",
  unavailable: "UNAVAILABLE",
};

/**
 * Render the canonical synthetic guidance for a history query result.
 * Failures never carry DTO content — only the failure kind and reason code —
 * so a broken history can never surface as a partial display.
 */
export function renderReviewHistoryCommandGuidance(result: ReviewHistoryQueryResult): string {
  if (result.kind === "failure") {
    return [
      "---",
      `[JUSTICE: REVIEW HISTORY ${FAILURE_HEADINGS[result.failure]}]`,
      "",
      result.message,
      "No Gate history is displayed for a failed query.",
      "---",
    ].join("\n");
  }
  return renderHistoryDisplayText(result.payload);
}
