import { readFileSync } from "node:fs";
import { globSync } from "glob";
import { describe, expect, it } from "vitest";

describe("FF-001", () => {
  it("src/core does not import @opencode-ai/*", () => {
    const files = globSync("src/core/**/*.ts", {
      ignore: ["**/*.test.ts"],
    });

    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      // The file list comes from the architecture test's source glob.
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const content = readFileSync(file, "utf-8");
      const importsOpenCode = content.split("\n").some((line) => {
        const statement = line.trim();
        return (
          (statement.startsWith("import") || statement.startsWith("from ")) &&
          statement.includes("@opencode-ai/")
        );
      });
      expect(importsOpenCode).toBe(false);
    }
  });
});
