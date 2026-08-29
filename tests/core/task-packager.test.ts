import { describe, expect, it } from "vitest";
import {
  enrichTaskToolInput,
  mergeTaskLoadSkills,
  resolveSkillsFromToolInput,
  TaskPackager,
} from "../../src/core/task-packager";
import type { DelegationRequest } from "../../src/core/types";

describe("TaskPackager", () => {
  const packager = new TaskPackager();

  it("packages a category-only worker payload", () => {
    const request: DelegationRequest = packager.package("sp-implementation", {
      taskId: "task-1",
      prompt: "implement the change",
      loadSkills: ["test-driven-development"],
      runInBackground: true,
      contextTaskId: "parent-1",
    });

    expect(request).toEqual({
      category: "sp-implementation",
      taskId: "task-1",
      loadSkills: ["test-driven-development"],
      prompt: "implement the change",
      runInBackground: true,
      context: { taskId: "parent-1" },
    });
  });

  it("does not alias the caller loadSkills array", () => {
    const loadSkills = ["domain-skill"];
    const request = packager.package("sp-mechanical", {
      taskId: "task-alias",
      prompt: "fix typo",
      loadSkills,
    });

    loadSkills.push("later-skill");

    expect(request.loadSkills).toEqual(["domain-skill"]);
  });

  it("uses the packaged task id when context task id is omitted", () => {
    const request = packager.package("sp-mechanical", {
      taskId: "task-2",
      prompt: "fix typo",
    });

    expect(request.context).toEqual({ taskId: "task-2" });
  });

  it("preserves helper skill merge behavior", () => {
    expect(mergeTaskLoadSkills(
      ["domain-skill", "test-driven-development"],
      ["test-driven-development", "verification-before-completion"],
    )).toEqual([
      "domain-skill",
      "test-driven-development",
      "verification-before-completion",
    ]);
  });

  it("merges and deduplicates all task skill aliases in caller order", () => {
    expect(
      resolveSkillsFromToolInput({
        skills: ["shared-skill", "skills-only"],
        loadSkills: ["shared-skill", "camel-only"],
        load_skills: ["canonical-only", "shared-skill"],
      }),
    ).toEqual(["shared-skill", "skills-only", "camel-only", "canonical-only"]);
  });

  it("preserves task ID and normalizes helper input skills", () => {
    const original = {
      prompt: "run",
      taskId: "task-existing",
      skills: ["domain-skill"],
      load_skills: ["test-driven-development"],
    };

    const enriched = enrichTaskToolInput(original, "task-generated", {
      loadSkills: ["verification-before-completion"],
    });

    expect(enriched).toEqual({
      prompt: "run",
      task_id: "task-existing",
      load_skills: [
        "domain-skill",
        "test-driven-development",
        "verification-before-completion",
      ],
    });
    expect(original).toEqual({
      prompt: "run",
      taskId: "task-existing",
      skills: ["domain-skill"],
      load_skills: ["test-driven-development"],
    });
  });

  it("does not include agent routing fields", () => {
    const request = packager.package("sp-mechanical", {
      taskId: "task-3",
      prompt: "fix typo",
    });
    const payload = request as unknown as Record<string, unknown>;

    expect(payload).not.toHaveProperty("agent");
    expect(payload).not.toHaveProperty("agentId");
    expect(payload).not.toHaveProperty("model");
    expect(payload).not.toHaveProperty("provider");
    expect(payload).not.toHaveProperty("variant");
    expect(payload).not.toHaveProperty("reasoning");
    expect(payload).not.toHaveProperty("fallback_models");
    expect(payload).not.toHaveProperty("subagent_type");
  });

  it("removes forbidden routing fields from the legacy enrichment helper", () => {
    const enriched = enrichTaskToolInput(
      {
        prompt: "run",
        subagent_type: "deep",
        agent: "atlas",
        model: "claude",
        provider: "anthropic",
        variant: "fast",
        reasoning: true,
        fallback_models: ["fallback"],
        skills: ["domain-skill"],
      },
      "task-4",
    );

    expect(enriched).toEqual({
      prompt: "run",
      task_id: "task-4",
      load_skills: ["domain-skill"],
    });
  });
});
