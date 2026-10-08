import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

export interface ReviewGateRecoveryStore {
  readonly publish: (digest: string, bytes: Buffer) => Promise<"created" | "exists">;
  readonly read: (digest: string) => Promise<Buffer | null>;
  readonly list: () => Promise<readonly string[]>;
  readonly close: () => void;
}

const DIGEST_REGEX = /^[a-f0-9]{64}$/u;

/**
 * Create a content-addressed recovery object store under
 * `.justice/review-gates/recovery/` inside the workspace root.
 * Publications are atomic (temp file + rename) and keyed by the caller-supplied
 * digest; the store also validates that the digest matches the bytes.
 */
export function createReviewGateRecoveryStore(workspaceRoot: string): ReviewGateRecoveryStore {
  const recoveryDir = join(workspaceRoot, ".justice", "review-gates", "recovery");
  let closed = false;

  const digestPath = (digest: string): string => join(recoveryDir, digest);

  const computeDigest = (bytes: Uint8Array): string =>
    createHash("sha256").update(bytes).digest("hex");

  const validateDigest = (digest: string): void => {
    if (!DIGEST_REGEX.test(digest)) {
      throw new Error("review_gate_invalid_digest");
    }
  };

  const assertOpen = (): void => {
    if (closed) {
      throw new Error("review_gate_recovery_store_closed");
    }
  };

  const atomicWrite = (targetPath: string, bytes: Uint8Array): void => {
    const tmp = `${targetPath}.tmp`;
    writeFileSync(tmp, bytes);
    renameSync(tmp, targetPath);
  };

  return {
    publish: async (digest, bytes) => {
      assertOpen();
      validateDigest(digest);
      const actual = computeDigest(bytes);
      if (digest !== actual) {
        throw new Error("review_gate_recovery_digest_mismatch");
      }
      mkdirSync(recoveryDir, { recursive: true });
      const targetPath = digestPath(digest);
      if (existsSync(targetPath)) {
        const existing = readFileSync(targetPath);
        if (!existing.equals(bytes)) {
          throw new Error("review_gate_recovery_collision");
        }
        return "exists";
      }
      atomicWrite(targetPath, bytes);
      return "created";
    },
    read: async (digest) => {
      assertOpen();
      validateDigest(digest);
      const targetPath = digestPath(digest);
      if (!existsSync(targetPath)) return null;
      return Buffer.from(readFileSync(targetPath));
    },
    list: async () => {
      assertOpen();
      if (!existsSync(recoveryDir)) return [];
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      return import("node:fs").then(({ readdirSync }) => readdirSync(recoveryDir).sort());
    },
    close: () => {
      closed = true;
    },
  };
}
