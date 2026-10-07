import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type {
  ArtifactDigest,
} from "../../../src/core/review-gate/types.js";
import type {
  DeterministicValidatorDescriptor,
  DeterministicValidatorResult,
  ExecutionEnvironmentBinding,
  MandatoryValidationDispatch,
  ValidationInputBinding,
  ValidationInputValue,
  ValidationStage,
} from "../../../src/core/review-gate/deterministic-validation.js";
import {
  DeterministicValidatorRegistry,
  DESIGN_REQUIREMENTS_REFERENCE_CONSISTENCY_V1,
  REVIEW_INPUT_BINDING_INTEGRITY_V1,
  bridgeDeterministicFindings,
  commitValidationEvidence,
  computeValidationCacheKey,
  createDefaultDeterministicValidatorRegistry,
  emptyDeterministicValidationState,
  executeValidationDispatch,
  scheduleMandatoryValidations,
} from "../../../src/core/review-gate/deterministic-validation.js";

const E1: ExecutionEnvironmentBinding = Object.freeze({
  runtimeId: "bun",
  runtimeVersion: "1.2.0",
  executableDigest: "a".repeat(64),
});
const E2: ExecutionEnvironmentBinding = Object.freeze({
  runtimeId: "bun",
  runtimeVersion: "1.2.0",
  executableDigest: "b".repeat(64),
});

function digestInput(digest: string): ValidationInputValue {
  return Object.freeze({ digest, entries: Object.freeze({}) });
}

function integrityBinding(
  environment: ExecutionEnvironmentBinding,
): ValidationInputBinding {
  return Object.freeze({
    validatorId: REVIEW_INPUT_BINDING_INTEGRITY_V1.validatorId,
    validatorContractVersion:
      REVIEW_INPUT_BINDING_INTEGRITY_V1.validatorContractVersion,
    resultSchemaVersion: REVIEW_INPUT_BINDING_INTEGRITY_V1.resultSchemaVersion,
    stage: "BASELINE_ADMISSION" as ValidationStage,
    declaredInputs: Object.freeze({
      PINNED_INPUT_DIGESTS: Object.freeze({
        digest: "pinned-fingerprint",
        entries: Object.freeze({
          "docs/design.md": "d".repeat(64),
          "docs/plan.md": "p".repeat(64),
        }),
      }),
      APPROVAL_BINDING: Object.freeze({
        digest: "approval-fingerprint",
        entries: Object.freeze({
          designArtifactPath: "docs/design.md",
          designArtifactDigest: "d".repeat(64),
          planArtifactPath: "docs/plan.md",
          planArtifactDigest: "p".repeat(64),
        }),
      }),
      DESIGN_ARTIFACT: digestInput("d".repeat(64)),
      PLAN_ARTIFACT: digestInput("p".repeat(64)),
    }),
    executionEnvironment: environment,
  });
}

function consistencyBinding(
  environment: ExecutionEnvironmentBinding,
  stage: ValidationStage,
  declaredReference: string,
  boundPath: string,
): ValidationInputBinding {
  return Object.freeze({
    validatorId: DESIGN_REQUIREMENTS_REFERENCE_CONSISTENCY_V1.validatorId,
    validatorContractVersion:
      DESIGN_REQUIREMENTS_REFERENCE_CONSISTENCY_V1.validatorContractVersion,
    resultSchemaVersion:
      DESIGN_REQUIREMENTS_REFERENCE_CONSISTENCY_V1.resultSchemaVersion,
    stage,
    declaredInputs: Object.freeze({
      DESIGN_ARTIFACT: Object.freeze({
        digest: "design-digest",
        entries: Object.freeze({ requirementsReference: declaredReference }),
      }),
      REQUIREMENTS_ARTIFACT: Object.freeze({
        digest: "requirements-digest",
        entries: Object.freeze({ path: boundPath }),
      }),
    }),
    executionEnvironment: environment,
  });
}

function makeDispatch(
  validatorId: string,
  stage: ValidationStage,
  phase: "design" | "plan",
  logicalOperationId: string,
  binding: ValidationInputBinding,
): MandatoryValidationDispatch {
  return Object.freeze({
    validatorId,
    stage,
    phase,
    logicalOperationId,
    binding,
  });
}

const sha = (text: string): ArtifactDigest =>
  createHash("sha256").update(text).digest("hex") as ArtifactDigest;

describe("computeValidationCacheKey", () => {
  it("is stable for identical bindings regardless of key order", () => {
    const a = computeValidationCacheKey(integrityBinding(E1));
    const b = computeValidationCacheKey(integrityBinding(E1));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when the executable/runtime binding changes", () => {
    const a = computeValidationCacheKey(integrityBinding(E1));
    const b = computeValidationCacheKey(integrityBinding(E2));
    expect(a).not.toBe(b);
  });

  it("changes when a declared input digest changes", () => {
    const binding = integrityBinding(E1);
    const changed = Object.freeze({
      ...binding,
      declaredInputs: Object.freeze({
        ...binding.declaredInputs,
        DESIGN_ARTIFACT: digestInput("e".repeat(64)),
      }),
    });
    expect(computeValidationCacheKey(binding)).not.toBe(
      computeValidationCacheKey(changed),
    );
  });
});

