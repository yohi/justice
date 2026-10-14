import { describe, expect, it } from "vitest";
import type { ReviewGateEvent } from "../../../src/core/review-gate-types";
import type { SemanticContextCompatibilityProofV1 } from "../../../src/core/review-gate/types";
import {
  encodeReviewGateEventRecord,
  validateReviewGateEventRecord,
} from "../../../src/core/review-gate/event-schema";

const DIGEST = "a".repeat(64);
const V2_EVENT_TYPES = [
  "EXTERNAL_OPERATION_DISPATCHED",
  "FINDING_VALIDATION_COMPLETED",
  "LINEAGE_REGRESSED",
  "CROSS_GENERATION_RECONCILIATION_COMPLETED",
  "TARGET_WRITER_HANDOFF_REQUESTED",
  "TARGET_WRITER_HANDOFF_RESUMED",
  "TARGET_WRITER_TERMINAL_REVOKED",
  "SEMANTIC_CONTEXT_TRANSITION",
  "REVIEW_COMMIT_PREPARED",
  "REMEDIATION_COMMIT_SUCCEEDED",
  "REVIEW_COMMIT_FAILED",
  "REVIEW_TARGET_RESTORE_PREPARED",
  "REVIEW_TARGET_RESTORE_SUCCEEDED",
  "REVIEW_TARGET_RESTORE_RECOVERED",
] as const;
const V2_PAYLOADS = [externalOperationPayload(), findingValidationPayload(), lineageRegressedPayload(),
  crossGenerationPayload(), handoffIntentPayload(), handoffContinuationPayload(),
  terminalRevokePayload(), semanticTransitionPayload(), reviewCommitPreparedPayload(),
  remediationCommitSucceededPayload(), reviewCommitFailedPayload(), reviewTargetRestorePreparedPayload(),
  reviewTargetRestoreSucceededPayload(), reviewTargetRestoreRecoveredPayload()];
function legacyRecord(eventType: ReviewGateEvent["eventType"], payload: object): object {
  return { eventType, gateId: "gate-1", writerId: "writer-1", epochId: "epoch-1",
    emittedAt: "2026-10-11T00:00:00.000Z", payload };
}

function byteSizedRecord(byteLength: number): object {
  const targets = Array.from({ length: 16 }, () => ({ ...canonicalTarget(), workspaceIdentity: "a" }));
  const record = v2Record("TARGET_WRITER_TERMINAL_REVOKED", { ...terminalRevokePayload(), targets });
  let remaining = byteLength - new TextEncoder().encode(JSON.stringify(record)).length;
  for (const target of targets) {
    const extra = Math.min(4095, remaining);
    target.workspaceIdentity += "a".repeat(extra);
    remaining -= extra;
  }
  if (remaining !== 0) throw new Error("invalid fixture size");
  return record;
}

function v2Record(eventType: (typeof V2_EVENT_TYPES)[number], payload: object): object {
  return {
    schemaVersion: 2,
    eventId: "event-1",
    parentEventId: "event-0",
    emittedAt: "2026-10-11T00:00:00.000Z",
    gateId: "gate-1",
    epochId: "epoch-1",
    generationId: "generation-1",
    writerId: "writer-1",
    eventType,
    payload,
  };
}

function externalOperationPayload(): object {
  return {
    eventType: "EXTERNAL_OPERATION_DISPATCHED",
    gateId: "gate-1",
    generationId: "generation-1",
    epochId: "epoch-1",
    operationId: "operation-1",
    dispatchAttemptId: "attempt-1",
    phase: "design",
    role: "reviewer",
    candidateOrTargetSetDigest: DIGEST,
    inputBindingDigest: DIGEST,
    protocolFingerprint: DIGEST,
    expectedWitnessFrontier: DIGEST,
    protectedLeaseProofDigest: null,
  };
}

