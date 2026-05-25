import type { AgentId, TaskCategory } from "./types";
import { ReviewRejectionDetector } from "./review-rejection-detector";

const PENDING_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_PENDING_SESSIONS = 50;

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
          guidance:
            `Prometheus pivot: the review rejected the current approach. Rework the plan around the rejection signals and address these blockers first:\n${rejection.summary}`,
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
   * B phase: Record that a skill invocation is pending for a session.
   * Inspects toolInput to detect which skills are being invoked and
   * estimates the persona that will execute them.
   */
  recordPreToolUseInvocation(
    sessionId: string,
    toolName: string,
    toolInput: Record<string, unknown>,
  ): void {
    if (toolName !== "task") return;

    this.cleanupExpired();

    const skills = this.extractSkills(toolInput);
    const detectedPersona = this.inferPersonaFromInput(toolInput);

    if (skills.length === 0 && !detectedPersona) return;

    const now = Date.now();
    const existing = this.pendingMap.get(sessionId);

    const skillTargets = existing
      ? new Set([...existing.skillTargets, ...skills])
      : new Set(skills);

    this.pendingMap.set(sessionId, {
      skillTargets,
      lastAccess: now,
    });

    if (detectedPersona) {
      this.personaMap.set(sessionId, { agentId: detectedPersona, lastAccess: now });
    }
  }

  /**
   * A phase: Evaluate whether a skill has completed.
   * If a pending flag exists → high confidence.
   * If no pending, checks result text markers → medium confidence.
   * Clears only the (sessionId, target) pending flag after evaluation.
   */
  evaluateSkillCompletion(
    sessionId: string,
    toolName: string,
    toolResult: string,
    isError: boolean,
    target: SkillTarget,
  ): PlanCompletionSignal | null {
    if (isError) return null;
    if (toolName !== "task") return null;

    this.cleanupExpired();

    const pending = this.pendingMap.get(sessionId);
    const hasPending = pending?.skillTargets.has(target) ?? false;

    if (hasPending) {
      // Clear only this target's pending flag
      pending!.skillTargets.delete(target);
      if (pending!.skillTargets.size === 0) {
        this.pendingMap.delete(sessionId);
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
    return this.personaMap.get(sessionId)?.agentId;
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

    // LRU eviction if still over limit
    if (this.pendingMap.size > MAX_PENDING_SESSIONS) {
      const sorted = [...this.pendingMap.entries()].sort(
        (a, b) => a[1].lastAccess - b[1].lastAccess,
      );
      const toRemove = sorted.slice(0, this.pendingMap.size - MAX_PENDING_SESSIONS);
      for (const [key] of toRemove) {
        this.pendingMap.delete(key);
      }
    }

    if (this.personaMap.size > MAX_PENDING_SESSIONS) {
      const sorted = [...this.personaMap.entries()].sort(
        (a, b) => a[1].lastAccess - b[1].lastAccess,
      );
      const toRemove = sorted.slice(0, this.personaMap.size - MAX_PENDING_SESSIONS);
      for (const [key] of toRemove) {
        this.personaMap.delete(key);
      }
    }
  }

  private extractSkills(toolInput: Record<string, unknown>): SkillTarget[] {
    const skills: SkillTarget[] = [];

    const skillList = this.getStringArray(toolInput.skills) ?? this.getStringArray(toolInput.loadSkills);
    if (skillList) {
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
    if (
      !skills.includes("systematic-debugging") &&
      /\bsystematic-debugging\b/.test(textToSearch)
    ) {
      skills.push("systematic-debugging");
    }

    return skills;
  }

  private inferPersonaFromInput(toolInput: Record<string, unknown>): AgentId | undefined {
    // Priority 1: explicit agent field
    const agent = this.getString(toolInput.agent);
    if (agent) {
      const lower = agent.toLowerCase();
      if (["atlas", "hephaestus", "sisyphus", "prometheus"].includes(lower)) {
        return lower as AgentId;
      }
    }

    // Priority 2-4: skills mapping
    const skillList = this.getStringArray(toolInput.skills) ?? this.getStringArray(toolInput.loadSkills);
    if (skillList) {
      if (skillList.includes("code-quality-reviewer")) return "prometheus";
      if (skillList.includes("systematic-debugging")) return "sisyphus";
      if (skillList.includes("writing-plans") || skillList.includes("brainstorming")) return "atlas";
    }

    // Priority 5: role / prompt partial match
    const role = this.getString(toolInput.role);
    const prompt = this.getString(toolInput.prompt);
    const textToSearch = `${role ?? ""} ${prompt ?? ""}`;

    if (/\bcode-quality-reviewer\b/.test(textToSearch)) return "prometheus";
    if (/\bsystematic-debugging\b/.test(textToSearch)) return "sisyphus";
    if (/\bwriting-plans\b/.test(textToSearch) || /\bbrainstorming\b/.test(textToSearch)) return "atlas";

    return undefined;
  }

  private detectFromResult(
    toolResult: string,
    target: SkillTarget,
  ): PlanCompletionSignal | null {
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
      const hasRootCause =
        /Root\s*cause:/i.test(toolResult) || /根本原因[:：]/.test(toolResult);
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

  private getStringArray(value: unknown): string[] | undefined {
    if (Array.isArray(value)) {
      const result = value.filter((v): v is string => typeof v === "string");
      if (result.length > 0) return result;
    }
    return undefined;
  }
}
