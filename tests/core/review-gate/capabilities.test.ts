import { describe, expect, it } from "vitest";
import {
  buildReviewQueryScope,
  classifyReviewModelTool,
  classifyReviewTargetClean,
  gitModeFromOwnerExecBits,
  isReviewQueryPathAllowed,
  ReviewGateCapabilityRegistry,
} from "../../../src/core/review-gate/capabilities";
import type {
  GitIndexEntryBindingV1,
  GitTreeEntryBindingV1,
  WorktreeArtifactBindingV1,
  ReviewMutationCapabilityInput,
  ReviewQueryScope,
  ReviewTargetGitBinding,
  ScopedToolUse,
} from "../../../src/core/review-gate/capabilities";

const treeEntry = (
  blobSha: string,
  gitMode: "100644" | "100755" = "100644",
  canonicalPath = "docs/design.md",
): GitTreeEntryBindingV1 => ({ canonicalPath, blobSha, gitMode });

const indexEntry = (
  blobSha: string,
  gitMode: "100644" | "100755" = "100644",
  canonicalPath = "docs/design.md",
): GitIndexEntryBindingV1 => ({ canonicalPath, blobSha, gitMode, stage: 0 });

const worktree = (
  digest: string,
  gitMode: "100644" | "100755" = "100644",
  canonicalPath = "docs/design.md",
): WorktreeArtifactBindingV1 => ({ canonicalPath, digest, gitMode });

const cleanBinding = (
  overrides: Partial<ReviewTargetGitBinding> = {},
): ReviewTargetGitBinding => ({
  canonicalPath: "docs/design.md",
  headSha: "a000000000000000000000000000000000000000",
  headEntry: treeEntry("b111"),
  indexEntry: indexEntry(
    overrides.headEntry?.blobSha ?? "b111",
    overrides.headEntry?.gitMode ?? "100644",
  ),
  indexConflicted: false,
  worktree: worktree("b111".repeat(16)),
  headBlobDigest: "b111".repeat(16),
  ...overrides,
});

describe("ReviewQueryScope construction (CAP1 scope composition)", () => {
  it("Design scope = bound Requirements + current Design only", () => {
    const scope = buildReviewQueryScope("design", {
      requirementsCanonicalPath: "requirements.md",
      approvedDesignCanonicalPath: null,
      currentPhaseArtifactCanonicalPath: "docs/design.md",
    });
    expect([...scope.allowedArtifactPaths].sort()).toEqual(["docs/design.md", "requirements.md"]);
    expect([...scope.allowedGitPaths].sort()).toEqual(["docs/design.md", "requirements.md"]);
    expect([...scope.allowedArtifactPaths]).not.toContain("docs/plans/plan.md");
    expect(scope.phase).toBe("design");
  });

  it("Plan scope = effective approved Design + current Plan only", () => {
    const scope = buildReviewQueryScope("plan", {
      requirementsCanonicalPath: "requirements.md",
      approvedDesignCanonicalPath: "docs/design.md",
      currentPhaseArtifactCanonicalPath: "docs/plans/plan.md",
    });
    expect([...scope.allowedArtifactPaths].sort()).toEqual(["docs/design.md", "docs/plans/plan.md"]);
    expect([...scope.allowedGitPaths].sort()).toEqual(["docs/design.md", "docs/plans/plan.md"]);
    expect([...scope.allowedArtifactPaths]).not.toContain("requirements.md");
  });

  it("Design scope with run away boundaries rejects non-canonical membership", () => {
    expect(() =>
      buildReviewQueryScope("design", {
        requirementsCanonicalPath: "../escape.md",
        approvedDesignCanonicalPath: null,
        currentPhaseArtifactCanonicalPath: "docs/design.md",
      }),
    ).toThrow("review_gate_invalid_artifact_path");
  });

  it("Plan scope requires an approved Design authority", () => {
    expect(() =>
      buildReviewQueryScope("plan", {
        requirementsCanonicalPath: "requirements.md",
        approvedDesignCanonicalPath: null,
        currentPhaseArtifactCanonicalPath: "docs/plans/plan.md",
      }),
    ).toThrow("review_gate_invalid_artifact_path");
  });

  it("keeps membership snapshots independent from the caller-provided arrays", () => {
    const members = ["requirements.md", "docs/design.md"];
    const scope = buildReviewQueryScope("design", {
      requirementsCanonicalPath: members[0]!,
      approvedDesignCanonicalPath: null,
      currentPhaseArtifactCanonicalPath: members[1]!,
    });
    members.length = 0;
    expect(scope.allowedArtifactPaths.size).toBe(2);
  });
});

