import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { join } from "node:path";
import {
  computeArtifactDigest,
  computeCanonicalJsonFingerprint,
  canonicalizeArtifactPath,
} from "../core/review-gate/identity.js";
import type {
  VerifiedCanonicalMutationTargetV1,
  VerifiedTargetWriterAuthorityV1,
  VerifiedTargetWriterHandoffIntentV1,
} from "../core/review-gate/types.js";
import { WitnessBlocked } from "./review-gate-protected-store.js";
import { withWitnessScopeGateLocks } from "./review-gate-lock-manager.js";
import {
  targetSchema,
  type TargetEntry,
  type TargetRegistry,
} from "./review-gate-target-writer-schema.js";
import {
  verifyWitnessJournals,
  workspaceFrom,
  type WitnessContext,
  type WitnessTransaction,
} from "./review-gate-witness-context.js";

export const sameTargetValue = (a: unknown, b: unknown): boolean =>
  computeCanonicalJsonFingerprint(a) === computeCanonicalJsonFingerprint(b);
export async function targetImage(context: WitnessContext, path: string) {
  if (canonicalizeArtifactPath(path) !== path) throw new WitnessBlocked("target_alias");
  const root = await realpath(context.options.workspaceRoot);
  const absolute = join(root, path);
  if ((await realpath(absolute)) !== absolute) throw new WitnessBlocked("target_alias");
  const link = await lstat(absolute);
  if (!link.isFile() || link.nlink !== 1) throw new WitnessBlocked("target_alias");
  const file = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.dev !== link.dev ||
      stat.ino !== link.ino ||
      stat.size > 8 * 1024 * 1024
    )
      throw new WitnessBlocked("target_alias");
    return {
      physicalIdentity: `${stat.dev}:${stat.ino}`,
      image: {
        digest: computeArtifactDigest(await file.readFile()),
        gitMode: (stat.mode & 0o111) === 0 ? ("100644" as const) : ("100755" as const),
      },
    };
  } finally {
    await file.close();
  }
}
export async function verifyTarget(
  context: WitnessContext,
  current: WitnessTransaction,
  untrusted: VerifiedCanonicalMutationTargetV1,
  registry: TargetRegistry,
): Promise<TargetEntry> {
  const target = targetSchema.parse(untrusted);
  const registered = registry.targets[target.targetIdentityDigest];
  if (
    target.installationId !== current.installation.installationId ||
    target.workspaceIdentity !== context.options.workspaceIdentity ||
    target.canonicalWorkspaceRoot !== context.options.workspaceIdentity ||
    (registered === undefined && target.identityProofFrontier !== current.hash) ||
    target.targetIdentityDigest !==
      computeCanonicalJsonFingerprint({
        workspaceIdentity: target.workspaceIdentity,
        path: target.canonicalLogicalTargetPath,
      }) ||
    target.verifiedAliasSetDigest !==
      computeCanonicalJsonFingerprint([target.canonicalLogicalTargetPath])
  )
    throw new WitnessBlocked("target_identity");
  const actual = await targetImage(context, target.canonicalLogicalTargetPath);
  if (
    Object.entries(registry.targets).some(
      ([key, entry]) =>
        key !== target.targetIdentityDigest && entry.physicalIdentity === actual.physicalIdentity,
    )
  )
    throw new WitnessBlocked("target_alias");
  const prior = registry.targets[target.targetIdentityDigest];
  if (prior !== undefined) {
    if (!sameTargetValue(prior.authority.target, target))
      throw new WitnessBlocked("target_identity");
    return prior;
  }
  const protectedTargetFrontier = computeCanonicalJsonFingerprint({
    target,
    generation: 0,
    image: actual.image,
  });
  return {
    authority: {
      target,
      globalTargetWriterGeneration: 0,
      activeOwner: null,
      priorOwner: null,
      expectedImage: actual.image,
      protectedTargetFrontier,
      protectedTargetCasProofDigest: protectedTargetFrontier,
      durableTombstoneProofDigest: null,
    },
    physicalIdentity: actual.physicalIdentity,
    lease: null,
    pendingEffect: null,
  };
}
export function advanceTargetAuthority(
  prior: VerifiedTargetWriterAuthorityV1,
  values: Readonly<{
    generation: number;
    owner: VerifiedTargetWriterAuthorityV1["activeOwner"];
    image?: VerifiedTargetWriterAuthorityV1["expectedImage"];
    tombstone: boolean;
  }>,
): VerifiedTargetWriterAuthorityV1 {
  const contents = {
    target: prior.target,
    globalTargetWriterGeneration: values.generation,
    activeOwner: values.owner,
    priorOwner: prior.activeOwner ?? prior.priorOwner,
    expectedImage: values.image ?? prior.expectedImage,
  };
  const proof = computeCanonicalJsonFingerprint(contents);
  return {
    ...contents,
    protectedTargetFrontier: proof,
    protectedTargetCasProofDigest: proof,
    durableTombstoneProofDigest: values.tombstone ? proof : null,
  };
}
export async function withTargetLocks<T>(
  context: WitnessContext,
  current: WitnessTransaction,
  intents: readonly VerifiedTargetWriterHandoffIntentV1[],
  run: () => Promise<T>,
): Promise<T> {
  const owners = intents
    .flatMap((intent) => [intent.oldOwner, intent.newOwner])
    .filter((owner) => owner !== null);
  const workspace = workspaceFrom(current, context.options.workspaceIdentity);
  await verifyWitnessJournals(context, workspace);
  for (const intent of intents) {
    const gate = workspace.frontier.scopes
      .find((scope) => scope.scopeId === intent.scopeId)
      ?.gateMembership.find((member) => member.gateId === intent.gateId);
    if (
      gate?.generationId !== intent.generationId ||
      computeCanonicalJsonFingerprint(
        workspace.frontier.writerHeads.filter((head) => head.gateId === intent.gateId),
      ) !== intent.expectedGateEventFrontier
    )
      throw new WitnessBlocked("target_gate_frontier");
    for (const owner of [intent.oldOwner, intent.newOwner])
      if (
        owner !== null &&
        workspace.frontier.scopes
          .find((scope) => scope.scopeId === owner.scopeId)
          ?.gateMembership.find((member) => member.gateId === owner.gateId)?.generationId !==
          owner.generationId
      )
        throw new WitnessBlocked("target_owner_membership");
  }
  return withWitnessScopeGateLocks(
    context.lockManager,
    {
      scopeIds: [
        ...owners.map((owner) => owner.scopeId),
        ...intents.map((intent) => intent.scopeId),
      ],
      gateIds: [...owners.map((owner) => owner.gateId), ...intents.map((intent) => intent.gateId)],
    },
    async () => {
      const held = [];
      try {
        for (const key of [
          ...new Set(intents.map((intent) => intent.target.targetIdentityDigest)),
        ].sort()) {
          const lock = await context.provider?.acquireGateLock(`target-${key}`);
          if (lock === undefined) throw new WitnessBlocked("native_unavailable");
          if (lock === "occupied") throw new WitnessBlocked("busy_retryable");
          if (!lock.verifyCloexec()) {
            lock.release();
            throw new WitnessBlocked("native_unavailable");
          }
          held.push(lock);
        }
        return await run();
      } finally {
        for (const lock of held.reverse()) lock.release();
      }
    },
  );
}
export async function reconcileTargetEffect(
  context: WitnessContext,
  entry: TargetEntry,
): Promise<TargetEntry> {
  const actual = await targetImage(context, entry.authority.target.canonicalLogicalTargetPath);
  const pending = entry.pendingEffect;
  if (pending !== null) {
    if (
      !sameTargetValue(actual.image, pending.prior) &&
      !sameTargetValue(actual.image, pending.next)
    )
      throw new WitnessBlocked("native_effect_unknown");
    return {
      ...entry,
      physicalIdentity: actual.physicalIdentity,
      pendingEffect: null,
      authority: advanceTargetAuthority(entry.authority, {
        generation: entry.authority.globalTargetWriterGeneration,
        owner: entry.authority.activeOwner,
        image: actual.image,
        tombstone: entry.authority.activeOwner === null,
      }),
    };
  }
  if (!sameTargetValue(actual.image, entry.authority.expectedImage))
    throw new WitnessBlocked("native_image_mismatch");
  return entry;
}
