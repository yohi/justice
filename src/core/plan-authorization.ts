import { randomUUID } from "node:crypto";
import type { AtomicPersistence, SaveResult } from "./atomic-persistence";
import { AtomicPersistence as AtomicPersistenceClass } from "./atomic-persistence";
import type {
  CanonicalPlanSnapshot,
  CanonicalTaskSnapshot,
  FileReader,
  FileWriter,
  PlanFingerprint,
} from "./types";

type ApprovedPlanBindingBase = {
  readonly authorizationId: string;
  readonly sessionId: string;
  readonly planPath: string;
  readonly planFingerprint: PlanFingerprint;
  readonly canonicalSnapshot: CanonicalPlanSnapshot;
  readonly fingerprintSchema: "justice-plan-v1";
  readonly approvedAt: string;
};

export type ApprovedPlanBinding =
  | (ApprovedPlanBindingBase & { readonly status: "active" })
  | (ApprovedPlanBindingBase & {
      readonly status: "invalidated";
      readonly invalidatedAt: string;
      readonly invalidationReason?: "plan_superseded";
    })
  | (ApprovedPlanBindingBase & { readonly status: "released"; readonly releasedAt: string });

export type ApprovePlanInput = {
  readonly sessionId: string;
  readonly planPath: string;
  readonly planFingerprint: PlanFingerprint;
  readonly canonicalSnapshot: CanonicalPlanSnapshot;
  readonly approvedAt: string;
};

export type AuthorizationActivePlanReconciler = (
  parentSessionId: string,
  activeBinding: Extract<ApprovedPlanBinding, { readonly status: "active" }> | null,
) => void;

export type AuthorizationReviewBoundary = {
  readonly withParentSession: <T>(
    parentSessionId: string,
    operation: () => Promise<T>,
  ) => Promise<T>;
};

export function createAuthorizationReviewBoundary(): AuthorizationReviewBoundary {
  const tails = new Map<string, Promise<void>>();
  return {
    async withParentSession<T>(parentSessionId: string, operation: () => Promise<T>): Promise<T> {
      const predecessor = (tails.get(parentSessionId) ?? Promise.resolve()).catch(() => undefined);
      let releaseCurrent: () => void = () => undefined;
      const currentCompletion = new Promise<void>((resolve) => {
        releaseCurrent = resolve;
      });
      const currentTail = predecessor.then(() => currentCompletion);
      tails.set(parentSessionId, currentTail);
      await predecessor;
      try {
        return await operation();
      } finally {
        releaseCurrent();
        if (tails.get(parentSessionId) === currentTail) tails.delete(parentSessionId);
      }
    },
  };
}

export type AuthorizationMutationResult =
  | {
      readonly kind: "saved";
      readonly binding: Exclude<ApprovedPlanBinding, { readonly status: "active" }>;
    }
  | {
      readonly kind:
        | "not_found"
        | "wrong_parent"
        | "already_terminal"
        | "fingerprint_current"
        | "failed"
        | "uncertain";
    };

export class AuthorizationStore {
  private readonly authorizationPersistence: AtomicPersistence<ReadonlyArray<ApprovedPlanBinding>>;

  constructor(
    private readonly fileReader: FileReader,
    private readonly fileWriter: FileWriter,
    private readonly authorizationReviewBoundary: AuthorizationReviewBoundary,
  ) {
    this.authorizationPersistence = new AtomicPersistenceClass(this.fileReader, this.fileWriter, {
      filePath: ".justice/authorizations.json",
      conflictPath: ".justice/authorizations.conflict.json",
      serialize: (bindings) => JSON.stringify(bindings),
      deserialize: deserializeAuthorizationBindings,
      merge: mergeAuthorizationBindings,
      emptyValue: () => [],
      strictReadValidation: true,
    });
  }

  async approve(input: ApprovePlanInput): Promise<ApprovedPlanBinding | null> {
    return this.authorizationReviewBoundary.withParentSession(input.sessionId, () =>
      this.approveWithinAuthorizationReviewBoundary(input, () => undefined),
    );
  }

