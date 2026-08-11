import { DEFAULT_CANVAS_VIDEO_MODEL, type CanvasBlock } from "./canvasTypes";
import { withFlyHealthGate } from "./flyHealthGate";
import { flyHealthProbeOriginForUrl, withLongJobsFlyDirect } from "./longJobsFlyOrigin";
import { probeVideoDurationSec } from "./videoUpscaleApi";
import { createJobSameOrigin, pollJobUntilTerminal } from "./jobs";
import {
  createOmniInteraction,
  pollOmniInteractionUntilDone,
  runGeminiScript,
} from "./omniCanvasApi";
import {
  compileI2VMotionPrompt,
  isManhuaSeedanceDirectorPrompt,
  extractPlainImagePrompt,
  fallbackEnglishFromJson,
  prepareJsonDirectorImageJob,
  type AspectRatio169Or916,
} from "@shared/jsonDirectorMiddleware";
import { buildCanvasGptImage2JobInput } from "@shared/canvasGptImage2JobInput";
import {
  resolveOpenAiImageLaneForBlockId,
  type OpenAiImageLane,
} from "@shared/openaiImageLane";
import { extractVideoFramesFromUrl, extractVideoTailFramesFromUrl } from "./extractVideoFrames";
import {
  VIDEO_REVERSE_DEFAULT_INTERVAL_SEC,
  VIDEO_REVERSE_MAX_DURATION_SEC,
  VIDEO_REVERSE_MAX_FRAMES,
  VIDEO_REVERSE_SYSTEM_PROMPT,
  buildVideoReverseUserPrompt,
  parseVideoReverseOutputMode,
  type VideoReverseOutputMode,
} from "@shared/videoReversePrompt";
import {
  MANHUA_CLIP_CONTINUITY_HINT_ZH,
  MANHUA_CLIP_TAIL_FRAME_COUNT,
  MANHUA_CLIP_TAIL_WINDOW_SEC,
} from "@shared/manhuaClipContinuity";
import {
  MANHUA_ASSET_SHEET_SOFT_NO_TEXT_EN,
  MANHUA_KEYART_NO_TEXT_EN,
  parseManhuaClipTargetDurationSec,
} from "@shared/manhuaScriptWorkbench";
import {
  clampSeedanceOpenRouterDuration,
  SEEDANCE_REFERENCE_MAX,
} from "@shared/seedanceOpenRouterModels";
import {
  clampSeedanceDuration,
  isSeedance25EvolinkMode,
  normalizeSeedance25EvolinkMode,
  type SeedanceEvolinkMode,
} from "@shared/seedanceEvolinkModels";
import { resolveSeedance25Access } from "@shared/seedance25Access";
import {
  clampHailuoOpenRouterDuration,
  HAILUO_REFERENCE_MAX,
  isCanvasHailuoH3VideoModel,
} from "@shared/hailuoOpenRouterModels";
import {
  clampHappyHorseCanvasDuration,
  HAPPYHORSE_REFERENCE_MAX,
  isCanvasHappyHorseVideoModel,
  normalizeHappyHorseCanvasResolution,
} from "@shared/happyHorseOpenRouterModels";
import { clampManhuaClipDurationSecForVideoModel } from "@shared/manhuaSeedanceLayout";
import { stripManhuaPromptSlop } from "@shared/manhuaDirectingWorkflow";
import { formatManhuaEditCraftDirectives } from "@shared/manhuaEditCraftDirectives";
import { appendManhuaClipEngineOptics } from "@shared/manhuaCineOpticsBank";
import {
  renderManhuaClipPromptForSeedance,
  stripManhuaStaleAssetBindForModel,
} from "@shared/manhuaClipPromptSanitize";
import {
  extractManhuaMentionedAssetTags,
  formatManhuaClipImageRoleBindLine,
  formatManhuaClipSeedanceBindLineFromEntries,
  parseManhuaAssetImageBindBlock,
  planManhuaClipSeedanceImageBind,
  resolveManhuaAssetImageBindRows,
  stripManhuaAssetUrlsFromPrompt,
  type ManhuaClipSeedanceImageBindEntry,
} from "@shared/manhuaAssetLockRegistry";
import {
  resolveManhuaSceneTileUrl,
  type ManhuaSceneTileSlot,
} from "@shared/manhuaSceneTilePick";
import { absolutizeManhuaAssetUrl } from "@shared/manhuaKeyartEditFusion";
import {
  buildManhuaFactoryOptimizeBrief,
  isManhuaBibleOrBeatsBlockId,
  planManhuaFactoryOptimizeSource,
} from "@shared/manhuaFactoryTextOptimize";
import { assertOpenAiImagePromptWithinLimit } from "@shared/manhuaKeyartPromptCompact";
import {
  normalizeCanvasVideoResolution,
  type CanvasVideoResolution,
} from "@shared/canvasGenerationPricing";
import {
  formatManhuaCharacterVoiceLockBlock,
  planManhuaVoiceAudioForPrompt,
  type ManhuaCharacterVoiceLock,
  type ManhuaEpisodeSegmentPromptRow,
} from "@shared/manhuaCharacterVoiceLock";
import {
  formatManhuaAudioReferenceLockBlock,
  resolveManhuaAccentAudioUrl,
  type ManhuaAudioReferenceLock,
} from "@shared/manhuaAudioReferenceLock";

const GEMINI_MODEL_MAP = {
  "gemini-3.1-pro": "gemini-3.1-pro-preview",
} as const;

const CANVAS_KIMI_PRIMARY_MODEL = "moonshotai/kimi-k3" as const;
const CANVAS_TERRA_PRIMARY_MODEL = "gpt-5.6-terra" as const;
const CANVAS_GEMINI_FALLBACK_MODEL = GEMINI_MODEL_MAP["gemini-3.1-pro"];

function resolveCanvasTextPrimaryModel(textModel: string | undefined): string {
  const m = String(textModel || "").trim();
  if (m === "kimi-k3" || m === "moonshotai/kimi-k3" || m.endsWith("/kimi-k3")) {
    return CANVAS_KIMI_PRIMARY_MODEL;
  }
  if (m === "gpt-5.6-sol" || m === "gpt-5.5" || m === "gpt-5.4" || m === "gpt-5.6-terra") {
    return m;
  }
  // 默认 / 含显式 gemini：主力 Kimi；Gemini 仅 fallback
  return CANVAS_KIMI_PRIMARY_MODEL;
}

/** 客户端轮询上限：须略大于 worker CANVAS_GPT_IMAGE2_JOB_TIMEOUT_MS（默认 10min） */
const CANVAS_GPT_IMAGE2_POLL_MAX_MS = 12 * 60_000;

export type CanvasRunDeps = {
  optimizeCopy: (input: {
    sourceText: string;
    optimizationBrief?: string;
    /** 画布文本模型：gpt-5.6-sol / gpt-5.6-terra / gpt-5.5 / gpt-5.4 */
    modelName?: string;
  }) => Promise<string>;
  /** Terra 多图视觉（官方专线）；缺省则直接走 Gemini fallback */
  canvasTerraVisionMarkdown?: (input: {
    prompt: string;
    images: Array<{ url: string; mimeType?: string }>;
  }) => Promise<string>;
  /** Terra 有帧反推（官方专线）；缺省则直接走 Gemini fallback */
  canvasTerraVideoReverse?: (input: {
    userHint: string;
    images: Array<{ url: string; mimeType?: string }>;
    outputMode?: VideoReverseOutputMode;
    targetEngine?: string;
  }) => Promise<string>;
  /** 把 dataURL/本地图上传为 HTTPS，供 Evolink/Seedance 引用（可选） */
  uploadImageFile?: (file: File) => Promise<string>;
  /** 入队 jobs 时写入 userId（与 assemble 一致；可空串） */
  userId?: string;
  /** 角色声线参考（从有声成片抠出）；成片时按 @角色 挂 audio_url */
  characterVoiceLocks?: ManhuaCharacterVoiceLock[] | null;
  /** 参考音频·全集参考（软·可选）：BGM/对白口音基准；不硬锁、不挡出片 */
  audioReferenceLock?: ManhuaAudioReferenceLock | null;
  /**
   * 资产 id→垫图 path（仅出片后台用，勿写进用户可见 prompt）。
   * 节点只存 @角色N|id=…|label=…，这里再转成可下载 URL。
   */
  manhuaAssetPathById?: Record<string, string> | null;
  /** 四视角拼板切片：段内按机位挑一格当场景垫图 */
  manhuaAssetTileUrlsById?: Record<
    string,
    Partial<Record<ManhuaSceneTileSlot, string>>
  > | null;
  /** 集号 → 集级导演分镜板（已裁成仅主画面）可下载地址；同一集所有段共用同一张 */
  manhuaDirectorBoardUrlByEpisode?: Record<number, string> | null;
  /** @引用索引（@图NN 平铺→锁表槽位）；由画布层按当前 registry 预构建 */
  manhuaAtReferenceEntries?: import("@shared/manhuaAtReference").ManhuaAtReferenceEntry[] | null;
  /**
   * 编剧室已选成片引擎。段数、段时长与新建 clip 盖的引擎都跟它走。
   * 本集还没有未归档 clip 节点时（局部改写清空、只扩写没 spawn），
   * 没有它就会掉到兜底默认档，把用户选的 2.5 / H3 悄悄换成草稿档。
   */
  manhuaWriterVideoModel?: string | null;
  /**
   * @deprecated 声线不再硬门禁；保留字段以免旧调用方类型炸。
   */
  getManhuaEpisodeSegmentPromptsForVoiceGate?: (
    episodeIndex: number,
  ) => ManhuaEpisodeSegmentPromptRow[];
  /** Stripe plan（free/pro/enterprise）；成片·加长正式会员门禁 */
  userPlan?: string | null;
  /** 账号角色（supervisor/admin 上线前也可用加长档，与服务端 resolveSeedance25Access 同口径） */
  userRole?: string | null;
};

