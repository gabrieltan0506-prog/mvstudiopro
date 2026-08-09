/**
 * 画布出图与成片计价（服务端收口用）。
 *
 * 背景：`/canvas` 的出图与成片此前**一分钱不收**——`api/jobs.ts` 没有任何扣费，
 * 画布前端也没扣，所以漫剧编剧室跑一集（4–6 段）等于白烧上游账单。
 * 用户 2026-08-05 定价：出图 54/张；成片单段 118（2.0 / Fast / H3 / Happy Horse），30 秒加长 240，
 * 漫剧整集 688 → 按段折成 172（688 ÷ 4 段），跑多少扣多少、失败不扣。
 *
 * 上游实价参考（OpenRouter，$1≈¥7.2，1 积分≈¥0.65）：
 * - `bytedance/seedance-2.0` 720p $0.1512/秒 → 15 秒约 25 积分成本
 * - `bytedance/seedance-2.0-fast` 720p $0.121/秒 → 15 秒约 20 积分成本
 * - `minimax/hailuo-3` 2K $0.13/秒 → 15 秒约 22 积分成本
 * - `seedance-2.0-mini` 15 秒约 5（限时）～13（常规）积分成本 → 草稿档零售 39
 * - `alibaba/happyhorse-1.1` 画布成片按同档 720p 零售 118（与首页照片动画独立计价）
 * - 2.5 已切 EvoLink 五模式；当前未取得可核对的上游实扣，不能拿旧小云雀价格冒充成本
 * 2.5 继续沿用既有零售价，但在取得 EvoLink 真实账单前，不对该档毛利率下结论。
 *
 * @see https://openrouter.ai/bytedance/seedance-2.0
 * @see https://openrouter.ai/minimax/hailuo-3
 * @see https://openrouter.ai/alibaba/happyhorse-1.1
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

/** 单段成片：2.0 / Fast / H3 / Happy Horse（≤15 秒，720p 基准） */
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
/** 2K 限时特价 **388**（原 472，用户 2026-08-09 拍板）。2K 只能靠超分交付，见下方 4K 注释 */
export const CANVAS_VIDEO_CREDITS_CLIP_2K = 388;
/**
 * 4K 限时特价 **688**（用户 2026-08-09 拍板；原 1062 → 900 → 688）。
 *
 * 1062 是按「像素比外推」的成本 $20.41 定的；实测 EvoLink 原生 4K 只要 $1.0126/秒，
 * 15 秒 $15.19 ≈ 168 积分，外推值高估 26%。
 *
 * 而走超分之后成本还要再掉一个数量级：720p 生成 $2.98 + 超分到 4K $0.43 = 15 秒
 * 约 **38 积分**，688 对应约 **18 倍**；2K 同理，成本约 35 积分，388 对应约 **11 倍**。
 * 相比之下原生 4K 生成成本 168 积分，同卖 688 只有 **4.1 倍** —— 所以 2K/4K 应优先走
 * 超分链路（且超分模型是字节自研、专门对 Seedance 调过，时序稳定不闪不糊）。
 */
export const CANVAS_VIDEO_CREDITS_CLIP_4K = 688;

/**
 * 视频超分（WaveSpeed · ByteDance Video Upscaler）零售：**按秒**，不按条。
 *
 * 为什么不能按条：真实用法是**整集合成后跑一次**（2.5 一集 4×30 ≈ 120 秒），
 * 没人愿意每 30 秒一条分别提交。上游本身也是纯按秒收，不分条：
 * 2K $0.0144/秒、4K $0.0288/秒，最低按 5 秒计、单任务最多计 600 秒。
 *
 * 上游成本折积分（$1≈¥7.2，1 积分≈¥0.65）：2K 约 0.16 积分/秒、4K 约 0.32 积分/秒。
 * 下面两个费率按约 12.6 倍定，一集 120 秒因此是 2K 240 / 4K 480 积分。
 * **改这两个常量即可调价**，无需动逻辑。
 */
export const CANVAS_VIDEO_UPSCALE_CREDITS_PER_SEC_2K = 2;
export const CANVAS_VIDEO_UPSCALE_CREDITS_PER_SEC_4K = 4;
/** 与上游一致：不足 5 秒按 5 秒计，超过 600 秒按 600 秒封顶 */
export const CANVAS_VIDEO_UPSCALE_MIN_BILLED_SEC = 5;
export const CANVAS_VIDEO_UPSCALE_MAX_BILLED_SEC = 600;

