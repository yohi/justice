import { describe, expect, it } from "vitest";
import {
  REVIEW_GATE_EXECUTION_MARKER,
  REVIEW_GATE_REMEDIATION_MARKER,
  extractReviewGateWorkerPrompt,
  extractReviewGateIdFromTaskPrompt,
  parseReviewGateRemediationResult,
  parseReviewGateWorkerResult,
  validateReviewGateRemediationResult,
} from "../../src/core/review-gate-execution";

describe("review gate execution contract", () => {
  it("extracts the Gate ID only from the exact marker prefix", () => {
    expect(
      extractReviewGateIdFromTaskPrompt(
        `${REVIEW_GATE_EXECUTION_MARKER}\nGate-ID: 123e4567-e89b-12d3-a456-426614174000\nReview the artifacts.`,
      ),
    ).toBe("123e4567-e89b-12d3-a456-426614174000");
    expect(extractReviewGateIdFromTaskPrompt("please review Gate-ID: fake")).toBeUndefined();
  });

  it("extracts the worker role and round from a marked remediation prompt", () => {
    expect(
      extractReviewGateWorkerPrompt(
        `${REVIEW_GATE_REMEDIATION_MARKER}\nGate-ID: gate-1\nReview-Round: 2\nRetry-Budget: 2\nRepair the listed findings.`,
      ),
    ).toEqual({ role: "remediation", gateId: "gate-1", round: 2, retryBudget: 2 });
  });

  it("extracts the worker role and round from a marked review prompt", () => {
    expect(
      extractReviewGateWorkerPrompt(
        `${REVIEW_GATE_EXECUTION_MARKER}\nGate-ID: gate-1\nReview-Round: 3\nRetry-Budget: 3\nReview the artifacts.`,
      ),
    ).toEqual({ role: "review", gateId: "gate-1", round: 3, retryBudget: 3 });
  });

  it("parses a strict complete structured result", () => {
    expect(
      parseReviewGateWorkerResult(
        JSON.stringify({
          schemaVersion: 1,
          gateId: "gate-1",
          complete: true,
          findings: [
            {
              itemKey: "RG-001",
              severity: "major",
              summary: "Plan misses failure handling",
              location: "docs/plan.md:42",
            },
          ],
        }),
      ),
    ).toMatchObject({
      schemaVersion: 1,
      gateId: "gate-1",
      complete: true,
      findings: [{ itemKey: "RG-001", severity: "major" }],
    });
  });

  it("parses the known OmO synchronous task completion wrapper", () => {
    const raw = [
      "Task completed in 12s.",
      "",
      "Agent: Sisyphus-Junior (category: sp-final-review)",
      "Model: provider/model (category: sp-final-review)",
      "",
      "---",
      "",
      JSON.stringify({
        schemaVersion: 1,
        gateId: "gate-wrapped",
        complete: true,
        findings: [],
      }),
      "",
      "<task_metadata>",
      "session_id: ses_worker",
      "task_id: ses_worker",
      "subagent: Sisyphus-Junior",
      "category: sp-final-review",
      "</task_metadata>",
    ].join("\n");

    expect(parseReviewGateWorkerResult(raw)).toEqual({
      schemaVersion: 1,
      gateId: "gate-wrapped",
      complete: true,
      findings: [],
    });
  });

  it("rejects arbitrary prose wrappers even when they contain JSON", () => {
    const raw =
      'review done\n{"schemaVersion":1,"gateId":"gate-1","complete":true,"findings":[]}';
    expect(parseReviewGateWorkerResult(raw)).toBeUndefined();
  });

  it("parses a complete remediation result with its Gate and round correlation", () => {
    expect(
      parseReviewGateRemediationResult(
        JSON.stringify({
          schemaVersion: 1,
          gateId: "gate-2",
          round: 1,
          complete: true,
          summary: "Updated the plan verification steps.",
        }),
      ),
    ).toEqual({
      schemaVersion: 1,
      gateId: "gate-2",
      round: 1,
      complete: true,
      summary: "Updated the plan verification steps.",
    });
  });

  it("rejects remediation results without a complete positive round", () => {
    expect(
      parseReviewGateRemediationResult(
        JSON.stringify({
          schemaVersion: 1,
          gateId: "gate-2",
          round: 0,
          complete: false,
          summary: "No changes.",
        }),
      ),
    ).toBeUndefined();
  });

  it("rejects arbitrary prose around a remediation JSON result", () => {
    const raw =
      'repair done\n{"schemaVersion":1,"gateId":"gate-1","round":1,"complete":true,"summary":"Updated plan."}';

    expect(parseReviewGateRemediationResult(raw)).toBeUndefined();
  });

  it.each([
    "not json",
    JSON.stringify({ schemaVersion: 1, gateId: "", complete: true, findings: [] }),
    JSON.stringify({ schemaVersion: 1, gateId: "g", complete: "yes", findings: [] }),
    JSON.stringify({ schemaVersion: 1, gateId: "g", complete: true, findings: [{}] }),
  ])("rejects malformed worker results", (raw) => {
    expect(parseReviewGateWorkerResult(raw)).toBeUndefined();
  });

  it.each([
    "not json",
    JSON.stringify({ schemaVersion: 1, gateId: "", round: 1, complete: true, summary: "Changed" }),
    JSON.stringify({ schemaVersion: 1, gateId: "g", round: 1.5, complete: true, summary: "Changed" }),
    JSON.stringify({ schemaVersion: 1, gateId: "g", round: 1, complete: true, summary: "" }),
    JSON.stringify({ schemaVersion: 2, gateId: "g", round: 1, complete: true, summary: "Changed" }),
  ])("rejects malformed remediation results", (raw) => {
    expect(parseReviewGateRemediationResult(raw)).toBeUndefined();
  });

  it("classifies a current remediation result as accepted", () => {
    const raw = JSON.stringify({
      schemaVersion: 1,
      gateId: "gate-1",
      round: 2,
      complete: true,
      summary: "Updated the plan.",
    });

    expect(validateReviewGateRemediationResult(raw, { gateId: "gate-1", round: 2 })).toMatchObject({
      kind: "accepted",
      result: { gateId: "gate-1", round: 2 },
    });
  });

  it("distinguishes malformed remediation output from stale correlation", () => {
    expect(validateReviewGateRemediationResult("not JSON", { gateId: "gate-1", round: 1 })).toEqual(
      { kind: "malformed" },
    );
  });

  it("rejects role-marked worker prompts without retry-budget metadata", () => {
    expect(
      extractReviewGateWorkerPrompt(
        `${REVIEW_GATE_EXECUTION_MARKER}\nGate-ID: gate-1\nReview-Round: 1\nReview artifacts.`,
      ),
    ).toBeUndefined();
  });

  it.each(["-1", "1.5", "100000000000000000000"])(
    "rejects a non-integer or unsafe retry budget in a marked worker prompt",
    (retryBudget) => {
      expect(
        extractReviewGateWorkerPrompt(
          `${REVIEW_GATE_REMEDIATION_MARKER}\nGate-ID: gate-1\nReview-Round: 1\nRetry-Budget: ${retryBudget}\nRepair findings.`,
        ),
      ).toBeUndefined();
    },
  );

  it("identifies a remediation result from a different Gate", () => {
    const raw = JSON.stringify({
      schemaVersion: 1,
      gateId: "older-gate",
      round: 1,
      complete: true,
      summary: "Updated the plan.",
    });

    expect(validateReviewGateRemediationResult(raw, { gateId: "gate-1", round: 1 })).toEqual({
      kind: "stale_gate",
      expectedGateId: "gate-1",
      receivedGateId: "older-gate",
    });
  });

  it("identifies a remediation result from an earlier round", () => {
    const raw = JSON.stringify({
      schemaVersion: 1,
      gateId: "gate-1",
      round: 1,
      complete: true,
      summary: "Updated the plan.",
    });

    expect(validateReviewGateRemediationResult(raw, { gateId: "gate-1", round: 2 })).toEqual({
      kind: "stale_round",
      expectedRound: 2,
      receivedRound: 1,
    });
  });
});
