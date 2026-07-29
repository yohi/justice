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

  if (toolName === "task") {
    let rawSkills: unknown;
    if ("loadSkills" in args) {
      rawSkills = args.loadSkills;
    } else if ("load_skills" in args) {
      rawSkills = args.load_skills;
    } else {
      rawSkills = undefined;
    }
    if (!Array.isArray(rawSkills)) return [];

    const normalizedSkills = new Set(
      rawSkills.filter((skill): skill is string => typeof skill === "string" && skill.length > 0),
    );
    return [...normalizedSkills].map((skill) => withCallId(skill, "task_load_skills", callId));
  }

  return [];
}
