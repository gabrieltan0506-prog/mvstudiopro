import type { PlatformMattingAspectRatio, PlatformMattingBatchCount } from "../../shared/plans.js";
import { appendImageFlowLog } from "./proxyImageService.js";
import { postEvolinkGptImage2AndUpload } from "./evolinkGptImage2.js";
import { backgroundRemoveStep } from "../workflow/steps/backgroundRemoveStep.js";
import { runGemini31ProPreviewText } from "./geminiPlatformCompositeTranslation.js";

/** 用户描述里出现这些词时，生成后追加透明底抠图 */
const TRANSPARENT_CUTOUT_HINT_RE =
  /透明|抠图|去背景|绿幕|抠像|alpha\s*channel|cutout|transparent\s*background|isolated\s*subject/i;

const SCENE_IMAGE_QUALITY_SUFFIX_EN = [
  "Follow the user's described subject, pose, clothing, props, and background scene exactly.",
  "Photorealistic, natural lighting, cohesive environment, cinematic composition.",
  "No text overlay, no watermark, no collage unless explicitly requested.",
].join(" ");

const TRANSPARENT_CUTOUT_SUFFIX_EN = [
  "Professional isolated subject cutout for video compositing.",
  "Single clear subject on pure solid chroma green (#00FF00) backdrop for easy keying.",
  "Clean sharp edges, no cast shadow on backdrop, studio lighting, photorealistic.",
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
    "Preserve subject identity, pose (e.g. sitting, standing), clothing, props, and background scene (e.g. beach, study room).",
    "If the user asks for transparent background / cutout / green screen, keep that intent.",
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
    transparentCutout ? TRANSPARENT_CUTOUT_SUFFIX_EN : SCENE_IMAGE_QUALITY_SUFFIX_EN,
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
  const rawUrl = await postEvolinkGptImage2AndUpload(englishPrompt, gcsSubdir, {
    size: aspectRatio,
    flowLog,
    quality: "medium",
    captureError: evoErr,
  });
  if (!rawUrl) {
    appendImageFlowLog(flowLog, `[自定义抠像] 第 ${slotIndex + 1} 张生图失败：${String(evoErr.message || "未知").slice(0, 160)}`);
    return null;
  }
  if (!transparentCutout) {
    appendImageFlowLog(flowLog, `[自定义抠像] 第 ${slotIndex + 1} 张场景图完成`);
    return rawUrl;
  }
  appendImageFlowLog(flowLog, `[自定义抠像] 第 ${slotIndex + 1} 张生图完成，用户要求透明底 → 开始抠图`);
  try {
    const { characterPngUrl } = await backgroundRemoveStep({ imageUrl: rawUrl });
    appendImageFlowLog(flowLog, `[自定义抠像] 第 ${slotIndex + 1} 张透明底抠图完成`);
    return characterPngUrl || rawUrl;
  } catch (e: unknown) {
    appendImageFlowLog(
      flowLog,
      `[自定义抠像] 第 ${slotIndex + 1} 张抠图失败，回退原图：${String((e as Error)?.message || e).slice(0, 120)}`,
    );
    return rawUrl;
  }
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
    `[自定义抠像] 开始 · 比例=${options.aspectRatio} · 张数=${options.count} · 模式=${transparentCutout ? "透明底抠图" : "场景生图"} · 用户描述约 ${userPrompt.length} 字`,
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
