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
import { samePublicationValue } from "./review-gate-publication-validation.js";
import { verifyTerminalPublication } from "./review-gate-witness-terminal-publication.js";
import { withWitnessScopeGateLocks } from "./review-gate-lock-manager.js";

export function publicationLockIds(
  input: PreparedWitnessPublicationV1,
): Readonly<{ scopeIds: readonly string[]; gateIds: readonly string[] }> {
  return { scopeIds: [input.scopeId], gateIds: [input.gateId] };
}
export function createPublicationRecords(context: WitnessContext) {
  async function readPrepared(current: WitnessTransaction, publicationId: string) {
    const record = current.data.pending[publicationId] ?? current.data.committed[publicationId];
    if (record === undefined) throw new WitnessBlocked("publication_unprepared");
    const bytes = await context.store.readBytes(`stage-${record.stagingDigest}.bin`);
    if (
      bytes.length !== record.byteLength ||
      computeArtifactDigest(bytes) !== record.stagingDigest ||
      record.stagingDigest !== record.input.newTailDigest
    )
      throw new WitnessBlocked("publication_staging");
    return { ...record, bytes };
  }
  async function commitUnlocked(
    current: WitnessTransaction,
    input: PublicationCommitInput,
  ): Promise<PublicationCommitResult> {
    const record = await readPrepared(current, input.publicationId);
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
    await context.store.writeBytes(`journal-${publication.newTailDigest}.bin`, journal, true);
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
      committed: {
        ...current.data.committed,
        [input.publicationId]: {
          input: publication,
          stagingDigest: record.stagingDigest,
          byteLength: record.byteLength,
          preparedRevision: record.preparedRevision,
        },
      },
      workspaces: {
        ...current.data.workspaces,
        [publication.workspaceIdentity]: {
          ...workspace,
          frontier: publication.nextFrontier,
          enrollmentState: "committed",
        },
      },
    });
    return "advanced";
  }
  return {
    readPrepared,
    async commit(
      current: WitnessTransaction,
      input: PublicationCommitInput,
    ): Promise<PublicationCommitResult> {
      const record = await readPrepared(current, input.publicationId);
      return withWitnessScopeGateLocks(
        context.lockManager,
        publicationLockIds(record.input),
        async () => commitUnlocked(current, input),
      );
    },
  };
}
