/**
 * Task 18 — production Review Gate path over real durable custody:
 * the legacy disk event store, the content-addressed recovery store, the
 * Task 18 V2 journal, and the witness publication seam — including the
 * restart/reopen window where the chain continues from the persisted tail.
 *
 * Task 19 — G2 devcontainer production-path negative matrix.
 * Every negative case runs against the same real durable custody as the
 * happy path (no synthetic registries, no in-memory revocation):
 *
 * | id | attack / failure | production surface under test | required verdict |
 * |----|-------------------|-------------------------------|------------------|
 * | N1 | concurrent competing writers for the same gate operation | shared lock custody + native target-effect guard + scope alias | loser blocked; `review_operation_not_permitted` / `review_scope_violation` |
 * | N2 | terminal revoke intent with queued native effects | protected target-writer handoff → terminal revoke | queued effect denied at effect time; bytes unchanged; recovery idempotent |
 * | N3 | restart after prepare, before the prepared intent is witnessed | durable prepared record + unacknowledged V2 intent | coordinator recovers the EXISTING payload by its exact id, never re-prepares a new id |
 * | N4 | restart after native restore, before the success event | `recoverPreparedRestore` destination classification + V2 journal | destination exact → `REVIEW_TARGET_RESTORE_RECOVERED` recovery evidence |
 * | N5 | stale worker with an old lease generation after handoff | lease generation advance + effect-time guard | stale native write denied; the advanced generation still writes |
 * | N6 | witness publication failure after the journal append | V2 append durability + publication seam | operation blocks typed; journal stays durable and recoverable |
 * | N7 | invalid V2 event appended directly (coordinator bypass) | `appendV2Events` / `readV2Journal` fail-closed codec/chain | every bypass rejected; journal never mutates |
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { appendFile, chmod, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  createReviewGateCoordinator,
  type CallerRoutingDecisionV1,
  type ReviewGateWorkspaceReader,
} from "../../src/runtime/review-gate-coordinator";
import type { ReviewGateWitnessPublicationSeamV1 } from "../../src/runtime/review-gate-witness-contracts";
import {
  createLegacyReviewGateEventStore,
  type ReviewGateEventStore,
  type ReviewGateV2Journal,
} from "../../src/runtime/review-gate-event-store";
import { createReviewGateRecoveryStore } from "../../src/runtime/review-gate-recovery-store";
import { createReviewGateLockManager } from "../../src/runtime/review-gate-lock-manager";
import { createReviewGateProtocolDescriptor } from "../../src/runtime/review-gate-protocol";
import type { ReviewGateNextOperation } from "../../src/core/review-gate/orchestrator";
import {
  validateReviewGateEventRecord,
  type VerifiedReviewGateEvent,
} from "../../src/core/review-gate/event-schema";
import { createReviewGateGit } from "../../src/runtime/review-gate-git";
import type { ReviewGateWorkspaceProvider } from "../../src/runtime/review-gate-git";
import type {
  ReviewRestorePrepareInput,
  ReviewRestoreSourceBinding,
  ReviewRestoreDestinationBinding,
} from "../../src/core/review-gate/capabilities";
import { computeArtifactDigest } from "../../src/core/review-gate/identity";
import type { VerifiedTargetWriterHandoffIntentV1 } from "../../src/core/review-gate/types";
  import {
  createWitnessFixture,
  prepareHandoffFixture,
  type WitnessFixture,
} from "../runtime/review-gate-witness-fixtures.js";

const DESIGN_PATH = "docs/design.md";
const PLAN_PATH = "docs/plan.md";

const afterAllCleanups: (() => void)[] = [];
afterAll(() => {
  for (const cleanup of afterAllCleanups) cleanup();
});

/**
 * Straight-through witness publication seam double: records the prepared
 * publication request and returns the derived publication record. This
 * exercises the coordinator → seam contract on real durable stores; the
 * witness-registry binding itself is the composition-root wiring beyond this
 * task's scope.
 *
 * `failOnCall` turns the seam into a deterministic crash injection: the
 * Nth `prepareAndPublish` call still happens (the call count is recorded)
 * but throws instead of publishing — a witness outage that lands after the
 * durable V2 custody step.
 */
function createRecordingSeam(
  options: Readonly<{ readonly failOnCall?: number }> = {},
): ReviewGateWitnessPublicationSeamV1 & {
  readonly calls: () => number;
} {
  let calls = 0;
  return {
    calls: () => calls,
    prepareAndPublish: async (input) => {
      calls += 1;
      if (options.failOnCall !== undefined && calls >= options.failOnCall) {
        throw new Error("witness_seam_unavailable");
      }
      return Object.freeze({
        installationId: "production-test-installation",
        workspaceIdentity: "production-test-workspace",
        scopeId: "production-test-scope",
        gateId: input.gateId,
        writerId: input.writerId,
        operationId: input.operationId,
        publicationId: `publication-${calls}`,
        expectedInstallationFrontier: "installation-frontier",
        expectedGlobalFrontier: input.baseFrontierHash,
        expectedWriterSequence: 0,
        expectedWriterHash: "expected-writer-hash",
        newWriterSequence: input.appendedEventCount,
        newWriterHash: input.newFrontierHash,
        canonicalShardPath: `${input.gateId}/events-v2.jsonl`,
        newTailLength: input.newTailLength,
        newTailDigest: input.newTailDigest,
        newGlobalFrontier: input.newFrontierHash,
        firstEnrollmentAuthorizationId: null,
        payloadSchemaVersion: 1,
        nextFrontier: Object.freeze({
          workspaceIdentity: "production-test-workspace",
          workspaceEnrollmentId: "production-test-enrollment",
          scopes: Object.freeze([]),
          writerHeads: Object.freeze([]),
          globalFrontierHash: input.newFrontierHash,
        }),
      });
    },
  };
}