  async approveWithinAuthorizationReviewBoundary(
    input: ApprovePlanInput,
    reconcileActivePlan: AuthorizationActivePlanReconciler,
  ): Promise<ApprovedPlanBinding | null> {
    let current: Awaited<ReturnType<AuthorizationStore["authorizationPersistence"]["loadWithLock"]>>;
    try {
      current = await this.authorizationPersistence.loadWithLock();
    } catch {
      return null;
    }

    const fresh: Extract<ApprovedPlanBinding, { readonly status: "active" }> = {
      authorizationId: randomUUID(),
      sessionId: input.sessionId,
      planPath: input.planPath,
      planFingerprint: input.planFingerprint,
      canonicalSnapshot: input.canonicalSnapshot,
      fingerprintSchema: "justice-plan-v1",
      approvedAt: input.approvedAt,
      status: "active",
    };
    const candidate: ReadonlyArray<ApprovedPlanBinding> = [
      ...current.data.map((binding) =>
        binding.sessionId === input.sessionId && binding.status === "active"
          ? invalidateSuperseded(binding, input.approvedAt)
          : binding,
      ),
      fresh,
    ];

    let saved: SaveResult;
    try {
      saved = await this.authorizationPersistence.saveAtomicWithLock(candidate, current.lockMeta);
    } catch {
      return null;
    }
    if (saved.status !== "saved") return null;

    let authoritative: Awaited<ReturnType<AuthorizationStore["authorizationPersistence"]["loadWithLock"]>>;
    try {
      authoritative = await this.authorizationPersistence.loadWithLock();
    } catch {
      reconcileActivePlan(input.sessionId, null);
      return null;
    }

    const activeBindings = authoritative.data.filter(
      (binding): binding is Extract<ApprovedPlanBinding, { readonly status: "active" }> =>
        binding.sessionId === input.sessionId && binding.status === "active",
    );
    const active = activeBindings[0];
    if (activeBindings.length !== 1 || active === undefined) {
      reconcileActivePlan(input.sessionId, null);
      return null;
    }

    const own = authoritative.data.find((binding) => binding.authorizationId === fresh.authorizationId);
    if (own?.status !== "active" || active.authorizationId !== fresh.authorizationId) {
      reconcileActivePlan(input.sessionId, active);
      return null;
    }

    reconcileActivePlan(input.sessionId, active);
    return active;
  }

  async hydrate(): Promise<readonly ApprovedPlanBinding[]> {
    const current = await this.authorizationPersistence.loadWithLock();
    return current.data;
  }

  async findByAuthorizationId(authorizationId: string): Promise<ApprovedPlanBinding | null> {
    const current = await this.authorizationPersistence.loadWithLock();
    return current.data.find((binding) => binding.authorizationId === authorizationId) ?? null;
  }

  async release(authorizationId: string, at: string): Promise<AuthorizationMutationResult> {
    let binding: ApprovedPlanBinding | null;
    try {
      binding = await this.findByAuthorizationId(authorizationId);
    } catch {
      return { kind: "failed" };
    }
    if (binding === null) return { kind: "not_found" };
    return this.authorizationReviewBoundary.withParentSession(binding.sessionId, () =>
      this.releaseWithinAuthorizationReviewBoundary(binding.sessionId, authorizationId, at),
    );
  }

  async releaseWithinAuthorizationReviewBoundary(
    parentSessionId: string,
    authorizationId: string,
    at: string,
  ): Promise<AuthorizationMutationResult> {
    try {
      const current = await this.authorizationPersistence.loadWithLock();
      const binding = current.data.find((candidate) => candidate.authorizationId === authorizationId);
      if (binding === undefined) return { kind: "not_found" };
      if (binding.sessionId !== parentSessionId) return { kind: "wrong_parent" };
      if (binding.status !== "active") return { kind: "already_terminal" };
      const released: Extract<ApprovedPlanBinding, { readonly status: "released" }> = {
        ...binding,
        status: "released",
        releasedAt: at,
      };
      const saved = await this.authorizationPersistence.saveAtomicWithLock(
        current.data.map((candidate) =>
          candidate.authorizationId === authorizationId ? released : candidate,
        ),
        current.lockMeta,
      );
      return saved.status === "saved" ? { kind: "saved", binding: released } : { kind: "uncertain" };
    } catch {
      return { kind: "failed" };
    }
  }

