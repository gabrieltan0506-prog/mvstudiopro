import type { CanvasBlock } from "./canvasTypes";
import { withFlyHealthGate } from "./flyHealthGate";
import { flyHealthProbeOriginForUrl, withLongJobsFlyDirect } from "./longJobsFlyOrigin";
import { createJobSameOrigin, pollJobUntilTerminal } from "./jobs";
import {
  createOmniInteraction,
  pollOmniInteractionUntilDone,
  runGeminiScript,
  runNanoImage,
} from "./omniCanvasApi";
import {
  compileI2VMotionPrompt,
  extractPlainImagePrompt,
  fallbackEnglishFromJson,
  prepareJsonDirectorImageJob,
  type AspectRatio169Or916,
} from "@shared/jsonDirectorMiddleware";
import { buildCanvasGptImage2JobInput } from "@shared/canvasGptImage2JobInput";
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
} from "@shared/manhuaClipContinuity";
import { MANHUA_KEYART_NO_TEXT_EN } from "@shared/manhuaScriptWorkbench";

const GEMINI_MODEL_MAP = {
  "gemini-3.1-pro": "gemini-3.1-pro-preview",
} as const;

/** 客户端轮询上限：须略大于 worker CANVAS_GPT_IMAGE2_JOB_TIMEOUT_MS（默认 10min） */
const CANVAS_GPT_IMAGE2_POLL_MAX_MS = 12 * 60_000;

export type CanvasRunDeps = {
  optimizeCopy: (input: {
    sourceText: string;
    optimizationBrief?: string;
    /** 画布文本模型：gpt-5.6-sol / gpt-5.6-terra / gpt-5.5 / gpt-5.4 */
    modelName?: string;
  }) => Promise<string>;
  /** 把 dataURL/本地图上传为 HTTPS，供 Evolink/Seedance 引用（可选） */
  uploadImageFile?: (file: File) => Promise<string>;
  /** 入队 jobs 时写入 userId（与 assemble 一致；可空串） */
  userId?: string;
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
  imageModel: CanvasBlock["imageModel"],
): Promise<string> {
  const target = imageModel === "gpt-image-2" ? "gpt-image-2" : "nano-banana";
  const job = prepareJsonDirectorImageJob({
    userPrompt,
    aspectRatio,
    targetModel: target,
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
  },
): Promise<string> {
  const refImageUrl = String(opts?.refImageUrl || "").trim();
  const extraRefs = (opts?.referenceImageUrls || []).map((u) => String(u || "").trim()).filter(Boolean);
  const referenceImageUrls = Array.from(new Set([refImageUrl, ...extraRefs].filter(Boolean))).slice(0, 16);
  const maskUrl = String(opts?.maskUrl || "").trim();
  const openaiOnly = Boolean(opts?.openaiOnly);
  const userId = String(opts?.userId || "");

  const attemptOnce = async (): Promise<string> => {
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
      return await attemptOnce();
    }
    throw firstErr;
  }
}

async function runNanoBanana2(
  prompt: string,
  aspectRatio: string,
  refImageUrl?: string,
  count = 1,
): Promise<string[]> {
  const urls = await runNanoImage({
    prompt,
    aspectRatio,
    imageUrl: refImageUrl,
    imageSize: "2K",
    model: "gemini-3.1-flash-image-preview",
    tier: "flash",
    numberOfImages: count,
  });
  return urls.filter(Boolean);
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
  },
  count: number,
): Promise<string[]> {
  const tasks = Array.from({ length: count }, () => runGptImage2(prompt, aspectRatio, opts));
  return Promise.all(tasks);
}

export type CanvasVisionImage = { url: string; gcsUri?: string; mimeType?: string };

export type CanvasUpstreamContext = {
  visionImages: CanvasVisionImage[];
  texts: string[];
};

async function runCanvasVisionMarkdown(prompt: string, images: CanvasVisionImage[]): Promise<string> {
  const resp = await fetch("/api/google?op=canvasVisionMarkdown", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      images,
      model: "gemini-3.1-pro-preview",
    }),
  });
  const json = (await resp.json()) as { ok?: boolean; markdown?: string; error?: string; message?: string };
  if (!resp.ok || !json.ok) throw new Error(json.error || json.message || "多图视觉分析失败");
  const md = String(json.markdown || "").trim();
  if (!md) throw new Error("多图分析返回为空");
  return md;
}

