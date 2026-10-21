import type { AdmissionDecision } from "../core/review-gate/admission";
import type {
  AdmissionOwnedWitness,
  ReviewGateAdmissionExecutionResult,
  ReviewGateAdmissionObservation,
} from "./review-gate-admission-context";

type AdmissionDecisionKind = AdmissionDecision["kind"];

export type ReviewGateAdmissionHandlers = {
  readonly [K in AdmissionDecisionKind]: (
    decision: Extract<AdmissionDecision, { readonly kind: K }>,
    observation: ReviewGateAdmissionObservation | null,
    owned: AdmissionOwnedWitness,
  ) => Promise<ReviewGateAdmissionExecutionResult>;
};

type ReviewGateAdmissionInput = Readonly<{
  readonly decision: AdmissionDecision;
  readonly observation: ReviewGateAdmissionObservation | null;
  readonly owned: AdmissionOwnedWitness;
}>;

function assertNever(value: never): never {
  throw new Error(`review_gate_admission_decision_unhandled: ${JSON.stringify(value)}`);
}

export async function applyReviewGateAdmissionDecision(
  input: ReviewGateAdmissionInput,
  handlers: ReviewGateAdmissionHandlers,
): Promise<ReviewGateAdmissionExecutionResult> {
  const { decision, observation, owned } = input;
  switch (decision.kind) {
    case "BLOCK":
      return handlers.BLOCK(decision, observation, owned);
    case "REUSE_COMPLETED":
      return handlers.REUSE_COMPLETED(decision, observation, owned);
    case "CREATE_GENESIS":
      return handlers.CREATE_GENESIS(decision, observation, owned);
    case "CREATE_SUCCESSOR":
      return handlers.CREATE_SUCCESSOR(decision, observation, owned);
    case "RESUME":
      return handlers.RESUME(decision, observation, owned);
    case "STAY_SUSPENDED":
      return handlers.STAY_SUSPENDED(decision, observation, owned);
    case "REVALIDATE_OR_BLOCK":
      return handlers.REVALIDATE_OR_BLOCK(decision, observation, owned);
    case "UPSTREAM_PRECEDENCE_REQUIRED":
      return handlers.UPSTREAM_PRECEDENCE_REQUIRED(decision, observation, owned);
    case "STALE_LINEAGE_REVALIDATION_REQUIRED":
      return handlers.STALE_LINEAGE_REVALIDATION_REQUIRED(decision, observation, owned);
    case "INSPECT_NC1_ELIGIBLE_CHANGE":
      return handlers.INSPECT_NC1_ELIGIBLE_CHANGE(decision, observation, owned);
    case "REENTRY_CANDIDATE":
      return handlers.REENTRY_CANDIDATE(decision, observation, owned);
    default:
      return assertNever(decision);
  }
}
