/**
 * HappyHorse 1.1 三通道路由（2026-08-25 用户拍板：EvoLink → OpenRouter → WaveSpeed，拆掉百炼）。
 *
 * 变体选型：接的是各家 **image-to-video 首帧** 变体，不是 reference-to-video——
 * 「照片动起来」的产品契约是照片＝第一帧；r2v 是风格参考语义，产物未必从那张照片起。
 * （EvoLink i2v 与原百炼官方一致：画幅随首帧图、不收 aspect_ratio。）
 *
 * 契约全部来自官方文档（0825 抓取），不是猜的：
 * - EvoLink `happyhorse-1.1-image-to-video`：image_urls[0]=首帧 / duration 3–15 /
 *   quality 720p|1080p / 无 aspect_ratio / seed 1–2147483647。轮询 GET /v1/tasks/{id}。
 * - OpenRouter `alibaba/happyhorse-1.1`：现有 buildOpenRouterHappyHorseSubmitBody
 *   （frame_images first_frame），已在产、不动。
 * - WaveSpeed `/api/v3/alibaba/happyhorse-1.1/image-to-video`：image=首帧 / duration 3–15 /
 *   resolution / seed 0–2147483647。predictions 轮询与 wan 共用。
 *
 * 回落纪律与 wan30Channels 同口径：明确 4xx 才换下一家；结果未知禁止回落转对账。
 * 百炼在途老单（bailianTaskId）只轮询收尾，绝不再新建。
 */
import {
  buildOpenRouterHappyHorseSubmitBody,
  isOpenRouterHappyHorseConfigured,
} from "./openrouterHappyHorseVideo.js";
import { submitOpenRouterVideoJob } from "./openrouterVideoCore.js";
import {
  isWavespeedWanConfigured,
  submitWavespeedPredictionRequest,
} from "./wavespeedWanVideo.js";
import { SubmitRejectedError, SubmitUnknownError } from "./submitOutcomeErrors.js";
import {
  HOME_PHOTO_ANIMATE_DEFAULT_RESOLUTION,
  isHomePhotoAnimateResolution,
} from "../../shared/homePhotoTools.js";

export const EVOLINK_HAPPYHORSE_I2V_MODEL = "happyhorse-1.1-image-to-video" as const;
export const EVOLINK_HAPPYHORSE_R2V_MODEL = "happyhorse-1.1-reference-to-video" as const;
export const WAVESPEED_HAPPYHORSE_I2V_PATH =
  "/api/v3/alibaba/happyhorse-1.1/image-to-video" as const;
export const WAVESPEED_HAPPYHORSE_R2V_PATH =
  "/api/v3/alibaba/happyhorse-1.1/reference-to-video" as const;
export const HAPPYHORSE_REFERENCE_MAX_IMAGES = 9;

/** 用户拍板的优先顺序；改优先级只动这一行 */
export const HAPPYHORSE_CHANNEL_ORDER = ["evolink", "openrouter", "wavespeed"] as const;
export type HappyHorseChannel = (typeof HAPPYHORSE_CHANNEL_ORDER)[number];

const EVOLINK_BASE = String(process.env.EVOLINK_API_BASE || "https://api.evolink.ai").replace(/\/$/, "");

export function isEvolinkHappyHorseConfigured(): boolean {
  return Boolean(String(process.env.EVOLINK_API_KEY || "").trim());
}

export function isAnyHappyHorseChannelConfigured(): boolean {
  return isEvolinkHappyHorseConfigured()
    || isOpenRouterHappyHorseConfigured()
    || isWavespeedWanConfigured();
}

export type HappyHorseSubmitInput = {
  prompt: string;
  /** 首帧图（单张；照片动起来的产品契约=照片即第一帧） */
  imageUrl: string;
  /**
   * 自由画布多图参考（0825 用户拍板加的 r2v 能力）：
   * 有效图 ≥2 张时自动切 reference-to-video 变体（1–9 张，
   * 提示词用 character1/character2/character3 指代各图角色）；
   * 单图保持 i2v 首帧，行为零漂移。
   */
  imageUrls?: string[];
  duration?: number;
  resolution?: string;
  /** i2v 时仅 OpenRouter 用（EvoLink/WaveSpeed i2v 画幅随首帧）；r2v 三家契约均收 */
  aspectRatio?: string;
  seed?: number;
};

