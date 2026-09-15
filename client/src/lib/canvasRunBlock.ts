import { DEFAULT_CANVAS_VIDEO_MODEL, isCanvasWan30VideoModel, normalizeCanvasVideoModel, type CanvasBlock } from "./canvasTypes";
import { compileCanvasAudioBindings } from "@shared/canvasAudioStudio";
import { isLocalMediaPointer, resolveUrlForCloudSync } from "./manhuaLocalMediaStore";
import { withFlyHealthGate } from "./flyHealthGate";
import {
  canvasIntentDigestFromOutboundFingerprint,
  loadCanvasIntentStore,
  markCanvasIntentStatus,
  persistCanvasIntent,
  resolveCanvasIntentForRun,
  type CanvasGenerationIntent,
  type CanvasIntentStorageLike,
} from "./canvasGenerationIntent";
import { flyHealthProbeOriginForUrl, withLongJobsFlyDirect } from "./longJobsFlyOrigin";
import { probeVideoDurationSec } from "./videoUpscaleApi";
import { createJobSameOrigin, pollJobUntilTerminal } from "./jobs";
import {
  compileManhuaVideoEditPrompt,
  isManhuaVideoEditBlock,
} from "./manhuaMediaVersions";
import { resolveCanvasMaterialUrl, runGeminiScript } from "./omniCanvasApi";
import { createCanvasAssetResigner, resignCanvasBlockUploadedReferences } from "./canvasAssetResign";
import {
  formatManhuaSegmentReferenceGuideZh,
  manhuaSegmentReferenceFitsCap,
  MANHUA_SEGMENT_REFERENCE_CAP_SEC,
  type ManhuaSegmentReferenceEntry,
} from "@shared/manhuaSegmentReference";
import {
  compileI2VMotionPrompt,
  isManhuaSeedanceDirectorPrompt,
  extractPlainImagePrompt,
  fallbackEnglishFromJson,
  prepareJsonDirectorImageJob,
  type AspectRatio169Or916,
} from "@shared/jsonDirectorMiddleware";
import { readOpenAiImageVariantMode, readOpenAiImageVariantPref } from "@/lib/openaiImageVariantPref";
import type { OpenAiImageVariant } from "@shared/openaiImageVariant";
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
  resolveClipLocalSegmentIndex,
} from "@shared/manhuaScriptWorkbench";
import { compileManhuaPilotPrompt, MANHUA_PILOT_DURATION_SEC } from "@shared/manhuaPilotGate";
import { manhuaPilotSubmissionSchema, type ManhuaPilotSubmission } from "@shared/manhuaPilotReview";
import {
  clampSeedanceOpenRouterDuration,
  SEEDANCE_25_REFERENCE_MAX,
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
  clampWan30Duration,
  WAN30_REFERENCE_MAX,
} from "@shared/wanWavespeedModels";
import {
  clampHappyHorseCanvasDuration,
  HAPPYHORSE_REFERENCE_MAX,
  isCanvasHappyHorseVideoModel,
  normalizeHappyHorseCanvasResolution,
  CANVAS_VIDEO_MODEL_HAPPYHORSE_1_1,
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
  normalizeCompilerEngineId,
  type CompilerEngineId,
  COMPILER_ENGINE_LIMITS,
} from "@shared/manhuaShotIR";
import {
  formatPromptForEngine,
  hasBlockingFormatIssues,
  type FormatIssue,
} from "@shared/promptFormatLayer";
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
  type ManhuaVoicePickPlan,
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

/** 客户端轮询上限：两轮合计须盖过 worker CANVAS_GPT_IMAGE2_DEFAULT_TIMEOUT_MS（0910 起 25min） */
const CANVAS_GPT_IMAGE2_POLL_MAX_MS = 13 * 60_000;

export type CanvasRunDeps = {
  /** 所有工厂/画布 clip 共用的服务端审核预检；返回元数据仍由服务端再次验证。 */
  authorizeManhuaClip?: (request: {
    episodeIndex: number; segmentIndex: number; videoModel: string; pilotRun: boolean; durationSec: number;
  }) => Promise<ManhuaPilotSubmission>;
  onManhuaPilotChanged?: () => void;
  /** 长排队任务创建即回写节点(taskId 持久化,刷新可恢复;审查 P1);缺省不回写 */
  onVideoTaskCreated?: (blockId: string, info: { taskId: string; engine: string }) => void;
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
  /**
   * D（0915）：生成意图落盘处。缺省用 window.localStorage；测试注入内存存储；
   * 显式传 null 表示本调用方不做意图登记（非产品路径）。
   */
  canvasIntentStorage?: CanvasIntentStorageLike | null;
  /** 意图创建 / 复用 / 状态变化时回调，供 UI 显示「提交中 / 核实中」等 */
  onCanvasIntentChanged?: (blockId: string, intent: CanvasGenerationIntent) => void;
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
  /** 段级导演板（段级为主、集级兜底）：集号 → 本集段号(1 起) → HTTPS */
  manhuaDirectorBoardUrlByEpisodeSegment?: Record<number, Record<number, string>> | null;
  /** 集号 → 段号 → 已确认的导演板矢量轨迹；与位图分开保存。 */
  manhuaDirectorBoardMotionOverlayByEpisodeSegment?: Record<
    number,
    Record<number, import("@shared/manhuaDirectorBoardOverlay").ManhuaBoardMotionOverlay>
  > | null;
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

/**
 * 把本机展示地址（blob: / local-media:）**先溯源回 https 原链**。
 *
 * 0915 审查实证的缺陷：`toHttpsImageUrls` 本来就会做这件事，
 * 但参考池在到它之前就按 `^https?://` 筛过一遍，
 * 回灌后的 blob:/local-media: 参考在筛选那一步就被静默丢掉了，
 * 于是「来源映射明明正确，却报缺图片」。
 *
 * 所以溯源必须发生在**筛选、去重、容量分配之前**。
 * 溯不回 https 的原样返回，交给后面的筛选照常拒绝——
 * 绝不把 blob: 直接发给供应商。
 */
function traceCanvasRefToHttpsSource(url: unknown): string {
  const u = String(url || "").trim();
  if (!u) return "";
  if (u.startsWith("blob:") || isLocalMediaPointer(u)) {
    return String(resolveUrlForCloudSync(u) || "").trim() || u;
  }
  return u;
}

/** 可提交的出站参考协议：https(s) 绝对链，或 data:image */
function isSubmittableRefUrl(url: string): boolean {
  return /^https?:\/\//i.test(url) || url.startsWith("data:image/");
}

/**
 * 参考地址规范化的**唯一顺序**（0915 复审要求，静帧/资产/导演板共用）：
 *   本机溯源 → 合法站内路径绝对化 → （调用方再做）协议校验 → 去重 → 容量/绑定规划
 *
 * 只在某一处补第二次转换是不够的：
 * 溯源可能得到 `/manhua-assets/x.png` 这类站内相对路径，
 * 不绝对化就会被紧接着的协议筛选当成非法地址丢掉（0915 复审 P2 实测）。
 */
function normalizeCanvasRefSource(url: unknown): string {
  const traced = traceCanvasRefToHttpsSource(url);
  if (!traced) return "";
  return String(absolutizeManhuaAssetUrl(traced) || traced).trim();
}

/**
 * 用户**显式选过**的参考，解析失败时不许静默丢掉。
 *
 * 0915 复审实测：只要还有另一张有效图，preview 就照常成功，
 * 那张解析不出来的引用凭空消失——用户看到的和实际发出的不是一回事。
 * 「引擎允许不带图」是另一回事，不能拿来替「已选的图可以丢」。
 *
 * 这里只对**存在但解析失败**的报错；本来就没有参考的合法文生视频不受影响。
 * 既不把 blob: 发出去，也不自动上传或重买兜底。
 */
function assertExplicitRefsResolvable(
  entries: Array<{ slotZh: string; raw: string; resolved: string }>,
): void {
  const broken = entries.filter(
    (e) => String(e.raw || "").trim() && !isSubmittableRefUrl(e.resolved),
  );
  if (!broken.length) return;
  const detail = broken
    .map((e) => `${e.slotZh}：${e.raw.slice(0, 80)}`)
    .join("；");
  throw new Error(
    `这些已选参考解析不到可提交的来源，本次未提交、未扣费：${detail}。` +
      `请重新选择或重新上传该参考（本机缓存地址无法直接发给生成方）。`,
  );
}

async function toHttpsImageUrls(
  deps: CanvasRunDeps,
  urls: string[],
): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < urls.length; i++) {
    let u = String(urls[i] || "").trim();
    if (!u) continue;
    // 回填后节点常见 blob:/local-media: 展示地址:先溯源到 https 原链再编译,
    // 否则这些参考会被静默丢掉(复审 P1-4)
    if (u.startsWith("blob:") || isLocalMediaPointer(u)) {
      const traced = resolveUrlForCloudSync(u);
      if (traced) u = traced;
      else continue;
    }
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
export async function runGptImage2(
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
    /** 官方模型档位；不传按开关（「双档」在单张入口按 flare） */
    openaiImageVariant?: OpenAiImageVariant;
  },
): Promise<string> {
  const refImageUrl = String(opts?.refImageUrl || "").trim();
  const extraRefs = (opts?.referenceImageUrls || []).map((u) => String(u || "").trim()).filter(Boolean);
  const referenceImageUrls = Array.from(new Set([refImageUrl, ...extraRefs].filter(Boolean))).slice(0, 16);
  const maskUrl = String(opts?.maskUrl || "").trim();
  const openaiOnly = Boolean(opts?.openaiOnly);
  const userId = String(opts?.userId || "");

  /**
   * 六审第4条:只创建一次 job。超时不再第二次入队(那会再打一次付费上游),
   * 只对同一 jobId 继续轮询——上一轮可能只是慢,任务仍在 worker 里跑。
   */
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
            openaiImageVariant: opts?.openaiImageVariant ?? readOpenAiImageVariantPref(),
      batchIndex: opts?.batchIndex,
    }),
  });

  let job: Awaited<ReturnType<typeof pollJobUntilTerminal>>;
  try {
    job = await pollJobUntilTerminal(jobId, {
      maxWaitMs: CANVAS_GPT_IMAGE2_POLL_MAX_MS,
      intervalMs: 2500,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!isOpenAiImageTimeoutError(message)) throw error;
    console.warn("[canvasRunBlock] 轮询超时，继续查询同一任务（绝不重新调用图片上游）");
    job = await pollJobUntilTerminal(jobId, {
      maxWaitMs: CANVAS_GPT_IMAGE2_POLL_MAX_MS,
      intervalMs: 5000,
    });
  }

  if (job.status !== "succeeded") {
    throw new Error(job.error || "GPT-Image-2 生图失败");
  }
  const out = (job.output || {}) as { imageUrl?: string; imageUrls?: string[] };
  const url = String(out.imageUrl || out.imageUrls?.[0] || "").trim();
  if (!url) throw new Error("GPT-Image-2 未返回图片 URL");
  return url;
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
  // 开关「双档各一张」：每张各出 flare 与 sunburst 两个版本（扣两张费），顺序 flare 在前便于对比
  const variants: OpenAiImageVariant[] =
    readOpenAiImageVariantMode() === "both" ? ["flare", "sunburst"] : [readOpenAiImageVariantPref()];
  // 双档的两张各按本张的批次号计费（都算「第 i 张」），不让 sunburst 那张滑到批量价
  const tasks = Array.from({ length: count }, (_unused, i) =>
    variants.map((openaiImageVariant) =>
      runGptImage2(prompt, aspectRatio, { ...opts, batchIndex: i, openaiImageVariant }),
    ),
  ).flat();
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
  opts?: { timeoutMs?: number },
): Promise<{ videoUrl: string; workMode?: SeedanceEvolinkMode }> {
  const statusEndpoint = withLongJobsFlyDirect(
    `/api/jobs?op=canvasVideoStatus&taskId=${encodeURIComponent(taskId)}`,
  );
  // 轮询期限按引擎传入:Wan 公测排队以小时计,写死 20 分钟会把活任务误报成失败(审查 P1)
  const deadline = Date.now() + Math.max(60_000, Number(opts?.timeoutMs) || 20 * 60_000);
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
 * 服务端 202「同一次生成正在创建中」：**不是失败，也不是新单入口**。
 * 按意图轮询 canvasIntentStatus 直到任务号出现；只有「意图不存在」才当失败。
 * 503（记录读不出来）继续核实，不当失败——那正是禁止自动重建的场景。
 */
async function awaitCanvasIntentTaskId(intentId: string, opts?: { timeoutMs?: number }): Promise<string> {
  const endpoint = withLongJobsFlyDirect(
    `/api/jobs?op=canvasIntentStatus&intentId=${encodeURIComponent(intentId)}`,
  );
  const deadline = Date.now() + Math.max(30_000, Number(opts?.timeoutMs) || 3 * 60_000);
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3_000));
    const r = await fetch(endpoint, { method: "GET", credentials: "include", cache: "no-store" });
    const raw = await r.text();
    let j: { ok?: boolean; pending?: boolean; taskId?: string; code?: string; error?: string } = {};
    try {
      j = JSON.parse(raw) as typeof j;
    } catch {
      continue;
    }
    if (r.status === 404 && j.code === "intent_not_found") {
      throw new Error("这次生成没有留下记录，本次未建单；请重新查看生成前确认后再试");
    }
    if (!r.ok || !j.ok) continue;
    if (j.pending === false && j.taskId) return String(j.taskId);
  }
  throw new Error("这次生成仍在核实中，未重复提交；请稍后刷新查看，不要再次点击生成");
}

