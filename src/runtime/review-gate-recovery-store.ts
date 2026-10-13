import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID, type KeyObject } from "node:crypto";
import { z } from "zod";
import { computeArtifactDigest } from "../core/review-gate/identity";
import { ProtectedWitnessStore, WitnessBlocked } from "./review-gate-protected-store";
import { readTrustedWitnessInstallation } from "./review-gate-witness-installation";
import {
  scopeIdentitySchema,
  scopeInstallationIdSchema,
} from "./review-gate-witness-verification";

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

/**
 * Task 6 (PLAN-017/PLAN-025) — protected private raw response custody.
 *
 * The workspace `.justice/review-gates/recovery/` object store above keeps its
 * legacy/commit recovery contract and is never trusted with raw sensitive
 * worker output. `PrivateRawResponseStoreV1` lives instead in the Task 5
 * independently host-protected installation namespace OUTSIDE the mutable
 * workspace: every operation authenticates the trusted installation of the
 * protected directory and runs under its checked owner/ACL discipline
 * (directory mode 0700, files mode 0600, no symlink/hardlink/unsafe parent,
 * O_NOFOLLOW, file + directory fsync). Raw bytes are published immutable and
 * content-addressed, quota reservations are persisted in a protected CAS
 * ledger so they survive restarts, and stored bytes are never truncated,
 * replaced, silently retried or budget-reset. Event payloads only ever carry
 * the bounded `PrivateResponseEvidenceV1` reference.
 */

/** Lifecycle of one private raw response record (PLAN-025). */
export type PrivateRawResponseStatusV1 =
  | "STAGED"
  | "RESULT_COMMITTED_PENDING_APPLY"
  | "FULLY_APPLIED"
  | "TOMBSTONED";

/**
 * One durable private raw response record. Contains only bounded, event-safe
 * references — never raw response bytes or private filesystem paths.
 */
export type PrivateRawResponseRecordV1 = Readonly<{
  readonly operationId: string;
  readonly dispatchAttemptId: string;
  readonly gateId: string;
  readonly status: PrivateRawResponseStatusV1;
  readonly contentDigest: string;
  readonly byteLength: number;
  readonly policyVersion: 1;
}>;

/**
 * Bounded non-secret event-safe reference for event payloads (PLAN-025):
 * never the raw worker response, never a private filesystem path.
 */
export type PrivateResponseEvidenceV1 = Readonly<{
  readonly operationId: string;
  readonly dispatchAttemptId: string;
  readonly contentDigest: string;
  readonly byteLength: number;
  readonly privateStoreRecordId: string;
  readonly policyVersion: 1;
}>;

/** Versioned quota/failure policy (PLAN-025). */
export type PrivateResponseRetentionPolicyV1 = Readonly<{
  readonly maxResponseBytes: number;
  readonly maxPendingPerGateBytes: number;
  readonly maxPendingPerInstallationBytes: number;
}>;

/** Plan-mandated retention defaults: 4 MiB / 64 MiB pending / 512 MiB pending. */
export const PRIVATE_RESPONSE_RETENTION_POLICY_DEFAULTS: PrivateResponseRetentionPolicyV1 =
  Object.freeze({
    maxResponseBytes: 4 * 1024 * 1024,
    maxPendingPerGateBytes: 64 * 1024 * 1024,
    maxPendingPerInstallationBytes: 512 * 1024 * 1024,
  });

export interface PrivateRawResponseStoreV1 {
  /** Stage one complete raw response under atomic persisted quota reservation. */
  readonly stage: (
    input: Readonly<{
      readonly operationId: string;
      readonly dispatchAttemptId: string;
      readonly gateId: string;
      readonly bytes: Uint8Array;
    }>,
  ) => Promise<Readonly<{ record: PrivateRawResponseRecordV1; evidence: PrivateResponseEvidenceV1 }>>;
  /** Authenticated byte-complete read; never a worker-readable surface. */
  readonly readExact: (
    operationId: string,
    dispatchAttemptId: string,
  ) => Promise<Readonly<{ bytes: Buffer; record: PrivateRawResponseRecordV1 }> | null>;
  /** Mark the response's result event as committed, application pending. */
  readonly markResultCommittedPendingApply: (
    operationId: string,
    dispatchAttemptId: string,
  ) => Promise<PrivateRawResponseRecordV1>;
  /** Mark the authoritative outcome as fully applied. */
  readonly markFullyApplied: (
    operationId: string,
    dispatchAttemptId: string,
  ) => Promise<PrivateRawResponseRecordV1>;
  /**
   * Durable tombstone followed by unlink + fsync of the exact byte object.
   * Allowed only from FULLY_APPLIED; idempotent across the crash window.
   */
  readonly tombstoneAndCollect: (
    operationId: string,
    dispatchAttemptId: string,
  ) => Promise<"collected" | "already_collected">;
  readonly close: () => void;
}

