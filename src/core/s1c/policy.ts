import { isSafeIdentifier, type SelectedArtifactRef } from "../s1a/contract.js";
import { parseStrictJson } from "../s1a/strict-json.js";
import { MAX_PLAN_BYTES, type TaskScopePolicy } from "./contract.js";
import { validateAllowedPaths } from "./path-rules.js";
import { hasExactKeys, isRecord } from "./shared-utils.js";

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
type ParsedPolicy = PolicyReferences & Readonly<{ allowedPaths: readonly string[] }>;
type BlockScanState = {
  blockOpen: boolean;
  blockLines: string[];
  blockBytes: number;
  lastBlockEndingBytes: number;
  blockCount: number;
  policies: ParsedPolicy[];
};

function isIgnoredPrefix(line: string): boolean {
  return /^(?: {4,}|\t| {0,3}>| {0,3}(?:[-+*]|\d+[.)])(?:[ \t]|$))/.test(line);
}

function headingLevel(line: string): 1 | 2 | null {
  if (/^ {0,3}#(?:[ \t]+|$)/.test(line)) return 1;
  if (/^ {0,3}##(?:[ \t]+|$)/.test(line)) return 2;
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

function updateCommentState(line: string, initiallyOpen: boolean): boolean {
  let isOpen = initiallyOpen;
  let cursor = 0;
  while (cursor < line.length) {
    const delimiter = isOpen ? "-->" : "<!--";
    const position = line.indexOf(delimiter, cursor);
    if (position === -1) break;
    cursor = position + delimiter.length;
    isOpen = !isOpen;
  }
  return isOpen;
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
    let endingBytes = 0;
    if (hasLineFeed) {
      endingBytes = 1;
      if (hasCarriageReturn) endingBytes += 1;
    }
    return { content: hasCarriageReturn ? line.slice(0, -1) : line, endingBytes };
  });
}

function refMismatch(policy: PolicyReferences, selected: Readonly<{ plan: SelectedArtifactRef; task: SelectedArtifactRef }>): boolean {
  return policy.taskRef.revision !== selected.task.revision ||
    policy.planRef.artifactId !== selected.plan.artifactId ||
    policy.planRef.revision !== selected.plan.revision ||
    policy.scopeKey !== selected.task.scopeKey;
}

function processBlockMarker(line: string, inRegion: boolean, state: BlockScanState): "CONTINUE" | "INVALID" | "NOT_MARKER" {
  if (line !== BEGIN && line !== END) return "NOT_MARKER";
  if (!inRegion) return "CONTINUE";
  if (line === BEGIN) {
    if (state.blockOpen) return "INVALID";
    state.blockOpen = true;
    state.blockLines = [];
    state.blockBytes = 0;
    state.lastBlockEndingBytes = 0;
    state.blockCount += 1;
    return state.blockCount > MAX_POLICY_BLOCKS ? "INVALID" : "CONTINUE";
  }

  if (!state.blockOpen) return "INVALID";
  state.blockBytes -= state.lastBlockEndingBytes;
  if (state.blockBytes > MAX_POLICY_BYTES) return "INVALID";
  const policy = parsePolicy(new TextEncoder().encode(state.blockLines.join("\n")));
  if (policy === null) return "INVALID";
  state.policies.push(policy);
  state.blockOpen = false;
  state.blockLines = [];
  return "CONTINUE";
}

function appendBlockLine(line: string, endingBytes: number, state: BlockScanState): "CONTINUE" | "INVALID" {
  if (line.includes(MARKER_PREFIX)) return "INVALID";
  state.blockLines.push(line);
  state.blockBytes += Buffer.byteLength(line, "utf8") + endingBytes;
  state.lastBlockEndingBytes = endingBytes;
  return state.blockBytes - endingBytes > MAX_POLICY_BYTES ? "INVALID" : "CONTINUE";
}

/** Extracts the unique, validated scope policy bound to the selected Plan and Task. */
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
  const blocks: BlockScanState = {
    blockOpen: false,
    blockLines: [],
    blockBytes: 0,
    lastBlockEndingBytes: 0,
    blockCount: 0,
    policies: [],
  };

  for (const { content: line, endingBytes } of lines) {
    if (fence !== null) {
      if (closesFence(line, fence)) fence = null;
      continue;
    }
    if (inComment) {
      if (line === BEGIN || line === END) continue;
      inComment = updateCommentState(line, true);
      continue;
    }
    const markerResult = processBlockMarker(line, inRegion, blocks);
    if (markerResult === "INVALID") return { state: "INVALID" };
    if (markerResult === "CONTINUE") {
      continue;
    }

    if (blocks.blockOpen) {
      if (appendBlockLine(line, endingBytes, blocks) === "INVALID") return { state: "INVALID" };
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
    inComment = updateCommentState(line, false);
  }

  if (blocks.blockOpen) return { state: "INVALID" };
  const selectedPolicies = blocks.policies.filter((policy) => policy.taskRef.artifactId === selected.task.artifactId);
  const taskIds = new Set<string>();
  for (const policy of blocks.policies) {
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