function dataUrlToJpegFile(dataUrl: string, name: string): File | null {
  const m = /^data:(image\/(?:jpeg|jpg|png|webp));base64,(.+)$/i.exec(dataUrl);
  if (!m) return null;
  const mime = m[1]!.toLowerCase().replace("image/jpg", "image/jpeg");
  const bin = atob(m[2]!);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type: mime });
}

async function toHttpsImageUrls(
  deps: CanvasRunDeps,
  urls: string[],
): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < urls.length; i++) {
    const u = String(urls[i] || "").trim();
    if (!u) continue;
    if (/^https?:\/\//i.test(u)) {
      out.push(u);
      continue;
    }
    // 库内定妆/场景相对路径 → 站点绝对 HTTPS，否则 Seedance 吃不到
    if (u.startsWith("/")) {
      const abs = absolutizeManhuaAssetUrl(u);
      if (/^https?:\/\//i.test(abs)) {
        out.push(abs);
        continue;
      }
    }
    if (u.startsWith("data:image/") && deps.uploadImageFile) {
      const file = dataUrlToJpegFile(u, `continuity-tail-${i}.jpg`);
      if (!file) continue;
      try {
        const https = String((await deps.uploadImageFile(file)) || "").trim();
        if (/^https?:\/\//i.test(https)) out.push(https);
      } catch {
        /* 单帧失败不阻断 */
      }
    }
  }
  return out;
}

/** JSON 导演中台 → LLM 翻译 → 生图可用英文提示词（失败则本地 fallback） */
async function resolveImagePromptViaJsonDirector(
  deps: CanvasRunDeps,
  userPrompt: string,
  aspectRatio: AspectRatio169Or916,
  _imageModel: CanvasBlock["imageModel"],
): Promise<string> {
  // 画布出图已全钉 Image-2；提示词编译目标不再指向 nano-banana
  void _imageModel;
  const job = prepareJsonDirectorImageJob({
    userPrompt,
    aspectRatio,
    targetModel: "gpt-image-2",
  });
  try {
    const llmOut = await deps.optimizeCopy({
      sourceText: job.jsonText,
      optimizationBrief: job.translationBrief,
    });
    const prompt = extractPlainImagePrompt(llmOut);
    if (prompt.length >= 24) return prompt;
  } catch {
    /* fallback below */
  }
  try {
    return fallbackEnglishFromJson(JSON.parse(job.jsonText));
  } catch {
    return extractPlainImagePrompt(userPrompt);
  }
}

function isOpenAiImageTimeoutError(message: string): boolean {
  return /aborted due to timeout|TimeoutError|CLIENT_FETCH_ABORT_TIMEOUT|operation was aborted|job timed out|轮询已等待/i.test(
    message,
  );
}

/**
 * 短入队（www→Fly）+ 轮询；worker 内再等官方上游。
 * 勿再长 POST ?op=canvasGptImage2（会撞网关/浏览器长连接）。
 */
async function runGptImage2(
  prompt: string,
  aspectRatio: "9:16" | "16:9",
  opts?: {
    refImageUrl?: string;
    referenceImageUrls?: string[];
    maskUrl?: string;
    /** 关键静帧：只打官方 OpenAI，超时再入队一次，不回落 OpenRouter */
    openaiOnly?: boolean;
    userId?: string;
    /** 设定图与静帧分走两把官方密钥 */
    imageLane?: OpenAiImageLane;
    /** 批量里的第几张（0-based）：第 2 张起走批量价 */
    batchIndex?: number;
  },
): Promise<string> {
  const refImageUrl = String(opts?.refImageUrl || "").trim();
  const extraRefs = (opts?.referenceImageUrls || []).map((u) => String(u || "").trim()).filter(Boolean);
  const referenceImageUrls = Array.from(new Set([refImageUrl, ...extraRefs].filter(Boolean))).slice(0, 16);
  const maskUrl = String(opts?.maskUrl || "").trim();
  const openaiOnly = Boolean(opts?.openaiOnly);
  const userId = String(opts?.userId || "");

  const attemptOnce = async (isRetry = false): Promise<string> => {
    const { jobId } = await createJobSameOrigin({
      type: "image",
      userId,
      input: buildCanvasGptImage2JobInput({
        prompt,
        aspectRatio,
        referenceImageUrls: referenceImageUrls.length ? referenceImageUrls : undefined,
        maskUrl: maskUrl || undefined,
        generalImageEdit: referenceImageUrls.length > 0,
        providerOverride: openaiOnly ? "openai" : undefined,
        imageLane: opts?.imageLane,
        /**
         * 画布出图由 worker 扣积分；`/creative` 与 `/platform` 走同一队列但已在前端扣，故不带此标记。
         * 超时重入队的那次也不带：上一个 job 可能仍在跑并最终成功（那次已扣），
         * 同一张图不能收两次。宁可少收，也不误扣。
         */
        chargeOnServer: !isRetry,
        batchIndex: opts?.batchIndex,
      }),
    });
    const job = await pollJobUntilTerminal(jobId, {
      maxWaitMs: CANVAS_GPT_IMAGE2_POLL_MAX_MS,
      intervalMs: 2500,
    });
    if (job.status !== "succeeded") {
      throw new Error(job.error || "GPT-Image-2 生图失败");
    }
    const out = (job.output || {}) as { imageUrl?: string; imageUrls?: string[] };
    const url = String(out.imageUrl || out.imageUrls?.[0] || "").trim();
    if (!url) throw new Error("GPT-Image-2 未返回图片 URL");
    return url;
  };

  try {
    return await attemptOnce();
  } catch (firstErr) {
    const msg = firstErr instanceof Error ? firstErr.message : String(firstErr);
    if (openaiOnly && isOpenAiImageTimeoutError(msg)) {
      console.warn("[canvasRunBlock] 官方 Image-2 超时，仅再入队一次 OpenAI（不回落 OpenRouter）");
      return await attemptOnce(true);
    }
    throw firstErr;
  }
}

async function runGptImage2Batch(
  prompt: string,
  aspectRatio: "9:16" | "16:9",
  opts: {
    refImageUrl?: string;
    referenceImageUrls?: string[];
    maskUrl?: string;
    openaiOnly?: boolean;
    userId?: string;
    imageLane?: OpenAiImageLane;
  },
  count: number,
): Promise<string[]> {
  // 批次号随请求带上，让服务端把第 2 张起算批量价
  const tasks = Array.from({ length: count }, (_unused, batchIndex) =>
    runGptImage2(prompt, aspectRatio, { ...opts, batchIndex }),
  );
  return Promise.all(tasks);
}

export type CanvasVisionImage = { url: string; gcsUri?: string; mimeType?: string };

export type CanvasUpstreamContext = {
  visionImages: CanvasVisionImage[];
  texts: string[];
};

async function runCanvasVisionMarkdownGemini(
  prompt: string,
  images: CanvasVisionImage[],
): Promise<string> {
  const resp = await fetch("/api/google?op=canvasVisionMarkdown", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      images,
      model: CANVAS_GEMINI_FALLBACK_MODEL,
    }),
  });
  const json = (await resp.json()) as {
    ok?: boolean;
    markdown?: string;
    error?: string;
    message?: string;
  };
  if (!resp.ok || !json.ok) throw new Error(json.error || json.message || "多图视觉分析失败");
  const md = String(json.markdown || "").trim();
  if (!md) throw new Error("多图分析返回为空");
  return md;
}

async function runCanvasVisionMarkdown(
  deps: CanvasRunDeps,
  prompt: string,
  images: CanvasVisionImage[],
): Promise<string> {
  const payload = images
    .map((i) => ({
      url: String(i.url || "").trim(),
      mimeType: i.mimeType || "image/jpeg",
    }))
    .filter((i) => i.url);
  if (typeof deps.canvasTerraVisionMarkdown === "function" && payload.length) {
    try {
      const md = String(
        await deps.canvasTerraVisionMarkdown({ prompt, images: payload }),
      ).trim();
      if (md) return md;
    } catch {
      // Terra 失败 → Gemini
    }
  }
  return runCanvasVisionMarkdownGemini(prompt, images);
}

