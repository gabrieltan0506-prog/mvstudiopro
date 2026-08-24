/**
 * Wan 3.0 · **百炼原生**协议常量（0824 用户给的 curl 实样）。
 *
 * ⚠️ 与 WaveSpeed 封装**不是一套，字段不得混用**：
 *
 * | | 百炼原生（本文件） | WaveSpeed（`wanWavespeedModels.ts`） |
 * |---|---|---|
 * | 端点 | `{专属base}/api/v1/services/aigc/video-generation/video-synthesis` | WaveSpeed 模型路由 |
 * | 异步 | 请求头 `X-DashScope-Async: enable` | 建单即返回 taskId |
 * | 提示词 | `input.prompt` | 顶层 `prompt` |
 * | 参考 | `input.media[]` | `reference_images` / `reference_audios` |
 * | 分辨率 | `"480P"` **大写 P** | `"480p"` **小写 p** |
 * | 引用写法 | `Image 1` / `Video 1`，按 `input.media` 内同类型顺序计 | 同左 |
 *
 * 大小写这一处最容易栽：抄错一边就是参数错误，而异步任务要等轮询才知道失败。
 */

export const WAN_BAILIAN_MODEL = "wan3.0-video" as const;

export const WAN_BAILIAN_PATH = "/api/v1/services/aigc/video-generation/video-synthesis";

/** 异步必带；不带这个头会走同步、长任务必超时 */
export const WAN_BAILIAN_ASYNC_HEADER = { "X-DashScope-Async": "enable" } as const;

/** 百炼原生用大写 P —— WaveSpeed 那边是小写，别抄串 */
export const WAN_BAILIAN_RESOLUTIONS = ["480P", "720P", "1080P"] as const;
export type WanBailianResolution = (typeof WAN_BAILIAN_RESOLUTIONS)[number];

/** adaptive = 跟随参考素材；其余为显式比例 */
export const WAN_BAILIAN_RATIOS = ["adaptive", "16:9", "9:16", "1:1"] as const;
export type WanBailianRatio = (typeof WAN_BAILIAN_RATIOS)[number];

/** 官方口径：最长 30 秒 */
export const WAN_BAILIAN_DURATION = { min: 2, max: 30, default: 5 } as const;

export function clampWanBailianDuration(raw?: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return WAN_BAILIAN_DURATION.default;
  return Math.min(WAN_BAILIAN_DURATION.max, Math.max(WAN_BAILIAN_DURATION.min, n));
}

/**
 * `input.media[].type` 官方枚举（help.aliyun.com 万相3.0 API 参考，0824 更新）。
 *
 * ⚠️ 上一版我照 curl 示例猜成 `image | video | audio` —— **全错**。
 * 示例里只出现过 `file` 一种，我把它当成了「类型随便写」。
 */
export const WAN_BAILIAN_MEDIA_TYPES = [
  "first_frame",
  "last_frame",
  "reference_image",
  "reference_video",
  "reference_audio",
  "file",
  "link",
] as const;
export type WanBailianMediaType = (typeof WAN_BAILIAN_MEDIA_TYPES)[number];

/** 参考类：与首尾帧互斥 */
const REFERENCE_LIKE: readonly WanBailianMediaType[] = [
  "reference_image",
  "reference_video",
  "reference_audio",
  "file",
  "link",
];
/** 首尾帧类：图生视频用 */
const FRAME_LIKE: readonly WanBailianMediaType[] = ["first_frame", "last_frame"];

/** 官方数量与时长上限 */
export const WAN_BAILIAN_MEDIA_LIMITS = {
  reference_video: { maxItems: 5, totalSec: 15 },
  reference_audio: { maxItems: 5, totalSec: 15 },
  file: { maxItems: 1 },
  link: { maxItems: 1 },
} as const;

/** prompt 上限 20000 字符，超出**自动截断**（不是报错） */
export const WAN_BAILIAN_PROMPT_MAX_CHARS = 20_000;

export type WanBailianMediaItem = {
  type: WanBailianMediaType;
  /**
   * 媒体地址。**只收 https URL。**
   *
   * 官方文档写着「URL 或 Base64 编码数据」，但本仓一律走 URL ——
   * 这条铁律是 0821 用 base64 传图连撞两次 413、0822 又写了把 49MB 视频
   * 转 base64 内联的代码换来的（四十小时内同一条铁律犯两次）。
   * 上游支持不等于我们要用。
   */
  url: string;
};