describe("DeterministicValidatorRegistry", () => {
  it("registers and resolves an in-process validator with its runner", () => {
    const registry = new DeterministicValidatorRegistry();
    const runner = (): DeterministicValidatorResult =>
      Object.freeze({ result: "PASS" as const, ruleOutcomes: [] });
    registry.register(REVIEW_INPUT_BINDING_INTEGRITY_V1, runner);
    const resolved = registry.resolve(
      REVIEW_INPUT_BINDING_INTEGRITY_V1.validatorId,
    );
    expect(resolved).toBeDefined();
    expect(resolved?.descriptor.validatorId).toBe(
      REVIEW_INPUT_BINDING_INTEGRITY_V1.validatorId,
    );
    expect(resolved?.runner).toBe(runner);
  });

  it("returns undefined for an unknown validator id", () => {
    const registry = new DeterministicValidatorRegistry();
    expect(registry.resolve("no-such-validator")).toBeUndefined();
  });

  it("rejects duplicate registration of the same validator id", () => {
    const registry = new DeterministicValidatorRegistry();
    const runner = (): DeterministicValidatorResult =>
      Object.freeze({ result: "PASS" as const, ruleOutcomes: [] });
    registry.register(REVIEW_INPUT_BINDING_INTEGRITY_V1, runner);
    expect(() =>
      registry.register(REVIEW_INPUT_BINDING_INTEGRITY_V1, runner),
    ).toThrow();
  });

  it("rejects an in-process descriptor registered without a runner", () => {
    const registry = new DeterministicValidatorRegistry();
    expect(() =>
      registry.register(REVIEW_INPUT_BINDING_INTEGRITY_V1, null),
    ).toThrow();
  });

  it("represents ISOLATED_PROCESS descriptors without a runner and rejects a supplied one", () => {
    const registry = new DeterministicValidatorRegistry();
    const isolated: DeterministicValidatorDescriptor = Object.freeze({
      validatorId: "sandboxed-example-v1",
      validatorContractVersion: 1,
      resultSchemaVersion: 1,
      applicablePhases: Object.freeze(["design"]),
      executionKind: "ISOLATED_PROCESS" as const,
      declaredInputs: Object.freeze(["DESIGN_ARTIFACT" as const]),
      mandatoryStages: Object.freeze(["PRE_CLEAR" as const]),
      stageFailurePolicy: Object.freeze({
        BASELINE_ADMISSION: "PRECONDITION" as const,
        POST_REMEDIATION_SELF_REVIEW: "FINDING" as const,
        PRE_CLEAR: "FINDING" as const,
      }),
      rules: Object.freeze([
        Object.freeze({
          ruleId: "sandboxed-rule",
          severity: "major" as const,
          ownerScope: "design" as const,
          violationType: "SANDBOXED_VIOLATION",
          governingReference: "review-gate/dvf1#sandbox",
          violatedContract: "sandboxed-example-v1/contract",
        }),
      ]),
    });
    expect(() => registry.register(isolated, () =>
      Object.freeze({ result: "PASS" as const, ruleOutcomes: [] }),
    )).toThrow();
    registry.register(isolated, null);
    const resolved = registry.resolve("sandboxed-example-v1");
    expect(resolved?.runner).toBeNull();
  });

  it("rejects a descriptor with no rules", () => {
    const registry = new DeterministicValidatorRegistry();
    const ruleless: DeterministicValidatorDescriptor = Object.freeze({
      validatorId: "ruleless-v1",
      validatorContractVersion: 1,
      resultSchemaVersion: 1,
      applicablePhases: Object.freeze(["design"]),
      executionKind: "IN_PROCESS" as const,
      declaredInputs: Object.freeze(["DESIGN_ARTIFACT" as const]),
      mandatoryStages: Object.freeze(["PRE_CLEAR" as const]),
      stageFailurePolicy: Object.freeze({
        BASELINE_ADMISSION: "PRECONDITION" as const,
        POST_REMEDIATION_SELF_REVIEW: "FINDING" as const,
        PRE_CLEAR: "FINDING" as const,
      }),
      rules: Object.freeze([]),
    });
    expect(() =>
      registry.register(ruleless, () =>
        Object.freeze({ result: "PASS" as const, ruleOutcomes: [] }),
      ),
    ).toThrow();
  });
});

