import type { AgentId, ErrorClass, WisdomCategory } from "./types";

export const DEFAULT_PERSONA: AgentId = "hephaestus";

export interface PersonaClassificationInput {
  readonly category?: WisdomCategory;
  readonly errorClass?: ErrorClass;
}

export function classifyPersona(input: PersonaClassificationInput): AgentId {
  if (input.errorClass === "design_error") {
    return "atlas";
  }

  if (input.errorClass === "loop_detected" || input.errorClass === "timeout") {
    return "sisyphus";
  }

  if (input.category === "design_decision") {
    return "atlas";
  }

  if (input.category === "environment_quirk") {
    return "sisyphus";
  }

  if (input.category === "success_pattern" || input.category === "failure_gotcha") {
    // success_pattern / failure_gotcha は仕様書 §3-4 により明示的に hephaestus へルーティング
    return "hephaestus";
  }

  return DEFAULT_PERSONA;
}

export class PersonaClassifier {
  static classify(input: PersonaClassificationInput): AgentId {
    return classifyPersona(input);
  }
}
