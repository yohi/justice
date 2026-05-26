import { describe, expect, it } from "vitest";
import {
  DEFAULT_PERSONA,
  PersonaClassifier,
  classifyPersona,
} from "../../src/core/persona-classifier";

describe("PersonaClassifier", () => {
  it("exports hephaestus as the default persona", () => {
    expect(DEFAULT_PERSONA).toBe("hephaestus");
  });

  it.each([
    [{ errorClass: "design_error" }, "atlas", "design errors route to Atlas"],
    [{ errorClass: "loop_detected" }, "sisyphus", "loop detection routes to Sisyphus"],
    [{ errorClass: "timeout" }, "sisyphus", "timeouts route to Sisyphus"],
    [{ category: "design_decision" }, "atlas", "design decisions route to Atlas"],
    [{ category: "environment_quirk" }, "sisyphus", "environment quirks route to Sisyphus"],
    [{ category: "success_pattern" }, "hephaestus", "success patterns route to Hephaestus"],
    [{ category: "failure_gotcha" }, "hephaestus", "failure gotchas route to Hephaestus"],
    [
      { category: "success_pattern", errorClass: "syntax_error" },
      "hephaestus",
      "syntax_error falls through to category routing",
    ],
    [
      { category: "design_decision", errorClass: "provider_transient" },
      "atlas",
      "unhandled errorClass falls through to design_decision routing",
    ],
    [
      { category: "environment_quirk", errorClass: "type_error" },
      "sisyphus",
      "unhandled errorClass falls through to environment_quirk routing",
    ],
    [{}, "hephaestus", "empty input uses the default persona"],
    [{ errorClass: "unknown" }, "hephaestus", "unknown errors use the default persona"],
    [
      { category: "success_pattern", errorClass: "design_error" },
      "atlas",
      "design errors outrank success pattern categories",
    ],
    [
      { category: "design_decision", errorClass: "timeout" },
      "sisyphus",
      "timeout errors outrank design decision categories",
    ],
    [
      { category: "environment_quirk", errorClass: "design_error" },
      "atlas",
      "design errors outrank environment quirk categories",
    ],
  ] as const)("classifies %s as %s: %s", (input, expected, _description) => {
    expect(PersonaClassifier.classify(input)).toBe(expected);
    expect(classifyPersona(input)).toBe(expected);
  });
});
