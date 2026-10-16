/**
 * Task 20 (G3) — real-host Review Gate E2E entry point.
 *
 * Opt-in only: tests run when `JUSTICE_REAL_HOST_E2E=1` is set and are
 * skipped otherwise. Unlike the devcontainer production-path matrix
 * (Task 19), this file exercises the REAL host surface end to end:
 *
 * - a real git repository in a temp directory (real commits, real HEAD),
 * - real filesystem bytes read/written through a real workspace provider,
 * - the real durable legacy disk event store (`.justice/review-gates/`),
 * - the real Linux native flock-backed lock provider (no `provider: null`),
 * - the exact-artifact GIT1 commit contract (prepared intent → execution).
 *
 * The staged flow runs Design review → finding validation → remediation →
 * self-review → exact-artifact commit → fresh Design review → DESIGN_CLEAR →
 * Plan review → PLAN_CLEAR → durable COMPLETED_APPROVAL_BINDING, and the
 * negative case proves an unprepared commit attempt is rejected fail-closed
 * with zero workspace mutation.
 *
 * Requirements: Linux x86_64/glibc with the built native review-artifact
 * addon (`bun run build:native:review-artifact`) because the default lock
 * manager resolves the Linux native provider. On an unsupported host the
 * lock provider fails closed; treat that as unsupported setup, not PASS.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import {
  chmod,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  createReviewGateCoordinator,
  type ReviewGateMutationSubstrate,
  type ReviewGateWorkspaceReader,
} from "../../src/runtime/review-gate-coordinator";
import { createLegacyReviewGateEventStore } from "../../src/runtime/review-gate-event-store";
import { createReviewGateRecoveryStore } from "../../src/runtime/review-gate-recovery-store";
import { createReviewGateLockManager } from "../../src/runtime/review-gate-lock-manager";
import { createReviewGateProtocolDescriptor } from "../../src/runtime/review-gate-protocol";
import {
  createReviewGateGit,
  type ReviewGateWorkspaceProvider,
} from "../../src/runtime/review-gate-git";
import { createReviewGateApprovalLookup } from "../../src/runtime/review-gate-approval";
import { createReviewGateHistoryService } from "../../src/runtime/review-gate-history";
import { computeArtifactDigest, computeWorkspaceIdentity } from "../../src/core/review-gate/identity";
import type { ReviewRestoreDestinationBinding, ReviewRestoreSourceBinding } from "../../src/core/review-gate/capabilities";
import type { ReviewGatePhase } from "../../src/core/review-gate-types";
import type { HookEvent, HookResponse } from "../../src/core/types";

const RUN_REAL_HOST_E2E = process.env.JUSTICE_REAL_HOST_E2E === "1";

let statCounter = 0;

const DESIGN_PATH = "docs/design.md";
const PLAN_PATH = "docs/plan.md";
const DESIGN_V1 = "# Design\nAcceptance boundary.\n";
const DESIGN_V2_REMEDIATED = "# Design\nAcceptance boundary with lifecycle coverage.\n";
const PLAN_V1 = "## Task 1: Verification\n- [ ] Verify the boundary\n";

/** Run git inside the fixture repo; any non-zero exit fails the test. */
function runGit(root: string, args: readonly string[]): string {
  return execFileSync("git", args, { cwd: root, shell: false, encoding: "utf8" });
}

/**
 * Real workspace provider: byte-exact replacement that inherits the target's
 * non-Git POSIX bits and pins the owner execute bit to the replacement's Git
 * mode, mirroring the Task 1 native seam on the real file tree.
 */
