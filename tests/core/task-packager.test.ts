import { describe, expect, it } from "vitest";
import { TaskPackager } from "../../src/core/task-packager";

describe("TaskPackager", () => {
  const packager = new TaskPackager();

  it("packages a category-only worker payload", () => {
    const request = packager.package("sp-implementation", {
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

  it("uses the packaged task id when context task id is omitted", () => {
    const request = packager.package("sp-mechanical", {
      taskId: "task-2",
      prompt: "fix typo",
    });

    expect(request.context).toEqual({ taskId: "task-2" });
  });

  it("does not include agent routing fields", () => {
    const request = packager.package("sp-mechanical", {
      taskId: "task-3",
      prompt: "fix typo",
    });
    const payload = request as Record<string, unknown>;

    expect(payload).not.toHaveProperty("agent");
    expect(payload).not.toHaveProperty("agentId");
    expect(payload).not.toHaveProperty("model");
    expect(payload).not.toHaveProperty("provider");
    expect(payload).not.toHaveProperty("variant");
    expect(payload).not.toHaveProperty("reasoning");
    expect(payload).not.toHaveProperty("fallback_models");
    expect(payload).not.toHaveProperty("subagent_type");
  });
});
