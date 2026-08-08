import { describe, expect, it } from "vitest";
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
    expect(snapshot.errorDistribution.unknown).toBe(0.5);
  });
});