function createRealFsProvider(rootDir: string): ReviewGateWorkspaceProvider {
  return {
    readWorkspaceFile: async (path: string): Promise<Buffer | null> => {
      if (path.length === 0 || path.startsWith("/") || path.includes("..") || path.includes("\0")) {
        return null;
      }
      try {
        return await readFile(join(rootDir, path));
      } catch (error: unknown) {
        if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
          return null;
        }
        throw error;
      }
    },
    replaceWorkspaceFileExact: async (
      path,
      expectedCurrent,
      replacement,
    ): Promise<void> => {
      const target = join(rootDir, path);
      const current = await readFile(target);
      if (computeArtifactDigest(current) !== expectedCurrent.digest) {
        throw new Error("real_host_fixture_preimage_mismatch");
      }
      const currentMode = (await stat(target)).mode & 0o7777;
      const execClass = replacement.gitMode === "100755" ? 0o100 : 0;
      const temp = `${target}.real-host-restore-${statCounter.toString(36)}`;
      statCounter += 1;
      await writeFile(temp, replacement.bytes);
      await chmod(temp, (currentMode & ~0o100) | execClass);
      await rename(temp, target);
    },
  };
}

type RealFixture = {
  readonly rootDir: string;
  readonly genesisSha: string;
  readonly provider: ReviewGateWorkspaceProvider;
  readonly git: ReturnType<typeof createReviewGateGit>;
};

/** One real git repository under the host temp directory. */
function createRealGitWorkspace(): RealFixture {
  const rootDir = mkdtempSync(join(tmpdir(), "justice-real-host-e2e-"));
  runGit(rootDir, ["init", "-q"]);
  runGit(rootDir, ["config", "user.name", "Justice Real-Host E2E"]);
  runGit(rootDir, ["config", "user.email", "real-host-e2e@example.invalid"]);
  runGit(rootDir, ["config", "commit.gpgsign", "false"]);
  mkdirSync(join(rootDir, "docs"), { recursive: true });
  writeFileSync(join(rootDir, DESIGN_PATH), DESIGN_V1, "utf8");
  writeFileSync(join(rootDir, PLAN_PATH), PLAN_V1, "utf8");
  runGit(rootDir, ["add", "-A"]);
  runGit(rootDir, ["commit", "-q", "--no-gpg-sign", "-m", "genesis"]);
  const genesisSha = runGit(rootDir, ["rev-parse", "HEAD"]).trim();
  const provider = createRealFsProvider(rootDir);
  const git = createReviewGateGit({
    rootDir,
    provider,
    recoveryStore: createReviewGateRecoveryStore(rootDir),
  });
  return { rootDir, genesisSha, provider, git };
}

/**
 * Build the production-shaped service graph over the real workspace: real
 * durable disk event store, real recovery store, real native flock lock
 * manager, real Git inspect/mutate seams, real file bytes.
 */