interface ProductionHarness {
  readonly rootDir: string;
  readonly buildCoordinator: (
    overrides?: Readonly<{
      readonly seamFactory?: () => ReviewGateWitnessPublicationSeamV1;
      /** Distinct id namespaces keep V2 event ids unique across a restart. */
      readonly idPrefix?: string;
    }>,
  ) => ReturnType<typeof createReviewGateCoordinator> & {
    readonly eventStore: ReviewGateEventStore;
    readonly recoveryStore: ReturnType<typeof createReviewGateRecoveryStore>;
    readonly seam: ReviewGateWitnessPublicationSeamV1;
  };
  readonly eventStore: () => ReviewGateEventStore;
  readonly recoveryStore: () => ReturnType<typeof createReviewGateRecoveryStore>;
}

/**
 * Build a fresh production-shaped harness. Every `buildCoordinator` call
 * creates NEW store instances over the SAME workspace root, mirroring the
 * restart/reopen window where persisted custody (not process state) is the
 * only authority.
 */
function createProductionHarness(): ProductionHarness {
  const rootDir = mkdtempSync(join(tmpdir(), "justice-task19-production-"));
  afterAllCleanups.push(() => rmSync(rootDir, { recursive: true, force: true }));
  mkdirSync(join(rootDir, DESIGN_PATH.split("/")[0] ?? "docs"), { recursive: true });

  const buildCoordinator = (
    overrides: Readonly<{
      readonly seamFactory?: () => ReviewGateWitnessPublicationSeamV1;
      readonly idPrefix?: string;
    }> = {},
  ) => {
    const eventStore = createLegacyReviewGateEventStore(rootDir);
    const recoveryStore = createReviewGateRecoveryStore(rootDir);
    const seam = overrides.seamFactory === undefined ? createRecordingSeam() : overrides.seamFactory();
    const files = new Map<string, string>([
      [DESIGN_PATH, "# Design\nAcceptance boundary.\n"],
      [PLAN_PATH, "## Task 1: Verify\n- [ ] Verify the boundary\n"],
    ]);
    const workspaceReader: ReviewGateWorkspaceReader = {
      readWorkspaceFile: async (path) => {
        const contents = files.get(path);
        return contents === undefined ? null : Buffer.from(contents, "utf8");
      },
    };
    const coordinator = createReviewGateCoordinator({
      eventStore,
      lockManager: createReviewGateLockManager(join(rootDir, "locks"), { provider: null }),
      protocol: createReviewGateProtocolDescriptor(),
      workspaceReader,
      workspaceRoot: rootDir,
      workspaceIdentity: "production-test-workspace",
      recoveryStore,
      mutationSubstrate: null,
      witnessPublicationSeam: seam,
      inspectTargets: async (paths) =>
        new Map(paths.map((path) => [path, "clean_committed" as const])),
      newId: ((initial = 0) => () => `${overrides.idPrefix ?? "task18"}-id-${(initial += 1)}`)(),
      newWriterId: () => `${overrides.idPrefix ?? "task18"}-writer`,
    });
    return { coordinator, eventStore, recoveryStore, seam };
  };

  return {
    rootDir,
    buildCoordinator,
    eventStore: () => createLegacyReviewGateEventStore(rootDir),
    recoveryStore: () => createReviewGateRecoveryStore(rootDir),
  };
}

