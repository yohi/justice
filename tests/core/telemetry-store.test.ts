import { describe, expect, it, vi } from "vitest";
import { TelemetryStore } from "../../src/core/telemetry-store";
import { createMockFileReader, createMockFileWriter } from "../helpers/mock-file-system";

describe("TelemetryStore", () => {
  it("computes task failure and same-task wisdom hit rates", () => {
    const telemetry = new TelemetryStore(createMockFileReader({}), createMockFileWriter());

    telemetry.recordWisdomInjection(["w-1"], "task-1");
    telemetry.recordWisdomHit("w-1", "task-1");
    telemetry.recordTaskCompleted("task-1", "success");
    telemetry.recordTaskCompleted("task-2", "failure", "test_failure");

    const snapshot = telemetry.computeSnapshot();

    expect(snapshot.failureRate).toBe(0.5);
    expect(snapshot.wisdomHitRate).toBe(1);
    expect(snapshot.errorDistribution.test_failure).toBe(0.5);
    expect(snapshot.errorDistribution.unknown).toBe(0);
  });

  it("does not classify successful tasks as unknown errors", () => {
    const telemetry = new TelemetryStore(createMockFileReader({}), createMockFileWriter());
    telemetry.recordTaskCompleted("task", "success");

    const snapshot = telemetry.computeSnapshot();

    expect(snapshot.errorDistribution.unknown).toBe(0);
    expect(Object.values(snapshot.errorDistribution).every((value) => value === 0)).toBe(true);
  });

  it("loads persisted events and ignores malformed telemetry payloads", async () => {
    const writer = createMockFileWriter();
    const reader = createMockFileReader({
      ".justice/telemetry.json": JSON.stringify([
        { type: "task_completed", taskId: "t", status: "success", timestamp: "2026-01-01T00:00:00Z" },
      ]),
    });
    const telemetry = new TelemetryStore(reader, writer);
    await telemetry.load();
    expect(telemetry.computeSnapshot().windowSize).toBe(1);

    const malformed = new TelemetryStore(
      createMockFileReader({ ".justice/telemetry.json": "not-json" }),
      writer,
    );
    await expect(malformed.load()).resolves.toBeUndefined();

    const invalidEvent = new TelemetryStore(
      createMockFileReader({
        ".justice/telemetry.json": JSON.stringify([
          { type: "task_completed", timestamp: "2026-01-01T00:00:00Z" },
        ]),
      }),
      writer,
    );
    await invalidEvent.load();
    expect(invalidEvent.computeSnapshot().windowSize).toBe(0);
  });

  it("saves telemetry through a temporary file and rename", async () => {
    const writer = createMockFileWriter();
    const telemetry = new TelemetryStore(createMockFileReader({}), writer);
    telemetry.recordTaskCompleted("task", "success");

    await telemetry.save();

    expect(writer.writtenFiles[".justice/telemetry.json"]).toBeDefined();
  });

  it("uses distinct temporary paths for concurrent saves", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1);
    const writer = createMockFileWriter();
    const writtenPaths: string[] = [];
    writer.writeFile = vi.fn(async (path, content) => {
      writtenPaths.push(path);
      writer.writtenFiles[path] = content;
    });
    const telemetry = new TelemetryStore(createMockFileReader({}), writer);

    await Promise.all([telemetry.save(), telemetry.save()]);

    expect(new Set(writtenPaths).size).toBe(2);
    vi.restoreAllMocks();
  });
});