/**
 * 自由画布加价系数 **1.1**（用户 2026-08-09 拍板）。
 *
 * 自由画布是散客单条，漫剧是一次好几集的批量——批发价与零售价不该同价。
 * 只作用于自由画布单条，漫剧整集链路按原价。
 */
export const CANVAS_FREEFORM_RETAIL_MULTIPLIER = 1.1;

export function canvasVideoUpscaleCredits(
  target: "2k" | "4k",
  durationSec: number,
  opts?: { freeform?: boolean },
): number {
  const raw = Number(durationSec);
  const sec = Math.min(
    CANVAS_VIDEO_UPSCALE_MAX_BILLED_SEC,
    Math.max(
      CANVAS_VIDEO_UPSCALE_MIN_BILLED_SEC,
      Number.isFinite(raw) && raw > 0 ? Math.ceil(raw) : 0,
    ),
  );
  const rate =
    target === "4k"
      ? CANVAS_VIDEO_UPSCALE_CREDITS_PER_SEC_4K
      : CANVAS_VIDEO_UPSCALE_CREDITS_PER_SEC_2K;
  const base = sec * rate;
  return opts?.freeform ? Math.ceil(base * CANVAS_FREEFORM_RETAIL_MULTIPLIER) : base;
}

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

/**
 * 每个引擎**实际出得来**的画质档。
 *
 * 2026-08-09 实测（两条路径都打过，OpenRouter 的报错写明 "for BytePlus Seedance"，
 * 说明它只是转发到同一个上游，不是独立供应商）：
 *
 * - 直连 BytePlus Ark：2.0 与 2.5，i2v 与 t2v 四种组合发 `resolution=2k`，全部 400。
 * - 经 OpenRouter：上游把枚举吐了出来——
 *   `Unsupported resolution '2K' for BytePlus Seedance. Supported values: 480p, 720p, 1080p, 4K`
 *
 * 所以 **2K 在 Seedance 全系根本不存在**（要 2K 只能出 4K 再压，或出 1080p 再超分）；
 * 4K 则是真档位——同一发请求过了分辨率校验，倒在下一关的内容审核上。
 *
 * 4K 只登记给 2.0 标准档，已实测出片（EvoLink，5 秒 $5.063 / $1.0126 每秒）。
 *
 * 2.5 **最高只到 720p**，连 1080p 都没有——EvoLink 上游原话：
 *   `invalid quality: 4k (model seedance-2.5-image-to-video only supports quality=[480p 720p])`
 * fast / mini 同样只到 720p。所以画质上限最高的是 2.0，不是 2.5。
 *
 * 实测单价（EvoLink · 2.0 · 5 秒 · i2v，音频开关不影响价格）：
 *   720p $0.993 ｜ 1080p $2.482 ｜ 4K $5.063
 * 折成每秒 $0.1986 / $0.4964 / $1.0126 —— 对 720p 的倍数是 1 / 2.50 / 5.10，
 * 而像素倍数是 1 / 2.25 / 9.00：**高档有明显折扣，计费不随像素线性增长**。
 * 上面那张按像素比外推的表因此低档高估、高档低估，勿再拿它当成本依据。
 *
 * H3 上游是 `768p | 2k`，这里把 768p 归到 720p 价档（`720p` 即 H3 的草稿档）。
 *
 * 未登记的引擎保持全量可选，避免新接引擎被这张表悄悄砍掉能力。
 */
const CANVAS_VIDEO_RESOLUTIONS_BY_MODEL: Readonly<
  Record<string, readonly CanvasVideoResolution[]>
> = {
  "seedance-2.0": ["720p", "1080p", "4K"],
  "seedance-2.0-fast": ["720p"],
  "seedance-2.0-mini": ["720p"],
  "seedance-2.5": ["720p"],
  "minimax-hailuo-3": ["720p", "2K"],
};

