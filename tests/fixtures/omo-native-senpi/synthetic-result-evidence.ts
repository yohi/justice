export type SyntheticResultKind = "unknown_tool" | "registered_schema_validation";

export type SyntheticResultSanitationEvidence = Readonly<{
  readonly sanitationBoundaryProven: boolean;
  readonly tokenRemovalProven: boolean;
}>;

type EvidenceRow = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function evaluateSyntheticToolResultEvidence(input: {
  readonly syntheticResult: EvidenceRow | undefined;
  readonly messageEndObservations: readonly EvidenceRow[];
  readonly resultKind: SyntheticResultKind;
}): SyntheticResultSanitationEvidence {
  const result = input.syntheticResult;
  if (
    result === undefined ||
    result.event !== "rpc_synthetic_tool_result_append_observed" ||
    typeof result.sessionId !== "string" ||
    typeof result.toolCallId !== "string" ||
    typeof result.messageId !== "string" ||
    result.messageId.length === 0 ||
    typeof result.entryId !== "string" ||
    result.entryId.length === 0 ||
    result.role !== "toolResult" ||
    result.isError !== true ||
    result.entryAppendedObserved !== true ||
    result.immediateJsonlReadBackMatched !== true ||
    result.capabilityAbsentFromResult !== true
  ) {
    return { sanitationBoundaryProven: false, tokenRemovalProven: false };
  }

  const matches = input.messageEndObservations.filter((observation) => {
    if (!isRecord(observation)) return false;
    return (
      observation.event === "synthetic_tool_result_message_end_observed" &&
      observation.sessionId === result.sessionId &&
      observation.toolCallId === result.toolCallId &&
      observation.messageId === result.messageId &&
      observation.role === "toolResult" &&
      observation.sanitizerSource === "Senpi message_end callback" &&
      observation.callbackObserved === true &&
      observation.isError === true &&
      observation.unknownToolCall === (input.resultKind === "unknown_tool") &&
      observation.registeredSchemaValidationProbe === (input.resultKind === "registered_schema_validation") &&
      typeof observation.capabilityTokenPresentBeforeSanitization === "boolean" &&
      observation.capabilityTokenAbsentAfterSanitization === true &&
      typeof observation.sanitizationChanged === "boolean"
    );
  });
  if (matches.length !== 1) return { sanitationBoundaryProven: false, tokenRemovalProven: false };

  const [observation] = matches;
  return {
    sanitationBoundaryProven: true,
    tokenRemovalProven:
      observation?.capabilityTokenPresentBeforeSanitization === true &&
      observation.capabilityTokenAbsentAfterSanitization === true &&
      observation.sanitizationChanged === true,
  };
}