function findingValidationPayload(): object {
  return {
    eventType: "FINDING_VALIDATION_COMPLETED",
    operationId: "operation-1",
    validationEventId: "validation-1",
    disposition: "ALREADY_RESOLVED",
    relation: "EXISTING",
    lineageId: "lineage-1",
    priorCommittedResolutionEventId: "resolution-1",
    pinnedBaselineDigest: DIGEST,
    semanticContextFingerprint: DIGEST,
    validatedAbsenceProofDigest: DIGEST,
    witnessedFrontierHash: DIGEST,
  };
}

function lineageRegressedPayload(): object {
  return {
    eventType: "LINEAGE_REGRESSED",
    operationId: "operation-1",
    validationEventId: "validation-1",
    lineageId: "lineage-1",
    priorCommittedResolutionEventId: "resolution-1",
    pinnedBaselineDigest: DIGEST,
    semanticContextFingerprint: DIGEST,
    validatedPresenceProofDigest: DIGEST,
    witnessedFrontierHash: DIGEST,
  };
}

function crossGenerationPayload(): object {
  return {
    eventType: "CROSS_GENERATION_RECONCILIATION_COMPLETED",
    operationId: "operation-1",
    validationEventId: "validation-1",
    currentLineageId: "lineage-current",
    predecessorGateId: "gate-predecessor",
    predecessorLineageId: "lineage-predecessor",
    result: "RELATED_PRIOR_GENERATION",
    pinnedBaselineDigest: DIGEST,
    semanticContextFingerprint: DIGEST,
    witnessedFrontierHash: DIGEST,
  };
}

function canonicalTarget(): object {
  return {
    installationId: "installation-1",
    workspaceIdentity: DIGEST,
    canonicalWorkspaceRoot: "workspace-root-digest",
    canonicalLogicalTargetPath: "docs/design.md",
    targetIdentityDigest: DIGEST,
    verifiedAliasSetDigest: DIGEST,
    identityProofFrontier: DIGEST,
  };
}

function owner(): object {
  return {
    scopeId: "scope-1",
    gateId: "gate-1",
    generationId: "generation-1",
    operationId: "operation-1",
    attemptId: "attempt-1",
  };
}

function handoffIntentPayload(): object {
  return {
    purpose: "HANDOFF",
    status: "REQUESTED",
    handoffOperationId: "handoff-1",
    originalOperationId: "operation-1",
    scopeId: "scope-1",
    gateId: "gate-1",
    generationId: "generation-1",
    phase: "design",
    roundOrdinal: 1,
    protocolFingerprint: DIGEST,
    target: canonicalTarget(),
    targets: [],
    closingSealOperationId: null,
    oldOwner: owner(),
    newOwner: owner(),
    expectedTargetWriterFrontier: DIGEST,
    expectedGlobalTargetWriterGeneration: 2,
    expectedGateEventFrontier: DIGEST,
    expectedPreImageDigest: DIGEST,
    expectedGitMode: "100644",
    pendingNativeEffectReference: "native-effect-1",
  };
}

function handoffContinuationPayload(): object {
  return {
    status: "RESUMED",
    handoffOperationId: "handoff-1",
    originalOperationId: "operation-1",
    intent: handoffIntentPayload(),
    protectedTargetFrontier: DIGEST,
    gateEventFrontier: DIGEST,
    globalTargetWriterGeneration: 2,
    pendingNativeEffectReference: "native-effect-1",
    continuationProofDigest: DIGEST,
  };
}

function terminalRevokePayload(): object {
  return {
    purpose: "TERMINAL_REVOKE_ONLY",
    handoffOperationId: "handoff-1",
    terminalTransitionOperationId: "terminal-1",
    status: "REVOKED",
    gateId: "gate-1",
    generationId: "generation-1",
    phase: "design",
    roundOrdinal: 1,
    targets: [canonicalTarget()],
    priorOwners: [owner()],
    globalTargetWriterHighWatermark: 2,
    protectedTargetFrontier: DIGEST,
    protectedRevokeCasProofDigest: DIGEST,
    nativeNonWriteabilityProofDigest: DIGEST,
    nativeEffectDisposition: "APPLIED",
  };
}

