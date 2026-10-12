import { describe, expect, it } from "vitest";
import { evaluateTask1Acceptance } from "./task1-acceptance";

describe("evaluateTask1Acceptance", () => {
  it("blocks Task 1 when Case A is blocked despite 32 proven canonical contracts", () => {
    expect(
      evaluateTask1Acceptance({
        canonicalContractCount: 32,
        canonicalContractsProven: 32,
        caseAStatus: "BLOCKED",
        caseBStatus: "PROVEN",
        requiredRuntimeEvidenceComplete: true,
        mandatorySafetyChecksPassed: true,
      }).status,
    ).toBe("BLOCKED");
  });

  it("proves Task 1 only when the canonical contracts and independent controls are complete", () => {
    expect(
      evaluateTask1Acceptance({
        canonicalContractCount: 32,
        canonicalContractsProven: 32,
        caseAStatus: "PROVEN",
        caseBStatus: "PROVEN",
        requiredRuntimeEvidenceComplete: true,
        mandatorySafetyChecksPassed: true,
      }).status,
    ).toBe("PROVEN");
  });

  it("blocks Task 1 when any canonical contract remains unproven even if the controls pass", () => {
    expect(
      evaluateTask1Acceptance({
        canonicalContractCount: 32,
        canonicalContractsProven: 31,
        caseAStatus: "PROVEN",
        caseBStatus: "PROVEN",
        requiredRuntimeEvidenceComplete: true,
        mandatorySafetyChecksPassed: true,
      }),
    ).toMatchObject({ status: "BLOCKED", blockedReasons: ["canonical_contracts_incomplete"] });
  });
});
