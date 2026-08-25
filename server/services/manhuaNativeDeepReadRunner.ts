/**
 * 原生视频精读 · 生产执行器（0824 从旁路脚本迁入）。
 *
 * 0823 旁路实测：262 秒素材 → 6 段 → 95 个镜头，$0.566，全部 finish=stop。
 * 与抽帧链路的根本差别：运镜、转场、力度是**帧与帧之间的差分**，
 * 不存在于任何单帧里 —— 抽帧在采样那一刻就丢了，模型再强也补不回来。
 *
 * ⚠️ 默认关闭（MANHUA_NATIVE_DEEP_READ=1 才启用）。
 * 唤醒档第 14 节要求：先跑 10 集旁路、四项判定全过，才允许切生产。
 */
import crypto from "node:crypto";
import https from "node:https";
import { execFile } from "node:child_process";
import { readFile, stat, unlink } from "node:fs/promises";
import {
  mapNativeDeepReadSegments,
  type NativeDeepReadOutput,
} from "../../shared/manhuaNativeDeepRead.js";
import { MANHUA_NATIVE_DEEP_READ_MODEL } from "../../shared/manhuaNativeDeepReadJob.js";
import type { ManhuaNativeAudioEvidence } from "../../shared/manhuaNativeAudioAnalysis.js";
import {
  deleteGcsObject,
  signGsUriV4ReadUrl,
  uploadBufferToGcs,
} from "./gcs.js";

/** 生产开关：未开时学习链路完全走原有抽帧，零行为变化 */
export function isManhuaNativeDeepReadEnabled(): boolean {
  return String(process.env.MANHUA_NATIVE_DEEP_READ || "").trim() === "1";
}

export const SINGAPORE_TOKEN_PLAN_CHAT_ENDPOINT =
  "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions";

/**
 * 原生精读只允许走新加坡 Token Plan。
 *
 * 不能读取 `DASHSCOPE_SG_BASE`：它是普通业务空间地址，与套餐 key 配对会返回 401。
 * 更不能回落 WAN 官方按量通道；套餐缺配时关闭式停止。
 */
export function resolveNativeDeepReadCredentials(): { apiKey: string; endpoint: string; usingPlan: boolean } {
  return {
    apiKey: String(process.env.DASHSCOPE_SG_PLAN_KEY || "").trim(),
    endpoint: SINGAPORE_TOKEN_PLAN_CHAT_ENDPOINT,
    usingPlan: true,
  };
}

export type NativeDeepReadExecutionCredentials = {
  apiKey: string;
  endpoint: string;
  usingPlan?: boolean;
};

/**
 * 凭证最终裁决：**成对给或都不给**，生产默认只认新加坡套餐。
 *
 * 原来允许只传 apiKey 或只传 endpoint —— 那会把套餐 key 拼到公共 dashscope 端点
 * （401），或把按量 key 拼到套餐端点。更糟的是套餐临时缺配时**自动回落按量**，
 * 只打一行日志：计划里报的是套餐额度，实际扣的是充值余额，
 * 而发车检查单在这一步之后，拦不住。
 */
export function resolveNativeDeepReadExecutionCredentials(params: {
  apiKey?: string;
  endpoint?: string;
}): NativeDeepReadExecutionCredentials {
  const explicitKey = String(params.apiKey || "").trim();
  const explicitEndpoint = String(params.endpoint || "").trim();

  if (Boolean(explicitKey) !== Boolean(explicitEndpoint)) {
    throw new Error("原生精读自定义凭证必须同时提供 apiKey 与 endpoint");
  }

  if (explicitKey && explicitEndpoint) {
    const url = new URL(explicitEndpoint);
    if (url.protocol !== "https:") {
      throw new Error("原生精读 endpoint 必须使用 HTTPS");
    }
    return { apiKey: explicitKey, endpoint: explicitEndpoint, usingPlan: undefined };
  }

  const resolved = resolveNativeDeepReadCredentials();
  if (!resolved.apiKey) {
    throw new Error("原生精读缺少 DASHSCOPE_SG_PLAN_KEY，已停止；禁止回落按量通道");
  }
  return resolved;
}

/** 响应体上限：模型异常时可能吐超大 body，不设限会把内存吃干 */
const NATIVE_RESPONSE_CAP_BYTES = 4 * 1024 * 1024;
/**
 * Qwen 原生视频精读是非流式长请求：线上 9 分钟切片曾在 159–473 秒后才返回首字节。
 * 120 秒 socket idle 会把正常推理误判成断线；保留 30 分钟总时限，再用 10 分钟
 * 空闲时限识别真正失联。两道时限必须分别命名，避免后续又把短 HTTP 探活口径搬回来。
 */
export const NATIVE_DEEP_READ_REQUEST_IDLE_TIMEOUT_MS = 10 * 60_000;
export const NATIVE_DEEP_READ_REQUEST_TOTAL_TIMEOUT_MS = 30 * 60_000;

function abortReason(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error ? signal.reason : new Error("已取消");
}

/**
 * 一个可直接喂给 ffmpeg 的媒体节点。
 *
 * 从 `string` 扩成对象是因为**两个来源的节点性质不同**：
 *   · batch 脚本给的是页面 URL，要先 yt-dlp 解析出 CDN 副本；
 *   · 生产主链给的是素材接入层**已经探测成功**的媒体直链，附带它验证过的 Referer。
 * 后者再跑一次 yt-dlp 只会失败——直链没有 `bytevc1_540p` 这种 format_id。
 * Referer 丢了同样会被 CDN 拒，旧抽帧链路一路带着它。
 */
export type NativeDeepReadMediaNode = {
  url: string;
  referer?: string;
};

export type NativeDeepReadSegmentSpec = {
  /** 全片绝对秒 */
  startSec: number;
  endSec: number;
  /** 给模型的段落提示（来自粗读 hotspots 的 whyZh） */
  hintZh?: string;
};

export type NativeDeepReadRunResult = NativeDeepReadOutput & {
  /** 实际计费用量，供 provenance 落库 */
  usage: { inputTokens: number; outputTokens: number; costCny: number };
  attemptedSegments: number;
  /** 这一轮是否吃的套餐额度；false 表示扣了充值余额，对账要看这个 */
  usingPlanQuota?: boolean;
  /** 真跑的模型名，落 provenance 用（不让入库端自己再写一遍常量） */
  model: string;
  /** 同一次多视频请求的批次标识；逐集卡共享它，便于证明 N 集只打了一次 Qwen。 */
  batchRequestId?: string;
  /** 该次 Qwen 请求实际包含的剧集数。 */
  batchEpisodeCount?: number;
};

export type NativeDeepReadBatchRunEpisode = {
  episodeIndex: number;
  resolveNodes: () => Promise<NativeDeepReadMediaNode[]>;
  segments: readonly NativeDeepReadSegmentSpec[];
  sourceDurationSec: number;
  hintZh?: string;
  audioEvidence?: ManhuaNativeAudioEvidence;
};

export type NativeDeepReadBatchRunResult = {
  episodes: Array<{ episodeIndex: number; result: NativeDeepReadRunResult }>;
  usage: { inputTokens: number; outputTokens: number; costCny: number };
  usingPlanQuota?: boolean;
  model: string;
  batchRequestId: string;
};

