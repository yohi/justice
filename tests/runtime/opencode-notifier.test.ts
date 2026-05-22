import { describe, expect, it, vi } from "vitest";
import { OpenCodeNotifier } from "../../src/runtime/opencode-notifier";
import type { OpenCodeLogEntry } from "../../src/runtime/opencode-adapter";

describe("OpenCodeNotifier", () => {
  it("maps level 'info' → log level 'info' and includes correct fields", async () => {
    const log = vi.fn((_entry: OpenCodeLogEntry) => undefined);
    const notifier = new OpenCodeNotifier(log);

    await notifier.notify({
      level: "info",
      variant: "wisdom_saved",
      title: "Stored",
      message: "Lesson captured.",
    });

    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith({
      level: "info",
      service: "justice",
      message: "💡 [Stored] Lesson captured.",
      extra: {
        variant: "wisdom_saved",
        sessionId: undefined,
        taskId: undefined,
      },
    });
  });

  it("maps level 'success' → log level 'info'", async () => {
    const log = vi.fn(async (_entry: OpenCodeLogEntry) => undefined);
    const notifier = new OpenCodeNotifier(log);

    await notifier.notify({
      level: "success",
      variant: "wisdom_saved",
      title: "Stored",
      message: "Done.",
    });

    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "info",
      }),
    );
  });

  it("maps level 'warning' → log level 'warn'", async () => {
    const log = vi.fn(async (_entry: OpenCodeLogEntry) => undefined);
    const notifier = new OpenCodeNotifier(log);

    await notifier.notify({
      level: "warning",
      variant: "architecture_pivot",
      title: "Pivot",
      message: "Adjust the plan.",
    });

    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warn",
      }),
    );
  });

  it("maps level 'error' → log level 'error'", async () => {
    const log = vi.fn(async (_entry: OpenCodeLogEntry) => undefined);
    const notifier = new OpenCodeNotifier(log);

    await notifier.notify({
      level: "error",
      variant: "escalation",
      title: "Escalation",
      message: "Retry budget exhausted.",
    });

    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "error",
      }),
    );
  });

  it("absorbs log function throws (fail-open)", async () => {
    const log = vi.fn(() => {
      throw new Error("transport failure");
    });
    const notifier = new OpenCodeNotifier(log);

    await expect(
      notifier.notify({
        level: "info",
        variant: "wisdom_saved",
        title: "Stored",
        message: "Saved.",
      }),
    ).resolves.toBeUndefined();
  });

  it("passes sessionId and taskId in extra", async () => {
    const log = vi.fn(async (_entry: OpenCodeLogEntry) => undefined);
    const notifier = new OpenCodeNotifier(log);

    await notifier.notify({
      level: "info",
      variant: "wisdom_saved",
      title: "Stored",
      message: "Saved.",
      sessionId: "session-1",
      taskId: "task-1",
    });

    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        extra: {
          variant: "wisdom_saved",
          sessionId: "session-1",
          taskId: "task-1",
        },
      }),
    );
  });

  it("handles missing sessionId/taskId as undefined", async () => {
    const log = vi.fn(async (_entry: OpenCodeLogEntry) => undefined);
    const notifier = new OpenCodeNotifier(log);

    await notifier.notify({
      level: "info",
      variant: "wisdom_saved",
      title: "Stored",
      message: "Saved.",
    });

    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        extra: {
          variant: "wisdom_saved",
          sessionId: undefined,
          taskId: undefined,
        },
      }),
    );
  });

  it("formats banner with 3-line structure", () => {
    const notifier = new OpenCodeNotifier(vi.fn());

    expect(
      notifier.formatBanner({
        level: "info",
        variant: "wisdom_saved",
        title: "Stored",
        message: "Saved successfully.",
      }),
    ).toBe("> 💡 **JUSTICE NOTIFICATION** [Stored]\n> Saved successfully.\n");
  });
});
