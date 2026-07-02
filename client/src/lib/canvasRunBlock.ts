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

async function runNanoBanana2(prompt: string, aspectRatio: string, refImageUrl?: string): Promise<string> {
  const urls = await runNanoImage({
    prompt,
    aspectRatio,
    imageUrl: refImageUrl,
    imageSize: "2K",
    model: "gemini-3.1-flash-image-preview",
    tier: "flash",
  });
  return urls[0] || "";
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
  parentOutput?: { text?: string; url?: string },
): Promise<{
  outputText?: string;
  outputUrl?: string;
}> {
  const prompt = block.prompt.trim();
  if (!prompt) throw new Error("请先填写提示词");

  const refText = parentOutput?.text?.trim();
  const refUrl = block.refImageUrl || parentOutput?.url;
  const mergedPrompt = refText ? `${prompt}\n\n【引用上游节点】\n${refText.slice(0, 6000)}` : prompt;

  if (block.kind === "text" || block.kind === "copy_organize") {
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
    const url =
      block.imageModel === "gpt-image-2"
        ? await runGptImage2(mergedPrompt, ar, refUrl)
        : await runNanoBanana2(mergedPrompt, ar, refUrl);
    return { outputUrl: url };
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
