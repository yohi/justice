import { describe, it, expect, afterEach } from "vitest";
import { NodeFileSystem } from "../../src/runtime/node-file-system";
import { WisdomPersistence } from "../../src/core/wisdom-persistence";
import { WisdomStore } from "../../src/core/wisdom-store";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("WisdomPersistence Integration (Real FS)", () => {
  let tempDir: string | null = null;

  afterEach(async () => {
    if (tempDir) {
      try {
        await rm(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors in tests
      }
      tempDir = null;
    }
  });

  it("should handle concurrent saveAtomic calls using real filesystem locking", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "justice-test-"));
    const fs = new NodeFileSystem(tempDir);
    const wisdomPath = "wisdom.json";
    const persistence = new WisdomPersistence(fs, fs, wisdomPath);

    // Prepare two stores with different entries
    const store1 = new WisdomStore();
    store1.add({ taskId: "t1", category: "success_pattern", content: "concurrent-1" });

    const store2 = new WisdomStore();
    store2.add({ taskId: "t2", category: "failure_pattern", content: "concurrent-2" });

    // Trigger concurrent saveAtomic calls.
    // The lock mechanism (.lock directory) should ensure they don't overwrite each other.
    await Promise.all([
      persistence.saveAtomic(store1),
      persistence.saveAtomic(store2),
    ]);

    // Load the final state and verify both entries exist
    const finalStore = await persistence.load();
    const entries = finalStore.getAllEntries();
    
    expect(entries).toHaveLength(2);
    const contents = entries.map(e => e.content);
    expect(contents).toContain("concurrent-1");
    expect(contents).toContain("concurrent-2");
  });
});