async function runVideoReversePrompt(
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
    images = fallbackImages.map((i) => ({
      url: i.url || "",
      mimeType: i.mimeType || "image/jpeg",
    })).filter((i) => i.url);
  }

  // 无片/无帧：仍可根据上游节拍文案生成编导分镜表（工厂自动跑必需）
  if (!images.length) {
    const md = await runGeminiScript(
      [
        VIDEO_REVERSE_SYSTEM_PROMPT,
        "没有参考帧时，请仅根据用户节拍/故事补全输出。",
        "",
        buildVideoReverseUserPrompt({
          userHint: userHint || "根据上游节拍补全八维编导分镜表与 Seedance 微动句",
          outputMode: mode,
          targetEngine: "seedance-2.0",
        }),
      ].join("\n"),
      GEMINI_MODEL_MAP["gemini-3.1-pro"],
    );
    if (!md.trim()) throw new Error("无片反推返回为空");
    return md.trim();
  }

  const resp = await fetch("/api/google?op=videoReversePrompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userHint: userHint || "反推分镜与 Seedance 微动提示词",
      images,
      model: "gemini-3.1-pro-preview",
      targetEngine: "seedance-2.0",
      outputMode: mode,
    }),
  });
  const json = (await resp.json()) as { ok?: boolean; markdown?: string; error?: string; message?: string };
  if (!resp.ok || !json.ok) throw new Error(json.error || json.message || "视频反推失败");
  const md = String(json.markdown || "").trim();
  if (!md) throw new Error("视频反推返回为空");
  return md;
}

