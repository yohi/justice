import { computeArtifactDigest } from "../core/review-gate/identity.js";
import { validateReviewGateEventRecord } from "../core/review-gate/event-schema.js";
import type {
  PreparedWitnessPublicationV1,
  PublicationCommitInput,
  PublicationCommitResult,
} from "./review-gate-witness-contracts.js";
import { WitnessBlocked } from "./review-gate-protected-store.js";
import {
  workspaceFrom,
  type WitnessContext,
  type WitnessTransaction,
} from "./review-gate-witness-context.js";
import { samePublicationValue, validatePublication } from "./review-gate-publication-validation.js";
import { verifyTerminalPublication } from "./review-gate-witness-terminal-publication.js";
import { withWitnessScopeGateLocks } from "./review-gate-lock-manager.js";

const MAX_COMMITTED_PUBLICATIONS = 1024;

export function publicationLockIds(
  input: PreparedWitnessPublicationV1,
): Readonly<{ scopeIds: readonly string[]; gateIds: readonly string[] }> {
  return { scopeIds: [input.scopeId], gateIds: [input.gateId] };
}

/**
 * Read one prepared or committed publication record together with its exact
 * protected staging bytes. Shared by every prepare, publish, and commit path
 * so no caller can reinterpret the staged journal.
 */
export async function readPreparedPublication(
  context: WitnessContext,
  current: WitnessTransaction,
  publicationId: string,
) {
  const record = current.data.pending[publicationId] ?? current.data.committed[publicationId];
  if (record === undefined) throw new WitnessBlocked("publication_unprepared");
  const bytes = await context.store.readBytes(`stage-${record.stagingDigest}.bin`);
  if (
    bytes.length !== record.byteLength ||
    computeArtifactDigest(bytes) !== record.stagingDigest ||
    record.stagingDigest !== record.input.newWriterHash
  )
    throw new WitnessBlocked("publication_staging");
  const storedFrontier = "nextFrontier" in record.input ? record.input.nextFrontier : undefined;
  const { nextFrontier: _storedFrontier, ...inputWithoutFrontier } = record.input;
  void _storedFrontier;
  const input: PreparedWitnessPublicationV1 = {
    ...inputWithoutFrontier,
    nextFrontier: storedFrontier ?? workspaceFrom(current, record.input.workspaceIdentity).frontier,
  };
  return { ...record, input, bytes };
}

/**
 * Validate and durably stage one publication inside an already-running
 * protected witness transaction. Shared by the admission-guarded witness
 * path and the Gate-owned coordinator path; the caller owns transaction and
 * lock discipline, this function owns publication integrity and the scope
 * registry CAS.
 */
export async function preparePublicationUnlocked(
  context: WitnessContext,
  current: WitnessTransaction,
  input: PreparedWitnessPublicationV1,
  bytes: Uint8Array,
): Promise<"prepared" | "already_prepared"> {
  if (current.data.cancelled[input.publicationId] !== undefined)
    throw new WitnessBlocked("publication_cancelled");
  const existing =
    current.data.pending[input.publicationId] ?? current.data.committed[input.publicationId];
  if (existing !== undefined) {
    const protectedRecord = await readPreparedPublication(context, current, input.publicationId);
    if (
      !samePublicationValue(existing.input, input) ||
      !protectedRecord.bytes.equals(Buffer.from(bytes))
    )
      throw new WitnessBlocked("publication_identity_conflict");
    return "already_prepared";
  }
  if (
    Object.values(current.data.pending).some(
      (record) => record.input.workspaceIdentity === input.workspaceIdentity,
    )
  )
    throw new WitnessBlocked("publication_busy");
  await validatePublication(context, current, input, bytes);
  await context.store.writeBytes(`stage-${input.newWriterHash}.bin`, Buffer.from(bytes), true);
  await context.store.advance("scope", current, {
    ...current.data,
    pending: {
      ...current.data.pending,
      [input.publicationId]: {
        input,
        stagingDigest: input.newWriterHash,
        byteLength: bytes.length,
        preparedRevision: current.revision + 1,
      },
    },
  });
  return "prepared";
}

/**
 * Commit one prepared publication inside an already-running protected
 * witness transaction, without re-acquiring the scope/Gate locks. The
 * Gate-owned coordinator path calls this directly because it already holds
 * those locks.
 */
