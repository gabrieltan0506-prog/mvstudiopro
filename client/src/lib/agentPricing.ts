/**
 * Agent 深潜场景积分 — 须与 `server/services/billingService.ts` 中 `AGENT_SCENARIO_PRICING` 保持同步。
 */
export const AGENT_SCENARIO_CREDITS = {
  platform_ip_matrix: 720,
  competitor_radar: 720,
} as const;

/** 对外说明用：约 0.7 元 / 点（与产品口径一致即可） */
export const CNY_PER_CREDIT_REFERENCE = 0.7;

export function estimateCnyFromCredits(points: number): string {
  return (points * CNY_PER_CREDIT_REFERENCE).toFixed(0);
}
