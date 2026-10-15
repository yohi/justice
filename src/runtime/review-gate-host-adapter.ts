/**
 * Task 17 — host adapter compatibility for caller-owned Review Gate routing.
 *
 * The host layer describes its routing intent as a host disposition string;
 * this adapter translates it into the caller-owned `CallerRoutingDecisionV1`
 * the Review Gate coordinator executes. The translation is a pure, total
 * function over known dispositions: unknown dispositions fail closed as
 * `block` with the stable `unknown_host_disposition` reason instead of being
 * guessed into an execution. Operation ids stay caller-owned: the coordinator
 * binds the decision to the durably prepared operation, so the translation
 * never fabricates an `operationId`.
 */

import type { CallerRoutingDecisionV1 } from "./review-gate-coordinator";

/** Host dispositions that route to executing the prepared operation. */
const EXECUTE_OPERATION_DISPOSITIONS: ReadonlySet<string> = new Set<string>([
  "execute_operation",
  "resume",
]);

/** Host dispositions that route to blocking the Review Gate. */
const BLOCK_DISPOSITIONS: ReadonlySet<string> = new Set<string>([
  "block",
  "reject",
  "abort",
]);

/** Host dispositions that route to waiting for durable evidence. */
const AWAIT_EVIDENCE_DISPOSITIONS: ReadonlySet<string> = new Set<string>([
  "await_evidence",
  "awaiting_evidence",
  "evidence_pending",
]);

/** Stable guidance recorded for dispositions the host adapter cannot map. */
const UNKNOWN_HOST_DISPOSITION_REASON = "unknown_host_disposition";

export interface ReviewGateHostAdapter {
  /**
   * Translate one host disposition into the caller-owned routing decision.
   * Matching is exact (no normalization, no aliases); unknown dispositions
   * fail closed as `block` with the `unknown_host_disposition` reason.
   */
  readonly translateRoutingDecision: (
    hostDisposition: string,
  ) => CallerRoutingDecisionV1;
}

export function createReviewGateHostAdapter(): ReviewGateHostAdapter {
  const translateRoutingDecision = (
    hostDisposition: string,
  ): CallerRoutingDecisionV1 => {
    if (EXECUTE_OPERATION_DISPOSITIONS.has(hostDisposition)) {
      return Object.freeze({
        kind: "execute_operation",
        operationId: null,
        reason: null,
      });
    }
    if (BLOCK_DISPOSITIONS.has(hostDisposition)) {
      // The host disposition itself becomes the caller's durable stop reason.
      return Object.freeze({
        kind: "block",
        operationId: null,
        reason: hostDisposition,
      });
    }
    if (AWAIT_EVIDENCE_DISPOSITIONS.has(hostDisposition)) {
      return Object.freeze({
        kind: "await_evidence",
        operationId: null,
        reason: null,
      });
    }
    return Object.freeze({
      kind: "block",
      operationId: null,
      reason: UNKNOWN_HOST_DISPOSITION_REASON,
    });
  };

  return Object.freeze({ translateRoutingDecision });
}