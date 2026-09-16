import { normalizeSafeRelativePath } from "./trigger-detector";
import type { PersistedLogRecord, ErrorAnnotationObservation } from "./v2/observation-model";
import { hashString } from "./v2/hash";

const ERROR_ANNOTATION_REGEX = /^> ⚠️ \*\*Error\*\*:/u;

type MigrationWarning = {
  readonly kind: "unmatched_error_annotation";
  readonly lineNumber: number;
};

export type MigrationResult = {
  readonly content: string;
  readonly warnings: ReadonlyArray<MigrationWarning>;
};

function normalizeEol(raw: string): string {
  return raw.replace(/\r\n/g, "\n");
}

function occurrenceAt(lines: readonly string[], lineNumber: number): number {
  const line = lines[lineNumber - 1];
  return lines.slice(0, lineNumber).filter((candidate) => candidate === line).length;
}

function isObservedErrorAnnotation(
  record: PersistedLogRecord,
): record is PersistedLogRecord & ErrorAnnotationObservation {
  return record.recordType === "observation" && record.kind === "error_annotation";
}

export function createErrorAnnotationObservation(
  planPath: string,
  rawBeforeAnnotation: string,
  lineNumber: number,
): ErrorAnnotationObservation {
  const normalizedPath = normalizeSafeRelativePath(planPath);
  const lines = normalizeEol(rawBeforeAnnotation).split("\n");
  const line = lines[lineNumber - 1];
  if (normalizedPath === null || line === undefined || !Number.isSafeInteger(lineNumber) || lineNumber < 1) {
    throw new Error("Cannot identify an error annotation line");
  }

  return {
    recordType: "observation",
    kind: "error_annotation",
    provenance: "observed",
    planPath: normalizedPath,
    planPathDigest: hashString(normalizedPath),
    planSnapshotDigest: hashString(lines.join("\n")),
    target: {
      lineNumber,
      occurrence: occurrenceAt(lines, lineNumber),
      normalizedLineDigest: hashString(line),
    },
  };
}

export function migrateJusticeGeneratedErrorAnnotations(
  raw: string,
  planPath: string,
  observations: readonly PersistedLogRecord[],
): MigrationResult {
  const normalized = normalizeEol(raw);
  const normalizedPath = normalizeSafeRelativePath(planPath);
  const lines = normalized.split("\n");
  const rawDigest = hashString(normalized);
  const normalizedPathDigest =
    normalizedPath === null ? undefined : hashString(normalizedPath);
  const removeIndexes = new Set<number>();
  const representedIndexes = new Set<number>();
  const warnings: MigrationWarning[] = [];

  for (const record of observations) {
    if (!isObservedErrorAnnotation(record)) continue;

    const index = record.target.lineNumber - 1;
    const line = lines[index];
    if (index >= 0) {
      if (index < lines.length) representedIndexes.add(index);
    }
    const matchesLine =
      line !== undefined &&
      occurrenceAt(lines, record.target.lineNumber) === record.target.occurrence &&
      hashString(line) === record.target.normalizedLineDigest;
    if (matchesLine && ERROR_ANNOTATION_REGEX.test(line)) representedIndexes.add(index);

    const canRemove =
      record.provenance === "observed" &&
      normalizedPath !== null &&
      (record.planPathDigest === undefined
        ? record.planPath === normalizedPath
        : record.planPathDigest === normalizedPathDigest) &&
      record.planSnapshotDigest === rawDigest &&
      matchesLine &&
      line !== undefined &&
      ERROR_ANNOTATION_REGEX.test(line);
    if (canRemove) {
      removeIndexes.add(index);
    } else {
      warnings.push({ kind: "unmatched_error_annotation", lineNumber: record.target.lineNumber });
    }
  }

  for (const [index, line] of lines.entries()) {
    if (ERROR_ANNOTATION_REGEX.test(line) && !removeIndexes.has(index) && !representedIndexes.has(index)) {
      warnings.push({ kind: "unmatched_error_annotation", lineNumber: index + 1 });
    }
  }

  return {
    content: lines.filter((_, index) => !removeIndexes.has(index)).join("\n"),
    warnings,
  };
}
