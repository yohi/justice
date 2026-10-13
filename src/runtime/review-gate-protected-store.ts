import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, rename, unlink, readdir } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { computeCanonicalJsonFingerprint } from "../core/review-gate/identity.js";
import { readProtectedSnapshot } from "./review-gate-protected-snapshot.js";

export class WitnessBlocked extends Error {
  constructor(readonly code: string) {
    super(`review_gate_witness_${code}`);
  }
}
export class ProtectedWitnessStore {
  constructor(readonly directory: string) {}
  async checkProtection(): Promise<void> {
    if (
      process.platform !== "linux" ||
      !isAbsolute(this.directory) ||
      resolve(this.directory) !== this.directory
    )
      throw new WitnessBlocked("protection");
    let cursor = this.directory;
    while (true) {
      let stat;
      try {
        stat = await lstat(cursor);
      } catch {
        throw new WitnessBlocked("protection");
      }
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new WitnessBlocked("protection");
      if (
        cursor === this.directory &&
        (stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0)
      )
        throw new WitnessBlocked("protection");
      const parent = dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
  }
  async withGuard<T>(namespace: string, run: () => Promise<T>): Promise<T> {
    await this.checkProtection();
    this.validateName(namespace);
    const lock = await open(
      join(this.directory, `${namespace}.lock`),
      constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      const stat = await lock.stat();
      if (
        !stat.isFile() ||
        stat.nlink !== 1 ||
        stat.uid !== process.getuid?.() ||
        (stat.mode & 0o077) !== 0
      )
        throw new WitnessBlocked("protection");
      const child = spawn(
        "sh",
        [
          "-c",
          "flock --nonblock --conflict-exit-code 75 3 || exit $?; printf 'LOCKED\\n'; read -r release",
        ],
        { stdio: ["pipe", "pipe", "pipe", lock.fd] },
      );
      const exited = new Promise<void>((done) => child.once("close", () => done()));
      const { stdin, stdout } = child;
      if (stdin === null || stdout === null) {
        child.kill();
        throw new WitnessBlocked("lock_unavailable");
      }
      try {
        await new Promise<void>((ready, reject) => {
          child.once("error", () => reject(new WitnessBlocked("lock_unavailable")));
          child.once("exit", (code) =>
            reject(new WitnessBlocked(code === 75 ? "busy_retryable" : "lock_unavailable")),
          );
          stdout.once("data", (data: Buffer) =>
            data.toString() === "LOCKED\n"
              ? ready()
              : reject(new WitnessBlocked("lock_unavailable")),
          );
        });
        await this.checkProtection();
        return await run();
      } finally {
        stdin.end("release\n");
        await exited;
      }
    } finally {
      await lock.close();
    }
  }
  private validateName(name: string): void {
    if (!/^[A-Za-z0-9_.-]{1,200}$/.test(name) || name.includes(".."))
      throw new WitnessBlocked("invalid_storage_key");
  }
  async readBytes(name: string): Promise<Buffer> {
    await this.checkProtection();
    this.validateName(name);
    try {
      const file = await open(
        join(this.directory, name),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        const stat = await file.stat();
        if (
          !stat.isFile() ||
          stat.nlink !== 1 ||
          stat.uid !== process.getuid?.() ||
          (stat.mode & 0o077) !== 0 ||
          stat.size > 8 * 1024 * 1024
        )
          throw new WitnessBlocked("protection");
        return await file.readFile();
      } finally {
        await file.close();
      }
    } catch (error: unknown) {
      if (error instanceof WitnessBlocked) throw error;
      throw new WitnessBlocked("registry_unavailable");
    }
  }
  async removePublicationFiles(retainedNames: ReadonlySet<string>): Promise<void> {
    await this.checkProtection();
    for (const name of await readdir(this.directory)) {
      if ((name.startsWith("stage-") || name.startsWith("journal-")) && !retainedNames.has(name)) {
        await unlink(join(this.directory, name));
      }
    }
    const directory = await open(this.directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
  async readJson<T>(name: string, schema: z.ZodType<T>): Promise<T> {
    try {
      return schema.parse(JSON.parse((await this.readBytes(name)).toString("utf8")));
    } catch (error: unknown) {
      if (error instanceof WitnessBlocked) throw error;
      throw new WitnessBlocked("registry_invalid");
    }
  }
  async writeBytes(name: string, bytes: Uint8Array, immutable = false): Promise<void> {
    await this.checkProtection();
    this.validateName(name);
    const destination = join(this.directory, name);
    const temporary = join(this.directory, `tmp-${randomUUID()}`);
    try {
      const file = await open(
        temporary,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        await file.writeFile(bytes);
        await file.sync();
      } finally {
        await file.close();
      }
      if (immutable) {
        try {
          await link(temporary, destination);
        } catch (error: unknown) {
          if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
          if (!(await this.readBytes(name)).equals(Buffer.from(bytes)))
            throw new WitnessBlocked("durability");
        }
        await unlink(temporary);
      } else {
        await rename(temporary, destination);
      }
      const directory = await open(
        this.directory,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } catch {
      try {
        await unlink(temporary);
      } catch (cleanupError: unknown) {
        if (!(cleanupError instanceof Error && "code" in cleanupError && cleanupError.code === "ENOENT"))
          throw new WitnessBlocked("durability");
      }
      throw new WitnessBlocked("durability");
    }
  }
  async writeJson(name: string, data: unknown, immutable = false): Promise<void> {
    await this.writeBytes(name, Buffer.from(JSON.stringify(data)), immutable);
  }
  async initialize<T>(namespace: string, data: T): Promise<void> {
    const snapshot = { revision: 0, previousHash: "0".repeat(64), data };
    const hash = computeCanonicalJsonFingerprint(snapshot);
    await this.writeJson(`${namespace}-0.json`, { ...snapshot, hash }, true);
    await this.writeJson(`${namespace}-head.json`, { revision: 0, hash });
  }
  async read<T>(
    namespace: string,
    schema: z.ZodType<T>,
  ): Promise<Readonly<{ data: T; hash: string; revision: number }>> {
    return readProtectedSnapshot(this, namespace, schema);
  }
  async advance<T>(
    namespace: string,
    current: Readonly<{ hash: string; revision: number }>,
    data: T,
  ): Promise<string> {
    const snapshot = { revision: current.revision + 1, previousHash: current.hash, data };
    const hash = computeCanonicalJsonFingerprint(snapshot);
    const intent = {
      status: "prepared",
      expected: { revision: current.revision, hash: current.hash },
      next: { revision: snapshot.revision, hash },
    };
    await this.writeJson(`${namespace}-transaction.json`, intent);
    await this.writeJson(`${namespace}-${snapshot.revision}.json`, { ...snapshot, hash }, true);
    await this.writeJson(`${namespace}-head.json`, intent.next);
    await this.writeJson(`${namespace}-transaction.json`, { ...intent, status: "committed" });
    return hash;
  }
}

export async function createProtectedWitnessDirectory(
  directory: string,
): Promise<ProtectedWitnessStore> {
  if (!isAbsolute(directory)) throw new WitnessBlocked("protection");
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch {
    throw new WitnessBlocked("installation_exists");
  }
  const store = new ProtectedWitnessStore(directory);
  await store.checkProtection();
  const parent = await open(
    dirname(directory),
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    await parent.sync();
  } finally {
    await parent.close();
  }
  return store;
}