async function runVideoReversePromptGemini(
  userHint: string,
  images: Array<{ url: string; mimeType?: string }>,
  mode: VideoReverseOutputMode,
): Promise<string> {
  const resp = await fetch("/api/google?op=videoReversePrompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userHint: userHint || "反推分镜与微动提示词",
      images,
      model: CANVAS_GEMINI_FALLBACK_MODEL,
      targetEngine: "seedance-2.0",
      outputMode: mode,
    }),
  });
  const json = (await resp.json()) as {
    ok?: boolean;
    markdown?: string;
    error?: string;
    message?: string;
  };
  if (!resp.ok || !json.ok) throw new Error(json.error || json.message || "视频反推失败");
  const md = String(json.markdown || "").trim();
  if (!md) throw new Error("视频反推返回为空");
  return md;
}

async function runVideoReversePrompt(
  deps: CanvasRunDeps,
  userHint: string,
  videoUrl: string | undefined,
  fallbackImages: CanvasVisionImage[],
  outputMode: VideoReverseOutputMode = "zh",
): Promise<string> {
  let images: Array<{ url: string; mimeType?: string }> = [];
  const mode = parseVideoReverseOutputMode(outputMode);

  if (videoUrl) {
    const { frames } = await extractVideoFramesFromUrl(videoUrl, {
      maxFrames: VIDEO_REVERSE_MAX_FRAMES,
      intervalSec: VIDEO_REVERSE_DEFAULT_INTERVAL_SEC,
      maxDurationSec: VIDEO_REVERSE_MAX_DURATION_SEC,
    });
    images = frames.map((f) => ({ url: f.dataUrl, mimeType: f.mimeType }));
  } else if (fallbackImages.length) {
    images = fallbackImages
      .map((i) => ({
        url: i.url || "",
        mimeType: i.mimeType || "image/jpeg",
      }))
      .filter((i) => i.url);
  }

  const noFramePrompt = [
    VIDEO_REVERSE_SYSTEM_PROMPT,
    "没有参考帧时，请仅根据用户节拍/故事补全输出。",
    "",
    buildVideoReverseUserPrompt({
      userHint: userHint || "根据上游节拍补全八维编导分镜表与微动句",
      outputMode: mode,
      targetEngine: "seedance-2.0",
    }),
  ].join("\n");

  // 无片/无帧：Terra 文本优先 → Gemini
  if (!images.length) {
    try {
      const md = await deps.optimizeCopy({
        sourceText: noFramePrompt,
        optimizationBrief:
          "你是影视编导助手：根据原文直接输出完整 Markdown 分镜表与微动句，不要 JSON。",
        modelName: CANVAS_TERRA_PRIMARY_MODEL,
      });
      if (String(md || "").trim()) return String(md).trim();
    } catch {
      // fall through
    }
    const md = await runGeminiScript(noFramePrompt, CANVAS_GEMINI_FALLBACK_MODEL);
    if (!md.trim()) throw new Error("无片反推返回为空");
    return md.trim();
  }

  if (typeof deps.canvasTerraVideoReverse === "function") {
    try {
      const md = String(
        await deps.canvasTerraVideoReverse({
          userHint: userHint || "反推分镜与微动提示词",
          images,
          outputMode: mode,
          targetEngine: "seedance-2.0",
        }),
      ).trim();
      if (md) return md;
    } catch {
      // Terra 失败 → Gemini
    }
  }
  return runVideoReversePromptGemini(userHint, images, mode);
}

type SeedanceProductVideoResult = {
  videoUrl: string;
  workMode?: SeedanceEvolinkMode;
};

/** 画布成片异步任务：短轮询 status，避免单条 HTTP 长等被部署掐断。 */
async function pollCanvasVideoTask(
  taskId: string,
): Promise<{ videoUrl: string; workMode?: SeedanceEvolinkMode }> {
  const statusEndpoint = withLongJobsFlyDirect(
    `/api/jobs?op=canvasVideoStatus&taskId=${encodeURIComponent(taskId)}`,
  );
  const deadline = Date.now() + 20 * 60_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5_000));
    const statusRes = await fetch(statusEndpoint, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });
    const statusRaw = await statusRes.text();
    let statusJson: {
      ok?: boolean;
      status?: string;
      videoUrl?: string;
      workMode?: SeedanceEvolinkMode;
      error?: string;
    } = {};
    try {
      statusJson = JSON.parse(statusRaw) as typeof statusJson;
    } catch {
      continue;
    }
    if (!statusRes.ok || !statusJson.ok) {
      throw new Error(statusJson.error || "成片进度查询失败");
    }
    if (statusJson.status === "succeeded" && statusJson.videoUrl) {
      return {
        videoUrl: String(statusJson.videoUrl).trim(),
        workMode: isSeedance25EvolinkMode(statusJson.workMode)
          ? statusJson.workMode
          : undefined,
      };
    }
    if (statusJson.status === "failed") {
      throw new Error(statusJson.error || "成片生成失败，积分已自动退回");
    }
  }
  throw new Error("成片仍在生成中，请稍后在作品页查看，或稍后再试");
}

/**
 * 从漫剧 clip 节点 id（`clip-e01-g03`）取段号，随请求体上报便于服务端记账与排错。
 * 集号本身走 `block.episodeIndex`，不依赖 id 解析。
 */
function parseClipIndexFromBlockId(id: string): number | undefined {
  const m = /-g(\d{1,3})\b/.exec(String(id || ""));
  const n = m ? Number(m[1]) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

async function runSeedanceProductVideo(
  prompt: string,
  imageUrl: string | undefined,
  aspectRatio: "9:16" | "16:9",
  opts?: {
    imageUrls?: string[];
    videoUrls?: string[];
    /** 角色声线参考 mp3/wav（最多 3） */
    audioUrls?: string[];
    version?: "2.0-mini" | "2.0" | "2.0-fast" | "2.5";
    /** 段目标秒数；缺省从 prompt「目标时长」解析 */
    duration?: number;
    /** 2.5 官方五模式 → 服务端 EvoLink 真路由 */
    workMode?: SeedanceEvolinkMode;
    /**
     * 漫剧编剧室的集号／段号。服务端据此走整集折算段价，
     * 不透传就只能按自由画布单段计价（提示词里的「第 N 段」出线前会被换成
     * 普通括号，且用户可改，反解不可靠）。
     */
    episodeIndex?: number;
    clipIndex?: number;
    /** video_edit 专用：主片（videoUrls[0]）探测时长——edit 产出与主片等长，服务端按它计费 */
    editSourceDurationSec?: number;
    /**
     * 输出画质，默认 720p。标准档（2.0）可选到 4K，单价按像素翻倍（见 canvasGenerationPricing）；
     * 快速档与 2.5 加长仍固定 720p，由服务端 normalize 兜住。
     */
    resolution?: CanvasVideoResolution;
  },
): Promise<SeedanceProductVideoResult> {
  // 与 Creative / TestLab 一致：直连 Fly/api 子域，避免 www→Vercel→Fly 反代 ~120s 被 ROUTER_EXTERNAL 腰斩
  const seedanceUrl = withLongJobsFlyDirect("/api/jobs?op=seedanceI2V");
  const probeOrigin = flyHealthProbeOriginForUrl(seedanceUrl);
  const imageUrls = (opts?.imageUrls || []).map((u) => String(u || "").trim()).filter(Boolean);
  const videoUrls = (opts?.videoUrls || []).map((u) => String(u || "").trim()).filter(Boolean);
  const audioUrls = (opts?.audioUrls || []).map((u) => String(u || "").trim()).filter(Boolean);
  const version =
    opts?.version === "2.5"
      ? "2.5"
      : opts?.version === "2.0-fast"
        ? "2.0-fast"
        : opts?.version === "2.0-mini"
          ? "2.0-mini"
          : "2.0";
  const fromPrompt = parseManhuaClipTargetDurationSec(prompt);
  const durationRaw = opts?.duration ?? fromPrompt ?? undefined;
  // Mini 与 2.0 同为 4–15s 上限，复用 OpenRouter 档的钳制；2.5 才到 30s
  const duration =
    version === "2.5"
      ? clampSeedanceDuration("2.5", durationRaw)
      : clampSeedanceOpenRouterDuration(durationRaw);
  // 服务端要按登录用户扣积分（2.5 还要校验正式会员），三档一律带登录态
  const workMode =
    version === "2.5"
      ? normalizeSeedance25EvolinkMode(opts?.workMode, { imageUrls, videoUrls, audioUrls })
      : undefined;
  const episodeIndex = Number(opts?.episodeIndex);
  const clipIndex = Number(opts?.clipIndex);
  const res = await withFlyHealthGate(probeOrigin, () =>
    fetch(seedanceUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        // 换官方符号只在出线这一刻做：上面的时长解析等仍认【第N段·Xs】
        prompt: renderManhuaClipPromptForSeedance(prompt),
        imageUrl: imageUrl || imageUrls[0] || undefined,
        // 配额按版本分流：2.5 官方收图 30/视频 10/音频 10，2.0 系 9/3/3。
        // 原先无版本区分统一按 9/3/3 切，2.5 的高配额在出线口被砍——
        // 参考图是人物锁定的命根，30 席给锁脸+服装+场景+道具才够摆
        imageUrls: imageUrls.length
          ? imageUrls.slice(0, version === "2.5" ? 30 : SEEDANCE_REFERENCE_MAX.image)
          : undefined,
        videoUrls: videoUrls.length
          ? videoUrls.slice(0, version === "2.5" ? 10 : SEEDANCE_REFERENCE_MAX.video)
          : undefined,
        audioUrls: audioUrls.length
          ? audioUrls.slice(0, version === "2.5" ? 10 : SEEDANCE_REFERENCE_MAX.audio)
          : undefined,
        resolution: normalizeCanvasVideoResolution(opts?.resolution),
        aspectRatio,
        duration,
        editSourceDurationSec: opts?.editSourceDurationSec || undefined,
        // 产品口径：只用引擎自带 Audio on，暂不另开后期配音 API
        generateAudio: true,
        version,
        ...(version === "2.5" ? { workMode } : {}),
        ...(Number.isFinite(episodeIndex) && episodeIndex > 0 ? { episodeIndex } : {}),
        ...(Number.isFinite(clipIndex) && clipIndex > 0 ? { clipIndex } : {}),
      }),
    }),
  );
  const text = await res.text();
  let json: {
    videoUrl?: string;
    error?: string;
    message?: string;
    ok?: boolean;
    async?: boolean;
    taskId?: string;
    workMode?: SeedanceEvolinkMode;
  } = {};
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    throw new Error(
      /An error o|ROUTER_EXTERNAL/i.test(text)
        ? "成片网关超时，请稍后重试（已尽量直连长任务 API）"
        : `成片生成失败：${text.slice(0, 160)}`,
    );
  }
  if (!res.ok || !json.ok) {
    throw new Error(json.error || json.message || "成片生成失败");
  }
  if (json.videoUrl) {
    return {
      videoUrl: String(json.videoUrl),
      workMode: isSeedance25EvolinkMode(json.workMode) ? json.workMode : undefined,
    };
  }
  if (json.taskId) {
    const polled = await pollCanvasVideoTask(json.taskId);
    return {
      videoUrl: polled.videoUrl,
      workMode:
        polled.workMode ||
        (isSeedance25EvolinkMode(json.workMode) ? json.workMode : undefined),
    };
  }
  throw new Error(json.error || json.message || "成片生成失败");
}