const privateResponseRecordSchema = z
  .strictObject({
    operationId: scopeInstallationIdSchema,
    dispatchAttemptId: scopeInstallationIdSchema,
    gateId: scopeInstallationIdSchema,
    status: z.enum(["STAGED", "RESULT_COMMITTED_PENDING_APPLY", "FULLY_APPLIED", "TOMBSTONED"]),
    contentDigest: scopeIdentitySchema,
    byteLength: z.number().int().positive(),
    policyVersion: z.literal(1),
  })
  .readonly();
const privateResponseLedgerSchema = z
  .strictObject({
    records: z.record(
      z.string().regex(/^[A-Za-z0-9_-]{1,128}:[A-Za-z0-9_-]{1,128}$/u),
      privateResponseRecordSchema,
    ),
  })
  .readonly();
type PrivateResponseLedger = z.infer<typeof privateResponseLedgerSchema>;
type LedgerSnapshot = Readonly<{
  readonly data: PrivateResponseLedger;
  readonly hash: string;
  readonly revision: number;
}>;

const privateResponseRecordKey = (operationId: string, dispatchAttemptId: string): string =>
  `${operationId}:${dispatchAttemptId}`;

const pendingStatuses: readonly PrivateRawResponseStatusV1[] = [
  "STAGED",
  "RESULT_COMMITTED_PENDING_APPLY",
];

const evidenceOf = (record: PrivateRawResponseRecordV1): PrivateResponseEvidenceV1 =>
  Object.freeze({
    operationId: record.operationId,
    dispatchAttemptId: record.dispatchAttemptId,
    contentDigest: record.contentDigest,
    byteLength: record.byteLength,
    privateStoreRecordId: privateResponseRecordKey(
      record.operationId,
      record.dispatchAttemptId,
    ),
    policyVersion: 1,
  });

/**
 * Create the protected private raw response store in the Task 5 installation
 * namespace (`witnessDirectory`). The directory must already be provisioned
 * and host-protected; a missing, untrusted or unreadable installation fails
 * every operation closed with `review_gate_response_evidence_unavailable`
 * instead of degrading custody.
 */