export type NativeDeepReadVisualModelReceipt = {
  stage: "visual_model" | "visual_parse";
  status: "started" | "completed" | "failed";
  batchRequestId: string;
  episodeIndexes: number[];
  videoCount: number;
  elapsedMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  finishReason?: string;
  errorZh?: string;
};

async function emitVisualModelReceipt(
  receipt: NativeDeepReadVisualModelReceipt,
  callback?: (receipt: NativeDeepReadVisualModelReceipt) => void | Promise<void>,
): Promise<void> {
  console.info(`[nativeDeepReadModel] ${JSON.stringify(receipt)}`);
  try {
    await callback?.(receipt);
  } catch (error) {
    console.warn(
      "[nativeDeepReadModel] 画面阶段回执写入未完成：",
      error instanceof Error ? error.message : error,
    );
  }
}

export type NativeDeepReadRunError = Error & {
  /** 中止前已取得用量回执的成本；当前在途请求可能尚无回执。 */
  nativeDeepReadCostCny?: number;
  nativeDeepReadUsage?: {
    inputTokens: number;
    outputTokens: number;
    costCny: number;
    usingPlanQuota?: boolean;
    receiptComplete: boolean;
  };
};

/** 请求与前端共用共享真值；provenance 记的必须是真跑的这个。 */
export const NATIVE_DEEP_READ_MODEL = MANHUA_NATIVE_DEEP_READ_MODEL;

/** 新加坡套餐等值单价（¥/M token），只用于用量回执与预算估算 */
const PRICE_IN_PER_M = 14.988;
const PRICE_OUT_PER_M = 44.965;

function run(
  cmd: string,
  args: string[],
  timeoutMs = 600_000,
  abortSignal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) =>
    // signal 直通：取消时 ffmpeg 会被杀掉，否则一段 18 分钟的切片要跑完才停
    execFile(
      cmd,
      args,
      { maxBuffer: 1 << 28, timeout: timeoutMs, signal: abortSignal },
      (err, stdout, stderr) =>
        err ? reject(new Error(String(stderr || err).slice(0, 300))) : resolve(stdout),
    ),
  );
}

/**
 * Node 内置 fetch（undici）headersTimeout 写死 300 秒且不可覆盖，
 * 而单次精读实测 159–272 秒、长片粗读到过 473 秒 —— 必须手写请求自控超时。
 */
function postLong(
  body: unknown,
  apiKey: string,
  endpoint: string,
  timeoutMs = NATIVE_DEEP_READ_REQUEST_TOTAL_TIMEOUT_MS,
  abortSignal?: AbortSignal,
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(endpoint);
    const payload = Buffer.from(JSON.stringify(body));
    let settled = false;
    let receivedBytes = 0;
    // socket idle timeout 只管「多久没数据」；服务端细水长流地吐能绕过它，
    // 所以另设一道总时限
    const totalTimer = setTimeout(
      () => req.destroy(new Error("原生精读请求超过总时限")),
      timeoutMs,
    );
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(totalTimer);
      fn();
    };
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || undefined,
        path: `${u.pathname}${u.search}`,
        method: "POST",
        signal: abortSignal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Content-Length": payload.length,
        },
      },
      (res) => {
        let d = "";
        res.setEncoding("utf8");
        res.on("data", (c: string) => {
          receivedBytes += Buffer.byteLength(c);
          if (receivedBytes > NATIVE_RESPONSE_CAP_BYTES) {
            req.destroy(new Error("原生精读响应超过处理上限"));
            return;
          }
          d += c;
        });
        res.on("end", () => finish(() => resolve({ status: res.statusCode || 0, text: d })));
      },
    );
    req.setTimeout(
      NATIVE_DEEP_READ_REQUEST_IDLE_TIMEOUT_MS,
      () => req.destroy(new Error("原生精读连接长时间无数据")),
    );
    req.on("error", (e) => finish(() => reject(e)));
    req.write(payload);
    req.end();
  });
}

/** 官方单视频 2000 帧上限内留 10% 余量，避免取整后越界。 */
export const NATIVE_DEEP_READ_TARGET_FRAMES = 1_800;
/** 计划确认码的一部分；采样/装箱规则变化必须让旧确认码失效。 */
export const NATIVE_DEEP_READ_VISUAL_PLAN_VERSION = "adaptive-1800f-360s-v1" as const;
/** OpenAI 兼容视频输入的官方 fps 上限。 */
export const NATIVE_DEEP_READ_MAX_FPS = 10;
/** 百炼官方多视频输入上限；超过时由执行层拆成多个请求包。 */
export const NATIVE_DEEP_READ_MAX_VIDEOS_PER_REQUEST = 64;
/**
 * 给文本提示与返回 JSON 留余量的视觉输入预算。
 * Qwen 3.8 Max 最大输入约 99 万 token；这里保守控制在 80 万。
 */
export const NATIVE_DEEP_READ_BATCH_VISION_TOKEN_BUDGET = 800_000;
/** 与请求中的 max_pixels 保持一致，用于发车前估算多视频装箱。 */
export const NATIVE_DEEP_READ_VIDEO_DEFAULT_MAX_PIXELS = 655_360;
export const NATIVE_DEEP_READ_VIDEO_MIN_PIXELS = 65_536;

export function resolveNativeDeepReadInputFps(durationSec: number): number {
  const duration = Math.max(1, Number(durationSec) || 1);
  const raw = Math.min(NATIVE_DEEP_READ_MAX_FPS, NATIVE_DEEP_READ_TARGET_FRAMES / duration);
  return Math.max(0.1, Math.floor(raw * 100) / 100);
}

function resolveSegmentDurations(input: {
  durationSec: number;
  segments?: readonly NativeDeepReadSegmentSpec[];
}): number[] {
  const rows = input.segments?.map((row) => Math.max(1, row.endSec - row.startSec)) || [];
  return rows.length ? rows : [Math.max(1, input.durationSec)];
}

function estimatedFramePairs(durationSec: number): number {
  const duration = Math.max(1, Number(durationSec) || 1);
  const fps = resolveNativeDeepReadInputFps(duration);
  const frames = Math.max(4, Math.min(NATIVE_DEEP_READ_TARGET_FRAMES, Math.ceil(duration * fps)));
  return Math.ceil(frames / 2);
}

export function estimateNativeDeepReadVideoTokens(
  durationSec: number,
  maxPixels = NATIVE_DEEP_READ_VIDEO_DEFAULT_MAX_PIXELS,
): number {
  // 官方估算式：ceil(frames / 2) × pixels / (32×32) + 2 个视觉边界 token。
  return estimatedFramePairs(durationSec) * (maxPixels / (32 * 32)) + 2;
}

/**
 * 同一次请求先保时间密度，再在官方像素范围内分配每帧像素。
 * 十集×90秒会保持 10fps，再把每帧像素压到能放进 80 万视觉 token 的档位。
 */
export function resolveNativeDeepReadBatchMaxPixels(input: ReadonlyArray<{
  durationSec: number;
  segments?: readonly NativeDeepReadSegmentSpec[];
}>): number {
  const totalPairs = input.reduce(
    (sum, episode) => sum + resolveSegmentDurations(episode)
      .reduce((inner, duration) => inner + estimatedFramePairs(duration), 0),
    0,
  );
  if (totalPairs <= 0) return NATIVE_DEEP_READ_VIDEO_DEFAULT_MAX_PIXELS;
  const raw = Math.floor(NATIVE_DEEP_READ_BATCH_VISION_TOKEN_BUDGET / totalPairs) * (32 * 32);
  const aligned = Math.floor(raw / (32 * 32)) * (32 * 32);
  return Math.max(
    NATIVE_DEEP_READ_VIDEO_MIN_PIXELS,
    Math.min(NATIVE_DEEP_READ_VIDEO_DEFAULT_MAX_PIXELS, aligned),
  );
}

