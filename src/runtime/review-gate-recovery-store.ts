import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";

export interface ReviewGateRecoveryStore {
  readonly publish: (digest: string, bytes: Buffer) => Promise<"created" | "exists">;
  readonly read: (digest: string) => Promise<Buffer | null>;
  readonly list: () => Promise<readonly string[]>;
  readonly close: () => void;
}

const DIGEST_REGEX = /^[a-f0-9]{64}$/u;

/** Durable recovery-object layout, relative to the workspace root (Task 13/14 display). */
export const REVIEW_GATE_RECOVERY_DIR = ".justice/review-gates/recovery";

/** The recovery base directory name inside `.justice/review-gates/`. */
export const REVIEW_GATE_RECOVERY_NAMESPACE = "recovery";

/**
 * Create a content-addressed recovery object store under
 * `.justice/review-gates/recovery/` inside the workspace root.
 * Publications are atomic (unique temp file + no-replace link) and keyed by the caller-supplied
 * digest; the store also validates that the digest matches the bytes.
 */
export function createReviewGateRecoveryStore(workspaceRoot: string): ReviewGateRecoveryStore {
  const recoveryDir = join(workspaceRoot, ".justice", "review-gates", REVIEW_GATE_RECOVERY_NAMESPACE);
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

  const atomicWrite = (targetPath: string, bytes: Uint8Array): "created" | "exists" => {
    const tmp = `${targetPath}.${randomUUID()}.tmp`;
    try {
      writeFileSync(tmp, bytes, { flag: "wx" });
      linkSync(tmp, targetPath);
      return "created";
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") return "exists";
      throw error;
    } finally {
      rmSync(tmp, { force: true });
    }
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
      const publication = atomicWrite(targetPath, bytes);
      if (publication === "exists") {
        const existing = readFileSync(targetPath);
        if (!existing.equals(bytes)) throw new Error("review_gate_recovery_collision");
      }
      return publication;
    },
    read: async (digest) => {
      assertOpen();
      validateDigest(digest);
      const targetPath = digestPath(digest);
      if (!existsSync(targetPath)) return null;
      const bytes = Buffer.from(readFileSync(targetPath));
      if (computeDigest(bytes) !== digest) {
        throw new Error("review_gate_recovery_digest_mismatch");
      }
      return bytes;
    },
    list: async () => {
      assertOpen();
      if (!existsSync(recoveryDir)) return [];
      return readdirSync(recoveryDir)
        .filter((name) => DIGEST_REGEX.test(name))
        .sort();
    },
    close: () => {
      closed = true;
    },
  };
}
