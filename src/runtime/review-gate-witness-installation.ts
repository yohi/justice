import { createHash, createPublicKey, generateKeyPairSync, randomUUID, verify } from "node:crypto";
import { resolve } from "node:path";
import {
  computeCanonicalJsonFingerprint,
  computeWorkspaceIdentity,
} from "../core/review-gate/identity.js";
import {
  createProtectedWitnessDirectory,
  ProtectedWitnessStore,
  WitnessBlocked,
} from "./review-gate-protected-store.js";
import type {
  AuthenticatedHostProvisionRequest,
  TrustedWitnessInstallationV1,
} from "./review-gate-witness-contracts.js";
import { installationSchema } from "./review-gate-witness-registry.js";
import type { KeyObject } from "node:crypto";

export function hostProofValid(key: KeyObject, payload: unknown, signature: string): boolean {
  if (key.type !== "public" || key.asymmetricKeyType !== "ed25519") return false;
  return verify(
    null,
    Buffer.from(computeCanonicalJsonFingerprint(payload)),
    key,
    Buffer.from(signature, "base64"),
  );
}
export async function provisionReviewGateWitnessInstallation(
  input: AuthenticatedHostProvisionRequest,
): Promise<TrustedWitnessInstallationV1> {
  if (
    process.platform !== "linux" ||
    resolve(input.witnessDirectory) !== input.witnessDirectory ||
    process.getuid === undefined
  )
    throw new WitnessBlocked("protection");
  const pair = generateKeyPairSync("ed25519");
  const config = {
    installationId: randomUUID(),
    epoch: randomUUID(),
    provisionerPublicKeyPem: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
    hostTrustRootPem: input.hostTrustRoot.export({ type: "spki", format: "pem" }).toString(),
    authenticatedProvisionerDigest: createHash("sha256")
      .update(pair.publicKey.export({ type: "spki", format: "der" }))
      .digest("hex"),
    ownerUid: process.getuid(),
    directoryIdentityDigest: computeWorkspaceIdentity(input.witnessDirectory),
  };
  const signature = await input.authorize(config);
  if (!hostProofValid(input.hostTrustRoot, config, signature))
    throw new WitnessBlocked("authentication");
  const store = await createProtectedWitnessDirectory(input.witnessDirectory);
  return store.withGuard("installation", async () => {
    const installation = { ...config, authorizationSignature: signature };
    await store.writeBytes(
      "provisioner-key.pem",
      Buffer.from(pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString()),
      true,
    );
    await store.initialize("scope", {
      installationId: config.installationId,
      workspaces: {},
      nonces: {},
      pending: {},
      committed: {},
      cancelled: {},
      scopeAuthorizations: {},
    });
    await store.initialize("target", { targets: {}, handoffs: {}, terminals: {}, closingSeals: {} });
    await store.writeJson("installation.json", installation, true);
    return installationSchema.parse(installation);
  });
}
export async function readTrustedWitnessInstallation(
  store: ProtectedWitnessStore,
  pinnedRoot?: KeyObject,
): Promise<TrustedWitnessInstallationV1> {
  const installation = await store.readJson("installation.json", installationSchema);
  const envRoot = process.env["JUSTICE_REVIEW_GATE_HOST_TRUST_ROOT"];
  const root = pinnedRoot ?? (envRoot === undefined ? undefined : createPublicKey(envRoot));
  if (
    root === undefined ||
    root.export({ type: "spki", format: "pem" }).toString() !== installation.hostTrustRootPem
  )
    throw new WitnessBlocked("authentication");
  const { authorizationSignature, ...payload } = installation;
  const publicKey = createPublicKey(installation.provisionerPublicKeyPem);
  if (
    !hostProofValid(root, payload, authorizationSignature) ||
    installation.ownerUid !== process.getuid?.() ||
    installation.directoryIdentityDigest !== computeWorkspaceIdentity(store.directory) ||
    installation.authenticatedProvisionerDigest !==
      createHash("sha256")
        .update(publicKey.export({ type: "spki", format: "der" }))
        .digest("hex")
  )
    throw new WitnessBlocked("authentication");
  return installation;
}