/** 响应是 202 / pending 时按意图等任务号；否则返回 null 让 runner 走原路径 */
async function resolvePendingCanvasIntentTaskId(
  res: { status: number },
  json: { pending?: boolean; intentId?: string },
): Promise<string | null> {
  if (!(res.status === 202 || json.pending === true)) return null;
  const intentId = String(json.intentId || "").trim();
  if (!intentId) throw new Error("服务端返回创建中但没有意图编号，未重复提交；请稍后刷新查看");
  return awaitCanvasIntentTaskId(intentId);
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

/**
 * 成片提示词唯一出站编译器：只做确定性方言转换与硬校验，不发请求、不扣费。
 * 生产路径禁用敏感词静默替换，避免对白与剧情在用户不知情时被改写。
 */
export type ManhuaOutboundPromptCompileInput = {
  prompt: string;
  engine: CompilerEngineId | string;
  durationSec?: number;
  imageRefCount?: number;
  videoRefCount?: number;
  audioRefCount?: number;
};

export type ManhuaOutboundPromptCompileResult = {
  /** 真正会发出去的提示词全文；blocked 时仍给出，便于确认界面指出问题所在 */
  text: string;
  issues: FormatIssue[];
  /** true = 出站校验不通过，生产路径会抛错、不建单不扣费 */
  blocked: boolean;
  /** 引擎缺编译规则这类连编译都进不去的情况 */
  fatalZh?: string;
  engine?: CompilerEngineId;
};

/**
 * 出站提示词编译（**不抛错**版本）。
 *
 * 生成前确认界面要展示的必须是这一份——节点上存的 prompt 与真正发出去的不是同一个串：
 * Seedance 会先过 renderManhuaClipPromptForSeedance，再按引擎/时长/参考数量重排格式，
 * 出口还要把 @图N 还原成 @图片N。预览与下单共用本函数，避免两套逻辑各自漂移。
 */
export function tryCompileManhuaVideoPromptForOutbound(
  input: ManhuaOutboundPromptCompileInput,
): ManhuaOutboundPromptCompileResult {
  const engine = normalizeCompilerEngineId(input.engine);
  if (!engine) {
    return {
      text: String(input.prompt || ""),
      issues: [],
      blocked: true,
      fatalZh: "当前成片引擎缺少提示词编译规则",
    };
  }
  // 按**方言**判定，不按 id 前缀：HappyHorse 登记为 seedance 方言
  // （生产一直送 Seedance 渲染器的产物），id 却不以 seedance- 开头。
  const usesSeedanceDialect = COMPILER_ENGINE_LIMITS[engine].dialect === "seedance";
  const seedanceSource = usesSeedanceDialect
    ? renderManhuaClipPromptForSeedance(input.prompt)
    : input.prompt;
  const formatted = formatPromptForEngine(seedanceSource, engine, {
    durationSec: input.durationSec,
    imageRefCount: input.imageRefCount,
    videoRefCount: input.videoRefCount,
    audioRefCount: input.audioRefCount,
    applyCensorReplacements: false,
  });
  // 生产绑定层按官方素材类型标记生成 @图片N；格式层内部统一成 @图N 后在出口还原。
  const text = usesSeedanceDialect
    ? formatted.text.replace(/@图(\d+)/g, "@图片$1")
    : formatted.text;
  return {
    text,
    issues: formatted.issues,
    blocked: hasBlockingFormatIssues(formatted.issues),
    engine,
  };
}

export function compileManhuaVideoPromptForOutbound(
  input: ManhuaOutboundPromptCompileInput,
): string {
  const result = tryCompileManhuaVideoPromptForOutbound(input);
  if (result.fatalZh) throw new Error(result.fatalZh);
  if (result.blocked) {
    throw new Error(
      `成片提示词未通过出站校验：${result.issues.map((issue) => issue.detailZh).join("；")}`,
    );
  }
  return result.text;
}

/**
 * 编译未通过就抛，**错误文案与 {@link compileManhuaVideoPromptForOutbound} 完全一致**。
 * 各引擎的薄包装共用它，免得每处各写一句笼统的「编译未通过」，
 * 把「参考图上限 10」这类说得清的原因吞掉。
 */
function throwIfOutboundCompileBlocked(result: ManhuaOutboundPromptCompileResult): void {
  if (result.fatalZh) throw new Error(result.fatalZh);
  if (result.blocked) {
    throw new Error(
      `成片提示词未通过出站校验：${result.issues.map((issue) => issue.detailZh).join("；")}`,
    );
  }
}

/** 段级绑定与最终取图共用同一上限，防止 2.5 在任一前置层退回 9。 */
export function resolveManhuaCanvasVideoImageReferenceMax(videoModelRaw: unknown): number {
  const videoModel = normalizeCanvasVideoModel(videoModelRaw);
  if (isCanvasHappyHorseVideoModel(videoModel)) return HAPPYHORSE_REFERENCE_MAX.image;
  if (isCanvasHailuoH3VideoModel(videoModel)) return HAILUO_REFERENCE_MAX.image;
  if (isCanvasWan30VideoModel(videoModel)) return WAN30_REFERENCE_MAX.image;
  if (videoModel === "seedance-2.5") return SEEDANCE_25_REFERENCE_MAX.image;
  return SEEDANCE_REFERENCE_MAX.image;
}

export type SeedanceCanvasRequestOptions = {
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
    manhuaPilot?: ManhuaPilotSubmission;
    idempotencyKey?: string;
    /** 生成意图 ID（与 idempotencyKey 同值）；服务端按它做扣费前裁决 */
    intentId?: string;
};

/**
 * 各引擎出站准备的**统一形状**。Seedance / 海螺 H3 / Wan 3.0 的准备器都返回它，
 * 于是「算指纹、比对确认、回卷预览」只需要一处实现（见 settleManhuaOutbound），
 * 不必每加一个引擎就抄一遍格式规则——上一轮审查点名的就是这种抄第二套。
 */
export type CanvasEngineOutboundPreparation = {
  engine: string;
  /** 真正 POST 出去的请求体 */
  body: Record<string, unknown>;
  compile: ManhuaOutboundPromptCompileResult;
  durationSec: number;
  refCounts: { image: number; video: number; audio: number };
  refSlots: { imageUrls: string[]; videoUrls: string[]; audioUrls: string[] };
};

export type SeedanceCanvasRequestPreview = {
  /** 真正 POST 出去的请求体；预览与下单取同一份，不另造一套 */
  body: Record<string, unknown>;
  /** 出站编译结果（含未通过原因）；blocked 时生产路径会抛错、不建单不扣费 */
  compile: ManhuaOutboundPromptCompileResult;
  version: "2.0-mini" | "2.0" | "2.0-fast" | "2.5";
  durationSec: number;
  /** 去重后的真实参考数量，与编译入参同源 */
  refCounts: { image: number; video: number; audio: number };
  /** 最终槽位表：与 refCounts 同源的有序清单，UI 按它编号 @图片N */
  refSlots: { imageUrls: string[]; videoUrls: string[]; audioUrls: string[] };
};

/**
 * Seedance 出站请求体构造（**纯函数，无副作用、不发请求**）。
 *
 * 与 buildHailuo3CanvasRequestBody / buildWan30RequestBody 同一模式。
 * 抽出来是为了让「生成前确认」能拿到与真正提交**逐字段相同**的内容：
 * 引擎、时长钳制、去重后的参考数量都在这里算，预览不得自己猜默认值。
 */
export function buildSeedanceCanvasRequestBody(
  prompt: string,
  imageUrl: string | undefined,
  aspectRatio: "9:16" | "16:9",
  opts?: SeedanceCanvasRequestOptions,
): SeedanceCanvasRequestPreview {
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
  const workMode =
    version === "2.5"
      ? normalizeSeedance25EvolinkMode(opts?.workMode, { imageUrls, videoUrls, audioUrls })
      : undefined;
  const episodeIndex = Number(opts?.episodeIndex);
  const clipIndex = Number(opts?.clipIndex);
  const compilerEngine: CompilerEngineId = `seedance-${version}`;
  // 最终槽位表：首帧与 imageUrls 去重后的**有序**清单。
  // 首帧常常已经在 imageUrls 里，先前把它再算一格会让 UI 显示的参考编号比实际多一个。
  // refCounts 与编译入参、与这张表同源，UI 直接用它编号。
  const orderedImageSlots: string[] = [];
  for (const candidate of [imageUrl, ...imageUrls]) {
    const url = String(candidate || "").trim();
    if (url && !orderedImageSlots.includes(url)) orderedImageSlots.push(url);
  }
  const refCounts = {
    image: orderedImageSlots.length,
    video: videoUrls.length,
    audio: audioUrls.length,
  };
  const compile = tryCompileManhuaVideoPromptForOutbound({
    prompt,
    engine: compilerEngine,
    durationSec: duration,
    imageRefCount: refCounts.image,
    videoRefCount: refCounts.video,
    audioRefCount: refCounts.audio,
  });
  const body: Record<string, unknown> = {
    // 方言与引用上限只在出线这一刻统一把关；上面的时长解析仍认【第N段·Xs】。
    prompt: compile.text,
    imageUrl: imageUrl || imageUrls[0] || undefined,
    // 配额按版本分流：2.5 官方收图 30/视频 10/音频 10，2.0 系 9/3/3。
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
    ...(opts?.manhuaPilot ? { manhuaPilot: opts.manhuaPilot } : {}),
    ...(opts?.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : {}),
    ...(opts?.intentId ? { intentId: opts.intentId } : {}),
    ...(version === "2.5" ? { workMode } : {}),
    ...(Number.isFinite(episodeIndex) && episodeIndex > 0 ? { episodeIndex } : {}),
    ...(Number.isFinite(clipIndex) && clipIndex > 0 ? { clipIndex } : {}),
  };
  return {
    body,
    compile,
    version,
    durationSec: duration,
    refCounts,
    refSlots: {
      imageUrls: orderedImageSlots,
      videoUrls: [...videoUrls],
      audioUrls: [...audioUrls],
    },
  };
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
    manhuaPilot?: ManhuaPilotSubmission;
    idempotencyKey?: string;
    /** 生成意图 ID（与 idempotencyKey 同值）；服务端按它做扣费前裁决 */
    intentId?: string;
    onTaskId?: (taskId: string) => void;
    /** 健康门等待结束、fetch 紧前的最终核对 */
    beforeSubmit?: OutboundSubmitGuard;
  },
): Promise<SeedanceProductVideoResult> {
  // 与 Creative / TestLab 一致：直连 Fly/api 子域，避免 www→Vercel→Fly 反代 ~120s 被 ROUTER_EXTERNAL 腰斩
  const seedanceUrl = withLongJobsFlyDirect("/api/jobs?op=seedanceI2V");
  const probeOrigin = flyHealthProbeOriginForUrl(seedanceUrl);
  // 请求体由纯构造函数产出，生成前确认界面调的是同一个函数——预览与出站不会各走一套。
  const prepared = buildSeedanceCanvasRequestBody(prompt, imageUrl, aspectRatio, opts);
  if (prepared.compile.fatalZh) throw new Error(prepared.compile.fatalZh);
  if (prepared.compile.blocked) {
    throw new Error(
      `成片提示词未通过出站校验：${prepared.compile.issues
        .map((issue) => issue.detailZh)
        .join("；")}`,
    );
  }
  const res = await withFlyHealthGate(probeOrigin, () => {
    // 健康等待已结束；这里到 fetch 之间不得再 await（0914 复审 P1）
    opts?.beforeSubmit?.();
    return fetch(seedanceUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(prepared.body),
    });
  });
  const text = await res.text();
  let json: {
    videoUrl?: string;
    error?: string;
    message?: string;
    ok?: boolean;
    async?: boolean;
    taskId?: string;
    workMode?: SeedanceEvolinkMode;
    pending?: boolean;
    intentId?: string;
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
  const pendingTaskId = await resolvePendingCanvasIntentTaskId(res, json);
  if (pendingTaskId) {
    opts?.onTaskId?.(pendingTaskId);
    const polled = await pollCanvasVideoTask(pendingTaskId);
    return { videoUrl: polled.videoUrl, workMode: polled.workMode };
  }
  if (!res.ok || !json.ok) {
    throw new Error(json.error || json.message || "成片生成失败");
  }
  if (json.taskId) opts?.onTaskId?.(json.taskId);
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

export type Hailuo3CanvasRequestInput = {
  prompt: string;
  imageUrl?: string;
  imageUrls?: string[];
  aspectRatio: "9:16" | "16:9";
  duration?: number;
  resolution?: string;
  episodeIndex?: number;
  clipIndex?: number;
  manhuaPilot?: ManhuaPilotSubmission;
  idempotencyKey?: string;
  /** 生成意图 ID（与 idempotencyKey 同值）；服务端按它做扣费前裁决 */
  intentId?: string;
};

/**
 * 海螺 H3 出站准备（**纯函数、不发请求**）。与 Seedance 的准备器同形：
 * 同一份去重、同一次时长钳制、同一个编译，预览与真正提交取同一份结果。
 *
 * 拆成「准备 + 薄包装」是 C 项要求：预览要能拿到编译未通过的原因**而不是被抛出去**，
 * 所以准备用不抛的 tryCompile，抛错留给下面那个薄包装（既有调用方契约不变）。
 */
export function prepareHailuo3CanvasOutbound(
  input: Hailuo3CanvasRequestInput,
): CanvasEngineOutboundPreparation {
  const imageUrls = Array.from(
    new Set(
      [input.imageUrl, ...(input.imageUrls || [])]
        .map((url) => String(url || "").trim())
        .filter(Boolean),
    ),
  );
  const duration = clampHailuoOpenRouterDuration(input.duration);
  const compile = tryCompileManhuaVideoPromptForOutbound({
    prompt: input.prompt,
    engine: "minimax-hailuo-3",
    durationSec: duration,
    imageRefCount: imageUrls.length,
    videoRefCount: 0,
    audioRefCount: 0,
  });
  const body: Record<string, unknown> = {
    prompt: compile.text,
    imageUrl: imageUrls[0] || undefined,
    imageUrls: imageUrls.length ? imageUrls : undefined,
    aspectRatio: input.aspectRatio,
    duration,
    resolution: input.resolution,
    generateAudio: true,
    ...(input.manhuaPilot ? { manhuaPilot: input.manhuaPilot } : {}),
    ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    ...(input.intentId ? { intentId: input.intentId } : {}),
    ...(Number(input.episodeIndex) > 0 ? { episodeIndex: Number(input.episodeIndex) } : {}),
    ...(Number(input.clipIndex) > 0 ? { clipIndex: Number(input.clipIndex) } : {}),
  };
  return {
    engine: "minimax-hailuo-3",
    body,
    compile,
    durationSec: duration,
    refCounts: { image: imageUrls.length, video: 0, audio: 0 },
    refSlots: { imageUrls: [...imageUrls], videoUrls: [], audioUrls: [] },
  };
}

/** 旧契约：只要请求体，编译未通过就抛。内部走同一个准备器，不另算一套。 */
export function buildHailuo3CanvasRequestBody(
  input: Hailuo3CanvasRequestInput,
): Record<string, unknown> {
  const prepared = prepareHailuo3CanvasOutbound(input);
  throwIfOutboundCompileBlocked(prepared.compile);
  return prepared.body;
}

/** MiniMax H3 · OpenRouter（画质由服务端归一；时长 5–15s） */
async function runHailuo3(
  prompt: string,
  imageUrl: string | undefined,
  aspectRatio: "9:16" | "16:9",
  opts?: {
    imageUrls?: string[];
    duration?: number;
    resolution?: string;
    /** 漫剧集号／段号：服务端据此走整集折算段价 */
    episodeIndex?: number;
    clipIndex?: number;
    manhuaPilot?: ManhuaPilotSubmission;
    idempotencyKey?: string;
    /** 生成意图 ID（与 idempotencyKey 同值）；服务端按它做扣费前裁决 */
    intentId?: string;
    onTaskId?: (taskId: string) => void;
    /** 健康门等待结束、fetch 紧前的最终核对 */
    beforeSubmit?: OutboundSubmitGuard;
  },
): Promise<string> {
  const hailuoUrl = withLongJobsFlyDirect("/api/jobs?op=hailuo3Video");
  const probeOrigin = flyHealthProbeOriginForUrl(hailuoUrl);
  const requestBody = buildHailuo3CanvasRequestBody({
    prompt,
    imageUrl,
    imageUrls: opts?.imageUrls,
    aspectRatio,
    duration: opts?.duration,
    resolution: opts?.resolution,
    episodeIndex: opts?.episodeIndex,
    clipIndex: opts?.clipIndex,
    manhuaPilot: opts?.manhuaPilot,
    idempotencyKey: opts?.idempotencyKey,
    intentId: opts?.intentId,
  });
  const res = await withFlyHealthGate(probeOrigin, () => {
    opts?.beforeSubmit?.();
    return fetch(hailuoUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // 服务端已要求登录（H3 成片会真实扣费），必须带上登录态。
      credentials: "include",
      body: JSON.stringify(requestBody),
    });
  });
  const text = await res.text();
  let json: {
    videoUrl?: string;
    error?: string;
    message?: string;
    ok?: boolean;
    async?: boolean;
    taskId?: string;
    pending?: boolean;
    intentId?: string;
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
  const pendingTaskId = await resolvePendingCanvasIntentTaskId(res, json);
  if (pendingTaskId) {
    opts?.onTaskId?.(pendingTaskId);
    return (await pollCanvasVideoTask(pendingTaskId)).videoUrl;
  }
  if (!res.ok || !json.ok) {
    throw new Error(json.error || json.message || "成片生成失败");
  }
  if (json.taskId) opts?.onTaskId?.(json.taskId);
  if (json.videoUrl) return String(json.videoUrl);
  if (json.taskId) {
    const polled = await pollCanvasVideoTask(json.taskId);
    return polled.videoUrl;
  }
  throw new Error(json.error || json.message || "成片生成失败");
}

/**
 * Wan 参考图职责表:Wan 没有 @图片N 绑定语法,按数组顺序用自然语言声明每张图的唯一职责。
 * 复审 P1-5:必须吃满 bind plan 元数据——导演板只管构图运镜绝不锁脸;
 * 定妆按 duty 分 identity(只锁脸)/look(只锁服化),并点名 labelZh/roleTag;静帧带秒段。
 */
export function buildWanReferenceRoleBlock(
  images: string[],
  entries: Array<{
    url: string;
    kind?: string;
    roleTag?: string;
    labelZh?: string;
    duty?: "identity" | "look" | null;
    slotZh?: string | null;
  }>,
): string {
  if (!images.length) return "";
  const lines = images.map((u, i) => {
    const e = entries.find((x) => x.url === u);
    const who = String(e?.labelZh || e?.roleTag || "").trim();
    let role: string;
    switch (e?.kind) {
      case "tail":
        role = "上一段末帧,仅作起幅衔接参考,不继承其中文字与瑕疵,不锁定任何身份";
        break;
      case "still":
        role = `本段关键静帧${e?.slotZh ? `(${e.slotZh})` : ""},锁定构图与动作结果`;
        break;
      case "board":
        role = "导演板,只提供构图、运镜与动作路径参考,禁止用它锁定人物长相或服装";
        break;
      case "asset": {
        // 三审 P1-2:类型判别只认 roleTag(@场景1/@道具1/@服装1/@角色1),
        // labelZh 只是显示名——「断月桥」不含"场景"二字,靠名字猜必错。
        const tag = String(e?.roleTag || "");
        if (/^@?(场景|背景)/.test(tag)) {
          role = `${who ? `「${who}」` : ""}场景参考,只锁空间、光色与布景,不锁定任何人物`;
        } else if (/^@?道具/.test(tag)) {
          role = `${who ? `「${who}」` : ""}道具参考,只锁该物件形态,不锁定任何人物`;
        } else if (e?.duty === "look" || /^@?(服装|妆造)/.test(tag)) {
          role = `${who ? `「${who}」的` : ""}服装/妆造参考,只锁服化,不改脸型`;
        } else {
          role = `${who ? `「${who}」的` : ""}人物定妆参考,只锁脸部身份特征,不继承背景、文字或无关元素`;
        }
        break;
      }
      default:
        role = "参考图,只继承与画面直接相关的元素,不继承背景文字与无关人物";
    }
    return `Reference image ${i + 1}:${role}`;
  });
  return `【参考图职责】\n${lines.join("\n")}\n每张参考图只承担上述唯一职责,人物身份必须与对应人物定妆图完全一致,禁止串位、换脸、混合身份。`;
}

/** Wan 参考视频只接收真实 HTTP(S) 地址；保序去重但不截断，超限交出站编译器阻断。 */
export function resolveWan30CanvasVideoUrls(input: {
  selectedVideoUrls?: string[];
  continuityVideoUrl?: string;
}): string[] {
  return Array.from(
    new Set(
      [...(input.selectedVideoUrls || []), input.continuityVideoUrl]
        .map((url) => String(url || "").trim())
        .filter((url) => /^https?:\/\//i.test(url)),
    ),
  );
}

/** 与 videoUrls 数组同序生成唯一职责，保证 Reference video N 不悬空、不串位。 */
export function buildWanVideoReferenceRoleBlock(
  videoUrls: string[],
  opts?: { continuityVideoUrl?: string; previsVideoUrl?: string; motionGuideZh?: string },
): string {
  if (!videoUrls.length) return "";
  const continuity = String(opts?.continuityVideoUrl || "").trim();
  const previs = String(opts?.previsVideoUrl || "").trim();
  const lines = videoUrls.map((url, index) =>
    previs && url === previs
      ? `Reference video ${index + 1}:本段站位白模，严格按它的秒位复刻人物走位、景别切换与机位运动；灰色人偶、空白场景与网格不进画面，外观只按参考图与正文`
      : url === continuity
        ? `Reference video ${index + 1}:上一段成片，仅用于承接起幅、人物状态与空间连续性`
        : `Reference video ${index + 1}:用户选定的视频参考，仅继承明确相关的动作、节奏或镜头信息`,
  );
  return `【参考视频职责】\n${lines.join("\n")}\n每条参考视频只承担上述职责，禁止把无关人物、服装、文字或背景迁移到本段。${previs && opts?.motionGuideZh ? `\n【白模动作】${opts.motionGuideZh}` : ""}`;
}

/** Wan 音频职责与实际 audioUrls 同序编号；相同声样供多人共用时合并点名。 */
export function buildWanAudioReferenceRoleBlock(
  audioUrls: string[],
  attached: ManhuaVoicePickPlan["attached"],
  opts?: { accentFallbackUrl?: string; masterAudioUrl?: string },
): string {
  if (!audioUrls.length) return "";
  const accentFallbackUrl = String(opts?.accentFallbackUrl || "").trim();
  const masterAudioUrl = String(opts?.masterAudioUrl || "").trim();
  const lines = audioUrls.map((url, index) => {
    if (masterAudioUrl && url === masterAudioUrl) {
      return `Reference audio ${index + 1}:本片最终音轨，对白与配乐已预混；口型与动作逐秒同步，不再另配对白、配乐或旁白`;
    }
    const speakers = attached
      .filter((item) => item.audioUrl === url)
      .map((item) => String(item.labelZh || item.characterTag || "").trim())
      .filter((label, itemIndex, all) => Boolean(label) && all.indexOf(label) === itemIndex);
    const role = speakers.length
      ? `${speakers.join("、")}的角色声线，仅锁定对应人物的音色、口音与发声质感，禁止串给其他角色`
      : url === accentFallbackUrl
        ? "全片对白口音基准，仅统一口音方向，不替代角色专属声线"
        : "对白音色参考，仅继承与本段说话人直接相关的声音特征";
    return `Reference audio ${index + 1}:${role}`;
  });
  return `【参考音频职责】\n${lines.join("\n")}\n每条参考音频只承担上述职责，禁止交换说话人或把一种声线套给全部角色。`;
}

/**
 * 单次用户提交 ID(复审 P0-2):每次点击生成都必须换新键。
 * 内容散列键的坑:上一单 failed 已退款后,同内容重跑会命中旧扣费记录(alreadyCharged),
 * 却再次真金白银打上游 = 免费重跑计费漏洞。改为一次提交一键:
 * 同一次 POST 的传输层重试天然复用同一请求;用户再点一次 = 新键 = 重新扣费。
 */
export function newWanSubmissionKey(blockId: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 16)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `wan30_${blockId.replace(/[^0-9a-zA-Z_-]/g, "").slice(0, 40)}_${rand}`;
}

/** Wan 请求体构建器:抽出为纯函数,让测试能断言真实 POST 载荷(三审 P0-1) */
export type Wan30RequestInput = {
  prompt: string;
  images: string[];
  aspectRatio: "9:16" | "16:9";
  videoUrls?: string[];
  audioUrls?: string[];
  duration?: number;
  resolution?: string;
  episodeIndex?: number;
  clipIndex?: number;
  idempotencyKey?: string;
  /** 生成意图 ID（与 idempotencyKey 同值）；服务端按它做扣费前裁决 */
  intentId?: string;
  manhuaPilot?: ManhuaPilotSubmission;
  seed?: number;
};

/** Wan 3.0 出站准备（**纯函数、不发请求**）。同 {@link prepareHailuo3CanvasOutbound}。 */
export function prepareWan30Outbound(
  input: Wan30RequestInput,
): CanvasEngineOutboundPreparation {
  const images = Array.from(
    new Set(input.images.map((url) => String(url || "").trim()).filter(Boolean)),
  );
  const audioUrls = Array.from(
    new Set((input.audioUrls || []).map((url) => String(url || "").trim()).filter(Boolean)),
  );
  const videoUrls = Array.from(
    new Set((input.videoUrls || []).map((url) => String(url || "").trim()).filter(Boolean)),
  );
  const duration = clampWan30Duration(input.duration);
  const compile = tryCompileManhuaVideoPromptForOutbound({
    prompt: input.prompt,
    engine: "wan-3.0",
    durationSec: duration,
    imageRefCount: images.length,
    videoRefCount: videoUrls.length,
    audioRefCount: audioUrls.length,
  });
  const body: Record<string, unknown> = {
    prompt: compile.text,
    imageUrl: images[0],
    imageUrls: images,
    videoUrls,
    audioUrls,
    aspectRatio: input.aspectRatio,
    duration,
    resolution: input.resolution || "720p",
    generateAudio: true,
    ...(Number(input.episodeIndex) > 0 ? { episodeIndex: Number(input.episodeIndex) } : {}),
    ...(Number(input.clipIndex) > 0 ? { clipIndex: Number(input.clipIndex) } : {}),
    ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    ...(input.intentId ? { intentId: input.intentId } : {}),
    ...(input.manhuaPilot ? { manhuaPilot: input.manhuaPilot } : {}),
    ...(Number.isFinite(Number(input.seed)) ? { seed: Math.floor(Number(input.seed)) } : {}),
  };
  return {
    engine: "wan-3.0",
    body,
    compile,
    durationSec: duration,
    refCounts: { image: images.length, video: videoUrls.length, audio: audioUrls.length },
    refSlots: {
      imageUrls: [...images],
      videoUrls: [...videoUrls],
      audioUrls: [...audioUrls],
    },
  };
}

/** 旧契约：只要请求体，编译未通过就抛。内部走同一个准备器，不另算一套。 */
export function buildWan30RequestBody(input: Wan30RequestInput): Record<string, unknown> {
  const prepared = prepareWan30Outbound(input);
  throwIfOutboundCompileBlocked(prepared.compile);
  return prepared.body;
}

/** Wan 3.0（公测）· WaveSpeed reference-to-video：可直出 30s；公测排队时间较长 */
async function runWan30(
  prompt: string,
  imageUrls: string[],
  aspectRatio: "9:16" | "16:9",
  opts?: {
    videoUrls?: string[];
    audioUrls?: string[];
    duration?: number;
    resolution?: string;
    episodeIndex?: number;
    clipIndex?: number;
    /** 稳定幂等键:同节点同内容重试复用同键,防双击双扣费(审查 P1) */
    idempotencyKey?: string;
    /** 生成意图 ID（与 idempotencyKey 同值）；服务端按它做扣费前裁决 */
    intentId?: string;
    manhuaPilot?: ManhuaPilotSubmission;
    seed?: number;
    /** 拿到 taskId 立即回调(先持久化再慢慢轮询) */
    onTaskId?: (taskId: string) => void;
    /** 健康门等待结束、fetch 紧前的最终核对 */
    beforeSubmit?: OutboundSubmitGuard;
  },
): Promise<string> {
  const wanUrl = withLongJobsFlyDirect("/api/jobs?op=wan30Video");
  const probeOrigin = flyHealthProbeOriginForUrl(wanUrl);
  const images = imageUrls.map((u) => String(u || "").trim()).filter(Boolean);
  if (!images.length) {
    throw new Error("Wan 3.0 成片需要至少一张参考图（请先出静帧或上传参考）");
  }
  // 载荷统一走 buildWan30RequestBody：提交键/seed 必须真实入 POST（三审 P0-1）。
  // 先构造好再进健康门，核对与 fetch 之间不留任何计算。
  const wanBody = buildWan30RequestBody({
    // Wan 无 Seedance 的 @图片N 硬绑定语法，提示词由调用方按 Wan 口径编译，不过 Seedance 渲染器
    prompt,
    images,
    aspectRatio,
    videoUrls: opts?.videoUrls,
    audioUrls: opts?.audioUrls,
    duration: opts?.duration,
    resolution: opts?.resolution,
    episodeIndex: opts?.episodeIndex,
    clipIndex: opts?.clipIndex,
    idempotencyKey: opts?.idempotencyKey,
    intentId: opts?.intentId,
    manhuaPilot: opts?.manhuaPilot,
    seed: opts?.seed,
  });
  const res = await withFlyHealthGate(probeOrigin, () => {
    opts?.beforeSubmit?.();
    return fetch(wanUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(wanBody),
    });
  });
  const text = await res.text();
  let json: {
    videoUrl?: string;
    error?: string;
    message?: string;
    ok?: boolean;
    async?: boolean;
    taskId?: string;
    pending?: boolean;
    intentId?: string;
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
  const pendingTaskId = await resolvePendingCanvasIntentTaskId(res, json);
  if (pendingTaskId) {
    try {
      opts?.onTaskId?.(pendingTaskId);
    } catch {
      /* 回写失败不阻塞生成 */
    }
    return (await pollCanvasVideoTask(pendingTaskId, { timeoutMs: 200 * 60_000 })).videoUrl;
  }
  if (!res.ok || !json.ok) {
    throw new Error(json.error || json.message || "成片生成失败");
  }
  if (json.taskId) {
    try {
      opts?.onTaskId?.(String(json.taskId));
    } catch {
      /* 回写失败不阻塞生成 */
    }
  }
  if (json.videoUrl) return String(json.videoUrl);
  if (json.taskId) {
    try {
      // Wan 公测排队以小时计:前端轮询期限对齐后端(3h)+缓冲
      const polled = await pollCanvasVideoTask(json.taskId, { timeoutMs: 200 * 60_000 });
      return polled.videoUrl;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // 不把仍在跑的任务谎报成失败:把单号交给用户,后端照常生成与对账
      throw new Error(`${msg}(任务仍在后台生成,单号 ${json.taskId},勿重复提交)`);
    }
  }
  throw new Error(json.error || json.message || "成片生成失败");
}

export type HappyHorseRequestInput = {
  prompt: string;
  imageUrl: string;
  aspectRatio: "9:16" | "16:9";
  duration?: number;
  resolution?: string;
  episodeIndex?: number;
  clipIndex?: number;
  imageUrls?: string[];
  /** G2 补键：HappyHorse 此前不带幂等键，同内容重发会出两单 */
  idempotencyKey?: string;
  intentId?: string;
};

/**
 * HappyHorse 出站准备（**纯函数、不发请求**）。同其余引擎的准备器。
 *
 * 它原本只有 runHappyHorse 里内联的 body，没有可复用的构造层，
 * 于是成了确认闸的免检通道（0914 审查 P1：未支持模式仍是免检通道）。
 * 这里把 body 抽出来，提交点与预览共用。
 */
export function prepareHappyHorseOutbound(
  input: HappyHorseRequestInput,
): CanvasEngineOutboundPreparation {
  const imageUrls = Array.from(
    new Set(
      [input.imageUrl, ...(input.imageUrls || [])]
        .map((url) => String(url || "").trim())
        .filter(Boolean),
    ),
  ).slice(0, HAPPYHORSE_REFERENCE_MAX.image);
  const duration = clampHappyHorseCanvasDuration(input.duration);
  const resolution = normalizeHappyHorseCanvasResolution(input.resolution);
  const compile = tryCompileManhuaVideoPromptForOutbound({
    prompt: input.prompt,
    engine: CANVAS_VIDEO_MODEL_HAPPYHORSE_1_1,
    durationSec: duration,
    imageRefCount: imageUrls.length,
    videoRefCount: 0,
    audioRefCount: 0,
  });
  const body: Record<string, unknown> = {
    prompt: compile.text,
    imageUrl: input.imageUrl,
    ...(imageUrls.length ? { imageUrls } : {}),
    aspectRatio: input.aspectRatio,
    duration,
    resolution,
    ...(Number(input.episodeIndex) > 0 ? { episodeIndex: Number(input.episodeIndex) } : {}),
    ...(Number(input.clipIndex) > 0 ? { clipIndex: Number(input.clipIndex) } : {}),
    ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    ...(input.intentId ? { intentId: input.intentId } : {}),
  };
  return {
    engine: CANVAS_VIDEO_MODEL_HAPPYHORSE_1_1,
    body,
    compile,
    durationSec: duration,
    refCounts: { image: imageUrls.length, video: 0, audio: 0 },
    refSlots: { imageUrls: [...imageUrls], videoUrls: [], audioUrls: [] },
  };
}

/**
 * Happy Horse 1.1 · OpenRouter（首帧图生；时长 5/10/15，最长 15s）
 *
 * **只负责提交**：请求体由 {@link prepareHappyHorseOutbound} 产出并原样序列化。
 * 上一版这里另有一套内联构造（自行 renderManhuaClipPromptForSeedance），
 * 与预览算出来的那份**不是同一个串**——确认核对的是前一份，发出去的是后一份
 * （0914 复审离线深比较实测）。现在删掉，统一由准备器产出。
 */
async function runHappyHorse(
  preparedBody: Record<string, unknown>,
  beforeSubmit?: OutboundSubmitGuard,
): Promise<string> {
  const hhUrl = withLongJobsFlyDirect("/api/jobs?op=happyHorseVideo");
  const probeOrigin = flyHealthProbeOriginForUrl(hhUrl);
  const res = await withFlyHealthGate(probeOrigin, () => {
    // 健康等待已结束，这里到 fetch 之间不得再 await
    beforeSubmit?.();
    return fetch(hhUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(preparedBody),
    });
  });
  const text = await res.text();
  let json: {
    videoUrl?: string;
    error?: string;
    message?: string;
    ok?: boolean;
    async?: boolean;
    taskId?: string;
    pending?: boolean;
    intentId?: string;
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
  const pendingTaskId = await resolvePendingCanvasIntentTaskId(res, json);
  if (pendingTaskId) return (await pollCanvasVideoTask(pendingTaskId)).videoUrl;
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

/** 只抽新产物的尾帧供后续工序使用；不把编辑原片的结尾误当成新片首帧。 */
async function captureManhuaClipResultTail(deps: CanvasRunDeps, blockId: string, url: string) {
  if (!/^https?:\/\//i.test(url) || !blockId.startsWith("clip-")) return undefined;
  try {
    const { frames } = await extractVideoTailFramesFromUrl(url, {
      frameCount: 1,
      tailWindowSec: MANHUA_CLIP_TAIL_WINDOW_SEC,
    });
    const urls = await toHttpsImageUrls(
      deps,
      frames.map((frame) => frame.dataUrl).filter(Boolean),
    );
    return urls[urls.length - 1];
  } catch (error) {
    console.warn(
      `[canvasRunBlock] clip lastFrame extract failed · ${
        error instanceof Error ? error.message.slice(0, 120) : "unknown"
      }`,
    );
    return undefined;
  }
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

/**
 * 生成前确认用的出站预览信号。
 *
 * 参考素材是在 runCanvasBlock 内部逐层解析出来的（转 https、重签段参考、刷新已登记成片链），
 * 预览若自己再解析一遍必然与真正提交漂移。所以预览走的是**同一条生产代码路径**，
 * 只是在真正下单那一刻用这个信号回卷——因此预览不会发起任何付费调用。
 */
class CanvasOutboundPreviewSignal extends Error {
  readonly preview: CanvasOutboundPreview;
  constructor(preview: CanvasOutboundPreview) {
    super("canvas_outbound_preview");
    this.name = "CanvasOutboundPreviewSignal";
    this.preview = preview;
  }
}

/**
 * 用户在生成前确认过的那一份。
 * fingerprint 由 {@link manhuaOutboundConfirmationFingerprint} 算出，绑定 scope 身份。
 */
export type ManhuaOutboundConfirmation = {
  fingerprint: string;
  scope: CanvasOutboundConfirmationScope;
  /** 确认时刻，便于界面显示与排查；不参与比对 */
  confirmedAt: number;
};

/** 该走确认却没有确认记录：**在任何付费分支之前**拒绝 */
export class ManhuaOutboundConfirmationMissingError extends Error {
  readonly reasonZh: string;
  constructor(reasonZh: string) {
    super(reasonZh);
    this.name = "ManhuaOutboundConfirmationMissingError";
    this.reasonZh = reasonZh;
  }
}

/**
 * 运行时的**当前**归属与确认记录。
 *
 * currentScope 由运行上下文独立给出，**不是**从确认记录里读回来的——
 * 拿 confirmation.scope 自己和自己比等于没比（0914 审查实测：保留旧确认、
 * 只切当前账号与节点，仍然 POST 出去了）。
 */
export type ManhuaOutboundGate = {
  currentScope: CanvasOutboundConfirmationScope;
  confirmation?: ManhuaOutboundConfirmation;
};

/**
 * 这一段是否必须走生成前确认。
 *
 * 范围＝**漫剧段成片（clip-* 的 video 节点）**，只看任务契约本身。
 *
 * 上一轮写成「且该组合可预览」，等于把「预览还没实现」隐式解释成「允许无确认提交」——
 * 换个引擎或转成延长就成了免检通道（0914 审查 P1）。判定要求与实现覆盖是两件事：
 * 要求由产品意图决定，实现没跟上就该拒绝，不该放行。
 *
 * 音乐 MV、图片、文案等非漫剧段成片不在范围内，按各自原契约运行。
 */
export function requiresManhuaOutboundConfirmation(
  block: Pick<CanvasBlock, "kind" | "id" | "videoModel" | "musicMvShot">,
): boolean {
  if (block.kind !== "video" || !String(block.id || "").startsWith("clip-")) return false;
  if (block.musicMvShot) return false;
  return true;
}

function assertManhuaOutboundGate(
  block: Pick<CanvasBlock, "kind" | "id" | "videoModel" | "musicMvShot">,
  gate: ManhuaOutboundGate | undefined,
  /** 真正执行这一次提交的账号（deps.userId），与 currentScope 交叉核对 */
  executingUserId: string,
): asserts gate is ManhuaOutboundGate & { confirmation: ManhuaOutboundConfirmation } {
  if (!gate?.confirmation) {
    throw new ManhuaOutboundConfirmationMissingError(
      "这一段还没有完成生成前确认，未提交、未扣费。请先在工作台查看实际发送内容并确认。",
    );
  }
  const a = gate.currentScope;
  const b = gate.confirmation.scope;

  // 身份必须完整。空账号／空工作区／未确认编剧稿都不是有效身份，
  // 不能靠「两边都空所以相等」混过去（0914 复审：不得使用缺省 null 身份）。
  if (
    !String(a.userId).trim() ||
    !String(a.workspaceId).trim() ||
    !String(a.projectVersion).trim() ||
    a.projectVersion === "unconfirmed" ||
    !Number.isFinite(Number(a.epoch))
  ) {
    throw new ManhuaOutboundConfirmationMismatchError(
      "当前账号或项目身份不完整，无法校验生成前确认，本次未提交、未扣费。",
    );
  }

  // currentScope 必须确实指向**这一个**节点。gate 是按 blockId 取出来的，
  // 但取错／传错时旧写法不会发现（0914 审查点名：收到 block 却不核 blockId）。
  if (String(a.blockId) !== String(block.id)) {
    throw new ManhuaOutboundConfirmationMismatchError(
      "确认闸拿到的节点与本次执行的节点不一致，本次未提交、未扣费。",
    );
  }

  // 与真正执行提交的账号交叉核对：currentScope 来自界面上下文，
  // deps.userId 是入队 jobs 时真正写进去的人，两者不一致就是上下文串了。
  if (String(executingUserId || "").trim() && String(executingUserId) !== String(a.userId)) {
    throw new ManhuaOutboundConfirmationMismatchError(
      "当前登录账号与确认时的账号不一致，本次未提交、未扣费。请重新查看并确认。",
    );
  }

  if (
    String(a.userId) !== String(b.userId) ||
    String(a.workspaceId) !== String(b.workspaceId) ||
    String(a.projectVersion) !== String(b.projectVersion) ||
    String(a.blockId) !== String(b.blockId)
  ) {
    throw new ManhuaOutboundConfirmationMismatchError(
      "确认记录属于另一个账号／项目／节点，本次未提交、未扣费。请在当前上下文重新查看并确认。",
    );
  }

  // 世代不同＝这份工作区在确认之后被整份换掉（载入云草稿／导入备份／清空）。
  // 指纹里已经含 epoch，这里再显式判一次是为了给出说得清的原因。
  if (Number(a.epoch) !== Number(b.epoch)) {
    throw new ManhuaOutboundConfirmationMismatchError(
      "工作区在你确认之后被重新载入过，旧确认已失效，本次未提交、未扣费。请重新查看并确认。",
    );
  }
}

/**
 * 提交守卫：健康门等待结束后、`fetch` 紧前同步调用一次。
 * 通过即可提交；不通过抛错，未建单未扣费。
 */
export type OutboundSubmitGuard = () => void;

/**
 * **所有引擎共用的出站结算点**：算指纹、比对确认、预览回卷，只此一处。
 *
 * 每条引擎分支在**真正提交之前**调它一次，传入自己准备器的产出。
 * 返回表示可以继续提交；否则抛 mismatch 或预览信号。
 * 之所以要收在一起：上一轮把这段逻辑只写在普通 Seedance 分支里，
 * 结果换 Wan/海螺/原片编辑就绕过去了（0914 审查 P1-1）。
 */
function settleManhuaOutbound(
  prepared: CanvasEngineOutboundPreparation,
  runOptions:
    | {
        previewOnly?: boolean;
        enforceOutboundConfirmation?: boolean;
        outboundGate?: ManhuaOutboundGate;
        resolveOutboundGate?: (blockId: string) => ManhuaOutboundGate | undefined;
        /** 由 runCanvasBlock 包装层注入：fetch 紧前把意图标成「已发出」 */
        intentTracker?: { submitted: () => void };
      }
    | undefined,
  /** 这一次真正在提交的节点与执行账号；提交边界复核要用 */
  submitting?: {
    block: Pick<CanvasBlock, "kind" | "id" | "videoModel" | "musicMvShot">;
    executingUserId: string;
  },
): OutboundSubmitGuard {
  /**
   * 最终核对。**必须在健康门等待结束之后、`fetch` 紧前同步执行**，
   * 而且它与 fetch 之间不得再有 await。
   *
   * 0914 复审实测：只在这里（settle 处）核对还不够——settle 之后还要
   * `await ensureFlyAppReady`，用户在那段等待里撤销确认，POST 照样发出去了。
   * 所以 settle 把核对逻辑打包成这个函数交给各 runner，由 runner 在
   * `withFlyHealthGate` 的回调内部调用；调完立刻 fetch。
   */
  const guardBeforeSubmit = (phase?: "early") => {
    // 每次调用都重新取闸，不复用任何早先抓到的对象。
    const gateNow = submitting
      ? runOptions?.resolveOutboundGate
        ? // 配置了 getter 就以它为准：返回 undefined 按「缺闸」处理，
          // 不再回退旧 snapshot（否则撤销确认反而被快照救活）。
          runOptions.resolveOutboundGate(submitting.block.id)
        : runOptions?.outboundGate
      : runOptions?.outboundGate;

    if (
      submitting &&
      runOptions?.enforceOutboundConfirmation &&
      requiresManhuaOutboundConfirmation(submitting.block)
    ) {
      assertManhuaOutboundGate(submitting.block, gateNow, submitting.executingUserId);
    }
    if (gateNow?.confirmation) {
      // **用 currentScope 重算**——拿确认记录自带的 scope 算等于自己和自己比。
      const actual = manhuaOutboundConfirmationFingerprint(
        { engine: prepared.engine, body: prepared.body },
        gateNow.currentScope,
      );
      if (actual !== gateNow.confirmation.fingerprint) {
        throw new ManhuaOutboundConfirmationMismatchError(
          "提示词、模型、时长或参考素材在确认之后发生了变化，本次未提交、未扣费。请重新查看生成前确认并再次确认。",
        );
      }
    }
    // 核对全过、fetch 紧前：意图进入「已发出」。此后网络断了也不能当没发（禁止自动重建）。
    // 早拒那一次不算发出——那时还没过健康门。
    if (phase !== "early") runOptions?.intentTracker?.submitted();
  };

  // 早拒：不合格的在健康探测与续签之前就挡掉，省掉无谓的外部往返。
  if (!runOptions?.previewOnly) guardBeforeSubmit("early");
  if (runOptions?.previewOnly) {
    // 组装已经全部走完（含转 https、重签段参考、刷新已登记成片链），在这里回卷：
    // 不发请求、不建单、不扣费。
    throw new CanvasOutboundPreviewSignal({
      engine: prepared.engine,
      body: prepared.body,
      compile: prepared.compile,
      durationSec: prepared.durationSec,
      refCounts: prepared.refCounts,
      refs: prepared.refSlots,
    });
  }
  return guardBeforeSubmit;
}

/** 确认与实际出站不一致时抛这个：**在发请求之前**，不建单不扣费 */
export class ManhuaOutboundConfirmationMismatchError extends Error {
  readonly reasonZh: string;
  constructor(reasonZh: string) {
    super(reasonZh);
    this.name = "ManhuaOutboundConfirmationMismatchError";
    this.reasonZh = reasonZh;
  }
}

/** 预览不支持该组合时抛这个，调用方据 reasonZh 直接展示，不做任何生产动作 */
export class CanvasOutboundPreviewUnsupportedError extends Error {
  readonly reasonZh: string;
  constructor(reasonZh: string) {
    super(reasonZh);
    this.name = "CanvasOutboundPreviewUnsupportedError";
    this.reasonZh = reasonZh;
  }
}

/**
 * 生成前预览覆盖哪些组合。
 *
 * **必须在进入任何生产路径或外部调用之前判定**：各引擎各有自己的提交点，
 * 把不支持的组合放到末尾才拒绝就太晚了——那等于让预览真的发出付费请求。
 *
 * 覆盖范围：所有视频成片引擎与工作模式——普通 Seedance、Seedance 2.5 的
 * 原片编辑与延长、Wan 3.0、海螺 H3、HappyHorse。每一条都在自己的提交点之前
 * 调 settleManhuaOutbound，预览由那里统一回卷。
 * 产品拍板是「保留引擎、补预览出口、不砍功能」，所以这里不靠禁用堵漏。
 *
 * 不支持的只剩：音乐 MV 镜头与非视频块——它们本来就不是漫剧段成片。
 *
 * 返回 null 表示支持；否则返回中文原因。
 */
export function resolveCanvasOutboundPreviewUnsupportedReason(
  block: Pick<CanvasBlock, "kind" | "videoModel" | "musicMvShot"> & Record<string, unknown>,
): string | null {
  if (block.kind !== "video") {
    return `生成前预览目前只支持段成片节点，当前节点类型：${String(block.kind || "未知")}`;
  }
  if (block.musicMvShot) {
    return "生成前预览暂不支持音乐 MV 镜头节点";
  }
  // 四条引擎（Seedance 普通／2.5 原片编辑与延长／Wan 3.0／海螺 H3／HappyHorse）
  // 都已接 settleManhuaOutbound，预览由那里统一回卷。
  return null;
}

export type CanvasOutboundPreview = {
  engine: string;
  /** 真正会 POST 出去的请求体 */
  body: Record<string, unknown>;
  compile: ManhuaOutboundPromptCompileResult;
  durationSec: number;
  refCounts: { image: number; video: number; audio: number };
  /** 逐条列出真实参与的参考素材地址，供确认界面展示 */
  refs: { imageUrls: string[]; videoUrls: string[]; audioUrls: string[] };
};

/**
 * 临时签名参数：同一个对象每次续签都会变，但内容没变。
 * 只剥这些，**不对任意外链一概去 query**——外链的 query 可能代表不同内容。
 */
const GCS_V4_SIGNING_PARAMS = [
  "X-Goog-Algorithm",
  "X-Goog-Credential",
  "X-Goog-Date",
  "X-Goog-Expires",
  "X-Goog-SignedHeaders",
  "X-Goog-Signature",
];

/**
 * 把参考素材地址规范成「语义身份」，用于确认指纹。
 *
 * 预览与生成各自都会重新续签（freshManhuaSegmentReferenceUrl / createCanvasAssetResigner），
 * 若指纹直接含完整 URL，用户什么都没改也会因为签名时间变化被判成旧确认失效。
 * 所以只对**可识别的 GCS 签名链**剥掉 V4 签名参数，保留 host + 路径 + 其余 query
 * （generation 等版本参数留着：换版本必须失效）。其它地址原样保留。
 */
export function normalizeOutboundRefUrlForFingerprint(raw: unknown): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  let parsed: URL;
  try {
    parsed = new URL(value, "https://placeholder.invalid");
  } catch {
    return value;
  }
  const isGcsSigned =
    /(^|\.)storage\.googleapis\.com$/i.test(parsed.hostname) &&
    GCS_V4_SIGNING_PARAMS.some((key) => parsed.searchParams.has(key));
  if (!isGcsSigned) return value;
  for (const key of GCS_V4_SIGNING_PARAMS) parsed.searchParams.delete(key);
  parsed.searchParams.sort();
  return `${parsed.origin}${parsed.pathname}${parsed.search}`;
}

/** 每次提交都不同、与用户所见内容无关的字段；只排除这些，其余全部计入 */
// intentId 与 idempotencyKey 同值同性质：标识这一次提交，不是用户所见内容
const OUTBOUND_FINGERPRINT_EXCLUDED_KEYS = new Set(["idempotencyKey", "intentId"]);

/**
 * 递归归一：嵌套对象也按键排序。
 * 只做顶层排序的话，`manhuaPilot: { a, b }` 与 `{ b, a }` 这种等价结构会被判成不同，
 * 用户什么都没改却被告知确认失效。数组顺序**保留**——参考素材的顺序本身有语义。
 */
function normalizeFingerprintValue(key: string, value: unknown): unknown {
  if (value === undefined) return undefined;
  if (key === "imageUrl") return normalizeOutboundRefUrlForFingerprint(value);
  if (key === "imageUrls" || key === "videoUrls" || key === "audioUrls") {
    return Array.isArray(value)
      ? value.map((item) => normalizeOutboundRefUrlForFingerprint(item))
      : value;
  }
  return sortNestedKeys(value);
}

function sortNestedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sortNestedKeys(item));
  if (!value || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    if (source[key] !== undefined) out[key] = sortNestedKeys(source[key]);
  }
  return out;
}

/**
 * 确认归属。**每一项都是必填**——可选会被省略，一旦省略就退化成缺省 null 身份，
 * 换账号、换项目、换节点都拿到同一个指纹（0914 复审明确要求不得使用缺省 null 身份）。
 *
 * 关于 workspaceId 的实际口径（0914 查证，不是假定）：
 * 漫剧云草稿在服务端**每个用户只有一份**——`manhua_cloud_drafts` 在 `userId` 上建了
 * 唯一索引（server/db.ts），GCS 侧也按 userId 寻址，`manhuaCloudDraft.get/upsert`
 * 全部只以 `ctx.user.id` 取用，请求与回包里都没有草稿 id。
 * 所以系统里**确实不存在独立的项目 ID**，工作区身份就等于「该用户的那一份草稿」。
 * 这不是省事的近似，是当前存储契约本身；哪天支持多项目，这里换成真正的草稿 id 即可。
 *
 * 因此把空间身份与版本身份**分开**：workspaceId 是空间（存储实体），
 * projectVersion 是版本（编剧确认稿）。剧名＋确认时刻只能当版本线索，
 * 单独拿它当唯一空间身份是错的（0914 审查明确指出）。
 */
export type CanvasOutboundConfirmationScope = {
  /** 谁确认的；换账号不得沿用 */
  userId: string | number;
  /** 哪一份工作区（＝该用户的漫剧云草稿，见上方查证） */
  workspaceId: string;
  /** 哪一版编剧确认稿；重新确认编剧稿＝新版本，旧确认失效 */
  projectVersion: string;
  /** 哪个节点 */
  blockId: string;
  /**
   * 本地上下文世代。整份工作区被**换掉**时自增（载入云草稿、导入备份、切账号、
   * 清空画布）。用途是让**在途**的预览／确认失效：异步 await 期间用户切走了，
   * 迟到的回执不能写回，也不能拿旧快照批准新工作区的内容。
   */
  epoch: number;
};

/**
 * 出站确认指纹：由**真正会发出去的请求体**加上业务归属算出。
 *
 * 口径是**黑名单**不是白名单——请求体里除了每次都变的提交 nonce，其余字段全部计入。
 * 白名单写法漏过 episodeIndex / clipIndex / manhuaPilot，会让换集、换段、换项目、
 * 换试片身份的请求得到同一个指纹（0914 审查实测复现）。
 *
 * 参考素材地址先过 {@link normalizeOutboundRefUrlForFingerprint}：
 * 同一对象重新签名不失效，换对象或换版本失效。
 */
export function manhuaOutboundConfirmationFingerprint(
  preview: Pick<CanvasOutboundPreview, "engine" | "body">,
  scope: CanvasOutboundConfirmationScope,
): string {
  const body = preview.body as Record<string, unknown>;
  const shaped: Record<string, unknown> = {};
  for (const key of Object.keys(body).sort()) {
    if (OUTBOUND_FINGERPRINT_EXCLUDED_KEYS.has(key)) continue;
    const normalized = normalizeFingerprintValue(key, body[key]);
    if (normalized !== undefined) shaped[key] = normalized;
  }
  return JSON.stringify({
    engine: preview.engine,
    scope: {
      userId: String(scope.userId),
      workspaceId: String(scope.workspaceId),
      projectVersion: String(scope.projectVersion),
      blockId: String(scope.blockId),
      // epoch 计入指纹：工作区被换掉之后，旧快照 id 自然对不上新算出来的，
      // 迟到的确认与展示过的 snapshotId 一起失效，不用靠调用方各自记得去比。
      epoch: Number(scope.epoch),
    },
    request: shaped,
  });
}

/**
 * 走生产路径算出「这一段现在按下生成会发出去什么」，**不发请求、不建单、不扣费**。
 * 编译未通过时 compile.blocked 为 true 并带上原因，由确认界面展示。
 */
export async function previewCanvasBlockOutbound(
  deps: CanvasRunDeps,
  block: CanvasBlock,
  upstream: CanvasUpstreamContext = { visionImages: [], texts: [] },
  runOptions?: { videoSubmissionKey?: string; pilotRun?: boolean },
): Promise<CanvasOutboundPreview> {
  // 先拒绝再执行：不支持的组合一步都不许往生产路径走。
  const unsupported = resolveCanvasOutboundPreviewUnsupportedReason(block);
  if (unsupported) throw new CanvasOutboundPreviewUnsupportedError(unsupported);
  try {
    await runCanvasBlock(deps, block, upstream, { ...runOptions, previewOnly: true });
  } catch (error) {
    if (error instanceof CanvasOutboundPreviewSignal) return error.preview;
    throw error;
  }
  throw new Error("当前引擎暂不支持生成前出站预览");
}

type CanvasIntentRun = {
  intent: CanvasGenerationIntent;
  submitted: () => void;
  acknowledged: (taskId: string, engine: string) => void;
  settled: () => void;
  failed: (error: unknown) => void;
};

function defaultCanvasIntentStorage(): CanvasIntentStorageLike | null {
  try {
    const ls = (globalThis as { localStorage?: CanvasIntentStorageLike }).localStorage;
    return ls && typeof ls.getItem === "function" ? ls : null;
  } catch {
    return null;
  }
}

function isLikelyNetworkError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return error instanceof TypeError || /Failed to fetch|NetworkError|Load failed|network|timeout|超时/i.test(msg);
}

