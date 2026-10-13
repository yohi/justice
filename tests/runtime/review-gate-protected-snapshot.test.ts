import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import { computeCanonicalJsonFingerprint } from "../../src/core/review-gate/identity.js";
import { readProtectedSnapshot } from "../../src/runtime/review-gate-protected-snapshot.js";
import type { ProtectedWitnessStore } from "../../src/runtime/review-gate-protected-store.js";

describe("readProtectedSnapshot", () => {
  it("verifies only revisions newer than its last verified in-memory head", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "justice-protected-snapshot-"));
    const records = new Map<string, unknown>();
    const revisionReads = new Map<number, number>();
    const payloadSchema = z.object({ count: z.number() });
    const store = {
      directory,
      readJson: vi.fn(async <T>(name: string): Promise<T> => {
        const value = records.get(name);
        if (value === undefined) throw new Error(`missing fixture record: ${name}`);
        const revisionMatch = /^scope-(\d+)\.json$/u.exec(name);
        if (revisionMatch?.[1] !== undefined) {
          const revision = Number(revisionMatch[1]);
          revisionReads.set(revision, (revisionReads.get(revision) ?? 0) + 1);
        }
        return value as T;
      }),
      writeJson: vi.fn(async (name: string, value: unknown): Promise<void> => {
        records.set(name, value);
      }),
    } as unknown as ProtectedWitnessStore;

    const addRevision = async (revision: number, previousHash: string): Promise<string> => {
      const contents = { revision, previousHash, data: { count: revision } };
      const hash = computeCanonicalJsonFingerprint(contents);
      records.set(`scope-${revision}.json`, { ...contents, hash });
      await writeFile(path.join(directory, `scope-${revision}.json`), "");
      records.set("scope-head.json", { revision, hash });
      return hash;
    };

    try {
      let previousHash = "0".repeat(64);
      for (let revision = 0; revision < 12; revision += 1) {
        previousHash = await addRevision(revision, previousHash);
      }
      await readProtectedSnapshot(store, "scope", payloadSchema);
      expect(revisionReads.get(0)).toBe(1);

      await readProtectedSnapshot(store, "scope", payloadSchema);
      expect(revisionReads.get(0)).toBe(1);
      expect(revisionReads.get(11)).toBe(2);

      const nextHash = await addRevision(12, previousHash);
      await readProtectedSnapshot(store, "scope", payloadSchema);
      expect(revisionReads.get(11)).toBe(2);
      expect(revisionReads.get(12)).toBe(1);
      expect(records.get("scope-head.json")).toMatchObject({ revision: 12, hash: nextHash });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
