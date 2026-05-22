import { describe, expect, it } from "vitest";
import {
  NoOpNotifier,
  type JusticeNotifier,
  formatBanner,
  iconFor,
  type JusticeNotification,
} from "../../src/core/justice-notifier";
import { createMockNotifier } from "../helpers/mock-notifier";

describe("justice-notifier", () => {
  it.each([
    ["atlas_orchestration", "🎯"],
    ["architecture_pivot", "🚧"],
    ["sisyphus_insight", "🔬"],
    ["escalation", "🚨"],
    ["wisdom_saved", "💡"],
    ["loop_detected", "🔁"],
  ] as const)("maps %s to %s", (variant, icon) => {
    expect(iconFor(variant)).toBe(icon);
  });

  const cases = [
    {
      level: "info",
      variant: "atlas_orchestration",
      title: "Atlas",
      message: "Delegation is in motion.",
      expected: "> 🎯 **JUSTICE NOTIFICATION** [Atlas]\n> Delegation is in motion.\n",
    },
    {
      level: "success",
      variant: "wisdom_saved",
      title: "Learning stored",
      message: "Captured the latest lesson.",
      expected: "> 💡 **JUSTICE NOTIFICATION** [Learning stored]\n> Captured the latest lesson.\n",
    },
    {
      level: "warning",
      variant: "architecture_pivot",
      title: "Pivot required",
      message: "Adjust the plan structure.",
      expected: "> 🚧 **JUSTICE NOTIFICATION** [Pivot required]\n> Adjust the plan structure.\n",
    },
    {
      level: "error",
      variant: "escalation",
      title: "Escalation",
      message: "Retry budget exhausted.",
      expected: "> 🚨 **JUSTICE NOTIFICATION** [Escalation]\n> Retry budget exhausted.\n",
    },
    {
      level: "info",
      variant: "sisyphus_insight",
      title: "Insight",
      message: "The loop pattern is visible.",
      expected: "> 🔬 **JUSTICE NOTIFICATION** [Insight]\n> The loop pattern is visible.\n",
    },
    {
      level: "warning",
      variant: "loop_detected",
      title: "Loop detected",
      message: "Same path was repeated.",
      expected: "> 🔁 **JUSTICE NOTIFICATION** [Loop detected]\n> Same path was repeated.\n",
    },
  ] satisfies Array<JusticeNotification & { expected: string }>;

  it.each(cases)("formats banner for %s/%s", ({ level, variant, title, message, expected }) => {
    expect(formatBanner({ level, variant, title, message })).toBe(expected);
  });

  it("keeps the three-line banner structure when the message is empty", () => {
    expect(
      formatBanner({
        level: "info",
        variant: "wisdom_saved",
        title: "Saved",
        message: "",
      }),
    ).toBe("> 💡 **JUSTICE NOTIFICATION** [Saved]\n> \n");
  });

  it("NoOpNotifier absorbs notify and returns empty banners", async () => {
    const notifier = new NoOpNotifier();
    const notification: JusticeNotification = {
      level: "info",
      variant: "wisdom_saved",
      title: "Stored",
      message: "Saved successfully.",
      sessionId: "session-1",
      taskId: "task-1",
    };

    expect(notifier.notify(notification)).toBeUndefined();
    expect(
      notifier.formatBanner({
        level: notification.level,
        variant: notification.variant,
        title: notification.title,
        message: notification.message,
      }),
    ).toBe("");
  });

  it("records mock notifier calls and rendered banners", async () => {
    const notifier = createMockNotifier();
    const notification: JusticeNotification = {
      level: "warning",
      variant: "architecture_pivot",
      title: "Pivot",
      message: "Reconsider the architecture.",
      sessionId: "session-1",
      taskId: "task-1",
    };

    await notifier.notify(notification);
    const banner = notifier.formatBanner({
      level: notification.level,
      variant: notification.variant,
      title: notification.title,
      message: notification.message,
    });

    expect(notifier.calls).toEqual([notification]);
    expect(notifier.banners).toEqual([banner]);
  });

  it("documents that fail-open notifier implementations absorb synchronous failures", () => {
    class ThrowingFailOpenNotifier implements JusticeNotifier {
      notify(_notification: JusticeNotification): void {
        try {
          throw new Error("sync transport failure");
        } catch {
          // JusticeNotifier implementations must absorb transport failures.
        }
      }

      formatBanner(notification: Omit<JusticeNotification, "sessionId" | "taskId">): string {
        return formatBanner(notification);
      }
    }

    const notifier: JusticeNotifier = new ThrowingFailOpenNotifier();
    const notification: JusticeNotification = {
      level: "error",
      variant: "escalation",
      title: "Escalation",
      message: "Provider configuration failed.",
    };

    expect(() => notifier.notify(notification)).not.toThrow();
  });
});
