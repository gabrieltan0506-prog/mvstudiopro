/**
 * Wan 3.0 三通道路由（2026-08-25 用户拍板：OpenRouter → EvoLink → WaveSpeed，不走百炼官方）。
 *
 * 三家契约全部来自官方文档/实测，不是猜的：
 * - OpenRouter `alibaba/wan-3.0`（0825 Fly 内实测在架）：prompt / duration / resolution /
 *   aspect_ratio / generate_audio / seed / input_references(参考图)。
 *   🔴 **文档没有参考音频字段** —— 带参考音频（锁音轨）的请求本通道不具资格，自动跳过。
 * - EvoLink `wan3.0-reference-video`（官方文档 + 0825 实测在钥匙可用模型列表里）：
 *   image_urls ≤10 / audio_urls ≤5(合计≤15s) / video_urls ≤5 / duration 2–30 /
 *   quality 480p|720p|1080p / aspect_ratio / generate_audio / seed。轮询走 GET /v1/tasks/{id}。
 * - WaveSpeed `/api/v3/alibaba/wan-3.0/reference-to-video`（0820 双单实弹验证）：现有实现不动。
 *
 * 回落纪律（沿用 openrouterVideoCore 的 rejected/unknown 口径）：
 * - 明确 4xx 拒绝 = 上游确定没建单 → 安全换下一通道；
 * - 网络断 / 5xx / 2xx 缺任务号 = 任务可能已建 → **禁止回落**（否则一单变两单重复扣费），
 *   直接抛出转对账。
 */
import {
  isOpenRouterSubmitRejected,
  isOpenRouterVideoConfigured,
  submitOpenRouterVideoJob,
} from "./openrouterVideoCore.js";
import {
  isWavespeedWanConfigured,
  submitWavespeedWanVideo,
} from "./wavespeedWanVideo.js";
import {
  clampWan30Duration,
  normalizeWan30AspectRatio,
  normalizeWan30Resolution,
  WAN30_REFERENCE_MAX,
} from "../../shared/wanWavespeedModels.js";

export const OPENROUTER_WAN30_MODEL = "alibaba/wan-3.0" as const;
export const EVOLINK_WAN30_MODEL = "wan3.0-reference-video" as const;

/** 用户拍板的优先顺序；改优先级只动这一行 */
export const WAN30_CHANNEL_ORDER = ["openrouter", "evolink", "wavespeed"] as const;
export type Wan30Channel = (typeof WAN30_CHANNEL_ORDER)[number];

const EVOLINK_BASE = String(process.env.EVOLINK_API_BASE || "https://api.evolink.ai").replace(/\/$/, "");

export function isEvolinkWanConfigured(): boolean {
  return Boolean(String(process.env.EVOLINK_API_KEY || "").trim());
}

export function isWan30AnyChannelConfigured(): boolean {
  return isOpenRouterVideoConfigured() || isEvolinkWanConfigured() || isWavespeedWanConfigured();
}

/**
 * 本单资格（七审第9条）：下单闸不能只问「有没有通道」，要问「这一单有没有吃得下的通道」。
 * 带参考音频/视频时 OpenRouter 默认不具资格（未开放行旗）。
 */
export function hasEligibleWan30Channel(input: { hasAudioRefs?: boolean; hasVideoRefs?: boolean }): boolean {
  const needsMedia = Boolean(input.hasAudioRefs || input.hasVideoRefs);
  const openrouterOk = isOpenRouterVideoConfigured() && (!needsMedia || openRouterWanAudioAllowed());
  return openrouterOk || isEvolinkWanConfigured() || isWavespeedWanConfigured();
}

export type Wan30SubmitInput = {
  prompt: string;
  imageUrls: string[];
  audioUrls?: string[];
  videoUrls?: string[];
  duration?: number;
  resolution?: string;
  aspectRatio?: string;
  seed?: number;
  generateAudio?: boolean;
  /** WaveSpeed 专属深思模式；其余通道无此参数，忽略 */
  thinkingMode?: boolean;
};

