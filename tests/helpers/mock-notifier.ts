import { vi } from "vitest";
import {
  formatBanner,
  type JusticeNotification,
  type JusticeNotifier,
} from "../../src/core/justice-notifier";

export interface MockNotifier extends JusticeNotifier {
  readonly calls: JusticeNotification[];
  readonly banners: string[];
}

export function createMockNotifier(): MockNotifier {
  const calls: JusticeNotification[] = [];
  const banners: string[] = [];

  return {
    calls,
    banners,
    notify: vi.fn(async (notification: JusticeNotification) => {
      calls.push(notification);
    }),
    formatBanner: vi.fn((notification) => {
      const banner = formatBanner(notification);
      banners.push(banner);
      return banner;
    }),
  };
}
