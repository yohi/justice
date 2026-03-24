import { describe, it, expect } from "vitest";
import { PlanBridgeCore } from "../../src/core/plan-bridge-core";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { mkdirSync } from "node:fs";

// vitest doesn't have __dirname by default in ES modules without setup,
// but let's assume it resolves correctly or use import.meta.url
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Ensure the fixtures directory exists
const fixturesDir = resolve(__dirname, "../fixtures");
if (!existsSync(fixturesDir)) {
  mkdirSync(fixturesDir, { recursive: true });
}

const samplePlanPath = resolve(fixturesDir, "sample-plan.md");
const samplePlanContent = [
  "## Setup",
  "- [x] Create project",
  "- [ ] Setup project structure",
].join("\n");

if (!existsSync(samplePlanPath)) {
  writeFileSync(samplePlanPath, samplePlanContent, "utf-8");
}

const samplePlan = readFileSync(samplePlanPath, "utf-8");

describe("PlanBridgeCore", () => {
  const core = new PlanBridgeCore();

  describe("buildDelegationFromPlan", () => {
    it("should parse plan and build DelegationRequest for next incomplete task", () => {
      const result = core.buildDelegationFromPlan(samplePlan, {
        planFilePath: "docs/plans/sample-plan.md",
        referenceFiles: ["src/feature-x.ts"],
      });

      expect(result).not.toBeNull();
      // wait, the taskId might vary depending on how PlanParser assigns IDs, but plan-parser.ts defaults to step titles if no ID
      // let's just check the prompt contains the text.
      expect(result!.prompt).toContain("Setup project structure");
      expect(result!.context.planFilePath).toBe("docs/plans/sample-plan.md");
    });

    it("should return null when all tasks are completed", () => {
      const completedPlan =
        "## Task 1: Done\n- [x] Step 1\n- [x] Step 2\n";
      const result = core.buildDelegationFromPlan(completedPlan, {
        planFilePath: "plan.md",
        referenceFiles: [],
      });

      expect(result).toBeNull();
    });

    it("should skip completed tasks and return the next incomplete one", () => {
      const partialPlan = [
        "## Task 1: Done",
        "- [x] All done",
        "## Task 2: WIP",
        "- [ ] Do this",
        "- [ ] And this",
      ].join("\n");

      const result = core.buildDelegationFromPlan(partialPlan, {
        planFilePath: "plan.md",
        referenceFiles: [],
      });

      expect(result).not.toBeNull();
      expect(result!.prompt).toContain("Do this");
    });

    it("should include rolePrompt when provided", () => {
      const result = core.buildDelegationFromPlan(samplePlan, {
        planFilePath: "plan.md",
        referenceFiles: [],
        rolePrompt: "You are a senior TypeScript engineer.",
      });

      expect(result).not.toBeNull();
      expect(result!.prompt).toContain("You are a senior TypeScript engineer.");
    });

    it("should include previousLearnings when provided", () => {
      const result = core.buildDelegationFromPlan(samplePlan, {
        planFilePath: "plan.md",
        referenceFiles: [],
        previousLearnings: "Always use strict mode.",
      });

      expect(result).not.toBeNull();
      expect(result!.prompt).toContain("Always use strict mode.");
    });
  });
});
