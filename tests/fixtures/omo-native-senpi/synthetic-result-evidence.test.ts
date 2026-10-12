import { describe, expect, it } from "vitest";
import { evaluateSyntheticToolResultEvidence } from "./synthetic-result-evidence";

type EvidenceRow = Readonly<Record<string, unknown>>;

const resultRow: EvidenceRow = {
  event: "rpc_synthetic_tool_result_append_observed",
  sessionId: "session-1",
  toolCallId: "call-1",
  messageId: "message-1",
  entryId: "entry-1",
  role: "toolResult",
  isError: true,
  entryAppendedObserved: true,
  immediateJsonlReadBackMatched: true,
  capabilityAbsentFromResult: true,
};

const callbackRow: EvidenceRow = {
  event: "synthetic_tool_result_message_end_observed",
  sessionId: "session-1",
  toolCallId: "call-1",
  messageId: "message-1",
  role: "toolResult",
  sanitizerSource: "Senpi message_end callback",
  callbackObserved: true,
  isError: true,
  unknownToolCall: true,
  registeredSchemaValidationProbe: false,
  capabilityTokenPresentBeforeSanitization: false,
  capabilityTokenAbsentAfterSanitization: true,
  sanitizationChanged: false,
};

describe("evaluateSyntheticToolResultEvidence", () => {
  it("proves callback-boundary execution without claiming token removal when input was token-free", () => {
    expect(
      evaluateSyntheticToolResultEvidence({
        syntheticResult: resultRow,
        messageEndObservations: [callbackRow],
        resultKind: "unknown_tool",
      }),
    ).toEqual({ sanitationBoundaryProven: true, tokenRemovalProven: false });
  });

  it("proves token removal only when a linked callback observes and removes a present token", () => {
    expect(
      evaluateSyntheticToolResultEvidence({
        syntheticResult: resultRow,
        messageEndObservations: [
          {
            ...callbackRow,
            capabilityTokenPresentBeforeSanitization: true,
            sanitizationChanged: true,
          },
        ],
        resultKind: "unknown_tool",
      }),
    ).toEqual({ sanitationBoundaryProven: true, tokenRemovalProven: true });
  });

  it.each([
    ["missing callback", []],
    ["wrong session", [{ ...callbackRow, sessionId: "session-2" }]],
    ["wrong call", [{ ...callbackRow, toolCallId: "call-2" }]],
    ["missing message identity", [{ ...callbackRow, messageId: null }]],
    ["wrong event source", [{ ...callbackRow, sanitizerSource: "fixture" }]],
    ["callback not observed", [{ ...callbackRow, callbackObserved: false }]],
    ["wrong result kind", [{ ...callbackRow, unknownToolCall: false }]],
  ] as const)("rejects %s as sanitation-boundary evidence", (_caseName, observations) => {
    expect(
      evaluateSyntheticToolResultEvidence({
        syntheticResult: resultRow,
        messageEndObservations: observations,
        resultKind: "unknown_tool",
      }).sanitationBoundaryProven,
    ).toBe(false);
  });

  it.each([
    ["missing append", { ...resultRow, entryAppendedObserved: false }],
    ["unmatched immediate read-back", { ...resultRow, immediateJsonlReadBackMatched: false }],
    ["persisted token present", { ...resultRow, capabilityAbsentFromResult: false }],
    ["missing message identity", { ...resultRow, messageId: null }],
  ] as const)("rejects a synthetic result with %s", (_caseName, syntheticResult) => {
    expect(
      evaluateSyntheticToolResultEvidence({
        syntheticResult,
        messageEndObservations: [callbackRow],
        resultKind: "unknown_tool",
      }).sanitationBoundaryProven,
    ).toBe(false);
  });
});