/**
 * D（0915）：给这一次视频生成登记**生成意图**——同步、在第一个 await 之前。
 *
 * - 预览不建意图（不是付费提交）；调用方显式传 canvasIntentStorage=null 也不建。
 * - 没有出站确认（非产品路径 / 非 clip）：不建，沿用旧的每次新键行为。
 * - 有确认：owner = currentScope 的 userId + workspaceId + blockId；
 *   digest = 确认指纹去掉 epoch / projectVersion（刷新后同一份输入仍是同一个意图）。
 * - 同 owner 同 digest 且未结算 → **复用**（重试、双击、刷新都不另起一单）；
 *   forceNewIntent 才新建；输入变了自然是新 digest → 新意图，旧意图保留供查询。
 * - 落盘失败 → 抛 CanvasIntentPersistError，**发送前中止**：存不下等于没有可恢复的意图。
 */
function resolveCanvasIntentForBlockRun(
  deps: CanvasRunDeps,
  block: CanvasBlock,
  runOptions:
    | {
        previewOnly?: boolean;
        videoSubmissionKey?: string;
        forceNewIntent?: boolean;
        outboundGate?: ManhuaOutboundGate;
        resolveOutboundGate?: (blockId: string) => ManhuaOutboundGate | undefined;
      }
    | undefined,
): CanvasIntentRun | null {
  if (runOptions?.previewOnly) return null;
  if (deps.canvasIntentStorage === null) return null;
  const gate = runOptions?.resolveOutboundGate
    ? runOptions.resolveOutboundGate(block.id)
    : runOptions?.outboundGate;
  const fingerprint = gate?.confirmation?.fingerprint;
  if (!fingerprint || !gate?.currentScope) return null;
  const storage = deps.canvasIntentStorage ?? defaultCanvasIntentStorage();
  if (!storage) return null;

  const owner = {
    userId: String(gate.currentScope.userId),
    workspaceId: String(gate.currentScope.workspaceId),
    blockId: block.id,
  };
  const resolved = resolveCanvasIntentForRun({
    store: loadCanvasIntentStore(storage),
    owner,
    requestDigest: canvasIntentDigestFromOutboundFingerprint(fingerprint),
    now: Date.now(),
    forceNew: runOptions?.forceNewIntent === true,
  });
  // 调用方给了固定键（批量内自动重试复用同键）且没有可复用的在途意图：一键一意图，采用它当 ID
  const intent =
    !resolved.reused && runOptions?.videoSubmissionKey
      ? { ...resolved.intent, intentId: runOptions.videoSubmissionKey }
      : resolved.intent;
  persistCanvasIntent(storage, intent); // 抛 CanvasIntentPersistError → 调用方在发送前停下
  deps.onCanvasIntentChanged?.(block.id, intent);

  const mark = (patch: { status: CanvasGenerationIntent["status"]; taskId?: string; engine?: string }) => {
    const next = markCanvasIntentStatus(storage, intent.intentId, block.id, { ...patch, now: Date.now() });
    if (next) deps.onCanvasIntentChanged?.(block.id, next);
  };
  let sent = false;
  return {
    intent,
    submitted: () => {
      sent = true;
      mark({ status: "submitted" });
    },
    acknowledged: (taskId, engine) => mark({ status: "acknowledged", taskId, engine }),
    settled: () => mark({ status: "settled" }),
    failed: (error) => {
      // 没发出去就失败（确认不符 / 编译不过 / 健康门）：这次意图作废，下次同输入照常新建
      if (!sent) {
        mark({ status: "settled" });
        return;
      }
      // 已发出：网络层错误 → 未知，**禁止自动重建**；服务端明确拒绝 → 保持 submitted，由恢复查询裁决
      if (isLikelyNetworkError(error)) mark({ status: "unverified" });
    },
  };
}

