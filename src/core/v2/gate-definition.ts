import * as z from "zod";

export const GateCheckSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("evidence_outcome"),
    evidenceKind: z.enum(["test", "build", "lint"]),
    requireOutcome: z.enum(["pass", "fail"]),
  }),
  z.strictObject({
    type: z.literal("evidence_present"),
    evidenceKind: z.enum(["test", "build", "lint"]),
  }),
  z.strictObject({
    type: z.literal("review_open_items"),
    minimumSeverity: z.enum(["critical", "major", "minor"]).default("major"),
  }),
]);

export const GateRuleSchema = z.strictObject({
  // id は YAML の手書き揃え崩れ（先頭/末尾の空白混入）を吸収するため意図的に trim() する。
  // gate.id は常にこのパース後の値同士で比較される（YAML原文との突合せは行わない）ため、
  // 入力値とのズレは実害を生まない。
  id: z.string().trim().min(1),
  description: z.string().optional(),
  gateType: z.literal("task"),
  trigger: z.strictObject({
    on: z.enum(["task_complete", "tool_observed"]),
  }),
  check: GateCheckSchema,
  onViolation: z.enum(["pass", "warn", "fail"]),
  onMissingEvidence: z.enum(["pass", "warn", "fail"]),
  enabled: z.boolean().default(true),
});

export type GateCheck = z.infer<typeof GateCheckSchema>;
export type GateRule = z.infer<typeof GateRuleSchema>;
