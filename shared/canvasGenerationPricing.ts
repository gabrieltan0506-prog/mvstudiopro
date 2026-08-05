/**
 * 画布出图与成片计价（服务端收口用）。
 *
 * 背景：`/canvas` 的出图与成片此前**一分钱不收**——`api/jobs.ts` 没有任何扣费，
 * 画布前端也没扣，所以漫剧编剧室跑一集（4–6 段）等于白烧上游账单。
 * 用户 2026-08-05 定价：出图 54/张；成片单段 118（快速 / 标准 / H3），30 秒加长 240，
 * 漫剧整集 688 → 按段折成 172（688 ÷ 4 段），跑多少扣多少、失败不扣。
 *
 * 上游实价参考（OpenRouter，$1≈¥7.2，1 积分≈¥0.65）：
 * - `bytedance/seedance-2.0` 720p $0.1512/秒 → 15 秒约 25 积分成本
 * - `bytedance/seedance-2.0-fast` 720p $0.121/秒 → 15 秒约 13 积分成本
 * - `minimax/hailuo-3` 2K $0.13/秒 → 15 秒约 22 积分成本
 * - 2.5 走小云雀，按 2.0 单价估 30 秒约 50 积分成本
 * 即最薄的一档（2.5 加长按段 172 对 50 成本）毛利率仍约 71%，高于视频类 55% 的地板。
 *
 * @see https://openrouter.ai/bytedance/seedance-2.0
 * @see https://openrouter.ai/minimax/hailuo-3
 */

/**
 * 画布出图（关键静帧 / 封面 / 设定图，GPT-image-2）：54 积分/张。
 * 上游高质竖屏一张约 $0.19 ≈ 21 积分成本，毛利率约 61%。
 */
export const CANVAS_IMAGE_CREDITS_PER_SHOT = 54;

/** 单段成片：快速 / 标准 / H3（≤15 秒） */
export const CANVAS_VIDEO_CREDITS_CLIP = 118;
/** 单段成片：加长档（>15 秒，2.5 最长 30 秒） */
export const CANVAS_VIDEO_CREDITS_CLIP_LONG = 240;
/** 漫剧整集价与折算段价：一集按 4 段计 */
export const MANHUA_EPISODE_CREDITS = 688;
export const MANHUA_EPISODE_SEGMENTS_FOR_PRICING = 4;
export const MANHUA_EPISODE_CREDITS_PER_SEGMENT = Math.round(
  MANHUA_EPISODE_CREDITS / MANHUA_EPISODE_SEGMENTS_FOR_PRICING,
);

/** 超过这个秒数算加长档 */
export const CANVAS_VIDEO_LONG_CLIP_THRESHOLD_SEC = 15;

export type CanvasVideoPricingInput = {
  /** 成片时长（秒）；缺省按 15 秒档 */
  durationSec?: number | null;
  /**
   * 是否漫剧编剧室的一集内分段。
   * 由前端透传 `episodeIndex`/`clipIndex` 判定——服务端无法从提示词可靠反解，
   * 因为出线前 `【第3段·15s】` 会被换成普通括号，且用户可以改。
   */
  isEpisodeSegment?: boolean;
};

/**
 * 一次成片请求应扣的积分。
 *
 * 漫剧分段走整集折算价（172），比单段 118 贵是因为一集普遍是 30 秒档；
 * 自由画布单段按时长分两档。
 */
export function canvasVideoClipCredits(input: CanvasVideoPricingInput): number {
  if (input.isEpisodeSegment) return MANHUA_EPISODE_CREDITS_PER_SEGMENT;
  const sec = Number(input.durationSec);
  if (Number.isFinite(sec) && sec > CANVAS_VIDEO_LONG_CLIP_THRESHOLD_SEC) {
    return CANVAS_VIDEO_CREDITS_CLIP_LONG;
  }
  return CANVAS_VIDEO_CREDITS_CLIP;
}

/** 对外可读的计费说明（可放 toast / 节点角标） */
export function describeCanvasVideoClipPrice(input: CanvasVideoPricingInput): string {
  const credits = canvasVideoClipCredits(input);
  if (input.isEpisodeSegment) return `${credits} 积分/段（整集 ${MANHUA_EPISODE_CREDITS}）`;
  return `${credits} 积分/段`;
}
