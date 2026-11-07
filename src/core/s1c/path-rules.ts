import type { ChangedPath } from "./contract.js";

const MAX_PATH_BYTES = 1_024;
const MAX_ENTRIES = 128;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function isSafePath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value, "utf8") > MAX_PATH_BYTES) {
    return false;
  }
  if (value.startsWith("/") || value.includes("\\") || value.includes("*")) return false;
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))) return false;
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) return false;
  const segments = value.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) return false;
  return true;
}

function isAllowedPattern(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const directoryPattern = value.endsWith("/**");
  const path = directoryPattern ? value.slice(0, -3) : value;
  return isSafePath(path) && !path.includes("*");
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function isDenseArray(value: unknown): value is unknown[] {
  if (!Array.isArray(value) || value.length > MAX_ENTRIES) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return true;
}

export function validateAllowedPaths(value: unknown): readonly string[] | null {
  if (!isDenseArray(value)) return null;
  const paths: string[] = [];
  for (const path of value) {
    if (!isAllowedPattern(path)) return null;
    paths.push(path);
  }
  return Object.freeze(paths);
}

function validateChange(value: unknown): ChangedPath | null {
  if (!isPlainRecord(value) || typeof value.kind !== "string") return null;
  switch (value.kind) {
    case "ADD":
    case "MODIFY":
    case "DELETE":
      if (!hasExactKeys(value, ["kind", "path"]) || !isSafePath(value.path)) return null;
      return Object.freeze({ kind: value.kind, path: value.path });
    case "RENAME":
      if (
        !hasExactKeys(value, ["kind", "oldPath", "newPath"]) ||
        !isSafePath(value.oldPath) ||
        !isSafePath(value.newPath)
      ) return null;
      return Object.freeze({ kind: "RENAME", oldPath: value.oldPath, newPath: value.newPath });
    default:
      return null;
  }
}

export function inspectChangeSet(
  value: unknown,
): { state: "PRESENT"; touchedPaths: readonly string[] } | { state: "UNAVAILABLE" } | { state: "INVALID" } {
  if (!isPlainRecord(value) || typeof value.availability !== "string") return { state: "INVALID" };
  if (value.availability === "UNAVAILABLE") {
    return hasExactKeys(value, ["availability"]) ? { state: "UNAVAILABLE" } : { state: "INVALID" };
  }
  if (value.availability !== "PRESENT" || !hasExactKeys(value, ["availability", "changes"]) || !isDenseArray(value.changes)) {
    return { state: "INVALID" };
  }
  const touchedPaths: string[] = [];
  for (const change of value.changes) {
    const valid = validateChange(change);
    if (valid === null) return { state: "INVALID" };
    if (valid.kind === "RENAME") touchedPaths.push(valid.oldPath, valid.newPath);
    else touchedPaths.push(valid.path);
  }
  return { state: "PRESENT", touchedPaths: Object.freeze(touchedPaths) };
}

function isWithin(path: string, allowlist: readonly string[]): boolean {
  return allowlist.some((pattern) =>
    pattern.endsWith("/**") ? path.startsWith(`${pattern.slice(0, -3)}/`) : path === pattern,
  );
}

export function compareCandidatePaths(
  allowlist: readonly string[],
  touchedPaths: readonly string[],
): { comparison: "WITHIN_CANDIDATE_SCOPE" | "OUTSIDE_CANDIDATE_SCOPE"; outsidePaths: readonly string[] } {
  const outside = new Set<string>();
  for (const path of touchedPaths) {
    if (!isWithin(path, allowlist)) outside.add(path);
  }
  const outsidePaths = Object.freeze([...outside].sort(compareUtf8));
  return Object.freeze({
    comparison: outsidePaths.length === 0 ? "WITHIN_CANDIDATE_SCOPE" : "OUTSIDE_CANDIDATE_SCOPE",
    outsidePaths,
  });
}
