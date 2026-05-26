import {
  formatBanner as coreFormatBanner,
  iconFor,
  type JusticeNotification,
  type JusticeNotifier,
  type NotificationLevel,
} from "../core/justice-notifier";
import type { OpenCodeLogEntry } from "./opencode-adapter";

const LOG_LEVEL_BY_NOTIFICATION_LEVEL: Readonly<
  Record<NotificationLevel, OpenCodeLogEntry["level"]>
> = {
  info: "info",
  success: "info",
  warning: "warn",
  error: "error",
};

export class OpenCodeNotifier implements JusticeNotifier {
  readonly #log: (entry: OpenCodeLogEntry) => Promise<void> | void;

  constructor(log: (entry: OpenCodeLogEntry) => Promise<void> | void) {
    this.#log = log;
  }

  async notify(notification: JusticeNotification): Promise<void> {
    try {
      await this.#log({
        level: LOG_LEVEL_BY_NOTIFICATION_LEVEL[notification.level],
        service: "justice",
        message: `${iconFor(notification.variant)} [${notification.title}] ${notification.message}`,
        extra: {
          variant: notification.variant,
          sessionId: notification.sessionId,
          taskId: notification.taskId,
        },
      });
    } catch {
      // fail-open: notifications must never throw
    }
  }

  formatBanner(notification: Omit<JusticeNotification, "sessionId" | "taskId">): string {
    return coreFormatBanner(notification);
  }
}
