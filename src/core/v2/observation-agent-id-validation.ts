// src/core/v2/observation-agent-id-validation.ts
import type { ObservationAgentId } from "../types";

const SAFE_OBSERVATION_AGENT_IDS: readonly ObservationAgentId[] = [
  "hephaestus",
  "sisyphus",
  "prometheus",
  "atlas",
  "system",
  "unknown",
];

export function isSafeObservationAgentId(id: string): boolean {
  return (SAFE_OBSERVATION_AGENT_IDS as readonly string[]).includes(id);
}
