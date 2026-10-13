import { execFileSync } from "node:child_process";
import { chmod, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createReviewGateScopeWitness,
  authorizeFirstWorkspaceEnrollment,
} from "../../src/runtime/review-gate-scope-witness.js";
import { observeGitWorkspace } from "../../src/runtime/review-gate-scope-admission.js";
import {
  createWitnessFixture,
  preparePublicationFixture,
  type WitnessFixture,
} from "./review-gate-witness-fixtures.js";
import { createReviewGateLockManager } from "../../src/runtime/review-gate-lock-manager.js";
import { createPrivateRawResponseStore } from "../../src/runtime/review-gate-recovery-store.js";

describe("protected scope witness", () => {
  let f: WitnessFixture;
  beforeEach(async () => {
    f = await createWitnessFixture();
  });
  afterEach(async () => {
    f.witness.close();
    await rm(f.sandbox, { recursive: true, force: true });
  });
  it("durably consumes a separately authenticated first enrollment exactly once", async () => {
    const auth = await f.enroll();
    expect((await f.witness.verifyFirstWorkspaceEnrollment(auth)).authorizationOperationId).toBe(
      "operation-1",
    );
    const restart = createReviewGateScopeWitness({
      workspaceRoot: f.root,
      ...(await observeGitWorkspace(f.root)),
      witnessDirectory: f.directory,
      hostTrustRoot: f.admin.publicKey,
    });
    try {
      await expect(restart.verifyFirstWorkspaceEnrollment(auth)).rejects.toThrow("nonce");
    } finally {
      restart.close();
    }
  });
  it("reuses pending authorization after restart but rejects a second nonce", async () => {
    const auth = await f.enroll();
    expect(await f.enroll()).toEqual(auth);
    await expect(
      authorizeFirstWorkspaceEnrollment({
        witness: f.witness,
        designPath: "docs/design.md",
        planPath: "docs/plan.md",
        workflowNonce: "nonce-2",
        operationId: "operation-2",
        authorize: f.approve,
      }),
    ).rejects.toThrow("enrollment");
  });
  it("rejects forged provisioner authorization", async () => {
    await expect(
      authorizeFirstWorkspaceEnrollment({
        witness: f.witness,
        designPath: "docs/design.md",
        planPath: "docs/plan.md",
        workflowNonce: "nonce-1",
        operationId: "operation-1",
        authorize: async () => "A".repeat(86) + "==",
      }),
    ).rejects.toThrow("authentication");
  });
  it("does not recreate a destroyed registry", async () => {
    await rm(join(f.directory, "scope-head.json"));
    await expect(f.witness.readWorkspaceScopeFrontier()).rejects.toThrow("registry");
  });
  it("rejects unsafe witness protection", async () => {
    await chmod(f.directory, 0o777);
    await expect(f.witness.readWorkspaceScopeFrontier()).rejects.toThrow("protection");
  });
  it("rejects a symlink witness directory", async () => {
    const alias = join(f.sandbox, "alias");
    await symlink(f.directory, alias);
    const bad = createReviewGateScopeWitness({
      workspaceRoot: f.root,
      ...(await observeGitWorkspace(f.root)),
      witnessDirectory: alias,
      hostTrustRoot: f.admin.publicKey,
    });
    try {
      await expect(bad.readWorkspaceScopeFrontier()).rejects.toThrow("protection");
    } finally {
      bad.close();
    }
  });
  it("rejects a witness directory inside a workspace even with a dot-dot-prefixed name", async () => {
    const identity = await observeGitWorkspace(f.root);
    expect(() =>
      createReviewGateScopeWitness({
        workspaceRoot: f.root,
        ...identity,
        witnessDirectory: join(f.root, "..inside"),
        hostTrustRoot: f.admin.publicKey,
      }),
    ).toThrow("protection");
  });
  it("rejects a witness directory that contains the workspace", async () => {
    const identity = await observeGitWorkspace(f.root);
    expect(() => createReviewGateScopeWitness({
      workspaceRoot: f.root,
      ...identity,
      witnessDirectory: f.sandbox,
      hostTrustRoot: f.admin.publicKey,
    })).toThrow("protection");
  });
  it("retains shared private response bytes until the last live record is collected", async () => {
    const store = createPrivateRawResponseStore(f.directory, {
      maxResponseBytes: 1024,
      maxPendingPerGateBytes: 4096,
      maxPendingPerInstallationBytes: 8192,
    }, f.admin.publicKey);
    const bytes = Buffer.from("shared response evidence");
    const first = await store.stage({
      operationId: "operation-1", dispatchAttemptId: "attempt-1", gateId: "gate-1", bytes,
    });
    const second = await store.stage({
      operationId: "operation-2", dispatchAttemptId: "attempt-2", gateId: "gate-1", bytes,
    });

    await store.markResultCommittedPendingApply(first.record.operationId, first.record.dispatchAttemptId);
    await store.markFullyApplied(first.record.operationId, first.record.dispatchAttemptId);
    await expect(store.tombstoneAndCollect(first.record.operationId, first.record.dispatchAttemptId))
      .resolves.toBe("collected");
    await expect(store.tombstoneAndCollect(first.record.operationId, first.record.dispatchAttemptId))
      .resolves.toBe("already_collected");
    expect((await store.readExact(second.record.operationId, second.record.dispatchAttemptId))?.bytes)
      .toEqual(bytes);

    await store.markResultCommittedPendingApply(second.record.operationId, second.record.dispatchAttemptId);
    await store.markFullyApplied(second.record.operationId, second.record.dispatchAttemptId);
    await store.tombstoneAndCollect(second.record.operationId, second.record.dispatchAttemptId);
    await expect(store.readExact(second.record.operationId, second.record.dispatchAttemptId))
      .rejects.toThrow("review_gate_response_evidence_unavailable");
    store.close();
  });
  it("uses an OS guard across independently opened witness instances", async () => {
    let unlock = (): void => {};
    let signal = (): void => {};
    const ready = new Promise<void>((resolve) => {
      signal = resolve;
    });
    const held = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const running = f.witness.acquireWorkspaceAdmissionGuard(async () => {
      signal();
      await held;
    });
    await ready;
    const second = createReviewGateScopeWitness({
      workspaceRoot: f.root,
      ...(await observeGitWorkspace(f.root)),
      witnessDirectory: f.directory,
      hostTrustRoot: f.admin.publicKey,
    });
    try {
      await expect(second.readInstallationFrontierHash()).rejects.toThrow("busy_retryable");
    } finally {
      unlock();
      await running;
      second.close();
    }
    expect(await f.witness.readInstallationFrontierHash()).toMatch(/^[a-f0-9]{64}$/);
  });
  it("does not execute workspace-controlled Git fsmonitor commands in the trusted host", async () => {
    await writeFile(join(f.root, "fsmonitor.sh"), "#!/bin/sh\ntouch ../executed\nprintf '\\0'\n", {
      mode: 0o755,
    });
    execFileSync("git", ["-C", f.root, "add", "fsmonitor.sh"]);
    execFileSync("git", [
      "-C",
      f.root,
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-qm",
      "monitor fixture",
    ]);
    execFileSync("git", ["-C", f.root, "config", "core.fsmonitor", "./fsmonitor.sh"]);
    await f.witness.verifyFirstWorkspaceEnrollment(await f.enroll());
    await expect(readFile(join(f.sandbox, "executed"))).rejects.toThrow();
  });
  it("does not reinterpret an older journal layout as absent prior enrollment", async () => {
    const legacy = join(f.root, ".justice", "review-gates", "legacy-gate");
    await mkdir(legacy, { recursive: true });
    await writeFile(join(legacy, "events.jsonl"), "{}\n");
    await expect(f.enroll()).rejects.toThrow("prior_enrollment");
  });
  it("stages byte-complete evidence before permitting journal publication", async () => {
    const { input, bytes } = await preparePublicationFixture(f);
    expect(await f.witness.preparePublication(input, bytes)).toBe("prepared");
    expect(await f.witness.preparePublication(input, bytes)).toBe("already_prepared");
    expect(await f.witness.classifyPreparedPublication(input.publicationId)).toBe("prepared");
    const cas = {
      publicationId: input.publicationId,
      expectedGlobalFrontier: input.expectedGlobalFrontier,
      expectedWriterHash: input.expectedWriterHash,
    };
    expect(await f.witness.commitPreparedPublicationCAS(cas)).toBe("blocked");
    await f.witness.publishPreparedJournal(input.publicationId);
    expect(await f.witness.commitPreparedPublicationCAS(cas)).toBe("advanced");
    expect((await f.witness.readWorkspaceScopeFrontier()).scopes).toHaveLength(1);
    expect(await f.witness.recoverPreparedPublication(input.publicationId)).toBe(
      "already_committed",
    );
    await expect(f.enroll()).rejects.toThrow("enrollment");
  });
  it("rejects conflicting prepared identity", async () => {
    const { input, bytes } = await preparePublicationFixture(f);
    await f.witness.preparePublication(input, bytes);
    await expect(
      f.witness.preparePublication({ ...input, operationId: "conflict" }, bytes),
    ).rejects.toThrow("publication");
  });
  it("fails closed when exact staging bytes are lost", async () => {
    const { input, bytes } = await preparePublicationFixture(f);
    await f.witness.preparePublication(input, bytes);
    await rm(join(f.directory, `stage-${input.newTailDigest}.bin`));
    expect(await f.witness.recoverPreparedPublication(input.publicationId)).toBe("blocked");
  });
  it("rejects orphan stages without protected pending authority", async () => {
    await writeFile(join(f.directory, "stage-orphan.bin"), "untrusted", { mode: 0o600 });
    expect(await f.witness.recoverPreparedPublication("unprepared")).toBe("blocked");
  });
  it("retains enrollment when journal is deleted, and does not reset genesis", async () => {
    const { input, bytes } = await preparePublicationFixture(f);
    await f.witness.preparePublication(input, bytes);
    await f.witness.publishPreparedJournal(input.publicationId);
    expect(await f.witness.recoverPreparedPublication(input.publicationId)).toBe("advanced");
    const before = await readFile(join(f.directory, "scope-head.json"));
    await rm(join(f.directory, `journal-${input.newTailDigest}.bin`));
    await expect(f.witness.readWorkspaceScopeFrontier()).rejects.toThrow("journal");
    expect(await readFile(join(f.directory, "scope-head.json"))).toEqual(before);
  });
  it("does not persist a full next frontier in a committed publication record", async () => {
    const { input, bytes } = await preparePublicationFixture(f);
    await f.witness.preparePublication(input, bytes);
    await f.witness.publishPreparedJournal(input.publicationId);
    expect(await f.witness.recoverPreparedPublication(input.publicationId)).toBe("advanced");

    const head = JSON.parse(await readFile(join(f.directory, "scope-head.json"), "utf8")) as {
      readonly revision: number;
    };
    const snapshot = JSON.parse(
      await readFile(join(f.directory, `scope-${head.revision}.json`), "utf8"),
    ) as { readonly data: { readonly committed: Record<string, { readonly input: object }> } };
    expect(snapshot.data.committed[input.publicationId]?.input).not.toHaveProperty("nextFrontier");
  });
  it("blocks a missing installation-wide history snapshot", async () => {
    await f.enroll();
    await rm(join(f.directory, "scope-0.json"));
    const restarted = createReviewGateScopeWitness({
      workspaceRoot: f.root,
      ...(await observeGitWorkspace(f.root)),
      witnessDirectory: f.directory,
      hostTrustRoot: f.admin.publicKey,
    });
    try {
      await expect(restarted.readInstallationFrontierHash()).rejects.toThrow("registry");
    } finally {
      restarted.close();
    }
  });
  it("rolls back only an unpublished prepared operation without restoring nonce authority", async () => {
    const { input, bytes } = await preparePublicationFixture(f);
    await f.witness.preparePublication(input, bytes);
    expect(await f.witness.rollbackPreparedPublication(input.publicationId)).toBe("rolled_back");
    expect(await f.witness.recoverPreparedPublication(input.publicationId)).toBe("blocked");
    await expect(f.enroll()).rejects.toThrow("enrollment");
  });
  it("runs Gate-owned witness transactions while a Gate lock is held", async () => {
    const manager = createReviewGateLockManager(f.root, { provider: null });
    const owned = await createWitnessFixture(manager);
    try {
      const gateLock = await manager.acquireGateLock("gate-1");
      if (gateLock === "occupied") throw new Error("fixture gate lock occupied");
      try {
        await expect(owned.witness.readInstallation()).rejects.toThrow("lock_order");
        const observed = await owned.witness.withGateOwnedWitnessTransaction(async (current) => ({
          hash: current.hash,
          revision: current.revision,
        }));
        expect(observed.hash).toMatch(/^[a-f0-9]{64}$/);
        expect(observed.revision).toBeGreaterThanOrEqual(0);
      } finally {
        gateLock.release();
      }
      expect((await owned.witness.readInstallation()).installationId).toHaveLength(36);
    } finally {
      owned.witness.close();
      manager.close();
      await rm(owned.sandbox, { recursive: true, force: true });
    }
  });
});