export async function commitPublicationUnlocked(
  context: WitnessContext,
  current: WitnessTransaction,
  input: PublicationCommitInput,
): Promise<PublicationCommitResult> {
  const record = await readPreparedPublication(context, current, input.publicationId);
  const publication = record.input;
  const events = record.bytes
    .toString("utf8")
    .trimEnd()
    .split("\n")
    .map((line) => validateReviewGateEventRecord(JSON.parse(line)));
  await verifyTerminalPublication(
    context,
    current,
    events.slice(publication.expectedWriterSequence),
  );
  if (
    input.expectedGlobalFrontier !== publication.expectedGlobalFrontier ||
    input.expectedWriterHash !== publication.expectedWriterHash
  )
    return "blocked";
  const journal = await context.provider?.readWriterShard(
    publication.scopeId,
    publication.gateId,
    publication.writerId,
  );
  if (journal === undefined || journal === null || !journal.equals(record.bytes))
    return "blocked";
  const workspace = workspaceFrom(current, publication.workspaceIdentity);
  if (current.data.committed[input.publicationId] !== undefined)
    return workspace.frontier.globalFrontierHash === publication.newGlobalFrontier
      ? "already_committed"
      : "blocked";
  if (
    current.revision !== record.preparedRevision ||
    workspace.frontier.globalFrontierHash !== input.expectedGlobalFrontier
  )
    return "blocked";
  const pending = Object.fromEntries(
    Object.entries(current.data.pending).filter(([key]) => key !== input.publicationId),
  );
  const committedEntries = Object.entries(current.data.committed)
    .filter(([key]) => key !== input.publicationId);
  const { nextFrontier: _nextFrontier, ...committedInput } = publication;
  void _nextFrontier;
  const committed = Object.fromEntries([
    ...committedEntries,
    [input.publicationId, {
      input: committedInput,
      stagingDigest: record.stagingDigest,
      byteLength: record.byteLength,
      preparedRevision: record.preparedRevision,
    }],
  ].slice(-MAX_COMMITTED_PUBLICATIONS));
  await context.store.writeBytes(`journal-${publication.newWriterHash}.bin`, journal, true);
  await context.store.advance("scope", current, {
    ...current.data,
    pending,
    scopeAuthorizations: Object.fromEntries(
      Object.entries(current.data.scopeAuthorizations).map(([key, value]) => [
        key,
        !value.consumed &&
        value.expectedWorkspaceFrontier === publication.expectedGlobalFrontier &&
        publication.nextFrontier.scopes.some((scope) => samePublicationValue(scope, value.scope))
          ? { ...value, consumed: true }
          : value,
      ]),
    ),
    committed,
    workspaces: {
      ...current.data.workspaces,
      [publication.workspaceIdentity]: {
        ...workspace,
        frontier: publication.nextFrontier,
        enrollmentState: "committed",
      },
    },
  });
  const retainedPublicationFiles = new Set<string>();
  for (const record of Object.values(pending)) {
    retainedPublicationFiles.add(`stage-${record.stagingDigest}.bin`);
  }
  for (const [publicationId, record] of Object.entries(current.data.committed)) {
    if (Object.hasOwn(committed, publicationId)) {
      retainedPublicationFiles.add(`stage-${record.stagingDigest}.bin`);
    }
  }
  retainedPublicationFiles.add(`stage-${record.stagingDigest}.bin`);
  for (const writerHead of publication.nextFrontier.writerHeads) {
    retainedPublicationFiles.add(`journal-${writerHead.hash}.bin`);
  }
  await context.store.removePublicationFiles(retainedPublicationFiles);
  return "advanced";
}

export function createPublicationRecords(context: WitnessContext) {
  return {
    readPrepared: (current: WitnessTransaction, publicationId: string) =>
      readPreparedPublication(context, current, publicationId),
    async commit(
      current: WitnessTransaction,
      input: PublicationCommitInput,
    ): Promise<PublicationCommitResult> {
      const record = await readPreparedPublication(context, current, input.publicationId);
      return withWitnessScopeGateLocks(
        context.lockManager,
        publicationLockIds(record.input),
        async () => commitPublicationUnlocked(context, current, input),
      );
    },
    commitUnlocked: (current: WitnessTransaction, input: PublicationCommitInput) =>
      commitPublicationUnlocked(context, current, input),
  };
}