/** MiniMax H3 · OpenRouter（2K；时长 5–15s） */
async function runHailuo3(
  prompt: string,
  imageUrl: string | undefined,
  aspectRatio: "9:16" | "16:9",
  opts?: {
    imageUrls?: string[];
    duration?: number;
    /** 漫剧集号／段号：服务端据此走整集折算段价 */
    episodeIndex?: number;
    clipIndex?: number;
  },
): Promise<string> {
  const hailuoUrl = withLongJobsFlyDirect("/api/jobs?op=hailuo3Video");
  const probeOrigin = flyHealthProbeOriginForUrl(hailuoUrl);
  const imageUrls = (opts?.imageUrls || []).map((u) => String(u || "").trim()).filter(Boolean);
  // 时长由共享层钉死 15s，节拍解析结果只影响提示词展示
  const duration = clampHailuoOpenRouterDuration();
  const res = await withFlyHealthGate(probeOrigin, () =>
    fetch(hailuoUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // 服务端已要求登录（H3 一段 2K·15s 是真钱），必须带上登录态
      credentials: "include",
      body: JSON.stringify({
        prompt: renderManhuaClipPromptForSeedance(prompt),
        imageUrl: imageUrl || imageUrls[0] || undefined,
        imageUrls: imageUrls.length
          ? imageUrls.slice(0, HAILUO_REFERENCE_MAX.image)
          : undefined,
        aspectRatio,
        duration,
        generateAudio: true,
        ...(Number(opts?.episodeIndex) > 0 ? { episodeIndex: Number(opts?.episodeIndex) } : {}),
        ...(Number(opts?.clipIndex) > 0 ? { clipIndex: Number(opts?.clipIndex) } : {}),
      }),
    }),
  );
  const text = await res.text();
  let json: {
    videoUrl?: string;
    error?: string;
    message?: string;
    ok?: boolean;
    async?: boolean;
    taskId?: string;
  } = {};
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    throw new Error(
      /An error o|ROUTER_EXTERNAL/i.test(text)
        ? "成片网关超时，请稍后重试（已尽量直连长任务 API）"
        : `成片生成失败：${text.slice(0, 160)}`,
    );
  }
  if (!res.ok || !json.ok) {
    throw new Error(json.error || json.message || "成片生成失败");
  }
  if (json.videoUrl) return String(json.videoUrl);
  if (json.taskId) {
    const polled = await pollCanvasVideoTask(json.taskId);
    return polled.videoUrl;
  }
  throw new Error(json.error || json.message || "成片生成失败");
}

/** Happy Horse 1.1 · OpenRouter（首帧图生；时长 5/10/15，最长 15s） */
async function runHappyHorse(
  prompt: string,
  imageUrl: string,
  aspectRatio: "9:16" | "16:9",
  opts?: {
    duration?: number;
    resolution?: string;
    episodeIndex?: number;
    clipIndex?: number;
  },
): Promise<string> {
  const hhUrl = withLongJobsFlyDirect("/api/jobs?op=happyHorseVideo");
  const probeOrigin = flyHealthProbeOriginForUrl(hhUrl);
  const duration = clampHappyHorseCanvasDuration(opts?.duration);
  const resolution = normalizeHappyHorseCanvasResolution(opts?.resolution);
  const res = await withFlyHealthGate(probeOrigin, () =>
    fetch(hhUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        prompt: renderManhuaClipPromptForSeedance(prompt),
        imageUrl,
        aspectRatio,
        duration,
        resolution,
        ...(Number(opts?.episodeIndex) > 0 ? { episodeIndex: Number(opts?.episodeIndex) } : {}),
        ...(Number(opts?.clipIndex) > 0 ? { clipIndex: Number(opts?.clipIndex) } : {}),
      }),
    }),
  );
  const text = await res.text();
  let json: {
    videoUrl?: string;
    error?: string;
    message?: string;
    ok?: boolean;
    async?: boolean;
    taskId?: string;
  } = {};
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    throw new Error(
      /An error o|ROUTER_EXTERNAL/i.test(text)
        ? "成片网关超时，请稍后重试（已尽量直连长任务 API）"
        : `成片生成失败：${text.slice(0, 160)}`,
    );
  }
  if (!res.ok || !json.ok) {
    throw new Error(json.error || json.message || "成片生成失败");
  }
  if (json.videoUrl) return String(json.videoUrl);
  if (json.taskId) {
    const polled = await pollCanvasVideoTask(json.taskId);
    return polled.videoUrl;
  }
  throw new Error(json.error || json.message || "成片生成失败");
}

export const OMNI_CLIP_DURATION_SECONDS = 10;

/** 成片跟静帧：正向约束，不堆「禁止真人」以免上游拒答 */
const MANHUA_VIDEO_FOLLOW_STILL_ZH =
  "【参考静帧】成片画面风格、人物造型、服装与场景材质请直接对齐本段参考静帧；以参考图为准做微动演绎。";

export function normalizeOmniClipPrompt(rawPrompt: string): string {
  const prompt = String(rawPrompt || "")
    .replace(/(?:约|大约|目标约)?\s*15\s*(?:秒|s)\s*(?:成片|视频)?/gi, "10 秒成片")
    .replace(/打斗短阶段/g, "动作短阶段")
    .replace(/兵器交锋/g, "舞台化兵器走位")
    .replace(/击打反馈/g, "动作反馈")
    .replace(/攻击/g, "动作")
    .replace(/(?:不出现|禁止出现)?\s*(?:伤口|流血|血迹)+/g, "保持克制")
    .trim();
  return [
    `单次成片严格为 ${OMNI_CLIP_DURATION_SECONDS} 秒。`,
    "动作采用非写实、无伤害的舞台化调度，保持克制与安全。",
    prompt.includes("参考静帧") ? "" : MANHUA_VIDEO_FOLLOW_STILL_ZH,
    prompt,
  ]
    .filter(Boolean)
    .join("\n");
}