describe("review query scoping predicates", () => {
  const scope: ReviewQueryScope = {
    phase: "design",
    allowedArtifactPaths: new Set(["docs/design.md", "requirements.md"]),
    allowedGitPaths: new Set(["docs/design.md"]),
  };

  it("allows exact canonical phase artifact paths", () => {
    expect(isReviewQueryPathAllowed(scope, "artifact", "docs/design.md")).toBe(true);
    expect(isReviewQueryPathAllowed(scope, "git", "docs/design.md")).toBe(true);
    expect(isReviewQueryPathAllowed(scope, "artifact", "requirements.md")).toBe(true);
  });

  it("denies git paths outside allowedGitPaths even when artifact-visible", () => {
    expect(isReviewQueryPathAllowed(scope, "git", "requirements.md")).toBe(false);
  });

  it("denies traversal/canonicalized paths", () => {
    expect(isReviewQueryPathAllowed(scope, "artifact", "../design.md")).toBe(false);
    expect(isReviewQueryPathAllowed(scope, "artifact", "/abs/design.md")).toBe(false);
    expect(isReviewQueryPathAllowed(scope, "artifact", "docs/design")).toBe(false);
  });
});

describe("ReviewGateCapabilityRegistry actor matrix", () => {
  const capabilityInput: ReviewMutationCapabilityInput = {
    gateId: "gate-1",
    operationId: "op-1",
    phase: "design",
    remediationRound: 2,
    targetCanonicalPath: "docs/design.md",
    expectedPreDigest: "1111",
    expectedPreGitMode: "100644",
    phaseBaselineRevision: 3,
  };

  const authorizedUse: ScopedToolUse = {
    toolName: "edit",
    targetCanonicalPath: "docs/design.md",
    gateId: "gate-1",
    operationId: "op-1",
    phase: "design",
    remediationRound: 2,
  };

  it("issues a single-use capability bound to full mutation context", () => {
    const registry = new ReviewGateCapabilityRegistry();
    const capability = registry.issueMutation(capabilityInput);

    expect(capability.capabilityId.length).toBeGreaterThan(0);
    expect(capability.input).toEqual(capabilityInput);
    expect(capability.remainingUses).toBe(1);
  });

  it("authorizes a matching mutation tool use and burns the token", () => {
    const registry = new ReviewGateCapabilityRegistry();
    const capability = registry.issueMutation(capabilityInput);

    const decision = registry.consumeMutation(capability.capabilityId, authorizedUse);
    expect(decision).toEqual({
      outcome: "authorized",
      capabilityId: capability.capabilityId,
      denialReason: null,
    });
  });

  it("denies a consumed capability with review_operation_not_permitted", () => {
    const registry = new ReviewGateCapabilityRegistry();
    const capability = registry.issueMutation(capabilityInput);
    registry.consumeMutation(capability.capabilityId, authorizedUse);

    const second = registry.consumeMutation(capability.capabilityId, authorizedUse);
    expect(second.outcome).toBe("denied");
    expect(second.denialReason).toBe("review_operation_not_permitted");
  });

  it("denies an unknown capability id with review_operation_not_permitted", () => {
    const registry = new ReviewGateCapabilityRegistry();
    const decision = registry.consumeMutation("missing", authorizedUse);
    expect(decision.outcome).toBe("denied");
    expect(decision.denialReason).toBe("review_operation_not_permitted");
  });

  it.each(["bash", "task"])(
    "denies implementation-capable tool %s with implementation_not_authorized",
    (toolName) => {
      const registry = new ReviewGateCapabilityRegistry();
      const capability = registry.issueMutation(capabilityInput);
      const decision = registry.consumeMutation(capability.capabilityId, {
        ...authorizedUse,
        toolName,
      });
      expect(decision.denialReason).toBe("implementation_not_authorized");
    },
  );

  it.each(["read", "review_restore", "review_commit", "web_search"])(
    "denies non-mutation model tool %s with review_operation_not_permitted",
    (toolName) => {
      const registry = new ReviewGateCapabilityRegistry();
      const capability = registry.issueMutation(capabilityInput);
      const decision = registry.consumeMutation(capability.capabilityId, {
        ...authorizedUse,
        toolName,
      });
      expect(decision.denialReason).toBe("review_operation_not_permitted");
    },
  );

  it("denies a mutation through a different target path with review_scope_violation", () => {
    const registry = new ReviewGateCapabilityRegistry();
    const capability = registry.issueMutation(capabilityInput);
    const decision = registry.consumeMutation(capability.capabilityId, {
      ...authorizedUse,
      targetCanonicalPath: "docs/plans/plan.md",
    });
    expect(decision.outcome).toBe("denied");
    expect(decision.denialReason).toBe("review_scope_violation");
  });

  it("denies a mutation bound to another gate or operation context", () => {
    const registry = new ReviewGateCapabilityRegistry();
    const capability = registry.issueMutation(capabilityInput);

    const wrongGate = registry.consumeMutation(capability.capabilityId, {
      ...authorizedUse,
      gateId: "gate-2",
    });
    expect(wrongGate.denialReason).toBe("review_scope_violation");

    const wrongOperation = registry.consumeMutation(capability.capabilityId, {
      ...authorizedUse,
      operationId: "op-9",
    });
    expect(wrongOperation.denialReason).toBe("review_scope_violation");
  });

  it("denies a mutation tied to another phase or round context", () => {
    const registry = new ReviewGateCapabilityRegistry();
    const capability = registry.issueMutation(capabilityInput);

    const wrongPhase = registry.consumeMutation(capability.capabilityId, {
      ...authorizedUse,
      phase: "plan",
    });
    expect(wrongPhase.denialReason).toBe("review_scope_violation");

    const wrongRound = registry.consumeMutation(capability.capabilityId, {
      ...authorizedUse,
      remediationRound: 3,
    });
    expect(wrongRound.denialReason).toBe("review_scope_violation");
  });

  it("classifies model tools into CAP1 authority classes", () => {
    expect(classifyReviewModelTool("edit")).toBe("review_mutation");
    expect(classifyReviewModelTool("apply_patch")).toBe("review_mutation");
    expect(classifyReviewModelTool("read")).toBe("review_query");
    expect(classifyReviewModelTool("task")).toBe("implementation");
    expect(classifyReviewModelTool("bash")).toBe("implementation");
    expect(classifyReviewModelTool("review_restore")).toBe("review_operation_not_permitted");
    expect(classifyReviewModelTool("web_search")).toBe("review_operation_not_permitted");
  });
});

