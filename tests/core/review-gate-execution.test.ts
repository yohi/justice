import { describe, expect, it } from "vitest";
import {
  REVIEW_GATE_EXECUTION_MARKER,
  extractReviewGateIdFromTaskPrompt,
  parseReviewGateWorkerResult,
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

  it.each([
    "not json",
    JSON.stringify({ schemaVersion: 1, gateId: "", complete: true, findings: [] }),
    JSON.stringify({ schemaVersion: 1, gateId: "g", complete: "yes", findings: [] }),
    JSON.stringify({ schemaVersion: 1, gateId: "g", complete: true, findings: [{}] }),
  ])("rejects malformed worker results", (raw) => {
    expect(parseReviewGateWorkerResult(raw)).toBeUndefined();
  });
});