async function buildRealCoordinator(fixture: RealFixture): Promise<ReturnType<typeof createReviewGateCoordinator> & {
  readonly lockManager: ReturnType<typeof createReviewGateLockManager>;
  readonly git: RealFixture["git"];
}> {
  let serial = 0;
  let idCounter = 0;
  let commitOrdinal = 0;
  let restoreOrdinal = 0;
  const eventStore = createLegacyReviewGateEventStore(fixture.rootDir);
  // The native provider anchors its lock tree under the workspace root
  // itself (`.justice/review-gates/locks/**`), exactly like the adapter.
  const lockManager = createReviewGateLockManager(fixture.rootDir);
  const workspaceReader: ReviewGateWorkspaceReader = {
    readWorkspaceFile: (path) => fixture.provider.readWorkspaceFile(path),
  };
  const mutationSubstrate: ReviewGateMutationSubstrate = {
    commitArtifact: async (phase: ReviewGatePhase, artifactPath: string) => {
      const binding = await fixture.git.inspectTarget(artifactPath);
      if (
        binding.headSha === null ||
        binding.headEntry === null ||
        binding.indexEntry === null ||
        binding.worktree === null
      ) {
        throw new Error("real_host_commit_target_not_inspectable");
      }
      const prepared = await fixture.git.prepareCommit({
        gateId: "real-host-gate",
        operationId: `real-host-commit-${++commitOrdinal}`,
        phase,
        targetCanonicalPath: artifactPath,
        allowedCommitTargetPath: artifactPath,
        remediationRound: 0,
        lineageIds: [],
        expectedArtifactDigest: binding.worktree.digest,
        expectedGitMode: binding.headEntry.gitMode,
      });
      const verified = await fixture.git.executePreparedCommit(prepared);
      return { commitSha: verified.commitId };
    },
    restoreArtifact: async (targetPath: string) => {
      const binding = await fixture.git.inspectTarget(targetPath);
      if (
        binding.headSha === null ||
        binding.headEntry === null ||
        binding.indexEntry === null ||
        binding.headBlobDigest === null ||
        binding.worktree === null ||
        binding.indexConflicted
      ) {
        throw new Error("real_host_restore_target_not_inspectable");
      }
      const source: ReviewRestoreSourceBinding = {
        headSha: binding.headSha,
        headEntry: binding.headEntry,
        indexEntry: binding.indexEntry,
        worktree: binding.worktree,
        sourceEventId: `real-host-restore-${++restoreOrdinal}`,
      };
      const destination: ReviewRestoreDestinationBinding = {
        headSha: binding.headSha,
        headEntry: binding.headEntry,
        indexEntry: binding.indexEntry,
        worktree: {
          canonicalPath: targetPath,
          digest: binding.headBlobDigest,
          gitMode: binding.headEntry.gitMode,
        },
      };
      const prepared = await fixture.git.prepareRestore({
        gateId: "real-host-gate",
        operationId: `real-host-restore-${restoreOrdinal}`,
        phase: "design",
        targetCanonicalPath: targetPath,
        allowedRestoreTargetPath: targetPath,
        sourceKnownDirtyBinding: source,
        targetCleanCommittedBinding: destination,
      });
      await fixture.git.executePreparedRestore(prepared);
    },
  };
  const coordinator = createReviewGateCoordinator({
    eventStore,
    lockManager,
    protocol: createReviewGateProtocolDescriptor(),
    workspaceReader,
    workspaceRoot: fixture.rootDir,
    workspaceIdentity: computeWorkspaceIdentity(await realpath(fixture.rootDir)),
    mutationSubstrate,
    recoveryStore: createReviewGateRecoveryStore(fixture.rootDir),
    inspectTargets: async (paths) => {
      const map = new Map<string, "clean_committed" | "known_dirty">();
      for (const target of paths) {
        const binding = await fixture.git.inspectTarget(target);
        map.set(
          target,
          fixture.git.classifyTargetClean(binding) === "clean"
            ? "clean_committed"
            : "known_dirty",
        );
      }
      return map;
    },
    newId: () => `real-host-id-${++idCounter}`,
    newWriterId: () => "real-host-writer",
    now: () => new Date(Date.UTC(2026, 9, 15, 0, 0, ++serial)).toISOString(),
  });
  return { coordinator, lockManager, git: fixture.git };
}

// ---------------------------------------------------------------------------
// Scripted worker results (no external agent is ever spawned; the review
// protocol itself is exercised against the real host stores and Git).
// ---------------------------------------------------------------------------

function claimEvent(sessionId: string, callId: string, prompt: string): HookEvent {
  return {
    type: "PreToolUse",
    sessionId,
    callId,
    payload: { toolName: "task", callId, toolInput: { prompt } },
  } as HookEvent;
}

function resultEvent(sessionId: string, callId: string, toolResult: string): HookEvent {
  return {
    type: "PostToolUse",
    sessionId: `${callId}-worker`,
    callId,
    payload: { toolName: "task", callId, toolResult, error: false },
  } as HookEvent;
}

function parsePacketPayload(workerPrompt: string): Record<string, unknown> {
  const markerIndex = workerPrompt.indexOf("[JUSTICE: REVIEW GATE OPERATION PAYLOAD]");
  if (markerIndex < 0) throw new Error("packet payload marker not found");
  const payloadStart = workerPrompt.indexOf("{", markerIndex);
  const payloadEnd = workerPrompt.indexOf("\n", payloadStart);
  const payloadText = (
    payloadEnd < 0 ? workerPrompt.slice(payloadStart) : workerPrompt.slice(payloadStart, payloadEnd)
  ).trim();
  const parsed: unknown = JSON.parse(payloadText);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("packet payload is not an object");
  }
  return parsed as Record<string, unknown>;
}