async function runOmniFlash(
  prompt: string,
  imageUrl: string | undefined,
  aspectRatio: "9:16" | "16:9",
  opts?: {
    videoUrl?: string;
    previousInteractionId?: string;
    edit?: boolean;
    referenceImageUrls?: string[];
  },
): Promise<string> {
  const edit = Boolean(opts?.edit || opts?.videoUrl || opts?.previousInteractionId);
  const refs = (opts?.referenceImageUrls || []).map((u) => String(u || "").trim()).filter(Boolean);
  const primary = imageUrl || refs[0];
  const multiRefs = Array.from(new Set([primary, ...refs].filter(Boolean))) as string[];
  const task = edit
    ? ("edit" as const)
    : multiRefs.length > 1
      ? ("reference_to_video" as const)
      : primary
        ? ("image_to_video" as const)
        : ("text_to_video" as const);
  const created = await createOmniInteraction({
    prompt: normalizeOmniClipPrompt(prompt),
    task,
    aspectRatio,
    durationSeconds: OMNI_CLIP_DURATION_SECONDS,
    imageUrl: edit ? undefined : primary,
    referenceImageUrls: edit ? undefined : multiRefs.length > 1 ? multiRefs : undefined,
    videoUrl: opts?.videoUrl,
    previousInteractionId: opts?.previousInteractionId,
  });
  const result = await pollOmniInteractionUntilDone(created.id);
  const outUrl = String(result.videoUrl || "");
  if (!outUrl) throw new Error("视频改写未返回成片，请稍后重试");
  return outUrl;
}

export function formatCanvasUpstreamPrompt(basePrompt: string, upstreamTexts: string[]): string {
  const trimmed = basePrompt.trim();
  const texts = upstreamTexts.map((t) => t.trim()).filter(Boolean);
  if (!texts.length) return trimmed;

  const upstreamSection = texts
    .map((text, index) => `[上游 ${index + 1}]\n${text}`)
    .join("\n\n---\n\n")
    .slice(0, 12000);

  if (!trimmed) {
    return `【引用上游文本】\n${upstreamSection}`;
  }
  return `${trimmed}\n\n【引用上游文本】\n${upstreamSection}`;
}

