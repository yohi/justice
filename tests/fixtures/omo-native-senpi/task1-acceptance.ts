export type Task1AcceptanceInput = Readonly<{
  readonly canonicalContractCount: number;
  readonly canonicalContractsProven: number;
  readonly caseAStatus: "PROVEN" | "BLOCKED";
  readonly caseBStatus: "PROVEN" | "BLOCKED";
  readonly requiredRuntimeEvidenceComplete: boolean;
  readonly mandatorySafetyChecksPassed: boolean;
}>;

export type Task1Acceptance = Readonly<{
  readonly status: "PROVEN" | "BLOCKED";
  readonly blockedReasons: readonly string[];
}>;

export function evaluateTask1Acceptance(input: Task1AcceptanceInput): Task1Acceptance {
  const blockedReasons = [
    ...(input.canonicalContractCount !== 32 || input.canonicalContractsProven !== 32
      ? ["canonical_contracts_incomplete"]
      : []),
    ...(input.caseAStatus !== "PROVEN" ? ["provider_stream_error_control_unproven"] : []),
    ...(input.caseBStatus !== "PROVEN" ? ["justice_sanitizer_failure_unproven"] : []),
    ...(!input.requiredRuntimeEvidenceComplete ? ["required_runtime_evidence_incomplete"] : []),
    ...(!input.mandatorySafetyChecksPassed ? ["mandatory_safety_checks_failed"] : []),
  ];
  return {
    status: blockedReasons.length === 0 ? "PROVEN" : "BLOCKED",
    blockedReasons,
  };
}
