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

export interface AtomicPersistenceConfig<T> {
  readonly filePath: string;
  readonly conflictPath: string;
  readonly serialize: (data: T) => string;
  readonly deserialize: (raw: string) => T;
  readonly merge: (mine: T, theirs: T) => T;
  readonly emptyValue: () => T;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

interface VersionedEnvelope<T> {
  readonly version: number;
  readonly data: T;
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
  | { readonly status: "rename_conflict" };

const MAX_RETRIES = 3;
const STALE_CLAIM_TIMEOUT_MS = 10_000;

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

    const parsed: unknown = JSON.parse(raw);
    if (isVersionedEnvelope<T>(parsed)) {
      return {
        data: this.config.deserialize(JSON.stringify(parsed.data)),
        lockMeta: { version: parsed.version },
      };
    }
    return { data: this.config.deserialize(raw), lockMeta: { version: 0 } };
  }

  async saveAtomicWithLock(data: T, initialLockMeta?: LockMetadata): Promise<SaveResult> {
    let currentData = data;
    let lockMeta = initialLockMeta;
    let lastReason: ConflictRecord<T>["reason"] = "claim_acquisition_failed";

    try {
      if (lockMeta === undefined) {
        const current = await this.loadWithLock();
        lockMeta = current.lockMeta;
        currentData = this.config.merge(currentData, current.data);
      }

      for (let retry = 0; retry <= MAX_RETRIES; retry += 1) {
        const attempt = await this.runAttempt(currentData, lockMeta, retry);
        if (attempt.status === "saved") return attempt;
        if (attempt.status === "claim_failed") {
          lastReason = "claim_acquisition_failed";
          if (await this.reclaimStaleClaim(attempt.claimPath)) continue;
        } else if (attempt.status === "version_mismatch") {
          lastReason = "version_mismatch";
          currentData = attempt.data;
          lockMeta = attempt.lockMeta;
        } else {
          lastReason = "rename_conflict";
        }
        if (retry < MAX_RETRIES) {
          await this.backoff(retry);
          continue;
        }
        break;
      }

      const conflictPath = await this.divertToConflictFile(currentData, lastReason);
      return { status: "conflict_diverted", retries: MAX_RETRIES, conflictPath };
    } catch (error: unknown) {
      await this.divertToConflictFile(currentData, "rename_conflict").catch(() => undefined);
      console.warn("[JUSTICE] Atomic persistence failed open", error);
      return { status: "conflict_diverted", retries: MAX_RETRIES, conflictPath: this.config.conflictPath };
    }
  }

  private async runAttempt(
    currentData: T,
    lockMeta: LockMetadata,
    retry: number,
  ): Promise<AttemptResult<T>> {
    const tmpPath = `${this.config.filePath}.tmp.${randomUUID()}`;
    const claimPath = `${this.config.filePath}.commit-pending`;
    const envelope: VersionedEnvelope<T> = {
      version: lockMeta.version + 1,
      data: JSON.parse(this.config.serialize(currentData)) as T,
    };
    await this.fileWriter.writeFile(tmpPath, JSON.stringify(envelope, null, 2));

    if (!(await this.claim(tmpPath, claimPath))) {
      await this.cleanup(tmpPath);
      return { status: "claim_failed", claimPath };
    }

    try {
      const latest = await this.loadWithLock();
      if (latest.lockMeta.version !== lockMeta.version) {
        await this.cleanup(claimPath);
        await this.cleanup(tmpPath);
        return {
          status: "version_mismatch",
          data: this.config.merge(currentData, latest.data),
          lockMeta: latest.lockMeta,
        };
      }
      await this.fileWriter.rename(claimPath, this.config.filePath);
      await this.cleanup(tmpPath);
      return { status: "saved", retries: retry };
    } catch {
      await this.cleanup(claimPath);
      await this.cleanup(tmpPath);
      return { status: "rename_conflict" };
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
    await this.fileWriter.rename(tmpPath, claimPath);
    return true;
  }

  private async reclaimStaleClaim(claimPath: string): Promise<boolean> {
    const stats = await this.fileReader.readFileStats(claimPath);
    if (stats === null || Date.now() - stats.mtimeMs <= STALE_CLAIM_TIMEOUT_MS) return false;
    await this.cleanup(claimPath);
    return true;
  }

  private async divertToConflictFile(
    data: T,
    reason: ConflictRecord<T>["reason"],
  ): Promise<string> {
    try {
      const conflicts: ConflictRecord<T>[] = [];
      if (await this.fileReader.fileExists(this.config.conflictPath)) {
        const parsed: unknown = JSON.parse(await this.fileReader.readFile(this.config.conflictPath));
        if (isConflictFile<T>(parsed)) conflicts.push(...parsed.conflicts);
      }
      conflicts.push({ version: 1, reason, data, recordedAt: new Date().toISOString() });
      const tmpPath = `${this.config.conflictPath}.tmp.${randomUUID()}`;
      await this.fileWriter.writeFile(tmpPath, JSON.stringify({ version: 1, conflicts }, null, 2));
      await this.fileWriter.rename(tmpPath, this.config.conflictPath);
    } catch (error: unknown) {
      console.warn("[JUSTICE] Atomic persistence conflict diversion failed", error);
    }
    return this.config.conflictPath;
  }

  private async cleanup(path: string): Promise<void> {
    await this.fileWriter.deleteFile(path).catch(() => undefined);
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
  return value instanceof Error && "code" in value && (value as NodeJS.ErrnoException).code === code;
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
