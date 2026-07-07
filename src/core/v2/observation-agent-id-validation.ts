// src/core/v2/observation-agent-id-validation.ts
import type { ObservationAgentId } from "../types";

const SAFE_OBSERVATION_AGENT_ID_SET: Record<ObservationAgentId, true> = {
  hephaestus: true,
  sisyphus: true,
  prometheus: true,
  atlas: true,
  system: true,
  unknown: true,
};

export function isSafeObservationAgentId(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(SAFE_OBSERVATION_AGENT_ID_SET, id);
}
