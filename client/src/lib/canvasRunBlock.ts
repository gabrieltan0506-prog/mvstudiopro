import type { CanvasBlock } from "./canvasTypes";
import {
  createOmniInteraction,
  pollOmniInteractionUntilDone,
  runGeminiScript,
  runNanoImage,
} from "./omniCanvasApi";

const GEMINI_MODEL_MAP = {
  "gemini-3.1-pro": "gemini-3.1-pro-preview",
} as const;

export type CanvasRunDeps = {
  optimizeCopy: (input: { sourceText: string; optimizationBrief?: string }) => Promise<string>;
};

async function runGptImage2(prompt: string, aspectRatio: "9:16" | "16:9", refImageUrl?: string): Promise<string> {
  const res = await fetch(`/api/jobs?op=workflowGenerateSceneImage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      scenePrompt: prompt,
      imageModel: "gpt-image-1",
      sceneCount: 1,
      aspectRatio,
      referenceImageUrl: refImageUrl || undefined,
    }),
  });
  const json = (await res.json()) as {
    error?: string;
    message?: string;
    storyboardImages?: Array<{ selectedSceneImageUrl?: string }>;
  };
  if (!res.ok) throw new Error(json.error || json.message || "GPT-Image-2 生图失败");
  const url = json.storyboardImages?.[0]?.selectedSceneImageUrl;
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

async function pollVeoTask(taskId: string): Promise<string> {
  for (let i = 0; i < 90; i++) {
    const res = await fetch(`/api/google?op=veoPoll&taskId=${encodeURIComponent(taskId)}`);
    const json = (await res.json()) as { ok?: boolean; videoUrl?: string; status?: string; error?: string };
    if (json.videoUrl) return json.videoUrl;
    if (json.status === "failed") throw new Error(json.error || "Veo 生成失败");
    await new Promise((r) => setTimeout(r, 4000));
  }
  throw new Error("Veo 任务超时");
}

async function runVeo31(prompt: string, imageUrl: string | undefined, aspectRatio: "9:16" | "16:9"): Promise<string> {
  const createRes = await fetch(`/api/google?op=veoCreate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      imageUrl,
      provider: "pro",
      durationSeconds: 8,
      aspectRatio,
      resolution: "720p",
    }),
  });
  const createJson = (await createRes.json()) as { taskId?: string; error?: string; message?: string };
  const taskId = String(createJson.taskId || "").trim();
  if (!taskId) throw new Error(createJson.error || createJson.message || "Veo 任务创建失败");
  return pollVeoTask(taskId);
}

async function runSeedance20(prompt: string, imageUrl: string | undefined, aspectRatio: "9:16" | "16:9"): Promise<string> {
  if (!imageUrl) throw new Error("Seedance 2.0 需要参考图片，请先从图片方块引用或上传");
  const res = await fetch(`/api/jobs?op=seedanceI2V`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      imageUrl,
      resolution: "720p",
      aspectRatio,
      duration: 10,
    }),
  });
  const json = (await res.json()) as { videoUrl?: string; error?: string; message?: string };
  if (!res.ok || !json.videoUrl) throw new Error(json.error || json.message || "Seedance 2.0 生成失败");
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

export async function runCanvasBlock(
  deps: CanvasRunDeps,
  block: CanvasBlock,
  upstream: CanvasUpstreamContext = { visionImages: [], texts: [] },
): Promise<{
  outputText?: string;
  outputUrl?: string;
  outputUrls?: string[];
}> {
  const prompt = block.prompt.trim();
  if (!prompt) throw new Error("请先填写提示词");

  const refUrl = block.refImageUrl || upstream.visionImages[0]?.url;
  const refTexts = upstream.texts.filter(Boolean);
  const mergedPrompt = refTexts.length
    ? `${prompt}\n\n【引用上游文本】\n${refTexts.join("\n\n---\n\n").slice(0, 12000)}`
    : prompt;

  const visionImages = upstream.visionImages.filter((i) => i.url || i.gcsUri);

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
    const urls =
      block.imageModel === "gpt-image-2"
        ? await runGptImage2Batch(mergedPrompt, ar, refUrl, count)
        : await runNanoBanana2(mergedPrompt, ar, refUrl, count);
    const filtered = urls.filter(Boolean);
    if (!filtered.length) throw new Error("图片生成返回为空");
    return { outputUrl: filtered[0], outputUrls: filtered };
  }

  if (block.kind === "video") {
    const ar = block.aspectRatio;
    let url = "";
    if (block.videoModel === "veo-3.1") {
      url = await runVeo31(mergedPrompt, refUrl, ar);
    } else if (block.videoModel === "seedance-2.0") {
      url = await runSeedance20(mergedPrompt, refUrl, ar);
    } else {
      url = await runOmniFlash(mergedPrompt, refUrl, ar);
    }
    return { outputUrl: url };
  }

  throw new Error("未知方块类型");
}

export { uploadFileToSignedUrl, resolveOmniMaterialUrl } from "./omniCanvasApi";