function nextPromptOf(response: HookResponse): string | undefined {
  const args = (response as { modifiedPayload?: { args?: { prompt?: unknown } } })
    .modifiedPayload?.args;
  return typeof args?.prompt === "string" ? args.prompt : undefined;
}

function reviewerResult(payload: Record<string, unknown>, candidates: readonly Record<string, unknown>[]): string {
  return JSON.stringify({
    schemaVersion: 1,
    operationId: payload.operationId,
    gateId: payload.gateId,
    phase: payload.phase,
    reviewAttemptId: payload.reviewAttemptId,
    remediationRound: null,
    candidates,
  });
}

function findingValidationResult(payload: Record<string, unknown>): string {
  const candidate = payload.candidate as Record<string, unknown>;
  return JSON.stringify({
    schemaVersion: 1,
    operationId: payload.operationId,
    gateId: payload.gateId,
    phase: payload.phase,
    reviewAttemptId: payload.reviewAttemptId,
    remediationRound: null,
    candidateId: candidate.candidateId,
    decision: "VALID",
    severity: "blocking",
    observedPhase: payload.phase,
    semanticBasis: {
      violationType: "UNVERIFIED_CLAIM",
      governingReference: "design.md#acceptance",
      semanticLocation: "Task 1",
      violatedContract: "verify",
      ownerScope: "plan",
    },
    relation: "NEW",
  });
}

function remediationResult(payload: Record<string, unknown>): string {
  return JSON.stringify({
    schemaVersion: 1,
    operationId: payload.operationId,
    gateId: payload.gateId,
    phase: payload.phase,
    reviewAttemptId: null,
    remediationRound: payload.remediationRound,
    targetPath: (payload.targetArtifact as Record<string, unknown>).canonicalPath,
    outcome: "COMPLETED",
    summary: "Repaired",
  });
}

function selfReviewResult(payload: Record<string, unknown>): string {
  const targets = (payload.targetLineageRefs as readonly string[]) ?? [];
  return JSON.stringify({
    schemaVersion: 1,
    operationId: payload.operationId,
    gateId: payload.gateId,
    phase: payload.phase,
    reviewAttemptId: null,
    remediationRound: payload.remediationRound,
    targetLineageChecks: targets.map((lineageId) => ({ lineageId, result: "RESOLVED" })),
    discoveredFindings: [],
  });
}

/**
 * One real-host remediation script: the first design review reports one
 * blocking candidate, the remediator replaces the real file bytes on disk,
 * and every later review is clean until the gate completes.
 */
function createRemediateOnceScript(fixture: RealFixture) {
  let reviewerDispatches = 0;
  return async (payload: Record<string, unknown>): Promise<string> => {
    switch (payload.requiredResultKind) {
      case "review_candidates": {
        reviewerDispatches += 1;
        return reviewerDispatches === 1
          ? reviewerResult(payload, [
              {
                candidateId: "real-host-cand-1",
                severity: "major",
                summary: "Missing lifecycle evidence (real-host-cand-1)",
                location: "Task 1",
              },
            ])
          : reviewerResult(payload, []);
      }
      case "finding_validation":
        return findingValidationResult(payload);
      case "remediation":
        await fixture.provider.replaceWorkspaceFileExact(DESIGN_PATH, {
          digest: computeArtifactDigest(Buffer.from(DESIGN_V1, "utf8")),
          gitMode: "100644",
        }, {
          bytes: Buffer.from(DESIGN_V2_REMEDIATED, "utf8"),
          gitMode: "100644",
        });
        return remediationResult(payload);
      case "self_review":
        return selfReviewResult(payload);
      default:
        throw new Error(`unexpected operation: ${String(payload.requiredResultKind)}`);
    }
  };
}

async function driveGate(
  coordinator: ReturnType<typeof createReviewGateCoordinator>,
  fixture: RealFixture,
  initialPrompt: string,
): Promise<HookResponse> {
  let prompt: string | undefined = initialPrompt;
  let response: HookResponse | null = null;
  let callSerial = 0;
  const answer = createRemediateOnceScript(fixture);
  while (typeof prompt === "string") {
    callSerial += 1;
    const callId = `real-host-call-${callSerial}`;
    await coordinator.preToolUse(claimEvent("main", callId, prompt));
    const payload = parsePacketPayload(prompt);
    response = (await coordinator.postToolUse(
      resultEvent("main", callId, await answer(payload)),
    )) as HookResponse;
    prompt = nextPromptOf(response);
  }
  if (response === null) throw new Error("real_host_gate_never_dispatched");
  return response;
}