export function packNativeDeepReadEpisodes<T extends {
  durationSec: number;
  segments?: readonly NativeDeepReadSegmentSpec[];
}>(
  episodes: readonly T[],
): T[][] {
  const packs: T[][] = [];
  let current: T[] = [];
  let currentTokens = 0;
  let currentVideos = 0;
  for (const episode of episodes) {
    const segmentDurations = resolveSegmentDurations(episode);
    const videoCount = segmentDurations.length;
    if (videoCount > NATIVE_DEEP_READ_MAX_VIDEOS_PER_REQUEST) {
      throw new Error("单集视频分片数超过单次多视频输入上限，未发出模型请求");
    }
    const tokens = segmentDurations.reduce(
      (sum, duration) => sum + estimateNativeDeepReadVideoTokens(
        duration,
        NATIVE_DEEP_READ_VIDEO_MIN_PIXELS,
      ),
      0,
    );
    if (tokens > NATIVE_DEEP_READ_BATCH_VISION_TOKEN_BUDGET) {
      throw new Error("单集视频视觉输入预算超过处理上限，未发出模型请求");
    }
    if (
      current.length > 0
      && (currentVideos + videoCount > NATIVE_DEEP_READ_MAX_VIDEOS_PER_REQUEST
        || currentTokens + tokens > NATIVE_DEEP_READ_BATCH_VISION_TOKEN_BUDGET)
    ) {
      packs.push(current);
      current = [];
      currentTokens = 0;
      currentVideos = 0;
    }
    current.push(episode);
    currentTokens += tokens;
    currentVideos += videoCount;
  }
  if (current.length) packs.push(current);
  return packs;
}

export function buildSingaporeNativeDeepReadRequest(
  videoUrl: string,
  lenSec: number,
  hintZh?: string,
  audioEvidence?: ManhuaNativeAudioEvidence,
): Record<string, unknown> {
  const fps = resolveNativeDeepReadInputFps(lenSec);
  return {
    model: NATIVE_DEEP_READ_MODEL,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "video_url",
            video_url: { url: videoUrl },
            fps,
            min_pixels: NATIVE_DEEP_READ_VIDEO_MIN_PIXELS,
            max_pixels: NATIVE_DEEP_READ_VIDEO_DEFAULT_MAX_PIXELS,
          },
          { type: "text", text: buildNativeDeepReadPrompt(lenSec, hintZh, audioEvidence) },
        ],
      },
    ],
    enable_thinking: true,
    max_tokens: 60_000,
    response_format: { type: "json_object" },
  };
}

function buildNativeDeepReadBatchPrompt(
  episodes: ReadonlyArray<{
    episodeIndex: number;
    durationSec: number;
    videos: ReadonlyArray<{ startSec: number; endSec: number }>;
    hintZh?: string;
    audioEvidence?: ManhuaNativeAudioEvidence;
  }>,
): string {
  const manifest = episodes.map((episode) => ({
    episodeIndex: episode.episodeIndex,
    durationSec: episode.durationSec,
    segments: episode.videos.map((video, segmentIndex) => ({
      segmentIndex,
      startSec: video.startSec,
      endSec: video.endSec,
    })),
    hintZh: String(episode.hintZh || "").trim() || undefined,
    audioEvidence: episode.audioEvidence?.hasAudio
      ? episode.audioEvidence.chunks.map((row) => ({
          chunkIndex: row.chunk.index,
          startSec: row.chunk.startSec,
          endSec: row.chunk.endSec,
          mono16k: row.mono16k,
          stereo32k: row.stereo32k,
        }))
      : [],
  }));
  return `你是漫剧成片的导演手法分析师。前面按顺序给了 ${episodes.length} 个独立剧集视频；每个视频前的文字标签都写明唯一 episodeIndex。不得串集、合并集或省略任何一集。

只返回一个 JSON 对象，不要 Markdown：
{"episodes":[{"episodeIndex":整数,"segmentCoverage":[{"segmentIndex":整数,"startSec":整数,"endSec":整数,"evidenceZh":"该分片实际看到的独有画面证据"}],"shots":[{"startSec":整数,"endSec":整数,"shotSizeZh":"景别","angleZh":"机位","cameraMoveZh":"真实运镜","lightingZh":"光影","actionZh":"可拍动作","transitionInZh":"转场"}],"subtitles":[{"atSec":整数,"textZh":"画面真实字幕"}],"audioResolution":[{"chunkIndex":整数,"analysis":{"audioTrack":[{"fromSec":整数,"toSec":整数,"emotionArcZh":"情绪强度变化","toneZh":"怎么说，不写台词","sfxZh":"音效","bgmZh":"配乐","atmosphereZh":"气氛","silenceZh":"留白","cues":[{"atSec":整数,"kind":"sfx/bgm_in/bgm_change/bgm_out/silence_in/silence_out","detailZh":"事件"}]}],"audioBeatStructureZh":"声音节奏","mixNotesZh":"混音","reusableAudioZh":"可复用声音手法","genAudioHintZh":"生成声音要素"}}],"beatStructureZh":"节奏结构","moodArcZh":"情绪推进","classification":{"emotionTagsZh":["情绪标签"],"narrativeFeatureTagsZh":["叙事特色"],"performanceTagsZh":["表演特色"],"audiovisualTagsZh":["视听特色"],"audienceExperienceTagsZh":["观众体验"]},"reusableZh":"可复用手法","genPromptHintZh":"生成画面要素"}]}

硬约束：
1. episodes 必须与清单集号一一对应，数量相同、不得重复、不得新增。
2. 每集 segmentCoverage 必须逐项复写清单的 segmentIndex/startSec/endSec，且 evidenceZh 写该分片实际看到的独有画面；不得只看第一片后声称全片成功。
3. 每集 shots 独立连续覆盖该集 0..durationSec；时间从该集 0 秒重新计算，禁止累计到下一集。
4. 只写真看到的镜头、动作、光影和字幕；字幕看不清写「[不可辨]」，禁止从声音猜字。
5. classification 是基于真证据的多标签，禁用古言/逆袭/系统/甜宠等旧题材桶。
6. audioResolution 仅裁决清单中该集的双路声音证据；不得把另一集的声音移入本集。
7. 两路声音一致就保留；冲突时对照本集真实画面、口型、字幕节奏和可见声源。纯声音冲突中，语气清晰度优先单声道，空间与配乐层次优先立体声；仍无法证明就删除矛盾字段。
8. reusableZh 与 reusableAudioZh 必须脱离来源剧情；分析描述不写平台、剧名、商标或原台词。

剧集清单与双路声音证据：${JSON.stringify(manifest)}`;
}

