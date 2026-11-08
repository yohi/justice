import { isSafeIdentifier, type SelectedArtifactRef } from "../s1a/contract.js";
import { parseStrictJson } from "../s1a/strict-json.js";
import type { TaskScopePolicy } from "./contract.js";
import { validateAllowedPaths } from "./path-rules.js";

const MAX_PLAN_BYTES = 8_388_608;
const MAX_POLICY_BYTES = 65_536;
const MAX_POLICY_BLOCKS = 128;
const HEADING = "## Justice S1-c Task Scope Policies";
const BEGIN = "<!-- justice:s1c-task-scope:begin -->";
const END = "<!-- justice:s1c-task-scope:end -->";
const MARKER_PREFIX = "<!-- justice:s1c-task-scope:";

type PolicyReferences = Readonly<{
  planRef: Readonly<{ artifactId: string; revision: string }>;
  taskRef: Readonly<{ artifactId: string; revision: string }>;
  scopeKey: string;
}>;

type Fence = Readonly<{ character: "`" | "~"; length: number }>;
type StrictLine = Readonly<{ content: string; endingBytes: number }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isIgnoredPrefix(line: string): boolean {
  return /^(?: {4,}|\t| {0,3}>| {0,3}(?:[-+*]|\d+[.)])(?:[ \t]|$))/.test(line);
}

