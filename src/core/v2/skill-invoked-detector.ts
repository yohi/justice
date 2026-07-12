export type DetectedSkillInvocation = {
  readonly skillName: string;
  readonly source: "skill_tool" | "task_load_skills";
  readonly callId?: string;
};

function withCallId(
  skillName: string,
  source: DetectedSkillInvocation["source"],
  callId: string | undefined,
): DetectedSkillInvocation {
  return callId === undefined ? { skillName, source } : { skillName, source, callId };
}

export function detectSkillInvoked(
  toolName: string,
  args: unknown,
  callId?: string,
): readonly DetectedSkillInvocation[] {
  if (typeof args !== "object" || args === null) return [];

  if (toolName === "skill" && "name" in args) {
    const name = args.name;
    return typeof name === "string" && name.length > 0
      ? [withCallId(name, "skill_tool", callId)]
      : [];
  }

  if (toolName === "task" && "load_skills" in args && Array.isArray(args.load_skills)) {
    return args.load_skills
      .filter((skill): skill is string => typeof skill === "string" && skill.length > 0)
      .map((skill) => withCallId(skill, "task_load_skills", callId));
  }

  return [];
}