async function runSeedance20(
  prompt: string,
  imageUrl: string | undefined,
  aspectRatio: "9:16" | "16:9",
  opts?: {
    imageUrls?: string[];
    videoUrls?: string[];
    version?: "2.0" | "2.0-fast";
  },
): Promise<string> {
  // 与 Creative / TestLab 一致：直连 Fly/api 子域，避免 www→Vercel→Fly 反代 ~120s 被 ROUTER_EXTERNAL 腰斩
  const seedanceUrl = withLongJobsFlyDirect("/api/jobs?op=seedanceI2V");
  const probeOrigin = flyHealthProbeOriginForUrl(seedanceUrl);
  const imageUrls = (opts?.imageUrls || []).map((u) => String(u || "").trim()).filter(Boolean);
  const videoUrls = (opts?.videoUrls || []).map((u) => String(u || "").trim()).filter(Boolean);
  const version = opts?.version === "2.0-fast" ? "2.0-fast" : "2.0";
  const res = await withFlyHealthGate(probeOrigin, () =>
    fetch(seedanceUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "omit",
      body: JSON.stringify({
        prompt,
        imageUrl: imageUrl || imageUrls[0] || undefined,
        imageUrls: imageUrls.length ? imageUrls.slice(0, 6) : undefined,
        videoUrls: videoUrls.length ? videoUrls.slice(0, 3) : undefined,
        resolution: version === "2.0-fast" ? "720p" : "720p",
        aspectRatio,
        duration: 15,
        generateAudio: true,
        version,
      }),
    }),
  );
  const text = await res.text();
  let json: { videoUrl?: string; error?: string; message?: string; ok?: boolean } = {};
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    throw new Error(
      /An error o|ROUTER_EXTERNAL/i.test(text)
        ? "成片网关超时，请稍后重试（已尽量直连长任务 API）"
        : `成片生成失败：${text.slice(0, 160)}`,
    );
  }
  if (!res.ok || !json.videoUrl) {
    throw new Error(json.error || json.message || "成片生成失败");
  }
  return String(json.videoUrl);
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

  const mergedPrompt = formatCanvasUpstreamPrompt(
    prompt || "请根据上游内容完成本步骤生成。",
    effectiveTexts,
  );

  if (block.kind === "text" || block.kind === "copy_organize") {
    if (visionImages.length > 0) {
      const visionPrompt =
        block.kind === "copy_organize"
          ? `${mergedPrompt}\n\n请识别所有图片内容，归纳整理成 Markdown 文档：重复部分去掉，标题清晰，内容详尽，条理分明。`
          : mergedPrompt;
      const text = await runCanvasVisionMarkdown(visionPrompt, visionImages);
      return { outputText: text };
    }

    const model = block.textModel;
    if (model === "gemini-3.1-pro") {
      const text = await runGeminiScript(
        block.kind === "copy_organize"
          ? `请整理以下内容为结构化 Markdown 发布稿（含标题、分段、平台要点）：\n\n${mergedPrompt}`
          : mergedPrompt,
        GEMINI_MODEL_MAP["gemini-3.1-pro"],
      );
      return { outputText: text };
    }
    const brief =
      model === "gpt-5.6-terra" || model === "gpt-5.4"
        ? "你是创作助手：根据原文直接输出可发布的完整 Markdown 文案，语气专业、有画面感。"
        : "你是创作助手：深度优化并输出可直接发布的完整 Markdown（含标题、正文、平台适配要点）。";
    const sourceText = mergedPrompt.length >= 10 ? mergedPrompt : `${mergedPrompt}\n（请补全为完整创作文案）`;
    const text = await deps.optimizeCopy({
      sourceText,
      optimizationBrief: block.kind === "copy_organize" ? `整理文案结构。\n${brief}` : brief,
      modelName: model,
    });
    return { outputText: text };
  }

  if (block.kind === "image") {
    const ar = block.aspectRatio;
    const count = block.imageBatchCount || 1;
    const isKeyart = block.id.startsWith("keyart-");
    let isEdit = block.imageMode === "edit";
    const keyartPromptBlob = String(mergedPrompt || block.prompt || "");
    const isCgKeyart =
      isKeyart && /画风硬锁】?\s*CG\s*漫剧|【画风执行·CG 漫剧】/.test(keyartPromptBlob);
    /** CG：禁止库内仿真人示范 edit；允许「设定卡身份锁」edit */
    const cgIdentityLockEdit = /设定卡身份锁|CG·设定卡/.test(keyartPromptBlob);
    if (isCgKeyart && isEdit && !cgIdentityLockEdit) {
      isEdit = false;
    }
    /** 默认 Image-2；用户手选 NB2 省钱则尊重（计费不同） */
    const imageModel: CanvasBlock["imageModel"] =
      block.imageModel === "nano-banana-2" ? "nano-banana-2" : "gpt-image-2";
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
      // 浏览器无 origin 时无法绝对化：关键静帧降级文生图，其它节点仍报错
      if (isKeyart) {
        isEdit = false;
        editRef = "";
      } else {
        throw new Error("微调模式需要可访问的底图 URL（HTTPS）");
      }
    }
    if (isEdit && !editRef) {
      if (isKeyart) {
        isEdit = false;
      } else {
        throw new Error("微调模式需要底图：请先上传图片，或先文生图后再点「微调这张图」");
      }
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
          isKeyart ? MANHUA_KEYART_NO_TEXT_EN : "",
        ]
          .filter(Boolean)
          .join("\n")
      : isKeyart
        ? `${String(mergedPrompt || "").trim()}\n\n${MANHUA_KEYART_NO_TEXT_EN}`
        : await resolveImagePromptViaJsonDirector(deps, mergedPrompt, ar, imageModel);
    // 关键静帧：英文禁字再钉死一次（直送路径已拼过则去重）
    const imagePrompt = isKeyart
      ? rawImagePrompt.includes(MANHUA_KEYART_NO_TEXT_EN)
        ? rawImagePrompt.trim()
        : `${rawImagePrompt.trim()}\n\n${MANHUA_KEYART_NO_TEXT_EN}`
      : rawImagePrompt;
    /** 主路径 Image-2；失败回退 NB2。显式手选 NB2 省钱时直走，不先打 Image-2 */
    const preferGptImage2 = imageModel !== "nano-banana-2";
    /**
     * 关键静帧文生图：禁止带 ref（否则 API 会改走 edits，CG 锁失效且更易超时）。
     * 非 keyart 的普通 image 仍可带 ref 做图生图。
     */
    const gptUserId = String(deps.userId || "");
    const gptImageOpts = isEdit
      ? {
          refImageUrl: editRef,
          referenceImageUrls: fusionUrls,
          maskUrl: maskUrl || undefined,
          openaiOnly: isKeyart,
          userId: gptUserId,
        }
      : isKeyart
        ? { openaiOnly: true as const, userId: gptUserId }
        : { refImageUrl: absRef(refUrl) || refUrl, userId: gptUserId };
    let urls: string[] = [];
    if (preferGptImage2) {
      try {
        urls = await runGptImage2Batch(imagePrompt, ar, gptImageOpts, count);
      } catch (primaryErr) {
        const reason =
          primaryErr instanceof Error ? primaryErr.message.slice(0, 160) : "GPT-Image-2 失败";
        // 关键静帧：edit/融图失败 → 纯文生图重做（不能套用就重新生成）
        if (isKeyart && isEdit) {
          try {
            // 关键帧重做同样直送中文提示，避免再等一轮编译
            const regenPrompt = `${String(mergedPrompt || "").trim()}\n\n${MANHUA_KEYART_NO_TEXT_EN}`;
            urls = await runGptImage2Batch(
              regenPrompt,
              ar,
              { openaiOnly: true, userId: gptUserId },
              count,
            );
            console.warn(`[canvasRunBlock] keyart edit/融图失败，已文生图重做：${reason}`);
          } catch (regenErr) {
            const rr = regenErr instanceof Error ? regenErr.message.slice(0, 120) : "文生图重做失败";
            try {
              urls = await runNanoBanana2(imagePrompt, ar, undefined, count);
              console.warn(`[canvasRunBlock] keyart 文生图重做失败，回退 NB2：${rr}`);
            } catch (fallbackErr) {
              const fb =
                fallbackErr instanceof Error ? fallbackErr.message : "Nano Banana 2 回退也失败";
              throw new Error(`生图失败（融图：${reason}；重做：${rr}；回退：${fb}）`);
            }
          }
        } else if (isKeyart) {
          // 静帧已钉官方 OpenAI；超时/失败不再拼 OpenRouter 文案吓唬用户，可回退 NB2
          try {
            urls = await runNanoBanana2(imagePrompt, ar, undefined, count);
            console.warn(`[canvasRunBlock] keyart 官方 Image-2 失败，已回退 NB2：${reason}`);
          } catch (fallbackErr) {
            const fb =
              fallbackErr instanceof Error ? fallbackErr.message : "Nano Banana 2 回退也失败";
            throw new Error(`生图失败（官方 Image-2：${reason}；回退：${fb}）`);
          }
        } else {
          try {
            urls = await runNanoBanana2(imagePrompt, ar, isEdit ? editRef : refUrl, count);
            console.warn(`[canvasRunBlock] GPT-Image-2 失败，已回退 Nano Banana 2：${reason}`);
          } catch (fallbackErr) {
            const fb =
              fallbackErr instanceof Error ? fallbackErr.message : "Nano Banana 2 回退也失败";
            throw new Error(`生图失败（官方 Image-2：${reason}；回退：${fb}）`);
          }
        }
      }
    } else {
      urls = await runNanoBanana2(imagePrompt, ar, isEdit ? editRef : refUrl, count);
    }
    const filtered = urls.filter(Boolean);
    if (!filtered.length) throw new Error("图片生成返回为空");
    return { outputUrl: filtered[0], outputUrls: filtered };
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
    const followStillPrompt = String(mergedPrompt || "").includes("参考静帧")
      ? mergedPrompt
      : `${mergedPrompt}\n\n${MANHUA_VIDEO_FOLLOW_STILL_ZH}`;
    const motionPrompt = compileI2VMotionPrompt(
      continuityVideoUrl ? `${followStillPrompt}\n\n${MANHUA_CLIP_CONTINUITY_HINT_ZH}` : followStillPrompt,
      {
        hasReferenceImage: Boolean(stillRef || continuityVideoUrl || fusionStillUrls.length),
        pathCameraRecipeId: block.pathCameraRecipeId,
        pathAnnotationJson: block.pathAnnotationJson,
      },
    );
    const videoModel = block.videoModel || "seedance-2.0-fast";
    console.info(
      `[canvasRunBlock] video · id=${block.id} · videoModel=${videoModel} · stills=${[stillRef, ...fusionStillUrls].filter(Boolean).length} · continuity=${Boolean(continuityVideoUrl)}`,
    );
    let url = "";
    if (videoModel === "seedance-2.0" || videoModel === "seedance-2.0-fast") {
      // 参考图配额≤6：优先「本段首静帧 + 上一段末帧」再补其余静帧，避免末帧被挤掉
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
          });
          const rawFrames = frames.map((f) => f.dataUrl).filter(Boolean);
          tailFrames = await toHttpsImageUrls(deps, rawFrames);
        } catch {
          /* 抽帧/上传失败不阻断：仍传 videoUrls */
        }
      }
      const imageUrls: string[] = [];
      const pushUnique = (u?: string) => {
        const s = String(u || "").trim();
        if (s && !imageUrls.includes(s)) imageUrls.push(s);
      };
      pushUnique(stillPool[0]);
      for (const f of tailFrames) pushUnique(f);
      for (const u of stillPool.slice(1)) pushUnique(u);
      const httpsImages = await toHttpsImageUrls(deps, imageUrls.slice(0, 6));
      url = await runSeedance20(motionPrompt, stillRef, ar, {
        imageUrls: httpsImages.length ? httpsImages : undefined,
        videoUrls: continuityVideoUrl ? [continuityVideoUrl] : undefined,
        version: videoModel === "seedance-2.0-fast" ? "2.0-fast" : "2.0",
      });
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
    return { outputUrl: url };
  }

  throw new Error("未知方块类型");
}

export { uploadFileToSignedUrl, resolveOmniMaterialUrl } from "./omniCanvasApi";