function semanticInputs(): object {
  return {
    workspaceIdentity: DIGEST,
    gateId: "gate-1",
    generationId: "generation-1",
    phase: "design",
    phaseBaselineId: "baseline-1",
    comparisonSegmentId: "segment-1",
    requirements: {
      source: "explicit",
      canonicalPath: "requirements.md",
      gitBlobOid: DIGEST,
      gitMode: "100644",
      authorityEventId: "authority-1",
      governingReferenceManifestDigest: DIGEST,
    },
    upstreamApproved: null,
    policy: {
      contractId: "semantic-contract-1",
      version: "1",
      semanticFingerprint: DIGEST,
      lineageFingerprint: DIGEST,
      nc1Fingerprint: DIGEST,
      validatorRegistryDigest: DIGEST,
    },
  };
}

function semanticProof(): SemanticContextCompatibilityProofV1 {
  return {
      validationEventId: "validation-1",
      triggeringAuthorityEventId: "authority-1",
      validatorId: "SEMANTIC_CONTEXT_COMPATIBILITY_V1",
      validatorVersion: "1",
      executableDigest: DIGEST,
      registryDigest: DIGEST,
      compatibilityTableDigest: DIGEST,
      oldNormalizedInputsDigest: DIGEST,
      newNormalizedInputsDigest: DIGEST,
      result: "EQUIVALENT",
      ruleId: "semantic-rule-1",
      ruleVersion: "1",
      requirementsDelta: null,
  };
}

function semanticTransitionPayload(): object {
  return {
    oldInputs: semanticInputs(),
    newInputs: semanticInputs(),
    proof: semanticProof(),
    triggeringAuthorityEventId: "authority-1",
    verifiedHistoryFrontier: DIGEST,
    roundCountersBefore: { design: 1, plan: 0 },
    roundCountersAfter: { design: 1, plan: 0 },
    operationId: "operation-1",
  };
}

function gitTargetBinding(): object {
  return {
    headSha: "head-".repeat(8),
    headEntry: { canonicalPath: "docs/design.md", blobSha: DIGEST, gitMode: "100644" },
    indexEntry: { canonicalPath: "docs/design.md", blobSha: DIGEST, gitMode: "100644", stage: 0 },
    worktree: { canonicalPath: "docs/design.md", digest: DIGEST, gitMode: "100644" },
  };
}

function reviewCommitPreparedPayload(): object {
  return {
    phase: "design",
    roundOrdinal: 1,
    targetCanonicalPath: "docs/design.md",
    parentHeadSha: "head-".repeat(8),
    expectedTargetEntry: { canonicalPath: "docs/design.md", blobSha: DIGEST, gitMode: "100644" },
    commitMessageDigest: DIGEST,
    lineageIds: ["lineage-1"],
    unrelatedIndexFingerprint: DIGEST,
    preparedOperationId: "operation-1",
    preparedRecoveryDigest: DIGEST,
  };
}

function remediationCommitSucceededPayload(): object {
  return {
    preparedEventId: "event-prepared",
    commitId: "commit-".repeat(8),
    parentCommitId: "head-".repeat(8),
    targetEntry: { canonicalPath: "docs/design.md", blobSha: DIGEST, gitMode: "100644" },
    changedPaths: ["docs/design.md"],
    verifiedMessageDigest: DIGEST,
  };
}

function reviewCommitFailedPayload(): object {
  return {
    preparedEventId: "event-prepared",
    failureKind: "git_failure",
    reasonDigest: DIGEST,
  };
}

function reviewTargetRestorePreparedPayload(): object {
  return {
    phase: "plan",
    targetCanonicalPath: "docs/plan.md",
    sourceKnownDirtyBinding: gitTargetBinding(),
    targetCleanCommittedBinding: gitTargetBinding(),
    preparedOperationId: "operation-1",
    preparedRecoveryDigest: DIGEST,
  };
}

