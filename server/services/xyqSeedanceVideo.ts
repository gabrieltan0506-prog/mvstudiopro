/**
 * 小云雀（XYQ）Seedance 2.5 · 内部联调（A3）。
 * 密钥只放 Fly secrets：`XYQ_ACCESS_KEY` + `SEEDANCE_25_ENABLED=1`（不要写本机 .env）。
 * 对齐 CLI：generate-video → submit_run + get_thread 轮询 → 镜像 GCS
 */

import {
  XYQ_REFERENCE_MAX,
  XYQ_SEEDANCE_25_MODEL,
  XYQ_VIDEO_PART_AGENT,
  clampXyqSeedanceDuration,
  normalizeXyqSeedanceRatio,
  normalizeXyqSeedanceResolution,
  normalizeXyqUpscaleResolution,
  normalizeXyqUpscaleToolVersion,
  type XyqUpscaleResolution,
  type XyqUpscaleToolVersion,
} from "../../shared/xyqSeedanceModels.js";
import {
  parseXyqSeedance25WorkMode,
  xyqRemixHasSource,
  xyqWorkModeIsMiniTool,
  xyqWorkModeIsNest,
  xyqWorkModeNeedsVideo,
  type XyqSeedance25WorkMode,
} from "../../shared/xyqSeedancePrompt.js";
import { isSeedance25Enabled } from "./evolinkSeedanceVideo.js";
import { mirrorSeedanceMp4ToGcsSignedUrl } from "./seedanceVideo.js";

export type { XyqSeedance25WorkMode };

const XYQ_BASE = String(process.env.XYQ_OPENAPI_BASE || process.env.XYQ_BASE_URL || "https://xyq.jianying.com").replace(
  /\/$/,
  "",
);

const POLL_INTERVAL_MS = Math.min(
  Math.max(Number(process.env.XYQ_SEEDANCE_POLL_INTERVAL_MS) || 10_000, 5_000),
  30_000,
);
const MAX_POLL_MS = Math.min(
  Math.max(Number(process.env.XYQ_SEEDANCE_POLL_TIMEOUT_MS) || 900_000, 120_000),
  1_200_000,
);

const RUN_STATE_SUCCESS = 3;
const RUN_STATE_FAILED = 4;

export function getXyqAccessKey(): string {
  return String(process.env.XYQ_ACCESS_KEY || "").trim();
}

export function isXyqSeedanceConfigured(): boolean {
  return Boolean(getXyqAccessKey());
}

/** A3：产品闸门未开时，仅内部 env 可走小云雀 2.5 */
export function isXyqSeedance25Ready(): boolean {
  return isSeedance25Enabled() && isXyqSeedanceConfigured();
}

type XyqEnvelope<T> = {
  ret?: string;
  errmsg?: string;
  log_id?: string;
  data?: T;
};

/**
 * 模型直出（官方 generate-video）：agent = pippit_video_part_agent。
 * 首尾帧：generate_type=1 + 两图按首/尾顺序。
 * 续写：须带 videos[] 参考成片（CLI --video）。
 */
export function buildXyqGenerateVideoBody(input: {
  prompt: string;
  imageAssetIds?: string[];
  videoAssetIds?: string[];
  audioAssetIds?: string[];
  durationSec?: number;
  ratio?: string;
  resolution?: string;
  generateType?: number;
  model?: string;
  /** 续写时禁止自动猜首尾帧 */
  workMode?: XyqSeedance25WorkMode;
}): Record<string, unknown> {
  const prompt = String(input.prompt || "").trim();
  const images = (input.imageAssetIds || []).slice(0, XYQ_REFERENCE_MAX.image).map((id) => ({
    pippit_asset_id: id,
  }));
  const videos = (input.videoAssetIds || []).slice(0, XYQ_REFERENCE_MAX.video).map((id) => ({
    pippit_asset_id: id,
  }));
  const audios = (input.audioAssetIds || []).slice(0, XYQ_REFERENCE_MAX.audio).map((id) => ({
    pippit_asset_id: id,
  }));

  let generateType = input.generateType;
  const mode = input.workMode || "generate";
  if (
    mode === "generate" &&
    generateType == null &&
    images.length === 2 &&
    videos.length === 0 &&
    audios.length === 0
  ) {
    generateType = 1; // 首尾帧（官方 CLI --generate-type 1）
  }
  if (mode !== "generate") {
    // 非新生成不得误套首尾帧
    if (generateType === 1) generateType = undefined;
  }

  const param: Record<string, unknown> = {
    prompt,
    model: String(input.model || XYQ_SEEDANCE_25_MODEL).trim() || XYQ_SEEDANCE_25_MODEL,
  };
  if (images.length) param.images = images;
  if (videos.length) param.videos = videos;
  if (audios.length) param.audios = audios;
  if (typeof input.durationSec === "number") param.duration_sec = input.durationSec;
  if (input.ratio) param.ratio = input.ratio;
  if (input.resolution) param.resolution = input.resolution;
  if (typeof generateType === "number") param.generate_type = generateType;

  return {
    agent_name: XYQ_VIDEO_PART_AGENT,
    message: prompt,
    video_part_tool_param: param,
  };
}

