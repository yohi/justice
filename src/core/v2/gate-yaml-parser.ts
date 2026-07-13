import { parse as parseYaml } from "yaml";
import * as z from "zod";
import { GateRuleSchema, type GateRule } from "./gate-definition";

const GateConfigSchema = z.object({
  schemaVersion: z.literal(1),
  authority: z.literal("human_approved"),
  authorship: z.null().optional(),
  gates: z.array(GateRuleSchema),
});

export function parseGateYaml(content: string): readonly GateRule[] {
  const parsed = parseYaml(content);
  const validated = GateConfigSchema.parse(parsed);
  return validated.gates;
}
