const SKILL_SOURCES = ["skill_tool", "task_load_skills"] as const;

export function isValidSkillInvokedRecord(record: Readonly<Record<string, unknown>>): boolean {
  return (
    typeof record.skillName === "string" &&
    record.skillName.length > 0 &&
    SKILL_SOURCES.some((source) => source === record.source) &&
    (record.callId === undefined || typeof record.callId === "string")
  );
}
