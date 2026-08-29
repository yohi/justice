import type { AgentId, TaskCategory } from "./types";
import { ReviewRejectionDetector } from "./review-rejection-detector";
import { resolveSkillsFromToolInput } from "./task-packager";

const PENDING_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_PENDING_ENTRIES = 50;

const PERSONA_IDS: readonly AgentId[] = ["hephaestus", "sisyphus", "prometheus", "atlas"];

function inferPersonaFromToolInput(
  toolInput: Readonly<Record<string, unknown>>,
): AgentId | undefined {
  const explicitAgent =
    typeof toolInput.agent === "string" ? toolInput.agent.toLowerCase() : undefined;
  const skills = resolveSkillsFromToolInput(toolInput);
  const text = [toolInput.role, toolInput.prompt]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();

  if (
    skills.includes("code-quality-reviewer") ||
    skills.includes("spec-reviewer") ||
    /\b(?:code-quality-reviewer|spec-reviewer)\b/.test(text)
  ) {
    return "prometheus";
  }
  if (skills.includes("systematic-debugging") || /\bsystematic-debugging\b/.test(text)) {
    return "sisyphus";
  }
  if (skills.includes("writing-plans") || /\bwriting-plans\b/.test(text)) {
    return "atlas";
  }
  if (explicitAgent && PERSONA_IDS.includes(explicitAgent as AgentId)) {
    return explicitAgent as AgentId;
  }
  return undefined;
}

export type SkillTarget = "writing-plans" | "systematic-debugging";

export interface PlanCompletionInput {
  readonly prompt: string;
  readonly category: TaskCategory;
  readonly skillName?: string;
  readonly completed: boolean;
  readonly rawOutput?: string;
}

export type CompletionTrigger =
  | "writing_category"
  | "systematic_debugging_skill"
  | "code_review_rejection";

export interface CompletionResult {
  readonly persona: AgentId;
  readonly trigger: CompletionTrigger;
  readonly guidance: string;
}

export interface PlanCompletionSignal {
  readonly source: "skill_marker" | "result_marker" | "result_path";
  readonly planFilePath?: string;
  readonly confidence: "high" | "medium";
}

interface PendingRecord {
  readonly skillTargets: Set<SkillTarget>;
  readonly lastAccess: number;
}

interface PersonaRecord {
  readonly agentId: AgentId;
  readonly lastAccess: number;
}

/**
 * Detects completion of specific skills (writing-plans, systematic-debugging)
 * using an A+B hybrid approach:
 *   B phase: recordPreToolUseInvocation captures skill startup intent
 *   A phase: evaluateSkillCompletion checks results against markers
 *
 * Also provides a backward-compatible detectCompletion() for simple cases.
 */
export class PlanCompletionDetector {
  private readonly reviewRejectionDetector = new ReviewRejectionDetector();
  private readonly pendingMap = new Map<string, PendingRecord>();
  private readonly personaMap = new Map<string, PersonaRecord>();
  private readonly lastInvokedPersonaMap = new Map<string, PersonaRecord>();

  // ─── Legacy simple detection ───

  detectCompletion(input: PlanCompletionInput): CompletionResult | null {
    if (!input.completed) {
      return null;
    }

    if (input.skillName === "systematic-debugging") {
      return {
        persona: "sisyphus",
        trigger: "systematic_debugging_skill",
        guidance:
          "Sisyphus insight: isolate the failure, reproduce it with the smallest possible case, and verify the fix with a focused test.",
      };
    }

    if (input.skillName === "code-review" && input.rawOutput) {
      const rejection = this.reviewRejectionDetector.detect(input.rawOutput);
      if (rejection.matched) {
        return {
          persona: "prometheus",
          trigger: "code_review_rejection",
          guidance: `Prometheus pivot: the review rejected the current approach. Rework the plan around the rejection signals and address these blockers first:\n${rejection.summary}`,
        };
      }
    }

    if (input.category === "writing") {
      return {
        persona: "atlas",
        trigger: "writing_category",
        guidance:
          "Atlas guidance: capture the completed work as documentation, a changelog entry, or a concise handoff note.",
      };
    }

    return null;
  }

  // ─── A+B hybrid detection ───

  /**
   * B phase: Record that a skill invocation is pending for a task call.
   * Inspects toolInput to detect which skills are being invoked and
   * estimates the persona that will execute them.
   */
  recordPreToolUseInvocation(
    sessionId: string,
    callId: string | undefined,
    toolName: string,
    toolInput: Record<string, unknown>,
  ): void {
    if (toolName !== "task") return;

    this.cleanupExpired();
    const completionKey = this.getCompletionKey(sessionId, callId);

    const skills = this.extractSkills(toolInput);
    const detectedPersona = inferPersonaFromToolInput(toolInput);

    if (skills.length === 0 && !detectedPersona) {
      this.personaMap.delete(completionKey);
      this.lastInvokedPersonaMap.delete(sessionId);
      return;
    }

    const now = Date.now();

    // Only create/update pendingMap when skills were detected
    if (skills.length > 0) {
      const existing = this.pendingMap.get(completionKey);
      const skillTargets = existing
        ? new Set([...existing.skillTargets, ...skills])
        : new Set(skills);

      this.pendingMap.set(completionKey, {
        skillTargets,
        lastAccess: now,
      });
    }

    if (detectedPersona) {
      const personaRecord = { agentId: detectedPersona, lastAccess: now };
      this.personaMap.set(completionKey, personaRecord);
      this.lastInvokedPersonaMap.set(sessionId, personaRecord);
    }
  }