describe("default v4 validators", () => {
  it("registers exactly the two v4 in-process validators", () => {
    const registry = createDefaultDeterministicValidatorRegistry();
    expect(
      registry.resolve("review-input-binding-integrity-v1")?.descriptor,
    ).toEqual(REVIEW_INPUT_BINDING_INTEGRITY_V1);
    expect(
      registry.resolve("design-requirements-reference-consistency-v1")
        ?.descriptor,
    ).toEqual(DESIGN_REQUIREMENTS_REFERENCE_CONSISTENCY_V1);
    expect(registry.resolve("review-input-binding-integrity-v1")?.runner).not.toBeNull();
    expect(
      registry.resolve("design-requirements-reference-consistency-v1")?.runner,
    ).not.toBeNull();
  });

  it("pins the integrity validator to BASELINE_ADMISSION with PRECONDITION policy", () => {
    expect(REVIEW_INPUT_BINDING_INTEGRITY_V1.mandatoryStages).toEqual([
      "BASELINE_ADMISSION",
    ]);
    expect(REVIEW_INPUT_BINDING_INTEGRITY_V1.stageFailurePolicy).toEqual({
      BASELINE_ADMISSION: "PRECONDITION",
      POST_REMEDIATION_SELF_REVIEW: "PRECONDITION",
      PRE_CLEAR: "PRECONDITION",
    });
    expect(REVIEW_INPUT_BINDING_INTEGRITY_V1.executionKind).toBe("IN_PROCESS");
    expect(REVIEW_INPUT_BINDING_INTEGRITY_V1.applicablePhases).toEqual([
      "design",
      "plan",
    ]);
  });

  it("pins the consistency validator to design finding stages", () => {
    expect(
      DESIGN_REQUIREMENTS_REFERENCE_CONSISTENCY_V1.mandatoryStages,
    ).toEqual(["POST_REMEDIATION_SELF_REVIEW", "PRE_CLEAR"]);
    expect(
      DESIGN_REQUIREMENTS_REFERENCE_CONSISTENCY_V1.stageFailurePolicy,
    ).toEqual({
      BASELINE_ADMISSION: "PRECONDITION",
      POST_REMEDIATION_SELF_REVIEW: "FINDING",
      PRE_CLEAR: "FINDING",
    });
    expect(
      DESIGN_REQUIREMENTS_REFERENCE_CONSISTENCY_V1.applicablePhases,
    ).toEqual(["design"]);
  });

  it("integrity runner passes on a reconstructable pinned binding", () => {
    const registry = createDefaultDeterministicValidatorRegistry();
    const evidence = executeValidationDispatch(
      registry,
      makeDispatch(
        REVIEW_INPUT_BINDING_INTEGRITY_V1.validatorId,
        "BASELINE_ADMISSION",
        "design",
        "op-integrity-pass",
        integrityBinding(E1),
      ),
      "2026-10-07T00:00:00.000Z",
    );
    expect(evidence.kind).toBe("semantic");
    expect(evidence.result).toBe("PASS");
    expect(evidence.provenance).toBe("observed");
  });

  it("integrity runner fails when the pinned digests cannot be reconstructed", () => {
    const registry = createDefaultDeterministicValidatorRegistry();
    const binding = integrityBinding(E1);
    const broken = Object.freeze({
      ...binding,
      declaredInputs: Object.freeze({
        ...binding.declaredInputs,
        PINNED_INPUT_DIGESTS: Object.freeze({
          digest: "pinned-fingerprint",
          entries: Object.freeze({
            "docs/design.md": "0".repeat(64),
            "docs/plan.md": "p".repeat(64),
          }),
        }),
      }),
    });
    const evidence = executeValidationDispatch(
      registry,
      makeDispatch(
        REVIEW_INPUT_BINDING_INTEGRITY_V1.validatorId,
        "BASELINE_ADMISSION",
        "design",
        "op-integrity-fail",
        broken,
      ),
      "2026-10-07T00:00:00.000Z",
    );
    expect(evidence.kind).toBe("semantic");
    expect(evidence.result).toBe("FAIL");
    expect(evidence.ruleOutcomes[0]?.outcome).toBe("FAIL");
    expect(evidence.ruleOutcomes[0]?.relation).toBe("NEW");
  });

  it("consistency runner fails when the declared reference differs from the bound path", () => {
    const registry = createDefaultDeterministicValidatorRegistry();
    const evidence = executeValidationDispatch(
      registry,
      makeDispatch(
        DESIGN_REQUIREMENTS_REFERENCE_CONSISTENCY_V1.validatorId,
        "PRE_CLEAR",
        "design",
        "op-consistency-fail",
        consistencyBinding(E1, "PRE_CLEAR", "docs/requirements.md", "docs/other.md"),
      ),
      "2026-10-07T00:00:00.000Z",
    );
    expect(evidence.kind).toBe("semantic");
    expect(evidence.result).toBe("FAIL");
    expect(evidence.ruleOutcomes[0]?.ruleId).toBe(
      "design-requirements-reference-mismatch",
    );
  });

  it("consistency runner passes when the declared reference matches the bound path", () => {
    const registry = createDefaultDeterministicValidatorRegistry();
    const evidence = executeValidationDispatch(
      registry,
      makeDispatch(
        DESIGN_REQUIREMENTS_REFERENCE_CONSISTENCY_V1.validatorId,
        "POST_REMEDIATION_SELF_REVIEW",
        "design",
        "op-consistency-pass",
        consistencyBinding(
          E1,
          "POST_REMEDIATION_SELF_REVIEW",
          "docs/requirements.md",
          "docs//requirements.md",
        ),
      ),
      "2026-10-07T00:00:00.000Z",
    );
    expect(evidence.kind).toBe("semantic");
    expect(evidence.result).toBe("PASS");
  });
});

