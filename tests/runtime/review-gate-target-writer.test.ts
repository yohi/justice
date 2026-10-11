import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { VerifiedTargetWriterHandoffIntentV1 } from "../../src/core/review-gate/types.js";
import {
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
});
