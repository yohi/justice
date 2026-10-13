import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { VerifiedTargetWriterHandoffIntentV1 } from "../../src/core/review-gate/types.js";
import {
  computeCanonicalJsonFingerprint,
} from "../../src/core/review-gate/identity.js";
import { createReviewGateLockManager } from "../../src/runtime/review-gate-lock-manager.js";
import { ProtectedWitnessStore } from "../../src/runtime/review-gate-protected-store.js";
import { targetRegistrySchema } from "../../src/runtime/review-gate-target-writer-schema.js";
import {
  buildSubsequentPublicationFixture,
  createWitnessFixture,
  prepareHandoffFixture,
  type WitnessFixture,
} from "./review-gate-witness-fixtures.js";

describe("protected canonical target writer", () => {
  let f: WitnessFixture;
  beforeEach(async () => {
    f = await createWitnessFixture();
  });
  afterEach(async () => {
    f.witness.close();
    await rm(f.sandbox, { recursive: true, force: true });
  });
  it("durably hands off one target and rejects a retained old lease after terminal revoke", async () => {
    const intent = await prepareHandoffFixture(f);
    expect((await f.witness.prepareTargetWriterHandoff(intent)).status).toBe("REQUESTED");
    await f.witness.fencePreviousTargetWriter({ intent, authorizeNativeRevocation: f.approve });
    const lease = await f.witness.claimTargetWriterForGate({ intent, epochId: "epoch-1" });
    expect(lease.leaseGeneration).toBe(1);
    const owner = await f.witness.readVerifiedTargetWriterAuthority(intent.target);
    const terminal: VerifiedTargetWriterHandoffIntentV1 = {
      ...intent,
      purpose: "TERMINAL_REVOKE_ONLY",
      handoffOperationId: "close-1",
      originalOperationId: "terminal-1",
      oldOwner: owner.activeOwner,
      newOwner: null,
      targets: [intent.target],
      closingSealOperationId: "seal-close-1",
      expectedTargetWriterFrontier: owner.protectedTargetFrontier,
      expectedGlobalTargetWriterGeneration: 1,
    };
    await f.witness.prepareTerminalTargetWriterRevoke({
      intents: [terminal],
      terminalTransitionOperationId: "terminal-1",
    });
    const proof = await f.witness.revokeTerminalTargetWriter({
      handoffOperationId: "close-1",
      authorizeNativeRevocation: f.approve,
    });
    expect(proof.status).toBe("REVOKED");
    expect(proof.globalTargetWriterHighWatermark).toBe(2);
    await expect(
      f.witness.withCurrentReviewWriterLease(lease, async (mutate) =>
        mutate({ bytes: Buffer.from("stale"), gitMode: "100644" }),
      ),
    ).rejects.toThrow("lease");
    expect(await readFile(join(f.root, "artifact.md"), "utf8")).toBe("original");
    expect(
      await f.witness.recoverPreparedTerminalTargetWriterRevoke({
        handoffOperationId: "close-1",
        authorizeNativeRevocation: f.approve,
      }),
    ).toEqual(proof);
  });
  it("does not claim a writer before a durable fence", async () => {
    const intent = await prepareHandoffFixture(f);
    await f.witness.prepareTargetWriterHandoff(intent);
    await expect(
      f.witness.claimTargetWriterForGate({ intent, epochId: "epoch-1" }),
    ).rejects.toThrow("fence");
  });
  it("rejects a claimed lease whose attempt does not match the requested owner", async () => {
    const intent = await prepareHandoffFixture(f);
    await f.witness.prepareTargetWriterHandoff(intent);
    await f.witness.fencePreviousTargetWriter({ intent, authorizeNativeRevocation: f.approve });
    const lease = await f.witness.claimTargetWriterForGate({ intent, epochId: "epoch-1" });
    const protectedStore = new ProtectedWitnessStore(f.directory);
    await protectedStore.withGuard("installation", async () => {
      const snapshot = await protectedStore.read("target", targetRegistrySchema);
      const key = intent.target.targetIdentityDigest;
      const entry = snapshot.data.targets[key];
      if (entry === undefined) throw new Error("fixture_target_missing");
      const { protectedLeaseProofDigest: _oldProof, ...priorLease } = lease;
      void _oldProof;
      const body = { ...priorLease, operationId: "mutation-2", attemptId: "attempt-2" };
      const tamperedLease = {
        ...body,
        protectedLeaseProofDigest: computeCanonicalJsonFingerprint(body),
      };
      await protectedStore.advance("target", snapshot, {
        ...snapshot.data,
        targets: { ...snapshot.data.targets, [key]: { ...entry, lease: tamperedLease } },
      });
    });

    await expect(f.witness.claimTargetWriterForGate({ intent, epochId: lease.epochId }))
      .rejects.toThrow("lease_retry_conflict");
  });
  it("rejects forged native revocation and leaves the owner unchanged", async () => {
    const intent = await prepareHandoffFixture(f);
    await f.witness.prepareTargetWriterHandoff(intent);
    await expect(
      f.witness.fencePreviousTargetWriter({
        intent,
        authorizeNativeRevocation: async () => "invalid",
      }),
    ).rejects.toThrow("native");
    expect(
      (await f.witness.readVerifiedTargetWriterAuthority(intent.target))
        .globalTargetWriterGeneration,
    ).toBe(0);
  });
  it("can terminally close a never-issued writer without inventing a successor", async () => {
    const initial = await prepareHandoffFixture(f);
    const intent: VerifiedTargetWriterHandoffIntentV1 = {
      ...initial,
      purpose: "TERMINAL_REVOKE_ONLY",
      handoffOperationId: "close-empty",
      newOwner: null,
      targets: [initial.target],
      closingSealOperationId: "seal-close-empty",
    };
    await f.witness.prepareTerminalTargetWriterRevoke({
      intents: [intent],
      terminalTransitionOperationId: "terminal-empty",
    });
    const proof = await f.witness.revokeTerminalTargetWriter({
      handoffOperationId: "close-empty",
      authorizeNativeRevocation: f.approve,
    });
    expect(proof.status).toBe("NEVER_CLAIMED_OR_ALREADY_REVOKED");
    expect(proof.globalTargetWriterHighWatermark).toBe(0);
  });
  it("performs real broker-mediated mutation and keeps same-operation retry idempotent", async () => {
    const intent = await prepareHandoffFixture(f);
    await f.witness.prepareTargetWriterHandoff(intent);
    const input = { intent, epochId: "epoch-1", authorizeNativeRevocation: f.approve };
    const lease = await f.witness.recoverPreparedTargetWriterHandoff(input);
    expect(await f.witness.recoverPreparedTargetWriterHandoff(input)).toEqual(lease);
    await f.witness.withCurrentReviewWriterLease(lease, async (mutate) =>
      mutate({ bytes: Buffer.from("updated"), gitMode: "100644" }),
    );
    expect(await readFile(join(f.root, "artifact.md"), "utf8")).toBe("updated");
    await expect(
      f.witness.withCurrentReviewWriterLease(lease, async (mutate) =>
        mutate({ bytes: Buffer.from("second effect"), gitMode: "100644" }),
      ),
    ).rejects.toThrow("lease");
  });
  it("does not let a retained native mutation callback escape the effect-time guard", async () => {
    const intent = await prepareHandoffFixture(f);
    await f.witness.prepareTargetWriterHandoff(intent);
    const lease = await f.witness.recoverPreparedTargetWriterHandoff({
      intent,
      epochId: "epoch-1",
      authorizeNativeRevocation: f.approve,
    });
    let retained: (
      input: Readonly<{ bytes: Uint8Array; gitMode: "100644" | "100755" }>,
    ) => Promise<void> = async () => {
      throw new Error("fixture callback absent");
    };
    await f.witness.withCurrentReviewWriterLease(lease, async (mutate) => {
      retained = mutate;
    });
    await expect(retained({ bytes: Buffer.from("escaped"), gitMode: "100644" })).rejects.toThrow(
      "guard",
    );
    expect(await readFile(join(f.root, "artifact.md"), "utf8")).toBe("original");
  });
  it("rejects a claim after protected native fence proof is deleted", async () => {
    const intent = await prepareHandoffFixture(f);
    await f.witness.prepareTargetWriterHandoff(intent);
    const lease = await f.witness.recoverPreparedTargetWriterHandoff({
      intent,
      epochId: "epoch-1",
      authorizeNativeRevocation: f.approve,
    });
    for (const name of await readdir(f.directory))
      if (name.startsWith("native-proof-")) await rm(join(f.directory, name));
    await expect(
      f.witness.claimTargetWriterForGate({ intent, epochId: lease.epochId }),
    ).rejects.toThrow("native");
  });
  async function createSealedCloseFixture() {
    const manager = createReviewGateLockManager(f.root, { provider: null });
    const owned = await createWitnessFixture(manager);
    const intent = await prepareHandoffFixture(owned);
    await owned.witness.prepareTargetWriterHandoff(intent);
    const lease = await owned.witness.recoverPreparedTargetWriterHandoff({
      intent,
      epochId: "epoch-1",
      authorizeNativeRevocation: owned.approve,
    });
    const owner = await owned.witness.readVerifiedTargetWriterAuthority(intent.target);
    const terminal: VerifiedTargetWriterHandoffIntentV1 = {
      ...intent,
      purpose: "TERMINAL_REVOKE_ONLY",
      handoffOperationId: "close-1",
      originalOperationId: "terminal-1",
      oldOwner: owner.activeOwner,
      newOwner: null,
      targets: [intent.target],
      closingSealOperationId: "seal-close-1",
      expectedTargetWriterFrontier: owner.protectedTargetFrontier,
      expectedGlobalTargetWriterGeneration: owner.globalTargetWriterGeneration,
    };
    const publication = await buildSubsequentPublicationFixture(owned, {
      publicationId: "publication-2",
      operationId: "publication-operation-2",
      event: {
        schemaVersion: 2,
        eventId: "event-terminal-intent",
        parentEventId: "event-genesis",
        generationId: "generation-1",
        gateId: "gate-1",
        writerId: "writer-1",
        epochId: "epoch-1",
        emittedAt: "2026-10-11T00:00:01.000Z",
        eventType: "TARGET_WRITER_HANDOFF_REQUESTED",
        payload: {
          purpose: "TERMINAL_REVOKE_ONLY", status: "REQUESTED",
          handoffOperationId: terminal.handoffOperationId,
          originalOperationId: terminal.originalOperationId,
          scopeId: terminal.scopeId, gateId: terminal.gateId,
          generationId: terminal.generationId, phase: terminal.phase,
          roundOrdinal: terminal.roundOrdinal, protocolFingerprint: terminal.protocolFingerprint,
          target: terminal.target, targets: terminal.targets,
          closingSealOperationId: terminal.closingSealOperationId,
          oldOwner: terminal.oldOwner, newOwner: terminal.newOwner,
          expectedTargetWriterFrontier: terminal.expectedTargetWriterFrontier,
          expectedGlobalTargetWriterGeneration: terminal.expectedGlobalTargetWriterGeneration,
          expectedGateEventFrontier: terminal.expectedGateEventFrontier,
          expectedPreImageDigest: terminal.expectedPreImageDigest,
          expectedGitMode: terminal.expectedGitMode,
          pendingNativeEffectReference: terminal.pendingNativeEffectReference,
        },
      },
    });
    return { manager, owned, intent, lease, terminal, publication };
  }
  it("does not leave a publication prepared when terminal frontier validation fails", async () => {
    const { manager, owned, terminal, publication } = await createSealedCloseFixture();
    try {
      await expect(owned.witness.prepareTerminalIntentPublication(
        {
          intents: [{ ...terminal, expectedTargetWriterFrontier: "f".repeat(64) }],
          terminalTransitionOperationId: "terminal-1",
          publication: publication.input,
        },
        publication.bytes,
      )).rejects.toThrow("terminal_frontier");

      await expect(owned.witness.classifyPreparedPublication(publication.input.publicationId))
        .resolves.toBe("blocked");
    } finally {
      manager.close();
      owned.witness.close();
      await rm(owned.sandbox, { recursive: true, force: true });
    }
  });
  it("installs and verifies the closing seal on the Gate-owned publication path while the Gate lock is held", async () => {
    const { manager, owned, intent, terminal, publication } = await createSealedCloseFixture();
    try {
      const gateLock = await manager.acquireGateLock("gate-1");
      if (gateLock === "occupied") throw new Error("fixture gate lock occupied");
      try {
        await expect(
          owned.witness.preparePublication(publication.input, publication.bytes),
        ).rejects.toThrow("lock_order");
        expect(
          await owned.witness.prepareTerminalIntentPublication(
            {
              intents: [terminal],
              terminalTransitionOperationId: "terminal-1",
              publication: publication.input,
            },
            publication.bytes,
          ),
        ).toBe("prepared");
      } finally {
        gateLock.release();
      }
      expect(
        await owned.witness.prepareTerminalIntentPublication(
          {
            intents: [terminal],
            terminalTransitionOperationId: "terminal-1",
            publication: publication.input,
          },
          publication.bytes,
        ),
      ).toBe("already_prepared");
      const digest = publication.input.newTailDigest;
      const marker = await owned.witness.verifyClosingSeal({
        closingSealOperationId: "seal-close-1",
        preparedEventDigest: digest,
      });
      expect(marker.marker).toBe("TARGET_CLOSING_SEALED");
      expect(marker.gateId).toBe("gate-1");
      expect(marker.targets).toEqual([intent.target]);
      expect(marker.publicationId).toBe("publication-2");
      expect(marker.preparedEventDigest).toBe(digest);
      expect(marker.preSealWitnessFrontier).toMatch(/^[a-f0-9]{64}$/);
      expect(marker.preSealTargetFrontier).toMatch(/^[a-f0-9]{64}$/);
      expect(marker.targetLeaseHighWatermark).toBe(1);
      expect(marker.sealedReceiptDigest).toBeNull();
      await expect(
        owned.witness.verifyClosingSeal({
          closingSealOperationId: "seal-close-1",
          preparedEventDigest: "0".repeat(64),
        }),
      ).rejects.toThrow("digest_mismatch");
      await expect(
        owned.witness.verifyClosingSeal({
          closingSealOperationId: "seal-close-2",
          preparedEventDigest: digest,
        }),
      ).rejects.toThrow("closing_seal_unprepared");
    } finally {
      owned.witness.close();
      manager.close();
      await rm(owned.sandbox, { recursive: true, force: true });
    }
  });
  it("denies a native worker effect on a sealed target after the closing seal is installed", async () => {
    const { manager, owned, lease, terminal, publication } = await createSealedCloseFixture();
    try {
      const gateLock = await manager.acquireGateLock("gate-1");
      if (gateLock === "occupied") throw new Error("fixture gate lock occupied");
      try {
        await owned.witness.prepareTerminalIntentPublication(
          {
            intents: [terminal],
            terminalTransitionOperationId: "terminal-1",
            publication: publication.input,
          },
          publication.bytes,
        );
      } finally {
        gateLock.release();
      }
      await expect(
        owned.witness.withCurrentReviewWriterLease(lease, async (mutate) => {
          await mutate({ bytes: Buffer.from("sealed-out"), gitMode: "100644" });
        }),
      ).rejects.toThrow("closing_seal");
      expect(await readFile(join(owned.root, "artifact.md"), "utf8")).toBe("original");
    } finally {
      owned.witness.close();
      manager.close();
      await rm(owned.sandbox, { recursive: true, force: true });
    }
  });
  it("publishes the sealed terminal intent, binds the authenticated sealed receipt, and fails closed on receipt loss", async () => {
    const { manager, owned, terminal, publication } = await createSealedCloseFixture();
    try {
      let receipt: Awaited<ReturnType<typeof owned.witness.publishSealedTerminalIntent>>;
      const gateLock = await manager.acquireGateLock("gate-1");
      if (gateLock === "occupied") throw new Error("fixture gate lock occupied");
      try {
        await owned.witness.prepareTerminalIntentPublication(
          {
            intents: [terminal],
            terminalTransitionOperationId: "terminal-1",
            publication: publication.input,
          },
          publication.bytes,
        );
        receipt = await owned.witness.publishSealedTerminalIntent({
          closingSealOperationId: "seal-close-1",
          authorizeSealedReceipt: owned.approve,
        });
        expect(receipt.payload.closingSealOperationId).toBe("seal-close-1");
        expect(receipt.payload.publicationId).toBe("publication-2");
        expect(receipt.payload.nativeEffectDisposition).toBe("NO_EFFECT");
        expect(receipt.payload.preSealTargetHead).toMatch(/^[a-f0-9]{64}$/);
        expect(receipt.payload.postSealTargetHead).toBe(receipt.payload.preSealTargetHead);
        await expect(
          owned.witness.publishSealedTerminalIntent({
            closingSealOperationId: "seal-close-1",
            authorizeSealedReceipt: owned.approve,
          }),
        ).resolves.toEqual(receipt);
      } finally {
        gateLock.release();
      }
      const digest = publication.input.newTailDigest;
      const sealed = await owned.witness.verifyClosingSeal({
        closingSealOperationId: "seal-close-1",
        preparedEventDigest: digest,
      });
      if (sealed.sealedReceiptDigest === null) throw new Error("sealed receipt digest missing");
      expect(sealed.sealedReceiptDigest).toBe(
        computeCanonicalJsonFingerprint({ payload: receipt.payload, signature: receipt.signature }),
      );
      expect(await owned.witness.classifyPreparedPublication("publication-2")).toBe("committed");
      const heads = (await owned.witness.readWorkspaceScopeFrontier()).writerHeads;
      expect(heads[heads.length - 1]?.sequence).toBe(2);
      await rm(join(owned.directory, `sealed-receipt-${sealed.sealedReceiptDigest}.json`));
      await expect(
        owned.witness.verifyClosingSeal({
          closingSealOperationId: "seal-close-1",
          preparedEventDigest: digest,
        }),
      ).rejects.toThrow("receipt_lost");
    } finally {
      owned.witness.close();
      manager.close();
      await rm(owned.sandbox, { recursive: true, force: true });
    }
  });
  it("recovers a prepared terminal intent publication after a seal-before-witness crash", async () => {
    const { manager, owned, terminal, publication } = await createSealedCloseFixture();
    try {
      const gateLock = await manager.acquireGateLock("gate-1");
      if (gateLock === "occupied") throw new Error("fixture gate lock occupied");
      try {
        expect(
          await owned.witness.prepareTerminalIntentPublication(
            {
              intents: [terminal],
              terminalTransitionOperationId: "terminal-1",
              publication: publication.input,
            },
            publication.bytes,
          ),
        ).toBe("prepared");
      } finally {
        gateLock.release();
      }
      const receipt = await owned.witness.recoverPreparedTerminalIntentPublication({
        closingSealOperationId: "seal-close-1",
        authorizeSealedReceipt: owned.approve,
      });
      expect(receipt.payload.publicationId).toBe("publication-2");
      expect(await owned.witness.classifyPreparedPublication("publication-2")).toBe("committed");
      await expect(
        owned.witness.recoverPreparedTerminalIntentPublication({
          closingSealOperationId: "seal-close-1",
          authorizeSealedReceipt: owned.approve,
        }),
      ).resolves.toEqual(receipt);
      const sealed = await owned.witness.verifyClosingSeal({
        closingSealOperationId: "seal-close-1",
        preparedEventDigest: publication.input.newTailDigest,
      });
      expect(sealed.sealedReceiptDigest).not.toBeNull();
    } finally {
      owned.witness.close();
      manager.close();
      await rm(owned.sandbox, { recursive: true, force: true });
    }
  });
});