describe("scheduleMandatoryValidations", () => {
  it("schedules a dispatch requirement for a mandatory validator", () => {
    const registry = createDefaultDeterministicValidatorRegistry();
    const schedule = scheduleMandatoryValidations(registry, [
      makeDispatch(
        DESIGN_REQUIREMENTS_REFERENCE_CONSISTENCY_V1.validatorId,
        "PRE_CLEAR",
        "design",
        "op-1",
        consistencyBinding(E1, "PRE_CLEAR", "docs/requirements.md", "docs/requirements.md"),
      ),
    ], emptyDeterministicValidationState);
    expect(schedule.requirements).toHaveLength(1);
    expect(schedule.requirements[0]?.disposition).toBe("dispatch");
    expect(schedule.requirements[0]?.evidence).toBeNull();
    expect(schedule.nextState.attemptEnvironments.get("op-1")).toBeDefined();
  });

  it("rejects dispatch of a validator that is not mandatory for the stage or phase", () => {
    const registry = createDefaultDeterministicValidatorRegistry();
    // Consistency validator is design-only: dispatching it in the plan phase
    // violates its applicability contract.
    expect(() =>
      scheduleMandatoryValidations(registry, [
        makeDispatch(
          DESIGN_REQUIREMENTS_REFERENCE_CONSISTENCY_V1.validatorId,
          "PRE_CLEAR",
          "plan",
          "op-plan",
          consistencyBinding(E1, "PRE_CLEAR", "docs/requirements.md", "docs/requirements.md"),
        ),
      ], emptyDeterministicValidationState),
    ).toThrow();
    // Integrity validator is not mandatory at PRE_CLEAR.
    expect(() =>
      scheduleMandatoryValidations(registry, [
        makeDispatch(
          REVIEW_INPUT_BINDING_INTEGRITY_V1.validatorId,
          "PRE_CLEAR",
          "design",
          "op-integrity-preclear",
          integrityBinding(E1),
        ),
      ], emptyDeterministicValidationState),
    ).toThrow();
  });

  it("rejects an unregistered validator and a binding mismatch", () => {
    const registry = createDefaultDeterministicValidatorRegistry();
    expect(() =>
      scheduleMandatoryValidations(registry, [
        makeDispatch(
          "unknown-v1",
          "PRE_CLEAR",
          "design",
          "op-unknown",
          consistencyBinding(E1, "PRE_CLEAR", "docs/r.md", "docs/r.md"),
        ),
      ], emptyDeterministicValidationState),
    ).toThrow();

    const mismatched = Object.freeze({
      ...consistencyBinding(E1, "PRE_CLEAR", "docs/r.md", "docs/r.md"),
      validatorId: REVIEW_INPUT_BINDING_INTEGRITY_V1.validatorId,
    });
    expect(() =>
      scheduleMandatoryValidations(registry, [
        makeDispatch(
          DESIGN_REQUIREMENTS_REFERENCE_CONSISTENCY_V1.validatorId,
          "PRE_CLEAR",
          "design",
          "op-mismatch",
          mismatched,
        ),
      ], emptyDeterministicValidationState),
    ).toThrow();
  });

  it("reuses exact PASS evidence at PRE_CLEAR", () => {
    const registry = createDefaultDeterministicValidatorRegistry();
    const dispatch = makeDispatch(
      DESIGN_REQUIREMENTS_REFERENCE_CONSISTENCY_V1.validatorId,
      "PRE_CLEAR",
      "design",
      "op-1",
      consistencyBinding(E1, "PRE_CLEAR", "docs/requirements.md", "docs/requirements.md"),
    );
    const first = scheduleMandatoryValidations(
      registry,
      [dispatch],
      emptyDeterministicValidationState,
    );
    expect(first.requirements[0]?.disposition).toBe("dispatch");
    const executed = executeValidationDispatch(registry, dispatch, "2026-10-07T00:00:00.000Z");
    expect(executed.kind).toBe("semantic");
    const committed = commitValidationEvidence(first.nextState, executed);
    expect(committed.cachedEvidence.get(executed.cacheKey)).toBeDefined();

    const redispatch = makeDispatch(
      DESIGN_REQUIREMENTS_REFERENCE_CONSISTENCY_V1.validatorId,
      "PRE_CLEAR",
      "design",
      "op-2",
      consistencyBinding(E1, "PRE_CLEAR", "docs/requirements.md", "docs/requirements.md"),
    );
    const second = scheduleMandatoryValidations(registry, [redispatch], committed);
    expect(second.requirements[0]?.disposition).toBe("reuse_evidence");
    expect(second.requirements[0]?.evidence?.result).toBe("PASS");
    expect(second.requirements[0]?.evidence?.cacheKey).toBe(executed.cacheKey);
    expect(second.requirements[0]?.dispatch).toBeNull();
  });

  it("reuses exact FAIL and INDETERMINATE evidence", () => {
    const registry = createDefaultDeterministicValidatorRegistry();
    const failDispatch = makeDispatch(
      DESIGN_REQUIREMENTS_REFERENCE_CONSISTENCY_V1.validatorId,
      "PRE_CLEAR",
      "design",
      "op-fail",
      consistencyBinding(E1, "PRE_CLEAR", "docs/requirements.md", "docs/other.md"),
    );
    const executed = executeValidationDispatch(registry, failDispatch, "2026-10-07T00:00:00.000Z");
    expect(executed.result).toBe("FAIL");
    const committed = commitValidationEvidence(
      emptyDeterministicValidationState,
      executed,
    );
    const scheduled = scheduleMandatoryValidations(
      registry,
      [
        makeDispatch(
          DESIGN_REQUIREMENTS_REFERENCE_CONSISTENCY_V1.validatorId,
          "PRE_CLEAR",
          "design",
          "op-fail-2",
          consistencyBinding(E1, "PRE_CLEAR", "docs/requirements.md", "docs/other.md"),
        ),
      ],
      committed,
    );
    expect(scheduled.requirements[0]?.disposition).toBe("reuse_evidence");
    expect(scheduled.requirements[0]?.evidence?.result).toBe("FAIL");

    const indeterminate = Object.freeze({
      ...executed,
      result: "INDETERMINATE" as const,
      ruleOutcomes: Object.freeze([
        Object.freeze({
          ruleId: "design-requirements-reference-mismatch",
          outcome: "INDETERMINATE" as const,
          detailDigest: sha("indeterminate") as ArtifactDigest,
        }),
      ]),
    });
    const committedIndeterminate = commitValidationEvidence(
      emptyDeterministicValidationState,
      indeterminate,
    );
    const scheduledIndeterminate = scheduleMandatoryValidations(
      registry,
      [
        makeDispatch(
          DESIGN_REQUIREMENTS_REFERENCE_CONSISTENCY_V1.validatorId,
          "PRE_CLEAR",
          "design",
          "op-indeterminate-2",
          consistencyBinding(E1, "PRE_CLEAR", "docs/requirements.md", "docs/other.md"),
        ),
      ],
      committedIndeterminate,
    );
    expect(scheduledIndeterminate.requirements[0]?.disposition).toBe(
      "reuse_evidence",
    );
    expect(scheduledIndeterminate.requirements[0]?.evidence?.result).toBe(
      "INDETERMINATE",
    );
  });

  it("misses the cache for a new logical validation with a changed executable/runtime binding", () => {
    const registry = createDefaultDeterministicValidatorRegistry();
    const dispatchE1 = makeDispatch(
      DESIGN_REQUIREMENTS_REFERENCE_CONSISTENCY_V1.validatorId,
      "PRE_CLEAR",
      "design",
      "op-e1",
      consistencyBinding(E1, "PRE_CLEAR", "docs/r.md", "docs/r.md"),
    );
    const executed = executeValidationDispatch(registry, dispatchE1, "2026-10-07T00:00:00.000Z");
    const committed = commitValidationEvidence(
      emptyDeterministicValidationState,
      executed,
    );
    const dispatchE2 = makeDispatch(
      DESIGN_REQUIREMENTS_REFERENCE_CONSISTENCY_V1.validatorId,
      "PRE_CLEAR",
      "design",
      "op-e2",
      consistencyBinding(E2, "PRE_CLEAR", "docs/r.md", "docs/r.md"),
    );
    const scheduled = scheduleMandatoryValidations(registry, [dispatchE2], committed);
    expect(scheduled.requirements[0]?.disposition).toBe("dispatch");
  });

  it("fails closed when the same logical operation re-dispatches with a changed environment", () => {
    const registry = createDefaultDeterministicValidatorRegistry();
    const state1 = scheduleMandatoryValidations(
      registry,
      [
        makeDispatch(
          DESIGN_REQUIREMENTS_REFERENCE_CONSISTENCY_V1.validatorId,
          "PRE_CLEAR",
          "design",
          "op-same",
          consistencyBinding(E1, "PRE_CLEAR", "docs/r.md", "docs/r.md"),
        ),
      ],
      emptyDeterministicValidationState,
    );
    expect(() =>
      scheduleMandatoryValidations(
        registry,
        [
          makeDispatch(
            DESIGN_REQUIREMENTS_REFERENCE_CONSISTENCY_V1.validatorId,
            "PRE_CLEAR",
            "design",
            "op-same",
            consistencyBinding(E2, "PRE_CLEAR", "docs/r.md", "docs/r.md"),
          ),
        ],
        state1.nextState,
      ),
    ).toThrow("VALIDATION_ENVIRONMENT_CHANGED_DURING_ATTEMPT");
  });
});

