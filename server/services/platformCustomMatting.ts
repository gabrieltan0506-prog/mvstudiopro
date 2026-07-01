import type { PlatformMattingAspectRatio, PlatformMattingBatchCount } from "../../shared/plans.js";
import { appendImageFlowLog } from "./proxyImageService.js";
import { postEvolinkGptImage2AndUpload } from "./evolinkGptImage2.js";
import { runGemini31ProPreviewText } from "./geminiPlatformCompositeTranslation.js";

/** 用户描述里出现这些词时，按「去背景 / 主体 isolated」模式生图（不调用 fal，仅 GPT-IMAGE-2 prompt） */
const TRANSPARENT_CUTOUT_HINT_RE =
  /自动去背景|去背景|透明|抠图|绿幕|抠像|alpha\s*channel|cutout|transparent\s*background|isolated\s*subject/i;

const SCENE_IMAGE_QUALITY_SUFFIX_EN = [
  "Follow the user's described subject, pose, clothing, props, and background scene exactly.",
  "Photorealistic, natural lighting, cohesive environment, cinematic composition.",
  "No text overlay, no watermark, no collage unless explicitly requested.",
].join(" ");

/** 去背景模式：一次生图直出干净白底主体（无 fal 后处理） */
const ISOLATED_SUBJECT_SUFFIX_EN = [
  "Isolated subject only, no environment, no scenery, no props in background.",
  "Pure solid clean white (#FFFFFF) studio backdrop, soft even lighting, sharp subject edges.",
  "Full subject visible as described; photorealistic; ready for compositing onto other scenes.",
  "No text, no watermark.",
].join(" ");

export function userPromptRequestsTransparentCutout(userPrompt: string): boolean {
  return TRANSPARENT_CUTOUT_HINT_RE.test(String(userPrompt || ""));
}

export async function translateMattingUserPromptToEnglish(userPrompt: string, flowLog?: string[]): Promise<string> {
  const raw = String(userPrompt || "").trim();
  if (!raw) return "";
  const hasCjk = /[\u4e00-\u9fff]/.test(raw);
  if (!hasCjk) {
    appendImageFlowLog(flowLog, "[自定义抠像] 用户提示词已为英文，跳过翻译");
    return raw;
  }
  appendImageFlowLog(flowLog, "[自定义抠像] 中文提示词 → Gemini 英文化");
  const task = [
    "Translate the following user description into concise English for an AI image generation prompt.",
    "Preserve subject identity, pose (e.g. sitting, standing), clothing, and props on the subject.",
    "If the user asks for background removal / isolated subject, omit background scenery in translation.",
    "If the user describes a scene (beach, study room), keep that background.",
    "Output English only, no markdown.",
    "",
    raw,
  ].join("\n");
  try {
    const english = String(await runGemini31ProPreviewText(task)).trim();
    if (english.length >= 8) return english;
  } catch (e: unknown) {
    appendImageFlowLog(flowLog, `[自定义抠像] 翻译失败，回退原文：${String((e as Error)?.message || e).slice(0, 120)}`);
  }
  return raw;
}

export function buildMattingEnglishPrompt(
  userEnglish: string,
  aspectRatio: PlatformMattingAspectRatio,
  transparentCutout: boolean,
): string {
  const subject = String(userEnglish || "").trim();
  return [
    subject,
    `Framing aspect ratio ${aspectRatio}.`,
    transparentCutout ? ISOLATED_SUBJECT_SUFFIX_EN : SCENE_IMAGE_QUALITY_SUFFIX_EN,
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function generateOneMattingImage(
  englishPrompt: string,
  aspectRatio: PlatformMattingAspectRatio,
  slotIndex: number,
  transparentCutout: boolean,
  flowLog?: string[],
): Promise<string | null> {
  const gcsSubdir = `platform-custom-matting/${aspectRatio.replace(":", "x")}`;
  const evoErr: { message?: string } = {};
  const imageUrl = await postEvolinkGptImage2AndUpload(englishPrompt, gcsSubdir, {
    size: aspectRatio,
    flowLog,
    quality: "medium",
    captureError: evoErr,
  });
  if (!imageUrl) {
    appendImageFlowLog(flowLog, `[自定义抠像] 第 ${slotIndex + 1} 张生图失败：${String(evoErr.message || "未知").slice(0, 160)}`);
    return null;
  }
  appendImageFlowLog(
    flowLog,
    `[自定义抠像] 第 ${slotIndex + 1} 张完成 · 模式=${transparentCutout ? "白底主体（去背景）" : "场景生图"}`,
  );
  return imageUrl;
}

export async function generatePlatformCustomMattingImages(options: {
  userPrompt: string;
  aspectRatio: PlatformMattingAspectRatio;
  count: PlatformMattingBatchCount;
  flowLog?: string[];
}): Promise<{ imageUrls: string[]; englishPrompt: string; transparentCutout: boolean }> {
  const L = options.flowLog;
  const userPrompt = String(options.userPrompt || "").trim();
  if (userPrompt.length < 4) {
    throw new Error("请至少输入 4 个字的描述");
  }
  const transparentCutout = userPromptRequestsTransparentCutout(userPrompt);
  appendImageFlowLog(
    L,
    `[自定义抠像] 开始 · 比例=${options.aspectRatio} · 张数=${options.count} · 模式=${transparentCutout ? "白底主体（去背景）" : "场景生图"} · GPT-IMAGE-2 单次出图 · 用户描述约 ${userPrompt.length} 字`,
  );
  const englishSubject = await translateMattingUserPromptToEnglish(userPrompt, L);
  const englishPrompt = buildMattingEnglishPrompt(englishSubject, options.aspectRatio, transparentCutout);
  const imageUrls: string[] = [];
  for (let i = 0; i < options.count; i += 1) {
    const url = await generateOneMattingImage(englishPrompt, options.aspectRatio, i, transparentCutout, L);
    if (url) imageUrls.push(url);
  }
  if (imageUrls.length === 0) {
    throw new Error("生成失败，请调整描述后重试");
  }
  appendImageFlowLog(L, `[自定义抠像] 完成 · 成功 ${imageUrls.length}/${options.count} 张`);
  return { imageUrls, englishPrompt, transparentCutout };
}
