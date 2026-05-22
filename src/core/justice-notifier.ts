export type NotificationLevel = "info" | "success" | "warning" | "error";

export type NotificationVariant =
  | "atlas_orchestration"
  | "architecture_pivot"
  | "sisyphus_insight"
  | "escalation"
  | "wisdom_saved"
  | "loop_detected";

export interface JusticeNotification {
  readonly level: NotificationLevel;
  readonly variant: NotificationVariant;
  readonly title: string;
  readonly message: string;
  readonly sessionId?: string;
  readonly taskId?: string;
}

export interface JusticeNotifier {
  /**
   * Notify the user about a Justice event.
   *
   * Fail-open contract: implementations must absorb all exceptions and never rethrow.
   */
  notify(notification: JusticeNotification): void | Promise<void>;
  formatBanner(notification: Omit<JusticeNotification, "sessionId" | "taskId">): string;
}

export function iconFor(variant: NotificationVariant): string {
  switch (variant) {
    case "atlas_orchestration":
      return "🎯";
    case "architecture_pivot":
      return "🚧";
    case "sisyphus_insight":
      return "🔬";
    case "escalation":
      return "🚨";
    case "wisdom_saved":
      return "💡";
    case "loop_detected":
      return "🔁";
  }
}

export function formatBanner(
  notification: Omit<JusticeNotification, "sessionId" | "taskId">,
): string {
  const icon = iconFor(notification.variant);

  return [
    `> ${icon} **JUSTICE NOTIFICATION** [${notification.title}]`,
    `> ${notification.message}`,
    "",
  ].join("\n");
}

export class NoOpNotifier implements JusticeNotifier {
  notify(_notification: JusticeNotification): undefined {
    return undefined;
  }

  formatBanner(notification: Omit<JusticeNotification, "sessionId" | "taskId">): string {
    void notification;
    return "";
  }
}