  async invalidateForFingerprint(
    authorizationId: string,
    currentFingerprint: PlanFingerprint,
    at: string,
  ): Promise<AuthorizationMutationResult> {
    let binding: ApprovedPlanBinding | null;
    try {
      binding = await this.findByAuthorizationId(authorizationId);
    } catch {
      return { kind: "failed" };
    }
    if (binding === null) return { kind: "not_found" };
    return this.authorizationReviewBoundary.withParentSession(binding.sessionId, () =>
      this.invalidateForFingerprintWithinAuthorizationReviewBoundary(
        binding.sessionId,
        authorizationId,
        currentFingerprint,
        at,
      ),
    );
  }

  async invalidateForFingerprintWithinAuthorizationReviewBoundary(
    parentSessionId: string,
    authorizationId: string,
    currentFingerprint: PlanFingerprint,
    at: string,
  ): Promise<AuthorizationMutationResult> {
    try {
      const current = await this.authorizationPersistence.loadWithLock();
      const binding = current.data.find((candidate) => candidate.authorizationId === authorizationId);
      if (binding === undefined) return { kind: "not_found" };
      if (binding.sessionId !== parentSessionId) return { kind: "wrong_parent" };
      if (binding.status !== "active") return { kind: "already_terminal" };
      if (samePlanFingerprint(binding.planFingerprint, currentFingerprint)) {
        return { kind: "fingerprint_current" };
      }
      const invalidated: Extract<ApprovedPlanBinding, { readonly status: "invalidated" }> = {
        ...binding,
        status: "invalidated",
        invalidatedAt: at,
      };
      const saved = await this.authorizationPersistence.saveAtomicWithLock(
        current.data.map((candidate) =>
          candidate.authorizationId === authorizationId ? invalidated : candidate,
        ),
        current.lockMeta,
      );
      return saved.status === "saved" ? { kind: "saved", binding: invalidated } : { kind: "uncertain" };
    } catch {
      return { kind: "failed" };
    }
  }

  async invalidateMissingPlanWithinAuthorizationReviewBoundary(
    parentSessionId: string,
    authorizationId: string,
    at: string,
  ): Promise<AuthorizationMutationResult> {
    try {
      const current = await this.authorizationPersistence.loadWithLock();
      const binding = current.data.find((candidate) => candidate.authorizationId === authorizationId);
      if (binding === undefined) return { kind: "not_found" };
      if (binding.sessionId !== parentSessionId) return { kind: "wrong_parent" };
      if (binding.status !== "active") return { kind: "already_terminal" };
      const invalidated: Extract<ApprovedPlanBinding, { readonly status: "invalidated" }> = {
        ...binding,
        status: "invalidated",
        invalidatedAt: at,
      };
      const saved = await this.authorizationPersistence.saveAtomicWithLock(
        current.data.map((candidate) =>
          candidate.authorizationId === authorizationId ? invalidated : candidate,
        ),
        current.lockMeta,
      );
      return saved.status === "saved" ? { kind: "saved", binding: invalidated } : { kind: "uncertain" };
    } catch {
      return { kind: "failed" };
    }
  }
}

function samePlanFingerprint(left: PlanFingerprint, right: PlanFingerprint): boolean {
  return left.algorithm === right.algorithm && left.value === right.value;
}

function deserializeAuthorizationBindings(raw: string): ReadonlyArray<ApprovedPlanBinding> {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed.every(isApprovedPlanBinding)) {
    throw new Error("Invalid authorization binding array");
  }
  return parsed as ReadonlyArray<ApprovedPlanBinding>;
}

