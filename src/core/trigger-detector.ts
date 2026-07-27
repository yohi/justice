/* eslint-disable security/detect-unsafe-regex -- Trigger detection relies on fixed message-matching patterns. */
import * as path from "node:path";

import type { WorkflowStartRequest, WorkflowStartSource } from "./types";

export interface PlanReference {
  readonly planPath: string;
}

export interface TriggerAnalysis {
  readonly shouldTrigger: boolean;
  readonly planRef: PlanReference | null;
  /**
   * true の場合、正規表現キーワードでは検出されず、
   * planRef の存在によるフォールバック層で発火したことを示す。
   */
  readonly fallbackTriggered: boolean;
}

export interface TriggerContext {
  readonly lastUserMessage?: string;
}

const PLAN_PATH_REGEX = /(?:^|\s|["'`])([\w./-]+\.md)\b/i;

const DELEGATION_KEYWORDS: RegExp[] = [
  /\bdelegate\b/i,
  /\bnext\s+task\b/i,
  /\b(?:execute|run|start)\s+(?:the\s+)?(?:next\s+)?(?:incomplete\s+)?task/i,
  /次のタスク/,
  /タスクを(?:実行|委譲|開始)/,
  // Phase 1: 日本語の開発現場フレーズ
  /実装(?:して|を開始|をお願い|を進めて)/,
  /作(?:成して|って)/,
  /(?:(?:作成|実装|タスク|issue|チケット).*?(?:進めて|始めて|やって|お願い))|(?:(?:進めて|始めて|やって|お願い).*?(?:作成|実装|タスク|issue|チケット))/i,
  /\b(?:implement|build|create)\s+(?:the\s+)?(?:task|issue|ticket|story|feature|component|module|service|test|code|fix)\b/i,
];

/** `/justice-start` コマンド名 (先頭スラッシュなし) */
export const JUSTICE_START_COMMAND = "justice-start";

/** コマンドを使えないハーネス向けのフォールバックマーカー (完全一致・大文字小文字を区別) */
export const WORKFLOW_START_FALLBACK_MARKER = "Justice: start workflow";

/** `--design` / `--plan` で指定できる成果物パスの種別 */
type ArtifactFlag = "design" | "plan";

const ARTIFACT_FLAGS: ReadonlyMap<string, ArtifactFlag> = new Map<string, ArtifactFlag>([
  ["--design", "design"],
  ["--plan", "plan"],
]);

/**
 * 相対パスを正規化し、安全でない場合は null を返す。
 * 絶対パス・バックスラッシュ・パストラバーサル (..) を拒否する共通ルール。
 */
export function normalizeSafeRelativePath(rawPath: string): string | null {
  if (rawPath.length === 0) return null;

  // Reject absolute paths
  if (path.isAbsolute(rawPath)) return null;

  // Reject backslashes
  if (rawPath.includes("\\")) return null;

  // Reject path traversal segments (..) anywhere in the raw path
  if (rawPath.split("/").includes("..")) return null;

  // Normalize and check for path traversal (..) in normalized path
  const normalized = path.posix.normalize(rawPath);
  if (normalized.split("/").includes("..")) return null;

  // Additional check: reject if it still looks absolute after normalization (e.g. starts with /)
  if (normalized.startsWith("/")) return null;

  return normalized;
}

/**
 * コマンド名が `/justice-start` かを判定する。
 * 先頭スラッシュと前後の空白は許容するが、それ以外は完全一致を要求する。
 */
export function isJusticeStartCommand(commandName: string | undefined): boolean {
  if (commandName === undefined) return false;
  const trimmed = commandName.trim();
  const withoutSlash = trimmed.startsWith("/") ? trimmed.slice(1) : trimmed;
  return withoutSlash === JUSTICE_START_COMMAND;
}

/**
 * `/justice-start` の引数列をパースする。
 *
 * 文法: `<goal words...>` に加えて、任意の `--design <path>` / `--plan <path>` を任意の位置に置ける。
 * 未知のフラグ、値のないフラグ、重複フラグ、安全でないパス、goal 欠落はすべて null (no request) として扱い、
 * 例外は投げない。
 */
export function parseWorkflowStartCommandArguments(
  rawArguments: string | undefined,
): WorkflowStartRequest | null {
  if (rawArguments === undefined) return null;
  return parseWorkflowStartArguments(rawArguments, "command");
}

/**
 * チャットメッセージ中の `Justice: start workflow` フォールバックマーカーをパースする。
 *
 * 誤発動を防ぐため、マーカーはいずれかの行頭 (前後空白を除く) に完全一致で現れる必要がある。
 * 引数として解釈するのはマーカーがある行の残りだけで、後続行は goal に取り込まない。
 */
export function parseWorkflowStartFallbackMarker(
  message: string | undefined,
): WorkflowStartRequest | null {
  if (message === undefined) return null;

  for (const line of message.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(WORKFLOW_START_FALLBACK_MARKER)) continue;
    return parseWorkflowStartArguments(
      trimmed.slice(WORKFLOW_START_FALLBACK_MARKER.length),
      "fallback_marker",
    );
  }

  return null;
}

/**
 * workflow-start の引数文字列を WorkflowStartRequest に変換する共通処理 (副作用なし)。
 */
function parseWorkflowStartArguments(
  rawArguments: string,
  source: WorkflowStartSource,
): WorkflowStartRequest | null {
  const goalWords: string[] = [];
  let designPath: string | null = null;
  let planPath: string | null = null;
  let pendingFlag: ArtifactFlag | null = null;

  for (const token of rawArguments.split(/\s+/)) {
    if (token.length === 0) continue;

    if (pendingFlag !== null) {
      // フラグの値は別のフラグでなく、安全な相対パスでなければならない
      if (token.startsWith("-")) return null;
      const normalized = normalizeSafeRelativePath(token);
      if (normalized === null) return null;

      if (pendingFlag === "design") {
        if (designPath !== null) return null; // 重複指定
        designPath = normalized;
      } else {
        if (planPath !== null) return null; // 重複指定
        planPath = normalized;
      }
      pendingFlag = null;
      continue;
    }

    if (!token.startsWith("-")) {
      goalWords.push(token);
      continue;
    }

    const flag = ARTIFACT_FLAGS.get(token);
    if (flag === undefined) return null; // 未知のフラグ
    pendingFlag = flag;
  }

  if (pendingFlag !== null) return null; // 値のないフラグ

  const goal = goalWords.join(" ");
  if (goal.length === 0) return null; // goal 欠落

  return { source, goal, designPath, planPath };
}

export class TriggerDetector {
  /**
   * Detect a reference to a plan file (*.plan*.md or plan.md) in the message.
   * Normalizes the path and rejects absolute paths, path traversal (..), or backslashes.
   */
  detectPlanReference(message: string): PlanReference | null {
    const match = message.match(PLAN_PATH_REGEX);
    if (match?.[1] === undefined) return null;

    const rawPath = match[1];
    if (!rawPath.toLowerCase().includes("plan")) return null;

    // 絶対パス・バックスラッシュ・パストラバーサルは共通ルールで拒否する
    const normalized = normalizeSafeRelativePath(rawPath);
    if (normalized === null) return null;

    return { planPath: normalized };
  }

  /**
   * Detect delegation intent keywords in the message.
   */
  detectDelegationIntent(message: string): boolean {
    return DELEGATION_KEYWORDS.some((kw) => kw.test(message));
  }

  /**
   * Analyzes if the message should trigger delegation.
   * Returns a combined result of shouldTrigger and planRef.
   */
  analyzeTrigger(message: string, context?: TriggerContext): TriggerAnalysis {
    const planRef = this.detectPlanReference(message);
    const hasIntent = this.detectDelegationIntent(message);

    // Primary path: both planRef AND explicit intent keyword
    if (planRef !== null && hasIntent) {
      return { shouldTrigger: true, planRef, fallbackTriggered: false };
    }

    // Fallback path (Guarded): planRef exists but no explicit keyword detected.
    // To prevent accidental triggers when the assistant just mentions a file,
    // we only allow fallback if the LAST user message also mentions a plan file.
    if (planRef !== null && !hasIntent && context?.lastUserMessage) {
      const userPlanRef = this.detectPlanReference(context.lastUserMessage);
      if (userPlanRef !== null && userPlanRef.planPath === planRef.planPath) {
        return { shouldTrigger: true, planRef, fallbackTriggered: true };
      }
    }

    return { shouldTrigger: false, planRef: null, fallbackTriggered: false };
  }

  /**
   * Combined check: should this message trigger plan-bridge?
   *
   * Triggers in two cases:
   * 1. Primary path: A plan reference AND an explicit delegation intent keyword are found.
   * 2. Fallback path: A plan reference is found even without an explicit keyword (implicit intent), provided that the lastUserMessage also contains the plan reference.
   *
   * @deprecated Use analyzeTrigger() instead to avoid duplicate calls.
   */
  shouldTrigger(message: string, context?: TriggerContext): boolean {
    return this.analyzeTrigger(message, context).shouldTrigger;
  }
}
/* eslint-enable security/detect-unsafe-regex */
