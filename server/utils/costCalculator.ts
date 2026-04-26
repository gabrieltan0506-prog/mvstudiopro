/**
 * 阶梯式分析计费工具
 * 针对抖音/快手/B站/小红书的时长特性设计
 */

export const BASE_COST = {
  GROWTH: 40,
  REMIX: 60,
} as const;

/** 60 分钟硬限制（秒） */
export const MAX_DURATION_SECONDS = 3600;

/** 无法获取时长时，默认按 10 分钟（1.5 倍）计费 */
const DEFAULT_DURATION_SECONDS = 600;

/**
 * 根据分析类型与视频时长计算积分消耗
 *
 * 阶梯规则：
 * - ≤ 3 分钟  (≤180s)  → 1.0×  [小红书/常规抖音]
 * - ≤ 10 分钟 (≤600s)  → 1.5×  [深度抖音/常规B站]
 * - ≤ 30 分钟 (≤1800s) → 2.5×  [硬核B站]
 * - > 30 分钟           → 4.0×  [B站超长视频]
 */
export function calculateAnalysisCost(
  type: "GROWTH" | "REMIX",
  durationSeconds: number | null | undefined,
): number {
  const base = BASE_COST[type];
  const dur = (durationSeconds != null && durationSeconds > 0)
    ? durationSeconds
    : DEFAULT_DURATION_SECONDS;

  let multiplier: number;
  if (dur <= 180) {
    multiplier = 1.0;
  } else if (dur <= 600) {
    multiplier = 1.5;
  } else if (dur <= 1800) {
    multiplier = 2.5;
  } else {
    multiplier = 4.0;
  }

  return Math.ceil(base * multiplier);
}

/** 给前端使用的时长→费用预估（同 calculateAnalysisCost，无需 import server 依赖） */
export function estimateCostLabel(
  type: "GROWTH" | "REMIX",
  durationSeconds: number | null | undefined,
): { cost: number; tierLabel: string; isDefault: boolean } {
  const isDefault = !durationSeconds || durationSeconds <= 0;
  const cost = calculateAnalysisCost(type, durationSeconds);
  const dur = isDefault ? DEFAULT_DURATION_SECONDS : durationSeconds!;

  let tierLabel: string;
  if (dur <= 180) {
    tierLabel = "≤3 分钟";
  } else if (dur <= 600) {
    tierLabel = "3~10 分钟";
  } else if (dur <= 1800) {
    tierLabel = "10~30 分钟";
  } else {
    tierLabel = ">30 分钟";
  }

  return { cost, tierLabel, isDefault };
}