function reviewTargetRestoreSucceededPayload(): object {
  return {
    preparedEventId: "event-prepared",
    verifiedDestinationBinding: gitTargetBinding(),
  };
}

function reviewTargetRestoreRecoveredPayload(): object {
  return {
    preparedEventId: "event-prepared",
    verifiedDestinationBinding: gitTargetBinding(),
  };
}


describe("validateReviewGateEventRecord", () => {
  it.each(Object.entries({
    ARTIFACT_BINDINGS_UPDATED: { designArtifact: { canonicalPath: "design.md", digest: DIGEST, gitMode: "100644" }, planArtifact: { canonicalPath: "plan.md", digest: DIGEST, gitMode: "100755" } },
    ORCHESTRATION_RESUMED: { resumedAt: "2026-10-11T00:00:00.000Z" },
    DESIGN_CLEAR: { designProtocolFingerprint: DIGEST },
    REOPEN_REQUIRED: { phase: "design", lineageIds: ["lineage-1"] },
    ROUND_LIMIT_EXHAUSTED: { phase: "plan", roundLimit: 3 },
    REVIEW_NON_CONVERGENT: { phase: "design", lineageIds: ["lineage-1"] },
    EXECUTION_SUSPENDED: { reason: "execution failed" },
    FINDING_REMEDIATED: { lineageId: "lineage-1", findingId: "finding-1", remediationRound: { phase: "design", ordinal: 1 } },
    FINDING_SELF_REVIEWED: { lineageId: "lineage-1", findingId: "finding-1", remediationRound: { phase: "plan", ordinal: 1 } },
    FINDING_REOPENED: { lineageId: "lineage-1", findingId: "finding-1", reopenedBy: "epoch-2" },
  } satisfies Partial<Record<ReviewGateEvent["eventType"], object>>)) ("preserves V1 %s", (eventType, payload) => {
    const record = { ...legacyRecord("DESIGN_CLEAR", payload), eventType };
    expect(validateReviewGateEventRecord(record)).toEqual(record);
  });

  it.each(["PLAN_CLEAR", "COMPLETED_APPROVAL_BINDING"] as const)("preserves V1 %s approval", (eventType) => {
    const approval = { reviewScopeId: "scope-1", gateId: "gate-1",
      designArtifact: { canonicalPath: "design.md", digest: DIGEST, gitMode: "100644" },
      planArtifact: { canonicalPath: "plan.md", digest: DIGEST, gitMode: "100755" },
      requirementsResolution: { source: "auto_design_reference", canonicalPath: "requirements.md", digest: DIGEST,
        designReferenceEvidence: { referenceKind: "design", logicalLocation: "preamble" } },
      reviewProtocolFingerprint: DIGEST, designProtocolFingerprint: DIGEST, planProtocolFingerprint: DIGEST,
      approvedAt: "2026-10-11T00:00:00.000Z" };
    const record = legacyRecord(eventType, eventType === "PLAN_CLEAR"
      ? { completedApprovalBinding: approval } : { approvalBinding: approval });
    expect(validateReviewGateEventRecord(record)).toEqual(record);
  });

  it("preserves V1 legacy ReviewGateEvent union records", () => {
    const gateCreated = {
      eventType: "GATE_CREATED",
      gateId: "gate-1",
      writerId: "writer-1",
      epochId: "epoch-1",
      emittedAt: "2026-10-11T00:00:00.000Z",
      payload: {
        reviewScopeId: "scope-1",
        designArtifact: { canonicalPath: "docs/design.md", digest: DIGEST, gitMode: "100644" },
        planArtifact: { canonicalPath: "docs/plan.md", digest: DIGEST, gitMode: "100644" },
        requirementsResolution: { source: "explicit", canonicalPath: "requirements.md", digest: DIGEST },
        reviewProtocolFingerprint: DIGEST,
      },
    };
    const findingDiscovered = {
      eventType: "FINDING_DISCOVERED",
      gateId: "gate-1",
      writerId: "writer-1",
      epochId: "epoch-1",
      emittedAt: "2026-10-11T00:00:00.000Z",
      payload: {
        lineageId: "lineage-1",
        findingId: "finding-1",
        observedPhase: "design",
        ownerScope: "design",
        descriptionDigest: DIGEST,
      },
    };

    expect(validateReviewGateEventRecord(gateCreated)).toEqual(gateCreated);
    expect(validateReviewGateEventRecord(findingDiscovered)).toEqual(findingDiscovered);
  });

  it.each([
    ["EXTERNAL_OPERATION_DISPATCHED", externalOperationPayload()],
    ["FINDING_VALIDATION_COMPLETED", findingValidationPayload()],
    ["LINEAGE_REGRESSED", lineageRegressedPayload()],
    ["CROSS_GENERATION_RECONCILIATION_COMPLETED", crossGenerationPayload()],
    ["TARGET_WRITER_TERMINAL_REVOKED", terminalRevokePayload()],
    ["SEMANTIC_CONTEXT_TRANSITION", semanticTransitionPayload()],
    ["REVIEW_COMMIT_PREPARED", reviewCommitPreparedPayload()],
    ["REMEDIATION_COMMIT_SUCCEEDED", remediationCommitSucceededPayload()],
    ["REVIEW_COMMIT_FAILED", reviewCommitFailedPayload()],
    ["REVIEW_TARGET_RESTORE_PREPARED", reviewTargetRestorePreparedPayload()],
    ["REVIEW_TARGET_RESTORE_SUCCEEDED", reviewTargetRestoreSucceededPayload()],
    ["REVIEW_TARGET_RESTORE_RECOVERED", reviewTargetRestoreRecoveredPayload()],
  ] as const)("accepts strict V2 %s records", (eventType, payload) => {
    const record = v2Record(eventType, payload);
    expect(validateReviewGateEventRecord(record)).toEqual(record);
  });

  it.each(V2_EVENT_TYPES)("rejects unknown and omitted fields for %s", (eventType) => {
    const payload = V2_PAYLOADS.at(V2_EVENT_TYPES.indexOf(eventType));
    if (payload === undefined) throw new Error("missing fixture");
    expect(() => validateReviewGateEventRecord(v2Record(eventType, { ...payload, rawWorkerText: "response" }))).toThrow();
    for (const field of Object.keys(payload)) {
      const incomplete = Object.fromEntries(Object.entries(payload).filter(([key]) => key !== field));
      expect(() => validateReviewGateEventRecord(v2Record(eventType, incomplete))).toThrow();
    }
  });

  it.each(["eventId", "parentEventId", "emittedAt", "gateId", "epochId", "generationId", "writerId"])("requires V2 %s", (field) => {
    const record = v2Record("EXTERNAL_OPERATION_DISPATCHED", externalOperationPayload());
    expect(() => validateReviewGateEventRecord(Object.fromEntries(Object.entries(record).filter(([key]) => key !== field)))).toThrow();
  });

  it.each([
    { ...v2Record("EXTERNAL_OPERATION_DISPATCHED", externalOperationPayload()), parentEventId: "event-1" },
    v2Record("EXTERNAL_OPERATION_DISPATCHED", { ...externalOperationPayload(), gateId: "other-gate" }),
    v2Record("SEMANTIC_CONTEXT_TRANSITION", { ...semanticTransitionPayload(), triggeringAuthorityEventId: "event-1",
      proof: { ...semanticProof(), triggeringAuthorityEventId: "event-1" } }),
    v2Record("TARGET_WRITER_HANDOFF_RESUMED", { ...handoffContinuationPayload(), status: "REQUESTED" }),
    v2Record("TARGET_WRITER_HANDOFF_RESUMED", { ...handoffContinuationPayload(), handoffOperationId: "handoff-other" }),
    v2Record("TARGET_WRITER_HANDOFF_RESUMED", { ...handoffContinuationPayload(), originalOperationId: "operation-other" }),
    v2Record("CROSS_GENERATION_RECONCILIATION_COMPLETED", { ...crossGenerationPayload(), predecessorLineageId: "lineage-current" }),
    v2Record("REMEDIATION_COMMIT_SUCCEEDED", { ...remediationCommitSucceededPayload(), changedPaths: ["docs/design.md", "docs/extra.md"] }),
    v2Record("REVIEW_COMMIT_FAILED", { ...reviewCommitFailedPayload(), failureKind: "timeout" }),
  ])("rejects inconsistent local causal bindings %#", (record) => {
    expect(() => validateReviewGateEventRecord(record)).toThrow();
  });


  it("accepts inclusive UTF-8 bounds without retaining mutable input aliases", () => {
    const record = legacyRecord("EXECUTION_SUSPENDED", { reason: "é".repeat(2048) });
    const event = validateReviewGateEventRecord(record);
    expect(event).toEqual(record);
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.payload)).toBe(true);
    expect(event.payload).not.toBe(Object.getOwnPropertyDescriptor(record, "payload")?.value);
    expect(validateReviewGateEventRecord({ ...v2Record("EXTERNAL_OPERATION_DISPATCHED", externalOperationPayload()), eventId: "é".repeat(128) })).toBeDefined();
    expect(validateReviewGateEventRecord(legacyRecord("REOPEN_REQUIRED", { phase: "design", lineageIds: Array.from({ length: 128 }, () => "lineage") }))).toBeDefined();
  });

  it("accepts ordinary identifiers and paths containing sk-", () => {
    const record = legacyRecord("EXECUTION_SUSPENDED", {
      reason: "task-1.md, tasksk-name, and tasksk-ant-name",
    });

    expect(validateReviewGateEventRecord(record)).toEqual(record);
  });

  it("enforces the inclusive 64KiB canonical record boundary", () => {
    const record = byteSizedRecord(65536);
    expect(new TextEncoder().encode(encodeReviewGateEventRecord(validateReviewGateEventRecord(record))).length).toBe(65536);
    expect(() => validateReviewGateEventRecord(byteSizedRecord(65537))).toThrow("review_gate_event_size_limit");
  });

  it("rejects hidden worker text on arrays rather than silently dropping it", () => {
    const lineageIds = Object.assign(["lineage-1"], { rawWorkerText: "private response" });
    expect(() => validateReviewGateEventRecord(legacyRecord("REOPEN_REQUIRED", { phase: "design", lineageIds }))).toThrow();
  });

  it("rejects accessor-backed references without executing their getter", () => {
    let reads = 0;
    const lineageIds = ["lineage-1"];
    Object.defineProperty(lineageIds, "0", { get: () => { reads += 1; return "lineage-1"; } });
    expect(() => validateReviewGateEventRecord(legacyRecord("REOPEN_REQUIRED", { phase: "design", lineageIds }))).toThrow();
    expect(reads).toBe(0);
  });

  it.each([
    legacyRecord("EXECUTION_SUSPENDED", { reason: "é".repeat(2048) + "a" }),
    { ...v2Record("EXTERNAL_OPERATION_DISPATCHED", externalOperationPayload()), eventId: "é".repeat(128) + "a" },
    legacyRecord("REOPEN_REQUIRED", { phase: "design", lineageIds: Array.from({ length: 129 }, () => "lineage") }),
    ...["sk-ant-credential", "ghp_credential", "/tmp/private", "C:\\private\\worker", "\\\\server\\private"].map((reason) => legacyRecord("EXECUTION_SUSPENDED", { reason })),
  ])("rejects unsafe otherwise-well-shaped records %#", (record) => {
    expect(() => validateReviewGateEventRecord(record)).toThrow();
  });

  it.each([
    ["schemaVersion 2 with a V1-only event type", { ...v2Record("EXTERNAL_OPERATION_DISPATCHED", externalOperationPayload()), eventType: "GATE_CREATED" }],
    ["an unsupported schema version", { ...v2Record("EXTERNAL_OPERATION_DISPATCHED", externalOperationPayload()), schemaVersion: 3 }],
    ["an invalid strict enum", v2Record("FINDING_VALIDATION_COMPLETED", { ...findingValidationPayload(), disposition: "NEW" })],
    ["a missing required dispatch payload field", v2Record("EXTERNAL_OPERATION_DISPATCHED", { ...externalOperationPayload(), operationId: undefined })],
    ["a missing semantic trigger proof", v2Record("SEMANTIC_CONTEXT_TRANSITION", { ...semanticTransitionPayload(), triggeringAuthorityEventId: undefined })],
    ["a cross-generation semantic context", v2Record("SEMANTIC_CONTEXT_TRANSITION", { ...semanticTransitionPayload(), newInputs: { ...semanticInputs(), generationId: "generation-2" } })],
  ])("rejects %s", (_name, record) => {
    expect(() => validateReviewGateEventRecord(record)).toThrow();
  });

  it.each([
    ["a payload larger than 64KiB", {
      eventType: "GATE_CREATED",
      gateId: "gate-1",
      writerId: "writer-1",
      epochId: "epoch-1",
      emittedAt: "2026-10-11T00:00:00.000Z",
      payload: { notes: Array.from({ length: 128 }, () => "a".repeat(600)) },
    }],
    ["an ID longer than 256 bytes", { ...v2Record("EXTERNAL_OPERATION_DISPATCHED", externalOperationPayload()), eventId: "e".repeat(257) }],
    ["a string longer than 4096 bytes", v2Record("EXTERNAL_OPERATION_DISPATCHED", { ...externalOperationPayload(), role: "r".repeat(4097) })],
    ["more than 128 references", {
      eventType: "GATE_CREATED",
      gateId: "gate-1",
      writerId: "writer-1",
      epochId: "epoch-1",
      emittedAt: "2026-10-11T00:00:00.000Z",
      payload: { references: Array.from({ length: 129 }, () => "reference") },
    }],
    ["a secret", v2Record("EXTERNAL_OPERATION_DISPATCHED", { ...externalOperationPayload(), role: "sk-ant-credential" })],
    ["an absolute path", v2Record("EXTERNAL_OPERATION_DISPATCHED", { ...externalOperationPayload(), role: "/var/private/worker" })],
    ["raw worker text", v2Record("EXTERNAL_OPERATION_DISPATCHED", { ...externalOperationPayload(), rawWorkerText: "worker response" })],
  ])("rejects %s", (_name, record) => {
    expect(() => validateReviewGateEventRecord(record)).toThrow();
  });
});

describe("encodeReviewGateEventRecord", () => {
  it("sorts all object keys independently of input insertion order", () => {
    const record = legacyRecord("FINDING_REMEDIATED", { lineageId: "lineage-1", findingId: "finding-1", remediationRound: { phase: "design", ordinal: 1 } });
    expect(encodeReviewGateEventRecord(validateReviewGateEventRecord(record))).toBe(
      '{"emittedAt":"2026-10-11T00:00:00.000Z","epochId":"epoch-1","eventType":"FINDING_REMEDIATED","gateId":"gate-1","payload":{"findingId":"finding-1","lineageId":"lineage-1","remediationRound":{"ordinal":1,"phase":"design"}},"writerId":"writer-1"}',
    );
  });
  it("round-trips validated records through canonical sorted JSON", () => {
    const event = validateReviewGateEventRecord(
      v2Record("EXTERNAL_OPERATION_DISPATCHED", externalOperationPayload()),
    );
    const encoded = encodeReviewGateEventRecord(event);

    expect(encodeReviewGateEventRecord(validateReviewGateEventRecord(JSON.parse(encoded)))).toBe(encoded);
  });
});