export function createPrivateRawResponseStore(
  witnessDirectory: string,
  policy: PrivateResponseRetentionPolicyV1 = PRIVATE_RESPONSE_RETENTION_POLICY_DEFAULTS,
  hostTrustRoot?: KeyObject,
): PrivateRawResponseStoreV1 {
  if (
    policy.maxResponseBytes <= 0 ||
    policy.maxPendingPerGateBytes <= 0 ||
    policy.maxPendingPerInstallationBytes <= 0
  ) {
    throw new Error("review_gate_response_evidence_policy_invalid");
  }
  const store = new ProtectedWitnessStore(witnessDirectory);
  let closed = false;

  const assertOpen = (): void => {
    if (closed) throw new Error("review_gate_response_evidence_unavailable");
  };

  /** Absent, untrusted or unreadable protected witness ⇒ custody unavailable. */
  const authenticate = async (): Promise<void> => {
    try {
      await readTrustedWitnessInstallation(store, hostTrustRoot);
    } catch (error: unknown) {
      throw new Error("review_gate_response_evidence_unavailable", { cause: error });
    }
  };

  /**
   * Read-only ledger probe: an uninitialized namespace has no records.
   */
  const tryReadLedger = async (): Promise<LedgerSnapshot | null> => {
    if (!existsSync(join(witnessDirectory, "private-response-head.json"))) return null;
    return store.read("private-response", privateResponseLedgerSchema);
  };

  /**
   * Read the reservation ledger, creating the namespace exactly once. A
   * ledger that exists but does not parse is never reinitialized: the read
   * error propagates and every operation fails closed.
   */
  const readLedger = async (): Promise<LedgerSnapshot> => {
    if (!existsSync(join(witnessDirectory, "private-response-head.json"))) {
      await store.initialize("private-response", { records: {} });
    }
    return store.read("private-response", privateResponseLedgerSchema);
  };

  const bytesName = (digest: string): string => `private-response-${digest}.bin`;

  /** Unlink one byte object then fsync the protected directory (durable GC). */
  const unlinkBytesAndSync = (digest: string): void => {
    try {
      unlinkSync(join(witnessDirectory, bytesName(digest)));
    } catch (err: unknown) {
      if (!(err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT"))
        throw err;
    }
    const directory = openSync(witnessDirectory, "r");
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
  };

  const hasOtherLiveReference = (
    ledger: PrivateResponseLedger,
    recordKey: string,
    digest: string,
  ): boolean => Object.entries(ledger.records).some(
    ([key, record]) =>
      key !== recordKey && record.contentDigest === digest && record.status !== "TOMBSTONED",
  );

  const assertIds = (operationId: string, dispatchAttemptId: string): void => {
    if (
      !scopeInstallationIdSchema.safeParse(operationId).success ||
      !scopeInstallationIdSchema.safeParse(dispatchAttemptId).success
    ) {
      throw new Error("review_gate_response_evidence_invalid");
    }
  };

  const findRecord = (
    ledger: PrivateResponseLedger,
    operationId: string,
    dispatchAttemptId: string,
  ): PrivateRawResponseRecordV1 => {
    const record = ledger.records[privateResponseRecordKey(operationId, dispatchAttemptId)];
    if (record === undefined) throw new Error("review_gate_response_evidence_unavailable");
    return record;
  };

  const transition = async (
    operationId: string,
    dispatchAttemptId: string,
    expected: PrivateRawResponseStatusV1,
    next: PrivateRawResponseStatusV1,
  ): Promise<PrivateRawResponseRecordV1> =>
    store.withGuard("private-response", async () => {
      await authenticate();
      const snapshot = await readLedger();
      const record = findRecord(snapshot.data, operationId, dispatchAttemptId);
      if (record.status === next) return record; // idempotent re-mark
      if (record.status !== expected) {
        throw new Error("review_gate_response_evidence_conflict");
      }
      const updated: PrivateRawResponseRecordV1 = Object.freeze({ ...record, status: next });
      await store.advance(
        "private-response",
        snapshot,
        {
          records: {
            ...snapshot.data.records,
            [privateResponseRecordKey(operationId, dispatchAttemptId)]: updated,
          },
        },
      );
      return updated;
    });

  return {
    stage: async (input) => {
      assertOpen();
      if (input === null || typeof input !== "object") {
        throw new Error("review_gate_response_evidence_invalid");
      }
      assertIds(input.operationId, input.dispatchAttemptId);
      if (!scopeInstallationIdSchema.safeParse(input.gateId).success) {
        throw new Error("review_gate_response_evidence_invalid");
      }
      if (!(input.bytes instanceof Uint8Array) || input.bytes.length === 0) {
        throw new Error("review_gate_response_evidence_invalid");
      }
      if (input.bytes.length > policy.maxResponseBytes) {
        throw new Error("review_gate_response_evidence_capacity_exceeded");
      }
      try {
        return await store.withGuard("private-response", async () => {
          await authenticate();
          const snapshot = await readLedger();
          const key = privateResponseRecordKey(input.operationId, input.dispatchAttemptId);
          const existing = snapshot.data.records[key];
          const digest = computeArtifactDigest(input.bytes);
          if (existing !== undefined) {
            // Immutable no-replace custody: identical bytes are idempotent,
            // anything else is a conflicting response and blocks.
            if (existing.status === "TOMBSTONED" || existing.contentDigest !== digest) {
              throw new Error("review_gate_response_evidence_conflict");
            }
            return { record: existing, evidence: evidenceOf(existing) };
          }
          let pendingPerGate = 0;
          let pendingTotal = 0;
          for (const record of Object.values(snapshot.data.records)) {
            if (!pendingStatuses.includes(record.status)) continue;
            pendingTotal += record.byteLength;
            if (record.gateId === input.gateId) pendingPerGate += record.byteLength;
          }
          if (pendingPerGate + input.bytes.length > policy.maxPendingPerGateBytes) {
            throw new Error("review_gate_response_evidence_capacity_exceeded");
          }
          if (pendingTotal + input.bytes.length > policy.maxPendingPerInstallationBytes) {
            throw new Error("review_gate_response_evidence_capacity_exceeded");
          }
          await store.writeBytes(bytesName(digest), input.bytes, true);
          const record: PrivateRawResponseRecordV1 = Object.freeze({
            operationId: input.operationId,
            dispatchAttemptId: input.dispatchAttemptId,
            gateId: input.gateId,
            status: "STAGED",
            contentDigest: digest,
            byteLength: input.bytes.length,
            policyVersion: 1,
          });
          await store.advance("private-response", snapshot, {
            records: { ...snapshot.data.records, [key]: record },
          });
          return { record, evidence: evidenceOf(record) };
        });
      } catch (error: unknown) {
        if (error instanceof WitnessBlocked) {
          throw new Error("review_gate_response_evidence_unavailable", { cause: error });
        }
        throw error;
      }
    },

    readExact: async (operationId, dispatchAttemptId) => {
      assertOpen();
      assertIds(operationId, dispatchAttemptId);
      try {
        await authenticate();
        const snapshot = await tryReadLedger();
        const record = snapshot?.data.records[
          privateResponseRecordKey(operationId, dispatchAttemptId)
        ];
        if (record === undefined) return null;
        if (record.status === "TOMBSTONED") {
          throw new Error("review_gate_response_evidence_unavailable");
        }
        const bytes = await store.readBytes(bytesName(record.contentDigest));
        if (
          bytes.length !== record.byteLength ||
          computeArtifactDigest(bytes) !== record.contentDigest
        ) {
          throw new Error("review_gate_response_evidence_unavailable");
        }
        return { bytes, record };
      } catch (error: unknown) {
        if (error instanceof WitnessBlocked) {
          throw new Error("review_gate_response_evidence_unavailable", { cause: error });
        }
        throw error;
      }
    },

    markResultCommittedPendingApply: async (operationId, dispatchAttemptId) => {
      assertOpen();
      assertIds(operationId, dispatchAttemptId);
      try {
        return await transition(
          operationId,
          dispatchAttemptId,
          "STAGED",
          "RESULT_COMMITTED_PENDING_APPLY",
        );
      } catch (error: unknown) {
        if (error instanceof WitnessBlocked) {
          throw new Error("review_gate_response_evidence_unavailable", { cause: error });
        }
        throw error;
      }
    },

    markFullyApplied: async (operationId, dispatchAttemptId) => {
      assertOpen();
      assertIds(operationId, dispatchAttemptId);
      try {
        return await transition(
          operationId,
          dispatchAttemptId,
          "RESULT_COMMITTED_PENDING_APPLY",
          "FULLY_APPLIED",
        );
      } catch (error: unknown) {
        if (error instanceof WitnessBlocked) {
          throw new Error("review_gate_response_evidence_unavailable", { cause: error });
        }
        throw error;
      }
    },

    tombstoneAndCollect: async (operationId, dispatchAttemptId) => {
      assertOpen();
      assertIds(operationId, dispatchAttemptId);
      try {
        return await store.withGuard("private-response", async () => {
          await authenticate();
          const snapshot = await readLedger();
          const key = privateResponseRecordKey(operationId, dispatchAttemptId);
          const record = snapshot.data.records[key];
          if (record === undefined) {
            throw new Error("review_gate_response_evidence_unavailable");
          }
          if (record.status === "TOMBSTONED") {
            if (!hasOtherLiveReference(snapshot.data, key, record.contentDigest))
              unlinkBytesAndSync(record.contentDigest);
            return "already_collected" as const;
          }
          // Raw bytes are retained while any unfinished application could
          // still reference them: only a FULLY_APPLIED outcome may be GC'd.
          if (record.status !== "FULLY_APPLIED") {
            throw new Error("review_gate_response_evidence_unavailable");
          }
          await store.advance("private-response", snapshot, {
            records: {
              ...snapshot.data.records,
              [key]: { ...record, status: "TOMBSTONED" },
            },
          });
          if (!hasOtherLiveReference(snapshot.data, key, record.contentDigest))
            unlinkBytesAndSync(record.contentDigest);
          return "collected" as const;
        });
      } catch (error: unknown) {
        if (error instanceof WitnessBlocked) {
          throw new Error("review_gate_response_evidence_unavailable", { cause: error });
        }
        throw error;
      }
    },

    close: () => {
      closed = true;
    },
  };
}
