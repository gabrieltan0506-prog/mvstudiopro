/**
 * 決策智庫 API 的 `platformHint` 與增長看板 `GrowthPlatform` 對齊。
 */

import type { GrowthPlatformSnapshot } from "./growth";

export const DECISION_INTEL_PLATFORM_HINTS = ["douyin", "bilibili", "xiaohongshu", "kuaishou"] as const;
export type DecisionIntelPlatformHint = (typeof DECISION_INTEL_PLATFORM_HINTS)[number];

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

/** 依動量 + 受眾契合自動選主戰場（與「優先平台」卡片一致的方向）。 */
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

export function formatDecisionIntelDateRangeZh(windowDays: 15 | 30 | 45, end: Date = new Date()): string {
  const start = new Date(end.getTime() - windowDays * 864e5);
  return `${start.toLocaleDateString("zh-CN")} — ${end.toLocaleDateString("zh-CN")}`;
}
