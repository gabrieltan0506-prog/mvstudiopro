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
 * - `bytedance/seedance-2.0-fast` 720p $0.121/秒 → 15 秒约 20 积分成本
 * - `minimax/hailuo-3` 2K $0.13/秒 → 15 秒约 22 积分成本
 * - 2.5 已切 EvoLink 五模式；当前未取得可核对的上游实扣，不能拿旧小云雀价格冒充成本
 * 2.5 继续沿用既有零售价，但在取得 EvoLink 真实账单前，不对该档毛利率下结论。
 *
 * @see https://openrouter.ai/bytedance/seedance-2.0
 * @see https://openrouter.ai/minimax/hailuo-3
 */

/**
 * 画布出图（关键静帧 / 封面 / 设定图，GPT-image-2）：54 积分/张。
 * 上游高质竖屏一张约 $0.19 ≈ 21 积分成本，毛利率约 61%。
 */
export const CANVAS_IMAGE_CREDITS_PER_SHOT = 54;
/** 同一次批量出图的第 2 张起：九折（54 → 49），与创作顾问生图的首张折扣口径相反但同量级 */
export const CANVAS_IMAGE_CREDITS_BATCH = 49;

/**
 * 一张画布出图应扣的积分。批量是前端并发发 N 个 job，
 * 所以折扣只能靠请求里带的 `batchIndex` 判断，服务端看不到整批。
 */
export function canvasImageCredits(batchIndex?: number | null): number {
  const i = Math.floor(Number(batchIndex) || 0);
  return i > 0 ? CANVAS_IMAGE_CREDITS_BATCH : CANVAS_IMAGE_CREDITS_PER_SHOT;
}

/** 单段成片：快速 / 标准 / H3（≤15 秒，720p） */
export const CANVAS_VIDEO_CREDITS_CLIP = 118;
/** 单段成片：加长档（>15 秒，2.5 最长 30 秒） */
export const CANVAS_VIDEO_CREDITS_CLIP_LONG = 240;
/**
 * 单段成片的画质加价档（≤15 秒）。
 *
 * Seedance 按像素计费，官方公式 `tokens = 高 × 宽 × 秒数 × 24 / 1024`。
 * 实测 4 秒 480p 扣 $0.269，反推 token 单价约 $7/M，套回 720p 得 $0.1512/秒，
 * 与既有单价吻合，故可据像素比直接外推。售价按同一比例抬，各档毛利率都保持约 79%：
 *
 * | 档位 | 像素 | 单价 | 15 秒成本 | 售价 |
 * |---|---|---|---|---|
 * | 720p  | 1280×720  | $0.151/秒 | $2.27  | 118 |
 * | 1080p | 1920×1080 | $0.340/秒 | $5.10  | 268 |
 * | 2K    | 2560×1440 | $0.605/秒 | $9.07  | 472 |
 * | 4K    | 3840×2160 | $1.361/秒 | $20.41 | 1062 |
 *
 * @see https://openrouter.ai/bytedance/seedance-2.0
 */
export const CANVAS_VIDEO_CREDITS_CLIP_1080P = 268;
export const CANVAS_VIDEO_CREDITS_CLIP_2K = 472;
export const CANVAS_VIDEO_CREDITS_CLIP_4K = 1062;

/** 画布成片可选画质：默认 720p */
export const CANVAS_VIDEO_RESOLUTIONS = ["720p", "1080p", "2K", "4K"] as const;
export type CanvasVideoResolution = (typeof CANVAS_VIDEO_RESOLUTIONS)[number];
export const CANVAS_VIDEO_RESOLUTION_DEFAULT: CanvasVideoResolution = "720p";

export function normalizeCanvasVideoResolution(raw: unknown): CanvasVideoResolution {
  const r = String(raw || "").trim().toLowerCase();
  if (r === "1080p" || r === "1k") return "1080p";
  if (r === "2k") return "2K";
  if (r === "4k") return "4K";
  return CANVAS_VIDEO_RESOLUTION_DEFAULT;
}
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
  /** 输出分辨率；1080p 成本是 720p 的 2.25 倍，售价同步抬 */
  resolution?: string | null;
};

/** 高于 720p 的画质加价表 */
const CANVAS_VIDEO_CREDITS_BY_RESOLUTION: Record<CanvasVideoResolution, number> = {
  "720p": CANVAS_VIDEO_CREDITS_CLIP,
  "1080p": CANVAS_VIDEO_CREDITS_CLIP_1080P,
  "2K": CANVAS_VIDEO_CREDITS_CLIP_2K,
  "4K": CANVAS_VIDEO_CREDITS_CLIP_4K,
};

/**
 * 一次成片请求应扣的积分。
 *
 * 漫剧分段走整集折算价（172），比单段 118 贵是因为一集普遍是 30 秒档；
 * 自由画布单段按时长分档，15 秒内再按画质分四价。
 * 加长档（>15 秒）只有 2.5 一条路，固定 720p，不吃画质参数。
 */
export function canvasVideoClipCredits(input: CanvasVideoPricingInput): number {
  if (input.isEpisodeSegment) return MANHUA_EPISODE_CREDITS_PER_SEGMENT;
  const sec = Number(input.durationSec);
  if (Number.isFinite(sec) && sec > CANVAS_VIDEO_LONG_CLIP_THRESHOLD_SEC) {
    return CANVAS_VIDEO_CREDITS_CLIP_LONG;
  }
  return CANVAS_VIDEO_CREDITS_BY_RESOLUTION[normalizeCanvasVideoResolution(input.resolution)];
}

/** 对外可读的计费说明（可放 toast / 节点角标） */
export function describeCanvasVideoClipPrice(input: CanvasVideoPricingInput): string {
  const credits = canvasVideoClipCredits(input);
  if (input.isEpisodeSegment) return `${credits} 积分/段（整集 ${MANHUA_EPISODE_CREDITS}）`;
  return `${credits} 积分/段`;
}
