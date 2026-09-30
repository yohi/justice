import { normalizeSafeRelativePath } from "../core/trigger-detector";

const FILE_PATH_KEYS = ["filePath", "file_path", "path"] as const;
const PATCH_TEXT_KEYS = ["patchText", "patch"] as const;
const PATCH_FILE_HEADER = /^\*\*\* (?:Update|Add|Delete) File:\s*(.+?)\s*$/u;
const PATCH_MOVE_HEADER = /^\*\*\* Move to:\s*(.+?)\s*$/u;
const GIT_DIFF_PATH_HEADER = /^(?:---|\+\+\+) (?:(?:a|b)\/)?(.+?)\s*$/u;

function normalizeTargetPaths(rawPaths: readonly string[]): readonly string[] | null {
  if (rawPaths.length === 0) return null;
  const normalized: string[] = [];
  for (const rawPath of rawPaths) {
    const path = normalizeSafeRelativePath(rawPath);
    if (path === null) return null;
    if (!normalized.includes(path)) normalized.push(path);
  }
  return normalized;
}

function readStringFields(
  args: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): readonly string[] {
  return keys.flatMap((key) => {
    const value = args[key];
    return typeof value === "string" && value.length > 0 ? [value] : [];
  });
}

function extractPatchPaths(patch: string): readonly string[] | null {
  const paths: string[] = [];
  let malformedFileHeader = false;
  for (const line of patch.split("\n")) {
    const justiceHeader = line.match(PATCH_FILE_HEADER);
    if (justiceHeader?.[1] !== undefined) {
      paths.push(justiceHeader[1]);
      continue;
    }
    if (/^\*\*\* (?:Update|Add|Delete) File:/u.test(line)) {
      malformedFileHeader = true;
      continue;
    }
    const moveHeader = line.match(PATCH_MOVE_HEADER);
    if (moveHeader?.[1] !== undefined) {
      paths.push(moveHeader[1]);
      continue;
    }
    if (/^\*\*\* Move to:/u.test(line)) {
      malformedFileHeader = true;
      continue;
    }
    const gitHeader = line.match(GIT_DIFF_PATH_HEADER);
    const gitPath = gitHeader?.[1];
    if (gitPath !== undefined && gitPath !== "/dev/null") paths.push(gitPath);
    else if (/^(?:---|\+\+\+) /u.test(line) && !/^(?:---|\+\+\+) \/dev\/null\s*$/u.test(line)) {
      malformedFileHeader = true;
    }
  }
  if (malformedFileHeader) return null;
  return normalizeTargetPaths(paths);
}

export function extractReviewGateToolPaths(
  toolName: string,
  args: Readonly<Record<string, unknown>>,
): readonly string[] | null {
  if (toolName === "edit" || toolName === "write") {
    return normalizeTargetPaths(readStringFields(args, FILE_PATH_KEYS));
  }

  if (toolName !== "apply_patch") return [];
  const patches = readStringFields(args, PATCH_TEXT_KEYS);
  if (patches.length !== 1) return null;
  return extractPatchPaths(patches[0]!);
}