export async function runCanvasBlock(
  deps: CanvasRunDeps,
  block: CanvasBlock,
  upstream: CanvasUpstreamContext = { visionImages: [], texts: [] },
): Promise<{
  outputText?: string;
  outputUrl?: string;
  outputUrls?: string[];
  /** 成片抽尾帧（HTTPS）供续拍硬锚 */
  lastFrameUrl?: string;
  /** 实际出图像素引擎（若曾静默回退会改写，便于 Debug 对照） */
  imageModel?: CanvasBlock["imageModel"];
  /** 成片·加长会话链（供局部重拍续聊；勿当失败再打） */
  seedance25ThreadId?: string;
  seedance25WebThreadLink?: string;
}> {
  const refTexts = upstream.texts.filter(Boolean);
  const prompt = block.prompt.trim();
  const refUrl = block.refImageUrl || upstream.visionImages[0]?.url;
  // 防御：文档/视频 URL 绝不能进 vision（旧数据或上游误传时仍走文本链路）
  const visionImages = upstream.visionImages.filter((i) => {
    if (!i.url && !i.gcsUri) return false;
    const probe = `${i.url || ""} ${i.gcsUri || ""}`;
    if (/\.(pdf|txt|md|markdown)(\?|$)/i.test(probe)) return false;
    if (/\.(mp4|mov|webm|m4v)(\?|$)/i.test(probe)) return false;
    if (i.mimeType && !i.mimeType.startsWith("image/")) return false;
    return true;
  });
  const uploadedVideoUrl =
    block.refVideoUrl ||
    block.uploadedAssets?.find((a) => a.kind === "video" || /\.(mp4|mov|webm)(\?|$)/i.test(a.fileName || a.url))
      ?.url;

  if (block.kind === "video_reverse") {
    const hint = formatCanvasUpstreamPrompt(
      prompt || "反推分镜表与 Seedance 微动句",
      refTexts,
    );
    const text = await runVideoReversePrompt(
      deps,
      hint,
      uploadedVideoUrl,
      visionImages,
      parseVideoReverseOutputMode(block.videoReverseOutputMode),
    );
    return { outputText: text };
  }

  // 文本块：本块上传的 TXT/MD 若调用方未预读，这里兜底读入（与「整理文案」「文本生成」共用）
  let docFallbackTexts: string[] = [];
  if (block.kind === "text" || block.kind === "copy_organize") {
    const docs = (block.uploadedAssets || []).filter(
      (a) =>
        a.kind === "document" ||
        /\.(txt|md|markdown|pdf)(\?|$)/i.test(a.fileName || a.url || ""),
    );
    if (docs.length && !refTexts.some((t) => t.includes("【文档 "))) {
      const { loadCanvasDocumentTexts } = await import("./canvasDocumentText");
      docFallbackTexts = await loadCanvasDocumentTexts(docs);
    }
  }
  const effectiveTexts = [...refTexts, ...docFallbackTexts];

  if (!prompt && !effectiveTexts.length) {
    throw new Error("请先填写提示词，或连接上游方块传递内容 / 上传 TXT·MD 文档");
  }

  // 关键静帧 / 段成片：本节点 prompt 已含导戏；禁止再拼上游 keyart/设定全文（古风板×N）
  const isKeyartBlock = block.id.startsWith("keyart-");
  const isClipBlock = block.id.startsWith("clip-");
  const mergedPrompt = formatCanvasUpstreamPrompt(
    prompt || "请根据上游内容完成本步骤生成。",
    isKeyartBlock || isClipBlock ? [] : effectiveTexts,
  );

  if (block.kind === "text" || block.kind === "copy_organize") {
    if (visionImages.length > 0) {
      const visionPrompt =
        block.kind === "copy_organize"
          ? `${mergedPrompt}\n\n请识别所有图片内容，归纳整理成 Markdown 文档：重复部分去掉，标题清晰，内容详尽，条理分明。`
          : mergedPrompt;
      const text = await runCanvasVisionMarkdown(deps, visionPrompt, visionImages);
      return { outputText: text };
    }

    const model = resolveCanvasTextPrimaryModel(block.textModel);
    const brief =
      model === "gpt-5.6-terra" || model === "gpt-5.4"
        ? "你是创作助手：根据原文直接输出可发布的完整 Markdown 文案，语气专业、有画面感。"
        : "你是创作助手：深度优化并输出可直接发布的完整 Markdown（含标题、正文、平台适配要点）。";
    const sourceText = mergedPrompt.length >= 10 ? mergedPrompt : `${mergedPrompt}\n（请补全为完整创作文案）`;
    const baseBrief =
      block.kind === "copy_organize" ? `整理文案结构。\n${brief}` : brief;
    const geminiSource =
      block.kind === "copy_organize"
        ? `请整理以下内容为结构化 Markdown 发布稿（含标题、分段、平台要点）：\n\n${mergedPrompt}`
        : mergedPrompt;

    // 漫剧 bible / beats：超约 16k 自动拆成 2～N 次请求拼接，不截断、不要求用户手动拆
    if (isManhuaBibleOrBeatsBlockId(block.id)) {
      const plan = planManhuaFactoryOptimizeSource(sourceText);
      if (plan.overLimitZh) {
        throw new Error(plan.overLimitZh);
      }
      try {
        const parts: string[] = [];
        let previousMarkdown = "";
        for (let i = 0; i < plan.chunks.length; i++) {
          const chunk = plan.chunks[i]!;
          const partMarkdown = await deps.optimizeCopy({
            sourceText: chunk,
            optimizationBrief: buildManhuaFactoryOptimizeBrief({
              baseBrief,
              partIndex: i + 1,
              partTotal: plan.chunks.length,
              previousMarkdown,
            }),
            modelName: model,
          });
          parts.push(String(partMarkdown || "").trim());
          previousMarkdown = parts[parts.length - 1] || "";
        }
        const joined = parts.filter(Boolean).join("\n\n");
        if (joined) return { outputText: joined };
      } catch {
        // Terra/GPT 失败 → Gemini
      }
      const text = await runGeminiScript(geminiSource, CANVAS_GEMINI_FALLBACK_MODEL);
      return { outputText: text };
    }

    try {
      const text = await deps.optimizeCopy({
        sourceText,
        optimizationBrief: baseBrief,
        modelName: model,
      });
      if (String(text || "").trim()) return { outputText: String(text).trim() };
    } catch {
      // Terra/GPT 失败 → Gemini
    }
    const text = await runGeminiScript(geminiSource, CANVAS_GEMINI_FALLBACK_MODEL);
    return { outputText: text };
  }

  if (block.kind === "image") {
    const ar = block.aspectRatio;
    const count = block.imageBatchCount || 1;
    const isKeyart = block.id.startsWith("keyart-");
    /** 角色定妆 / 场景空镜 / 关键静帧：禁字硬锁（软建议实测仍烧海报字） */
    const isAssetSheet =
      block.id.startsWith("charsheet-") || block.id.startsWith("sceneplate-");
    const noTextTail = isKeyart
      ? MANHUA_KEYART_NO_TEXT_EN
      : isAssetSheet
        ? MANHUA_ASSET_SHEET_SOFT_NO_TEXT_EN
        : "";
    let isEdit = block.imageMode === "edit";
    const keyartPromptBlob = String(mergedPrompt || block.prompt || "");
    /** 关键静帧：人物库/用户垫图 + Image-2 Edit；不再因 CG 关掉 edit 改纯文生 */
    const keyartNeedsLibraryEdit =
      isKeyart &&
      (/人物库垫图|用户垫图|Image-2 Edit|示范图融图|用户参考融图/.test(keyartPromptBlob) ||
        isEdit);
    /** 画布出图一律官方 Image-2；已移除 Nano Banana 2 选项与回退 */
    const imageModel: CanvasBlock["imageModel"] = "gpt-image-2";
    // 站点相对路径（/manhua-*）须转绝对 HTTPS：官方 OpenAI images/edits 服务端会下载参考图
    const { absolutizeManhuaAssetUrl, absolutizeManhuaAssetUrls } = await import(
      "@shared/manhuaKeyartEditFusion"
    );
    const absRef = (u?: string | null) => absolutizeManhuaAssetUrl(u) || String(u || "").trim();
    const editRefRaw =
      refUrl ||
      block.uploadedAssets?.find((a) => a.kind === "image" || /\.(png|jpe?g|webp)(\?|$)/i.test(a.fileName || a.url))
        ?.url ||
      block.outputUrl ||
      block.outputUrls?.[0];
    let editRef = absRef(editRefRaw);
    // 相对路径转绝对后仍非 http → 不可 edit
    if (editRef && !/^https?:\/\//i.test(editRef) && editRef.startsWith("/")) {
      editRef = absRef(editRef);
    }
    if (isEdit && editRef && !/^https?:\/\//i.test(editRef)) {
      // 关键静帧禁止降级纯文生（曾漂成无关主体）；须可下载的 HTTPS 垫图
      if (isKeyart || keyartNeedsLibraryEdit) {
        throw new Error(
          "关键静帧需要可访问的参考底图。请先出齐角色定妆与场景空镜（或上传人物/场景参考）后再生成。",
        );
      }
      throw new Error("微调模式需要可访问的底图，请重新上传参考图后重试");
    }
    if (isEdit && !editRef) {
      if (isKeyart || keyartNeedsLibraryEdit) {
        throw new Error(
          "关键静帧必须基于人物/场景参考图生成，不能无底图直接出。请先锁定角色并出设定图，或上传人物参考。",
        );
      }
      throw new Error("微调模式需要底图：请先上传图片，或先文生图后再点「微调这张图」");
    }
    if (isKeyart && !isEdit) {
      throw new Error(
        "关键静帧必须挂上人物/场景参考后再生成。请回到资产设定确认定妆与空镜已齐，或上传人物参考。",
      );
    }
    const fusionUrls = absolutizeManhuaAssetUrls(
      (block.editFusionUrls || [])
        .map((u) => String(u || "").trim())
        .filter((u) => u && u !== editRefRaw && u !== editRef)
        .slice(0, 15),
    );
    const maskUrl = absRef(block.editMaskUrl) || String(block.editMaskUrl || "").trim();
    /**
     * 关键静帧：提示词已含分镜/画风/硬锁（中文直送即可），再跑导演中台多一轮 LLM，明显拖慢。
     * 其它 image 节点仍走 JSON 导演编译。
     */
    const rawImagePrompt = isEdit
      ? [
          mergedPrompt,
          fusionUrls.length
            ? `【多图融合】另有 ${fusionUrls.length} 张参考图：请按说明把风格/元素/妆造合理融合进底图，保持人物身份一致。`
            : "",
          maskUrl ? "【局部遮罩】仅修改遮罩透明区域，其余像素尽量原样保留。" : "",
          noTextTail,
        ]
          .filter(Boolean)
          .join("\n")
      : isKeyart || isAssetSheet
        ? `${String(mergedPrompt || "").trim()}\n\n${noTextTail}`
        : await resolveImagePromptViaJsonDirector(deps, mergedPrompt, ar, imageModel);
    // 关键静帧 / 定妆·场景禁字硬锁：直送路径已拼过则去重
    const imagePrompt = noTextTail
      ? rawImagePrompt.includes(noTextTail)
        ? rawImagePrompt.trim()
        : `${rawImagePrompt.trim()}\n\n${noTextTail}`
      : rawImagePrompt;
    // 源头短包控长；不做二次文案 API。理论上仍超硬上限则报错停住
    if (isKeyart) {
      assertOpenAiImagePromptWithinLimit(imagePrompt);
    }
    /** 画布一律钉官方 OpenAI Image-2，失败即停；已移除 Nano Banana 2 */
    const pinOfficialOpenAi = true;
    const gptUserId = String(deps.userId || "");
    // 设定图与静帧分走两把官方密钥（本道打不通由服务端借另一把）
    const imageLane = resolveOpenAiImageLaneForBlockId(block.id);
    const gptImageOpts = isEdit
      ? {
          refImageUrl: editRef,
          referenceImageUrls: fusionUrls,
          maskUrl: maskUrl || undefined,
          openaiOnly: pinOfficialOpenAi,
          userId: gptUserId,
          imageLane,
        }
      : pinOfficialOpenAi
        ? { openaiOnly: true as const, userId: gptUserId, imageLane }
        : { refImageUrl: absRef(refUrl) || refUrl, userId: gptUserId, imageLane };
    let urls: string[] = [];
    try {
      urls = await runGptImage2Batch(imagePrompt, ar, gptImageOpts, count);
      if (isAssetSheet || isKeyart) {
        console.info(`[canvasRunBlock] image · id=${block.id} · engine=gpt-image-2`);
      }
    } catch (primaryErr) {
      const reason =
        primaryErr instanceof Error ? primaryErr.message.slice(0, 220) : "生图失败";
      console.warn(`[canvasRunBlock] image failed · id=${block.id} · ${reason}`);
      if (isAssetSheet) {
        throw new Error(`角色/场景设定图生成失败：${reason}`);
      }
      if (isKeyart) {
        // 保留上游原因，便于 toast 映射；勿一律说成「垫图不可访问」
        throw new Error(`关键静帧改图失败：${reason}`);
      }
      throw new Error(`图片生成失败：${reason}`);
    }
    const filtered = urls.filter(Boolean);
    if (!filtered.length) throw new Error("图片生成返回为空");
    return {
      outputUrl: filtered[0],
      outputUrls: filtered,
      imageModel: "gpt-image-2",
    };
  }

  if (block.kind === "video") {
    const ar = block.aspectRatio;
    const looksLikeVideo = (u?: string) => Boolean(u && /\.(mp4|mov|webm)(\?|$)/i.test(u));
    const continuityVideoUrl =
      block.refVideoUrl ||
      uploadedVideoUrl ||
      (looksLikeVideo(refUrl) ? refUrl : undefined) ||
      upstream.visionImages.find((i) => looksLikeVideo(i.url))?.url;
    const stillRef =
      refUrl && !looksLikeVideo(refUrl)
        ? refUrl
        : upstream.visionImages.find((i) => i.url && !looksLikeVideo(i.url))?.url;
    const fusionStillUrls = (block.editFusionUrls || [])
      .map((u) => String(u || "").trim())
      .filter((u) => u && !looksLikeVideo(u));
    // 段成片：禁止再叠「参考静帧/连续性」聊天墙；身份靠 @Image + 秒轴短指令
    // 声线/配乐不硬锁：缺参考音不挡出片（初登场无音、后期可改）
    const isClip = block.id.startsWith("clip-");
    const seedanceDirectorSource = isClip
      ? mergedPrompt
      : String(mergedPrompt || "").includes("参考静帧")
        ? mergedPrompt
        : `${mergedPrompt}\n\n${MANHUA_VIDEO_FOLLOW_STILL_ZH}`;
    const withContinuity =
      !isClip && continuityVideoUrl
        ? `${seedanceDirectorSource}\n\n${MANHUA_CLIP_CONTINUITY_HINT_ZH}`
        : seedanceDirectorSource;
    // 导戏单原样进 Seedance（已废除微动三件套）；clip 不用路径配方覆盖正文
    const compiledMotion = stripManhuaPromptSlop(
      compileI2VMotionPrompt(withContinuity, {
        pathCameraRecipeId: isClip ? undefined : block.pathCameraRecipeId,
      }),
    );
    // 光学 mm/快门：仅出片时由运镜句自动转换，不写回节点/前台审阅
    // 成片正文剥网址：垫图 URL 只走 imageUrls，不进提示词
    const motionPrompt = isClip
      ? stripManhuaAssetUrlsFromPrompt(appendManhuaClipEngineOptics(compiledMotion))
      : compiledMotion;
    const videoModel = block.videoModel || DEFAULT_CANVAS_VIDEO_MODEL;
    const useHailuoH3 = isCanvasHailuoH3VideoModel(videoModel);
    const useHappyHorse = isCanvasHappyHorseVideoModel(videoModel);
    const useSeedance25 = videoModel === "seedance-2.5";
    if (useSeedance25) {
      // 与服务端 assertSeedance25PaidAccess 同一套判定（到点 + 会员 + 内部角色），
      // 不只判 plan——否则未到点的 supervisor/free 组合会被前端自己拦掉。
      const access = resolveSeedance25Access({ plan: deps.userPlan, role: deps.userRole });
      if (!access.allowed) {
        throw new Error(access.message || "Seedance 2.5 暂不可用");
      }
    }
    console.info(
      `[canvasRunBlock] video · id=${block.id} · videoModel=${videoModel} · stills=${[stillRef, ...fusionStillUrls].filter(Boolean).length} · continuity=${Boolean(continuityVideoUrl)} · directorPass=${isManhuaSeedanceDirectorPrompt(motionPrompt)} · promptChars=${motionPrompt.length}`,
    );
    let url = "";
    let seedance25ThreadId: string | undefined;
    let seedance25WebThreadLink: string | undefined;
    if (
      videoModel === "seedance-2.0-mini" ||
      videoModel === "seedance-2.0" ||
      videoModel === "seedance-2.0-fast" ||
      useSeedance25 ||
      useHailuoH3 ||
      useHappyHorse
    ) {
      // ~15s 一镜：下一段起幅必须吃上一段末 3–5s 帧，再叠本段静帧（配额≤6）
      const stillPool: string[] = [];
      if (stillRef) stillPool.push(stillRef);
      for (const u of fusionStillUrls) {
        if (!stillPool.includes(u)) stillPool.push(u);
      }
      let tailFrames: string[] = [];
      if (continuityVideoUrl && /^https?:\/\//i.test(continuityVideoUrl)) {
        try {
          const { frames } = await extractVideoTailFramesFromUrl(continuityVideoUrl, {
            frameCount: MANHUA_CLIP_TAIL_FRAME_COUNT,
            tailWindowSec: MANHUA_CLIP_TAIL_WINDOW_SEC,
          });
          const rawFrames = frames.map((f) => f.dataUrl).filter(Boolean);
          tailFrames = await toHttpsImageUrls(deps, rawFrames);
          console.info(
            `[canvasRunBlock] clip continuity · prevTailFrames=${tailFrames.length} · window=${MANHUA_CLIP_TAIL_WINDOW_SEC}s`,
          );
        } catch (tailErr) {
          console.warn(
            `[canvasRunBlock] prev-clip tail extract failed · ${
              tailErr instanceof Error ? tailErr.message.slice(0, 120) : "unknown"
            }`,
          );
        }
      }
      // 节点只含 id；path 从 deps 后台表解析，绝不依赖提示词里的网址
      const assetRows = isClip
        ? resolveManhuaAssetImageBindRows(
            parseManhuaAssetImageBindBlock(block.prompt || motionPrompt),
            deps.manhuaAssetPathById,
          ).map((r) => {
            const abs = absolutizeManhuaAssetUrl(r.path) || r.path;
            /**
             * 跨集场景挂的是四视角拼板切片，按本段机位换那一格：俯拍段喂平视图
             * 等于让引擎自己想象俯视下的地面动线，空间锁就白锁了。
             */
            const tiles = deps.manhuaAssetTileUrlsById?.[r.id];
            if (!tiles) return { ...r, path: abs };
            const picked = resolveManhuaSceneTileUrl(abs, tiles, motionPrompt);
            return { ...r, path: absolutizeManhuaAssetUrl(picked.url) || picked.url };
          })
        : [];
      const mentionedTags = isClip
        ? extractManhuaMentionedAssetTags(motionPrompt)
        : [];
      /**
       * @引用闭环（@图NN）：解析成真 URL 进 imageUrls；断链硬拦——
       * 红 chip 只是提示，跑到这一步还断就必须炸，绝不静默出错脸。
       */
      const { applyManhuaAtReferencesToClip } = await import("@shared/manhuaAtReference");
      const atRefApplied =
        isClip && deps.manhuaAtReferenceEntries?.length
          ? applyManhuaAtReferencesToClip({
              promptText: String(block.prompt || motionPrompt || ""),
              index: deps.manhuaAtReferenceEntries,
              bindings: block.atRefBindings || null,
            })
          : null;
      if (atRefApplied?.missing.length) {
        throw new Error(
          `@引用断链：@${atRefApplied.missing.join("、@")} 指到的资产不存在，请在审阅框修正或删除该引用后再出片`,
        );
      }
      const absStills = [
        ...(atRefApplied?.imageUrls || []),
        ...stillPool.map((u) => absolutizeManhuaAssetUrl(u) || u),
      ].filter(
        (u, i, arr) =>
          (/^https?:\/\//i.test(u) || u.startsWith("data:image/")) && arr.indexOf(u) === i,
      );
      // clip-eNN-... → 集号；没有导演板表或解不出集号时 boardUrl 就是空串，不影响既有行为
      const clipEpisodeMatch = /^[a-z_]+-e(\d{2})-/i.exec(block.id);
      const clipEpisodeNo = clipEpisodeMatch ? Number.parseInt(clipEpisodeMatch[1]!, 10) : null;
      const boardUrl =
        isClip && clipEpisodeNo
          ? String(deps.manhuaDirectorBoardUrlByEpisode?.[clipEpisodeNo] || "").trim()
          : "";
      // 成片硬绑：末帧 → 资产定妆 → 本段静帧 → 导演板（URL 只进 API imageUrls）
      const bindPlan = isClip
        ? planManhuaClipSeedanceImageBind({
            assetRows: assetRows.filter((r) => /^https?:\/\//i.test(r.path)),
            stillUrls: absStills,
            tailUrls: tailFrames,
            mentionedTags,
            maxImages: useHappyHorse
              ? HAPPYHORSE_REFERENCE_MAX.image
              : useHailuoH3
                ? HAILUO_REFERENCE_MAX.image
                : SEEDANCE_REFERENCE_MAX.image,
            boardUrl: boardUrl || null,
          })
        : null;
      const rawPool = bindPlan?.imageUrls?.length
        ? bindPlan.imageUrls
        : [...tailFrames, ...absStills];
      const maxRefImages = useHappyHorse
        ? HAPPYHORSE_REFERENCE_MAX.image
        : useHailuoH3
          ? HAILUO_REFERENCE_MAX.image
          : SEEDANCE_REFERENCE_MAX.image;
      const httpsImages = await toHttpsImageUrls(
        deps,
        rawPool.slice(0, maxRefImages),
      );
      const keptEntries: ManhuaClipSeedanceImageBindEntry[] = [];
      if (bindPlan?.entries.length) {
        for (const e of bindPlan.entries) {
          const abs = absolutizeManhuaAssetUrl(e.url) || e.url;
          const hit = httpsImages.find((h) => h === abs || h === e.url);
          if (!hit) continue;
          keptEntries.push({ ...e, url: hit, imageIndex: keptEntries.length + 1 });
        }
      }
      // Seedance 首图：有上一段末帧时用末帧作起幅主参考，否则用本段首静帧
      const seedStill =
        keptEntries.find((e) => e.kind === "tail")?.url ||
        httpsImages[0] ||
        stillRef;
      const voiceLocks = deps.characterVoiceLocks || [];
      const voicePlan = planManhuaVoiceAudioForPrompt(motionPrompt, voiceLocks);
      const voiceBlock = formatManhuaCharacterVoiceLockBlock(voiceLocks, voicePlan);
      // 参考音频·全集参考（软）：BGM/口音文本注入 + 无角色声线时口音兜底 audio_url
      const audioRefLock = deps.audioReferenceLock || null;
      const audioRefBlock = formatManhuaAudioReferenceLockBlock(audioRefLock);
      const accentFallbackUrl = resolveManhuaAccentAudioUrl(audioRefLock);
      const seedanceAudioUrls = voicePlan.audioUrls.length
        ? voicePlan.audioUrls
        : accentFallbackUrl
          ? [accentFallbackUrl]
          : [];
      const imageBind = isClip
        ? formatManhuaClipSeedanceBindLineFromEntries(keptEntries, {
            includeAssetId: false,
          }) ||
          formatManhuaClipImageRoleBindLine(httpsImages.length, {
            tailCount: Math.min(tailFrames.length, 2),
          })
        : "";
      // 声线块压成一行标签，避免再灌聊天墙
      const voiceOneLine = voiceBlock
        ? voiceBlock
            .split("\n")
            .filter((ln) => /@角色\d+=/.test(ln))
            .join("；")
        : "";
      /**
       * 剪辑手法只在这里拼，不写回节点：审阅面那一栏要读的是谁在做什么，
       * 把「切点卡情绪、景别拉反差、别乱转场、补音效」逐条铺上去会把秒轴淹掉。
       */
      const editCraft = isClip
        ? formatManhuaEditCraftDirectives({
            prompt: motionPrompt,
            shotCount: keptEntries.filter((e) => e.kind === "still").length,
          })
        : "";
      // imageBind 是按实际送进 API 的图现算的，为准；节点里存的那两块快照剥掉，
      // 否则模型同时拿到两套 @Image 映射（还可能对不上）只会挑错脸
      const seedancePrompt = [
        imageBind,
        isClip ? stripManhuaStaleAssetBindForModel(motionPrompt) : motionPrompt,
        voiceOneLine ? `【声线】${voiceOneLine}` : "",
        audioRefBlock,
        editCraft,
      ]
        .filter(Boolean)
        .join("\n")
        .trim();
      console.info(
        `[canvasRunBlock] clip image-bind · assets=${assetRows.length} · kept=${keptEntries.length} · urls=${httpsImages.length} · bind=${String(imageBind).slice(0, 180)}`,
      );
      const clipDurationRaw =
        parseManhuaClipTargetDurationSec(motionPrompt) ??
        parseManhuaClipTargetDurationSec(block.prompt) ??
        undefined;
      const clipDuration = clampManhuaClipDurationSecForVideoModel(videoModel, clipDurationRaw);
      if (useHappyHorse) {
        const firstFrame = String(seedStill || "").trim();
        if (!/^https?:\/\//i.test(firstFrame)) {
          throw new Error("Happy Horse 成片需要至少一张首帧参考图（请先出静帧或上传参考）");
        }
        url = await runHappyHorse(seedancePrompt, firstFrame, ar, {
          duration: clipDuration,
          resolution: block.videoResolution,
          episodeIndex: block.episodeIndex,
          clipIndex: parseClipIndexFromBlockId(block.id),
        });
      } else if (useHailuoH3) {
        // H3：OpenRouter 仅图参考（首帧 + input_references）；不传 Seedance 专属音/视频参考
        url = await runHailuo3(seedancePrompt, seedStill, ar, {
          imageUrls: httpsImages.length ? httpsImages : undefined,
          duration: clipDuration,
          episodeIndex: block.episodeIndex,
          clipIndex: parseClipIndexFromBlockId(block.id),
        });
      } else {
        const userRefVideos = (block.seedance25RefVideoUrls || [])
          .map((u) => String(u || "").trim())
          .filter((u) => /^https?:\/\//i.test(u));
        const userRefAudios = (block.seedance25RefAudioUrls || [])
          .map((u) => String(u || "").trim())
          .filter((u) => /^https?:\/\//i.test(u));
        const candidateVideoUrls = Array.from(
          new Set([
            ...userRefVideos,
            ...(continuityVideoUrl ? [continuityVideoUrl] : []),
            ...(useSeedance25 && block.outputUrl && looksLikeVideo(block.outputUrl)
              ? [block.outputUrl]
              : []),
            ...(useSeedance25 && block.refVideoUrl && looksLikeVideo(block.refVideoUrl)
              ? [block.refVideoUrl]
              : []),
          ]),
        );
        const candidateAudioUrls = Array.from(new Set([...userRefAudios, ...seedanceAudioUrls]));
        const workMode = useSeedance25
          ? normalizeSeedance25EvolinkMode(block.seedance25WorkMode, {
              imageUrls: httpsImages,
              videoUrls: candidateVideoUrls,
              audioUrls: candidateAudioUrls,
            })
          : undefined;
        const storyboard = String(block.seedance25TimestampStoryboard || "").trim();
        const promptWithStoryboard = storyboard
          ? `${seedancePrompt}\n\n【秒级分镜】\n${storyboard}`
          : seedancePrompt;
        let editSourceDurationSec: number | undefined;
        let finalPrompt = promptWithStoryboard;
        let outImages = httpsImages;
        let outVideos = candidateVideoUrls;
        let outAudios = candidateAudioUrls;
        if (useSeedance25) {
          if (workMode === "text_to_video") {
            outImages = [];
            outVideos = [];
            outAudios = [];
          } else if (workMode === "image_to_video") {
            if (!outImages.length) {
              throw new Error("图生视频需要至少一张参考图");
            }
            outImages = outImages.slice(0, 2);
            outVideos = [];
            outAudios = [];
          } else if (workMode === "reference_to_video") {
            if (!outImages.length && !outVideos.length && !outAudios.length) {
              throw new Error("多模态参考需要至少一张图片、一条视频或一条音频");
            }
            outImages = outImages.slice(0, 30);
            outVideos = outVideos.slice(0, 10);
            outAudios = outAudios.slice(0, 10);
          } else {
            if (!outVideos.length) {
              throw new Error(
                workMode === "video_edit"
                  ? "视频编辑需要参考视频：请先出片或上传并勾选视频"
                  : "视频延长需要参考视频：请先出片或上传并勾选视频",
              );
            }
            outImages = outImages.slice(0, 30);
            outVideos = outVideos.slice(0, 10);
            outAudios = outAudios.slice(0, 10);
            finalPrompt =
              workMode === "video_edit"
                ? `编辑 @video1：${promptWithStoryboard}`
                : `向后延长 @video1：${promptWithStoryboard}`;
            if (workMode === "video_edit" && outVideos[0]) {
              // edit 产出与主片等长：探测主片真实时长交服务端按秒计费，
              // 不探测就会按写死的 15s 扣（与产出长度脱钩）；探测失败服务端走保守值
              editSourceDurationSec =
                (await probeVideoDurationSec(outVideos[0])) || undefined;
            }
          }
        } else {
          outVideos = outVideos.slice(0, SEEDANCE_REFERENCE_MAX.video);
          outAudios = outAudios.slice(0, SEEDANCE_REFERENCE_MAX.audio);
        }
        const seedanceOut = await runSeedanceProductVideo(
          finalPrompt,
          useSeedance25 && workMode === "text_to_video" ? undefined : seedStill,
          ar,
          {
          imageUrls: outImages.length ? outImages : undefined,
          videoUrls: outVideos.length ? outVideos : undefined,
          audioUrls: outAudios.length ? outAudios : undefined,
          version:
            videoModel === "seedance-2.5"
              ? "2.5"
              : videoModel === "seedance-2.0-fast"
                ? "2.0-fast"
                : videoModel === "seedance-2.0-mini"
                  ? "2.0-mini"
                  : "2.0",
          duration: clipDuration,
          workMode: useSeedance25 ? workMode : undefined,
          editSourceDurationSec,
          episodeIndex: block.episodeIndex,
          clipIndex: parseClipIndexFromBlockId(block.id),
            resolution: block.videoResolution,
          },
        );
        url = seedanceOut.videoUrl;
        if (useSeedance25) {
          console.info(
            `[canvasRunBlock] seedance25 · provider=evolink · workMode=${seedanceOut.workMode || workMode}`,
          );
        }
      }
    } else {
      // omni_edit / 续编：有上游成片时用 edit；否则段内静帧 I2V / 多图 reference_to_video
      const isOmniEdit = block.id.startsWith("omni_edit-");
      const editVideoUrl =
        block.refVideoUrl ||
        uploadedVideoUrl ||
        (looksLikeVideo(refUrl) ? refUrl : undefined) ||
        upstream.visionImages.find((i) => looksLikeVideo(i.url))?.url;
      const useVideoContinuity =
        Boolean(editVideoUrl && looksLikeVideo(editVideoUrl)) &&
        (isOmniEdit || Boolean(block.refVideoUrl));
      const omniRefs = Array.from(
        new Set([stillRef || refUrl, ...fusionStillUrls].filter(Boolean) as string[]),
      );
      url = await runOmniFlash(
        motionPrompt,
        useVideoContinuity ? undefined : omniRefs[0],
        ar,
        {
          edit: useVideoContinuity,
          videoUrl: useVideoContinuity ? editVideoUrl : undefined,
          referenceImageUrls: useVideoContinuity ? undefined : omniRefs,
        },
      );
    }
    let lastFrameUrl: string | undefined;
    if (url && /^https?:\/\//i.test(url) && block.id.startsWith("clip-")) {
      try {
        const { frames } = await extractVideoTailFramesFromUrl(url, {
          frameCount: 1,
          tailWindowSec: MANHUA_CLIP_TAIL_WINDOW_SEC,
        });
        const raw = frames.map((f) => f.dataUrl).filter(Boolean);
        const https = await toHttpsImageUrls(deps, raw);
        lastFrameUrl = https[https.length - 1];
      } catch (err) {
        console.warn(
          `[canvasRunBlock] clip lastFrame extract failed · ${
            err instanceof Error ? err.message.slice(0, 120) : "unknown"
          }`,
        );
      }
    }
    return {
      outputUrl: url,
      lastFrameUrl,
      seedance25ThreadId,
      seedance25WebThreadLink,
    };
  }

  throw new Error("未知方块类型");
}

export { uploadFileToSignedUrl, resolveOmniMaterialUrl } from "./omniCanvasApi";