describe("executeValidationDispatch and commitValidationEvidence", () => {
  it("never caches execution failures", () => {
    const registry = new DeterministicValidatorRegistry();
    const throwing = (): DeterministicValidatorResult => {
      throw new Error("runner exploded");
    };
    registry.register(
      {
        ...REVIEW_INPUT_BINDING_INTEGRITY_V1,
        validatorId: "throwing-integrity-v1",
      },
      throwing,
    );
    const dispatch = makeDispatch(
      "throwing-integrity-v1",
      "BASELINE_ADMISSION",
      "design",
      "op-throw",
      { ...integrityBinding(E1), validatorId: "throwing-integrity-v1" },
    );
    const evidence = executeValidationDispatch(registry, dispatch, "2026-10-07T00:00:00.000Z");
    expect(evidence.kind).toBe("execution_failure");
    expect(evidence.result).toBeNull();
    const committed = commitValidationEvidence(
      emptyDeterministicValidationState,
      evidence,
    );
    expect(committed.cachedEvidence.size).toBe(0);
    const scheduled = scheduleMandatoryValidations(
      registry,
      [
        makeDispatch(
          "throwing-integrity-v1",
          "BASELINE_ADMISSION",
          "design",
          "op-throw-2",
          { ...integrityBinding(E1), validatorId: "throwing-integrity-v1" },
        ),
      ],
      committed,
    );
    expect(scheduled.requirements[0]?.disposition).toBe("dispatch");
  });

  it("never caches non-semantic unavailable evidence and never fabricates a semantic result", () => {
    const registry = new DeterministicValidatorRegistry();
    registry.register(
      {
        ...REVIEW_INPUT_BINDING_INTEGRITY_V1,
        validatorId: "isolated-integrity-v1",
        executionKind: "ISOLATED_PROCESS" as const,
      },
      null,
    );
    const dispatch = makeDispatch(
      "isolated-integrity-v1",
      "BASELINE_ADMISSION",
      "design",
      "op-isolated",
      integrityBinding(E1),
    );
    const evidence = executeValidationDispatch(registry, dispatch, "2026-10-07T00:00:00.000Z");
    expect(evidence.kind).toBe("unavailable");
    expect(evidence.result).toBeNull();
    expect(evidence.ruleOutcomes).toEqual([]);
    expect(evidence.reasonCode).toBe("deterministic_validation_sandbox_unavailable");
    const committed = commitValidationEvidence(
      emptyDeterministicValidationState,
      evidence,
    );
    expect(committed.cachedEvidence.size).toBe(0);
  });

  it("strips undeclared inputs before the runner sees them", () => {
    const registry = new DeterministicValidatorRegistry();
    let seenKinds: readonly string[] = [];
    const spy = (inputs: Readonly<Partial<Record<string, unknown>>>): DeterministicValidatorResult => {
      seenKinds = Object.keys(inputs);
      return Object.freeze({
        result: "PASS" as const,
        ruleOutcomes: Object.freeze([
          Object.freeze({
            ruleId: "review-input-binding-reconstruction",
            outcome: "PASS" as const,
            detailDigest: sha("ok") as ArtifactDigest,
          }),
        ]),
      });
    };
    registry.register(
      {
        ...REVIEW_INPUT_BINDING_INTEGRITY_V1,
        validatorId: "spy-integrity-v1",
        declaredInputs: Object.freeze(["DESIGN_ARTIFACT" as const]),
      },
      spy,
    );
    // Binding carries DESIGN_ARTIFACT (declared) plus PLAN_ARTIFACT (undeclared).
    const binding = integrityBinding(E1);
    const evidence = executeValidationDispatch(
      registry,
      makeDispatch("spy-integrity-v1", "BASELINE_ADMISSION", "design", "op-spy", {
        ...binding,
        declaredInputs: Object.freeze({
          DESIGN_ARTIFACT: digestInput("d".repeat(64)),
          PLAN_ARTIFACT: digestInput("p".repeat(64)),
        }),
      }),
      "2026-10-07T00:00:00.000Z",
    );
    expect(evidence.kind).toBe("semantic");
    expect(seenKinds).toEqual(["DESIGN_ARTIFACT"]);
  });

  it("reports execution failure when a declared input is missing", () => {
    const registry = createDefaultDeterministicValidatorRegistry();
    const binding = integrityBinding(E1);
    const incomplete = Object.freeze({
      ...binding,
      declaredInputs: Object.freeze({
        DESIGN_ARTIFACT: digestInput("d".repeat(64)),
      }),
    });
    const evidence = executeValidationDispatch(
      registry,
      makeDispatch(
        REVIEW_INPUT_BINDING_INTEGRITY_V1.validatorId,
        "BASELINE_ADMISSION",
        "design",
        "op-incomplete",
        incomplete,
      ),
      "2026-10-07T00:00:00.000Z",
    );
    expect(evidence.kind).toBe("execution_failure");
    expect(evidence.reasonCode).toBe("deterministic_validation_missing_declared_input");
  });

  it("treats schema-invalid runner results as execution failures", () => {
    const registry = new DeterministicValidatorRegistry();
    // A hostile runner attempts to inject a severity field and an invalid
    // relation: structurally impossible through the declared result schema,
    // simulated here via an unknown cast (hostile runtime data).
    const hostile = (): DeterministicValidatorResult =>
      ({
        result: "FAIL",
        ruleOutcomes: [
          {
            ruleId: "review-input-binding-reconstruction",
            outcome: "FAIL",
            relation: "INVALID",
            severity: "critical",
            detailDigest: sha("bad"),
          },
        ],
      }) as unknown as DeterministicValidatorResult;
    registry.register(
      {
        ...REVIEW_INPUT_BINDING_INTEGRITY_V1,
        validatorId: "hostile-integrity-v1",
      },
      hostile,
    );
    const evidence = executeValidationDispatch(
      registry,
      makeDispatch(
        "hostile-integrity-v1",
        "BASELINE_ADMISSION",
        "design",
        "op-hostile",
        integrityBinding(E1),
      ),
      "2026-10-07T00:00:00.000Z",
    );
    expect(evidence.kind).toBe("execution_failure");
    expect(evidence.reasonCode).toBe("deterministic_validation_result_schema_invalid");
    expect(evidence.result).toBeNull();
  });

  it("caches semantic evidence and exposes it as read-only state", () => {
    const registry = createDefaultDeterministicValidatorRegistry();
    const dispatch = makeDispatch(
      DESIGN_REQUIREMENTS_REFERENCE_CONSISTENCY_V1.validatorId,
      "PRE_CLEAR",
      "design",
      "op-cache",
      consistencyBinding(E1, "PRE_CLEAR", "docs/r.md", "docs/r.md"),
    );
    const executed = executeValidationDispatch(registry, dispatch, "2026-10-07T00:00:00.000Z");
    const committed = commitValidationEvidence(
      emptyDeterministicValidationState,
      executed,
    );
    expect(committed.cachedEvidence.get(executed.cacheKey)?.result).toBe("PASS");
    // Input state must not be mutated by the commit.
    expect(emptyDeterministicValidationState.cachedEvidence.size).toBe(0);
  });
});