/**
 * Nest 会话编辑（官方 submit_run.py）：message + asset_ids，不带 video_part_tool_param。
 * 用于局部重拍 / 视频复刻（skill 场景），由平台 Agent 编排，非提示词空壳。
 */
export function buildXyqNestEditBody(input: {
  message: string;
  assetIds: string[];
  threadId?: string;
  /** 复刻外链模式：允许无 asset_ids，但 message 须含 https 链 */
  allowLinkOnly?: boolean;
}): Record<string, unknown> {
  const message = String(input.message || "").trim();
  const assetIds = (input.assetIds || []).map((id) => String(id || "").trim()).filter(Boolean);
  if (!message) throw new Error("请填写编辑说明");
  if (!assetIds.length) {
    if (!(input.allowLinkOnly && /https?:\/\//i.test(message))) {
      throw new Error("该模式需要先上传参考视频或素材");
    }
  }
  const body: Record<string, unknown> = {
    message,
  };
  if (assetIds.length) body.asset_ids = assetIds;
  const threadId = String(input.threadId || "").trim();
  if (threadId) body.thread_id = threadId;
  return body;
}

/**
 * 官方 video-super-resolution：mini_tool_param.video_super_resolution_tool_param
 * （asset 不进顶层 asset_ids / videos[]）
 */
export function buildXyqSuperResolutionBody(input: {
  videoAssetId: string;
  outputResolution?: string;
  toolVersion?: string;
}): Record<string, unknown> {
  const videoId = String(input.videoAssetId || "").trim();
  if (!videoId) throw new Error("提升清晰度需要参考视频");
  const outputResolution = normalizeXyqUpscaleResolution(input.outputResolution);
  const toolVersion = normalizeXyqUpscaleToolVersion(input.toolVersion);
  return {
    agent_name: XYQ_VIDEO_PART_AGENT,
    message: "提升视频清晰度",
    video_part_tool_param: {
      mini_tool_param: {
        tool_name: "video_super_resolution",
        tool_param: {
          video_super_resolution_tool_param: {
            tool_version: toolVersion,
            video: { pippit_asset_id: videoId },
            output_resolution: outputResolution,
          },
        },
      },
    },
  };
}

/**
 * 官方 erase-video-subtitle：mini_tool_param.erase_video_subtitle_tool_param
 */
export function buildXyqEraseSubtitleBody(input: { videoAssetId: string }): Record<string, unknown> {
  const videoId = String(input.videoAssetId || "").trim();
  if (!videoId) throw new Error("擦除字幕需要参考视频");
  return {
    agent_name: XYQ_VIDEO_PART_AGENT,
    message: "擦除视频字幕",
    video_part_tool_param: {
      mini_tool_param: {
        tool_name: "erase_video_subtitle",
        tool_param: {
          erase_video_subtitle_tool_param: {
            video: { pippit_asset_id: videoId },
          },
        },
      },
    },
  };
}

function userFacingXyqError(raw: string): string {
  const m = String(raw || "").trim();
  if (!m) return "视频生成失败，请稍后重试";
  if (/access.?key|unauthorized|401|403|鉴权|invalid.*key|未登录/i.test(m)) {
    return "视频服务暂不可用，请稍后重试";
  }
  if (/vip|会员|专属|permission|无权限/i.test(m)) {
    return "当前账号无权使用该成片档，请确认会员状态后重试";
  }
  if (/timeout|超时|ETIMEDOUT/i.test(m)) {
    return "视频生成超时，请稍后重试";
  }
  if (/credit|积分|quota|余额不足/i.test(m)) {
    return "算力积分不足，请充值或稍后再试";
  }
  return m
    .replace(/xyq|jianying|pippit|小云雀/gi, "视频服务")
    .replace(/seedance[_\s-]?2\.5/gi, "成片引擎")
    .slice(0, 280);
}

function guessFilename(url: string, contentType: string, kind: "image" | "video" | "audio"): string {
  try {
    const path = new URL(url).pathname;
    const base = path.split("/").filter(Boolean).pop() || "";
    if (/\.[a-z0-9]{2,5}$/i.test(base)) return base.slice(0, 80);
  } catch {
    /* ignore */
  }
  const ct = contentType.toLowerCase();
  if (kind === "audio") {
    if (ct.includes("wav")) return "ref.wav";
    return "ref.mp3";
  }
  if (kind === "video") {
    if (ct.includes("quicktime") || ct.includes("mov")) return "ref.mov";
    return "ref.mp4";
  }
  if (ct.includes("png")) return "ref.png";
  if (ct.includes("webp")) return "ref.webp";
  return "ref.jpg";
}

async function xyqJson<T>(
  path: string,
  body: unknown,
  accessKey: string,
): Promise<T> {
  const r = await fetch(`${XYQ_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const json = (await r.json().catch(() => ({}))) as XyqEnvelope<T>;
  if (!r.ok) {
    throw new Error(userFacingXyqError(json.errmsg || `请求失败 (${r.status})`));
  }
  if (String(json.ret ?? "") !== "0") {
    throw new Error(userFacingXyqError(json.errmsg || `ret=${json.ret}`));
  }
  if (json.data == null) {
    throw new Error("视频服务未返回数据");
  }
  return json.data;
}

async function uploadUrlToXyqAsset(
  sourceUrl: string,
  accessKey: string,
  kind: "image" | "video" | "audio",
): Promise<string> {
  const url = String(sourceUrl || "").trim();
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("参考素材需要可访问的 HTTPS 地址");
  }
  const dl = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "mvstudiopro/1.0 (+xyq-seedance)" },
    signal: AbortSignal.timeout(180_000),
  });
  if (!dl.ok) {
    throw new Error(userFacingXyqError(`参考素材下载失败 (${dl.status})`));
  }
  const buf = Buffer.from(await dl.arrayBuffer());
  if (!buf.length) throw new Error("参考素材为空");
  const contentType = (dl.headers.get("content-type") || "").split(";")[0].trim() || "application/octet-stream";
  const filename = guessFilename(url, contentType, kind);

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buf)], { type: contentType }), filename);

  const up = await fetch(`${XYQ_BASE}/api/biz/v1/skill/upload_file`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessKey}`,
      Accept: "application/json",
    },
    body: form,
    signal: AbortSignal.timeout(180_000),
  });
  const json = (await up.json().catch(() => ({}))) as XyqEnvelope<{
    pippit_asset_id?: string;
    asset_id?: string;
  }>;
  if (!up.ok || String(json.ret ?? "") !== "0") {
    throw new Error(userFacingXyqError(json.errmsg || `上传失败 (${up.status})`));
  }
  const assetId = String(json.data?.pippit_asset_id || json.data?.asset_id || "").trim();
  if (!assetId) throw new Error("上传成功但未返回素材 ID");
  return assetId;
}