  /**
   * A phase: Evaluate whether a skill has completed.
   * If a pending flag exists → high confidence.
   * If no pending, checks result text markers → medium confidence.
   * Clears only the (sessionId, callId, target) pending flag after evaluation.
   */
  evaluateSkillCompletion(
    sessionId: string,
    callId: string | undefined,
    toolName: string,
    toolResult: string,
    isError: boolean,
    target: SkillTarget,
  ): PlanCompletionSignal | null {
    if (isError) return null;
    if (toolName !== "task") return null;

    this.cleanupExpired();
    const completionKey = this.getCompletionKey(sessionId, callId);

    const pending = this.pendingMap.get(completionKey);
    const hasPending = pending?.skillTargets.has(target) ?? false;

    if (hasPending && pending) {
      // Clear only this target's pending flag
      pending.skillTargets.delete(target);
      if (pending.skillTargets.size === 0) {
        this.pendingMap.delete(completionKey);
      }

      return {
        source: "skill_marker",
        confidence: "high",
      };
    }

    // No pending flag — check result markers
    return this.detectFromResult(toolResult, target);
  }

  /**
   * Returns the last estimated persona for a session based on PreToolUse input.
   */
  lastInvokedPersona(sessionId: string): AgentId | undefined {
    this.cleanupExpired();
    return this.lastInvokedPersonaMap.get(sessionId)?.agentId;
  }

  // ─── Private helpers ───

  private cleanupExpired(): void {
    const now = Date.now();

    for (const [key, record] of this.pendingMap.entries()) {
      if (now - record.lastAccess > PENDING_TTL_MS) {
        this.pendingMap.delete(key);
      }
    }

    for (const [key, record] of this.personaMap.entries()) {
      if (now - record.lastAccess > PENDING_TTL_MS) {
        this.personaMap.delete(key);
      }
    }

    for (const [key, record] of this.lastInvokedPersonaMap.entries()) {
      if (now - record.lastAccess > PENDING_TTL_MS) {
        this.lastInvokedPersonaMap.delete(key);
      }
    }

    // LRU eviction if still over limit
    if (this.pendingMap.size > MAX_PENDING_ENTRIES) {
      const sorted = [...this.pendingMap.entries()].sort(
        (a, b) => a[1].lastAccess - b[1].lastAccess,
      );
      const toRemove = sorted.slice(0, this.pendingMap.size - MAX_PENDING_ENTRIES);
      for (const [key] of toRemove) {
        this.pendingMap.delete(key);
      }
    }

    if (this.personaMap.size > MAX_PENDING_ENTRIES) {
      const sorted = [...this.personaMap.entries()].sort(
        (a, b) => a[1].lastAccess - b[1].lastAccess,
      );
      const toRemove = sorted.slice(0, this.personaMap.size - MAX_PENDING_ENTRIES);
      for (const [key] of toRemove) {
        this.personaMap.delete(key);
      }
    }

    if (this.lastInvokedPersonaMap.size > MAX_PENDING_ENTRIES) {
      const sorted = [...this.lastInvokedPersonaMap.entries()].sort(
        (a, b) => a[1].lastAccess - b[1].lastAccess,
      );
      const toRemove = sorted.slice(0, this.lastInvokedPersonaMap.size - MAX_PENDING_ENTRIES);
      for (const [key] of toRemove) {
        this.lastInvokedPersonaMap.delete(key);
      }
    }
  }

  private getCompletionKey(sessionId: string, callId: string | undefined): string {
    return `${sessionId}:${callId ?? "_"}`;
  }

  private extractSkills(toolInput: Record<string, unknown>): SkillTarget[] {
    const skills: SkillTarget[] = [];

    const skillList = resolveSkillsFromToolInput(toolInput);
    if (skillList.length > 0) {
      if (skillList.includes("writing-plans") || skillList.includes("brainstorming")) {
        skills.push("writing-plans");
      }
      if (skillList.includes("systematic-debugging")) {
        skills.push("systematic-debugging");
      }
    }

    const role = this.getString(toolInput.role);
    const prompt = this.getString(toolInput.prompt);
    const textToSearch = `${role ?? ""} ${prompt ?? ""}`;

    if (
      !skills.includes("writing-plans") &&
      (/\bwriting-plans\b/.test(textToSearch) || /\bbrainstorming\b/.test(textToSearch))
    ) {
      skills.push("writing-plans");
    }
    if (!skills.includes("systematic-debugging") && /\bsystematic-debugging\b/.test(textToSearch)) {
      skills.push("systematic-debugging");
    }

    return skills;
  }

  private detectFromResult(toolResult: string, target: SkillTarget): PlanCompletionSignal | null {
    if (target === "writing-plans") {
      // Check for plan file path
      const planPathMatch = toolResult.match(
        /docs\/superpowers\/specs\/\d{4}-\d{2}-\d{2}-[^\s]+-design\.md/,
      );
      if (planPathMatch) {
        return {
          source: "result_path",
          confidence: "medium",
          planFilePath: planPathMatch[0],
        };
      }

      // Check for Architecture + Implementation headers
      const hasArchitecture = /##\s*Architecture/.test(toolResult);
      const hasImplementation = /##\s*Implementation/.test(toolResult);
      if (hasArchitecture && hasImplementation) {
        return {
          source: "result_marker",
          confidence: "medium",
        };
      }
    }

    if (target === "systematic-debugging") {
      const hasRootCause = /Root\s*cause:/i.test(toolResult) || /根本原因[:：]/.test(toolResult);
      if (hasRootCause) {
        return {
          source: "result_marker",
          confidence: "medium",
        };
      }
    }

    return null;
  }

  private getString(value: unknown): string | undefined {
    if (typeof value === "string") return value;
    return undefined;
  }
}