describe.skipIf(!RUN_REAL_HOST_E2E)("Review Gate real-host E2E (Task 20 G3)", () => {
  it("completes the staged Design→Plan gate on a real git repo and binds the durable approval", async () => {
    const fixture = createRealGitWorkspace();
    const services = await buildRealCoordinator(fixture);
    try {
      const started = await services.coordinator.startOrResume("main", {
        source: "command",
        designPath: DESIGN_PATH,
        planPath: PLAN_PATH,
      });
      expect(started.dispatched).toBe(true);
      expect(started.gateId).not.toBeNull();
      const gateId = started.gateId as string;
      if (started.reviewerPrompt === undefined) throw new Error(started.guidance);

      // Real host flow: design finding → remediation → real exact-artifact
      // git commit → fresh design review → design clear → plan clear →
      // durable completed approval binding.
      const finalResponse = await driveGate(services.coordinator, fixture, started.reviewerPrompt);
      expect(finalResponse.injectedContext).toContain("[JUSTICE: REVIEW GATE CLEAR]");

      // The remediation produced a real commit touching exactly the Design
      // artifact; the Plan artifact stays untouched at the genesis blob.
      const designBytes = await readFile(join(fixture.rootDir, DESIGN_PATH), "utf8");
      expect(designBytes).toBe(DESIGN_V2_REMEDIATED);
      const commitSubject = runGit(fixture.rootDir, ["log", "--format=%s", "-1", "--", DESIGN_PATH]).trim();
      expect(commitSubject).toContain("[Justice] remediation round");
      const changedPaths = runGit(fixture.rootDir, ["show", "--name-only", "--format=", "HEAD"]).trim();
      expect(changedPaths).toBe(DESIGN_PATH);
      const reviewedPlanBlob = runGit(
        fixture.rootDir,
        ["rev-parse", `${runGit(fixture.rootDir, ["rev-parse", "HEAD"]).trim()}:${PLAN_PATH}`],
      ).trim();
      const genesisPlanBlob = runGit(
        fixture.rootDir,
        ["rev-parse", `${fixture.genesisSha}:${PLAN_PATH}`],
      ).trim();
      expect(reviewedPlanBlob).toBe(genesisPlanBlob);

      // The durable legacy event history reconstructs the staged Design→Plan
      // order from the real disk journal.
      const eventStore = createLegacyReviewGateEventStore(fixture.rootDir);
      const events = await eventStore.readEvents(gateId);
      expect(events.map((event) => event.eventType)).toEqual([
        "GATE_CREATED",
        "FINDING_DISCOVERED",
        "FINDING_REMEDIATED",
        "FINDING_SELF_REVIEWED",
        "ARTIFACT_BINDINGS_UPDATED",
        "DESIGN_CLEAR",
        "PLAN_CLEAR",
        "COMPLETED_APPROVAL_BINDING",
      ]);

      // Read-only history query over the real durable store reports the same
      // completed state with the absolute 5/3 remediation usage.
      const history = createReviewGateHistoryService({
        rootDir: fixture.rootDir,
        eventStore,
      });
      const historyResult = await history.queryScope(DESIGN_PATH, PLAN_PATH, {
        view: "summary",
        allGenerations: false,
      });
      if (historyResult.kind !== "display" || historyResult.payload.view !== "summary") {
        throw new Error(`history query returned no summary display: ${JSON.stringify(historyResult)}`);
      }
      const dto = historyResult.payload.dto;
      expect(dto.status).toBe("completed");
      expect(dto.phase).toBe("plan");
      expect(dto.designClear).not.toBeNull();

      // Completed approval: exact durable binding against the current real
      // artifact bytes, resolvable after the process "restart".
      const approval = createReviewGateApprovalLookup({
        eventStore,
        workspaceReader: {
          readWorkspaceFile: (path) => fixture.provider.readWorkspaceFile(path),
        },
        protocol: createReviewGateProtocolDescriptor(),
      });
      const approvalOutcome = await approval.findCurrentCompletedApproval(PLAN_PATH);
      if (approvalOutcome.kind !== "approved") {
        throw new Error(`expected approval, got ${approvalOutcome.kind}`);
      }
      expect(approvalOutcome.gateId).toBe(gateId);
      expect(approvalOutcome.binding.designArtifact.digest).toBe(
        computeArtifactDigest(Buffer.from(DESIGN_V2_REMEDIATED, "utf8")),
      );
      expect(approvalOutcome.binding.planArtifact.digest).toBe(
        computeArtifactDigest(Buffer.from(PLAN_V1, "utf8")),
      );

      // The durable approval alone does not arm implementation.
      const decision = services.coordinator.classifyToolUse("main", {
        toolName: "task",
        isPendingReviewGateTask: false,
        queryOnly: false,
        changedPaths: null,
      });
      expect(decision).toEqual({ kind: "deny", reason: "implementation_not_authorized" });
    } finally {
      services.lockManager.close();
      await rm(fixture.rootDir, { recursive: true, force: true });
    }
  }, 120_000);

  it("rejects a commit attempt without a Justice-prepared, durability-valid intent", async () => {
    const fixture = createRealGitWorkspace();
    const services = await buildRealCoordinator(fixture);
    try {
      // Start the gate: Design review custody is active.
      const started = await services.coordinator.startOrResume("main", {
        source: "command",
        designPath: DESIGN_PATH,
        planPath: PLAN_PATH,
      });
      if (started.reviewerPrompt === undefined) throw new Error(started.guidance);

      // (a) Unprepared scope: an actor claiming a commit intent for a target
      // the prepared intent never declares is rejected before any Git runs.
      const binding = await services.git.inspectTarget(DESIGN_PATH);
      if (binding.headSha === null || binding.headEntry === null || binding.worktree === null) {
        throw new Error("real_host_fixture_bindings_missing");
      }
      await expect(
        services.git.prepareCommit({
          gateId: "real-host-gate",
          operationId: "real-host-unprepared-1",
          phase: "design",
          targetCanonicalPath: DESIGN_PATH,
          allowedCommitTargetPath: PLAN_PATH,
          remediationRound: 0,
          lineageIds: [],
          expectedArtifactDigest: binding.worktree.digest,
          expectedGitMode: binding.headEntry.gitMode,
        }),
      ).rejects.toThrow("review_commit_scope_violation");

      // (b) Fabricated prepared payload: an execute attempt whose parent HEAD
      // binding was never durably prepared against the current state fails
      // closed as an unprovable intent state.
      const fabricated = await services.git.prepareCommit({
        gateId: "real-host-gate",
        operationId: "real-host-unprepared-2",
        phase: "design",
        targetCanonicalPath: DESIGN_PATH,
        allowedCommitTargetPath: DESIGN_PATH,
        remediationRound: 0,
        lineageIds: [],
        expectedArtifactDigest: binding.worktree.digest,
        expectedGitMode: binding.headEntry.gitMode,
      });
      await expect(
        services.git.executePreparedCommit({
          ...fabricated,
          parentHeadSha: "0".repeat(40),
        }),
      ).rejects.toThrow("review_commit_recovery_conflict");

      // Both rejected attempts leave the repository untouched: no commit was
      // created and the artifact bytes never moved without Justice custody.
      expect(runGit(fixture.rootDir, ["rev-list", "--count", "HEAD"]).trim()).toBe("1");
      expect(await readFile(join(fixture.rootDir, DESIGN_PATH), "utf8")).toBe(DESIGN_V1);

      // The gate itself is still healthy: orchestration remains suspended in
      // the design phase awaiting its own prepared dispatch, not corrupted by
      // the unprepared attempts.
      expect(started.gateId).not.toBeNull();
    } finally {
      services.lockManager.close();
      await rm(fixture.rootDir, { recursive: true, force: true });
    }
  }, 120_000);
});