type XyqRunData = {
  web_thread_link?: string;
  run?: { thread_id?: string; run_id?: string };
};

type XyqThreadData = {
  thread?: {
    thread_id?: string;
    run_list?: Array<{
      run_id?: string;
      state?: number;
      error_message?: string;
      error_msg?: string;
      errmsg?: string;
      entry_list?: Array<{
        artifact?: {
          content?: Array<{
            sub_type?: string;
            data?: unknown;
          }>;
        };
      }>;
    }>;
  };
};

function parseContentData(raw: unknown): {
  video?: { download_url?: string };
  error_message?: string;
} {
  if (raw == null) return {};
  let obj: unknown = raw;
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t || t[0] !== "{") return {};
    try {
      obj = JSON.parse(t);
    } catch {
      return {};
    }
  }
  if (!obj || typeof obj !== "object") return {};
  return obj as { video?: { download_url?: string }; error_message?: string };
}

function extractVideoDownloadUrl(threadData: XyqThreadData, runId: string): {
  completed: boolean;
  failed: boolean;
  downloadUrl?: string;
  errorMessage?: string;
} {
  const runs = threadData.thread?.run_list || [];
  const run = runs.find((r) => String(r.run_id || "") === runId);
  if (!run) return { completed: false, failed: false };
  const state = Number(run.state);
  if (state === RUN_STATE_FAILED) {
    return {
      completed: true,
      failed: true,
      errorMessage: String(run.error_message || run.error_msg || run.errmsg || "Run 失败").trim(),
    };
  }
  if (state !== RUN_STATE_SUCCESS) {
    return { completed: false, failed: false };
  }

  for (const entry of run.entry_list || []) {
    for (const content of entry.artifact?.content || []) {
      if (content.sub_type !== "biz/x_data_video") continue;
      const data = parseContentData(content.data);
      const url = String(data.video?.download_url || "").trim();
      if (url) return { completed: true, failed: false, downloadUrl: url };
      if (data.error_message) {
        return { completed: true, failed: true, errorMessage: String(data.error_message) };
      }
    }
  }
  return { completed: true, failed: true, errorMessage: "任务完成但未返回视频地址" };
}