export function buildSingaporeNativeDeepReadBatchRequest(input: ReadonlyArray<{
  episodeIndex: number;
  videos: ReadonlyArray<{ url: string; startSec: number; endSec: number }>;
  durationSec: number;
  hintZh?: string;
  audioEvidence?: ManhuaNativeAudioEvidence;
}>): Record<string, unknown> {
  if (!input.length) throw new Error("多视频精读请求不能为空");
  if (input.length > NATIVE_DEEP_READ_MAX_VIDEOS_PER_REQUEST) {
    throw new Error(`单次多视频精读最多 ${NATIVE_DEEP_READ_MAX_VIDEOS_PER_REQUEST} 个剧集对象`);
  }
  const videoCount = input.reduce((sum, episode) => sum + episode.videos.length, 0);
  if (videoCount > NATIVE_DEEP_READ_MAX_VIDEOS_PER_REQUEST) {
    throw new Error(`单次多视频精读最多 ${NATIVE_DEEP_READ_MAX_VIDEOS_PER_REQUEST} 个视频分片`);
  }
  const maxPixels = resolveNativeDeepReadBatchMaxPixels(input.map((episode) => ({
    durationSec: episode.durationSec,
    segments: episode.videos,
  })));
  const content: Array<Record<string, unknown>> = [];
  for (const episode of input) {
    for (let segmentIndex = 0; segmentIndex < episode.videos.length; segmentIndex += 1) {
      const video = episode.videos[segmentIndex]!;
      const segmentDurationSec = video.endSec - video.startSec;
      content.push({
        type: "text",
        text: `下一个视频唯一对应 episodeIndex=${episode.episodeIndex}，segmentIndex=${segmentIndex}，全片秒段=${video.startSec}-${video.endSec}。`,
      });
      content.push({
        type: "video_url",
        video_url: { url: video.url },
        fps: resolveNativeDeepReadInputFps(segmentDurationSec),
        min_pixels: NATIVE_DEEP_READ_VIDEO_MIN_PIXELS,
        max_pixels: maxPixels,
      });
    }
  }
  content.push({ type: "text", text: buildNativeDeepReadBatchPrompt(input) });
  return {
    model: NATIVE_DEEP_READ_MODEL,
    messages: [{ role: "user", content }],
    enable_thinking: true,
    max_tokens: 120_000,
    response_format: { type: "json_object" },
  };
}

/**
 * 完整素材是否可直接交给模型，不经过 ffmpeg/GCS。
 *
 * 当前生产只允许不超过单片上限的完整素材直读。文件体积受 H.264/H.265 编码影响，
 * 不能代表模型是否看得完整；长片按时间切段后才创建 ffmpeg/GCS 临时片。
 */
export function shouldReadNativeVideoDirectly(input: {
  sourceDurationSec?: number;
  segments: readonly NativeDeepReadSegmentSpec[];
}): boolean {
  const duration = Number(input.sourceDurationSec);
  if (!Number.isFinite(duration) || duration <= 0 || input.segments.length !== 1) return false;
  const only = input.segments[0]!;
  return only.startSec <= 0.5 && Math.abs(only.endSec - duration) <= 0.5;
}

export function buildNativeDeepReadPrompt(
  lenSec: number,
  hintZh?: string,
  audioEvidence?: ManhuaNativeAudioEvidence,
): string {
  const hint = String(hintZh || "").trim();
  const evidence = audioEvidence?.hasAudio
    ? JSON.stringify(audioEvidence.chunks.map((row) => ({
        chunkIndex: row.chunk.index,
        startSec: row.chunk.startSec,
        endSec: row.chunk.endSec,
        mono16k: row.mono16k,
        stereo32k: row.stereo32k,
      })))
    : "[]";
  return `你是漫剧成片的「导演手法」分析师。这是一个 ${lenSec} 秒的完整剧集${hint ? `（${hint}）` : ""}。系统会按片长自适应采样，请覆盖开头、中段和结尾，不要只分析前段。

**重点是拍法，不是剧情。** 只返回一个 JSON，不要 Markdown 围栏：
{
 "shots":[{"startSec":整数,"endSec":整数,
   "shotSizeZh":"景别：极特写/特写/近景/中景/全景/大远景",
   "angleZh":"机位：平视/仰拍/俯拍/过肩/主观",
   "cameraMoveZh":"运镜：方向与速度，例「1.2秒内从中景推到面部特写」「快速右摇」；看不出运动写「固定机位」",
   "lightingZh":"光影：光位、色调、明暗对比",
   "actionZh":"这一镜的可拍动作",
   "transitionInZh":"进入这一镜的转场：硬切/闪白/黑场/遮挡转场/叠化"}],
 "subtitles":[{"atSec":整数,"textZh":"画面上真实出现的字幕原文，逐字照抄"}],
 "audioResolution":[{"chunkIndex":整数,"analysis":{"audioTrack":[{"fromSec":局部整数秒,"toSec":局部整数秒,"emotionArcZh":"情绪强度变化","toneZh":"怎么说，不写台词","sfxZh":"音效","bgmZh":"配乐","atmosphereZh":"气氛","silenceZh":"留白","cues":[{"atSec":局部整数秒,"kind":"sfx/bgm_in/bgm_change/bgm_out/silence_in/silence_out","detailZh":"事件"}]}],"audioBeatStructureZh":"声音节奏","mixNotesZh":"混音","reusableAudioZh":"可复用声音手法","genAudioHintZh":"生成声音要素"}}],
 "beatStructureZh":"节奏结构：憋了几秒、第几秒爆、爆后怎么收",
 "moodArcZh":"情绪推进：起点→转折秒位→终点",
 "classification":{"emotionTagsZh":["从真证据提取的情绪标签"],"narrativeFeatureTagsZh":["叙事特色"],"performanceTagsZh":["表演特色"],"audiovisualTagsZh":["视听特色"],"audienceExperienceTagsZh":["观众体验"]},
 "reusableZh":"可复用手法（脱离本剧剧情，写成通用做法）",
 "genPromptHintZh":"若用 AI 生成类似片段，画面提示词该写哪几个要素"
}
硬约束：
1. shots 覆盖 0 到 ${lenSec} 秒。
2. cameraMoveZh 只写真看到的运动，禁止套「镜头拉远」这类无依据说法。
3. reusableZh 必须脱离具体剧情。
4. 分析描述不写外部平台剧名、商标或原台词；subtitles 是唯一例外，只用于逐字记录画面证据。
5. subtitles 独立成条，不并入 shots；没有字幕就返回空数组。
6. 字幕看不清写「[不可辨]」，禁止按剧情补全、润色或从声音猜字。
7. classification 是多标签，不使用古言/逆袭/系统/甜宠等题材分类；只写从本片真实证据提炼出的情绪、叙事、表演、视听与观众体验特征，每类可多项。
8. 下方是同一音轨的16k单声道与32k立体声分析。两路一致直接保留；冲突时必须对照你正在看的真实视频、可见动作、口型、字幕节奏和可见声源自动裁决，不输出待人工审核。
9. 画面无法证明的纯声音冲突：语气清晰度可优先单声道，空间/配乐层次可优先立体声；仍无证据就删除矛盾字段，只保留共同部分，禁止猜。
10. 双路证据非空时，audioResolution 必须逐分片返回，chunkIndex 不得缺失；analysis 使用该分片局部0秒，连续无重叠覆盖整段，描述字段不得另写 MM:SS。双路证据为空时必须返回空数组，禁止凭视频猜音轨。

双路声音证据：${evidence}`;
}

