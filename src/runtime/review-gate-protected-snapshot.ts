import { readdir } from "node:fs/promises";
import { z } from "zod";
import { computeCanonicalJsonFingerprint } from "../core/review-gate/identity.js";
import { WitnessBlocked, type ProtectedWitnessStore } from "./review-gate-protected-store.js";
const headSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
});
const transactionSchema = z.strictObject({
  status: z.enum(["prepared", "committed"]),
  expected: headSchema,
  next: headSchema,
});

export async function readProtectedSnapshot<T>(
  store: ProtectedWitnessStore,
  namespace: string,
  schema: z.ZodType<T>,
): Promise<Readonly<{ data: T; hash: string; revision: number }>> {
  const snapshotSchema = z.strictObject({
    revision: z.number().int().nonnegative(),
    previousHash: z.string(),
    data: schema,
    hash: z.string(),
  });
  let head = await store.readJson(`${namespace}-head.json`, headSchema);
  const names = await readdir(store.directory);
  const revisions = names
    .filter((name) => new RegExp(`^${namespace}-[0-9]+\\.json$`).test(name))
    .map((name) => Number(name.slice(namespace.length + 1, -5)));
  const maximum = Math.max(...revisions);
  if (maximum !== head.revision) {
    const intent = await store.readJson(`${namespace}-transaction.json`, transactionSchema);
    if (
      maximum !== head.revision + 1 ||
      intent.status !== "prepared" ||
      intent.expected.hash !== head.hash ||
      intent.next.revision !== maximum
    )
      throw new WitnessBlocked("registry_rollback");
    head = intent.next;
    const recovered = await store.readJson(`${namespace}-${head.revision}.json`, snapshotSchema);
    const { hash, ...contents } = recovered;
    if (hash !== head.hash || computeCanonicalJsonFingerprint(contents) !== hash)
      throw new WitnessBlocked("registry_invalid");
    await store.writeJson(`${namespace}-head.json`, head);
    await store.writeJson(`${namespace}-transaction.json`, { ...intent, status: "committed" });
  }
  const snapshot = await store.readJson(`${namespace}-${head.revision}.json`, snapshotSchema);
  const { hash, ...contents } = snapshot;
  if (
    head.hash !== hash ||
    snapshot.revision !== head.revision ||
    computeCanonicalJsonFingerprint(contents) !== hash
  )
    throw new WitnessBlocked("registry_invalid");
  let previousHash = "0".repeat(64);
  for (let revision = 0; revision <= head.revision; revision += 1) {
    const historical =
      revision === head.revision
        ? snapshot
        : await store.readJson(`${namespace}-${revision}.json`, snapshotSchema);
    const { hash: historicalHash, ...historicalContents } = historical;
    if (
      historical.revision !== revision ||
      historical.previousHash !== previousHash ||
      computeCanonicalJsonFingerprint(historicalContents) !== historicalHash
    )
      throw new WitnessBlocked("registry_history");
    previousHash = historicalHash;
  }
  return { data: snapshot.data, hash, revision: snapshot.revision };
}
