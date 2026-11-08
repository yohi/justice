import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import packageJson from "../../package.json";
import { jsonBytes, s1aFixture, sha256 } from "../helpers/s1a-fixtures.js";
import { execFileSync } from "node:child_process";

describe("justice-s1d built entry", () => {
  it("binEntryMatchesPackage", async () => {
    const fixture = s1aFixture();
    const directory = await mkdtemp(join(tmpdir(), "justice-s1d-cli-"));
    try {
      const manifest = join(directory, "manifest.json");
      const intent = join(directory, "intent.json");
      const evidence = join(directory, "evidence.json");
      const changeset = join(directory, "changeset.json");
      await Promise.all([
        writeFile(manifest, jsonBytes(fixture.manifest)), writeFile(intent, jsonBytes(fixture.intent)),
        writeFile(evidence, jsonBytes([])), writeFile(changeset, jsonBytes({ availability: "PRESENT", changes: [] })),
        ...Object.entries(fixture.files).map(([path, bytes]) => writeFile(join(directory, path), bytes)),
      ]);
      const command = join(process.cwd(), "dist/runtime/s1d-cli.js");
      const stdout = execFileSync(command, ["diagnose", "--manifest", manifest, "--manifest-sha256", sha256(jsonBytes(fixture.manifest)),
        "--intent", intent, "--artifacts-root", directory, "--evidence", evidence, "--changeset", changeset, "--format", "json"],
      { encoding: "utf8", cwd: directory });
      expect(JSON.parse(stdout).readOnly).toBe(true);
      expect(packageJson.bin).toMatchObject({ justice: "./dist/runtime/doctor-cli.js", "justice-s1a": "./dist/runtime/s1a-cli.js", "justice-s1d": "./dist/runtime/s1d-cli.js" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