/** 按体积挑 format：同为 720p，h264 是 477MB 而 bytevc1 只有 225MB —— 不能按 height 排 */
export function pickSmallestVideoFormat(
  formats: ReadonlyArray<Record<string, unknown>>,
): { url: string; sizeMB: number } | null {
  const candidates = formats
    .filter((f) => String(f.format_id || "").startsWith("bytevc1_540p"))
    .map((f) => ({
      url: String(f.url || ""),
      size: Number(f.filesize || f.filesize_approx || 0),
    }))
    .filter((f) => f.url)
    .sort((a, b) => (a.size || 9e15) - (b.size || 9e15));
  const best = candidates[0];
  return best ? { url: best.url, sizeMB: best.size / 1048576 } : null;
}

/**
 * 解析该集的 CDN 节点副本：**只拿地址，不下载** —— 模型自己去 CDN 拉流。
 *
 * 原先这段只存在于 `scripts/manhua-native-deep-read-batch.mts`。接进生产链时
 * 若在 service 里再写一遍，「挑 format 按体积不按 height」这个口径就有了两处实现，
 * 改一处漏一处就是不报错的暗雷（判据收口与探针纪律）。所以抽到这里，脚本改引用。
 *
 * `abortSignal` 必须直通：否则用户中止时会卡在 yt-dlp 解析上等它自己结束。
 */
export async function resolveNativeDeepReadNodeUrls(
  sourceUrl: string,
  abortSignal?: AbortSignal,
): Promise<NativeDeepReadMediaNode[]> {
  const url = String(sourceUrl || "").trim();
  if (!url) throw new Error("缺少可解析的剧集地址");
  const cookie = String(process.env.DOUYIN_COOKIE || "").trim();
  const stdout = await run(
    "yt-dlp",
    ["-J", "--no-warnings", ...(cookie ? ["--add-header", `Cookie:${cookie}`] : []), url],
    120_000,
    abortSignal,
  );
  const info = JSON.parse(stdout) as { formats?: Array<Record<string, unknown>> };
  const best = pickSmallestVideoFormat(info.formats || []);
  if (!best) throw new Error("未解析到可用的 540p 档");
  return [{ url: best.url }];
}

const NATIVE_VIDEO_TEMP_PREFIX = "manhua-template-learn/tmp/native-deep-read";
const NATIVE_VIDEO_SEGMENT_MAX_BYTES = 90 * 1024 * 1024;
export const NATIVE_DEEP_READ_BATCH_REQUEST_TOTAL_TIMEOUT_MS = 60 * 60_000;

function mediaHeaders(node: NativeDeepReadMediaNode): string[] {
  const referer = String(node.referer || "").trim();
  return [
    "-user_agent",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    ...(referer ? ["-headers", `Referer: ${referer}\r\n`] : []),
  ];
}

/** 长片切段仅做容器复制，不重编码；-ss 放在 -i 前，避免先下载整集。 */
export function buildNativeDeepReadVideoSegmentArgs(input: {
  node: NativeDeepReadMediaNode;
  startSec: number;
  durationSec: number;
  outputPath: string;
}): string[] {
  return [
    "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
    ...mediaHeaders(input.node),
    "-ss", String(input.startSec), "-i", input.node.url,
    "-t", String(input.durationSec), "-map", "0:v:0", "-map", "0:a?",
    "-c", "copy", "-avoid_negative_ts", "make_zero", input.outputPath,
  ];
}

/** 兼容既有调用者；实现统一委托给新的长片分段参数构造器。 */
export function buildCutSegmentArgs(
  node: NativeDeepReadMediaNode,
  startSec: number,
  lenSec: number,
  localPath: string,
): string[] {
  return buildNativeDeepReadVideoSegmentArgs({
    node,
    startSec,
    durationSec: lenSec,
    outputPath: localPath,
  });
}

export type PreparedNativeVideo = {
  url: string;
  startSec: number;
  endSec: number;
  temporaryGcs?: { bucket: string; objectName: string };
  /** 直读 CDN 只在模型请求发出前最后一刻解析，避免准备长片时把短效地址放过期。 */
  refreshDirectUrl?: () => Promise<string>;
};

export type NativeDeepReadMediaPreparationDeps = {
  runMedia: (
    cmd: string,
    args: string[],
    timeoutMs?: number,
    abortSignal?: AbortSignal,
  ) => Promise<string>;
  statLocal: (path: string) => Promise<{ size: number }>;
  readLocal: (path: string) => Promise<Buffer>;
  unlinkLocal: (path: string) => Promise<void>;
  upload: typeof uploadBufferToGcs;
  remove: typeof deleteGcsObject;
  signReadUrl: typeof signGsUriV4ReadUrl;
};

const defaultMediaPreparationDeps: NativeDeepReadMediaPreparationDeps = {
  runMedia: run,
  statLocal: async (path) => stat(path),
  readLocal: async (path) => readFile(path),
  unlinkLocal: unlink,
  upload: uploadBufferToGcs,
  remove: deleteGcsObject,
  signReadUrl: signGsUriV4ReadUrl,
};

export async function prepareEpisodeVideos(
  episode: NativeDeepReadBatchRunEpisode,
  abortSignal?: AbortSignal,
  deps: NativeDeepReadMediaPreparationDeps = defaultMediaPreparationDeps,
): Promise<PreparedNativeVideo[]> {
  const segments = validateNativeDeepReadSegments(episode.segments);
  const direct = shouldReadNativeVideoDirectly({
    sourceDurationSec: episode.sourceDurationSec,
    segments,
  });
  if (direct) {
    return [{
      url: "",
      startSec: 0,
      endSec: episode.sourceDurationSec,
      refreshDirectUrl: async () => {
        const node = (await episode.resolveNodes())[0];
        if (!node?.url) throw new Error(`第${episode.episodeIndex}集未解析到可用媒体节点`);
        return node.url;
      },
    }];
  }

  const prepared: PreparedNativeVideo[] = [];
  try {
    for (let index = 0; index < segments.length; index += 1) {
      abortSignal?.throwIfAborted();
      const segment = segments[index]!;
      let lastError: unknown;
      let completed = false;
      for (let attempt = 0; attempt < 3 && !completed; attempt += 1) {
        abortSignal?.throwIfAborted();
        const nodes = await episode.resolveNodes();
        const node = nodes[attempt % Math.max(1, nodes.length)];
        if (!node?.url) throw new Error(`第${episode.episodeIndex}集第${index + 1}段未解析到媒体节点`);
        const runId = crypto.randomUUID();
        const localPath = `/tmp/manhua-native-video-${runId}.mp4`;
        try {
          await deps.runMedia(
            "ffmpeg",
            buildNativeDeepReadVideoSegmentArgs({
              node,
              startSec: segment.startSec,
              durationSec: segment.endSec - segment.startSec,
              outputPath: localPath,
            }),
            20 * 60_000,
            abortSignal,
          );
          const fileStat = await deps.statLocal(localPath);
          if (fileStat.size < 100_000 || fileStat.size > NATIVE_VIDEO_SEGMENT_MAX_BYTES) {
            throw new Error(`第${episode.episodeIndex}集第${index + 1}段大小不在处理范围`);
          }
          const uploaded = await deps.upload({
            objectName: `${NATIVE_VIDEO_TEMP_PREFIX}/${runId}.mp4`,
            buffer: await deps.readLocal(localPath),
            contentType: "video/mp4",
            signal: abortSignal,
          });
          prepared.push({
            url: deps.signReadUrl(uploaded.gcsUri, 2 * 60 * 60),
            startSec: segment.startSec,
            endSec: segment.endSec,
            temporaryGcs: { bucket: uploaded.bucket, objectName: uploaded.objectName },
          });
          completed = true;
        } catch (error) {
          lastError = error;
          if (abortSignal?.aborted) throw error;
          if (attempt < 2) {
            console.warn(`[nativeDeepRead] 第${episode.episodeIndex}集第${index + 1}段媒体准备失败，刷新节点后重试`);
          }
        } finally {
          await deps.unlinkLocal(localPath).catch(() => undefined);
        }
      }
      if (!completed) throw lastError instanceof Error ? lastError : new Error("视频分片准备失败");
    }
    return prepared;
  } catch (error) {
    await Promise.allSettled(prepared.flatMap((row) => row.temporaryGcs
      ? [deps.remove(row.temporaryGcs)]
      : []));
    throw error;
  }
}

