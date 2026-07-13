import type { FullEvidenceRef } from "../types";
import type { DecisionPayload, RuleResult, Verdict } from "./decision-model";
import type { GateContext } from "./gate-context";
import type { GateRule } from "./gate-definition";
import type { Evidence } from "./observation-model";
import type { ProjectedEvidence, ReviewSummaryItem } from "./state-projection";

type SkipGateEvaluation = {
  readonly verdict: "SKIP";
  readonly reason: string;
};

export function evaluate(
  gates: readonly GateRule[],
  evidence: readonly ProjectedEvidence[],
  ctx: GateContext,
): Omit<DecisionPayload, "recordType"> | SkipGateEvaluation {
  if (ctx.taskId === undefined) {
    return { verdict: "SKIP", reason: "no taskId provided" };
  }

  const activeGates = gates.filter((gate) => gate.enabled && gate.trigger.on === ctx.trigger);
  if (activeGates.length === 0) {
    return {
      verdict: "SKIP",
      reason: `no matching active gates found for trigger: ${ctx.trigger}`,
    };
  }

  const ruleResults = activeGates.map((gate) => evaluateRule(gate, evidence, ctx));
  return {
    verdict: worstOf(ruleResults.map((result) => result.verdict)),
    gateType: "task",
    reachableEnforcementLevel: "L1",
    appliedEnforcementLevel: "L0",
    ruleResults,
  };
}

function evaluateRule(
  gate: GateRule,
  evidence: readonly ProjectedEvidence[],
  ctx: GateContext,
): RuleResult {
  const check = gate.check;

  switch (check.type) {
    case "evidence_present": {
      const matching = evidence.filter(
        (item) =>
          item.evidence.kind === check.evidenceKind && isAuthoritative(item.evidence.provenance),
      );
      if (matching.length > 0) {
        return {
          ruleId: gate.id,
          verdict: "PASS",
          reason: `Authoritative evidence of kind '${check.evidenceKind}' is present.`,
          evidenceRefs: matching.map((item) => item.ref),
        };
      }
      return {
        ruleId: gate.id,
        verdict: mapMissingAuthoritativeEvidenceVerdict(gate.onMissingEvidence),
        reason: `Required evidence of kind '${check.evidenceKind}' is missing or has declared provenance only.`,
        evidenceRefs: [],
      };
    }

    case "evidence_outcome": {
      const matching = evidence.filter((item) => item.evidence.kind === check.evidenceKind);
      if (matching.length === 0) {
        return {
          ruleId: gate.id,
          verdict: mapMissingAuthoritativeEvidenceVerdict(gate.onMissingEvidence),
          reason: `Evidence of kind '${check.evidenceKind}' is missing.`,
          evidenceRefs: [],
        };
      }

      let hasAuthoritativePass = false;
      let violationDetected = false;
      let ruleVerdict: Verdict = "PASS";
      const invalidRefs: FullEvidenceRef[] = [];
      const matchedRefs: FullEvidenceRef[] = [];

      for (const item of matching) {
        matchedRefs.push(item.ref);
        const authoritative = isAuthoritative(item.evidence.provenance);
        const outcome = evidenceOutcome(item.evidence);

        if (authoritative && outcome === check.requireOutcome) {
          hasAuthoritativePass = true;
        }
        if (authoritative && outcome !== check.requireOutcome) {
          violationDetected = true;
          ruleVerdict = worstOf([ruleVerdict, mapVerdict(gate.onViolation)]);
          invalidRefs.push(item.ref);
        }
      }

      if (!hasAuthoritativePass && !violationDetected) {
        return {
          ruleId: gate.id,
          verdict: mapMissingAuthoritativeEvidenceVerdict(gate.onMissingEvidence),
          reason: `No authoritative (observed/derived) passing evidence found for kind '${check.evidenceKind}'.`,
          evidenceRefs: matchedRefs,
        };
      }

      if (ruleVerdict === "PASS") {
        return { ruleId: gate.id, verdict: ruleVerdict, evidenceRefs: matchedRefs };
      }
      return {
        ruleId: gate.id,
        verdict: ruleVerdict,
        reason: `Some evidence did not meet required outcome '${check.requireOutcome}' or was declared only.`,
        evidenceRefs: invalidRefs,
      };
    }

    case "review_open_items": {
      if (ctx.reviewScope.length === 0) {
        return {
          ruleId: gate.id,
          verdict: mapVerdict(gate.onMissingEvidence),
          reason: "Review scope is empty. No review observed yet.",
          evidenceRefs: [],
        };
      }

      let observed = false;
      const openItems: ReviewSummaryItem[] = [];
      for (const scope of ctx.reviewScope) {
        const scopeData = ctx.reviewSummary?.byScope.get(scope);
        if (scopeData) {
          observed = true;
          for (const item of scopeData.open) {
            if (isSeverityAtLeast(item.severity, check.minimumSeverity)) {
              openItems.push(item);
            }
          }
        }
      }

      if (!observed) {
        return {
          ruleId: gate.id,
          verdict: mapVerdict(gate.onMissingEvidence),
          reason: `No review observations found for scopes: ${ctx.reviewScope.join(", ")}.`,
          evidenceRefs: [],
        };
      }
      if (openItems.length === 0) {
        return {
          ruleId: gate.id,
          verdict: "PASS",
          reason: "No open review items matching minimum severity found.",
          evidenceRefs: [],
        };
      }
      return {
        ruleId: gate.id,
        verdict: mapVerdict(gate.onViolation),
        reason: `Found ${openItems.length} open review items matching minimum severity '${check.minimumSeverity}'.`,
        evidenceRefs: openItems.map((item) => item.ref),
      };
    }

    default:
      return unknownCheckResult(gate.id, check);
  }
}

function mapVerdict(verdict: GateRule["onViolation"]): Verdict {
  switch (verdict) {
    case "pass":
      return "PASS";
    case "warn":
      return "WARN";
    case "fail":
      return "FAIL";
    default:
      return assertNever(verdict);
  }
}

function mapMissingAuthoritativeEvidenceVerdict(
  verdict: GateRule["onMissingEvidence"],
): Verdict {
  const mapped = mapVerdict(verdict);
  return mapped === "PASS" ? "WARN" : mapped;
}

function evidenceOutcome(evidence: Evidence): "pass" | "fail" | "unknown" | undefined {
  switch (evidence.sourceClass) {
    case "tool_output":
      return evidence.interpretation?.outcome;
    case "declared_claim":
      return evidence.claim.outcome;
    default:
      return assertNever(evidence);
  }
}

function isAuthoritative(provenance: Evidence["provenance"]): boolean {
  return provenance === "observed" || provenance === "derived";
}

function isSeverityAtLeast(
  itemSeverity: ReviewSummaryItem["severity"],
  minimumSeverity: ReviewSummaryItem["severity"],
): boolean {
  return severityLevel(itemSeverity) >= severityLevel(minimumSeverity);
}

function severityLevel(severity: ReviewSummaryItem["severity"]): 0 | 1 | 2 {
  switch (severity) {
    case "minor":
      return 0;
    case "major":
      return 1;
    case "critical":
      return 2;
    default:
      return assertNever(severity);
  }
}

function worstOf(verdicts: readonly Verdict[]): Verdict {
  if (verdicts.includes("FAIL")) return "FAIL";
  if (verdicts.includes("WARN")) return "WARN";
  return "PASS";
}

function unknownCheckResult(ruleId: string, _check: never): RuleResult {
  return { ruleId, verdict: "FAIL", reason: "Unknown gate check type.", evidenceRefs: [] };
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected discriminant: ${String(value)}`);
}
