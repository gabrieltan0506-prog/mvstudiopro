/**
 * 决策智库 API 的 `platformHint` 与增长看板 `GrowthPlatform` 对齐。
 */

import type { GrowthPlatformSnapshot } from "./growth";

export const DECISION_INTEL_PLATFORM_HINTS = ["douyin", "bilibili", "xiaohongshu", "kuaishou"] as const;
export type DecisionIntelPlatformHint = (typeof DECISION_INTEL_PLATFORM_HINTS)[number];

/** 平台页可选的分析窗口（天）。3/7 看即时热点风向，15/30/45 看结构与长尾沉淀。 */
export const PLATFORM_WINDOW_DAYS = [3, 7, 15, 30, 45] as const;
export type PlatformWindowDays = (typeof PLATFORM_WINDOW_DAYS)[number];

export function resolveDecisionIntelPlatformHintFromGrowthPlatform(platform: string): DecisionIntelPlatformHint {
  const p = String(platform || "douyin").toLowerCase();
  const map: Record<string, DecisionIntelPlatformHint> = {
    douyin: "douyin",
    weixin_channels: "douyin",
    toutiao: "douyin",
    xiaohongshu: "xiaohongshu",
    bilibili: "bilibili",
    kuaishou: "kuaishou",
  };
  return map[p] ?? "douyin";
}

/** 依动量 + 受众契合自动选主战场（与「优先平台」卡片一致的方向）。 */
export function pickPrimaryDecisionIntelPlatformHint(
  snapshots: GrowthPlatformSnapshot[],
): DecisionIntelPlatformHint {
  if (!snapshots.length) return "douyin";
  const sorted = [...snapshots].sort((a, b) => {
    const scoreA = a.momentumScore + a.audienceFitScore;
    const scoreB = b.momentumScore + b.audienceFitScore;
    return scoreB - scoreA;
  });
  return resolveDecisionIntelPlatformHintFromGrowthPlatform(sorted[0].platform);
}

export function formatDecisionIntelDateRangeZh(windowDays: PlatformWindowDays, end: Date = new Date()): string {
  const start = new Date(end.getTime() - windowDays * 864e5);
  return `${start.toLocaleDateString("zh-CN")} — ${end.toLocaleDateString("zh-CN")}`;
}