function parseJsonObject(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    }
  }
  throw new Error("多视频精读没有返回可解析的 JSON 对象");
}

function allocateIntegerTotal(total: number, weights: readonly number[]): number[] {
  const safeTotal = Math.max(0, Math.floor(Number(total) || 0));
  const safeWeights = weights.map((weight) => Math.max(0, Number(weight) || 0));
  const denominator = safeWeights.reduce((sum, weight) => sum + weight, 0) || safeWeights.length || 1;
  const exact = safeWeights.map((weight) => safeTotal * (weight || 1) / denominator);
  const allocated = exact.map(Math.floor);
  let remaining = safeTotal - allocated.reduce((sum, value) => sum + value, 0);
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let index = 0; remaining > 0 && order.length; index += 1, remaining -= 1) {
    allocated[order[index % order.length]!.index]! += 1;
  }
  return allocated;
}

export function assertNativeDeepReadEpisodeEvidence(input: {
  episodeIndex: number;
  durationSec: number;
  segments: readonly NativeDeepReadSegmentSpec[];
  raw: Record<string, unknown>;
}): void {
  const coverage = Array.isArray(input.raw.segmentCoverage)
    ? input.raw.segmentCoverage as Array<Record<string, unknown>>
    : [];
  const expected = input.segments.map((segment, segmentIndex) => ({ segmentIndex, ...segment }));
  if (coverage.length !== expected.length) {
    throw new Error(`第${input.episodeIndex}集分片证据数量不完整，整包拒绝入库`);
  }
  const seen = new Set<number>();
  const seenEvidence = new Set<string>();
  for (const row of coverage) {
    const segmentIndex = typeof row.segmentIndex === "number" ? row.segmentIndex : Number.NaN;
    const startSec = typeof row.startSec === "number" ? row.startSec : Number.NaN;
    const endSec = typeof row.endSec === "number" ? row.endSec : Number.NaN;
    const evidenceZh = String(row.evidenceZh || "").trim();
    const expectedRow = expected[segmentIndex];
    if (
      !Number.isInteger(segmentIndex)
      || !Number.isFinite(startSec)
      || !Number.isFinite(endSec)
      || !expectedRow
      || seen.has(segmentIndex)
      || Math.abs(startSec - expectedRow.startSec) > 0.5
      || Math.abs(endSec - expectedRow.endSec) > 0.5
      || !evidenceZh
      || seenEvidence.has(evidenceZh)
    ) {
      throw new Error(`第${input.episodeIndex}集分片证据身份或秒位不一致，整包拒绝入库`);
    }
    seen.add(segmentIndex);
    seenEvidence.add(evidenceZh);
  }
  const shots = (Array.isArray(input.raw.shots) ? input.raw.shots : [])
    .map((row) => row as Record<string, unknown>)
    .map((row) => ({ startSec: Number(row.startSec), endSec: Number(row.endSec) }))
    .filter((row) => Number.isFinite(row.startSec) && Number.isFinite(row.endSec) && row.endSec > row.startSec)
    .sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);
  if (!shots.length || Math.abs(shots[0]!.startSec) > 0.5) {
    throw new Error(`第${input.episodeIndex}集镜头未从 0 秒开始，整包拒绝入库`);
  }
  let cursor = 0;
  for (const shot of shots) {
    if (shot.startSec > cursor + 0.5 || shot.startSec < cursor - 0.5) {
      throw new Error(`第${input.episodeIndex}集镜头时间轴存在空档或重叠，整包拒绝入库`);
    }
    cursor = shot.endSec;
  }
  if (Math.abs(cursor - input.durationSec) > 0.5) {
    throw new Error(`第${input.episodeIndex}集镜头未覆盖完整片长，整包拒绝入库`);
  }
}

export type NativeDeepReadBatchRunnerDeps = {
  prepareVideos: typeof prepareEpisodeVideos;
  post: typeof postLong;
  remove: typeof deleteGcsObject;
};

const defaultBatchRunnerDeps: NativeDeepReadBatchRunnerDeps = {
  prepareVideos: prepareEpisodeVideos,
  post: postLong,
  remove: deleteGcsObject,
};

/**
 * 一次请求读取多集（以及长集的多个分片），回传后按 episodeIndex 严格拆开。
 * 任一集号缺失、重复或多出都整包拒绝，避免把 A 集结构写进 B 集卡。
 */
