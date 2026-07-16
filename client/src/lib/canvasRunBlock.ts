import type { CanvasBlock } from "./canvasTypes";
import { withFlyHealthGate } from "./flyHealthGate";
import { flyHealthProbeOriginForUrl, withLongJobsFlyDirect } from "./longJobsFlyOrigin";
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
import { extractVideoFramesFromUrl } from "./extractVideoFrames";
import {
  VIDEO_REVERSE_DEFAULT_INTERVAL_SEC,
  VIDEO_REVERSE_MAX_DURATION_SEC,
  VIDEO_REVERSE_MAX_FRAMES,
} from "@shared/videoReversePrompt";

const GEMINI_MODEL_MAP = {
  "gemini-3.1-pro": "gemini-3.1-pro-preview",
} as const;

export type CanvasRunDeps = {
  optimizeCopy: (input: { sourceText: string; optimizationBrief?: string }) => Promise<string>;
};

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

async function runGptImage2(prompt: string, aspectRatio: "9:16" | "16:9", refImageUrl?: string): Promise<string> {
  // 注意：勿再调用 workflowGenerateSceneImage（那是工作流分镜 API，强制要 workflowId）
  const gptUrl = withLongJobsFlyDirect("/api/jobs?op=canvasGptImage2");
  const probeOrigin = flyHealthProbeOriginForUrl(gptUrl);
  const res = await withFlyHealthGate(probeOrigin, () =>
    fetch(gptUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "omit",
      body: JSON.stringify({
        prompt,
        aspectRatio,
        referenceImageUrl: refImageUrl || undefined,
      }),
    }),
  );
  const text = await res.text();
  let json: { ok?: boolean; imageUrl?: string; error?: string; message?: string } = {};
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    throw new Error(
      /An error o|ROUTER_EXTERNAL/i.test(text)
        ? "算力紧张或网关超时，请稍后重试"
        : `GPT-Image-2 生图失败：${text.slice(0, 160)}`,
    );
  }
  if (!res.ok || !json.ok) throw new Error(json.error || json.message || "GPT-Image-2 生图失败");
  const url = String(json.imageUrl || "").trim();
  if (!url) throw new Error("GPT-Image-2 未返回图片 URL");
  return url;
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
  refImageUrl: string | undefined,
  count: number,
): Promise<string[]> {
  const tasks = Array.from({ length: count }, () => runGptImage2(prompt, aspectRatio, refImageUrl));
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
): Promise<string> {
  let images: Array<{ url: string; mimeType?: string }> = [];

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

  if (!images.length) {
    throw new Error("请先在本方块上传参考短片（MP4），或连接上游图片帧");
  }

  const resp = await fetch("/api/google?op=videoReversePrompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userHint: userHint || "反推分镜与 Seedance 微动提示词",
      images,
      model: "gemini-3.1-pro-preview",
      targetEngine: "seedance-2.0",
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
): Promise<string> {
  // 与 Creative / TestLab 一致：直连 Fly/api 子域，避免 www→Vercel→Fly 反代 ~120s 被 ROUTER_EXTERNAL 腰斩
  const seedanceUrl = withLongJobsFlyDirect("/api/jobs?op=seedanceI2V");
  const probeOrigin = flyHealthProbeOriginForUrl(seedanceUrl);
  const res = await withFlyHealthGate(probeOrigin, () =>
    fetch(seedanceUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "omit",
      body: JSON.stringify({
        prompt,
        imageUrl: imageUrl || undefined,
        resolution: "720p",
        aspectRatio,
        duration: 8,
        generateAudio: true,
        preferEvolink: true,
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
        ? "Seedance 网关超时，请稍后重试（已尽量直连长任务 API）"
        : `Seedance 2.0 生成失败：${text.slice(0, 160)}`,
    );
  }
  if (!res.ok || !json.videoUrl) {
    throw new Error(json.error || json.message || "Seedance 2.0 生成失败");
  }
  return String(json.videoUrl);
}

async function runOmniFlash(prompt: string, imageUrl: string | undefined, aspectRatio: "9:16" | "16:9"): Promise<string> {
  const created = await createOmniInteraction({
    prompt,
    task: imageUrl ? "image_to_video" : "text_to_video",
    aspectRatio,
    durationSeconds: 10,
    imageUrl,
  });
  const result = await pollOmniInteractionUntilDone(created.id);
  const outUrl = String(result.videoUrl || "");
  if (!outUrl) throw new Error("Omni Flash 未返回视频 URL");
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
  const visionImages = upstream.visionImages.filter((i) => i.url || i.gcsUri);
  const uploadedVideoUrl =
    block.refVideoUrl ||
    block.uploadedAssets?.find((a) => a.kind === "video" || /\.(mp4|mov|webm)(\?|$)/i.test(a.fileName || a.url))
      ?.url;

  if (block.kind === "video_reverse") {
    const hint = formatCanvasUpstreamPrompt(
      prompt || "反推分镜表与 Seedance 微动句",
      refTexts,
    );
    const text = await runVideoReversePrompt(hint, uploadedVideoUrl, visionImages);
    return { outputText: text };
  }

  if (!prompt && !refTexts.length) {
    throw new Error("请先填写提示词，或连接上游方块传递内容");
  }

  const mergedPrompt = formatCanvasUpstreamPrompt(
    prompt || "请根据上游内容完成本步骤生成。",
    refTexts,
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
      model === "gpt-5.4"
        ? "你是创作助手：根据原文直接输出可发布的完整 Markdown 文案，语气专业、有画面感。"
        : "你是创作助手：深度优化并输出可直接发布的完整 Markdown（含标题、正文、平台适配要点）。";
    const sourceText = mergedPrompt.length >= 10 ? mergedPrompt : `${mergedPrompt}\n（请补全为完整创作文案）`;
    const text = await deps.optimizeCopy({
      sourceText,
      optimizationBrief: block.kind === "copy_organize" ? `整理文案结构。\n${brief}` : brief,
    });
    return { outputText: text };
  }

  if (block.kind === "image") {
    const ar = block.aspectRatio;
    const count = block.imageBatchCount || 1;
    const imagePrompt = await resolveImagePromptViaJsonDirector(
      deps,
      mergedPrompt,
      ar,
      block.imageModel,
    );
    const urls =
      block.imageModel === "gpt-image-2"
        ? await runGptImage2Batch(imagePrompt, ar, refUrl, count)
        : await runNanoBanana2(imagePrompt, ar, refUrl, count);
    const filtered = urls.filter(Boolean);
    if (!filtered.length) throw new Error("图片生成返回为空");
    return { outputUrl: filtered[0], outputUrls: filtered };
  }

  if (block.kind === "video") {
    const ar = block.aspectRatio;
    const motionPrompt = compileI2VMotionPrompt(mergedPrompt, {
      hasReferenceImage: Boolean(refUrl),
    });
    let url = "";
    if (block.videoModel === "seedance-2.0") {
      url = await runSeedance20(motionPrompt, refUrl, ar);
    } else {
      url = await runOmniFlash(motionPrompt, refUrl, ar);
    }
    return { outputUrl: url };
  }

  throw new Error("未知方块类型");
}

export { uploadFileToSignedUrl, resolveOmniMaterialUrl } from "./omniCanvasApi";