async function pollXyqVideoUrl(
  threadId: string,
  runId: string,
  accessKey: string,
): Promise<string> {
  const started = Date.now();
  let lastNetErr = "";
  while (Date.now() - started < MAX_POLL_MS) {
    try {
      const data = await xyqJson<XyqThreadData>(
        "/api/biz/v1/skill/get_thread",
        { thread_id: threadId, run_id: runId },
        accessKey,
      );
      lastNetErr = "";
      const out = extractVideoDownloadUrl(data, runId);
      if (out.downloadUrl) return out.downloadUrl;
      if (out.failed) {
        throw new Error(userFacingXyqError(out.errorMessage || "视频生成失败"));
      }
    } catch (e: any) {
      const msg = String(e?.message || e || "");
      // 瞬时网络抖动（含 fetch failed）不立刻当任务失败；小云雀可能已在出片
      if (/fetch failed|ECONNRESET|ETIMEDOUT|network|AbortError|超时/i.test(msg) && !/视频生成失败|Run 失败|积分/i.test(msg)) {
        lastNetErr = msg;
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }
      throw e;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  const hint = lastNetErr ? `（末次网络：${lastNetErr.slice(0, 80)}）` : "";
  throw new Error(
    `视频生成超时（${Math.round(MAX_POLL_MS / 60_000)} 分钟）${hint}。请到小云雀创作历史确认是否已出片，勿重复提交。`,
  );
}

/** 官方 CLI 音频仅 mp3/wav */
export function isXyqAllowedAudioUrl(url: string): boolean {
  const u = String(url || "").trim().toLowerCase();
  if (!u) return false;
  try {
    const path = new URL(u).pathname;
    return /\.(mp3|wav)$/i.test(path);
  } catch {
    return /\.(mp3|wav)(\?|#|$)/i.test(u);
  }
}

export type XyqSeedanceRunInput = {
  prompt: string;
  imageUrl?: string;
  imageUrls?: string[];
  videoUrls?: string[];
  audioUrls?: string[];
  aspectRatio?: string;
  duration?: number;
  quality?: string;
  /** 1 = 首尾帧；缺省时两图无音视频自动按首尾帧 */
  generateType?: number;
  /**
   * generate = 模型直出（含首尾帧/秒级分镜）
   * extend = 模型直出 + videos[] 续写（CLI --video）
   * reshoot / remix = nest 会话 message+asset_ids
   * upscale / erase_subtitle = video_part mini_tool
   */
  workMode?: XyqSeedance25WorkMode;
  /** nest 续聊同一会话（可选） */
  threadId?: string;
  /** 超分输出档：720p / 1080p / 2k / 4k */
  upscaleResolution?: XyqUpscaleResolution | string;
  upscaleToolVersion?: XyqUpscaleToolVersion | string;
  /** 复刻外链（写入 nest message） */
  sourceUrl?: string;
};

export type XyqSeedanceRunResult = {
  videoUrl: string;
  model: string;
  provider: "xyq";
  version: "2.5";
  threadId: string;
  runId: string;
  webThreadLink?: string;
  /** video_part = 模型直出/mini_tool；nest = 会话编排编辑 */
  route: "video_part" | "nest";
  workMode: XyqSeedance25WorkMode;
};

async function mirrorOrUpstream(sourceUrl: string): Promise<string> {
  try {
    return await mirrorSeedanceMp4ToGcsSignedUrl(sourceUrl);
  } catch (mirrorErr: any) {
    console.warn(
      "[xyqSeedance] GCS mirror failed; returning upstream URL",
      String(mirrorErr?.message || mirrorErr).slice(0, 200),
    );
    return sourceUrl;
  }
}

async function submitAndPollXyq(input: {
  body: Record<string, unknown>;
  accessKey: string;
  route: "video_part" | "nest";
  workMode: XyqSeedance25WorkMode;
}): Promise<XyqSeedanceRunResult> {
  const submit = await xyqJson<XyqRunData>(
    "/api/biz/v1/skill/submit_run",
    input.body,
    input.accessKey,
  );
  const threadId = String(submit.run?.thread_id || "").trim();
  const runId = String(submit.run?.run_id || "").trim();
  const webThreadLink = String(submit.web_thread_link || "").trim() || undefined;
  if (!threadId || !runId) {
    throw new Error("视频服务未返回任务 ID");
  }

  let sourceUrl = "";
  try {
    sourceUrl = await pollXyqVideoUrl(threadId, runId, input.accessKey);
  } catch (e: any) {
    const base = String(e?.message || "视频结果拉取失败");
    const sessionHint = webThreadLink
      ? ` 会话：${webThreadLink}`
      : ` thread_id=${threadId} run_id=${runId}`;
    throw new Error(
      `${base}${sessionHint}。小云雀侧可能已出片，请先查创作历史，勿重复提交。`,
    );
  }

  return {
    videoUrl: await mirrorOrUpstream(sourceUrl),
    model: XYQ_SEEDANCE_25_MODEL,
    provider: "xyq",
    version: "2.5",
    threadId,
    runId,
    webThreadLink,
    route: input.route,
    workMode: input.workMode,
  };
}

export async function runXyqSeedance25Video(input: XyqSeedanceRunInput): Promise<XyqSeedanceRunResult> {
  if (!isSeedance25Enabled()) {
    throw new Error("Seedance 2.5 即将登陆 MV Studio Pro");
  }
  const accessKey = getXyqAccessKey();
  if (!accessKey) {
    throw new Error("未配置 XYQ_ACCESS_KEY，无法联调 Seedance 2.5");
  }

  const workMode = parseXyqSeedance25WorkMode(input.workMode);
  const prompt = String(input.prompt || "").trim();
  if (!xyqWorkModeIsMiniTool(workMode) && !prompt) {
    throw new Error("请填写视频提示词");
  }

  const imageUrls = Array.from(
    new Set([
      ...(input.imageUrls || []).map((u) => String(u || "").trim()).filter(Boolean),
      ...(String(input.imageUrl || "").trim() ? [String(input.imageUrl).trim()] : []),
    ]),
  ).slice(0, XYQ_REFERENCE_MAX.image);
  const videoUrls = Array.from(
    new Set((input.videoUrls || []).map((u) => String(u || "").trim()).filter(Boolean)),
  ).slice(0, XYQ_REFERENCE_MAX.video);
  const rawAudioUrls = Array.from(
    new Set((input.audioUrls || []).map((u) => String(u || "").trim()).filter(Boolean)),
  ).slice(0, XYQ_REFERENCE_MAX.audio);
  const rejectedAudio = rawAudioUrls.filter((u) => !isXyqAllowedAudioUrl(u));
  if (rejectedAudio.length) {
    throw new Error("参考音频仅支持 mp3 / wav（与官方上传白名单一致）");
  }
  const audioUrls = rawAudioUrls;

  const sourceUrl = String(input.sourceUrl || "").trim();
  if (workMode === "remix") {
    if (!xyqRemixHasSource({ videoUrls, sourceUrl })) {
      throw new Error("视频复刻需要参考视频或可访问的成片链接");
    }
  } else if (xyqWorkModeNeedsVideo(workMode) && !videoUrls.length) {
    const needLabel: Record<string, string> = {
      extend: "延长",
      reshoot: "局部重拍",
      upscale: "提升清晰度",
      erase_subtitle: "擦除字幕",
    };
    throw new Error(
      `${needLabel[workMode] || "该模式"}需要参考视频：请先出片或上传参考视频`,
    );
  }

  const imageAssetIds: string[] = [];
  // mini tool 只需单视频，跳过多余图/音上传省积分与时间
  if (!xyqWorkModeIsMiniTool(workMode)) {
    for (const u of imageUrls) {
      imageAssetIds.push(await uploadUrlToXyqAsset(u, accessKey, "image"));
    }
  }
  const videoAssetIds: string[] = [];
  for (const u of videoUrls.slice(0, xyqWorkModeIsMiniTool(workMode) ? 1 : XYQ_REFERENCE_MAX.video)) {
    videoAssetIds.push(await uploadUrlToXyqAsset(u, accessKey, "video"));
  }
  const audioAssetIds: string[] = [];
  if (!xyqWorkModeIsMiniTool(workMode)) {
    for (const u of audioUrls) {
      audioAssetIds.push(await uploadUrlToXyqAsset(u, accessKey, "audio"));
    }
  }

  // —— 超分 / 擦字幕：官方 mini_tool_param ——
  if (workMode === "upscale") {
    const body = buildXyqSuperResolutionBody({
      videoAssetId: videoAssetIds[0]!,
      outputResolution: input.upscaleResolution || input.quality,
      toolVersion: input.upscaleToolVersion,
    });
    console.info(
      `[xyqSeedance] route=video_part workMode=upscale out=${normalizeXyqUpscaleResolution(
        input.upscaleResolution || input.quality,
      )}`,
    );
    return submitAndPollXyq({ body, accessKey, route: "video_part", workMode });
  }
  if (workMode === "erase_subtitle") {
    const body = buildXyqEraseSubtitleBody({ videoAssetId: videoAssetIds[0]! });
    console.info(`[xyqSeedance] route=video_part workMode=erase_subtitle`);
    return submitAndPollXyq({ body, accessKey, route: "video_part", workMode });
  }

  // —— 局部重拍 / 复刻：官方 nest 会话（message + asset_ids；复刻可外链-only）——
  if (xyqWorkModeIsNest(workMode)) {
    const assetIds = [...videoAssetIds, ...imageAssetIds, ...audioAssetIds];
    const body = buildXyqNestEditBody({
      message: prompt,
      assetIds,
      threadId: input.threadId,
      allowLinkOnly: workMode === "remix",
    });
    console.info(
      `[xyqSeedance] route=nest workMode=${workMode} assets=${assetIds.length} videos=${videoAssetIds.length} linkOnly=${
        workMode === "remix" && !assetIds.length
      }`,
    );
    return submitAndPollXyq({ body, accessKey, route: "nest", workMode });
  }

  // —— 生成 / 延长 / 首尾帧：官方 video_part 模型直出 ——
  const durationSec = clampXyqSeedanceDuration(input.duration);
  const ratio = normalizeXyqSeedanceRatio(input.aspectRatio);
  const resolution = normalizeXyqSeedanceResolution(input.quality);
  const body = buildXyqGenerateVideoBody({
    prompt,
    imageAssetIds,
    videoAssetIds,
    audioAssetIds,
    durationSec,
    ratio,
    resolution,
    generateType: workMode === "generate" ? input.generateType : undefined,
    workMode,
  });
  console.info(
    `[xyqSeedance] route=video_part workMode=${workMode} images=${imageAssetIds.length} videos=${videoAssetIds.length} generate_type=${
      (body.video_part_tool_param as Record<string, unknown>)?.generate_type ?? "none"
    }`,
  );
  return submitAndPollXyq({ body, accessKey, route: "video_part", workMode });
}

/** 单测导出 */
export const __xyqSeedanceTest = {
  extractVideoDownloadUrl,
  userFacingXyqError,
  isXyqAllowedAudioUrl,
};
