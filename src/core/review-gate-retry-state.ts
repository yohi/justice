import type { ReviewArtifactFindingV1 } from "./types";

export type ReviewGateRetryPhase = "review" | "remediation" | "clear" | "blocked";
export type ReviewGateRetryAction = "review" | "remediation" | "clear" | "stop";

export type ReviewGateRetryState = {
  readonly gateId: string;
  readonly retryLimit: number;
  readonly repairsUsed: number;
  readonly reviewRound: number;
  readonly phase: ReviewGateRetryPhase;
  readonly findings: readonly ReviewArtifactFindingV1[];
  readonly stoppedBy: "retry_exhausted" | "no_progress" | "worker_failed" | null;
};

export type ReviewGateRetryEvent =
  | { readonly kind: "review_result"; readonly findings: readonly ReviewArtifactFindingV1[] }
  | { readonly kind: "remediation_result"; readonly contentChanged: boolean }
  | { readonly kind: "worker_failed" };

export type ReviewGateRetryTransition =
  | {
      readonly kind: "transitioned";
      readonly state: ReviewGateRetryState;
      readonly nextAction: ReviewGateRetryAction;
    }
  | { readonly kind: "invalid_transition"; readonly state: ReviewGateRetryState };

export function createReviewGateRetryState(
  gateId: string,
  retryLimit: number,
): ReviewGateRetryState {
  return freezeState({
    gateId,
    retryLimit,
    repairsUsed: 0,
    reviewRound: 1,
    phase: "review",
    findings: [],
    stoppedBy: null,
  });
}

export function advanceReviewGateRetry(
  state: ReviewGateRetryState,
  event: ReviewGateRetryEvent,
): ReviewGateRetryTransition {
  switch (event.kind) {
    case "review_result":
      if (state.phase !== "review") return invalidTransition(state);
      if (event.findings.length === 0) {
        return transitioned(
          { ...state, phase: "clear", findings: [], stoppedBy: null },
          "clear",
        );
      }
      if (state.repairsUsed >= state.retryLimit) {
        return transitioned(
          {
            ...state,
            phase: "blocked",
            findings: event.findings,
            stoppedBy: "retry_exhausted",
          },
          "stop",
        );
      }
      return transitioned(
        { ...state, phase: "remediation", findings: event.findings, stoppedBy: null },
        "remediation",
      );

    case "remediation_result":
      if (state.phase !== "remediation") return invalidTransition(state);
      if (!event.contentChanged) {
        return transitioned({ ...state, phase: "blocked", stoppedBy: "no_progress" }, "stop");
      }
      return transitioned(
        {
          ...state,
          repairsUsed: state.repairsUsed + 1,
          reviewRound: state.reviewRound + 1,
          phase: "review",
          stoppedBy: null,
        },
        "review",
      );

    case "worker_failed":
      if (state.phase !== "review" && state.phase !== "remediation") {
        return invalidTransition(state);
      }
      return transitioned({ ...state, phase: "blocked", stoppedBy: "worker_failed" }, "stop");

    default:
      return assertNever(event);
  }
}

function transitioned(
  state: ReviewGateRetryState,
  nextAction: ReviewGateRetryAction,
): ReviewGateRetryTransition {
  return Object.freeze({ kind: "transitioned", state: freezeState(state), nextAction });
}

function invalidTransition(state: ReviewGateRetryState): ReviewGateRetryTransition {
  return Object.freeze({ kind: "invalid_transition", state });
}

function freezeState(state: ReviewGateRetryState): ReviewGateRetryState {
  return Object.freeze({
    ...state,
    findings: Object.freeze(state.findings.map((finding) => Object.freeze({ ...finding }))),
  });
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected review retry event: ${JSON.stringify(value)}`);
}
