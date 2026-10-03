export type ReviewGateLockPhase =
  | "reviewing"
  | "remediation"
  | "awaiting_implementation_authorization";

export interface ReviewGateLockSnapshot {
  readonly parentSessionId: string;
  readonly gateId: string;
  readonly phase: ReviewGateLockPhase;
  readonly designPath: string | null;
  readonly planPath: string | null;
  readonly designDigest: string | null;
  readonly planDigest: string | null;
}

export interface ReviewGateToolUse {
  readonly lockOwnerSessionId: string | null;
  readonly toolName: string;
  readonly isPendingReviewGateTask: boolean;
  readonly queryOnly: boolean;
  readonly changedPaths: readonly string[] | null;
}

export type ReviewGateToolDecision =
  | { readonly kind: "allow" }
  | {
      readonly kind: "deny";
      readonly reason: "implementation_not_authorized" | "review_scope_violation";
    };

const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  "read",
  "glob",
  "grep",
  "list",
  "lsp_symbols",
  "lsp_goto_definition",
  "lsp_find_references",
  "lsp_diagnostics",
  "justice_status",
  "skill",
]);

const REVIEW_ARTIFACT_WRITE_TOOLS: ReadonlySet<string> = new Set([
  "edit",
  "write",
  "filesystem_edit_file",
  "filesystem_write_file",
  "apply_patch",
]);

function denied(
  reason: "implementation_not_authorized" | "review_scope_violation",
): ReviewGateToolDecision {
  return { kind: "deny", reason };
}

export function classifyReviewGateToolUse(
  lock: ReviewGateLockSnapshot,
  use: ReviewGateToolUse,
): ReviewGateToolDecision {
  const isReadOnlyReviewQuery =
    READ_ONLY_TOOLS.has(use.toolName) ||
    (use.toolName === "justice_review" && use.queryOnly);
  if (use.lockOwnerSessionId !== lock.parentSessionId) {
    return isReadOnlyReviewQuery ? { kind: "allow" } : denied("implementation_not_authorized");
  }

  if (use.toolName === "task") {
    return use.isPendingReviewGateTask
      ? { kind: "allow" }
      : denied("implementation_not_authorized");
  }

  if (READ_ONLY_TOOLS.has(use.toolName)) return { kind: "allow" };

  if (use.toolName === "justice_review") {
    return use.queryOnly ? { kind: "allow" } : denied("implementation_not_authorized");
  }

  if (REVIEW_ARTIFACT_WRITE_TOOLS.has(use.toolName)) {
    if (lock.phase !== "remediation") return denied("implementation_not_authorized");
    if (use.changedPaths === null || use.changedPaths.length === 0) {
      return denied("review_scope_violation");
    }
    return use.changedPaths.every(
      (path) => path === lock.designPath || path === lock.planPath,
    )
      ? { kind: "allow" }
      : denied("review_scope_violation");
  }

  return denied("implementation_not_authorized");
}
