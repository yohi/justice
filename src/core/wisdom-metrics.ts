import type { WisdomEntry } from "./types";
import { WisdomStore } from "./wisdom-store";

export class WisdomMetrics {
  private hitListener?: (entryId: string) => void;

  recordHit(store: WisdomStore, entryId: string, now: Date = new Date()): WisdomEntry | undefined {
    const updated = store.updateMetrics(entryId, (entry) => ({
      ...entry,
      hitCount: (entry.hitCount ?? 0) + 1,
      lastHitAt: now.toISOString(),
      firstSeenAt: entry.firstSeenAt ?? now.toISOString(),
    }));
    if (updated !== undefined) this.hitListener?.(entryId);
    return updated;
  }

  onHit(listener: (entryId: string) => void): void {
    this.hitListener = listener;
  }
}
