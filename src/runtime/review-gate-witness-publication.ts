import { computeArtifactDigest } from "../core/review-gate/identity.js";
import type {
  PreparedWitnessPublicationV1,
  PublicationCommitInput,
  PublicationCommitResult,
} from "./review-gate-witness-contracts.js";
import { publicationSchema } from "./review-gate-witness-registry.js";
import {
  withWitnessTransaction,
  workspaceFrom,
  type WitnessContext,
} from "./review-gate-witness-context.js";
import {
  createPublicationRecords,
  publicationLockIds,
  preparePublicationUnlocked,
  publishPreparedJournalUnlocked,
} from "./review-gate-publication-record.js";

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
      return withWitnessTransaction(context, async (current) =>
        publishPreparedJournalUnlocked(context, current, publicationId),
      );
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