export async function runManhuaNativeDeepReadBatch(params: {
  episodes: readonly NativeDeepReadBatchRunEpisode[];
  apiKey?: string;
  endpoint?: string;
  abortSignal?: AbortSignal;
  onModelReceipt?: (receipt: NativeDeepReadVisualModelReceipt) => void | Promise<void>;
}, deps: NativeDeepReadBatchRunnerDeps = defaultBatchRunnerDeps): Promise<NativeDeepReadBatchRunResult> {
  if (!params.episodes.length) throw new Error("多视频精读批次为空");
  const creds = resolveNativeDeepReadExecutionCredentials({
    apiKey: params.apiKey,
    endpoint: params.endpoint,
  });
  const seen = new Set<number>();
  const validated = params.episodes.map((episode) => {
    if (!Number.isInteger(episode.episodeIndex) || episode.episodeIndex < 1) {
      throw new Error("多视频精读 episodeIndex 无效");
    }
    if (seen.has(episode.episodeIndex)) throw new Error(`多视频精读重复第${episode.episodeIndex}集`);
    seen.add(episode.episodeIndex);
    const segments = validateNativeDeepReadSegments(episode.segments);
    const first = segments[0]!;
    const last = segments[segments.length - 1]!;
    if (first.startSec > 0.5 || Math.abs(last.endSec - episode.sourceDurationSec) > 0.5) {
      throw new Error(`第${episode.episodeIndex}集分片未覆盖完整片长`);
    }
    for (let index = 1; index < segments.length; index += 1) {
      if (Math.abs(segments[index]!.startSec - segments[index - 1]!.endSec) > 0.01) {
        throw new Error(`第${episode.episodeIndex}集分片存在空档或重叠`);
      }
    }
    return { ...episode, segments };
  });
  const videoCount = validated.reduce((sum, episode) => sum + episode.segments.length, 0);
  if (videoCount > NATIVE_DEEP_READ_MAX_VIDEOS_PER_REQUEST) {
    throw new Error(`本次 ${videoCount} 个视频分片超过单次上限，必须先拆包`);
  }

  const prepared: Array<{
    episode: (typeof validated)[number];
    videos: PreparedNativeVideo[];
  }> = [];
  let inputTokens = 0;
  let outputTokens = 0;
  const batchRequestId = crypto.randomUUID();
  let visualRequestStartedAt = 0;
  let visualRequestStarted = false;
  let visualModelCompleted = false;
  try {
    for (const episode of validated) {
      prepared.push({
        episode,
        videos: await deps.prepareVideos(episode, params.abortSignal),
      });
    }
    // 必须在所有慢速 ffmpeg/GCS 准备完成后才解析直读 CDN；模型请求紧接着发出。
    await Promise.all(prepared.flatMap(({ videos }) => videos.flatMap((video) =>
      video.refreshDirectUrl
        ? [video.refreshDirectUrl().then((url) => { video.url = url; })]
        : [],
    )));
    params.abortSignal?.throwIfAborted();
    visualRequestStarted = true;
    visualRequestStartedAt = Date.now();
    await emitVisualModelReceipt({
      stage: "visual_model",
      status: "started",
      batchRequestId,
      episodeIndexes: validated.map((episode) => episode.episodeIndex),
      videoCount,
    }, params.onModelReceipt);
    const response = await deps.post(
      buildSingaporeNativeDeepReadBatchRequest(prepared.map(({ episode, videos }) => ({
        episodeIndex: episode.episodeIndex,
        videos,
        durationSec: episode.sourceDurationSec,
        hintZh: episode.hintZh,
        audioEvidence: episode.audioEvidence,
      }))),
      creds.apiKey,
      creds.endpoint,
      NATIVE_DEEP_READ_BATCH_REQUEST_TOTAL_TIMEOUT_MS,
      params.abortSignal,
    );
    if (response.status >= 300) throw new Error(`native_deep_read_batch_http_${response.status}`);
    const envelope = JSON.parse(response.text) as {
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      choices?: Array<{ finish_reason?: string; message?: { content?: unknown } }>;
    };
    inputTokens = Math.max(0, Number(envelope.usage?.prompt_tokens) || 0);
    outputTokens = Math.max(0, Number(envelope.usage?.completion_tokens) || 0);
    const choice = envelope.choices?.[0];
    if (choice?.finish_reason === "length") throw new Error("多视频精读输出被截断");
    if (choice?.finish_reason !== "stop") {
      throw new Error(`多视频精读未正常结束（${choice?.finish_reason || "unknown"}）`);
    }
    await emitVisualModelReceipt({
      stage: "visual_model",
      status: "completed",
      batchRequestId,
      episodeIndexes: validated.map((episode) => episode.episodeIndex),
      videoCount,
      elapsedMs: Date.now() - visualRequestStartedAt,
      inputTokens,
      outputTokens,
      finishReason: choice.finish_reason,
    }, params.onModelReceipt);
    visualModelCompleted = true;
    const content = choice.message?.content;
    const responseText = Array.isArray(content)
      ? content.map((part) => String((part as { text?: unknown }).text || "")).join("")
      : String(content || "");
    const parsed = parseJsonObject(responseText);
    const rows = Array.isArray(parsed.episodes)
      ? parsed.episodes as Array<Record<string, unknown>>
      : [];
    const receivedIndexes = rows.map((row) => Number(row.episodeIndex));
    if (
      rows.length !== validated.length
      || new Set(receivedIndexes).size !== receivedIndexes.length
      || receivedIndexes.some((episodeIndex) => !seen.has(episodeIndex))
      || validated.some((episode) => !receivedIndexes.includes(episode.episodeIndex))
    ) {
      throw new Error("多视频精读回传集号不完整或不一致，整包拒绝入库");
    }

    const inputAllocations = allocateIntegerTotal(
      inputTokens,
      validated.map((episode) => episode.segments.reduce(
        (sum, segment) => sum + estimateNativeDeepReadVideoTokens(segment.endSec - segment.startSec),
        0,
      )),
    );
    const outputAllocations = allocateIntegerTotal(
      outputTokens,
      validated.map((episode) => JSON.stringify(rows.find((row) => Number(row.episodeIndex) === episode.episodeIndex)).length),
    );
    const episodes = validated.map((episode, index) => {
      const raw = rows.find((row) => Number(row.episodeIndex) === episode.episodeIndex)!;
      assertNativeDeepReadEpisodeEvidence({
        episodeIndex: episode.episodeIndex,
        durationSec: episode.sourceDurationSec,
        segments: episode.segments,
        raw,
      });
      const { episodeIndex: _drop, ...episodePayload } = raw;
      const mapped = mapNativeDeepReadSegments([{
        startSec: 0,
        endSec: episode.sourceDurationSec,
        finish: "stop",
        text: JSON.stringify(episodePayload),
      }]);
      if (mapped.segmentCount !== 1) {
        throw new Error(`第${episode.episodeIndex}集结构解析失败，整包拒绝入库`);
      }
      const allocatedInput = inputAllocations[index] || 0;
      const allocatedOutput = outputAllocations[index] || 0;
      return {
        episodeIndex: episode.episodeIndex,
        result: {
          ...mapped,
          segmentCount: episode.segments.length,
          failedSegmentCount: 0,
          attemptedSegments: episode.segments.length,
          model: NATIVE_DEEP_READ_MODEL,
          usingPlanQuota: creds.usingPlan,
          batchRequestId,
          batchEpisodeCount: validated.length,
          usage: {
            inputTokens: allocatedInput,
            outputTokens: allocatedOutput,
            costCny:
              (allocatedInput * PRICE_IN_PER_M) / 1e6
              + (allocatedOutput * PRICE_OUT_PER_M) / 1e6,
          },
        },
      };
    });
    return {
      episodes,
      usage: {
        inputTokens,
        outputTokens,
        costCny: (inputTokens * PRICE_IN_PER_M) / 1e6 + (outputTokens * PRICE_OUT_PER_M) / 1e6,
      },
      usingPlanQuota: creds.usingPlan,
      model: NATIVE_DEEP_READ_MODEL,
      batchRequestId,
    };
  } catch (error) {
    if (visualRequestStarted) {
      await emitVisualModelReceipt({
        stage: visualModelCompleted ? "visual_parse" : "visual_model",
        status: "failed",
        batchRequestId,
        episodeIndexes: validated.map((episode) => episode.episodeIndex),
        videoCount,
        elapsedMs: Date.now() - visualRequestStartedAt,
        inputTokens,
        outputTokens,
        errorZh: (error instanceof Error ? error.message : String(error)).slice(0, 160),
      }, params.onModelReceipt);
    }
    const wrapped = (error instanceof Error ? error : new Error(String(error))) as NativeDeepReadRunError;
    wrapped.nativeDeepReadCostCny =
      (inputTokens * PRICE_IN_PER_M) / 1e6 + (outputTokens * PRICE_OUT_PER_M) / 1e6;
    wrapped.nativeDeepReadUsage = {
      inputTokens,
      outputTokens,
      costCny: wrapped.nativeDeepReadCostCny,
      usingPlanQuota: creds.usingPlan,
      receiptComplete: inputTokens > 0 || outputTokens > 0,
    };
    throw wrapped;
  } finally {
    const cleanup = prepared.flatMap((row) => row.videos.flatMap((video) =>
      video.temporaryGcs ? [deps.remove(video.temporaryGcs)] : [],
    ));
    const cleanupResults = await Promise.allSettled(cleanup);
    if (cleanupResults.some((row) => row.status === "rejected")) {
      console.warn(`[nativeDeepRead] 批次 ${batchRequestId} 的视频临时对象清理待核对`);
    }
  }
}

