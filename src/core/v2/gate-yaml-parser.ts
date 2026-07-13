import { parse as parseYaml } from "yaml";
import * as z from "zod";
import { GateRuleSchema, type GateRule } from "./gate-definition";

const GateConfigSchema = z.object({
  schemaVersion: z.literal(1),
  authority: z.literal("human_approved"),
  // authorship は現時点では常に null 固定（authority: "human_approved" と対をなす placeholder）。
  // 将来的に gate 定義の作成者を文字列で記録する要件が生じた場合に string を許容する拡張を想定している。
  authorship: z.null().optional(),
  gates: z.array(GateRuleSchema),
});

export function parseGateYaml(content: string): readonly GateRule[] {
  const parsed = parseYaml(content);
  const validated = GateConfigSchema.parse(parsed);
  return validated.gates;
}