export type HappyHorseMode = "first_frame" | "reference";

function collectHappyHorseRefs(input: HappyHorseSubmitInput): string[] {
  const list = [String(input.imageUrl || "").trim(), ...(input.imageUrls || []).map((u) => String(u || "").trim())];
  return Array.from(new Set(list.filter((u) => /^https?:\/\//i.test(u)))).slice(0, HAPPYHORSE_REFERENCE_MAX_IMAGES);
}

export function resolveHappyHorseMode(input: HappyHorseSubmitInput): HappyHorseMode {
  return collectHappyHorseRefs(input).length > 1 ? "reference" : "first_frame";
}

const HAPPYHORSE_R2V_ASPECT_RATIOS = new Set(["16:9", "9:16", "1:1", "4:3", "3:4", "4:5", "5:4", "9:21", "21:9"]);
function normalizeR2vAspectRatio(raw: unknown): string {
  const key = String(raw || "").trim();
  return HAPPYHORSE_R2V_ASPECT_RATIOS.has(key) ? key : "16:9";
}

function clampHappyHorseDuration(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return 5;
  return Math.min(15, Math.max(3, n));
}

function normalizeHappyHorseResolution(raw: unknown): string {
  const key = String(raw || "").trim().toLowerCase();
  return isHomePhotoAnimateResolution(key) ? key : HOME_PHOTO_ANIMATE_DEFAULT_RESOLUTION;
}

export function buildEvolinkHappyHorseRequestBody(input: HappyHorseSubmitInput): Record<string, unknown> {
  const refs = collectHappyHorseRefs(input);
  if (!refs.length) throw new Error("照片动画需要至少一张参考图");
  const mode = resolveHappyHorseMode(input);
  const body: Record<string, unknown> = {
    // i2v：数组首项即首帧、画幅随首帧不收 aspect_ratio；r2v：1–9 张参考、收 aspect_ratio
    model: mode === "reference" ? EVOLINK_HAPPYHORSE_R2V_MODEL : EVOLINK_HAPPYHORSE_I2V_MODEL,
    prompt: String(input.prompt || "").trim(),
    image_urls: mode === "reference" ? refs : [refs[0]],
    duration: clampHappyHorseDuration(input.duration),
    quality: normalizeHappyHorseResolution(input.resolution),
  };
  if (mode === "reference") body.aspect_ratio = normalizeR2vAspectRatio(input.aspectRatio);
  const seed = Math.floor(Number(input.seed));
  if (Number.isFinite(seed) && seed >= 1 && seed <= 2147483647) body.seed = seed;
  return body;
}

export function buildWavespeedHappyHorseRequestBody(input: HappyHorseSubmitInput): Record<string, unknown> {
  const refs = collectHappyHorseRefs(input);
  if (!refs.length) throw new Error("照片动画需要至少一张参考图");
  const mode = resolveHappyHorseMode(input);
  const body: Record<string, unknown> = {
    prompt: String(input.prompt || "").trim(),
    duration: clampHappyHorseDuration(input.duration),
    resolution: normalizeHappyHorseResolution(input.resolution),
  };
  if (mode === "reference") {
    body.images = refs;
    body.aspect_ratio = normalizeR2vAspectRatio(input.aspectRatio);
  } else {
    body.image = refs[0];
  }
  const seed = Math.floor(Number(input.seed));
  if (Number.isFinite(seed) && seed >= 0 && seed <= 2147483647) body.seed = seed;
  return body;
}

const EVOLINK_DEFINITE_REJECT = new Set([400, 401, 403, 404, 413, 415, 422]);

export async function submitEvolinkHappyHorseVideo(
  input: HappyHorseSubmitInput,
): Promise<{ evolinkTaskId: string; immediateSourceUrl?: string }> {
  const apiKey = String(process.env.EVOLINK_API_KEY || "").trim();
  if (!apiKey) throw new SubmitRejectedError("照片动画通道未配置");
  const body = buildEvolinkHappyHorseRequestBody(input);
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

export type HappyHorseChannelSubmission =
  | { channel: "evolink"; evolinkTaskId: string; immediateSourceUrl?: string }
  | { channel: "openrouter"; openRouterJobId: string; pollingUrl: string; immediateSourceUrl?: string; apiKey: string; model: string }
  | { channel: "wavespeed"; predictionId: string };

export type HappyHorseChannelDeps = {
  evolinkConfigured: () => boolean;
  openrouterConfigured: () => boolean;
  wavespeedConfigured: () => boolean;
  submitEvolink: typeof submitEvolinkHappyHorseVideo;
  submitOpenrouter: (body: Record<string, unknown>) => Promise<{
    openRouterJobId: string; pollingUrl: string; immediateSourceUrl?: string; apiKey: string; model: string;
  }>;
  submitWavespeed: typeof submitWavespeedPredictionRequest;
};

const defaultDeps: HappyHorseChannelDeps = {
  evolinkConfigured: isEvolinkHappyHorseConfigured,
  openrouterConfigured: isOpenRouterHappyHorseConfigured,
  wavespeedConfigured: isWavespeedWanConfigured,
  submitEvolink: submitEvolinkHappyHorseVideo,
  submitOpenrouter: submitOpenRouterVideoJob,
  submitWavespeed: submitWavespeedPredictionRequest,
};

/** 明确拒绝才换下一家；结果未知立即停手抛出（可能已建单，投第二家=一单双烧） */
export async function submitHappyHorseViaChannels(
  input: HappyHorseSubmitInput,
  deps: HappyHorseChannelDeps = defaultDeps,
  /** 崩溃恢复重提交时钉死原通道 */
  pinChannel?: HappyHorseChannel,
): Promise<{ submitted: HappyHorseChannelSubmission; skippedZh: string[] }> {
  const skippedZh: string[] = [];
  const order: readonly HappyHorseChannel[] = pinChannel ? [pinChannel] : HAPPYHORSE_CHANNEL_ORDER;
  for (const channel of order) {
    if (channel === "evolink") {
      if (!deps.evolinkConfigured()) { skippedZh.push("evolink: 未配置"); continue; }
      try {
        const r = await deps.submitEvolink(input);
        return { submitted: { channel, ...r }, skippedZh };
      } catch (e) {
        if ((e as { kind?: string } | null)?.kind === "rejected") {
          skippedZh.push(`evolink: 明确拒绝 ${e instanceof Error ? e.message : String(e)}`);
          continue;
        }
        throw e;
      }
    }
    if (channel === "openrouter") {
      if (!deps.openrouterConfigured()) { skippedZh.push("openrouter: 未配置"); continue; }
      if (resolveHappyHorseMode(input) === "reference") {
        // 多图参考不在该通道契约里；硬送=静默降级成单图，跳过（防参考图静默丢）
        skippedZh.push("openrouter: 多图参考未在通道契约中，跳过");
        continue;
      }
      try {
        const r = await deps.submitOpenrouter(buildOpenRouterHappyHorseSubmitBody({
          prompt: input.prompt,
          imageUrl: input.imageUrl,
          duration: input.duration,
          resolution: input.resolution as never,
          aspectRatio: input.aspectRatio,
        }));
        return { submitted: { channel, ...r }, skippedZh };
      } catch (e) {
        if ((e as { kind?: string } | null)?.kind === "rejected") {
          skippedZh.push(`openrouter: 明确拒绝 ${e instanceof Error ? e.message : String(e)}`);
          continue;
        }
        throw e;
      }
    }
    if (channel === "wavespeed") {
      if (!deps.wavespeedConfigured()) { skippedZh.push("wavespeed: 未配置"); continue; }
      try {
        const r = await deps.submitWavespeed(
          resolveHappyHorseMode(input) === "reference"
            ? WAVESPEED_HAPPYHORSE_R2V_PATH
            : WAVESPEED_HAPPYHORSE_I2V_PATH,
          buildWavespeedHappyHorseRequestBody(input),
          "照片动画",
        );
        return { submitted: { channel, predictionId: r.predictionId }, skippedZh };
      } catch (e) {
        if ((e as { kind?: string } | null)?.kind === "rejected") {
          skippedZh.push(`wavespeed: 明确拒绝 ${e instanceof Error ? e.message : String(e)}`);
          continue;
        }
        throw e;
      }
    }
  }
  // 用户可见错误只给业务友好句；细节进服务端日志（规范§一）
  console.warn(`[happyHorseChannels] 全部通道不可用: ${skippedZh.join("；") || "无可用配置"}`);
  throw new Error("照片动画通道暂时不可用，请稍后重试");
}
