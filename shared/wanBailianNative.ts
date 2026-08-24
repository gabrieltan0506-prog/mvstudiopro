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

export type WanBailianMediaItem = {
  /** 与 input.media 顺序对应；提示词里按 Image N / Video N / Audio N 引用 */
  type: "image" | "video" | "audio";
  url: string;
};

export type WanBailianRequest = {
  model: typeof WAN_BAILIAN_MODEL;
  input: { prompt: string; media?: WanBailianMediaItem[] };
  parameters: { resolution: WanBailianResolution; ratio: WanBailianRatio; duration: number };
};

export function buildWanBailianRequest(input: {
  prompt: string;
  media?: readonly WanBailianMediaItem[];
  resolution?: WanBailianResolution;
  ratio?: WanBailianRatio;
  durationSec?: number;
}): WanBailianRequest {
  const prompt = String(input.prompt || "").trim();
  if (!prompt) throw new Error("Wan 3.0 缺少提示词");
  const media = (input.media || []).filter((m) => /^https:\/\//.test(String(m?.url || "")));
  return {
    model: WAN_BAILIAN_MODEL,
    input: { prompt, ...(media.length ? { media: [...media] } : {}) },
    parameters: {
      resolution: input.resolution || "480P",
      ratio: input.ratio || "adaptive",
      duration: clampWanBailianDuration(input.durationSec),
    },
  };
}