/**
 * 产品入口。**先登记生成意图再进执行器**（同步、无 await），把意图 ID 当提交键下发：
 * 所有 runner 的 idempotencyKey / intentId 都是它，服务端据此在扣费前裁决。
 */
export async function runCanvasBlock(
  deps: CanvasRunDeps,
  block: CanvasBlock,
  upstream: CanvasUpstreamContext = { visionImages: [], texts: [] },
  runOptions?: Parameters<typeof runCanvasBlockInner>[3],
): Promise<Awaited<ReturnType<typeof runCanvasBlockInner>>> {
  const intentRun = block.kind === "video" ? resolveCanvasIntentForBlockRun(deps, block, runOptions) : null;
  if (!intentRun) return runCanvasBlockInner(deps, block, upstream, runOptions);
  const trackedDeps: CanvasRunDeps = {
    ...deps,
    onVideoTaskCreated: (createdBlockId, info) => {
      if (createdBlockId === block.id) intentRun.acknowledged(info.taskId, info.engine);
      deps.onVideoTaskCreated?.(createdBlockId, info);
    },
  };
  try {
    const out = await runCanvasBlockInner(trackedDeps, block, upstream, {
      ...runOptions,
      videoSubmissionKey: intentRun.intent.intentId,
      intentTracker: intentRun,
    });
    intentRun.settled();
    return out;
  } catch (error) {
    intentRun.failed(error);
    throw error;
  }
}