/**
 * 校验 media 组合。
 *
 * 三条官方硬规则，传错就是整单参数错误，而异步任务要等轮询才知道：
 *   · reference_xx / file / link 与 first_frame / last_frame **类型互斥**
 *   · file 与 link 不可同时输入，各自最多 1 个
 *   · reference_video / reference_audio 各最多 5 段
 */
export function assertWanBailianMedia(media: readonly WanBailianMediaItem[]): void {
  if (!media.length) return;
  const kinds = media.map((m) => m.type);
  const hasRef = kinds.some((k) => REFERENCE_LIKE.includes(k));
  const hasFrame = kinds.some((k) => FRAME_LIKE.includes(k));
  if (hasRef && hasFrame) {
    throw new Error("Wan 3.0：参考类（reference_*/file/link）与首尾帧类不能同一请求混用");
  }
  if (kinds.includes("file") && kinds.includes("link")) {
    throw new Error("Wan 3.0：file 与 link 不可同时输入");
  }
  const count = (t: WanBailianMediaType) => media.filter((m) => m.type === t).length;
  if (count("file") > 1) throw new Error("Wan 3.0：file 最多 1 个");
  if (count("link") > 1) throw new Error("Wan 3.0：link 最多 1 个");
  if (count("reference_video") > WAN_BAILIAN_MEDIA_LIMITS.reference_video.maxItems) {
    throw new Error("Wan 3.0：reference_video 最多 5 段");
  }
  if (count("reference_audio") > WAN_BAILIAN_MEDIA_LIMITS.reference_audio.maxItems) {
    throw new Error("Wan 3.0：reference_audio 最多 5 段");
  }
}

/**
 * 提示词里的素材引用改写成**中文**「图N」「视频N」。
 *
 * ⚠️ 与 WaveSpeed 那套相反：那边是英文 `Image 1`/`Video 1`。
 * 官方原话：「prompt 中可以用"图1""视频1"等指代 media 数组中对应顺序的媒体素材」。
 * **图和视频分别计数** —— 可同时存在「图1」和「视频1」。
 */
export function normalizeWanBailianReferenceMarkers(text: string): string {
  return String(text || "")
    .replace(/@(?:图|图片)(\d+)/g, "图$1")
    .replace(/@(?:视频|影片)(\d+)/g, "视频$1")
    .replace(/@(?:音频|声音)(\d+)/g, "音频$1")
    .replace(/\bImage\s*(\d+)/gi, "图$1")
    .replace(/\bVideo\s*(\d+)/gi, "视频$1")
    .replace(/\bAudio\s*(\d+)/gi, "音频$1");
}

export type WanBailianRequest = {
  model: typeof WAN_BAILIAN_MODEL;
  input: { prompt?: string; media?: WanBailianMediaItem[] };
  parameters: { resolution: WanBailianResolution; ratio: WanBailianRatio; duration: number };
};

export function buildWanBailianRequest(input: {
  prompt?: string;
  media?: readonly WanBailianMediaItem[];
  resolution?: WanBailianResolution;
  ratio?: WanBailianRatio;
  durationSec?: number;
}): WanBailianRequest {
  const prompt = String(input.prompt || "")
    .trim()
    .slice(0, WAN_BAILIAN_PROMPT_MAX_CHARS);
  // 只收 https：http 明文与 data: base64 一律挡在这里
  const media = (input.media || []).map((m) => ({ ...m, url: String(m?.url || "").trim() }));
  for (const m of media) {
    if (m.url.startsWith("data:")) {
      throw new Error("Wan 3.0：媒体一律走 URL，不接受 base64（本仓铁律，上游支持也不用）");
    }
    if (!/^https:\/\//.test(m.url)) {
      throw new Error(`Wan 3.0：媒体必须是 https URL，收到 ${m.url.slice(0, 40)}`);
    }
  }
  // prompt 与 media 二选一必填（官方原话）
  if (!prompt && !media.length) {
    throw new Error("Wan 3.0：prompt 与 media 至少要有一项");
  }
  assertWanBailianMedia(media);
  return {
    model: WAN_BAILIAN_MODEL,
    input: {
      ...(prompt ? { prompt: normalizeWanBailianReferenceMarkers(prompt) } : {}),
      ...(media.length ? { media: [...media] } : {}),
    },
    parameters: {
      resolution: input.resolution || "480P",
      ratio: input.ratio || "adaptive",
      duration: clampWanBailianDuration(input.durationSec),
    },
  };
}
