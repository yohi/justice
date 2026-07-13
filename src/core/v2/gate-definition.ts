import * as z from "zod";

export const GateCheckSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("evidence_outcome"),
    evidenceKind: z.enum(["test", "build", "lint"]),
    requireOutcome: z.enum(["pass", "fail"]),
  }),
  z.object({
    type: z.literal("evidence_present"),
    evidenceKind: z.enum(["test", "build", "lint"]),
  }),
  z.object({
    type: z.literal("review_open_items"),
    minimumSeverity: z.enum(["critical", "major", "minor"]).default("major"),
  }),
]);

export const GateRuleSchema = z.object({
  id: z.string().trim().min(1),
  description: z.string().optional(),
  gateType: z.literal("task"),
  trigger: z.object({
    on: z.enum(["task_complete", "tool_observed"]),
  }),
  check: GateCheckSchema,
  onViolation: z.enum(["pass", "warn", "fail"]),
  onMissingEvidence: z.enum(["pass", "warn", "fail"]),
  enabled: z.boolean().default(true),
});

export type GateCheck = z.infer<typeof GateCheckSchema>;
export type GateRule = z.infer<typeof GateRuleSchema>;
