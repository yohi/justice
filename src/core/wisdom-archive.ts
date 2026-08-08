import type { WisdomEntry } from "./types";
import type { AtomicPersistence, SaveResult } from "./atomic-persistence";

export type ArchiveReason = "high_priority_category" | "hit_count_threshold";

export interface ArchivedWisdom {
  readonly id: string;
  readonly taskId: string;
  readonly category: WisdomEntry["category"];
  readonly content: string;
  readonly archivedAt: string;
  readonly archiveReason: ArchiveReason;
  readonly hitCount?: number;
}

export interface ArchiveThresholds {
  readonly environmentQuirkMinHits: number;
}

export class WisdomArchive {
  constructor(
    private readonly persistence: AtomicPersistence<readonly ArchivedWisdom[]>,
    private readonly thresholds: ArchiveThresholds = { environmentQuirkMinHits: 3 },
  ) {}

  shouldArchive(entry: WisdomEntry): { readonly archive: boolean; readonly reason?: ArchiveReason } {
    if (entry.category === "failure_gotcha" || entry.category === "design_decision") {
      return { archive: true, reason: "high_priority_category" };
    }
    if (
      entry.category === "environment_quirk" &&
      (entry.hitCount ?? 0) >= this.thresholds.environmentQuirkMinHits
    ) {
      return { archive: true, reason: "hit_count_threshold" };
    }
    return { archive: false };
  }

  async append(entry: WisdomEntry, reason: ArchiveReason): Promise<SaveResult> {
    const current = await this.persistence.loadWithLock();
    const archived: ArchivedWisdom = {
      id: entry.id,
      taskId: entry.taskId,
      category: entry.category,
      content: entry.content,
      archivedAt: new Date().toISOString(),
      archiveReason: reason,
      ...(entry.hitCount === undefined ? {} : { hitCount: entry.hitCount }),
    };
    const next = [...current.data, archived];
    return this.persistence.saveAtomicWithLock(next, current.lockMeta);
  }

  async loadAll(): Promise<readonly ArchivedWisdom[]> {
    return (await this.persistence.loadWithLock()).data;
  }
}
