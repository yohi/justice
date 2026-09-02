import { randomInt, randomUUID } from "node:crypto";
import type { FileReader, FileWriter } from "./types";

export interface LockMetadata {
  readonly version: number;
}

export interface SaveResult {
  readonly status: "saved" | "conflict_diverted";
  readonly retries: number;
  readonly conflictPath?: string;
}

export interface AtomicPersistenceLogger {
  warn(message: string, ...args: unknown[]): void;
}

export interface AtomicPersistenceConfig<T> {
  readonly filePath: string;
  readonly conflictPath: string;
  readonly serialize: (data: T) => string;
  readonly deserialize: (raw: string) => T;
  readonly merge: (mine: T, theirs: T) => T;
  readonly emptyValue: () => T;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly logger?: AtomicPersistenceLogger;
}

interface VersionedEnvelope<T> {
  readonly version: number;
  readonly data: T;
  readonly claimId?: string;
}

interface ConflictRecord<T> {
  readonly version: 1;
  readonly reason: "version_mismatch" | "claim_acquisition_failed" | "rename_conflict";
  readonly data: T;
  readonly recordedAt: string;
}

interface ConflictFile<T> {
  readonly version: 1;
  readonly conflicts: readonly ConflictRecord<T>[];
}

type AttemptResult<T> =
  | { readonly status: "saved"; readonly retries: number }
  | { readonly status: "claim_failed"; readonly claimPath: string }
  | {
      readonly status: "version_mismatch";
      readonly data: T;
      readonly lockMeta: LockMetadata;
    }
  | { readonly status: "claim_lost" }
  | { readonly status: "rename_conflict" };

const MAX_RETRIES = 3;
const STALE_CLAIM_TIMEOUT_MS = 10_000;
const MAX_CONFLICT_RECORDS = 50;

export class AtomicPersistence<T> {
  constructor(
    private readonly fileReader: FileReader,
    private readonly fileWriter: FileWriter,
    private readonly config: AtomicPersistenceConfig<T>,
  ) {}

  async loadWithLock(): Promise<{ readonly data: T; readonly lockMeta: LockMetadata }> {
    let raw: string;
    try {
      raw = await this.fileReader.readFile(this.config.filePath);
    } catch (error: unknown) {
      if (isErrno(error, "ENOENT")) {
        return { data: this.config.emptyValue(), lockMeta: { version: 0 } };
      }
      throw error instanceof Error ? error : new Error(String(error), { cause: error });
    }

    if (raw.trim().length === 0) {
      return { data: this.config.emptyValue(), lockMeta: { version: 0 } };
    }

    try {
      const parsed: unknown = JSON.parse(raw);
      if (isVersionedEnvelope<T>(parsed)) {
        return {
          data: this.config.deserialize(JSON.stringify(parsed.data)),
          lockMeta: { version: parsed.version },
        };
      }
      return { data: this.config.deserialize(raw), lockMeta: { version: 0 } };
    } catch {
      return { data: this.config.emptyValue(), lockMeta: { version: 0 } };
    }
  }

  async saveAtomicWithLock(data: T, initialLockMeta?: LockMetadata): Promise<SaveResult> {
    let currentData = data;
    let lockMeta = initialLockMeta;
    let lastReason: ConflictRecord<T>["reason"] = "claim_acquisition_failed";
    let retry = 0;

    try {
      if (lockMeta === undefined) {
        const current = await this.loadWithLock();
        lockMeta = current.lockMeta;
        currentData = this.config.merge(currentData, current.data);
      }

      let attemptCount = 0;
      while (attemptCount <= MAX_RETRIES) {
        const attempt = await this.runAttempt(currentData, lockMeta, retry);
        attemptCount += 1;
        if (attempt.status === "saved") return attempt;
        if (attempt.status === "claim_failed") {
          lastReason = "claim_acquisition_failed";
          if ((await this.reclaimStaleClaim(attempt.claimPath)) && attemptCount <= MAX_RETRIES) {
            continue;
          }
        } else if (attempt.status === "version_mismatch") {
          lastReason = "version_mismatch";
          currentData = attempt.data;
          lockMeta = attempt.lockMeta;
        } else if (attempt.status === "claim_lost") {
          lastReason = "rename_conflict";
        } else {
          lastReason = "rename_conflict";
        }
        if (retry < MAX_RETRIES) {
          await this.backoff(retry);
          retry += 1;
          continue;
        }
        break;
      }

      const conflictPath = await this.divertToConflictFile(currentData, lastReason);
      return { status: "conflict_diverted", retries: retry, conflictPath };
    } catch (error: unknown) {
      await this.divertToConflictFile(currentData, lastReason).catch(() => undefined);
      this.warn("[JUSTICE] Atomic persistence failed open", error);
      return {
        status: "conflict_diverted",
        retries: retry,
        conflictPath: this.config.conflictPath,
      };
    }
  }