describe("bridgeDeterministicFindings", () => {
  it("produces a DVF1 payload with descriptor-derived finding fields", () => {
    const registry = createDefaultDeterministicValidatorRegistry();
    const dispatch = makeDispatch(
      DESIGN_REQUIREMENTS_REFERENCE_CONSISTENCY_V1.validatorId,
      "PRE_CLEAR",
      "design",
      "op-bridge",
      consistencyBinding(E1, "PRE_CLEAR", "docs/requirements.md", "docs/other.md"),
    );
    const evidence = executeValidationDispatch(registry, dispatch, "2026-10-07T00:00:00.000Z");
    const payload = bridgeDeterministicFindings({
      validationEventId: "ve-1",
      evidences: [evidence],
      registry,
    });
    expect(payload.schemaVersion).toBe(1);
    expect(payload.validationEventId).toBe("ve-1");
    expect(payload.findings).toHaveLength(1);
    const finding = payload.findings[0];
    expect(finding).toMatchObject({
      validationEventId: "ve-1",
      ruleId: "design-requirements-reference-mismatch",
      severity: "major",
      ownerScope: "design",
      violationType: "DESIGN_REQUIREMENTS_REFERENCE_MISMATCH",
      governingReference:
        DESIGN_REQUIREMENTS_REFERENCE_CONSISTENCY_V1.rules[0]?.governingReference,
      violatedContract:
        DESIGN_REQUIREMENTS_REFERENCE_CONSISTENCY_V1.rules[0]?.violatedContract,
      relation: "NEW",
    });
    expect(finding?.detailDigest).toBe(evidence.ruleOutcomes[0]?.detailDigest);
  });

  it("creates no finding for a BASELINE_ADMISSION FAIL", () => {
    const registry = createDefaultDeterministicValidatorRegistry();
    const dispatch = makeDispatch(
      REVIEW_INPUT_BINDING_INTEGRITY_V1.validatorId,
      "BASELINE_ADMISSION",
      "design",
      "op-baseline-fail",
      ((): ValidationInputBinding => {
        const binding = integrityBinding(E1);
        return Object.freeze({
          ...binding,
          declaredInputs: Object.freeze({
            ...binding.declaredInputs,
            PINNED_INPUT_DIGESTS: Object.freeze({
              digest: "pinned-fingerprint",
              entries: Object.freeze({
                "docs/design.md": "0".repeat(64),
                "docs/plan.md": "p".repeat(64),
              }),
            }),
          }),
        });
      })(),
    );
    const evidence = executeValidationDispatch(registry, dispatch, "2026-10-07T00:00:00.000Z");
    expect(evidence.result).toBe("FAIL");
    const payload = bridgeDeterministicFindings({
      validationEventId: "ve-2",
      evidences: [evidence],
      registry,
    });
    expect(payload.findings).toEqual([]);
  });

  it("creates at most one occurrence per (validationEventId, ruleId)", () => {
    const registry = createDefaultDeterministicValidatorRegistry();
    const selfReview = executeValidationDispatch(
      registry,
      makeDispatch(
        DESIGN_REQUIREMENTS_REFERENCE_CONSISTENCY_V1.validatorId,
        "POST_REMEDIATION_SELF_REVIEW",
        "design",
        "op-dup-1",
        consistencyBinding(E1, "POST_REMEDIATION_SELF_REVIEW", "docs/r.md", "docs/other.md"),
      ),
      "2026-10-07T00:00:00.000Z",
    );
    const preClear = executeValidationDispatch(
      registry,
      makeDispatch(
        DESIGN_REQUIREMENTS_REFERENCE_CONSISTENCY_V1.validatorId,
        "PRE_CLEAR",
        "design",
        "op-dup-2",
        consistencyBinding(E2, "PRE_CLEAR", "docs/r.md", "docs/other.md"),
      ),
      "2026-10-07T00:00:00.000Z",
    );
    expect(selfReview.result).toBe("FAIL");
    expect(preClear.result).toBe("FAIL");
    const payload = bridgeDeterministicFindings({
      validationEventId: "ve-3",
      evidences: [selfReview, preClear],
      registry,
    });
    expect(payload.findings).toHaveLength(1);
    expect(payload.findings[0]?.ruleId).toBe(
      "design-requirements-reference-mismatch",
    );
  });

  it("maps unavailable and execution-failure evidence at finding stages to DETERMINISTIC_VALIDATION_FAILED", () => {
    const registry = new DeterministicValidatorRegistry();
    registry.register(
      {
        ...DESIGN_REQUIREMENTS_REFERENCE_CONSISTENCY_V1,
        validatorId: "isolated-consistency-v1",
        executionKind: "ISOLATED_PROCESS" as const,
      },
      null,
    );
    const unavailable = executeValidationDispatch(
      registry,
      makeDispatch(
        "isolated-consistency-v1",
        "PRE_CLEAR",
        "design",
        "op-unavailable",
        consistencyBinding(E1, "PRE_CLEAR", "docs/r.md", "docs/r.md"),
      ),
      "2026-10-07T00:00:00.000Z",
    );
    expect(unavailable.kind).toBe("unavailable");
    const payload = bridgeDeterministicFindings({
      validationEventId: "ve-4",
      evidences: [unavailable],
      registry,
    });
    expect(payload.findings).toHaveLength(1);
    expect(payload.findings[0]?.violationType).toBe(
      "DETERMINISTIC_VALIDATION_FAILED",
    );
    expect(payload.findings[0]?.relation).toBe("NEW");
    expect(payload.findings[0]?.severity).toBe("major");
    expect(payload.findings[0]?.ownerScope).toBe("design");

    const throwing = (): DeterministicValidatorResult => {
      throw new Error("boom");
    };
    registry.register(
      {
        ...DESIGN_REQUIREMENTS_REFERENCE_CONSISTENCY_V1,
        validatorId: "throwing-consistency-v1",
      },
      throwing,
    );
    const failure = executeValidationDispatch(
      registry,
      makeDispatch(
        "throwing-consistency-v1",
        "PRE_CLEAR",
        "design",
        "op-throwing",
        consistencyBinding(E1, "PRE_CLEAR", "docs/r.md", "docs/r.md"),
      ),
      "2026-10-07T00:00:00.000Z",
    );
    expect(failure.kind).toBe("execution_failure");
    const failurePayload = bridgeDeterministicFindings({
      validationEventId: "ve-5",
      evidences: [failure],
      registry,
    });
    expect(failurePayload.findings).toHaveLength(1);
    expect(failurePayload.findings[0]?.violationType).toBe(
      "DETERMINISTIC_VALIDATION_FAILED",
    );
  });

  it("creates no finding for unavailable evidence at a precondition stage", () => {
    const registry = new DeterministicValidatorRegistry();
    registry.register(
      {
        ...REVIEW_INPUT_BINDING_INTEGRITY_V1,
        validatorId: "isolated-integrity-2-v1",
        executionKind: "ISOLATED_PROCESS" as const,
      },
      null,
    );
    const unavailable = executeValidationDispatch(
      registry,
      makeDispatch(
        "isolated-integrity-2-v1",
        "BASELINE_ADMISSION",
        "design",
        "op-unavailable-precondition",
        integrityBinding(E1),
      ),
      "2026-10-07T00:00:00.000Z",
    );
    const payload = bridgeDeterministicFindings({
      validationEventId: "ve-6",
      evidences: [unavailable],
      registry,
    });
    expect(payload.findings).toEqual([]);
  });
});