function cleanUrls(list: unknown, max: number): string[] {
  return (Array.isArray(list) ? list : [])
    .map((u) => String(u || "").trim())
    .filter((u) => /^https?:\/\//i.test(u))
    .slice(0, max);
}

/**
 * OpenRouter 通道资格：参考音频/视频默认不走它。
 *
 * 依据（0825 Fly 内零成本实测）：OpenRouter 校验器对未知字段**静默容忍**——
 * `bogus_field_zzz` 与 `audio_urls`/`reference_audios` 得到一模一样的响应，
 * 即无法零成本证明音频字段真被消费；错了就是锁音轨静默丢（0824 事故形状）。
 * 用户口径「文档没写不代表没有」成立，但只能用一张真单证明。
 * 真单验证通过后设 `WAN30_OPENROUTER_ALLOW_AUDIO=1` 放行，音频以 `reference_audios`
 * 字段随单送出（Wan 系原生命名）；在那之前带音频的单子走 EvoLink → WaveSpeed。
 */
export function openRouterWanAudioAllowed(): boolean {
  return String(process.env.WAN30_OPENROUTER_ALLOW_AUDIO || "").trim() === "1";
}

export function openRouterWanEligible(input: Wan30SubmitInput): { ok: boolean; reasonZh?: string } {
  const allowMedia = openRouterWanAudioAllowed();
  if (!allowMedia && cleanUrls(input.audioUrls, WAN30_REFERENCE_MAX.audio).length) {
    return { ok: false, reasonZh: "OpenRouter 音频字段未经真单验证，带参考音频的请求跳过该通道（锁音轨不许静默丢；真单验证后设 WAN30_OPENROUTER_ALLOW_AUDIO=1 放行）" };
  }
  if (!allowMedia && cleanUrls(input.videoUrls, WAN30_REFERENCE_MAX.video).length) {
    return { ok: false, reasonZh: "OpenRouter 参考视频字段未经真单验证，带参考视频的请求跳过该通道" };
  }
  return { ok: true };
}

export function buildOpenRouterWanSubmitBody(input: Wan30SubmitInput): Record<string, unknown> {
  /**
   * 七审深度修正：静默丢参考轨的防线放进建造器本体，而不是只靠调用方先查资格——
   * 任何未来的直接调用者都过不去这道闸（0824 锁音轨事故的形状）。
   */
  if (!openRouterWanAudioAllowed()
    && (cleanUrls(input.audioUrls, WAN30_REFERENCE_MAX.audio).length
      || cleanUrls(input.videoUrls, WAN30_REFERENCE_MAX.video).length)) {
    throw new SubmitRejectedError("该通道未放行参考音频/视频，拒绝构建请求以防参考轨静默丢失");
  }
  const images = cleanUrls(input.imageUrls, WAN30_REFERENCE_MAX.image);
  if (!images.length) throw new Error("Wan 3.0 成片需要至少一张参考图");
  const body: Record<string, unknown> = {
    model: OPENROUTER_WAN30_MODEL,
    prompt: String(input.prompt || "").trim(),
    duration: clampWan30Duration(input.duration),
    resolution: normalizeWan30Resolution(input.resolution),
    aspect_ratio: normalizeWan30AspectRatio(input.aspectRatio),
    generate_audio: input.generateAudio !== false,
    /**
     * 参考图走 input_references（官方文档：reference-to-video 的风格参考数组）。
     * ⚠️ 元素形状按 frame_images 同构（文档只给了 frame_images 的示例）；
     * 若上游 400 报字段形状，会按「明确拒绝」安全回落 EvoLink，不会烧钱。
     */
    input_references: images.map((url) => ({ type: "image_url", image_url: { url } })),
  };
  if (openRouterWanAudioAllowed()) {
    // 仅在真单验证放行后送出；字段名按 Wan 系原生命名（与 WaveSpeed 同名）
    const audios = cleanUrls(input.audioUrls, WAN30_REFERENCE_MAX.audio);
    if (audios.length) body.reference_audios = audios;
    const videos = cleanUrls(input.videoUrls, WAN30_REFERENCE_MAX.video);
    if (videos.length) body.reference_videos = videos;
  }
  const seed = Math.floor(Number(input.seed));
  if (Number.isFinite(seed) && seed >= 0 && seed <= 2147483647) body.seed = seed;
  return body;
}

export function buildEvolinkWanRequestBody(input: Wan30SubmitInput): Record<string, unknown> {
  const images = cleanUrls(input.imageUrls, WAN30_REFERENCE_MAX.image);
  if (!images.length) throw new Error("Wan 3.0 成片需要至少一张参考图");
  const body: Record<string, unknown> = {
    model: EVOLINK_WAN30_MODEL,
    prompt: String(input.prompt || "").trim(),
    image_urls: images,
    duration: clampWan30Duration(input.duration),
    // EvoLink 管分辨率叫 quality（与 Seedance 同一约定），取值同 480p/720p/1080p
    quality: normalizeWan30Resolution(input.resolution),
    aspect_ratio: normalizeWan30AspectRatio(input.aspectRatio),
    generate_audio: input.generateAudio !== false,
  };
  const audios = cleanUrls(input.audioUrls, WAN30_REFERENCE_MAX.audio);
  if (audios.length) body.audio_urls = audios;
  const videos = cleanUrls(input.videoUrls, WAN30_REFERENCE_MAX.video);
  if (videos.length) body.video_urls = videos;
  const seed = Math.floor(Number(input.seed));
  if (Number.isFinite(seed) && seed >= 0 && seed <= 2147483647) body.seed = seed;
  return body;
}

/** 与 openrouterVideoCore 同口径；类体已抽共享（七审第7条），此处保留旧名再导出 */
export {
  SubmitRejectedError as Wan30SubmitRejectedError,
  SubmitUnknownError as Wan30SubmitUnknownError,
} from "./submitOutcomeErrors.js";
import { SubmitRejectedError, SubmitUnknownError } from "./submitOutcomeErrors.js";
const EVOLINK_DEFINITE_REJECT = new Set([400, 401, 403, 404, 413, 415, 422]);

export async function submitEvolinkWanVideo(
  input: Wan30SubmitInput,
): Promise<{ evolinkTaskId: string; immediateSourceUrl?: string }> {
  const apiKey = String(process.env.EVOLINK_API_KEY || "").trim();
  if (!apiKey) throw new SubmitRejectedError("Wan 3.0 通道未配置");
  const body = buildEvolinkWanRequestBody(input);
  let res: Response;
  try {
    res = await fetch(`${EVOLINK_BASE}/v1/videos/generations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    throw new SubmitUnknownError(
      `EvoLink 提交结果未知：${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const json = (await res.json().catch(() => ({}))) as {
    id?: string; status?: string; error?: { message?: string }; message?: string;
    video_url?: string; output?: { video_url?: string };
  };
  if (!res.ok) {
    const detail = `HTTP ${res.status} ${json.error?.message || json.message || ""}`.trim();
    if (EVOLINK_DEFINITE_REJECT.has(res.status)) throw new SubmitRejectedError(detail);
    throw new SubmitUnknownError(detail);
  }
  const taskId = String(json.id || "").trim();
  if (!taskId) throw new SubmitUnknownError("EvoLink 2xx 但未返回任务 ID");
  const immediate = String(json.video_url || json.output?.video_url || "").trim();
  return {
    evolinkTaskId: taskId,
    immediateSourceUrl:
      immediate && String(json.status || "").toLowerCase() === "completed" ? immediate : undefined,
  };
}

export type Wan30ChannelSubmission =
  | { channel: "openrouter"; openRouterJobId: string; pollingUrl: string; immediateSourceUrl?: string; apiKey: string }
  | { channel: "evolink"; evolinkTaskId: string; immediateSourceUrl?: string }
  | { channel: "wavespeed"; predictionId: string };

export type Wan30ChannelDeps = {
  openrouterConfigured: () => boolean;
  evolinkConfigured: () => boolean;
  wavespeedConfigured: () => boolean;
  submitOpenrouter: (body: Record<string, unknown>) => Promise<{
    openRouterJobId: string; pollingUrl: string; immediateSourceUrl?: string; apiKey: string;
  }>;
  submitEvolink: typeof submitEvolinkWanVideo;
  submitWavespeed: typeof submitWavespeedWanVideo;
};

const defaultDeps: Wan30ChannelDeps = {
  openrouterConfigured: isOpenRouterVideoConfigured,
  evolinkConfigured: isEvolinkWanConfigured,
  wavespeedConfigured: isWavespeedWanConfigured,
  submitOpenrouter: submitOpenRouterVideoJob,
  submitEvolink: submitEvolinkWanVideo,
  submitWavespeed: submitWavespeedWanVideo,
};

/**
 * 依序尝试三通道。明确拒绝才换下一家；「结果未知」立即停手抛出——
 * 那一刻上游可能已经建单开跑，再投第二家就是一单双烧。
 */
export async function submitWan30ViaChannels(
  input: Wan30SubmitInput,
  deps: Wan30ChannelDeps = defaultDeps,
  /** 崩溃恢复重提交时钉死原通道（七审第5条：句柄语义不同不能混，注释承诺过的事这次真做了） */
  pinChannel?: Wan30Channel,
): Promise<{ submitted: Wan30ChannelSubmission; skippedZh: string[] }> {
  const skippedZh: string[] = [];
  const order: readonly Wan30Channel[] = pinChannel ? [pinChannel] : WAN30_CHANNEL_ORDER;
  for (const channel of order) {
    if (channel === "openrouter") {
      if (!deps.openrouterConfigured()) { skippedZh.push("openrouter: 未配置"); continue; }
      const eligible = openRouterWanEligible(input);
      if (!eligible.ok) { skippedZh.push(`openrouter: ${eligible.reasonZh}`); continue; }
      try {
        const r = await deps.submitOpenrouter(buildOpenRouterWanSubmitBody(input));
        return { submitted: { channel, ...r }, skippedZh };
      } catch (e) {
        if (isOpenRouterSubmitRejected(e)) { skippedZh.push(`openrouter: 明确拒绝 ${e.message}`); continue; }
        throw e; // unknown：可能已建单，禁止回落
      }
    }
    if (channel === "evolink") {
      if (!deps.evolinkConfigured()) { skippedZh.push("evolink: 未配置"); continue; }
      try {
        const r = await deps.submitEvolink(input);
        return { submitted: { channel, ...r }, skippedZh };
      } catch (e) {
        if (e instanceof SubmitRejectedError) { skippedZh.push(`evolink: 明确拒绝 ${e.message}`); continue; }
        throw e;
      }
    }
    if (channel === "wavespeed") {
      if (!deps.wavespeedConfigured()) { skippedZh.push("wavespeed: 未配置"); continue; }
      try {
        const r = await deps.submitWavespeed({
          prompt: input.prompt,
          imageUrls: input.imageUrls,
          audioUrls: input.audioUrls,
          duration: input.duration,
          resolution: input.resolution,
          aspectRatio: input.aspectRatio,
          seed: input.seed,
          thinkingMode: input.thinkingMode,
          enableAudio: input.generateAudio,
        });
        return { submitted: { channel, predictionId: r.predictionId }, skippedZh };
      } catch (e) {
        if ((e as { kind?: string } | null)?.kind === "rejected") {
          skippedZh.push(`wavespeed: 明确拒绝 ${e instanceof Error ? e.message : String(e)}`);
          continue;
        }
        throw e; // unknown：单可能已建，禁止吞掉
      }
    }
  }
  /**
   * 七审规范修正：这条会经 failTask → task.error → 客户端 toast 直达普通用户，
   * 供应商名/环境变量名/原始上游错误体一律不进——细节只进服务端日志。
   */
  console.warn(`[wan30Channels] 全部通道不可用: ${skippedZh.join("；") || "无可用配置"}`);
  throw new Error("成片通道暂时不可用，请稍后重试");
}
