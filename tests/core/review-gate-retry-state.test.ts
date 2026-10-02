import { describe, expect, it } from "vitest";
import type { ReviewArtifactFindingV1 } from "../../src/core/types";
import {
  advanceReviewGateRetry,
  createReviewGateRetryState,
} from "../../src/core/review-gate-retry-state";

const FINDING = {
  itemKey: "RG-001",
  severity: "minor",
  summary: "Move diff verification before commits.",
  location: "Task 3",
} satisfies ReviewArtifactFindingV1;

describe("createReviewGateRetryState", () => {
  it("starts the first review with the requested retry budget", () => {
    expect(createReviewGateRetryState("gate-1", 2)).toEqual({
      gateId: "gate-1",
      retryLimit: 2,
      repairsUsed: 0,
      reviewRound: 1,
      phase: "review",
      findings: [],
      stoppedBy: null,
    });
  });
});

describe("advanceReviewGateRetry", () => {
  it("clears the Gate when the first complete review has no findings", () => {
    const state = createReviewGateRetryState("gate-1", 2);

    expect(advanceReviewGateRetry(state, { kind: "review_result", findings: [] })).toEqual({
      kind: "transitioned",
      nextAction: "clear",
      state: {
        ...state,
        phase: "clear",
        findings: [],
      },
    });
  });

  it("schedules remediation when a review finds issues and retries remain", () => {
    const state = createReviewGateRetryState("gate-1", 2);

    expect(
      advanceReviewGateRetry(state, { kind: "review_result", findings: [FINDING] }),
    ).toEqual({
      kind: "transitioned",
      nextAction: "remediation",
      state: {
        ...state,
        phase: "remediation",
        findings: [FINDING],
      },
    });
  });

  it("returns a frozen copy of review findings in the retry state", () => {
    const finding = { ...FINDING };
    const state = createReviewGateRetryState("gate-1", 1);
    const result = advanceReviewGateRetry(state, {
      kind: "review_result",
      findings: [finding],
    });

    expect(result.kind).toBe("transitioned");
    if (result.kind !== "transitioned") return;
    const returnedFinding = result.state.findings.at(0);
    expect(returnedFinding).toEqual(finding);
    expect(returnedFinding).not.toBe(finding);
    expect(Object.isFrozen(result.state.findings)).toBe(true);
    expect(Object.isFrozen(returnedFinding)).toBe(true);
  });

  it("blocks automatic retries when findings arrive with a zero retry budget", () => {
    const state = createReviewGateRetryState("gate-1", 0);

    expect(
      advanceReviewGateRetry(state, { kind: "review_result", findings: [FINDING] }),
    ).toEqual({
      kind: "transitioned",
      nextAction: "stop",
      state: {
        ...state,
        phase: "blocked",
        findings: [FINDING],
        stoppedBy: "retry_exhausted",
      },
    });
  });

  it("counts a content-changing repair and schedules the next review round", () => {
    const remediation = advanceReviewGateRetry(createReviewGateRetryState("gate-1", 2), {
      kind: "review_result",
      findings: [FINDING],
    });

    expect(remediation.kind).toBe("transitioned");
    if (remediation.kind !== "transitioned") return;

    expect(
      advanceReviewGateRetry(remediation.state, {
        kind: "remediation_result",
        contentChanged: true,
      }),
    ).toEqual({
      kind: "transitioned",
      nextAction: "review",
      state: {
        ...remediation.state,
        repairsUsed: 1,
        reviewRound: 2,
        phase: "review",
      },
    });
  });

  it("stops on a no-progress repair without consuming a retry", () => {
    const remediation = advanceReviewGateRetry(createReviewGateRetryState("gate-1", 2), {
      kind: "review_result",
      findings: [FINDING],
    });
    if (remediation.kind !== "transitioned") throw new Error("Expected remediation transition");

    expect(
      advanceReviewGateRetry(remediation.state, {
        kind: "remediation_result",
        contentChanged: false,
      }),
    ).toMatchObject({
      kind: "transitioned",
      nextAction: "stop",
      state: {
        phase: "blocked",
        repairsUsed: 0,
        stoppedBy: "no_progress",
        findings: [FINDING],
      },
    });
  });

  it("stops the active round when a worker or protocol fails", () => {
    const state = createReviewGateRetryState("gate-1", 2);

    expect(advanceReviewGateRetry(state, { kind: "worker_failed" })).toMatchObject({
      kind: "transitioned",
      nextAction: "stop",
      state: { phase: "blocked", stoppedBy: "worker_failed" },
    });
  });

  it("rejects a remediation result during the review phase without changing state", () => {
    const state = createReviewGateRetryState("gate-1", 2);

    expect(
      advanceReviewGateRetry(state, {
        kind: "remediation_result",
        contentChanged: true,
      }),
    ).toEqual({ kind: "invalid_transition", state });
  });
});
