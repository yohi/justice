import { describe, it, expect } from "vitest";
import { WisdomPersistence } from "../../src/core/wisdom-persistence";
import { createMockFileReader, createMockFileWriter } from "../helpers/mock-file-system";

describe("WisdomPersistence", () => {
  const defaultPath = ".justice/wisdom.json";

  it("should save and load wisdom entries round-trip", async () => {
    const writer = createMockFileWriter();
    const persistence = new WisdomPersistence(createMockFileReader({}), writer, defaultPath);

    // Start with an empty store then populate it
    const store = await persistence.load();
    store.add({ taskId: "t1", category: "success_pattern", content: "Works!" });
    store.add({
      taskId: "t2",
      category: "failure_gotcha",
      content: "Careful with async",
      errorClass: "timeout",
    });

    await persistence.save(store);
    expect(writer.writtenFiles[defaultPath]).toBeDefined();

    // Load from the saved JSON
    const reader2 = createMockFileReader({ [defaultPath]: writer.writtenFiles[defaultPath] ?? "" });
    const persistence2 = new WisdomPersistence(reader2, createMockFileWriter(), defaultPath);
    const restored = await persistence2.load();

    const all = restored.getRelevant();
    expect(all).toHaveLength(2);
    expect(all).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ taskId: "t1", category: "success_pattern" }),
        expect.objectContaining({ taskId: "t2", errorClass: "timeout" }),
      ]),
    );
  });

  it("should return empty WisdomStore when file does not exist", async () => {
    const reader = createMockFileReader({}); // no files
    const persistence = new WisdomPersistence(
      reader,
      createMockFileWriter(),
      ".justice/nonexistent.json",
    );

    const store = await persistence.load();
    expect(store.getRelevant()).toHaveLength(0);
  });

  it("should handle corrupted JSON gracefully and return empty store", async () => {
    const reader = createMockFileReader({ [defaultPath]: "this is not valid json{{{{" });
    const persistence = new WisdomPersistence(reader, createMockFileWriter(), defaultPath);

    const store = await persistence.load();
    expect(store.getRelevant()).toHaveLength(0);
  });
});