/** 整集直读：不切视频、不落 OSS/GCS，也不在 Fly 留视频临时文件。 */
async function runOneSegment(params: {
  nodes: NativeDeepReadMediaNode[];
  spec: NativeDeepReadSegmentSpec;
  apiKey: string;
  endpoint: string;
  audioEvidence?: ManhuaNativeAudioEvidence;
  abortSignal?: AbortSignal;
}): Promise<{ row: Record<string, unknown> | null; usage: { inputTokens: number; outputTokens: number } }> {
  const { spec } = params;
  const lenSec = Math.max(1, Math.round(spec.endSec - spec.startSec));
  const videoUrl = String(params.nodes[0]?.url || "").trim();
  if (!videoUrl) throw new Error("未解析到可用媒体节点");
  if (params.abortSignal?.aborted) throw abortReason(params.abortSignal);
  const res = await postLong(
    buildSingaporeNativeDeepReadRequest(videoUrl, lenSec, spec.hintZh, params.audioEvidence),
    params.apiKey,
    params.endpoint,
    NATIVE_DEEP_READ_REQUEST_TOTAL_TIMEOUT_MS,
    params.abortSignal,
  );
  if (res.status >= 300) throw new Error(`native_deep_read_http_${res.status}`);
  const json = JSON.parse(res.text) as {
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    choices?: Array<{ finish_reason?: string; message?: { content?: unknown } }>;
  };
  const choice = json.choices?.[0];
  const content = choice?.message?.content;
  const text = Array.isArray(content)
    ? content.map((x) => String((x as { text?: unknown }).text || "")).join("")
    : String(content || "");
  return {
    row: { startSec: spec.startSec, endSec: spec.endSec, finish: choice?.finish_reason, text },
    usage: {
      inputTokens: Number(json.usage?.prompt_tokens) || 0,
      outputTokens: Number(json.usage?.completion_tokens) || 0,
    },
  };
}

/**
 * 段规格前置校验：**在 resolveNodes 与任何网络动作之前**。
 *
 * 秒位反了、NaN、重复段，走到 ffmpeg 才炸就已经解析过地址、可能已经切过片；
 * 重复段更糟——同一段跑两遍，钱花两次、卡里镜头还重复。
 */
export function validateNativeDeepReadSegments(
  segments: readonly NativeDeepReadSegmentSpec[],
): NativeDeepReadSegmentSpec[] {
  if (!segments.length) throw new Error("原生精读没有可执行片段");
  if (segments.length > 32) throw new Error("原生精读单次最多处理32段");

  const seen = new Set<string>();
  return segments.map((segment, index) => {
    const startSec = Number(segment.startSec);
    const endSec = Number(segment.endSec);
    if (
      !Number.isFinite(startSec)
      || !Number.isFinite(endSec)
      || startSec < 0
      || endSec <= startSec
    ) {
      throw new Error(`原生精读第${index + 1}段秒位无效`);
    }
    const key = `${startSec}:${endSec}`;
    if (seen.has(key)) throw new Error(`原生精读存在重复片段：${key}`);
    seen.add(key);
    return { ...segment, startSec, endSec };
  });
}

/**
 * 对若干爆点段做精读，返回可直接写进模板卡的 beatGrid 与两栏。
 *
 * ⚠️ 调用方必须检查 failedSegmentCount / droppedCount / truncated ——
 * 静默少几个镜头比整体失败更难发现。
 */
export async function runManhuaNativeDeepRead(params: {
  resolveNodes: () => Promise<NativeDeepReadMediaNode[]>;
  segments: readonly NativeDeepReadSegmentSpec[];
  /** 完整素材时长；用于证明唯一片段覆盖全片后安全直读 CDN */
  sourceDurationSec?: number;
  /** 双路 Gemini 中间证据；由这次视频请求对照画面自动裁决，不另发 Qwen 请求。 */
  audioEvidence?: ManhuaNativeAudioEvidence;
  /** 缺省只走新加坡 Token Plan；不自动回落按量 */
  apiKey?: string;
  endpoint?: string;
  abortSignal?: AbortSignal;
}): Promise<NativeDeepReadRunResult> {
  const validatedSegments = validateNativeDeepReadSegments(params.segments);
  if (!shouldReadNativeVideoDirectly({
    sourceDurationSec: params.sourceDurationSec,
    segments: validatedSegments,
  })) {
    throw new Error("原生精读只接受覆盖整集的单段计划，未发出模型请求");
  }
  const creds = resolveNativeDeepReadExecutionCredentials({
    apiKey: params.apiKey,
    endpoint: params.endpoint,
  });
  const apiKey = creds.apiKey;
  const endpoint = creds.endpoint;
  const nodes = await params.resolveNodes();

  const rows: Array<Record<string, unknown>> = [];
  let inputTokens = 0;
  let outputTokens = 0;
  try {
    for (const spec of validatedSegments) {
      if (params.abortSignal?.aborted) throw new Error("已取消");
      try {
        const { row, usage } = await runOneSegment({
          nodes,
          spec,
          apiKey,
          endpoint,
          audioEvidence: params.audioEvidence,
          abortSignal: params.abortSignal,
        });
        inputTokens += usage.inputTokens;
        outputTokens += usage.outputTokens;
        if (row) rows.push(row);
      } catch (error) {
        // 原先没有 catch：前 3 段付费成功、第 4 段 HTTP/JSON 失败，
        // 整体 reject，前 3 段的钱连同产出一起丢，也进不了逐集入库。
        // 改为停止后续段但把已完成的带回去，由入库门禁决定收不收。
        if (params.abortSignal?.aborted) throw error;
        console.warn(
          `[nativeDeepRead] 第 ${spec.startSec}-${spec.endSec}s 段未完成，停止后续段并保留已完成结果：${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        break;
      }
    }
  } catch (error) {
    if (!params.abortSignal?.aborted) throw error;
    const stopped = (error instanceof Error ? error : new Error(String(error))) as NativeDeepReadRunError;
    stopped.nativeDeepReadCostCny =
      (inputTokens * PRICE_IN_PER_M) / 1e6 + (outputTokens * PRICE_OUT_PER_M) / 1e6;
    stopped.nativeDeepReadUsage = {
      inputTokens,
      outputTokens,
      costCny: stopped.nativeDeepReadCostCny,
      usingPlanQuota: creds.usingPlan,
      // 中止时在途请求可能还没有 usage，不能把已知部分冒充完整账单。
      receiptComplete: false,
    };
    throw stopped;
  }

  const mapped = mapNativeDeepReadSegments(rows);
  return {
    ...mapped,
    // rows 里已剔除切片失败的段，这里补回真实失败数
    failedSegmentCount: validatedSegments.length - mapped.segmentCount,
    attemptedSegments: validatedSegments.length,
    model: NATIVE_DEEP_READ_MODEL,
    usingPlanQuota: creds.usingPlan,
    usage: {
      inputTokens,
      outputTokens,
      costCny:
        (inputTokens * PRICE_IN_PER_M) / 1e6 + (outputTokens * PRICE_OUT_PER_M) / 1e6,
    },
  };
}

export type { NativeDeepReadOutput };
