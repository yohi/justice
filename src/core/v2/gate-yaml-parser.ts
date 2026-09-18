import { parse as parseYaml } from "yaml";
import * as z from "zod";
import { GateRuleSchema, type GateRule } from "./gate-definition";

const GateConfigSchema = z.strictObject({
  schemaVersion: z.literal(1),
  authority: z.literal("human_approved"),
  // authorship は現時点では常に null 固定（authority: "human_approved" と対をなす placeholder）。
  // 将来的に gate 定義の作成者を文字列で記録する要件が生じた場合に string を許容する拡張を想定している。
  authorship: z.null().optional(),
  gates: z.array(GateRuleSchema),
});

export function parseGateYaml(content: string): readonly GateRule[] {
  const parsed = parseYaml(content);
  const normalized = isRecord(parsed) && Array.isArray(parsed.gates)
    ? {
        ...parsed,
        gates: parsed.gates.map((gate) => normalizeTaskGate(gate)),
      }
    : parsed;
  const validated = GateConfigSchema.parse(normalized);
  return validated.gates;
}

function normalizeTaskGate(gate: unknown): unknown {
  if (!isRecord(gate) || gate.gateType !== "task" || !isRecord(gate.trigger)) return gate;
  if (gate.trigger.scope !== undefined) return gate;
  return { ...gate, trigger: { ...gate.trigger, scope: "task" } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