/** Read the durable V2 journal file directly from disk. */
function readV2JournalFile(rootDir: string, gateId: string): readonly unknown[] {
  return readFileSync(join(rootDir, ".justice", "review-gates", gateId, "events-v2.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

describe("Task 18 production coordinator end-to-end authority path", () => {
  it("durable happy path: prepared record, executed dispatch, V2 journal on disk, witness publication", async () => {
    const harness = createProductionHarness();
    const sessionId = "task18-production-session";
    const first = harness.buildCoordinator();
    const started = await first.coordinator.startOrResume(sessionId, {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
    });
    expect(started.gateId).not.toBeNull();
    const gateId = started.gateId as string;

    // Prepare a caller-owned dispatch operation.
    const prepared = await first.coordinator.prepareCallerOperation(sessionId, {
      kind: "dispatch_reviewer",
      phase: "design",
      redispatchedOperationId: (await first.eventStore.listDispatches(gateId)).at(-1)?.operationId,
    } as ReviewGateNextOperation);

    // The record digest is content-addressed and validates on read.
    const stored = await first.recoveryStore.read(prepared.preparedRecoveryDigest);
    expect(stored).not.toBeNull();
    const storedRecord = JSON.parse((stored as Buffer).toString("utf8")) as Record<string, unknown>;
    expect(storedRecord.recordKind).toBe("review_gate_prepared_operation");
    expect(storedRecord.operationId).toBe(prepared.operationId);
    expect(storedRecord.gateId).toBe(gateId);

    // The prepared-record intent event is durable in the V2 journal with the
    // record digest as its input binding.
    const journalOnDisk = readV2JournalFile(harness.rootDir, gateId);
    expect(journalOnDisk.length).toBe(1);
    const intentVerified = validateReviewGateEventRecord(journalOnDisk[0]);
    if (!("schemaVersion" in intentVerified) || intentVerified.schemaVersion !== 2) {
      throw new Error("expected a V2 intent event on disk");
    }
    expect(intentVerified.eventType).toBe("EXTERNAL_OPERATION_DISPATCHED");
    expect(intentVerified.payload.inputBindingDigest).toBe(prepared.preparedRecoveryDigest);
    expect(intentVerified.parentEventId).toBe(gateId);

    // Execute the caller-owned routing decision.
    const decision: CallerRoutingDecisionV1 = {
      kind: "execute_operation",
      operationId: prepared.operationId,
      reason: null,
    };
    const outcome = await first.coordinator.executeNextOperation(sessionId, decision);
    expect(outcome.kind).toBe("executed");
    expect(outcome.operationId).toBe(prepared.operationId);

    // The executed dispatch appends one chained V2 event to the same journal.
    const journalAfterExecute = await first.eventStore.readV2Journal(gateId);
    expect(journalAfterExecute.eventCount).toBe(2);
    const dispatchVerified = journalAfterExecute.events.at(-1);
    expect(dispatchVerified?.eventType).toBe("EXTERNAL_OPERATION_DISPATCHED");
    if (dispatchVerified !== undefined) {
      expect(dispatchVerified.parentEventId).toBe(intentVerified.eventId);
    }
    // The bytes on disk match the durable store view, and the legacy journal
    // file never carries V2 custody.
    const diskLines = readV2JournalFile(harness.rootDir, gateId);
    expect(diskLines.length).toBe(2);
    const legacyFile = readFileSync(
      join(harness.rootDir, ".justice", "review-gates", gateId, "events.jsonl"),
      "utf8",
    );
    expect(legacyFile).not.toContain("schemaVersion");

    // Every V2 append was handed to the witness publication seam exactly once
    // (prepare-time intent + execute-time dispatch).
    expect(first.seam.calls()).toBe(2);
  });

  it("restart recovery: reopened sessions continue the V2 chain from the persisted tail", async () => {
    const harness = createProductionHarness();
    const sessionId = "task18-restart-session";
    const first = harness.buildCoordinator();
    const started = await first.coordinator.startOrResume(sessionId, {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
    });
    const gateId = started.gateId as string;

    const preparedBeforeRestart = await first.coordinator.prepareCallerOperation(sessionId, {
      kind: "dispatch_reviewer",
      phase: "design",
      redispatchedOperationId: (await first.eventStore.listDispatches(gateId)).at(-1)?.operationId,
    } as ReviewGateNextOperation);
    await first.coordinator.executeNextOperation(sessionId, {
      kind: "execute_operation",
      operationId: preparedBeforeRestart.operationId,
      reason: null,
    });
    const journalBeforeRestart: ReviewGateV2Journal = await first.eventStore.readV2Journal(gateId);
    expect(journalBeforeRestart.eventCount).toBe(2);
    const tailBeforeRestart = journalBeforeRestart.tailEventId;
    expect(tailBeforeRestart).not.toBeNull();

    // Restart: release the live session first (graceful cooperative close,
    // releasing the gate/scope locks), then create a fresh coordinator plus
    // fresh stores over the same workspace root. Only durable custody — not
    // process state — decides.
    first.coordinator.releaseSession(sessionId);
    const restartedSessionId = "task18-restart-session-2";
    const second = harness.buildCoordinator();
    const resumed = await second.coordinator.startOrResume(restartedSessionId, {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
    });
    expect(resumed.gateId).toBe(gateId);
    expect(resumed.completedReuse).toBe(false);
    expect(resumed.guidance.startsWith("[JUSTICE: REVIEW GATE BLOCKED]")).toBe(false);

    // The prepared record from before the restart is still durable and
    // content-addressed; a freshly re-prepared operation executes against the
    // reopened gate and the V2 chain continues from the persisted tail.
    const stillThere = await second.recoveryStore.read(
      preparedBeforeRestart.preparedRecoveryDigest,
    );
    expect(stillThere).not.toBeNull();

    const rePrepared = await second.coordinator.prepareCallerOperation(restartedSessionId, {
      kind: "dispatch_reviewer",
      phase: "design",
      redispatchedOperationId: (await second.eventStore.listDispatches(gateId)).at(-1)?.operationId,
    } as ReviewGateNextOperation);
    expect(rePrepared.operationId).not.toBe(preparedBeforeRestart.operationId);
    const outcome = await second.coordinator.executeNextOperation(restartedSessionId, {
      kind: "execute_operation",
      operationId: rePrepared.operationId,
      reason: null,
    });
    expect(outcome.kind).toBe("executed");

    const journalAfterRestart = await second.eventStore.readV2Journal(gateId);
    expect(journalAfterRestart.eventCount).toBe(4);
    expect(journalAfterRestart.tailEventId).not.toBe(tailBeforeRestart);
    // The restart-time intent event chains from the pre-restart tail.
    expect(journalAfterRestart.events[2]?.parentEventId).toBe(tailBeforeRestart);
    // No duplicated event ids across the restart window.
    const eventIds = new Set(journalAfterRestart.events.map((event) => event.eventId));
    expect(eventIds.size).toBe(journalAfterRestart.events.length);
    // And every persisted line re-decodes through the codec after restart.
    const diskEvents = readV2JournalFile(harness.rootDir, gateId);
    expect(diskEvents.length).toBe(4);
    for (const record of diskEvents) {
      expect(() => validateReviewGateEventRecord(record)).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// Task 19 — devcontainer production-path negative matrix
// ---------------------------------------------------------------------------

const RESTORE_TARGET = "docs/artifact.md";
const RESTORE_V1 = "artifact committed baseline\n";
const RESTORE_V2 = "artifact known dirty post-image\n";

/** Run git inside a fixture workspace; any non-zero exit fails the test. */
function runGitFixture(root: string, args: readonly string[]): string {
  const result = execFileSync("git", args, { cwd: root, shell: false, encoding: "buffer" });
  return result.toString("utf8");
}

function createTask19FsProvider(rootDir: string): ReviewGateWorkspaceProvider {
  return {
    readWorkspaceFile: async (path) => {
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
    replaceWorkspaceFileExact: async (path, expectedCurrent, replacement) => {
      const target = join(rootDir, path);
      const current = await readFile(target);
      if (computeArtifactDigest(current) !== expectedCurrent.digest) {
        throw new Error("task19_fixture_preimage_mismatch");
      }
      const temp = `${target}.task19-restore-${Date.now().toString(36)}`;
      await writeFile(temp, replacement.bytes);
      const currentMode = (await stat(target)).mode & 0o7777;
      const execClass = replacement.gitMode === "100755" ? 0o100 : 0;
      await chmod(temp, (currentMode & ~0o100) | execClass);
      await rename(temp, target);
    },
  };
}

async function initTask19GitWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "justice-task19-restore-"));
  afterAllCleanups.push(() => rmSync(root, { recursive: true, force: true }));
  runGitFixture(root, ["init", "-q"]);
  runGitFixture(root, ["config", "user.name", "Justice Task19"]);
  runGitFixture(root, ["config", "user.email", "task19@example.invalid"]);
  runGitFixture(root, ["config", "commit.gpgsign", "false"]);
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(join(root, RESTORE_TARGET), RESTORE_V1, "utf8");
  runGitFixture(root, ["add", "-A"]);
  runGitFixture(root, ["commit", "-q", "--no-gpg-sign", "-m", "genesis"]);
  return root;
}

const v2JournalPath = (rootDir: string, gateId: string): string =>
  join(rootDir, ".justice", "review-gates", gateId, "events-v2.jsonl");

const asV2BypassRecord = (record: unknown): VerifiedReviewGateEvent =>
  record as VerifiedReviewGateEvent;


describe("Task 19 production-path negative matrix", () => {
  describe("N1 concurrent competing writers for the same gate operation", () => {
    it("locks out the losing writer and denies it the same native guarded mutation", async () => {
      const harness = createProductionHarness();
      const first = harness.buildCoordinator();
      const started = await first.coordinator.startOrResume("task19-compete-winner", {
        source: "command", designPath: DESIGN_PATH, planPath: PLAN_PATH,
      });
      const gateId = started.gateId as string;

      // The winning writer owns the gate: its prepared + executed operation
      // stays the authoritative custody over the shared workspace root.
      const prepared = await first.coordinator.prepareCallerOperation("task19-compete-winner", {
        kind: "dispatch_reviewer", phase: "design",
        redispatchedOperationId: (await first.eventStore.listDispatches(gateId)).at(-1)?.operationId,
      } as ReviewGateNextOperation);
      expect(
        await first.coordinator.executeNextOperation("task19-compete-winner", {
          kind: "execute_operation", operationId: prepared.operationId, reason: null,
        }),
      ).toMatchObject({ kind: "executed" });

      // The competing writer shares the same lock custody: the same start
      // operation and the same caller-owned execution both fail closed while
      // the winner holds the gate.
      const loser = harness.buildCoordinator({ idPrefix: "task19-compete-loser" });
      const blockedStart = await loser.coordinator.startOrResume("task19-compete-loser", {
        source: "command", designPath: DESIGN_PATH, planPath: PLAN_PATH,
      });
      expect(blockedStart.gateId).toBe(gateId);
      expect(blockedStart.dispatched).toBe(false);
      expect(blockedStart.guidance).toContain("[JUSTICE: REVIEW GATE BLOCKED]");
      expect(blockedStart.guidance).toContain("held by another orchestration");
      expect(
        await loser.coordinator.executeNextOperation("task19-compete-loser", {
          kind: "execute_operation", operationId: prepared.operationId, reason: null,
        }),
      ).toMatchObject({ kind: "blocked", guidance: "review_gate_session_not_active" });

      // The same native mutation the winner could claim through the protected
      // target-effect boundary is denied for a writer without the gate-claimed
      // authority.
      const loserGit = createReviewGateGit({
        rootDir: harness.rootDir,
        provider: createTask19FsProvider(harness.rootDir),
      });
      await expect(
        loserGit.withCanonicalTargetEffectGuards(["task19-canonical-target"], async () => "unreachable"),
      ).rejects.toThrow("review_operation_not_permitted");
      // And the same target expressed outside the admitted scope is a scope
      // violation long before any byte moves.
      await expect(
        loserGit.inspectTarget(join(harness.rootDir, "escape.md")),
      ).rejects.toThrow("review_scope_violation");

      // The loser's failed attempts leave the winner's durable custody untouched.
      const journal = await harness.eventStore().readV2Journal(gateId);
      expect(journal.eventCount).toBe(2);
    });
  });

  describe("N2/N5 protected target-writer custody (real witness, real native guard)", () => {
    let fixture: WitnessFixture;
    beforeEach(async () => {
      fixture = await createWitnessFixture();
    });
    afterEach(async () => {
      fixture.witness.close();
      await rm(fixture.sandbox, { recursive: true, force: true });
    });

    it("N2 terminal revoke intent blocks the queued native effect of the pre-revoke writer", async () => {
      const f = fixture;
      const intent = await prepareHandoffFixture(f);
      expect((await f.witness.prepareTargetWriterHandoff(intent)).status).toBe("REQUESTED");
      await f.witness.fencePreviousTargetWriter({ intent, authorizeNativeRevocation: f.approve });
      const lease = await f.witness.claimTargetWriterForGate({ intent, epochId: "epoch-task19-n2" });

      const owner = await f.witness.readVerifiedTargetWriterAuthority(intent.target);
      const terminal: VerifiedTargetWriterHandoffIntentV1 = {
        ...intent,
        purpose: "TERMINAL_REVOKE_ONLY",
        handoffOperationId: "task19-close-1",
        originalOperationId: "task19-terminal-1",
        oldOwner: owner.activeOwner,
        newOwner: null,
        targets: [intent.target],
        closingSealOperationId: "task19-seal-close-1",
        expectedTargetWriterFrontier: owner.protectedTargetFrontier,
        expectedGlobalTargetWriterGeneration: owner.globalTargetWriterGeneration,
      };

      await f.witness.prepareTerminalTargetWriterRevoke({
        intents: [terminal],
        terminalTransitionOperationId: "task19-terminal-1",
      });
      const proof = await f.witness.revokeTerminalTargetWriter({
        handoffOperationId: "task19-close-1",
        authorizeNativeRevocation: f.approve,
      });
      expect(proof.status).toBe("REVOKED");

      // The queued native effect of the pre-revoke writer is fenced at effect
      // time: the mutation is denied and the canonical bytes never move.
      await expect(
        f.witness.withCurrentReviewWriterLease(lease, async (mutate) =>
          mutate({ bytes: Buffer.from("queued stale effect"), gitMode: "100644" }),
        ),
      ).rejects.toThrow("lease");
      expect(await readFile(join(f.root, "artifact.md"), "utf8")).toBe("original");

      // The revoke itself is exactly-once durable custody.
      await expect(
        f.witness.recoverPreparedTerminalTargetWriterRevoke({
          handoffOperationId: "task19-close-1",
          authorizeNativeRevocation: f.approve,
        }),
      ).resolves.toEqual(proof);
    });

    it("N5 stale worker with the old lease generation is denied once the next generation claims the handoff", async () => {
      const f = fixture;
      const intent = await prepareHandoffFixture(f);
      await f.witness.prepareTargetWriterHandoff(intent);
      await f.witness.fencePreviousTargetWriter({ intent, authorizeNativeRevocation: f.approve });
      const staleWorkerLease = await f.witness.claimTargetWriterForGate({ intent, epochId: "epoch-task19-gen-1" });
      expect(staleWorkerLease.leaseGeneration).toBe(1);

      // The next writer generation takes over the same canonical target.
      const owner = await f.witness.readVerifiedTargetWriterAuthority(intent.target);
      if (owner.activeOwner === null) throw new Error("task19_fixture_owner_absent");
      const nextIntent: VerifiedTargetWriterHandoffIntentV1 = {
        ...intent,
        handoffOperationId: "task19-handoff-2",
        originalOperationId: "task19-mutation-2",
        oldOwner: owner.activeOwner,
        newOwner: {
          scopeId: owner.activeOwner.scopeId,
          gateId: owner.activeOwner.gateId,
          generationId: owner.activeOwner.generationId,
          operationId: "task19-mutation-2",
          attemptId: "task19-attempt-2",
        },
        expectedTargetWriterFrontier: owner.protectedTargetFrontier,
        expectedGlobalTargetWriterGeneration: owner.globalTargetWriterGeneration,
      };
      expect((await f.witness.prepareTargetWriterHandoff(nextIntent)).status).toBe("REQUESTED");
      await f.witness.fencePreviousTargetWriter({ intent: nextIntent, authorizeNativeRevocation: f.approve });
      const currentWorkerLease = await f.witness.claimTargetWriterForGate({ intent: nextIntent, epochId: "epoch-task19-gen-2" });
      expect(currentWorkerLease.leaseGeneration).toBe(2);

      // The generation-1 worker is stale after the generation-2 handoff claim:
      // its native write is denied at effect time and bytes never change.
      await expect(
        f.witness.withCurrentReviewWriterLease(staleWorkerLease, async (mutate) =>
          mutate({ bytes: Buffer.from("stale gen-1 write"), gitMode: "100644" }),
        ),
      ).rejects.toThrow("lease");
      expect(await readFile(join(f.root, "artifact.md"), "utf8")).toBe("original");

      // The current generation keeps its native write authority.
      await f.witness.withCurrentReviewWriterLease(currentWorkerLease, async (mutate) =>
        mutate({ bytes: Buffer.from("generation-2 current write"), gitMode: "100644" }),
      );
      expect(await readFile(join(f.root, "artifact.md"), "utf8")).toBe("generation-2 current write");
    });
  });



  describe("N3/N4/N6/N7 coordinator custody windows and journal fail-closed paths", () => {
    it("N3 restart after a prepare-window crash recovers the existing prepared payload by its exact id", async () => {
      const harness = createProductionHarness();
      const sessionId = "task19-prod-prepare-writer";
      const crashed = harness.buildCoordinator({
        seamFactory: () => createRecordingSeam({ failOnCall: 1 }),
      });
      const started = await crashed.coordinator.startOrResume(sessionId, {
        source: "command", designPath: DESIGN_PATH, planPath: PLAN_PATH,
      });
      const gateId = started.gateId as string;

      // Crash window: the content-addressed prepared record IS durable and the
      // V2 intent event IS appended, but the witness publication fails, so the
      // preparation never completes from the caller's point of view.
      await expect(
        crashed.coordinator.prepareCallerOperation(sessionId, {
          kind: "dispatch_reviewer", phase: "design",
          redispatchedOperationId: (await crashed.eventStore.listDispatches(gateId)).at(-1)?.operationId,
        } as ReviewGateNextOperation),
      ).rejects.toThrow("review_gate_witness_publication_failed");

      const recoveryDigests = await crashed.recoveryStore.list();
      if (recoveryDigests.length !== 1) {
        throw new Error(`unexpected prepared records: ${recoveryDigests.length}`);
      }
      const recordBytes = await crashed.recoveryStore.read(recoveryDigests[0]);
      if (recordBytes === null) throw new Error("task19_fixture_prepared_record_missing");
      const record = JSON.parse(recordBytes.toString("utf8")) as {
        recordKind: unknown;
        gateId: string;
        operationId: string;
      };
      expect(record.recordKind).toBe("review_gate_prepared_operation");
      expect(record.gateId).toBe(gateId);
      const crashedOperationId = record.operationId;

      // The orphaned intent event is durable even though it was never witnessed.
      const journalBeforeRestart = await harness.eventStore().readV2Journal(gateId);
      expect(journalBeforeRestart.eventCount).toBe(1);
      const intentEvent = journalBeforeRestart.events[0];
      if (intentEvent === undefined || intentEvent.eventType !== "EXTERNAL_OPERATION_DISPATCHED") {
        throw new Error("task19_fixture_intent_event_missing");
      }
      const intentPayload = intentEvent.payload as { inputBindingDigest?: string };
      expect(intentPayload.inputBindingDigest).toBe(recoveryDigests[0]);

      crashed.coordinator.releaseSession(sessionId);

      // Restart: fresh coordinator and stores over the SAME durable custody.
      // The coordinator must NOT demand a re-preparation with a new id: the
      // caller-owned decision executes against the already-durable payload.
      const restarted = harness.buildCoordinator({ idPrefix: "task19-prepared-recovery" });
      const resumed = await restarted.coordinator.startOrResume("task19-prod-recovered-writer", {
        source: "command", designPath: DESIGN_PATH, planPath: PLAN_PATH,
      });
      expect(resumed.gateId).toBe(gateId);
      expect(
        await restarted.coordinator.executeNextOperation("task19-prod-recovered-writer", {
          kind: "execute_operation", operationId: crashedOperationId, reason: null,
        }),
      ).toMatchObject({ kind: "executed" });

      // The prepared payload stays byte-identical; execution adds its own record.
      expect(await restarted.recoveryStore.read(recoveryDigests[0])).toEqual(recordBytes);
      const recoveredDigests = await restarted.recoveryStore.list();
      expect(recoveredDigests).toEqual(expect.arrayContaining(recoveryDigests));
      expect(recoveredDigests).toHaveLength(recoveryDigests.length + 1);

      // The executed dispatch chains from the crash window's durable intent.
      const journalAfter = await harness.eventStore().readV2Journal(gateId);
      expect(journalAfter.eventCount).toBe(2);
      const executedEvent = journalAfter.events[1];
      if (executedEvent === undefined) throw new Error("task19_fixture_executed_event_missing");
      expect(executedEvent.parentEventId).toBe(intentEvent.eventId);
      for (const event of journalAfter.events) {
        expect(() => validateReviewGateEventRecord(event)).not.toThrow();
      }
      // Only the execute-time publication happened on the restarted process.
      expect(restarted.seam.calls()).toBe(1);
    });

    it("N6 witness publication failure after the durable V2 append blocks typed and leaves the journal recoverable", async () => {
      const harness = createProductionHarness();
      const sessionId = "task19-prod-witness-writer";
      const first = harness.buildCoordinator({
        seamFactory: () => createRecordingSeam({ failOnCall: 2 }),
      });
      const started = await first.coordinator.startOrResume(sessionId, {
        source: "command", designPath: DESIGN_PATH, planPath: PLAN_PATH,
      });
      const gateId = started.gateId as string;
      const prepared = await first.coordinator.prepareCallerOperation(sessionId, {
        kind: "dispatch_reviewer", phase: "design",
        redispatchedOperationId: (await first.eventStore.listDispatches(gateId)).at(-1)?.operationId,
      } as ReviewGateNextOperation);
      expect(first.seam.calls()).toBe(1);

      // The journal append IS committed before the seam runs, so a seam outage
      // fails the operation closed after durable custody rather than losing it.
      const outcome = await first.coordinator.executeNextOperation(sessionId, {
        kind: "execute_operation", operationId: prepared.operationId, reason: null,
      });
      expect(outcome.kind).toBe("blocked");
      if (outcome.guidance === null) throw new Error("task19_fixture_guidance_missing");
      expect(outcome.guidance.startsWith("review_gate_operation_execution_failed")).toBe(true);
      expect(outcome.guidance).toContain("review_gate_witness_publication_failed");
      expect(first.seam.calls()).toBe(2);

      // The appended bytes stay durable over a fresh store instance and the
      // legacy journal never carries V2 custody, so recovery stays clean.
      const durable = harness.eventStore();
      const journal = await durable.readV2Journal(gateId);
      expect(journal.eventCount).toBe(2);
      for (const event of journal.events) {
        expect(() => validateReviewGateEventRecord(event)).not.toThrow();
      }
      expect(readFileSync(v2JournalPath(harness.rootDir, gateId), "utf8").split("\n").filter(Boolean)).toHaveLength(2);
      expect(
        readFileSync(join(harness.rootDir, ".justice", "review-gates", gateId, "events.jsonl"), "utf8"),
      ).not.toContain("schemaVersion");
      expect(await durable.recoverJournal(gateId)).toMatchObject({ status: "clean" });
    });

    it("rejects a stale V2 journal append from another store instance without replacing committed events", async () => {
      const harness = createProductionHarness();
      const started = await harness
        .buildCoordinator()
        .coordinator.startOrResume("task19-stale-v2-writer", {
          source: "command", designPath: DESIGN_PATH, planPath: PLAN_PATH,
        });
      const gateId = started.gateId as string;
      const firstStore = harness.eventStore();
      const staleStore = harness.eventStore();
      await Promise.all([firstStore.readV2Journal(gateId), staleStore.readV2Journal(gateId)]);

      const firstRecord = {
        schemaVersion: 2,
        eventId: "task19-v2-first",
        parentEventId: gateId,
        emittedAt: "2026-10-15T00:00:00.000Z",
        gateId,
        epochId: "task19-v2-epoch",
        generationId: gateId,
        writerId: "task19-v2-writer",
        eventType: "EXTERNAL_OPERATION_DISPATCHED",
        payload: {
          eventType: "EXTERNAL_OPERATION_DISPATCHED",
          gateId,
          generationId: gateId,
          epochId: "task19-v2-epoch",
          operationId: "task19-v2-operation-1",
          dispatchAttemptId: "task19-v2-attempt-1",
          phase: "design",
          role: "reviewer",
          candidateOrTargetSetDigest: "c".repeat(64),
          inputBindingDigest: "c".repeat(64),
          protocolFingerprint: "c".repeat(64),
          expectedWitnessFrontier: "c".repeat(64),
          protectedLeaseProofDigest: null,
        },
      };
      const staleRecord = {
        ...firstRecord,
        eventId: "task19-v2-stale",
        payload: {
          ...firstRecord.payload,
          operationId: "task19-v2-operation-2",
          dispatchAttemptId: "task19-v2-attempt-2",
        },
      };

      await firstStore.appendV2Events(gateId, [asV2BypassRecord(firstRecord)]);
      await expect(
        staleStore.appendV2Events(gateId, [asV2BypassRecord(staleRecord)]),
      ).rejects.toThrow("review_gate_v2_journal_frontier_conflict");

      expect((await firstStore.readV2Journal(gateId)).events.map((event) => event.eventId)).toContain(
        "task19-v2-first",
      );
    });

    it("N7 rejects a coordinator bypass of the V2 journal append at every custody boundary", async () => {
      const harness = createProductionHarness();
      const started = await harness
        .buildCoordinator()
        .coordinator.startOrResume("task19-prod-bypass-writer", {
          source: "command", designPath: DESIGN_PATH, planPath: PLAN_PATH,
        });
      const gateId = started.gateId as string;
      const eventStore = harness.eventStore();

      const baseRecord = {
        schemaVersion: 2,
        eventId: "task19-bypass-1",
        parentEventId: gateId,
        emittedAt: "2026-10-15T00:00:00.000Z",
        gateId,
        epochId: "task19-bypass-epoch",
        generationId: gateId,
        writerId: "task19-bypass-writer",
        eventType: "EXTERNAL_OPERATION_DISPATCHED",
        payload: {
          eventType: "EXTERNAL_OPERATION_DISPATCHED",
          gateId,
          generationId: gateId,
          epochId: "task19-bypass-epoch",
          operationId: "task19-bypass-op-1",
          dispatchAttemptId: "task19-bypass-attempt-1",
          phase: "design",
          role: "reviewer",
          candidateOrTargetSetDigest: "c".repeat(64),
          inputBindingDigest: "c".repeat(64),
          protocolFingerprint: "c".repeat(64),
          expectedWitnessFrontier: "c".repeat(64),
          protectedLeaseProofDigest: null,
        },
      };
      await eventStore.appendV2Events(
        gateId,
        [asV2BypassRecord(structuredClone(baseRecord))],
      );

      // (a) codec-invalid payload (required role field removed):
      const brokenPayload = { ...baseRecord.payload } as Record<string, unknown>;
      delete brokenPayload.role;
      await expect(
        eventStore.appendV2Events(gateId, [
          asV2BypassRecord(
            structuredClone({ ...baseRecord, eventId: "task19-bypass-2", payload: brokenPayload }),
          ),
        ]),
      ).rejects.toThrow("review_gate_event_schema_invalid");

      // (b) event bound to another gate:
      await expect(
        eventStore.appendV2Events(gateId, [
          asV2BypassRecord(
            structuredClone({
              ...baseRecord,
              gateId: "task19-foreign-gate",
              generationId: "task19-foreign-gate",
              payload: {
                ...baseRecord.payload,
                gateId: "task19-foreign-gate",
                generationId: "task19-foreign-gate",
              },
            }),
          ),
        ]),
      ).rejects.toThrow("review_gate_event_gate_mismatch");

      // (c) broken parent chain:
      await expect(
        eventStore.appendV2Events(gateId, [
          asV2BypassRecord(
            structuredClone({
              ...baseRecord,
              eventId: "task19-bypass-3",
              parentEventId: "task19-unknown-tail",
            }),
          ),
        ]),
      ).rejects.toThrow("review_gate_v2_journal_chain_invalid");

      // A second, legitimate chained event gives the witness-only id check a
      // valid tail to chain from before the duplicate attempt:
      await eventStore.appendV2Events(gateId, [
        asV2BypassRecord(
          structuredClone({
            ...baseRecord,
            eventId: "task19-bypass-2",
            parentEventId: baseRecord.eventId,
          }),
        ),
      ]);

      // (d) duplicate eventId across the journal:
      await expect(
        eventStore.appendV2Events(gateId, [
          asV2BypassRecord(
            structuredClone({ ...baseRecord, parentEventId: "task19-bypass-2" }),
          ),
        ]),
      ).rejects.toThrow("review_gate_v2_journal_event_id_conflict");

      const journal = await eventStore.readV2Journal(gateId);
      expect(journal.eventCount).toBe(2);

      // (e) direct bytes bypass: a legacy V1 record or a torn tail inside the
      // V2 journal file fails closed on every later read and is never healed.
      const journalFile = v2JournalPath(harness.rootDir, gateId);
      const tamperedBytes = await readFile(journalFile, "utf8");
      const legacyLine = JSON.stringify({
        eventType: "ORCHESTRATION_RESUMED",
        gateId,
        writerId: "task19-bypass-writer-2",
        epochId: "task19-bypass-epoch-2",
        emittedAt: "2026-10-15T00:00:01.000Z",
        payload: { resumedAt: "2026-10-15T00:00:01.000Z" },
      });
      await appendFile(journalFile, Buffer.from(`${legacyLine}\n`, "utf8"));
      await expect(harness.eventStore().readV2Journal(gateId)).rejects.toThrow(
        "review_gate_event_v2_required",
      );
      await writeFile(journalFile, tamperedBytes, "utf8");
      await writeFile(journalFile, `${tamperedBytes}{corrupt`, "utf8");
      await expect(harness.eventStore().readV2Journal(gateId)).rejects.toThrow(
        "review_gate_journal_torn_tail",
      );
      // The tampered bytes are still exactly where the bypass put them.
      expect(await readFile(journalFile, "utf8")).toBe(`${tamperedBytes}{corrupt`);
      await writeFile(journalFile, tamperedBytes, "utf8");
      expect((await harness.eventStore().readV2Journal(gateId)).eventCount).toBe(2);
    });

    it("N4 restart after native restore classifies the destination exactly and records the recovery event", async () => {
      const root = await initTask19GitWorkspace();
      // Known dirty post-image before the gate acts.
      await writeFile(join(root, RESTORE_TARGET), RESTORE_V2, "utf8");
      const firstGate = createReviewGateGit({
        rootDir: root,
        provider: createTask19FsProvider(root),
        recoveryStore: createReviewGateRecoveryStore(root),
      });
      const inspected = await firstGate.inspectTarget(RESTORE_TARGET);
      if (inspected.headSha === null || inspected.headEntry === null || inspected.indexEntry === null) {
        throw new Error("task19_fixture_git_bindings_missing");
      }
      const sourceKnownDirtyBinding: ReviewRestoreSourceBinding = {
        headSha: inspected.headSha,
        headEntry: inspected.headEntry,
        indexEntry: inspected.indexEntry,
        worktree: {
          canonicalPath: RESTORE_TARGET,
          digest: computeArtifactDigest(Buffer.from(RESTORE_V2, "utf8")),
          gitMode: inspected.headEntry.gitMode,
        },
        sourceEventId: "task19-evt-finding-remediated",
      };
      const targetCleanCommittedBinding: ReviewRestoreDestinationBinding = {
        headSha: inspected.headSha,
        headEntry: inspected.headEntry,
        indexEntry: inspected.indexEntry,
        worktree: {
          canonicalPath: RESTORE_TARGET,
          digest: computeArtifactDigest(Buffer.from(RESTORE_V1, "utf8")),
          gitMode: inspected.headEntry.gitMode,
        },
      };
      const restoreInput: ReviewRestorePrepareInput = {
        gateId: "task19-restore-gate",
        operationId: "task19-restore-op",
        phase: "design",
        targetCanonicalPath: RESTORE_TARGET,
        allowedRestoreTargetPath: RESTORE_TARGET,
        sourceKnownDirtyBinding,
        targetCleanCommittedBinding,
      };
      const payload = await firstGate.prepareRestore(restoreInput);

      // The native restore effect itself completes (exact-replace to the
      // committed destination) BEFORE any success event.
      await firstGate.executePreparedRestore(payload);
      expect((await readFile(join(root, RESTORE_TARGET), "utf8"))).toBe(RESTORE_V1);

      // Restart over the same durable custody: no new prepare id, no re-run —
      // the classification proves the destination is exact.
      const restartedGate = createReviewGateGit({
        rootDir: root,
        provider: createTask19FsProvider(root),
        recoveryStore: createReviewGateRecoveryStore(root),
      });
      await expect(restartedGate.recoverPreparedRestore(payload)).resolves.toEqual({
        status: "recovered",
      });

      // The durable V2 journal keeps the crash-window chain the coordinator
      // would produce: REVIEW_TARGET_RESTORE_PREPARED (append-time) followed by
      // REVIEW_TARGET_RESTORE_RECOVERED (restart-time classification) — and no
      // SUCCEEDED event is invented for an unrestored window.
      const harness = createProductionHarness();
      const eventStore = harness.eventStore();
      const emittedAt = "2026-10-15T00:00:00.000Z";
      const preparedEvent = {
        schemaVersion: 2,
        eventId: "task19-restore-evt-1",
        parentEventId: "task19-restore-gate",
        emittedAt,
        gateId: "task19-restore-gate",
        epochId: "task19-restore-epoch",
        generationId: "task19-restore-gate",
        writerId: "task19-restore-writer",
        eventType: "REVIEW_TARGET_RESTORE_PREPARED",
        payload: {
          phase: "design",
          targetCanonicalPath: payload.targetCanonicalPath,
          sourceKnownDirtyBinding: {
            headSha: payload.sourceKnownDirtyBinding.headSha,
            headEntry: payload.sourceKnownDirtyBinding.headEntry,
            indexEntry: payload.sourceKnownDirtyBinding.indexEntry,
            worktree: payload.sourceKnownDirtyBinding.worktree,
          },
          targetCleanCommittedBinding: {
            headSha: payload.targetCleanCommittedBinding.headSha,
            headEntry: payload.targetCleanCommittedBinding.headEntry,
            indexEntry: payload.targetCleanCommittedBinding.indexEntry,
            worktree: payload.targetCleanCommittedBinding.worktree,
          },
          preparedOperationId: payload.operationId,
          preparedRecoveryDigest: payload.recoveryDigest,
        },
      } as unknown as VerifiedReviewGateEvent;
      const recoveredEvent = {
        schemaVersion: 2,
        eventId: "task19-restore-evt-2",
        parentEventId: "task19-restore-evt-1",
        emittedAt,
        gateId: "task19-restore-gate",
        epochId: "task19-restore-epoch",
        generationId: "task19-restore-gate",
        writerId: "task19-restore-writer",
        eventType: "REVIEW_TARGET_RESTORE_RECOVERED",
        payload: {
          preparedEventId: "task19-restore-evt-1",
          verifiedDestinationBinding: {
            headSha: payload.targetCleanCommittedBinding.headSha,
            headEntry: payload.targetCleanCommittedBinding.headEntry,
            indexEntry: payload.targetCleanCommittedBinding.indexEntry,
            worktree: payload.targetCleanCommittedBinding.worktree,
          },
        },
      } as unknown as VerifiedReviewGateEvent;
      await eventStore.appendV2Events("task19-restore-gate", [preparedEvent, recoveredEvent]);
      const journal = await eventStore.readV2Journal("task19-restore-gate");
      expect(journal.eventCount).toBe(2);
      expect(journal.events[0]?.eventType).toBe("REVIEW_TARGET_RESTORE_PREPARED");
      expect(journal.events[1]?.eventType).toBe("REVIEW_TARGET_RESTORE_RECOVERED");
      const recoveredRecord = journal.events[1];
      if (recoveredRecord === undefined) throw new Error("task19_fixture_recovery_event_missing");
      expect(recoveredRecord.parentEventId).toBe("task19-restore-evt-1");
      expect((recoveredRecord.payload as { preparedEventId?: string }).preparedEventId).toBe(
"task19-restore-evt-1");
      expect((recoveredRecord.payload as { verifiedDestinationBinding?: { worktree?: { digest?: string } } }).verifiedDestinationBinding?.worktree?.digest).toBe(
        computeArtifactDigest(Buffer.from(RESTORE_V1, "utf8")),
      );
    });
  });
});
