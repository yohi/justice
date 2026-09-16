import type {
  CanonicalPlanSnapshot,
  CanonicalTaskSnapshot,
  PlanFingerprint,
} from "./types";
import { hashString } from "./v2/hash";

const TASK_HEADING_REGEX = /^#{2,3}\s+Task\s+(\d+):\s*(.+)$/u;
const CHECKBOX_REGEX = /^(\s*-\s+\[)[ xX](\]\s+.+)$/u;
const FENCE_REGEX = /^\s*(```|~~~)/u;

type FenceKind = "```" | "~~~";

type TaskSection = {
  readonly taskId: string;
  readonly title: string;
  readonly start: number;
  readonly end: number;
};

type CanonicalDocument = {
  readonly content: string;
  readonly sections: ReadonlyArray<TaskSection>;
};

function normalizeEol(raw: string): string {
  return raw.replace(/\r\n/g, "\n");
}

function advanceFence(fenceKind: FenceKind | null, line: string): FenceKind | null {
  const marker = line.match(FENCE_REGEX)?.[1];
  if (marker !== "```" && marker !== "~~~") return fenceKind;
  if (fenceKind === null) return marker;
  return fenceKind === marker ? null : fenceKind;
}

function findTaskSections(lines: readonly string[]): ReadonlyArray<TaskSection> {
  const sections: TaskSection[] = [];
  let fenceKind: FenceKind | null = null;
  let current: Omit<TaskSection, "end"> | null = null;

  for (const [index, line] of lines.entries()) {
    fenceKind = advanceFence(fenceKind, line);
    if (fenceKind !== null) continue;

    const heading = line.match(TASK_HEADING_REGEX);
    if (heading?.[1] === undefined || heading[2] === undefined) continue;

    if (current !== null) {
      sections.push({ ...current, end: index });
    }
    current = {
      taskId: `task-${parseInt(heading[1], 10)}`,
      title: heading[2].trim(),
      start: index,
    };
  }

  if (current !== null) {
    sections.push({ ...current, end: lines.length });
  }
  return sections;
}

function canonicalize(raw: string, approvedTaskIds: readonly string[]): CanonicalDocument {
  const lines = normalizeEol(raw).split("\n");
  const approved = new Set(approvedTaskIds);
  const sections = findTaskSections(lines);
  const sectionCounts = new Map<string, number>();
  for (const section of sections) {
    if (approved.has(section.taskId)) {
      sectionCounts.set(section.taskId, (sectionCounts.get(section.taskId) ?? 0) + 1);
    }
  }
  const normalizable = new Set(
    sections
      .filter((section) => approved.has(section.taskId) && sectionCounts.get(section.taskId) === 1)
      .map((section) => section.start),
  );
  const canonicalLines = [...lines];
  let fenceKind: FenceKind | null = null;
  let activeSectionStart: number | null = null;

  for (const [index, line] of lines.entries()) {
    fenceKind = advanceFence(fenceKind, line);
    if (fenceKind !== null) continue;

    const heading = line.match(TASK_HEADING_REGEX);
    if (heading !== null) {
      activeSectionStart = index;
      continue;
    }
    if (activeSectionStart === null || !normalizable.has(activeSectionStart)) continue;

    const checkbox = line.match(CHECKBOX_REGEX);
    if (checkbox?.[1] !== undefined && checkbox[2] !== undefined) {
      canonicalLines[index] = `${checkbox[1]} ${checkbox[2]}`;
    }
  }

  return { content: canonicalLines.join("\n"), sections };
}

export function buildCanonicalSnapshot(
  raw: string,
  approvedTaskIds: readonly string[],
): CanonicalPlanSnapshot {
  const normalized = normalizeEol(raw);
  const canonical = canonicalize(normalized, approvedTaskIds);
  const approved = new Set(approvedTaskIds);
  const sectionCounts = new Map<string, number>();
  for (const section of canonical.sections) {
    if (approved.has(section.taskId)) {
      sectionCounts.set(section.taskId, (sectionCounts.get(section.taskId) ?? 0) + 1);
    }
  }

  const tasks: CanonicalTaskSnapshot[] = canonical.sections
    .filter((section) => approved.has(section.taskId) && sectionCounts.get(section.taskId) === 1)
    .map((section) => {
      const canonicalBody = canonical.content.split("\n").slice(section.start, section.end).join("\n");
      return {
        taskId: section.taskId,
        title: section.title,
        canonicalBody,
        digest: hashString(canonicalBody),
      };
    });
  const approvedLineIndexes = new Set(
    canonical.sections
      .filter((section) => approved.has(section.taskId) && sectionCounts.get(section.taskId) === 1)
      .flatMap((section) => Array.from({ length: section.end - section.start }, (_, i) => section.start + i)),
  );
  const globalBody = normalized
    .split("\n")
    .filter((_, index) => !approvedLineIndexes.has(index))
    .join("\n");

  return {
    schema: "justice-plan-v1",
    documentDigest: hashString(canonical.content),
    globalBodyDigest: hashString(globalBody),
    tasks,
  };
}

export function computePlanFingerprint(
  raw: string,
  approvedTaskIds: readonly string[],
): PlanFingerprint {
  return {
    algorithm: "sha256",
    value: hashString(canonicalize(raw, approvedTaskIds).content).replace("sha256:", ""),
  };
}
