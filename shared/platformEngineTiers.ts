/**
 * 平台引擎三档：对外只说档位名，不写模型与供应商。
 *
 * 命名由用户 2026-08-06 定：**优秀 / 卓越 / 顶级**。
 * 之前的「轻量 / 均衡 / 精细」被否了——花了钱还被告知自己买的是「轻量」，
 * 没人愿意升档。
 *
 * 三档背后的通道与官方报价（每百万 tokens，2026-08-06 抓取定价页）：
 * | 档 | 通道 | 输入 | 输出 |
 * |---|---|---|---|
 * | 优秀 | EvoLink `qwen3.8-max`（备道 OpenRouter 同款） | $1.765 | $5.295 |
 * | 卓越 | OpenRouter `moonshotai/kimi-k3`（备道 EvoLink 同价） | $3.000 | $15.000 |
 * | 顶级 | EvoLink `gpt-5.6-sol` | $4.500 | $27.000 |
 *
 * @see https://evolink.ai/qwen-3-8-max
 * @see https://evolink.ai/kimi-k3
 * @see https://evolink.ai/gpt-5-6
 */

export const PLATFORM_ENGINE_TIERS = [
  {
    id: "excellent",
    label: "优秀",
    /** 给用户看的一句：说速度与适用场景，不说模型。 */
    blurb: "出得快，日常选题够用",
  },
  {
    id: "superb",
    label: "卓越",
    blurb: "想得更深，钩子更刁",
  },
  {
    id: "top",
    label: "顶级",
    blurb: "最能咬住细节，慢一些",
  },
] as const;

export type PlatformEngineTierId = (typeof PLATFORM_ENGINE_TIERS)[number]["id"];

export function isPlatformEngineTierId(raw?: string | null): raw is PlatformEngineTierId {
  const v = String(raw || "").trim();
  return PLATFORM_ENGINE_TIERS.some((t) => t.id === v);
}

export function platformEngineTierLabel(raw?: string | null): string {
  const hit = PLATFORM_ENGINE_TIERS.find((t) => t.id === String(raw || "").trim());
  return hit ? hit.label : PLATFORM_ENGINE_TIERS[0].label;
}

export function resolvePlatformEngineTier(raw?: string | null): PlatformEngineTierId {
  return isPlatformEngineTierId(raw) ? raw : "excellent";
}

/** 各档的模型 id：只在服务端用，前台不得展示。 */
export const PLATFORM_ENGINE_TIER_MODELS = {
  excellent: { evolink: "qwen3.8-max", openrouter: "qwen/qwen3.8-max" },
  superb: { evolink: "kimi-k3", openrouter: "moonshotai/kimi-k3" },
  top: { evolink: "gpt-5.6-sol", openrouter: "openai/gpt-5.6-sol" },
} as const;

/**
 * 各档可用的推理档位不一样，写死映射避免传了对方不认的值：
 * - 优秀（Qwen）：`low` | `medium` | `xhigh`（无 high / max，且勿与 thinking_budget 同传）
 * - 卓越（Kimi K3）：`low` | `high` | `max`（无 medium / xhigh）
 * - 顶级（Sol）：`low` | `medium` | `high` | `xhigh`
 *
 * 用户 2026-08-06 的口径：**选题用 medium 就好**（快且省），
 * 出完给用户之后，**润色那步才用 high**。下表把这两句话翻成各档认的值。
 *
 * @see https://platform.kimi.ai/docs/guide/kimi-k3-quickstart
 * @see https://docs.qwencloud.com/developer-guides/text-generation/thinking
 */
export const PLATFORM_ENGINE_TIER_EFFORT = {
  /**
   * 选题初选：中档。Kimi 的三级是 low|high|max，它的「中档」就是 high
   * （旧代码一直发 max，推理烧得最多也最慢，这次按用户口径降一级）。
   */
  shortlist: { excellent: "medium", superb: "high", top: "medium" },
  /** 人物背景润色：用力档。Qwen 的顶档是 xhigh，Kimi 是 high。 */
  polish: { excellent: "xhigh", superb: "high", top: "high" },
} as const;

export type PlatformEngineStep = keyof typeof PLATFORM_ENGINE_TIER_EFFORT;

export type PlatformEngineEffort =
  (typeof PLATFORM_ENGINE_TIER_EFFORT)[PlatformEngineStep][PlatformEngineTierId];

export function platformEngineEffort(
  step: PlatformEngineStep,
  tier: PlatformEngineTierId,
): PlatformEngineEffort {
  return PLATFORM_ENGINE_TIER_EFFORT[step][tier];
}