/** 引擎别名 → 上表的键；与 canvasTypes / manhuaSeedanceLayout 的写法对齐 */
function canvasVideoModelPricingKey(videoModel?: string | null): string {
  const k = String(videoModel || "").trim().toLowerCase();
  if (!k) return "";
  if (isMiniPricedVideoModel(k)) return "seedance-2.0-mini";
  if (k === "hailuo-3" || k === "minimax/hailuo-3" || k === "minimax-h3" || k === "h3") {
    return "minimax-hailuo-3";
  }
  if (k === "2.0-fast" || k === "fast") return "seedance-2.0-fast";
  if (k === "2.5" || k === "25") return "seedance-2.5";
  if (k === "2.0") return "seedance-2.0";
  return k;
}

export function canvasVideoResolutionsForModel(
  videoModel?: string | null,
): readonly CanvasVideoResolution[] {
  return (
    CANVAS_VIDEO_RESOLUTIONS_BY_MODEL[canvasVideoModelPricingKey(videoModel)] ??
    CANVAS_VIDEO_RESOLUTIONS
  );
}

/**
 * 按引擎钳制画质。**必须在计费之前调用**。
 *
 * 之前的顺序是「按用户选的档收钱 → 到 provider 层才发现不支持 → 悄悄降级或被上游拒」，
 * 于是 2K 收 472 积分、实际拿到上游默认档。钳制提到计费前，收的就是出得来的那一档。
 */
export function resolveCanvasVideoResolution(
  videoModel: string | null | undefined,
  raw: unknown,
): CanvasVideoResolution {
  const allowed = canvasVideoResolutionsForModel(videoModel);
  const wanted = normalizeCanvasVideoResolution(raw);
  if (allowed.includes(wanted)) return wanted;
  return allowed[0] ?? CANVAS_VIDEO_RESOLUTION_DEFAULT;
}
/**
 * 漫剧整集价与折算段价：688 是**按 2.5 的 4 段**定的，折成 172/段。
 *
 * 注意实收口径：服务端对任何引擎的整集段都按 172/段收，所以整集实收
 * 随引擎段数变——2.5（4 段）688、2.0/fast（6 段）1032、H3（8 段）1376。
 * 因此不能把 688 当成所有引擎的整集价对外写死，须用
 * `manhuaEpisodeTotalCredits(videoModel, segmentCount)` 现算。
 */
export const MANHUA_EPISODE_CREDITS = 688;
export const MANHUA_EPISODE_SEGMENTS_FOR_PRICING = 4;
export const MANHUA_EPISODE_CREDITS_PER_SEGMENT = Math.round(
  MANHUA_EPISODE_CREDITS / MANHUA_EPISODE_SEGMENTS_FOR_PRICING,
);

/**
 * Seedance 2.0 Mini 草稿档（用户 2026-08-09 拍板）。
 *
 * Mini 只有 480p/720p、最长 15 秒，所以不吃画质加价表也不吃加长档——
 * 一个价 39，比 fast 的 118 低三分之二，定位是「试提示词 / 铺草稿」，
 * 不跟正片档抢单。整集草稿包沿用 688 的打包折扣率（688 ÷ 4×240 ≈ 71.7%）：
 * 6 段 × 39 = 234 → 168，折合 28/段。
 */
export const CANVAS_VIDEO_CREDITS_CLIP_MINI = 39;
export const MANHUA_EPISODE_CREDITS_MINI = 168;
export const MANHUA_EPISODE_SEGMENTS_FOR_PRICING_MINI = 6;
export const MANHUA_EPISODE_CREDITS_PER_SEGMENT_MINI = Math.round(
  MANHUA_EPISODE_CREDITS_MINI / MANHUA_EPISODE_SEGMENTS_FOR_PRICING_MINI,
);