describe("classifyReviewTargetClean (GIT1 content + Git mode identity)", () => {
  it("classifies a consistent clean binding", () => {
    expect(classifyReviewTargetClean(cleanBinding())).toBe("clean");
  });

  it("requires HEAD to exist", () => {
    expect(
      classifyReviewTargetClean(cleanBinding({ headSha: null })),
    ).toBe("not_clean");
  });

  it("requires a regular-file HEAD tree entry", () => {
    expect(classifyReviewTargetClean(cleanBinding({ headEntry: null }))).toBe("not_clean");
  });

  it("requires an unmerged-free unique stage-0 index entry", () => {
    expect(classifyReviewTargetClean(cleanBinding({ indexConflicted: true }))).toBe("not_clean");
    expect(classifyReviewTargetClean(cleanBinding({ indexEntry: null }))).toBe("not_clean");
  });

  it("requires HEAD/index blob equality", () => {
    const binding = cleanBinding({
      indexEntry: indexEntry("b222"),
    });
    expect(classifyReviewTargetClean(binding)).toBe("not_clean");
  });

  it("requires HEAD/index Git mode equality (mode-only index drift)", () => {
    const binding = cleanBinding({
      indexEntry: indexEntry("b111", "100755"),
    });
    expect(classifyReviewTargetClean(binding)).toBe("not_clean");
  });

  it("requires worktree Git mode to match HEAD (mode-only worktree drift)", () => {
    const binding = cleanBinding({
      worktree: worktree("b111".repeat(16), "100755"),
    });
    expect(classifyReviewTargetClean(binding)).toBe("not_clean");
  });

  it("requires worktree content bytes to equal the HEAD blob content", () => {
    const binding = cleanBinding({
      headBlobDigest: "dead".repeat(16),
    });
    expect(classifyReviewTargetClean(binding)).toBe("not_clean");
  });

  it("requires the worktree binding to exist (untracked target)", () => {
    expect(classifyReviewTargetClean(cleanBinding({ worktree: null }))).toBe("not_clean");
  });
});

describe("worktree POSIX mode → Git mode normalization (owner execute bit)", () => {
  it.each<[number, "100644" | "100755"]>([
    [0o644, "100644"],
    [0o744, "100755"],
    [0o755, "100755"],
    [0o655, "100644"],
    [0o645, "100644"],
  ])("normalizes POSIX mode %o to Git %j", (posixMode, expected) => {
    expect(gitModeFromOwnerExecBits(posixMode)).toBe(expected);
  });

  it("never lets group/other execute bits produce 100755", () => {
    expect(gitModeFromOwnerExecBits(0o051)).toBe("100644");
    expect(gitModeFromOwnerExecBits(0o045)).toBe("100644");
  });
});
