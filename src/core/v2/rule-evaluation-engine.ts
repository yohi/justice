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
          item.evidence.kind === check.evidenceKind &&
          isAuthoritativeExecutionEvidence(item.evidence),
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
      const matching = evidence.filter(
        (item) =>
          item.evidence.kind === check.evidenceKind &&
          isAuthoritativeExecutionEvidence(item.evidence),
      );
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
        const outcome = evidenceOutcome(item.evidence);

        if (outcome === check.requireOutcome) {
          hasAuthoritativePass = true;
        }
        if (outcome !== undefined && outcome !== "unknown" && outcome !== check.requireOutcome) {
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
        return {
          ruleId: gate.id,
          verdict: ruleVerdict,
          reason: `Authoritative evidence of kind '${check.evidenceKind}' met required outcome '${check.requireOutcome}'.`,
          evidenceRefs: matchedRefs,
        };
      }
      return {
        ruleId: gate.id,
        verdict: ruleVerdict,
        reason: `Some authoritative evidence did not meet required outcome '${check.requireOutcome}'.`,
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

      const scopeVerdicts: Verdict[] = [];
      const unobservedScopes: string[] = [];
      const openItems: ReviewSummaryItem[] = [];
      for (const scope of ctx.reviewScope) {
        const scopeData = ctx.reviewSummary?.byScope.get(scope);
        if (!scopeData) {
          unobservedScopes.push(scope);
          scopeVerdicts.push(mapVerdict(gate.onMissingEvidence));
          continue;
        }
        const scopeOpenItems = scopeData.open.filter((item) =>
          isSeverityAtLeast(item.severity, check.minimumSeverity),
        );
        if (scopeOpenItems.length === 0) {
          scopeVerdicts.push("PASS");
          continue;
        }
        openItems.push(...scopeOpenItems);
        scopeVerdicts.push(mapVerdict(gate.onViolation));
      }

      if (unobservedScopes.length === 0 && openItems.length === 0) {
        return {
          ruleId: gate.id,
          verdict: "PASS",
          reason: "No open review items matching minimum severity found.",
          evidenceRefs: [],
        };
      }
      const scopeMessages: string[] = [];
      if (unobservedScopes.length > 0) {
        scopeMessages.push(
          `No review observations found for scopes: ${unobservedScopes.join(", ")}.`,
        );
      }
      if (openItems.length > 0) {
        scopeMessages.push(
          `Found ${openItems.length} open review items matching minimum severity '${check.minimumSeverity}'.`,
        );
      }
      return {
        ruleId: gate.id,
        verdict: worstOf(scopeVerdicts),
        reason: scopeMessages.join(" "),
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

function mapMissingAuthoritativeEvidenceVerdict(verdict: GateRule["onMissingEvidence"]): Verdict {
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

function isAuthoritativeExecutionEvidence(evidence: Evidence): boolean {
  switch (evidence.sourceClass) {
    case "tool_output":
      return evidence.toolOutputClass === "command_exec" && isAuthoritative(evidence.provenance);
    case "declared_claim":
      return false;
    default:
      return assertNever(evidence);
  }
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

/**
 * Builds the L0 advisory body for a non-PASS gate verdict (§6.2 Step 2).
 *
 * Pure and I/O-free: the first line summarizes every rule (`ruleId=verdict`),
 * then each non-PASS rule becomes a checklist item. Emits plain PASS/WARN/FAIL
 * text only — decorative emoji live exclusively in the banner layer
 * (`formatBanner`/`iconFor`) per AGENTS.md, so they are never duplicated here.
 */
export function formatGateAdvisoryMessage(
  verdict: Pick<DecisionPayload, "verdict" | "ruleResults">,
): string {
  const lines: string[] = [
    `${verdict.verdict}: ${verdict.ruleResults
      .map((result) => `${result.ruleId}=${result.verdict}`)
      .join(", ")}`,
  ];
  for (const result of verdict.ruleResults) {
    if (result.verdict !== "PASS") {
      lines.push(`- [ ] ${result.ruleId}: ${result.verdict} — ${result.reason}`);
    }
  }
  return lines.join("\n");
}
