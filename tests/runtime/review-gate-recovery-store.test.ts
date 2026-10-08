import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createReviewGateRecoveryStore } from "../../src/runtime/review-gate-recovery-store";

const tempRoots: string[] = [];

afterAll(async () => {
  for (const root of tempRoots) {
    await rm(root, { recursive: true, force: true });
  }
});

async function freshRoot(): Promise<string> {
  const root = await mkdtemp(`${tmpdir()}/justice-task12a-recovery-`);
  tempRoots.push(root);
  return root;
}

const SAMPLE_BYTES = Buffer.from([0, 1, 2, 250, 255]);
const DIGEST_OK = createHash("sha256").update(SAMPLE_BYTES).digest("hex");
const OTHER_BYTES = Buffer.from("other");
const DIGEST_OTHER = createHash("sha256").update(OTHER_BYTES).digest("hex");

describe("ReviewGateRecoveryStore — CAS blob publication (RO1 interim layout)", () => {
  it("publishes bytes by digest under .justice/review-gates/recovery/", async () => {
    const root = await freshRoot();
    const store = createReviewGateRecoveryStore(root);

    expect(await store.publish(DIGEST_OK, SAMPLE_BYTES)).toBe("created");

    const recoveryDir = path.join(root, ".justice", "review-gates", "recovery");
    expect(await readdir(recoveryDir)).toContain(DIGEST_OK);
    expect(Buffer.from(await readFile(path.join(recoveryDir, DIGEST_OK))).toString("hex")).toBe(
      SAMPLE_BYTES.toString("hex"),
    );
    store.close();
  });

  it("returns exists for a repeated publish of the same digest", async () => {
    const root = await freshRoot();
    const store = createReviewGateRecoveryStore(root);

    await store.publish(DIGEST_OK, SAMPLE_BYTES);
    expect(await store.publish(DIGEST_OK, SAMPLE_BYTES)).toBe("exists");
    expect(await store.read(DIGEST_OK)).toEqual(SAMPLE_BYTES);
    store.close();
  });

  it("keeps a stored blob byte-exact and immutable across instances", async () => {
    const root = await freshRoot();
    const first = createReviewGateRecoveryStore(root);
    await first.publish(DIGEST_OK, SAMPLE_BYTES);
    first.close();

    const second = createReviewGateRecoveryStore(root);
    expect(await second.read(DIGEST_OK)).toEqual(SAMPLE_BYTES);
    // CAS: a conflicting publish never overwrites existing bytes
    await expect(second.publish(DIGEST_OK, Buffer.from("conflict"))).rejects.toThrow(
      "review_gate_recovery_digest_mismatch",
    );
    expect(await second.read(DIGEST_OK)).toEqual(SAMPLE_BYTES);
    second.close();
  });

  it("rejects stored bytes whose digest does not match the requested key", async () => {
    const root = await freshRoot();
    const recoveryDir = path.join(root, ".justice", "review-gates", "recovery");
    await mkdir(recoveryDir, { recursive: true });
    await writeFile(path.join(recoveryDir, DIGEST_OK), OTHER_BYTES);
    const store = createReviewGateRecoveryStore(root);
    await expect(store.read(DIGEST_OK)).rejects.toThrow("review_gate_recovery_digest_mismatch");
    store.close();
  });

  it("reads a missing digest as null", async () => {
    const store = createReviewGateRecoveryStore(await freshRoot());
    expect(await store.read(DIGEST_OTHER)).toBeNull();
    store.close();
  });

  it("lists published digests in sorted order", async () => {
    const root = await freshRoot();
    const store = createReviewGateRecoveryStore(root);
    await store.publish(DIGEST_OTHER, OTHER_BYTES);
    await store.publish(DIGEST_OK, SAMPLE_BYTES);

    expect(await store.list()).toEqual([DIGEST_OK, DIGEST_OTHER].sort());
    store.close();
  });

  it("excludes temporary and malformed filenames from the listing", async () => {
    const root = await freshRoot();
    const recoveryDir = path.join(root, ".justice", "review-gates", "recovery");
    await mkdir(recoveryDir, { recursive: true });
    await writeFile(path.join(recoveryDir, "z".repeat(64)), "bad-name");
    await writeFile(path.join(recoveryDir, `${DIGEST_OK}.tmp`), "temporary");
    const store = createReviewGateRecoveryStore(root);
    expect(await store.list()).toEqual([]);
    store.close();
  });

  it("reports a collision without replacing bytes already at the digest path", async () => {
    const root = await freshRoot();
    const recoveryDir = path.join(root, ".justice", "review-gates", "recovery");
    const existingBytes = Buffer.from("corrupt existing bytes");
    await mkdir(recoveryDir, { recursive: true });
    await writeFile(path.join(recoveryDir, DIGEST_OK), existingBytes);
    const store = createReviewGateRecoveryStore(root);
    await expect(store.publish(DIGEST_OK, SAMPLE_BYTES)).rejects.toThrow(
      "review_gate_recovery_collision",
    );
    expect(await readFile(path.join(recoveryDir, DIGEST_OK))).toEqual(existingBytes);
    store.close();
  });

  it.each(["", "/abs/path", "../escape", "ZZZ-not-hex", "9".repeat(65), "a/b"])(
    "rejects invalid digest %j",
    async (digest) => {
      const store = createReviewGateRecoveryStore(await freshRoot());
      await expect(store.publish(digest, Buffer.from("x"))).rejects.toThrow(
        "review_gate_invalid_digest",
      );
      await expect(store.read(digest)).rejects.toThrow("review_gate_invalid_digest");
      store.close();
    },
  );

  it("rejects operations after close", async () => {
    const store = createReviewGateRecoveryStore(await freshRoot());
    store.close();
    store.close(); // idempotent

    const xDigest = createHash("sha256").update(Buffer.from("x")).digest("hex");
    await expect(store.publish(xDigest, Buffer.from("x"))).rejects.toThrow(
      "review_gate_recovery_store_closed",
    );
    await expect(store.read(DIGEST_OK)).rejects.toThrow("review_gate_recovery_store_closed");
    await expect(store.list()).rejects.toThrow("review_gate_recovery_store_closed");
  });

  it("leaves no temporary files behind after publication", async () => {
    const root = await freshRoot();
    const store = createReviewGateRecoveryStore(root);
    const bytesDigest = createHash("sha256").update(Buffer.from("bytes")).digest("hex");
    await store.publish(bytesDigest, Buffer.from("bytes"));

    const recoveryDir = path.join(root, ".justice", "review-gates", "recovery");
    const files = await readdir(recoveryDir);
    expect(files.every((name) => !name.endsWith(".tmp"))).toBe(true);
    store.close();
  });
});