function isApprovedPlanBinding(value: unknown): value is ApprovedPlanBinding {
  if (!isRecord(value)) return false;
  if (
    typeof value.authorizationId !== "string" ||
    typeof value.sessionId !== "string" ||
    typeof value.planPath !== "string" ||
    !isPlanFingerprint(value.planFingerprint) ||
    !isCanonicalPlanSnapshot(value.canonicalSnapshot) ||
    value.fingerprintSchema !== "justice-plan-v1" ||
    typeof value.approvedAt !== "string"
  ) {
    return false;
  }

  switch (value.status) {
    case "active":
      return true;
    case "invalidated":
      return (
        typeof value.invalidatedAt === "string" &&
        (value.invalidationReason === undefined || value.invalidationReason === "plan_superseded")
      );
    case "released":
      return typeof value.releasedAt === "string";
    default:
      return false;
  }
}

function isPlanFingerprint(value: unknown): value is PlanFingerprint {
  return isRecord(value) && value.algorithm === "sha256" && typeof value.value === "string";
}

function isCanonicalPlanSnapshot(value: unknown): value is CanonicalPlanSnapshot {
  return (
    isRecord(value) &&
    value.schema === "justice-plan-v1" &&
    typeof value.documentDigest === "string" &&
    typeof value.globalBodyDigest === "string" &&
    Array.isArray(value.tasks) &&
    value.tasks.every(isCanonicalTaskSnapshot)
  );
}

function isCanonicalTaskSnapshot(value: unknown): value is CanonicalTaskSnapshot {
  return (
    isRecord(value) &&
    typeof value.taskId === "string" &&
    typeof value.title === "string" &&
    typeof value.canonicalBody === "string" &&
    typeof value.digest === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function mergeAuthorizationBindings(
  mine: ReadonlyArray<ApprovedPlanBinding>,
  theirs: ReadonlyArray<ApprovedPlanBinding>,
): ReadonlyArray<ApprovedPlanBinding> {
  const theirsById = new Map(theirs.map((binding) => [binding.authorizationId, binding]));
  const merged = new Map(theirsById);
  for (const candidate of mine) {
    const durable = merged.get(candidate.authorizationId);
    merged.set(
      candidate.authorizationId,
      durable === undefined ? candidate : mergeSameAuthorizationId(candidate, durable),
    );
  }

  const activeCandidates = [...merged.values()].filter(
    (binding): binding is Extract<ApprovedPlanBinding, { readonly status: "active" }> =>
      binding.status === "active",
  );
  for (const sessionId of new Set(activeCandidates.map((binding) => binding.sessionId))) {
    const winner = activeCandidates
      .filter((binding) => binding.sessionId === sessionId)
      .sort(
        (left, right) =>
          right.approvedAt.localeCompare(left.approvedAt) ||
          left.authorizationId.localeCompare(right.authorizationId),
      )[0];
    if (winner === undefined) continue;
    for (const binding of [...merged.values()]) {
      if (
        binding.sessionId === sessionId &&
        binding.status === "active" &&
        binding.authorizationId !== winner.authorizationId
      ) {
        merged.set(binding.authorizationId, invalidateSuperseded(binding));
      }
    }
  }
  return [...merged.values()];
}

function mergeSameAuthorizationId(
  mine: ApprovedPlanBinding,
  theirs: ApprovedPlanBinding,
): ApprovedPlanBinding {
  if (mine.status === "active") return theirs.status === "active" ? mine : theirs;
  if (theirs.status === "active") return mine;
  return terminalTimestamp(mine).localeCompare(terminalTimestamp(theirs)) >= 0 ? mine : theirs;
}

function terminalTimestamp(binding: Exclude<ApprovedPlanBinding, { readonly status: "active" }>): string {
  return binding.status === "invalidated" ? binding.invalidatedAt : binding.releasedAt;
}

function invalidateSuperseded(
  binding: Extract<ApprovedPlanBinding, { readonly status: "active" }>,
  invalidatedAt = new Date().toISOString(),
): ApprovedPlanBinding {
  return {
    ...binding,
    status: "invalidated",
    invalidatedAt,
    invalidationReason: "plan_superseded",
  };
}
