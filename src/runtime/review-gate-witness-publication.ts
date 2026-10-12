import { computeArtifactDigest } from "../core/review-gate/identity.js";
import { validateReviewGateEventRecord } from "../core/review-gate/event-schema.js";
import type {
  PreparedWitnessPublicationV1,
  PublicationCommitInput,
  PublicationCommitResult,
} from "./review-gate-witness-contracts.js";
import { publicationSchema } from "./review-gate-witness-registry.js";
import { WitnessBlocked } from "./review-gate-protected-store.js";
import {
  withWitnessTransaction,
  workspaceFrom,
  type WitnessContext,
} from "./review-gate-witness-context.js";
import {
  createPublicationRecords,
  publicationLockIds,
  preparePublicationUnlocked,
} from "./review-gate-publication-record.js";
import { verifyTerminalPublication } from "./review-gate-witness-terminal-publication.js";
import { withWitnessScopeGateLocks } from "./review-gate-lock-manager.js";

export function createWitnessPublication(context: WitnessContext) {
  const { readPrepared, commit } = createPublicationRecords(context);
  return {
    async rollbackPreparedPublication(publicationId: string): Promise<"rolled_back" | "blocked"> {
      try {
        return await withWitnessTransaction(context, async (current) => {
          const record = await readPrepared(current, publicationId);
          if (
            current.data.pending[publicationId] === undefined ||
            current.data.committed[publicationId] !== undefined
          )
            return "blocked";
          const prior = await context.provider?.readWriterShard(
            record.input.scopeId,
            record.input.gateId,
            record.input.writerId,
          );
          if (
            prior === undefined ||
            (prior === null ? "0".repeat(64) : computeArtifactDigest(prior)) !==
              record.input.expectedWriterHash ||
            workspaceFrom(current, record.input.workspaceIdentity).frontier.globalFrontierHash !==
              record.input.expectedGlobalFrontier
          )
            return "blocked";
          await context.store.advance("scope", current, {
            ...current.data,
            pending: Object.fromEntries(
              Object.entries(current.data.pending).filter(([id]) => id !== publicationId),
            ),
            cancelled: {
              ...current.data.cancelled,
              [publicationId]: {
                input: record.input,
                stagingDigest: record.stagingDigest,
                byteLength: record.byteLength,
                preparedRevision: record.preparedRevision,
              },
            },
          });
          return "rolled_back";
        });
      } catch (error: unknown) {
        if (error instanceof Error) return "blocked";
        throw error;
      }
    },
    async preparePublication(
      untrusted: PreparedWitnessPublicationV1,
      canonicalEventBytes: Uint8Array,
    ): Promise<"prepared" | "already_prepared"> {
      const input = publicationSchema.parse(untrusted);
      const bytes = Buffer.from(canonicalEventBytes);
      return withWitnessTransaction(
        context,
        async (current) => preparePublicationUnlocked(context, current, input, bytes),
        publicationLockIds(input),
      );
    },
    async readPreparedPublication(publicationId: string) {
      return withWitnessTransaction(context, async (current) =>
        readPrepared(current, publicationId),
      );
    },
    async classifyPreparedPublication(
      publicationId: string,
    ): Promise<"prepared" | "committed" | "blocked"> {
      try {
        return await withWitnessTransaction(context, async (current) => {
          await readPrepared(current, publicationId);
          return current.data.committed[publicationId] === undefined ? "prepared" : "committed";
        });
      } catch (error: unknown) {
        if (error instanceof Error) return "blocked";
        throw error;
      }
    },
    async publishPreparedJournal(publicationId: string): Promise<void> {
      return withWitnessTransaction(context, async (current) => {
        const { input, bytes } = await readPrepared(current, publicationId);
        return withWitnessScopeGateLocks(
          context.lockManager,
          publicationLockIds(input),
          async () => {
            if (context.provider === undefined)
              throw new WitnessBlocked("journal_native_unavailable");
            const previous = await context.provider.readWriterShard(
              input.scopeId,
              input.gateId,
              input.writerId,
            );
            if (previous?.equals(bytes)) return;
            if (current.data.committed[publicationId] !== undefined)
              throw new WitnessBlocked("journal_history_lost");
            if (current.revision !== (current.data.pending[publicationId]?.preparedRevision ?? -1))
              throw new WitnessBlocked("publication_frontier");
            const events = bytes
              .toString("utf8")
              .trimEnd()
              .split("\n")
              .map((line) => validateReviewGateEventRecord(JSON.parse(line)));
            await verifyTerminalPublication(
              context,
              current,
              events.slice(input.expectedWriterSequence),
            );
            if (
              (previous === null ? "0".repeat(64) : computeArtifactDigest(previous)) !==
              input.expectedWriterHash
            )
              throw new WitnessBlocked("publication_preimage");
            await context.provider.durableReplaceWriterShard(
              input.scopeId,
              input.gateId,
              input.writerId,
              previous === null ? null : computeArtifactDigest(previous),
              bytes,
            );
          },
        );
      });
    },
    async commitPreparedPublicationCAS(
      input: PublicationCommitInput,
    ): Promise<PublicationCommitResult> {
      try {
        return await withWitnessTransaction(context, async (current) => commit(current, input));
      } catch (error: unknown) {
        if (error instanceof Error) return "blocked";
        throw error;
      }
    },
    async recoverPreparedPublication(publicationId: string): Promise<PublicationCommitResult> {
      try {
        return await withWitnessTransaction(context, async (current) => {
          const { input } = await readPrepared(current, publicationId);
          return commit(current, {
            publicationId,
            expectedGlobalFrontier: input.expectedGlobalFrontier,
            expectedWriterHash: input.expectedWriterHash,
          });
        });
      } catch (error: unknown) {
        if (error instanceof Error) return "blocked";
        throw error;
      }
    },
  };
}