/** 计价用的 Mini 判定：容忍画布/jobs 两侧的历史别名 */
export function isMiniPricedVideoModel(videoModel?: string | null): boolean {
  const key = String(videoModel || "").trim().toLowerCase();
  return (
    key === "seedance-2.0-mini" ||
    key === "2.0-mini" ||
    key === "mini" ||
    key === "2.0mini"
  );
}

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
  /**
   * 成片引擎。只有 Mini 草稿档需要区分——它单独一个价，
   * 不吃画质加价表也不吃加长档。其余引擎（2.0 / fast / 2.5 / H3 / Happy Horse）
   * 沿用按时长与画质分档的旧口径，传不传都一样。
   */
  videoModel?: string | null;
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
 * 漫剧分段走整集折算价（172）；自由画布单段按时长分档，15 秒内再按画质分四价。
 * 加长档（>15 秒）只有 2.5 一条路，固定 720p，不吃画质参数。
 *
 * 已知口径问题（待用户拍板，本轮不动实收）：172 是按 2.5 的 30 秒段折的，
 * 但对 6 段/8 段的 15 秒引擎也照收 172，比自由画布同规格单段（118）还贵，
 * 等于走整集流水线反而更亏。要么按引擎分段价，要么把整集总额封在 688。
 */
export function canvasVideoClipCredits(input: CanvasVideoPricingInput): number {
  // Mini 一个价：上游只有 480p/720p 且最长 15 秒，没有可分的画质档与加长档
  if (isMiniPricedVideoModel(input.videoModel)) {
    return input.isEpisodeSegment
      ? MANHUA_EPISODE_CREDITS_PER_SEGMENT_MINI
      : CANVAS_VIDEO_CREDITS_CLIP_MINI;
  }
  if (input.isEpisodeSegment) return MANHUA_EPISODE_CREDITS_PER_SEGMENT;
  // 按引擎钳制后再取价：上游出不来的档不能收钱
  const base =
    CANVAS_VIDEO_CREDITS_BY_RESOLUTION[
      resolveCanvasVideoResolution(input.videoModel, input.resolution)
    ];
  const sec = Number(input.durationSec);
  if (Number.isFinite(sec) && sec > CANVAS_VIDEO_LONG_CLIP_THRESHOLD_SEC) {
    /**
     * 加长档也要吃画质。
     *
     * 原来这里直接 `return CANVAS_VIDEO_CREDITS_CLIP_LONG`，长片判断压在画质查表**之前**，
     * 于是画质参数被整条吞掉：一条 30 秒 4K 只收 240，而 15 秒 4K 收 688 —— **越长越便宜**，
     * 用户只要把时长拉过 15 秒就能拿高画质当白菜价。
     *
     * 改成按同一倍率抬：`长档 = 该画质基础价 × (240 / 118)`。720p 长档仍是 240 不变，
     * 不动既有实收；其余画质按各自基础价等比例上去。
     */
    return Math.round((base * CANVAS_VIDEO_CREDITS_CLIP_LONG) / CANVAS_VIDEO_CREDITS_CLIP);
  }
  return base;
}

/**
 * 一集实收合计 = 段价 × 该引擎实际段数。
 *
 * 不能直接印 `MANHUA_EPISODE_CREDITS`：688 只在 4 段（2.5）时成立，
 * 6 段引擎实收 1032、8 段实收 1376。段数由调用方从漫剧段表传进来，
 * 这里不 import `manhuaSeedanceLayout` 以免把段表耦合进计价底层模块。
 */
export function manhuaEpisodeTotalCredits(input: {
  videoModel?: string | null;
  /** 该集实际段数；缺省按 688 的 4 段口径 */
  segmentCount?: number | null;
}): number {
  const perSegment = canvasVideoClipCredits({
    isEpisodeSegment: true,
    videoModel: input.videoModel,
  });
  const raw = Math.floor(Number(input.segmentCount));
  const segments = Number.isFinite(raw) && raw > 0
    ? raw
    : isMiniPricedVideoModel(input.videoModel)
      ? MANHUA_EPISODE_SEGMENTS_FOR_PRICING_MINI
      : MANHUA_EPISODE_SEGMENTS_FOR_PRICING;
  return perSegment * segments;
}

/** 对外可读的计费说明（可放 toast / 节点角标） */
export function describeCanvasVideoClipPrice(
  input: CanvasVideoPricingInput & { episodeSegmentCount?: number | null },
): string {
  const credits = canvasVideoClipCredits(input);
  if (input.isEpisodeSegment) {
    const episodeTotal = manhuaEpisodeTotalCredits({
      videoModel: input.videoModel,
      segmentCount: input.episodeSegmentCount,
    });
    return `${credits} 积分/段（整集 ${episodeTotal}）`;
  }
  return `${credits} 积分/段`;
}
