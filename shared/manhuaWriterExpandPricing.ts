/**
 * /canvas 编剧室连载扩写：四档自选、每次按集计价（无免费额度）。
 *
 * 用户 2026-08-06 的口径：
 * - 优秀/卓越/顶级沿用平台三档；超凡走 Anthropic Claude Opus 5；
 * - 推理档从旧代码写死的 `max` 降到 `high`（经 {@link platformEngineEffort} 取，不写死字符串）；
 * - 前台只显示档位名，不出现模型名、供应商名、reasoning 档位。
 *
 * 按集计价，65% 毛利地板测算（每百万 token 报价见 {@link PLATFORM_ENGINE_TIER_MODELS} 同文件注释）：
 * 假设每集提示词+正文合计约输入 3000 / 输出 3000 token（4–8 段可拍表 + 对白+表演栏）。
 *
 * | 档 | 输入单价 | 输出单价 | 每集成本(¥) | 65%地板价(积分) | 定价(积分) | 实际毛利 |
 * |---|---|---|---|---|---|---|
 * | 优秀 | $1.765/M | $5.295/M | ≈0.153 | ≥0.67 | 1 | ≈77% |
 * | 卓越 | $3.000/M | $15.000/M | ≈0.389 | ≥1.71 | 2 | ≈70% |
 * | 顶级 | $4.500/M | $27.000/M | ≈0.680 | ≥2.99 | 3 | ≈65%（地板） |
 * | 超凡 | $5.000/M | $25.000/M | ≈0.648 | ≥2.85 | 5 | ≈80% |
 *
 * （$1≈¥7.2、1 积分≈¥0.65，口径见 canvasGenerationPricing.ts 顶部注释）
 */
import { PLATFORM_ENGINE_TIERS, type PlatformEngineTierId } from "./platformEngineTiers.js";

export type { PlatformEngineTierId };

export const MANHUA_WRITER_EXPAND_TIERS = [
  ...PLATFORM_ENGINE_TIERS,
  { id: "transcendent", label: "超凡", blurb: "长文表现最强，适合重点项目" },
] as const;

export type ManhuaWriterExpandTierId = (typeof MANHUA_WRITER_EXPAND_TIERS)[number]["id"];

/** 每集积分：与三档单价比例吻合，顶级档卡在 65% 地板上。 */
export const MANHUA_WRITER_EXPAND_CREDITS_PER_EPISODE = {
  excellent: 1,
  superb: 2,
  top: 3,
  transcendent: 5,
} as const;

export type ManhuaWriterExpandQuota = {
  usedEver: number;
  usedToday: number;
  /** 扩写是可带走的成品，始终为 false；字段暂留兼容旧调用。 */
  nextFree: boolean;
  /** 已取消免费额度，始终为 0。 */
  firstFreeLeft: number;
  runTier: ManhuaWriterExpandTierId;
  /** 这一次要扣多少积分。 */
  nextCredits: number;
};

export function resolveManhuaWriterExpandQuota(params: {
  usedEver: number;
  usedToday: number;
  tier?: ManhuaWriterExpandTierId | null;
  episodeCount: number;
}): ManhuaWriterExpandQuota {
  const usedEver = Math.max(0, Math.floor(Number(params.usedEver) || 0));
  const usedToday = Math.max(0, Math.floor(Number(params.usedToday) || 0));
  const requestedTier = isManhuaWriterExpandTierId(params.tier) ? params.tier : "excellent";
  const episodeCount = Math.max(1, Math.floor(Number(params.episodeCount) || 1));
  return {
    usedEver,
    usedToday,
    nextFree: false,
    firstFreeLeft: 0,
    runTier: requestedTier,
    nextCredits: MANHUA_WRITER_EXPAND_CREDITS_PER_EPISODE[requestedTier] * episodeCount,
  };
}

export function isManhuaWriterExpandTierId(raw?: string | null): raw is ManhuaWriterExpandTierId {
  const v = String(raw || "").trim();
  return MANHUA_WRITER_EXPAND_TIERS.some((t) => t.id === v);
}

export function manhuaWriterExpandTierLabel(raw?: string | null): string {
  return MANHUA_WRITER_EXPAND_TIERS.find((tier) => tier.id === String(raw || "").trim())?.label || "优秀";
}
