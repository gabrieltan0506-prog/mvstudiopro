/**
 * /canvas 编剧室连载扩写：从「不扣点 + 一律跑最贵档」改成三档自选、按集计价。
 *
 * 用户 2026-08-06 的口径：
 * - 三档命名与模型对齐 {@link PLATFORM_ENGINE_TIER_MODELS}：优秀=qwen3.8-max、卓越=kimi-k3、顶级=gpt-5.6-sol；
 * - 推理档从旧代码写死的 `max` 降到 `high`（经 {@link platformEngineEffort} 取，不写死字符串）；
 * - 免费额度沿用 `/platform` 既有口径：头 3 次免费、之后每天 1 次免费；
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
 *
 * （$1≈¥7.2、1 积分≈¥0.65，口径见 canvasGenerationPricing.ts 顶部注释）
 */
import { PLATFORM_ENGINE_TIERS, type PlatformEngineTierId } from "./platformEngineTiers.js";

export { PLATFORM_ENGINE_TIERS };
export type { PlatformEngineTierId };

/** 每集积分：与三档单价比例吻合，顶级档卡在 65% 地板上。 */
export const MANHUA_WRITER_EXPAND_CREDITS_PER_EPISODE = {
  excellent: 1,
  superb: 2,
  top: 3,
} as const;

/** 免费额度：新用户头 3 次，之后每天 1 次（口径同 `/platform` 人物背景优化）。 */
export const MANHUA_WRITER_EXPAND_FIRST_FREE = 3;
export const MANHUA_WRITER_EXPAND_DAILY_FREE = 1;

export type ManhuaWriterExpandQuota = {
  usedEver: number;
  usedToday: number;
  /** 这一次是否免费。 */
  nextFree: boolean;
  /** 头 3 次里还剩几次。 */
  firstFreeLeft: number;
  /** 免费那次固定走优秀档（成本最低），不看用户选的档。 */
  runTier: PlatformEngineTierId;
  /** 这一次要扣多少积分（免费为 0）。 */
  nextCredits: number;
};

export function resolveManhuaWriterExpandQuota(params: {
  usedEver: number;
  usedToday: number;
  tier?: PlatformEngineTierId | null;
  episodeCount: number;
}): ManhuaWriterExpandQuota {
  const usedEver = Math.max(0, Math.floor(Number(params.usedEver) || 0));
  const usedToday = Math.max(0, Math.floor(Number(params.usedToday) || 0));
  const firstFreeLeft = Math.max(0, MANHUA_WRITER_EXPAND_FIRST_FREE - usedEver);
  const nextFree = firstFreeLeft > 0 || usedToday < MANHUA_WRITER_EXPAND_DAILY_FREE;
  const requestedTier = isManhuaWriterExpandTierId(params.tier) ? params.tier : "excellent";
  const runTier: PlatformEngineTierId = nextFree ? "excellent" : requestedTier;
  const episodeCount = Math.max(1, Math.floor(Number(params.episodeCount) || 1));
  return {
    usedEver,
    usedToday,
    nextFree,
    firstFreeLeft,
    runTier,
    nextCredits: nextFree
      ? 0
      : MANHUA_WRITER_EXPAND_CREDITS_PER_EPISODE[runTier] * episodeCount,
  };
}

export function isManhuaWriterExpandTierId(raw?: string | null): raw is PlatformEngineTierId {
  const v = String(raw || "").trim();
  return PLATFORM_ENGINE_TIERS.some((t) => t.id === v);
}
