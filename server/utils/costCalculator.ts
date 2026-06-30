/**
 * 成长营视频分析计费：每次分析固定扣一次积分（不按时长阶梯）。
 */

export const BASE_COST = {
  GROWTH: 40,
  REMIX: 60,
} as const;

/** 每次分析固定积分（与 BASE_COST 一致，供 job / 前端展示） */
export function flatAnalysisCost(type: "GROWTH" | "REMIX"): number {
  return BASE_COST[type];
}

/** 60 分钟硬限制（秒） */
export const MAX_DURATION_SECONDS = 3600;

/** @deprecated 成长营已改为固定单次扣费；保留别名避免旧引用报错 */
export function calculateAnalysisCost(
  type: "GROWTH" | "REMIX",
  _durationSeconds?: number | null,
): number {
  return flatAnalysisCost(type);
}

/** 给前端使用的费用预估（固定单次，不按时长阶梯） */
export function estimateCostLabel(
  type: "GROWTH" | "REMIX",
  _durationSeconds?: number | null,
): { cost: number; tierLabel: string; isDefault: boolean } {
  return {
    cost: flatAnalysisCost(type),
    tierLabel: "每次分析",
    isDefault: false,
  };
}