function headingLevel(line: string): 1 | 2 | null {
  if (/^#(?:[ \t]+|$)/.test(line)) return 1;
  if (/^##(?:[ \t]+|$)/.test(line)) return 2;
  return null;
}

function openFence(line: string): Fence | null {
  const match = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line);
  const run = match?.[2];
  const info = match?.[3];
  if (run === undefined || info === undefined) return null;
  const character = run[0];
  if ((character !== "`" && character !== "~") || (character === "`" && info.includes("`"))) return null;
  return { character, length: run.length };
}

function closesFence(line: string, fence: Fence): boolean {
  const match = /^( {0,3})(`+|~+)[ \t]*$/.exec(line);
  const run = match?.[2];
  return run !== undefined && run[0] === fence.character && run.length >= fence.length;
}

function updateCommentState(line: string, initiallyOpen: boolean): { readonly isOpen: boolean; readonly hasComment: boolean } {
  let isOpen = initiallyOpen;
  let hasComment = initiallyOpen;
  let cursor = 0;
  while (cursor < line.length) {
    const delimiter = isOpen ? "-->" : "<!--";
    const position = line.indexOf(delimiter, cursor);
    if (position === -1) break;
    hasComment = true;
    cursor = position + delimiter.length;
    isOpen = !isOpen;
  }
  return { isOpen, hasComment };
}

function isPolicyRef(value: unknown): value is Readonly<{ artifactId: string; revision: string }> {
  return isRecord(value) && hasExactKeys(value, ["artifactId", "revision"]) &&
    isSafeIdentifier(value.artifactId) && isSafeIdentifier(value.revision);
}

function parsePolicy(bytes: Uint8Array): (PolicyReferences & Readonly<{ allowedPaths: readonly string[] }>) | null {
  let value: unknown;
  try {
    value = parseStrictJson(bytes, MAX_POLICY_BYTES);
  } catch {
    return null;
  }
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["schemaVersion", "planRef", "taskRef", "scopeKey", "allowedPaths"]) ||
    value.schemaVersion !== "justice-s1c-task-scope-v1" ||
    !isPolicyRef(value.planRef) || !isPolicyRef(value.taskRef) ||
    !isSafeIdentifier(value.scopeKey)
  ) return null;
  const allowedPaths = validateAllowedPaths(value.allowedPaths);
  if (allowedPaths === null) return null;
  return Object.freeze({
    planRef: Object.freeze({ artifactId: value.planRef.artifactId, revision: value.planRef.revision }),
    taskRef: Object.freeze({ artifactId: value.taskRef.artifactId, revision: value.taskRef.revision }),
    scopeKey: value.scopeKey,
    allowedPaths,
  });
}

function strictLines(bytes: Uint8Array): readonly StrictLine[] | null {
  if (bytes.byteLength > MAX_PLAN_BYTES || (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)) return null;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
  if (/(?:^|[^\r])\r(?!\n)/.test(text)) return null;
  return text.split("\n").map((line, index, lines) => {
    const hasLineFeed = index < lines.length - 1;
    const hasCarriageReturn = hasLineFeed && line.endsWith("\r");
    return {
      content: hasCarriageReturn ? line.slice(0, -1) : line,
      endingBytes: hasLineFeed ? (hasCarriageReturn ? 2 : 1) : 0,
    };
  });
}

function refMismatch(policy: PolicyReferences, selected: Readonly<{ plan: SelectedArtifactRef; task: SelectedArtifactRef }>): boolean {
  return policy.taskRef.revision !== selected.task.revision ||
    policy.planRef.artifactId !== selected.plan.artifactId ||
    policy.planRef.revision !== selected.plan.revision ||
    policy.scopeKey !== selected.task.scopeKey;
}

export function extractTaskScopePolicy(
  planBytes: Uint8Array,
  selected: Readonly<{ plan: SelectedArtifactRef; task: SelectedArtifactRef }>,
): { readonly state: "READY"; readonly policy: TaskScopePolicy } | { readonly state: "UNDEFINED" | "INVALID" | "REFERENCE_MISMATCH" } {
  const lines = strictLines(planBytes);
  if (lines === null) return { state: "INVALID" };

  let fence: Fence | null = null;
  let inComment = false;
  let inRegion = false;
  let headingCount = 0;
  let blockOpen = false;
  let blockLines: string[] = [];
  let blockBytes = 0;
  let lastBlockEndingBytes = 0;
  let blockCount = 0;
  const policies: (PolicyReferences & Readonly<{ allowedPaths: readonly string[] }>)[] = [];

  for (const { content: line, endingBytes } of lines) {
    if (fence !== null) {
      if (closesFence(line, fence)) fence = null;
      continue;
    }
    if (inComment) {
      if (line === BEGIN || line === END) continue;
      inComment = updateCommentState(line, true).isOpen;
      continue;
    }
    if (line === BEGIN || line === END) {
      if (!inRegion) continue;
      if (line === BEGIN) {
        if (blockOpen) return { state: "INVALID" };
        blockOpen = true;
        blockLines = [];
        blockBytes = 0;
        lastBlockEndingBytes = 0;
        blockCount += 1;
        if (blockCount > MAX_POLICY_BLOCKS) return { state: "INVALID" };
      } else {
        if (!blockOpen) return { state: "INVALID" };
        blockBytes -= lastBlockEndingBytes;
        if (blockBytes > MAX_POLICY_BYTES) return { state: "INVALID" };
        const json = parsePolicy(new TextEncoder().encode(blockLines.join("\n")));
        if (json === null) return { state: "INVALID" };
        policies.push(json);
        blockOpen = false;
        blockLines = [];
      }
      continue;
    }

    if (blockOpen) {
      if (line.includes(MARKER_PREFIX)) return { state: "INVALID" };
      blockLines.push(line);
      blockBytes += Buffer.byteLength(line, "utf8") + endingBytes;
      lastBlockEndingBytes = endingBytes;
      if (blockBytes - endingBytes > MAX_POLICY_BYTES) return { state: "INVALID" };
      continue;
    }

    const opener = openFence(line);
    if (opener !== null) {
      fence = opener;
      continue;
    }
    if (isIgnoredPrefix(line)) continue;

    if (line === HEADING) {
      headingCount += 1;
      if (headingCount > 1) return { state: "INVALID" };
      inRegion = true;
      continue;
    }
    if (inRegion && headingLevel(line) !== null) inRegion = false;

    if (inRegion && line.includes(MARKER_PREFIX)) return { state: "INVALID" };
    const comment = updateCommentState(line, false);
    inComment = comment.isOpen;
  }

  if (blockOpen) return { state: "INVALID" };
  const selectedPolicies = policies.filter((policy) => policy.taskRef.artifactId === selected.task.artifactId);
  const taskIds = new Set<string>();
  for (const policy of policies) {
    if (taskIds.has(policy.taskRef.artifactId)) return { state: "INVALID" };
    taskIds.add(policy.taskRef.artifactId);
  }
  if (selectedPolicies.length === 0) return { state: "UNDEFINED" };
  const policy = selectedPolicies[0];
  if (policy === undefined) return { state: "INVALID" };
  if (refMismatch(policy, selected)) return { state: "REFERENCE_MISMATCH" };
  return {
    state: "READY",
    policy: Object.freeze({
      schemaVersion: "justice-s1c-task-scope-v1",
      planRef: policy.planRef,
      taskRef: policy.taskRef,
      scopeKey: policy.scopeKey,
      allowedPaths: policy.allowedPaths,
    }),
  };
}