  private async runAttempt(
    currentData: T,
    lockMeta: LockMetadata,
    retry: number,
  ): Promise<AttemptResult<T>> {
    const tmpPath = `${this.config.filePath}.tmp.${randomUUID()}`;
    const claimPath = `${this.config.filePath}.commit-pending`;
    const claimId = randomUUID();
    const envelope: VersionedEnvelope<T> = {
      version: lockMeta.version + 1,
      data: JSON.parse(this.config.serialize(currentData)) as T,
      claimId,
    };

    try {
      await this.fileWriter.writeFile(tmpPath, JSON.stringify(envelope, null, 2));

      if (!(await this.claim(tmpPath, claimPath))) {
        return { status: "claim_failed", claimPath };
      }

      try {
        const latest = await this.loadWithLock();
        if (!(await this.claimIsOwned(claimPath, claimId))) {
          return { status: "claim_lost" };
        }
        if (latest.lockMeta.version !== lockMeta.version) {
          await this.cleanup(claimPath);
          return {
            status: "version_mismatch",
            data: this.config.merge(currentData, latest.data),
            lockMeta: latest.lockMeta,
          };
        }
        await this.fileWriter.rename(claimPath, this.config.filePath);
        return { status: "saved", retries: retry };
      } catch {
        if (await this.claimIsOwned(claimPath, claimId)) {
          await this.cleanup(claimPath);
        }
        return { status: "rename_conflict" };
      }
    } finally {
      await this.cleanup(tmpPath);
    }
  }

  private async claim(tmpPath: string, claimPath: string): Promise<boolean> {
    if (this.fileWriter.link) {
      try {
        await this.fileWriter.link(tmpPath, claimPath);
        return true;
      } catch (error: unknown) {
        if (isErrno(error, "EEXIST")) return false;
        throw error instanceof Error ? error : new Error(String(error), { cause: error });
      }
    }
    throw new Error("Atomic claim requires FileWriter.link for exclusive persistence");
  }

  private async reclaimStaleClaim(claimPath: string): Promise<boolean> {
    const stats = await this.fileReader.readFileStats(claimPath);
    if (stats === null || Date.now() - stats.mtimeMs <= STALE_CLAIM_TIMEOUT_MS) return false;
    await this.cleanup(claimPath);
    return true;
  }

  private async claimIsOwned(claimPath: string, claimId: string): Promise<boolean> {
    try {
      const parsed: unknown = JSON.parse(await this.fileReader.readFile(claimPath));
      return isVersionedEnvelope(parsed) && parsed.claimId === claimId;
    } catch {
      return false;
    }
  }

  private async divertToConflictFile(
    data: T,
    reason: ConflictRecord<T>["reason"],
  ): Promise<string> {
    const tmpPath = `${this.config.conflictPath}.tmp.${randomUUID()}`;
    try {
      const conflicts: ConflictRecord<T>[] = [];
      if (await this.fileReader.fileExists(this.config.conflictPath)) {
        const parsed: unknown = JSON.parse(
          await this.fileReader.readFile(this.config.conflictPath),
        );
        if (isConflictFile<T>(parsed)) conflicts.push(...parsed.conflicts);
      }
      conflicts.push({ version: 1, reason, data, recordedAt: new Date().toISOString() });
      const retained = conflicts.slice(-MAX_CONFLICT_RECORDS);
      await this.fileWriter.writeFile(
        tmpPath,
        JSON.stringify({ version: 1, conflicts: retained }, null, 2),
      );
      await this.fileWriter.rename(tmpPath, this.config.conflictPath);
    } catch (error: unknown) {
      this.warn("[JUSTICE] Atomic persistence conflict diversion failed", error);
    } finally {
      await this.cleanup(tmpPath);
    }
    return this.config.conflictPath;
  }

  private async cleanup(path: string): Promise<void> {
    await this.fileWriter.deleteFile(path).catch(() => undefined);
  }

  private warn(message: string, ...args: unknown[]): void {
    try {
      this.config.logger?.warn(message, ...args);
    } catch {
      void 0;
    }
  }

  private async backoff(retry: number): Promise<void> {
    const sleep =
      this.config.sleep ??
      ((milliseconds: number): Promise<void> =>
        new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
    await sleep(100 * 2 ** retry + randomInt(0, 50));
  }
}

function isErrno(value: unknown, code: string): boolean {
  return (
    value instanceof Error && "code" in value && (value as NodeJS.ErrnoException).code === code
  );
}

function isVersionedEnvelope<T>(value: unknown): value is VersionedEnvelope<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { version?: unknown }).version === "number" &&
    "data" in value
  );
}

function isConflictFile<T>(value: unknown): value is ConflictFile<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { version?: unknown }).version === 1 &&
    Array.isArray((value as { conflicts?: unknown }).conflicts)
  );
}
