import type { AgentId, TaskCategory } from "./types";

/**
 * AgentRouter のルーティング判定で使用するカテゴリ。
 * `TaskCategory` を内包しつつ、より細かいルーティング意図を表す
 * `bugfix` / `feature` を追加で受け入れる。
 */
export type RoutingCategory = TaskCategory | "bugfix" | "feature";

/** 既知のエージェント ID 一覧（スコア計算の走査順を確定させるため readonly tuple で保持） */
export const AGENT_IDS = ["hephaestus", "sisyphus", "prometheus", "atlas"] as const;

/**
 * Affinity Matrix:
 *   skill (Superpowers / Wisdom 由来) → 各エージェントのベーススコア
 * 値が大きいほど、その skill を遂行するうえで適性が高い。
 */
const AFFINITY_MATRIX: ReadonlyMap<string, Readonly<Record<AgentId, number>>> = new Map([
  ["implementer-prompt", { hephaestus: 10, sisyphus: 3, prometheus: 0, atlas: 2 }],
  ["systematic-debugging", { hephaestus: 2, sisyphus: 10, prometheus: 0, atlas: 1 }],
  ["code-quality-reviewer", { hephaestus: 0, sisyphus: 0, prometheus: 10, atlas: 0 }],
  ["spec-reviewer", { hephaestus: 0, sisyphus: 0, prometheus: 10, atlas: 1 }],
  ["test-driven-development", { hephaestus: 6, sisyphus: 8, prometheus: 2, atlas: 1 }],
  ["writing-plans", { hephaestus: 1, sisyphus: 1, prometheus: 1, atlas: 10 }],
  ["brainstorming", { hephaestus: 2, sisyphus: 2, prometheus: 2, atlas: 9 }],
]);

/**
 * Dominant Override:
 *   特定 skill が含まれていた場合、スコア計算より前段で
 *   物理的に対象エージェントへ強制ルーティングする。
 *   実装者が自分のコードをレビューする「自己レビュー競合」を防止するため、
 *   レビュー系スキルは必ず prometheus に固定する。
 */
const DOMINANT_OVERRIDES: ReadonlyMap<string, AgentId> = new Map<string, AgentId>([
  ["code-quality-reviewer", "prometheus"],
  ["spec-reviewer", "prometheus"],
]);

interface ContextMultiplierRule {
  readonly category: RoutingCategory;
  readonly skill: string;
  readonly multiplier: number;
}

/**
 * Context Multiplier:
 *   (RoutingCategory, skill) の組合せに対するスコア倍率。
 *   例: bugfix × systematic-debugging → x1.5（sisyphus に追い風）
 */
const CONTEXT_MULTIPLIERS: readonly ContextMultiplierRule[] = [
  { category: "bugfix", skill: "systematic-debugging", multiplier: 1.5 },
  { category: "feature", skill: "implementer-prompt", multiplier: 1.5 },
];

/** 検索用 Map の構築 (O(1) ルックアップ用) */
const CONTEXT_MULTIPLIER_MAP: ReadonlyMap<string, number> = new Map(
  CONTEXT_MULTIPLIERS.map((m) => [`${m.category}:${m.skill}`, m.multiplier]),
);

const DEFAULT_FALLBACK: AgentId = "hephaestus";

export type RoutingReason = "dominant_override" | "score_winner" | "fallback";

export interface RoutingResult {
  readonly agentId: AgentId;
  readonly score: number;
  readonly reason: RoutingReason;
  readonly overrideSkill?: string;
  readonly scoreboard: Readonly<Record<AgentId, number>>;
}

/**
 * AgentRouter:
 *   skill とカテゴリから、最適な実行エージェントを決定する。
 *
 *   判定順序:
 *     1) Affinity Matrix によるベーススコア × Context Multiplier の合計（スコアボード確定）
 *     2) Dominant Override（自己レビュー回避などの強制ルール）の適用
 *     3) すべて 0 だった場合は DEFAULT_FALLBACK（hephaestus）
 */
export class AgentRouter {
  /**
   * 最適エージェントの ID のみを返すショートハンド。
   */
  determineOptimalAgent(category: RoutingCategory, skills: readonly string[]): AgentId {
    return this.route(category, skills).agentId;
  }

  /**
   * 採点プロセスを含む完全なルーティング結果を返す。
   * デバッグ・ログ・テスト用途で利用。
   */
  route(category: RoutingCategory, skills: readonly string[]): RoutingResult {
    // 1. スコア計算を先に行い、スコアボードを確定させる
    const scores = new Map<AgentId, number>();
    for (const agent of AGENT_IDS) scores.set(agent, 0);

    for (const skill of skills) {
      const row = AFFINITY_MATRIX.get(skill);
      if (!row) continue;
      const multiplier = this.lookupMultiplier(category, skill);
      for (const agent of AGENT_IDS) {
        // AFFINITY_MATRIX の行は AgentId をキーに持つことが保証されている
        const base = row[agent];
        const current = scores.get(agent) ?? 0;
        scores.set(agent, current + base * multiplier);
      }
    }
    const scoreboard = this.snapshotScoreboard(scores);

    // 2. Dominant Override チェック（計算済みの scoreboard を含めて返す）
    for (const skill of skills) {
      const forced = DOMINANT_OVERRIDES.get(skill);
      if (forced) {
        return {
          agentId: forced,
          score: Number.POSITIVE_INFINITY,
          reason: "dominant_override",
          overrideSkill: skill,
          scoreboard,
        };
      }
    }

    // 3. 最高得点の選定
    let best: AgentId = DEFAULT_FALLBACK;
    let bestScore = -1;
    for (const agent of AGENT_IDS) {
      const s = scores.get(agent) ?? 0;
      if (s > bestScore) {
        bestScore = s;
        best = agent;
      }
    }

    if (bestScore <= 0) {
      return {
        agentId: DEFAULT_FALLBACK,
        score: 0,
        reason: "fallback",
        scoreboard,
      };
    }

    return {
      agentId: best,
      score: bestScore,
      reason: "score_winner",
      scoreboard,
    };
  }

  private lookupMultiplier(category: RoutingCategory, skill: string): number {
    return CONTEXT_MULTIPLIER_MAP.get(`${category}:${skill}`) ?? 1.0;
  }

  private emptyScoreboard(): Record<AgentId, number> {
    return { hephaestus: 0, sisyphus: 0, prometheus: 0, atlas: 0 };
  }

  private snapshotScoreboard(scores: Map<AgentId, number>): Record<AgentId, number> {
    const board = this.emptyScoreboard();
    for (const agent of AGENT_IDS) {
      // scores は AGENT_IDS で初期化されているため、必ず値が存在する
      const score = scores.get(agent) as number;
      board[agent] = score;
    }
    return board;
  }
}
