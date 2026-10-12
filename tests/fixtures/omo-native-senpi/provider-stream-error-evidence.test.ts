import { describe, expect, it } from "vitest";
import { evaluateProviderStreamErrorControl } from "./provider-stream-error-evidence";

describe("evaluateProviderStreamErrorControl", () => {
  it("keeps the Case A control blocked when its required runtime evidence is absent", () => {
    const result = evaluateProviderStreamErrorControl({
      rows: [],
      parentSessionId: "parent-session",
      assistantToolCallAppendObservations: [],
      syntheticToolResultObservations: [],
      harnessFinalScanSafe: false,
    });

    expect(result.status).toBe("BLOCKED");
    expect(result.requiredObservations.providerStreamErrorObserved).toBe(false);
    expect(result.requiredObservations.preFailureReadResultRejected).toBe(false);
    expect(result.missingEvidence).toContain("preFailureReadResultRejected");
  });

  it("does not call an empty candidate set receipt invalidation", () => {
    const rows = [
      {
        event: "provider_stream_error_emitted",
        toolCallId: "failed-task-call",
      },
      {
        event: "message_end_forced_failure_injected",
        sessionId: "parent-session",
        toolCallId: "failed-task-call",
        failureSurface: "provider_stream_error",
        callbackObserved: true,
        normalMessageEndSanitationApplied: true,
      },
      {
        event: "provider_stream_error_authority_invalidated",
        sessionId: "parent-session",
        toolCallId: "failed-task-call",
        candidateReceiptCaptured: false,
        candidateReceiptCount: 0,
        candidateReceiptsInvalidated: true,
        liveCapabilityInvalidated: true,
        activationInvalidated: true,
        failureEpochBefore: 0,
        failureEpochAfter: 1,
      },
      {
        event: "failure_authority_invalidated",
        sessionId: "parent-session",
        failureSurface: "provider_stream_error",
        liveCapabilityWasValidBeforeFailure: true,
        activationWasActiveBeforeFailure: true,
        candidateReceiptCount: 0,
        failureEpochBefore: 0,
        failureEpochAfter: 1,
      },
    ];
    const result = evaluateProviderStreamErrorControl({
      rows,
      parentSessionId: "parent-session",
      assistantToolCallAppendObservations: [],
      syntheticToolResultObservations: [],
      harnessFinalScanSafe: true,
    });

    expect(result.requiredObservations.candidateReceiptCaptured).toBe(false);
    expect(result.requiredObservations.candidateReceiptsInvalidated).toBe(false);
    expect(result.requiredObservations.noTrustedExecution).toBe(true);
    expect(result.status).toBe("BLOCKED");
  });
});
