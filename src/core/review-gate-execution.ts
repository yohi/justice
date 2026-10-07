/**
 * Compatibility re-export facade for the legacy Review Gate execution protocol
 * (convergence Task 10 window).
 *
 * Every export is served by the legacy implementation relocated to
 * `src/core/review-gate/legacy-execution.ts`, so the unmigrated v4 PlanBridge
 * path (Retry-Budget role-marked prompts, `justice-review-worker`, NEXT TASK
 * packets) keeps working unchanged until Task 12 removes this module, the
 * legacy implementation, the legacy worker registration, and the legacy tests
 * in one atomic change. New protocol work must import from
 * `src/core/review-gate/agent-protocol.ts` instead.
 */
export * from "./review-gate/legacy-execution.js";