async function runCanvasBlockInner(
  deps: CanvasRunDeps,
  block: CanvasBlock,
  upstream: CanvasUpstreamContext = { visionImages: [], texts: [] },
  runOptions?: {
    /** 同一次用户操作的自动重试必须复用；新一次显式运行不传旧值，自动生成新键。 */
    videoSubmissionKey?: string;
    /** 仅本次首段试片的执行约束，不写入节点、草稿或供应商字段。 */
    pilotRun?: boolean;
    /**
     * 生成前确认：走完整组装后在下单那一刻回卷，返回真实出站请求体。
     * 只由 previewCanvasBlockOutbound 使用；不写节点、不建单、不扣费。
     */
    previewOnly?: boolean;
    /**
     * 生成前确认闸。**漫剧段成片（clip-* 视频节点）一律必须提供**——
     * 这是 runCanvasBlock 内部按节点契约强制的，不是可选参数：
     * 单段、批量、重跑、自由画布任意入口都绕不过去。
     * currentScope 必须由运行上下文独立给出，用于和确认记录的归属比对。
     */
    outboundGate?: ManhuaOutboundGate;
    /**
     * **提交边界现读**当前闸。产品入口应传它而不是 outboundGate 快照：
     * 快照在长跑的 await 期间会过期，清空确认 ref 之后旧对象仍然「有效」。
     */
    resolveOutboundGate?: (blockId: string) => ManhuaOutboundGate | undefined;
    /**
     * 由**产品生成入口**声明：这一次是用户发起的付费段成片。
     * 声明了就强制要求确认——缺确认、身份不符一律在任何付费分支之前拒绝。
     *
     * 为什么不在执行器里对所有 clip-* 一刀切：那会连既有的执行器级测试与
     * 非产品调用一起封死（0914 实测 18+ 项），而审查明确写了
     * 「保留无关普通工具的原行为，使用明确任务意图区分，不能全局盲封所有旧调用」。
     * 强制点设在编排器与画布运行入口，执行器这一层负责真正的校验逻辑。
     */
    enforceOutboundConfirmation?: boolean;
    /** 用户**明确再次生成**：即使输入相同也开新意图，避免同一份输入永远只能生成一次 */
    forceNewIntent?: boolean;
    /** 内部：由 runCanvasBlock 包装层注入，runner 在 fetch 紧前调 submitted() */
    intentTracker?: { submitted: () => void };
  },
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
  if (runOptions?.previewOnly) {
    // 双保险：即便有人绕过 previewCanvasBlockOutbound 直接传 previewOnly，
    // 也必须在任何外部调用之前拒绝，不能靠调用方守规矩。
    const unsupported = resolveCanvasOutboundPreviewUnsupportedReason(block);
    if (unsupported) throw new CanvasOutboundPreviewUnsupportedError(unsupported);
  }
  if (
    !runOptions?.previewOnly &&
    runOptions?.enforceOutboundConfirmation &&
    requiresManhuaOutboundConfirmation(block)
  ) {
    // 早拒：不合格的在任何外部调用之前就挡掉，省掉无谓的续签与探测。
    // 真正的把关在每个提交点的 settleManhuaOutbound 里**再现读一次**。
    // 取闸口径与最终守卫**完全一致**：配了 getter 就以 getter 为准，
    // 返回 undefined 按缺闸处理，不回退旧 snapshot（0914 复审建议直接统一）。
    assertManhuaOutboundGate(
      block,
      runOptions?.resolveOutboundGate
        ? runOptions.resolveOutboundGate(block.id)
        : runOptions?.outboundGate,
      String(deps.userId || ""),
    );
  }
  if (block.kind === "music") throw new Error("请在音乐节点中选择生成音乐、分镜或合成阶段");
  if (runOptions?.pilotRun) {
    if (
      block.kind !== "video" || !block.id.startsWith("clip-") ||
      block.seedance25WorkMode === "video_edit" || block.seedance25WorkMode === "video_extend"
    ) {
      throw new Error("10 秒试片只用于新生成片段，不能代替原片编辑或延长");
    }
    // 只裁本次执行副本；独立秒级分镜原稿仍留在节点，正式生成时可继续使用。
    block = {
      ...block,
      prompt: compileManhuaPilotPrompt(block.prompt).prompt,
      ...(block.seedance25TimestampStoryboard != null ? {
        seedance25TimestampStoryboard: compileManhuaPilotPrompt(block.seedance25TimestampStoryboard).prompt,
      } : {}),
    };
  }
  // 出片前统一重签上传件签名链（0908 EvoLink「input media could not be downloaded」：
  // 60 分钟签名在上传与提交之间过期）。同一 gcsUri 只签一次；失败退回原链不挡提交。
  if (block.kind === "video" && block.musicMvShot) {
    const fresh = new Map<string, string>();
    for (const image of block.musicMvShot.referenceImages) {
      const url = image.gcsUri ? await resolveCanvasMaterialUrl(image.gcsUri) : image.url;
      if (!/^https:\/\//.test(url)) throw new Error("MV 参考图暂不可用，未提交生成");
      fresh.set(image.url.split("?")[0]!, url);
    }
    const resign = (url: string | undefined) => url ? fresh.get(url.split("?")[0]!) || url : undefined;
    block = { ...block, refImageUrl: resign(block.refImageUrl), editFusionUrls: block.editFusionUrls?.map(url => resign(url)!) };
    // 分镜已明确选择参考；空引用不从父音乐节点补入其他人物/场景。
    upstream = { ...upstream, visionImages: [] };
  }
  const assetResigner = createCanvasAssetResigner(block.uploadedAssets);
  if (block.kind === "video" || block.kind === "image") {
    block = await resignCanvasBlockUploadedReferences(block, assetResigner);
  }
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
  const uploadedVideoUrl = await assetResigner.one(
    block.refVideoUrl ||
      block.uploadedAssets?.find((a) => a.kind === "video" || /\.(mp4|mov|webm)(\?|$)/i.test(a.fileName || a.url))
        ?.url,
  );

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
    isKeyartBlock || isClipBlock || block.musicMvShot ? [] : effectiveTexts,
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
      (await assetResigner.one(
        block.uploadedAssets?.find((a) => a.kind === "image" || /\.(png|jpe?g|webp)(\?|$)/i.test(a.fileName || a.url))
          ?.url,
      )) ||
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
    /**
     * 画布锁 gpt-image-2 型号但不再钉官方单供应商（2026-08-12 解钉）：
     * 旧钉子是防 Nano Banana 回流；auto 只在 EvoLink/官方两家 gpt-image-2 里按价调度
     * （EvoLink 便宜 10% 为主路径，官方备胎），NB2 无回流通道。
     * 曾因此钉全画布出图绕过便宜通道，见 2026-08-12 P0 报告。
     */
    const gptUserId = String(deps.userId || "");
    // 设定图与静帧分走两把官方密钥（本道打不通由服务端借另一把）
    const imageLane = resolveOpenAiImageLaneForBlockId(block.id);
    const gptImageOpts = isEdit
      ? {
          refImageUrl: editRef,
          referenceImageUrls: fusionUrls,
          maskUrl: maskUrl || undefined,
          openaiOnly: false,
          userId: gptUserId,
          imageLane,
        }
      : { openaiOnly: false as const, userId: gptUserId, imageLane };
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
    // 提交键 = 生成意图 ID（包装层已登记）或调用方固定键；缺省每次新键。
    // 上提到分支顶部：原片编辑 / HappyHorse 此前不带键（审查 G2），同内容重发会出两单。
    const submissionKey = runOptions?.videoSubmissionKey || newWanSubmissionKey(block.id);
    if (isManhuaVideoEditBlock(block)) {
      const access = resolveSeedance25Access({ plan: deps.userPlan, role: deps.userRole });
      if (!access.allowed) throw new Error(access.message || "当前账号未开放高级视频编辑");
      // 工厂编辑入口只选择一条原片；旧上游片、静帧、导演板与声线不能自动混入。
      const sourceRaw = String(block.seedance25RefVideoUrls?.[0] || block.refVideoUrl || "").trim();
      if (!/^https?:\/\//i.test(sourceRaw)) throw new Error("请先选择本次要修改的原片");
      // 登记进来的外部成片是 60 分钟签名链：编辑前按 gcsUri 现签，过期不挡编辑。
      const [source] = await refreshManhuaRegisteredClipUrls(block.manhuaSegmentRefs?.registered, [sourceRaw]);
      if (!source) throw new Error("请先选择本次要修改的原片");
      const editPrompt = compileManhuaVideoEditPrompt(block.prompt);
      const editSourceDurationSec = (await probeVideoDurationSec(source)) || undefined;
      const editOpts: SeedanceCanvasRequestOptions = {
        version: "2.5",
        workMode: "video_edit",
        videoUrls: [source],
        duration:
          editSourceDurationSec ?? parseManhuaClipTargetDurationSec(block.prompt) ?? undefined,
        editSourceDurationSec,
        resolution: block.videoResolution,
        episodeIndex: block.episodeIndex,
        clipIndex: parseClipIndexFromBlockId(block.id),
        idempotencyKey: submissionKey,
        intentId: submissionKey,
      };
      // 原片编辑也走同一道闸。上一轮它在 block.kind==="video" 之后立刻提交，
      // 整条确认逻辑都绕过去了（0914 审查 P1-1 实测复现过）。
      const editGuard = settleManhuaOutbound(
        {
          ...buildSeedanceCanvasRequestBody(editPrompt, undefined, ar, editOpts),
          engine: "seedance-2.5",
        },
        runOptions,
        { block, executingUserId: String(deps.userId || "") },
      );
      const edited = await runSeedanceProductVideo(editPrompt, undefined, ar, {
        ...editOpts,
        beforeSubmit: editGuard,
      });
      return {
        outputUrl: edited.videoUrl,
        lastFrameUrl: await captureManhuaClipResultTail(deps, block.id, edited.videoUrl),
      };
    }
    const looksLikeVideo = (u?: string) => Boolean(u && /\.(mp4|mov|webm)(\?|$)/i.test(u));
    // Seedance 2.5 多模态参考：节点上勾选/上传的视频是「站位/运镜参考」，原样走 videoUrls，
    // 不是上一段成片——不抽尾帧当起幅、不追加【镜头连续性】（0908 白模站位参考实测：
    // 跨域签名视频抽帧挂死整条链路，且接力提示会让模型去学白模的脸和服装）。
    const seedance25ReferenceOnly =
      !block.id.startsWith("clip-") &&
      normalizeCanvasVideoModel(block.videoModel || DEFAULT_CANVAS_VIDEO_MODEL) === "seedance-2.5" &&
      (block.seedance25WorkMode ?? "reference_to_video") === "reference_to_video";
    // 上游连线来的上一段成片（refUrl / upstream.visionImages）仍按接力处理，两档一致。
    const linkedContinuityVideoUrl =
      (looksLikeVideo(refUrl) ? refUrl : undefined) ||
      upstream.visionImages.find((i) => looksLikeVideo(i.url))?.url;
    const continuityVideoUrl = seedance25ReferenceOnly
      ? linkedContinuityVideoUrl
      : block.refVideoUrl || uploadedVideoUrl || linkedContinuityVideoUrl;
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
    // 普通视频按用户正文规定参考职责与动作，不把身份图自动解释为场景静帧。
    const withContinuity =
      !isClip && continuityVideoUrl
        ? `${mergedPrompt}\n\n${MANHUA_CLIP_CONTINUITY_HINT_ZH}`
        : mergedPrompt;
    // 导戏单原样进 Seedance（已废除微动三件套）；clip 的路径配方以
    // 附加约束合成——不覆盖含秒轴/对白锁的正文（审计 P1 闭环）
    const compiledMotion = stripManhuaPromptSlop(
      compileI2VMotionPrompt(withContinuity, {
        pathCameraRecipeId: block.pathCameraRecipeId,
        appendRecipeAsConstraint: isClip,
      }),
    );
    // 光学 mm/快门：仅出片时由运镜句自动转换，不写回节点/前台审阅
    // 成片正文剥网址：垫图 URL 只走 imageUrls，不进提示词
    const motionPrompt = isClip
      ? stripManhuaAssetUrlsFromPrompt(appendManhuaClipEngineOptics(compiledMotion))
      : compiledMotion;
    const videoModel = normalizeCanvasVideoModel(block.videoModel || DEFAULT_CANVAS_VIDEO_MODEL);
    let manhuaPilot: ManhuaPilotSubmission | undefined;
    if (isClip && deps.authorizeManhuaClip) {
      const episodeIndex = Number(block.episodeIndex) || Number(block.id.match(/^clip-e(\d+)-/)?.[1]) || 1;
      manhuaPilot = manhuaPilotSubmissionSchema.parse(await deps.authorizeManhuaClip({
        episodeIndex,
        segmentIndex: resolveClipLocalSegmentIndex(block.id, block.prompt, episodeIndex),
        videoModel,
        pilotRun: runOptions?.pilotRun === true,
        durationSec: runOptions?.pilotRun ? MANHUA_PILOT_DURATION_SEC
          : clampManhuaClipDurationSecForVideoModel(videoModel, parseManhuaClipTargetDurationSec(block.prompt)),
      }));
    }
    const useHailuoH3 = isCanvasHailuoH3VideoModel(videoModel);
    const useHappyHorse = isCanvasHappyHorseVideoModel(videoModel);
    if (useHappyHorse && manhuaPilot) throw new Error("当前生成档未接入试片审核，请先选择受支持的漫剧成片引擎");
    const useWan30 = isCanvasWan30VideoModel(videoModel);
    const useSeedance25 = videoModel === "seedance-2.5";
    // 逐段音轨守卫挪到段参考取舍之后：只有「本次真的会送母轨」才放行（见下方 segmentMasterEntry），
    // 母轨存在但超容量/编辑/延长/试片不送时仍按原规则拦，不让 cue 与母轨都静默丢掉
    const hasEnabledCues = Boolean(block.audioStudio?.cues.some(cue => cue.enabled !== false));
    const cuesNeedReferenceMode = hasEnabledCues && (!useSeedance25 || (block.seedance25WorkMode && block.seedance25WorkMode !== "reference_to_video"));
    const maxVideoImageRefs = resolveManhuaCanvasVideoImageReferenceMax(videoModel);
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
      useHappyHorse ||
      useWan30
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
      // ——— 引用清单登记（必须早于任何过滤）———
      // clip-eNN-... → 集号；没有导演板表或解不出集号时 boardUrl 就是空串，不影响既有行为
      const clipEpisodeMatch = /^[a-z_]+-e(\d{2})-/i.exec(block.id);
      const clipEpisodeNo = clipEpisodeMatch ? Number.parseInt(clipEpisodeMatch[1]!, 10) : null;
      // 段级板优先、集级兜底（与 ensureManhuaFragmentClips 同口径）；g 号可能是全集连续，折回本集段号
      const clipLocalSegNo = clipEpisodeNo
        ? resolveClipLocalSegmentIndex(block.id, block.prompt, clipEpisodeNo)
        : null;
      const rawBoardUrl =
        isClip && clipEpisodeNo
          ? String(
              (clipLocalSegNo != null
                ? deps.manhuaDirectorBoardUrlByEpisodeSegment?.[clipEpisodeNo]?.[clipLocalSegNo]
                : "") || "",
            ).trim() ||
            String(deps.manhuaDirectorBoardUrlByEpisode?.[clipEpisodeNo] || "").trim()
          : "";

      const requestedAssetRows = isClip
        ? parseManhuaAssetImageBindBlock(block.prompt || motionPrompt)
        : [];
      /**
       * @引用闭环（@图NN）：解析成真 URL 进 imageUrls；断链硬拦——
       * 红 chip 只是提示，跑到这一步还断就必须炸，绝不静默出错脸。
       */
      const { applyManhuaAtReferencesToClip, resolveManhuaAtReferences } = await import(
        "@shared/manhuaAtReference"
      );
      /**
       * @图：**不再用 entries.length 跳过**——索引为空时也要解析提示词 token，
       * 才能把断链如实报成 missing，而不是当作「没有 @图」。
       *
       * 注意 applyManhuaAtReferencesToClip 的 imageUrls 按 /^https?:/ 过滤过，
       * 本机引用在那里既不出现也不算 missing，两头都不报就丢了；
       * 所以登记用的是下面**未过滤的语义解析结果**，
       * 这里的 atRefApplied 只取 missing 一项（其余产物已不再被消费）。
       */
      const atRefPromptText = String(block.prompt || motionPrompt || "");
      const atRefApplied = isClip
        ? applyManhuaAtReferencesToClip({
            promptText: atRefPromptText,
            index: deps.manhuaAtReferenceEntries || [],
            bindings: block.atRefBindings || null,
          })
        : null;
      /**
       * 登记用的是**未按协议过滤的语义解析结果**。
       * applyManhuaAtReferencesToClip 的 imageUrls 已经滤过一遍，
       * 溯不回来源的 @图 在那里既不出现、也不算 missing——两头都不报，就丢了。
       */
      const atRefRawResolved = isClip
        ? resolveManhuaAtReferences({
            text: atRefPromptText,
            index: deps.manhuaAtReferenceEntries || [],
            bindings: block.atRefBindings || null,
          }).resolved.filter((e) => e.kind === "image")
        : [];
      if (atRefApplied?.missing.length) {
        throw new Error(
          `@引用断链：@${atRefApplied.missing.join("、@")} 指到的资产不存在，请在审阅框修正或删除该引用后再出片`,
        );
      }
      /**
       * **先把语义选择全部做完**（含场景切片按本段机位选格），再登记、再校验。
       *
       * 0915 复审 P1 实测：切片替换发生在清单校验之后，
       * 选中的那一格若断链，会被后面的 assetRows.filter 静默删掉——
       * 「只消费清单已解析值」当时并没有兑现。
       */
      const resolvedAssetRows = isClip
        ? resolveManhuaAssetImageBindRows(
            requestedAssetRows,
            deps.manhuaAssetPathById
              ? Object.fromEntries(
                  Object.entries(deps.manhuaAssetPathById).map(([id, path]) => [
                    id,
                    normalizeCanvasRefSource(path) || String(path ?? ""),
                  ]),
                )
              : deps.manhuaAssetPathById,
          ).map((r) => {
            const abs = normalizeCanvasRefSource(r.path) || r.path;
            /**
             * 跨集场景挂的是四视角拼板切片，按本段机位换那一格：俯拍段喂平视图
             * 等于让引擎自己想象俯视下的地面动线，空间锁就白锁了。
             */
            const tiles = deps.manhuaAssetTileUrlsById?.[r.id];
            if (!tiles) return { ...r, path: abs, tileSlot: "" as string };
            const picked = resolveManhuaSceneTileUrl(abs, tiles, motionPrompt);
            return {
              ...r,
              path: normalizeCanvasRefSource(picked.url) || picked.url,
              tileSlot: String((picked as { slot?: string }).slot || ""),
            };
          })
        : [];

      /**
       * **本次真正会被引用的东西，先整理成一张带槽位的清单，再统一解析校验。**
       *
       * 0915 复审点名：此前是逐处补漏——静帧补了、资产表补了，导演板又漏；
       * 而且资产行在进到断言之前就被 resolveManhuaAssetImageBindRows
       * （内部 isBindableAssetPath）过滤掉了，断链资产照旧静默消失。
       *
       * 所以顺序固定为：**登记清单 → 统一解析 → 统一校验 → 之后才允许任何过滤**。
       * 新增引用类型只要登记进这张清单，就自动获得同样的失败语义。
       */
      type ExplicitRefKind = "atref" | "still" | "asset" | "board";
      const explicitRefManifest: Array<{
        /** 稳定键：下游一律按它筛选，中文 slotZh 只用于报错展示 */
        kind: ExplicitRefKind;
        slotZh: string;
        raw: string;
        resolved: string;
      }> = [
        // 用未过滤的解析结果登记：token 带上，断链时报得出是哪一个 @图
        ...atRefRawResolved.map((e) => ({
          kind: "atref" as const,
          slotZh: `@引用图 @${e.token}`,
          raw: String(e.url || ""),
        })),
        ...stillPool.map((raw) => ({
          kind: "still" as const,
          slotZh: "参考静帧",
          raw: String(raw || ""),
        })),
        // 资产：按**提示词里请求了什么**登记，而不是按解析器留下了什么——
        // 否则断链的那一行在登记之前就没了。
        // 已选场景切片用**最终那一格**登记；断链切片必须报出场景与切片槽位。
        ...requestedAssetRows.map((row) => {
          const finalRow = resolvedAssetRows.find((r) => r.id === row.id);
          const tileSlot = String((finalRow as { tileSlot?: string } | undefined)?.tileSlot || "");
          return {
            kind: "asset" as const,
            slotZh: `资产图 ${row.tag}${tileSlot ? `·切片${tileSlot}` : ""}`,
            raw: String(
              finalRow?.path || deps.manhuaAssetPathById?.[row.id] || row.path || "",
            ),
          };
        }),
        ...(rawBoardUrl
          ? [{ kind: "board" as const, slotZh: "导演板", raw: rawBoardUrl }]
          : []),
      ].map((e) => ({ ...e, resolved: normalizeCanvasRefSource(e.raw) }));
      // 已选但解析不到可提交来源的，在这里就报清楚；不进入后面任何一层过滤
      assertExplicitRefsResolvable(explicitRefManifest);

      const resolvedOf = (raw: string) =>
        explicitRefManifest.find((e) => e.raw === raw)?.resolved || normalizeCanvasRefSource(raw);
      const boardUrl = rawBoardUrl ? resolvedOf(rawBoardUrl) : "";
      // 资产行在清单之后不得再解析：下游只消费这里定下来的 path。
      const assetRows = resolvedAssetRows;
      const requiredLookRows = requestedAssetRows.filter((row) => row.tag.startsWith("@服装"));
      if (requiredLookRows.some((row) => !assetRows.some((resolved) => resolved.id === row.id))) {
        throw new Error("本段所选造型的参考图已失效，请重新挂图并确认；本次未提交生成。");
      }
      const mentionedTags = isClip
        ? extractManhuaMentionedAssetTags(motionPrompt)
        : [];
      // 静帧直接取清单里已解析好的值：协议校验 → 去重，不再自己解析一遍
      const absStills = explicitRefManifest
        .filter((e) => e.kind === "atref" || e.kind === "still")
        .map((e) => e.resolved)
        .filter((u, i, arr) => isSubmittableRefUrl(u) && arr.indexOf(u) === i);
      // 成片硬绑：末帧 → 资产定妆 → 本段静帧 → 导演板（URL 只进 API imageUrls）
      const bindPlan = isClip
        ? planManhuaClipSeedanceImageBind({
            // 资产行在上面已按统一顺序规范化过，这里只做协议校验
            assetRows: assetRows.filter((r) => isSubmittableRefUrl(r.path)),
            stillUrls: absStills,
            tailUrls: tailFrames,
            mentionedTags,
            maxImages: maxVideoImageRefs,
            boardUrl: boardUrl || null,
          })
        : null;
      const rawPool = bindPlan?.imageUrls?.length
        ? bindPlan.imageUrls
        : [...tailFrames, ...absStills];
      // 普通视频的显式参考不能被接力尾帧挤掉；在付费请求前拒绝，不静默换角色。
      if (!isClip && absStills.some(url => !rawPool.slice(0, maxVideoImageRefs).includes(url))) {
        throw new Error("参考图片与接力尾帧合计超过上限，请减少参考后再生成；本次未提交");
      }
      if (requiredLookRows.some((row) => {
        const path = assetRows.find((resolved) => resolved.id === row.id)?.path;
        return !path || !rawPool.includes(path);
      })) {
        throw new Error("本段参考图名额不足，所选造型未能进入生成，请减少参考图后重试。");
      }
      const httpsImages = await toHttpsImageUrls(
        deps,
        rawPool.slice(0, maxVideoImageRefs),
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
        runOptions?.pilotRun ? MANHUA_PILOT_DURATION_SEC :
        parseManhuaClipTargetDurationSec(motionPrompt) ??
        parseManhuaClipTargetDurationSec(block.prompt) ??
        undefined;
      const clipDuration = clampManhuaClipDurationSecForVideoModel(videoModel, clipDurationRaw);
      // 漫剧工厂段级参考：只在多模态参考出片、非局部编辑、非 10 秒试片时注入
      // （试片 10 s 配 30 s 白模/母轨会让模型在两个时长之间二选一）。
      // 各引擎按自己的时长上限取舍：Seedance 2.x ≤30 s，Wan 3.0 视频/音频各 ≤15 s；
      // 白模一旦送出就不再送上段接力片与旧成片（三条 30 s 叠到 90 s 会被拒，且接力片无序号说明）。
      // 局部编辑与视频延长的 @视频1 都必须是本段成片本身，白模/母轨不得插队
      const segmentRefs =
        isClip &&
        !isManhuaVideoEditBlock(block) &&
        block.seedance25WorkMode !== "video_extend" &&
        !runOptions?.pilotRun
          ? block.manhuaSegmentRefs
          : undefined;
      const segmentCapSec = useWan30
        ? MANHUA_SEGMENT_REFERENCE_CAP_SEC.wan30
        : MANHUA_SEGMENT_REFERENCE_CAP_SEC.seedance;
      if(segmentRefs?.previs?.motionGuideZh && (useHappyHorse||useHailuoH3)){
        throw new Error("当前生成档不支持动作白模视频参考；请切换支持视频参考的生成档，或明确移除本段白模。本次未提交。");
      }
      if(segmentRefs?.previs?.motionGuideZh && !manhuaSegmentReferenceFitsCap(segmentRefs.previs,segmentCapSec)){
        throw new Error(`已采用的动作白模超过当前参考视频 ${segmentCapSec} 秒上限；请缩短白模后重新采用。本次未提交，旧参考保留。`);
      }
      const segmentPrevisUrl = manhuaSegmentReferenceFitsCap(segmentRefs?.previs, segmentCapSec)
        ? await freshManhuaSegmentReferenceUrl(segmentRefs.previs)
        : undefined;
      const segmentMasterEntry = manhuaSegmentReferenceFitsCap(segmentRefs?.master, segmentCapSec)
        ? segmentRefs.master
        : undefined;
      if (segmentRefs?.previs && !segmentPrevisUrl) {
        console.warn(`[canvasRunBlock] 段白模超出 ${videoModel} 参考上限 ${segmentCapSec}s 或时长未知，本次不送`);
      }
      if (segmentRefs?.master && !segmentMasterEntry) {
        // 母轨是用户明确挂的最终音轨，超容量不能静默丢：抛错让他换引擎或重新预混
        throw new Error(
          `本段母轨${segmentRefs.master.durationSec ? ` ${segmentRefs.master.durationSec.toFixed(1)} 秒` : "时长未知"}，超出 ${videoModel} 参考音频上限 ${segmentCapSec} 秒；请换 Seedance 2.5 或把本段切短后重新预混`,
        );
      }
      // 母轨本次会送 → 它就是唯一音轨（下方 studio: segmentMasterUrl ? undefined : audioStudio 同口径），
      // 预混母轨来自这些 cue，cue 仍启用不算「逐段音轨」；否则维持原拦截
      if (cuesNeedReferenceMode && !segmentMasterEntry) {
        throw new Error(
          runOptions?.pilotRun
            ? "10 秒试片不送母轨，逐段音轨也不会并入；请先停用本段配音再试片，或直接出正片"
            : "已配置逐段音轨，请使用支持声音参考的多模态参考模式；不会静默忽略这些音轨",
        );
      }
      if (useWan30) {
        // Wan 3.0 公测:多图参考 + 可选对白参考音;30s 直出;排队时间较长。
        // 提示词按 Wan 口径编译:不用 Seedance 的 @图片N 绑定,改为按数组顺序的参考职责表(审查 P1)
        const wanImages = httpsImages.length ? httpsImages : ([seedStill].filter(Boolean) as string[]);
        const wanContinuityVideoUrl = segmentPrevisUrl ? undefined : continuityVideoUrl;
        const wanVideoUrls = resolveWan30CanvasVideoUrls({
          selectedVideoUrls: [
            ...(segmentPrevisUrl ? [segmentPrevisUrl] : []),
            ...(block.seedance25RefVideoUrls || []),
          ],
          continuityVideoUrl: wanContinuityVideoUrl,
        });
        // Wan 的音频只收 https：母轨按 gcsUri 现签；母轨存在时就是唯一音轨
        const wanMasterUrl = segmentMasterEntry
          ? await freshManhuaSegmentReferenceUrl(segmentMasterEntry)
          : undefined;
        const wanAudioUrls = Array.from(
          new Set(
            (wanMasterUrl ? [wanMasterUrl] : seedanceAudioUrls)
              .map((audioUrl) => String(audioUrl || "").trim())
              .filter((audioUrl) => /^https?:\/\//i.test(audioUrl)),
          ),
        );
        const wanPrompt = [
          buildWanReferenceRoleBlock(wanImages, keptEntries),
          buildWanVideoReferenceRoleBlock(wanVideoUrls, {
            continuityVideoUrl: wanContinuityVideoUrl,
            previsVideoUrl: segmentPrevisUrl,
            motionGuideZh: segmentPrevisUrl ? segmentRefs?.previs?.motionGuideZh : undefined,
          }),
          buildWanAudioReferenceRoleBlock(wanAudioUrls, voicePlan.attached, {
            accentFallbackUrl,
            masterAudioUrl: wanMasterUrl,
          }),
          isClip ? stripManhuaStaleAssetBindForModel(motionPrompt) : motionPrompt,
          voiceOneLine ? `【声线】${voiceOneLine}` : "",
          audioRefBlock,
        ]
          .filter(Boolean)
          .join("\n")
          .trim();
        const wanOpts = {
          videoUrls: wanVideoUrls,
          audioUrls: wanAudioUrls,
          duration: clipDurationRaw ?? 30,
          resolution: block.videoResolution,
          episodeIndex: block.episodeIndex,
          clipIndex: parseClipIndexFromBlockId(block.id),
          idempotencyKey: submissionKey,
          intentId: submissionKey,
          manhuaPilot,
        } as const;
        // 与 Seedance 同一道闸：准备器产出 → 共用结算点 → 才提交。
        const wanGuard = settleManhuaOutbound(
          prepareWan30Outbound({
            prompt: wanPrompt,
            images: wanImages,
            aspectRatio: ar,
            ...wanOpts,
          }),
          runOptions,
          { block, executingUserId: String(deps.userId || "") },
        );
        url = await runWan30(wanPrompt, wanImages, ar, {
          ...wanOpts,
          beforeSubmit: wanGuard,
          onTaskId: (taskId) =>
            deps.onVideoTaskCreated?.(block.id, { taskId, engine: "wan-3.0" }),
        });
      } else if (useHappyHorse) {
        const firstFrame = String(seedStill || "").trim();
        if (!/^https?:\/\//i.test(firstFrame)) {
          throw new Error("Happy Horse 成片需要至少一张首帧参考图（请先出静帧或上传参考）");
        }
        // 0825 r2v：取图口径与 Wan 相同（块上收集的参考图集）；≥2 张服务端自动切多图参考
        const hhImages = httpsImages.length ? httpsImages : ([firstFrame].filter(Boolean) as string[]);
        const hhOpts = {
          duration: clipDuration,
          resolution: block.videoResolution,
          episodeIndex: block.episodeIndex,
          clipIndex: parseClipIndexFromBlockId(block.id),
          imageUrls: hhImages,
          idempotencyKey: submissionKey,
          intentId: submissionKey,
        } as const;
        const hhPrepared = prepareHappyHorseOutbound({
          prompt: seedancePrompt,
          imageUrl: firstFrame,
          aspectRatio: ar,
          ...hhOpts,
        });
        const hhGuard = settleManhuaOutbound(hhPrepared, runOptions, {
          block,
          executingUserId: String(deps.userId || ""),
        });
        // 与其余引擎同口径：编译未通过就拦，不截断也不照发
        throwIfOutboundCompileBlocked(hhPrepared.compile);
        // 原样提交准备器产出的那一份，不再另构造
        url = await runHappyHorse(hhPrepared.body, hhGuard);
      } else if (useHailuoH3) {
        // H3：OpenRouter 仅图参考（首帧 + input_references）；不传 Seedance 专属音/视频参考
        const h3Opts = {
          imageUrls: httpsImages.length ? httpsImages : undefined,
          duration: clipDuration,
          resolution: block.videoResolution,
          episodeIndex: block.episodeIndex,
          clipIndex: parseClipIndexFromBlockId(block.id),
          manhuaPilot,
          idempotencyKey: submissionKey,
          intentId: submissionKey,
        } as const;
        const h3Guard = settleManhuaOutbound(
          prepareHailuo3CanvasOutbound({
            prompt: seedancePrompt,
            imageUrl: seedStill,
            aspectRatio: ar,
            ...h3Opts,
          }),
          runOptions,
          { block, executingUserId: String(deps.userId || "") },
        );
        url = await runHailuo3(seedancePrompt, seedStill, ar, {
          ...h3Opts,
          beforeSubmit: h3Guard,
          onTaskId: (taskId) => deps.onVideoTaskCreated?.(block.id, { taskId, engine: videoModel }),
        });
      } else {
        const userSelectedVideoRaw = String(block.refVideoUrl || uploadedVideoUrl || "").trim();
        const userSelectedVideoUrl =
          userSelectedVideoRaw &&
          (looksLikeVideo(userSelectedVideoRaw) ||
            block.uploadedAssets?.some(
              (a) =>
                a.url === userSelectedVideoRaw &&
                (a.kind === "video" || looksLikeVideo(a.fileName || "")),
            ))
            ? userSelectedVideoRaw
            : undefined;
        const userRefVideos = (block.seedance25RefVideoUrls || [])
          .map((u) => String(u || "").trim())
          .filter((u) => /^https?:\/\//i.test(u));
        const userRefAudios = (block.seedance25RefAudioUrls || [])
          .map((u) => String(u || "").trim())
          .filter((u) => /^(?:https:\/\/|gs:\/\/)/i.test(u));
        // 漫剧工厂段级参考：白模只在多模态参考模式注入（局部编辑时 @视频1 必须是原片）；
        // 母轨一旦存在就是唯一音轨，逐句配音不再并列送（多轨相加会超供应商 30 s 上限）。
        const segmentMasterUrl = segmentMasterEntry
          ? String(segmentMasterEntry.gcsUri || segmentMasterEntry.url || "").trim() || undefined
          : undefined;
        // 用户显式参考（白模 / 勾选 / 上传 / 上游接力）；本节点旧成片不在其中，见 ownOutputAsSource。
        const userVideoUrls = await refreshManhuaRegisteredClipUrls(
          block.manhuaSegmentRefs?.registered,
          Array.from(
            new Set([
              ...(segmentPrevisUrl ? [segmentPrevisUrl] : []),
              ...userRefVideos,
              // 用户勾选/上传的参考视频排在接力成片之前：正文里的 @视频1 按数组顺序绑定。
              // refVideoUrl 为空时兜底到上传记录里的首个视频（uploadedVideoUrl），不静默丢失。
              // clip 段的 refVideoUrl 就是上段接力片（非用户勾选），有白模时同样不送
              ...(useSeedance25 && userSelectedVideoUrl && !(isClip && segmentPrevisUrl)
                ? [userSelectedVideoUrl]
                : []),
              // 有白模时不再送上段接力片：三条 30 s 叠到 90 s 会被拒，
              // 且接力片没有序号说明，模型会把它也当站位参考。承接靠尾帧图（imageUrls）。
              ...(continuityVideoUrl && !segmentPrevisUrl ? [continuityVideoUrl] : []),
            ]),
          ),
        );
        const audioBindings = compileCanvasAudioBindings({
          // 母轨就是唯一音轨：已采用的逐句配音也不并列（两套对白打架、总时长超 30 s）
          studio: segmentMasterUrl ? undefined : block.audioStudio,
          existingAudioUrls: segmentMasterUrl
            ? [segmentMasterUrl]
            : [...userRefAudios, ...seedanceAudioUrls],
          durationSec: clipDuration,
        });
        const candidateAudioUrls = audioBindings.audioUrls;
        // 模式按用户显式参考推断，本节点旧成片不参与推断。
        const workMode = useSeedance25
          ? normalizeSeedance25EvolinkMode(block.seedance25WorkMode, {
              imageUrls: httpsImages,
              videoUrls: userVideoUrls,
              audioUrls: candidateAudioUrls,
            })
          : undefined;
        // 本节点旧成片只在「编辑/延长」才是源片。reference_to_video 重跑不得把上一条成片
        // 静默追加进参考视频（0908 BytePlus 拒单：index 1 的 30.08s 旧片超过参考时长上限；
        // 重跑本来就不该继承上一条）。
        const ownOutputAsSource =
          useSeedance25 &&
          (workMode === "video_edit" || workMode === "video_extend") &&
          block.outputUrl &&
          looksLikeVideo(block.outputUrl)
            ? [block.outputUrl]
            : [];
        const candidateVideoUrls = Array.from(new Set([...userVideoUrls, ...ownOutputAsSource]));
        const segmentGuide = formatManhuaSegmentReferenceGuideZh({
          previsVideoIndex: segmentPrevisUrl ? candidateVideoUrls.indexOf(segmentPrevisUrl) + 1 : 0,
          motionGuideZh: segmentPrevisUrl ? segmentRefs?.previs?.motionGuideZh : undefined,
          masterAudioIndex: segmentMasterUrl ? candidateAudioUrls.indexOf(segmentMasterUrl) + 1 : 0,
        });
        const storyboard = String(block.seedance25TimestampStoryboard || "").trim();
        const promptWithStoryboard = [
          seedancePrompt,
          segmentGuide,
          storyboard ? `【秒级分镜】\n${storyboard}` : "",
        ]
          .filter(Boolean)
          .join("\n\n");
        let editSourceDurationSec: number | undefined;
        let finalPrompt = audioBindings.promptAppendix
          ? `${promptWithStoryboard}\n\n${audioBindings.promptAppendix}`
          : promptWithStoryboard;
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
        const seedanceOpts = {
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
          manhuaPilot,
          idempotencyKey: submissionKey,
          intentId: submissionKey,
          onTaskId: (taskId: string) =>
            deps.onVideoTaskCreated?.(block.id, { taskId, engine: videoModel }),
          editSourceDurationSec,
          episodeIndex: block.episodeIndex,
          clipIndex: parseClipIndexFromBlockId(block.id),
          resolution: block.videoResolution,
        } as const;
        const seedanceFirstFrame =
          useSeedance25 && workMode === "text_to_video" ? undefined : seedStill;
        // 与预览同源：同一个准备器、同一个结算点。
        const seedanceGuard = settleManhuaOutbound(
          {
            ...buildSeedanceCanvasRequestBody(
              finalPrompt,
              seedanceFirstFrame,
              ar,
              seedanceOpts,
            ),
            engine: videoModel,
          },
          runOptions,
          { block, executingUserId: String(deps.userId || "") },
        );
        const seedanceOut = await runSeedanceProductVideo(
          finalPrompt,
          seedanceFirstFrame,
          ar,
          { ...seedanceOpts, beforeSubmit: seedanceGuard },
        );
        url = seedanceOut.videoUrl;
        if (useSeedance25) {
          console.info(
            `[canvasRunBlock] seedance25 · provider=evolink · workMode=${seedanceOut.workMode || workMode}`,
          );
        }
      }
    }
    if (manhuaPilot) deps.onManhuaPilotChanged?.();
    const lastFrameUrl = await captureManhuaClipResultTail(deps, block.id, url);
    return {
      outputUrl: url,
      lastFrameUrl,
      seedance25ThreadId,
      seedance25WebThreadLink,
    };
  }

  throw new Error("未知方块类型");
}

/**
 * 上传件签名链 60 分钟过期（0908 实录：EvoLink「输入媒体下载不了」）。
 * 提交前按 gcsUri 现签；签不到就退回原链，不在这里挡出片。
 */
async function freshManhuaSegmentReferenceUrl(
  entry: ManhuaSegmentReferenceEntry,
): Promise<string | undefined> {
  if (entry.gcsUri) {
    try {
      const fresh = String(await resolveCanvasMaterialUrl(entry.gcsUri) || "").trim();
      if (/^https:\/\//i.test(fresh)) return fresh;
    } catch {
      // 退回已存链
    }
  }
  const stored = String(entry.url || "").trim();
  return /^https?:\/\//i.test(stored) ? stored : undefined;
}

/** 登记成片被拿去局部编辑/接力时，把过期的登记链换成现签链，其余候选原样。 */
async function refreshManhuaRegisteredClipUrls(
  registered: ManhuaSegmentReferenceEntry | undefined,
  urls: string[],
): Promise<string[]> {
  if (!registered?.gcsUri) return urls;
  // 云草稿回读后 url 可能被清成空串（只剩 gcsUri）：此时按“最后一个候选是登记片”无法判定，
  // 只在候选里确实有登记链时替换；url 为空则不动，出片仍走现有候选。
  if (!registered.url || !urls.includes(registered.url)) return urls;
  const fresh = await freshManhuaSegmentReferenceUrl(registered);
  if (!fresh || fresh === registered.url) return urls;
  return Array.from(new Set(urls.map((u) => (u === registered.url ? fresh : u))));
}

export { uploadFileToSignedUrl, resolveCanvasMaterialUrl } from "./omniCanvasApi";
